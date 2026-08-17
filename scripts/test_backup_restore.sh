#!/bin/bash
# Backup/restore round-trip check. The one thing that must never silently fail:
# a backup you can't restore is not a backup.
#
# Needs a local mysql + php. Uses a throwaway DB and a throwaway backups dir —
# it never touches the real database or backups/.
#
#   bash scripts/test_backup_restore.sh
#
# Regression it exists for: runBackup's filename stamp is second-resolution, and
# backup_restore takes a safety snapshot before restoring. When both landed in
# the same second, the snapshot truncated the very file being restored, and the
# restore then "succeeded" restoring the already-broken current state.
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DB=gk_backup_test_$$
PORT=8899
TMP=$(mktemp -d)
BK="$TMP/backups"
pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1)); else echo "  FAIL $1 (got [$2] want [$3])"; fail=$((fail+1)); fi; }
q(){ mysql -N -u "${MYSQL_USER:-$USER}" "$DB" -e "$1"; }

command -v mysql >/dev/null && command -v php >/dev/null || { echo "SKIP: needs mysql + php on PATH"; exit 0; }
mysqladmin ping >/dev/null 2>&1 || { echo "SKIP: no mysqld running"; exit 0; }

# Throwaway config pointing at the throwaway DB + backups dir, served from a
# temp docroot that symlinks the real api.php.
cat > "$TMP/config.php" <<PHP
<?php
define('DB_HOST','localhost'); define('DB_NAME','$DB');
define('DB_USER','${MYSQL_USER:-$USER}'); define('DB_PASS','${MYSQL_PASS:-}');
define('CRON_KEY','test'); define('BACKUPS_DIR','$BK'); define('UPLOADS_DIR','$TMP/uploads');
PHP
# Copy, don't symlink: PHP resolves __DIR__ through symlinks, so a symlinked
# api.php would load the REAL config.php and write to the REAL backups dir.
cp "$ROOT/api.php" "$TMP/api.php"

cleanup(){ [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null; mysql -u "${MYSQL_USER:-$USER}" -e "DROP DATABASE IF EXISTS $DB;" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT

mysql -u "${MYSQL_USER:-$USER}" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB;" || exit 1
mysql -u "${MYSQL_USER:-$USER}" "$DB" < schema.sql || exit 1
lsof -i ":$PORT" >/dev/null 2>&1 && { echo "SKIP: port $PORT already in use"; exit 0; }
php -S 127.0.0.1:$PORT -t "$TMP" >/dev/null 2>&1 &
SRV=$!
sleep 1.5
B="http://127.0.0.1:$PORT/api.php"
# Prove we're talking to the throwaway instance, not a stray server on this port.
curl -s "$B?action=version_info" >/dev/null || { echo "FAIL: test server did not start"; exit 1; }
J='Content-Type: application/json'
TOK=$(curl -s -X POST "$B?action=login" -H "$J" -d '{"name":"Hayden","pin":"1234"}' | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["token"] ?? "";')
[ -n "$TOK" ] || { echo "FAIL: could not log in as the seeded admin"; exit 1; }
AH="Authorization: Bearer $TOK"
set_kv(){ curl -s -X POST "$B?action=kv_set" -H "$AH" -H "$J" -d "{\"key\":\"$1\",\"value\":$2}" >/dev/null; }
has(){ php -r "echo strpos((string)gzdecode(file_get_contents('$1')),'$2')!==false?'yes':'no';"; }

echo "== round trip =="
set_kv imagerepo '{"blocks":[{"id":"b1","text":"Bathorium"}]}'
curl -s -X POST "$B?action=task_save" -H "$AH" -H "$J" -d '{"task":{"id":"t1","title":"Restock lavender"}}' >/dev/null
curl -s -X POST "$B?action=sop_save" -H "$AH" -H "$J" -d '{"sop":{"id":"s1","title":"Opening"}}' >/dev/null
curl -s -X POST "$B?action=sop_save" -H "$AH" -H "$J" -d '{"sop":{"id":"s1","title":"Opening v2"}}' >/dev/null  # makes a revision
# Chat rows go in at the DB level: the point is that runBackup/restore cover the
# tables, not that the chat endpoints work (that's chat's own concern).
q "INSERT INTO chat_channels (id,name,kind,visibility) VALUES ('c1','general','channel','public');"
q "INSERT INTO chat_messages (id,channel_id,user_id,body) VALUES (4242,'c1','u1','Lavender restock is in');"
q "INSERT INTO chat_members (channel_id,user_id,last_read_msg_id) VALUES ('c1','u1',4242);"
F=$(curl -s -X POST "$B?action=backup_run" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["file"] ?? "";')
ok "backup written" "$([ -n "$F" ] && [ -f "$BK/$F" ] && echo yes || echo no)" "yes"
ok "backup holds kv data" "$(has "$BK/$F" Bathorium)" "yes"
ok "backup holds revisions" "$(php -r "\$d=json_decode(gzdecode(file_get_contents('$BK/$F')),true); echo count(\$d['revisions'])?'yes':'no';")" "yes"
ok "backup holds users" "$(has "$BK/$F" pin_hash)" "yes"
ok "backup holds chat messages" "$(has "$BK/$F" 'Lavender restock is in')" "yes"
ok "backup holds chat channels" "$(has "$BK/$F" chat_channels)" "yes"
ok "listed in backup_list" "$(curl -s "$B?action=backup_list" -H "$AH" | grep -c "$F")" "1"

set_kv imagerepo '{"blocks":[]}'
curl -s -X POST "$B?action=task_delete" -H "$AH" -H "$J" -d '{"id":"t1"}' >/dev/null
q "DELETE FROM revisions;"
q "DELETE FROM chat_messages; DELETE FROM chat_members; DELETE FROM chat_channels;"
curl -s -X POST "$B?action=backup_restore" -H "$AH" -H "$J" -d "{\"file\":\"$F\"}" >/dev/null
ok "kv restored" "$(q "SELECT v FROM kv_store WHERE k='imagerepo';" | grep -c Bathorium)" "1"
ok "tasks restored" "$(q "SELECT v FROM kv_store WHERE k='tasks';" | grep -c lavender)" "1"
ok "revisions restored" "$(q 'SELECT COUNT(*) FROM revisions;')" "1"
ok "chat channels restored" "$(q "SELECT COUNT(*) FROM chat_channels WHERE id='c1';")" "1"
ok "chat message restored" "$(q "SELECT body FROM chat_messages;" | grep -c 'Lavender restock is in')" "1"
# The id must come back as 4242, not renumbered by AUTO_INCREMENT — chat_members
# .last_read_msg_id points at it, so a renumber silently breaks unread state.
ok "chat message id preserved" "$(q 'SELECT id FROM chat_messages;')" "4242"
ok "last_read pointer still valid" "$(q 'SELECT COUNT(*) FROM chat_members m JOIN chat_messages g ON g.id = m.last_read_msg_id;')" "1"
ok "tokens cleared" "$(q 'SELECT COUNT(*) FROM tokens;')" "0"
# 3 = first write's lazy auto-backup, the explicit backup_run, the pre-restore snapshot.
ok "safety snapshot kept alongside" "$(ls "$BK"/gk_*.json.gz | wc -l | tr -d ' ')" "3"

echo "== same-second restore must not eat the backup =="
TOK=$(curl -s -X POST "$B?action=login" -H "$J" -d '{"name":"Hayden","pin":"1234"}' | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["token"] ?? "";')
AH="Authorization: Bearer $TOK"
set_kv imagerepo '{"blocks":[{"id":"b1","text":"Bathorium"}]}'
python3 -c "import time; time.sleep(1.0 - (time.time() % 1.0) + 0.02)" 2>/dev/null || sleep 1
F2=$(curl -s -X POST "$B?action=backup_run" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["file"] ?? "";')
set_kv imagerepo '{"blocks":[]}'
curl -s -X POST "$B?action=backup_restore" -H "$AH" -H "$J" -d "{\"file\":\"$F2\"}" >/dev/null
ok "backup file intact after same-second restore" "$(has "$BK/$F2" Bathorium)" "yes"
ok "data actually came back" "$(q "SELECT v FROM kv_store WHERE k='imagerepo';" | grep -c Bathorium)" "1"

echo "== refuses bad input =="
TOK=$(curl -s -X POST "$B?action=login" -H "$J" -d '{"name":"Hayden","pin":"1234"}' | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["token"] ?? "";')
AH="Authorization: Bearer $TOK"
printf 'not gzip' > "$BK/gk_99999999_999999.json.gz"
ok "corrupt backup refused" "$(curl -s -X POST "$B?action=backup_restore" -H "$AH" -H "$J" -d '{"file":"gk_99999999_999999.json.gz"}' | grep -c 'corrupt or unreadable')" "1"
ok "data survived that attempt" "$(q "SELECT v FROM kv_store WHERE k='imagerepo';" | grep -c Bathorium)" "1"
ok "path traversal refused" "$(curl -s "$B?action=backup_download&file=../config.php" -H "$AH" | grep -c 'Invalid filename')" "1"

echo "== stale-format snapshots =="
# A format-1 dump (pre-chat, pre-record-tables) restores as a DELETE of every
# table it never captured, so it must be refused outright — this is the guard
# for an off-site copy pulled back from B2 by hand, which the purge can't reach.
php -r 'file_put_contents("'"$BK"'/gk_20200101_000000.json.gz", gzencode(json_encode(["createdAt"=>"2020-01-01T00:00:00Z","kv"=>[],"users"=>[],"revisions"=>[]])));'
ok "stale-format backup refused" "$(curl -s -X POST "$B?action=backup_restore" -H "$AH" -H "$J" -d '{"file":"gk_20200101_000000.json.gz"}' | grep -c 'predates the current data format')" "1"
ok "chat survived that attempt" "$(q "SELECT COUNT(*) FROM chat_messages;")" "1"
ok "current backups carry a format stamp" "$(curl -s -X POST "$B?action=backup_run" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo $d["file"] ?? "";' | { read f; has "$BK/$f" '"format":2'; })" "yes"

echo "== deploy purge drops snapshots of an older format =="
# Dropping the marker is exactly what a format bump looks like to the next
# request: the first backup path touched afterwards wipes the old snapshots.
BEFORE=$(ls "$BK"/gk_*.json.gz | wc -l | tr -d ' ')
ok "snapshots exist before the purge" "$([ "$BEFORE" -gt 0 ] && echo yes || echo no)" "yes"
rm -f "$BK/.format"
curl -s "$B?action=backup_list" -H "$AH" >/dev/null
ok "old snapshots purged" "$(ls "$BK"/gk_*.json.gz 2>/dev/null | wc -l | tr -d ' ')" "0"
ok "marker rewritten so it happens once" "$(cat "$BK/.format" 2>/dev/null)" "2"
curl -s "$B?action=backup_list" -H "$AH" >/dev/null
curl -s -X POST "$B?action=backup_run" -H "$AH" >/dev/null
ok "backups resume after the purge" "$(ls "$BK"/gk_*.json.gz 2>/dev/null | wc -l | tr -d ' ')" "1"

echo "== off-site copy: unconfigured is safe and honest =="
R=$(curl -s --max-time 20 -X POST "$B?action=backup_run" -H "$AH")
ok "backup still succeeds with no B2 config" "$(echo "$R" | grep -c '"ok":true')" "1"
ok "reports off-site as unconfigured" "$(echo "$R" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo (($d["offsite"]["configured"]??null)===false)?"1":"0";')" "1"

echo "== off-site copy: a broken destination must not break the backup =="
# Bogus credentials. The assertion is deliberately tolerant about WHY the upload
# failed (rejected creds, or no network in CI) — what matters is that the local
# backup still succeeded and the failure was recorded rather than swallowed.
cat >> "$TMP/config.php" <<'PHP'
define('B2_KEY_ID','bogus_key_id_for_test');
define('B2_APPLICATION_KEY','bogus_application_key_for_test');
PHP
# OPcache has already compiled config.php by now and only re-checks mtime every
# opcache.revalidate_freq seconds (default 2), so without this wait the server
# keeps serving the pre-append config and the section below tests nothing.
sleep 3
BEFORE=$(ls "$BK"/gk_*.json.gz | wc -l | tr -d ' ')
R=$(curl -s --max-time 60 -X POST "$B?action=backup_run" -H "$AH")
ok "local backup still succeeded" "$(echo "$R" | grep -c '"ok":true')" "1"
ok "local snapshot really written" "$([ "$(ls "$BK"/gk_*.json.gz | wc -l | tr -d ' ')" -gt "$BEFORE" ] && echo yes || echo no)" "yes"
ok "off-site failure reported, not swallowed" "$(echo "$R" | php -r '$d=json_decode(stream_get_contents(STDIN),true); $o=$d["offsite"]??[]; echo (($o["configured"]??null)===true && ($o["ok"]??null)===false && !empty($o["error"]))?"1":"0";')" "1"
ok "failure persisted for the Admin Panel" "$(q "SELECT v FROM kv_store WHERE k='backupOffsite';" | grep -c '"ok":false')" "1"
ok "backup_list surfaces the failure" "$(curl -s --max-time 20 "$B?action=backup_list" -H "$AH" | php -r '$d=json_decode(stream_get_contents(STDIN),true); echo (($d["offsite"]["ok"]??null)===false)?"1":"0";')" "1"

echo
echo "RESULT: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
