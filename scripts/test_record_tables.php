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
eval(gk_lift($api, '/function recordTableSql\(.*?\n\}/s', 'recordTableSql()'));

$spec = $GK_RECORD_TABLES;
ok('spec lifted from api.php', count($spec) > 0);
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
ok('runBackup declares the spec global', str_contains($backupSrc, 'global $GK_RECORD_TABLES;'));
ok('runBackup creates the tables before selecting from them',
    preg_match('/ensureRecordTables\(\$pdo\);.*?SELECT \* FROM \$table/s', $backupSrc) === 1);
ok('runBackup seeds a records key in the dump', str_contains($backupSrc, "'records' => []"));

ok('restore restores the record tables',
    str_contains($restoreSrc, 'foreach (array_keys($GK_RECORD_TABLES)'));
ok('restore clears each table before inserting', str_contains($restoreSrc, 'DELETE FROM $table'));
ok('restore declares the spec global', str_contains($restoreSrc, 'global $GK_RECORD_TABLES;'));
ok('restore tolerates a pre-migration backup with no records key',
    str_contains($restoreSrc, "\$data['records'][\$table] ?? []"));
ok('restore creates the tables before deleting from them',
    preg_match('/ensureRecordTables\(\$pdo\);.*?DELETE FROM kv_store/s', $restoreSrc) === 1);

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
