# Testing a single-file PHP + kv_store app, for real

**Written for DuckTracks**, from what GK Hub learned the hard way on 2026-08-17.
GK Hub was built off DuckTracks and shares its shape — one big `api.php`, a
MySQL `kv_store` of JSON blobs, a browser client that warms a cache from one
payload — so all of this should transfer directly.

## The one-sentence version

We had 131 passing assertions and shipped two outages in a day, because every
one of those assertions checked what the code *looked like* instead of running
it. Installing MySQL locally and actually executing `api.php` found both bugs in
about two minutes.

---

## 1. The trap: tests that read source instead of running it

It is very tempting, with a single-file PHP API, to test with regexes:

```php
// LOOKS like a test. Proves nothing.
ok('runBackup dumps the chat tables', str_contains($api, "chat_messages"));
```

That passes whether or not the function can execute. Ours passed while
`runBackup()` was throwing on **every single call** in production.

Source-shape assertions are still worth having — they're fast, need no
database, and they're the right tool for "did someone add a table without
adding it to the backup". Just never let them stand in for execution.

**Rule we now follow:** a source-shape assertion may check *coverage and
wiring*. Only an executing test may be called *verification*.

## 2. The setup: a throwaway server per run

The whole harness is ~30 lines of bash and needs no framework.

```bash
set -u
cd "$(dirname "$0")/.."
ROOT=$(pwd)
DB=myapp_test_$$          # $$ = PID, so parallel runs never collide
PORT=8902
TMP=$(mktemp -d)

pass=0; fail=0
ok(){ if [ "$2" = "$3" ]; then echo "  PASS $1"; pass=$((pass+1));
      else echo "  FAIL $1 (got [$2] want [$3])"; fail=$((fail+1)); fi; }

# Loud skips. A silent skip is worse than a failure: it reads as success.
command -v mysql >/dev/null && command -v php >/dev/null || { echo "SKIP: needs mysql + php"; exit 0; }
mysqladmin ping >/dev/null 2>&1 || { echo "SKIP: no mysqld running"; exit 0; }

# Throwaway config pointing at the throwaway DB and throwaway data dirs.
cat > "$TMP/config.php" <<PHP
<?php
define('DB_HOST','localhost'); define('DB_NAME','$DB');
define('DB_USER','${MYSQL_USER:-$USER}'); define('DB_PASS','${MYSQL_PASS:-}');
define('BACKUPS_DIR','$TMP/bk'); define('UPLOADS_DIR','$TMP/up');
PHP

# COPY api.php — do not symlink. PHP resolves __DIR__ through symlinks, so a
# symlinked api.php loads the REAL config.php and writes to the REAL data dirs.
# This one is genuinely dangerous: a test run can trash production-shaped data.
cp "$ROOT/api.php" "$TMP/api.php"

cleanup(){ [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null
           mysql -u "$MU" -e "DROP DATABASE IF EXISTS $DB;" 2>/dev/null
           rm -rf "$TMP"; }
trap cleanup EXIT

mysql -u "$MU" -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB;" || exit 1
mysql -u "$MU" "$DB" < schema.sql || exit 1

php -S 127.0.0.1:$PORT -t "$TMP" >/dev/null 2>&1 &
SRV=$!
sleep 1.5
```

Then drive it with `curl` and assert on the JSON.

## 3. The setting that makes concurrency bugs visible

PHP's built-in server is **single-threaded by default**, which hides every
race you are trying to find:

```bash
PHP_CLI_SERVER_WORKERS=8 php -S 127.0.0.1:$PORT -t "$TMP" &
```

With that, fire real parallel writes:

```bash
PIDS=""
bg(){ post "$@" & PIDS="$PIDS $!"; }
# A bare `wait` also waits on the php -S server, which never exits.
waitall(){ for p in $PIDS; do wait "$p" 2>/dev/null; done; PIDS=""; }

for i in $(seq 1 12); do bg category_save "{\"category\":{\"id\":\"c$i\"}}"; done
waitall
ok "all 12 survived" "$(count_ids categories)" "12"
```

This is how we proved the original "seed 12 sections" bug (only 4 of 12 rows
survived) and how we later caught a **lock-contention hang** that a
single-threaded server would have shown as "fine, just slow".

## 4. Assert what the CLIENT is served, not what a table holds

Our biggest own-goal. Tests counted rows by reading storage directly:

```bash
count_ids(){ q "SELECT v FROM kv_store WHERE k='$1';" | php -r '...count...'; }
```

When we migrated a collection out of `kv_store` into its own table, those tests
reported **0 records** — indistinguishable from catastrophic data loss, when
nothing was wrong. Worse, one assertion then *passed for the wrong reason*: it
grepped the now-frozen doc for a field that nothing writes any more, so it
reported success without the code under test having run at all.

Both directions are dangerous: a false alarm burns an hour, a false pass ships.

```bash
# Storage-agnostic: this is the contract the browser actually depends on.
count_ids(){ curl -s "$B?action=kv_all" -H "$AH" \
  | php -r '$d=json_decode(stream_get_contents(STDIN),true);
            $x=$d["data"]["'"$1"'"]??null; echo is_array($x)?count($x):0;'; }
```

After that change, migrating further collections needed **zero** assertion
edits.

## 5. Running the REAL client against the REAL API

Dev previews usually run a localStorage shim and never touch `api.php`, so they
cannot verify the server path at all. You can get the true client cheaply:

```bash
npm run build                       # production build => PROD => remote mode
cp -R dist/. "$TMP/"                # the real app
cp api.php "$TMP/api.php"           # next to it, so the relative API base hits it
php -S 127.0.0.1:8890 -t "$TMP" &
```

Because the API base is a **relative** path (`api.php`) and remote mode keys off
the production build flag, this is the genuine client talking to a genuine
server on a real database. We used it to verify a storage migration and an
optimistic-concurrency conflict toast in an actual browser.

Keep a localStorage override (`gkForceRemote`) so you can force either mode.

## 6. Seed *legacy* data to test the migration path

A migration that is only tested on an empty database is not tested. Insert the
OLD shape before starting the server:

```bash
mysql -u root "$DB" -e "INSERT INTO kv_store (k,v,updated_at)
  VALUES ('tasks','[{\"id\":\"old1\",\"title\":\"Legacy\",\"dueDate\":\"\"}]',UTC_TIMESTAMP());"
```

Then assert the first request migrates it. This caught that an empty `dueDate`
(`""`) must become `NULL`, because a `DATE` column will otherwise reject it or
silently store `0000-00-00`.

---

## Three PHP-specific bugs worth stealing our guards for

**1. Declaration order.** PHP hoists *function declarations* but **not**
variable assignments or `define()`. If your router is `switch ($action)` near
the top and you declare a spec array or constant lower down "next to the code it
documents", it does not exist while a request runs.

```php
// test: every global and constant must be declared before the router
$switchPos = strpos($api, 'switch ($action)');
preg_match_all("/^define\('([A-Z0-9_]+)'/m", $api, $m);
foreach (array_unique($m[1]) as $c)
    ok("$c defined before switch", strpos($api,"define('$c'") < $switchPos);
```

This bit us **three times in one day** with three different symbols.

**2. `Error` is not `Exception`.** A `TypeError` or "Undefined constant" is a
`\Error`, so this does **not** catch it:

```php
try { runBackup($pdo); } catch (Exception $e) { /* never runs */ }
```

Ours sailed past the handler meant to report backup failures and surfaced as a
generic 500. Catch `Throwable` where you mean "anything".

**3. `SELECT … FOR UPDATE` on a row that does not exist takes a GAP lock**, not
a row lock. We used it to snapshot a previous version before overwriting; when
ten people created ten *different* new records at once, they all contended on
the same gap and requests **hung**. Fix: check existence first and skip the lock
entirely for new records (a new record has no previous version to snapshot).

## Deployment gotchas in this architecture

- **`config.php` is gitignored and the deploy is `cp -R *`**, so constants added
  to `config.sample.php` **never reach a live install**. They must be pasted in
  by hand. Every optional integration is `defined()`-gated, so a missing
  constant means the feature is **silently off**, never an error. Build a
  config-health panel that lists each integration as set / not set / partly set,
  returning constant **names** only — never values.
- **PHP honours the FIRST `define()`** and ignores later duplicates. Pasting a
  second `CRON_KEY` at the end of the file leaves the original in force.
- **`trim()` credentials at the point of use.** They get pasted through cPanel's
  File Manager, where a trailing space is easy to add and invisible afterwards.
- If your "update" button takes a backup before deploying, a bug in the backup
  path **disables the only in-app route to its own fix**. Know your out-of-band
  deploy path (for cPanel: Git Version Control → Manage → Pull or Deploy), and
  check whether your rollback even covers `api.php` — ours deliberately does not.

## What we run now

| Script | Needs DB | What it proves |
|---|---|---|
| `test_backup_restore.sh` | yes | backup/restore round-trip, every table, off-site failure handling |
| `test_concurrent_writes.sh` | yes | parallel writes, cascades, locking, conflict detection |
| `test_record_tables.php` | no | schema/backup coverage, declaration ordering |
| `test_backup_auth.php` | no | auth outcomes, credential trimming |
| `test_backup_health.mjs` | no | pure verdict logic (node, no framework) |

No test framework, no fixtures, no mocks — bash + curl + `php -r`, and a plain
`ok()` function. The whole suite is ~1,200 lines and runs in well under a
minute.

**The single most valuable change was `brew install mysql`.** Everything else
here is a detail.
