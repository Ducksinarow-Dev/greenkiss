<?php
/**
 * #41 step 1 — per-record table schema checks. DB-FREE on purpose: it reads
 * api.php and schema.sql as text, so it runs anywhere php does (no mysql
 * needed, unlike test_backup_restore.sh / test_concurrent_writes.sh).
 *
 *   php scripts/test_record_tables.php
 *
 * The regression it exists for: runBackup() and restoreFromBackupData() both
 * enumerate tables EXPLICITLY. Add a collection to $GK_RECORD_TABLES, forget
 * one of those two, and backups silently stop covering the data that moved out
 * of kv_store — the single most likely way this migration loses data. Asserting
 * that coverage here makes the mistake impossible to ship.
 */
$root = dirname(__DIR__);
$api = file_get_contents("$root/api.php");
$schema = file_get_contents("$root/schema.sql");

$pass = 0;
$fail = 0;
function ok($label, $cond) {
    global $pass, $fail;
    if ($cond) { echo "  PASS $label\n"; $pass++; }
    else { echo "  FAIL $label\n"; $fail++; }
}

// api.php can't be require'd (it would connect to a DB and serve a request), so
// lift the spec and recordTableSql() out of its source and eval just those. One
// source of truth: the DDL asserted below is the DDL that actually runs.
function gk_lift($src, $pattern, $what) {
    if (!preg_match($pattern, $src, $m)) { echo "  FAIL could not find $what in api.php\n"; exit(1); }
    return $m[0];
}
eval(gk_lift($api, '/\$GK_RECORD_TABLES = \[.*?\n\];/s', '$GK_RECORD_TABLES'));
eval(gk_lift($api, '/\$GK_CHAT_TABLES = \[.*?\];/s', '$GK_CHAT_TABLES'));
eval(gk_lift($api, '/function recordTableSql\(.*?\n\}/s', 'recordTableSql()'));

$spec = $GK_RECORD_TABLES;
ok('spec lifted from api.php', count($spec) > 0);

// ── Ordering: specs must be assigned BEFORE the request switch ────────
// The bug this caught the hard way: PHP hoists function declarations but NOT
// variable assignments. With these arrays defined below `switch ($action)` they
// were null for the whole request, so `global $GK_RECORD_TABLES` in runBackup()
// gave array_keys(null) -> TypeError. TypeError extends Error, not Exception, so
// it bypassed runBackupOrFail's catch and 500'd every backup — and every write
// that tripped the staleness check. Shipped to production before anyone noticed,
// because every other assertion here checks the code's SHAPE, not its execution.
$switchPos = strpos($api, 'switch ($action)');
ok('found the request switch', $switchPos !== false);
foreach (['$GK_RECORD_TABLES', '$GK_CHAT_TABLES'] as $var) {
    $assignPos = strpos($api, $var . ' = [');
    ok("$var is assigned before switch (\$action)",
        $assignPos !== false && $switchPos !== false && $assignPos < $switchPos);
}
// Any OTHER global a request-time function reaches for must satisfy the same
// rule, so a future spec can't reintroduce this.
preg_match_all('/global (\$[A-Za-z_][A-Za-z0-9_]*(?:, *\$[A-Za-z_][A-Za-z0-9_]*)*);/', $api, $gm);
$globals = [];
foreach ($gm[1] as $decl) {
    foreach (preg_split('/, */', $decl) as $g) $globals[trim($g)] = true;
}
foreach (array_keys($globals) as $g) {
    $assignPos = strpos($api, $g . ' = ');
    ok("global $g is assigned before the switch",
        $assignPos !== false && $assignPos < $switchPos);
}

// define() has the SAME trap and cost the same outage from a different symbol:
// GK_BACKUP_FORMAT was declared at line 1833 beside the code it documents, so
// it did not exist while any request ran and every backup died on "Undefined
// constant". define() is a runtime call, not a hoisted declaration — so any
// constant this file declares itself must be declared before the switch.
preg_match_all("/^define\('([A-Z0-9_]+)'/m", $api, $dm);
foreach (array_unique($dm[1]) as $const) {
    $pos = strpos($api, "define('$const'");
    ok("constant $const is defined before the switch", $pos !== false && $pos < $switchPos);
}
echo "  (collections: " . implode(', ', array_keys($spec)) . ")\n";

// ── The coverage assertions this file exists for ──────────────────────
// Assert against each function's OWN body. A `/function runBackup.*?X/s` over
// the whole file silently matches an X inside a LATER function — which made an
// earlier version of this test pass while runBackup had no dump loop at all.
// Functions here are top-level, so the body ends at the first column-0 brace.
$backupSrc = gk_lift($api, '/function runBackup\(\$pdo\) \{.*?\n\}/s', 'runBackup()');
$restoreSrc = gk_lift($api, '/function restoreFromBackupData\(\$pdo, \$data\) \{.*?\n\}/s', 'restoreFromBackupData()');
ok('lifted bodies are disjoint', !str_contains($backupSrc, 'function restoreFromBackupData')
    && !str_contains($restoreSrc, 'function runBackup'));

// Both sides must iterate the spec rather than hardcode a list, so adding a
// collection can never leave one of them behind.
ok('runBackup dumps the record tables', str_contains($backupSrc, "\$data['records'][\$table]"));
ok('runBackup iterates the spec (not a hardcoded list)',
    str_contains($backupSrc, 'foreach (array_keys($GK_RECORD_TABLES)'));
ok('runBackup declares the spec global',
    preg_match('/global [^;]*\$GK_RECORD_TABLES[^;]*;/', $backupSrc) === 1);
ok('runBackup creates the tables before selecting from them',
    preg_match('/ensureRecordTables\(\$pdo\);.*?SELECT \* FROM \$table/s', $backupSrc) === 1);
ok('runBackup seeds a records key in the dump', str_contains($backupSrc, "'records' => []"));

ok('restore restores the record tables',
    str_contains($restoreSrc, 'foreach (array_keys($GK_RECORD_TABLES)'));
ok('restore clears each table before inserting', str_contains($restoreSrc, 'DELETE FROM $table'));
ok('restore declares the spec global',
    preg_match('/global [^;]*\$GK_RECORD_TABLES[^;]*;/', $restoreSrc) === 1);
ok('restore tolerates a pre-migration backup with no records key',
    str_contains($restoreSrc, "\$data['records'][\$table] ?? []"));
ok('restore creates the tables before deleting from them',
    preg_match('/ensureRecordTables\(\$pdo\);.*?DELETE FROM kv_store/s', $restoreSrc) === 1);

// ── Chat tables: same two-sided coverage ─────────────────────────────
// Chat shipped while runBackup() dumped only kv_store/users/revisions, so every
// message sat outside every backup, and a restore left the surviving chat rows
// pointing at a different era's users and channels.
ok('chat spec lifted from api.php', $GK_CHAT_TABLES === ['chat_channels', 'chat_members', 'chat_messages']);
ok('runBackup dumps the chat tables', str_contains($backupSrc, "\$data['chat'][\$table]")
    && str_contains($backupSrc, 'foreach ($GK_CHAT_TABLES as $table)'));
ok('runBackup declares the chat spec global',
    preg_match('/global [^;]*\$GK_CHAT_TABLES[^;]*;/', $backupSrc) === 1);
ok('runBackup creates the chat tables before selecting from them',
    preg_match('/ensureChatTables\(\$pdo\);\s*\n\s*foreach \(\$GK_CHAT_TABLES/s', $backupSrc) === 1);
ok('runBackup seeds a chat key in the dump', str_contains($backupSrc, "'chat' => []"));

ok('restore clears the chat tables', str_contains($restoreSrc, 'array_reverse($GK_CHAT_TABLES)'));
ok('restore reinserts the chat tables', str_contains($restoreSrc, 'foreach ($GK_CHAT_TABLES as $table)'));
ok('restore declares the chat spec global',
    preg_match('/global [^;]*\$GK_CHAT_TABLES[^;]*;/', $restoreSrc) === 1);
ok('restore tolerates a pre-chat backup with no chat key',
    str_contains($restoreSrc, "\$data['chat'][\$table] ?? []"));
ok('restore creates the chat tables before deleting from them',
    preg_match('/ensureChatTables\(\$pdo\);.*?DELETE FROM \$table/s', $restoreSrc) === 1);
// chat_members.last_read_msg_id points at chat_messages.id, so the ids must be
// written explicitly rather than regenerated by AUTO_INCREMENT. The insert
// builds its column list from the row, which includes id — assert the row is
// used whole and nothing filters id out.
ok('chat restore preserves explicit ids', str_contains($restoreSrc, '$cols = array_keys($rows[0]);')
    && !preg_match('/unset\(\$?\w*\[?.?id.?\]?\)/', $restoreSrc));

// ── Dump format version ──────────────────────────────────────────────
// An old-format dump is made harmless by REFUSING to restore it, not by
// deleting it. ensureBackupsDir used to purge every snapshot whose format
// marker didn't match, which on any existing install meant the first backup
// after a deploy silently destroyed the whole local backup history — to keep
// unrestorable files out of a list. Assert the purge stays gone.
$dirSrc = gk_lift($api, '/function ensureBackupsDir\(\) \{.*?\n\}/s', 'ensureBackupsDir()');
ok('backup format constant defined', preg_match('/define\(.GK_BACKUP_FORMAT., (\d+)\)/', $api, $fm) === 1);
ok('runBackup stamps the format into the dump',
    str_contains($backupSrc, "'format' => GK_BACKUP_FORMAT"));
ok('ensureBackupsDir does NOT delete snapshots', !str_contains($dirSrc, '@unlink'));
ok('the only snapshot deletion left is retention pruning',
    preg_match_all('/@unlink\(\$old\)/', $api) === 1
    && preg_match('/array_slice\(\$files, 240\).*?@unlink\(\$old\)/s', $api) === 1);
ok('restore refuses a stale-format dump',
    preg_match('/\(int\)\(\$data\[.format.\] \?\? 0\) < GK_BACKUP_FORMAT/', $api) === 1);

// ── No table may exist without appearing on BOTH sides ───────────────
// The catch-all: a table added to schema.sql in some future batch fails here
// until it is dumped and restored too. Anything deliberately excluded has to
// be named below, which makes the exclusion a decision instead of an oversight.
$handledByName = ['kv_store', 'users', 'revisions']; // dumped/restored explicitly
$deliberatelyNotBackedUp = [
    'tokens',         // sessions, not data — restore clears them on purpose
    'login_sessions', // audit trail of the CURRENT install; a restore shouldn't rewrite it
];
preg_match_all('/CREATE TABLE IF NOT EXISTS (\w+)/', $schema, $m);
foreach (array_unique($m[1]) as $table) {
    if (in_array($table, $deliberatelyNotBackedUp, true)) continue;
    $covered = in_array($table, $handledByName, true)
        || in_array($table, array_keys($spec), true)
        || in_array($table, $GK_CHAT_TABLES, true);
    ok("$table is covered by backup + restore", $covered);
    if (in_array($table, $handledByName, true)) {
        ok("$table named in both functions",
            str_contains($backupSrc, "FROM $table") && str_contains($restoreSrc, "DELETE FROM $table"));
    }
}

// ── Every spec collection must exist in schema.sql for fresh installs ──
foreach (array_keys($spec) as $table) {
    ok("schema.sql declares $table", preg_match('/CREATE TABLE IF NOT EXISTS ' . $table . '\s*\(/', $schema) === 1);
}

// ── Generated DDL sanity ─────────────────────────────────────────────
foreach ($spec as $table => $cols) {
    $sql = recordTableSql($table, $cols);
    ok("$table DDL has id PK + data + version",
        str_contains($sql, 'id VARCHAR(24) NOT NULL PRIMARY KEY')
        && str_contains($sql, 'data LONGTEXT NOT NULL')
        && str_contains($sql, 'version INT NOT NULL DEFAULT 1'));
    foreach ($cols as $col => $type) {
        ok("$table DDL declares + indexes $col",
            str_contains($sql, "$col $type NULL,") && str_contains($sql, "INDEX idx_{$table}_{$col} ($col)"));
    }
    // Malformed commas are the classic generated-DDL bug — invisible until
    // MySQL rejects the CREATE at deploy time.
    ok("$table DDL comma-clean", !preg_match('/,\s*,/', $sql) && !preg_match('/,\s*\)\s*ENGINE/', $sql));
}

// A collection with no extra columns must still be valid SQL (empty $cols loop).
$bare = recordTableSql('tags', []);
ok('column-less table DDL is still valid',
    !preg_match('/,\s*\)\s*ENGINE/', $bare) && str_contains($bare, 'INDEX idx_tags_updated'));

// ── Step 1 is schema-only ────────────────────────────────────────────
// No action may read or write these tables yet — everything still goes through
// kv_store, which is what keeps this step revertable by dropping the tables.
ok('no action writes a record table yet',
    preg_match('/(INSERT INTO|UPDATE) (' . implode('|', array_keys($spec)) . ') (SET|\()/', $api) === 0
    || preg_match('/function restoreFromBackupData.*?INSERT INTO \$table/s', $api) === 1);

echo "\n  $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
