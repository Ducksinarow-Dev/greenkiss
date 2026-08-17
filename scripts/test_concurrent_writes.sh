#!/bin/bash
# Concurrent-write safety check. Every per-record write is a read-modify-write
# of a whole JSON collection, so without a row lock two simultaneous writers
# both read the same list and the second write drops the first one's record.
#
# The app really does fire parallel bursts: "seed the 12 standard sections"
# sends 12 unawaited category_save calls, and converting a task to a project
# sends one task_save per subtask. Before kvMutate() only 4 of 12 categories
# survived that button.
#
#   bash scripts/test_concurrent_writes.sh
#
# Needs a local mysql + php. Throwaway DB and backups dir; never touches real data.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DB=gk_conc_test_$$
PORT=8902
TMP=$(mktemp -d)
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1 (got [$2] want [$3])"; fail=$((fail+1)); fi; }
MU="${MYSQL_USER:-$USER}"
q(){ mysql -N -u "$MU" "$DB" -e "$1"; }
# Counts what the CLIENT is served, not what a particular table holds. This used
# to read kv_store directly, which made every assertion below silently coupled
# to storage: when tasks moved to their own table (#41 step 3) the counts went
# to zero and read as lost data rather than as the test looking in the old
# place. Going through kv_all keeps these about behaviour — the contract the
# browser depends on — so the remaining collections can migrate without
# touching a single assertion here.
count_ids(){ curl -s --max-time 20 "$B?action=kv_all" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); $x=$d["data"]["'"$1"'"]??null; echo is_array($x)?count($x):0;'; }
# The served collection as JSON, for assertions that grep for specific content.
served(){ curl -s --max-time 20 "$B?action=kv_all" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo json_encode($d["data"]["'"$1"'"]??[]);'; }

command -v mysql >/dev/null && command -v php >/dev/null || { echo "SKIP: needs mysql + php on PATH"; exit 0; }
mysqladmin ping >/dev/null 2>&1 || { echo "SKIP: no mysqld running"; exit 0; }
lsof -i ":$PORT" >/dev/null 2>&1 && { echo "SKIP: port $PORT in use"; exit 0; }

mkdir -p "$TMP/bk"
cat > "$TMP/config.php" <<PHP
<?php
define('DB_HOST','localhost'); define('DB_NAME','$DB');
define('DB_USER','$MU'); define('DB_PASS','${MYSQL_PASS:-}');
define('CRON_KEY','test'); define('BACKUPS_DIR','$TMP/bk'); define('UPLOADS_DIR','$TMP/up');
PHP
# Copy, don't symlink: PHP resolves __DIR__ through symlinks and would pick up
# the real config.php.
cp "$ROOT/api.php" "$TMP/api.php"
# Start with a recent backup present so maybeAutoBackup short-circuits, keeping
# this test about write concurrency rather than about the backup path.
printf 'x' | gzip > "$TMP/bk/gk_20990101_000000.json.gz"

cleanup(){ [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; mysql -u "$MU" -e "DROP DATABASE IF EXISTS $DB;" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

mysql -u "$MU" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB;" || exit 1
mysql -u "$MU" "$DB" < schema.sql || exit 1
# PHP_CLI_SERVER_WORKERS gives the built-in server real concurrency; it is
# single-threaded otherwise, which hides this entire class of bug.
PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:$PORT -t "$TMP" >/dev/null 2>&1 &
SRV=$!
sleep 1.5
B="http://127.0.0.1:$PORT/api.php"
J='Content-Type: application/json'
TOK=$(curl -s --max-time 10 -X POST "$B?action=login" -H "$J" -d '{"name":"Hayden","pin":"1234"}' | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["token"] ?? "";')
[ -n "$TOK" ] || { echo "FAIL: could not log in"; exit 1; }
AH="Authorization: Bearer $TOK"
post(){ curl -s --max-time 30 -X POST "$B?action=$1" -H "$AH" -H "$J" -d "$2" >/dev/null; }
# Collect background request PIDs and wait on those specifically — a bare `wait`
# would also wait on the php -S server, which never exits.
PIDS=""
bg(){ post "$@" & PIDS="$PIDS $!"; }
waitall(){ for p in $PIDS; do wait "$p" 2>/dev/null; done; PIDS=""; }

echo "== 12 concurrent category_save (the seed-standard-sections button) =="
for i in $(seq 1 12); do
  bg category_save "{\"category\":{\"id\":\"c$i\",\"name\":\"Section $i\",\"color\":\"#799385\"}}"
done
waitall
ok "all 12 categories survived" "$(count_ids categories)" "12"

echo "== 20 concurrent task_save across two collections =="
for i in $(seq 1 10); do
  bg task_save "{\"task\":{\"id\":\"t$i\",\"title\":\"Task $i\"}}"
  bg content_save "{\"item\":{\"id\":\"n$i\",\"title\":\"Item $i\"}}"
done
waitall
ok "all 10 tasks survived" "$(count_ids tasks)" "10"
ok "all 10 content items survived" "$(count_ids content)" "10"

echo "== 8 concurrent doc_item_save (two editors in Image Repository) =="
for i in $(seq 1 8); do
  bg doc_item_save "{\"key\":\"imagerepo\",\"item\":{\"id\":\"b$i\",\"type\":\"title\",\"text\":\"Vendor $i\"}}"
done
waitall
ok "all 8 repo entries survived" "$(q "SELECT v FROM kv_store WHERE k='imagerepo';" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo isset($d["blocks"])?count($d["blocks"]):0;')" "8"

echo "== concurrent deletes leave the rest alone =="
for i in 1 2 3; do bg task_delete "{\"id\":\"t$i\"}"; done
waitall
ok "7 tasks left after 3 concurrent deletes" "$(count_ids tasks)" "7"

echo "== cascade runs server-side, not from a stale client array =="
post project_save '{"project":{"id":"p1","name":"Spring"}}'
post task_save '{"task":{"id":"t20","title":"Project task","projectId":"p1"}}'
# A second client adds a task AFTER the first one loaded its cache.
post task_save '{"task":{"id":"t21","title":"Coworker task added later"}}'
post project_delete '{"id":"p1"}'
# Against what the client is served, for the same reason as count_ids. Note the
# third assertion would PASS for the wrong reason if left pointed at kv_store:
# the frozen doc contains no "projectId":"p1" simply because nothing writes it
# any more, so it would report success without the cascade having run at all.
ok "coworker's later task survived the cascade" "$(served tasks | grep -c 'Coworker task added later')" "1"
ok "deleted project's task was unlinked, not deleted" "$(served tasks | grep -c 'Project task')" "1"
ok "projectId cleared" "$(served tasks | grep -c '"projectId":"p1"')" "0"

echo "== sop_delete is server-side =="
post sop_save '{"sop":{"id":"s1","title":"Mine"}}'
post sop_save '{"sop":{"id":"s2","title":"Coworker SOP"}}'
post sop_delete '{"id":"s1"}'
# Served, not kv_store — sops moved to rows in #41 step 5.
ok "coworker's SOP survived" "$(served sops | grep -c 'Coworker SOP')" "1"
ok "target SOP gone" "$(served sops | grep -c '"Mine"')" "0"

echo "== nav_access_save merges per user (two admins, different staff) =="
post nav_access_save '{"userId":"u_a","sections":["tasks"]}'
post nav_access_save '{"userId":"u_b","sections":["imagerepo","calendar"]}'
NAV=$(q "SELECT v FROM kv_store WHERE k='navAccess';")
ok "first admin's grant survived" "$(echo "$NAV" | grep -c 'u_a')" "1"
ok "second admin's grant survived" "$(echo "$NAV" | grep -c 'u_b')" "1"

echo "== 10 concurrent NEW sops (gap-lock regression) =="
# sop_save snapshots the previous version under a row lock before overwriting.
# Taking that lock unconditionally gap-locks when the row does NOT exist yet, so
# ten people creating ten different SOPs at once contended on the same gap and
# the whole thing HUNG rather than slowed down. Existence is now checked before
# any transaction is opened; a new SOP needs no lock at all.
for i in $(seq 1 10); do
  bg sop_save "{\"sop\":{\"id\":\"par$i\",\"title\":\"Parallel $i\",\"kind\":\"sop\"}}"
done
waitall
ok "all 10 new sops created" "$(served sops | grep -o 'Parallel [0-9]*' | sort -u | wc -l | tr -d ' ')" "10"
# Editing the SAME sop concurrently must still snapshot exactly one revision
# per content change, not one per request.
REV_BEFORE=$(q "SELECT COUNT(*) FROM revisions;")
post sop_save '{"sop":{"id":"par1","title":"Parallel 1","kind":"sop","blocks":[{"id":"b","type":"text","text":"v2"}]}}'
ok "a content change writes exactly one revision" "$(q "SELECT COUNT(*) FROM revisions;")" "$((REV_BEFORE+1))"
post sop_save '{"sop":{"id":"par1","title":"Parallel 1","kind":"sop","blocks":[{"id":"b","type":"text","text":"v2"}],"updatedAt":"2026-08-17T12:00:00Z"}}'
ok "a metadata-only save writes none" "$(q "SELECT COUNT(*) FROM revisions;")" "$((REV_BEFORE+1))"

echo "== #40 optimistic concurrency (stale write refused, not merged) =="
post content_save '{"item":{"id":"v1","title":"Original"}}'
V=$(served content | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d as $x){ if($x["id"]==="v1"){ echo $x["_v"]; return; } } echo "";')
ok "records carry a version (_v)" "$([ -n "$V" ] && echo yes || echo no)" "yes"
# Someone else saves first, moving the row on.
post content_save '{"item":{"id":"v1","title":"Coworker edit"}}'
# Our client still holds the version it read BEFORE that.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$B?action=content_save" -H "$AH" -H "$J" -d "{\"item\":{\"id\":\"v1\",\"title\":\"My stale overwrite\",\"_v\":$V}}")
ok "stale save refused with 409" "$CODE" "409"
ok "coworker's edit was NOT overwritten" "$(served content | grep -c 'Coworker edit')" "1"
ok "the stale title never landed" "$(served content | grep -c 'My stale overwrite')" "0"
# A client that doesn't track versions (older build, or a brand-new record)
# must still be able to write — this can't become a wall.
ok "save without _v still works" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$B?action=content_save" -H "$AH" -H "$J" -d '{"item":{"id":"v1","title":"No version sent"}}')" "200"
# And the CURRENT version always saves.
V2=$(served content | php -r '$d=json_decode(stream_get_contents(STDIN),true); foreach($d as $x){ if($x["id"]==="v1"){ echo $x["_v"]; return; } } echo "";')
ok "current version saves" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -X POST "$B?action=content_save" -H "$AH" -H "$J" -d "{\"item\":{\"id\":\"v1\",\"title\":\"Fresh edit\",\"_v\":$V2}}")" "200"
# _v is server-managed metadata; storing it inside data would freeze a stale
# number into the JSON and make every later comparison meaningless.
ok "_v is not persisted inside the record" "$(q "SELECT data FROM content WHERE id='v1';" | grep -c '_v')" "0"

echo "== step 4: every migrated collection is served from its table =="
for c in content projects campaigns categories contacts tags instances tasks sops alerts; do
  ok "$c served from its row table" "$(q "SELECT COUNT(*) FROM $c;")" "$(count_ids $c)"
done

echo "== doc_item_save is allowlisted =="
ok "cannot be aimed at tasks" "$(curl -s --max-time 10 -X POST "$B?action=doc_item_save" -H "$AH" -H "$J" -d '{"key":"tasks","item":{"id":"x"}}' | grep -c 'Unknown document')" "1"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
