<?php
/**
 * #41 step 2 — copy kv_store collections into the per-record tables.
 *
 *   php scripts/migrate_kv_to_rows.php --self-test        # DB-free logic check
 *   php scripts/migrate_kv_to_rows.php --dry-run          # report, write nothing
 *   php scripts/migrate_kv_to_rows.php tasks              # migrate one collection
 *   php scripts/migrate_kv_to_rows.php all                # migrate every collection
 *
 * SAFE TO RUN TWICE. Rows are upserted by id, so a second run overwrites with
 * the same values instead of duplicating. Re-runnable matters because this is
 * how a half-finished migration gets finished after a failure.
 *
 * kv_store IS NEVER TOUCHED. It stays the rollback: while a collection lives in
 * both places, dropping the row table returns the app to exactly its old state.
 * Deleting the kv rows is the LAST step of #41, long after every action reads
 * rows — not this script's job.
 *
 * Run it from the server (it needs config.php for DB credentials), e.g. over
 * SSH or via cPanel's Terminal. It prints a per-collection count and exits
 * non-zero on failure so it's safe to chain.
 */

$root = dirname(__DIR__);
$argvv = $argv ?? [];
$dryRun = in_array('--dry-run', $argvv, true);
$selfTest = in_array('--self-test', $argvv, true);
$target = null;
foreach (array_slice($argvv, 1) as $a) {
    if (strncmp($a, '--', 2) !== 0) { $target = $a; break; }
}

/* ── Shared logic ─────────────────────────────────────────────────────
 * recordRow()/recordFieldForColumn() are LIFTED FROM api.php rather than
 * restated here. They used to be a second copy, which meant the migration and
 * the live write path could drift into building the same row two different
 * ways — the migration would then quietly write rows that no longer matched
 * what the app produces. api.php can't be require'd (it would connect to a DB
 * and serve a request), so the functions are extracted and eval'd.
 */
$apiSrcForFns = file_get_contents("$root/api.php");
function gk_lift_fn($src, $pattern, $what) {
    if (!preg_match($pattern, $src, $m)) {
        fwrite(STDERR, "Could not find $what in api.php\n");
        exit(1);
    }
    return $m[0];
}
eval(gk_lift_fn($apiSrcForFns, '/function recordFieldForColumn\(.*?\n\}/s', 'recordFieldForColumn()'));
eval(gk_lift_fn($apiSrcForFns, '/function recordRow\(.*?\n\}/s', 'recordRow()'));

// Names kept so the rest of this script (and its self-test) reads unchanged.
function gkFieldForColumn($col) { return recordFieldForColumn($col); }
function gkRecordRow(array $record, array $cols) { return recordRow($record, $cols); }

/* ── Self-test: the transformation logic, no DB needed ────────────────── */

if ($selfTest) {
    $pass = 0; $fail = 0;
    $ok = function ($label, $cond) use (&$pass, &$fail) {
        if ($cond) { echo "  PASS $label\n"; $pass++; } else { echo "  FAIL $label\n"; $fail++; }
    };

    $ok('snake_case -> camelCase', gkFieldForColumn('due_date') === 'dueDate'
        && gkFieldForColumn('project_id') === 'projectId'
        && gkFieldForColumn('publish_date') === 'publishDate'
        && gkFieldForColumn('doc_id') === 'docId'
        && gkFieldForColumn('status') === 'status');

    $cols = ['status' => 'VARCHAR(24)', 'due_date' => 'DATE', 'project_id' => 'VARCHAR(24)'];
    $row = gkRecordRow([
        'id' => 'abc1234', 'title' => 'Order stock', 'status' => 'todo',
        'dueDate' => '2026-08-25', 'projectId' => 'p1', 'subTasks' => [['text' => 'x']],
    ], $cols);
    $ok('id/columns copied', $row['id'] === 'abc1234' && $row['status'] === 'todo'
        && $row['due_date'] === '2026-08-25' && $row['project_id'] === 'p1');
    $ok('version starts at 1', $row['version'] === 1);
    $ok('data is lossless', json_decode($row['data'], true)['subTasks'][0]['text'] === 'x'
        && json_decode($row['data'], true)['title'] === 'Order stock');

    // The bug this guards: "" into a DATE column.
    $blank = gkRecordRow(['id' => 'x', 'dueDate' => '', 'status' => ''], $cols);
    $ok('empty date -> NULL (not 0000-00-00)', $blank['due_date'] === null);
    $ok('empty string column -> NULL', $blank['status'] === null);
    $missing = gkRecordRow(['id' => 'y'], $cols);
    $ok('missing field -> NULL', $missing['due_date'] === null && $missing['project_id'] === null);
    $iso = gkRecordRow(['id' => 'z', 'dueDate' => '2026-08-25T14:30:00Z'], $cols);
    $ok('ISO timestamp trimmed to date', $iso['due_date'] === '2026-08-25');
    $junk = gkRecordRow(['id' => 'j', 'dueDate' => 'next tuesday'], $cols);
    $ok('unparseable date -> NULL', $junk['due_date'] === null);
    $arr = gkRecordRow(['id' => 'a', 'status' => ['weird']], $cols);
    $ok('array in a scalar column -> NULL', $arr['status'] === null);
    // Unicode must survive the round trip (staff type accented product names).
    $uni = gkRecordRow(['id' => 'u', 'title' => 'Crème Ancienne — 100% Pure'], []);
    $ok('unicode preserved', json_decode($uni['data'], true)['title'] === 'Crème Ancienne — 100% Pure');

    echo "\n  $pass passed, $fail failed\n";
    exit($fail === 0 ? 0 : 1);
}

/* ── Real migration (needs config.php + the DB) ───────────────────────── */

if (!file_exists("$root/config.php")) {
    fwrite(STDERR, "config.php not found — run this on the server (it needs DB credentials).\n");
    fwrite(STDERR, "To check the transformation logic without a database: --self-test\n");
    exit(1);
}
require "$root/config.php";

// Lift the table spec out of api.php rather than restating it: one source of
// truth, so a collection added there is picked up here automatically. (api.php
// can't be require'd — it would try to serve an HTTP request.)
$apiSrc = file_get_contents("$root/api.php");
if (!preg_match('/\$GK_RECORD_TABLES = \[.*?\n\];/s', $apiSrc, $m)) {
    fwrite(STDERR, "Could not find \$GK_RECORD_TABLES in api.php.\n");
    exit(1);
}
eval($m[0]);
if (!preg_match('/function recordTableSql\(.*?\n\}/s', $apiSrc, $m2)) {
    fwrite(STDERR, "Could not find recordTableSql() in api.php.\n");
    exit(1);
}
eval($m2[0]);

try {
    $pdo = new PDO(
        'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4',
        DB_USER, DB_PASS,
        [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]
    );
} catch (Exception $e) {
    fwrite(STDERR, "Database connection failed: " . $e->getMessage() . "\n");
    exit(1);
}

$tables = $GK_RECORD_TABLES;
if ($target !== null && $target !== 'all') {
    if (!isset($tables[$target])) {
        fwrite(STDERR, "Unknown collection '$target'. Known: " . implode(', ', array_keys($tables)) . ", all\n");
        exit(1);
    }
    $tables = [$target => $tables[$target]];
} elseif ($target === null) {
    fwrite(STDERR, "Usage: php scripts/migrate_kv_to_rows.php [all|" . implode('|', array_keys($GK_RECORD_TABLES)) . "] [--dry-run]\n");
    fwrite(STDERR, "       php scripts/migrate_kv_to_rows.php --self-test\n");
    exit(1);
}

echo ($dryRun ? "DRY RUN — nothing will be written\n" : "Migrating kv_store -> row tables\n");
echo "kv_store is left untouched (it stays the rollback).\n\n";

$totalRows = 0;
$totalSkipped = 0;
foreach ($tables as $table => $cols) {
    // The table may not exist yet if api.php hasn't served a request since
    // deploy (ensureRecordTables runs lazily), so create it the same way.
    if (!$dryRun) $pdo->exec(recordTableSql($table, $cols));

    $stmt = $pdo->prepare("SELECT v FROM kv_store WHERE k = ? LIMIT 1");
    $stmt->execute([$table]);
    $r = $stmt->fetch();
    $list = ($r && $r['v'] !== null) ? json_decode($r['v'], true) : [];
    if (!is_array($list)) $list = [];

    $written = 0;
    $skipped = 0;
    foreach ($list as $record) {
        // A record with no id can't be addressed as a row — report it rather
        // than inventing an id, which would make a re-run duplicate it.
        if (!is_array($record) || ($record['id'] ?? '') === '') { $skipped++; continue; }
        $row = gkRecordRow($record, $cols);
        if (!$dryRun) {
            $names = array_keys($row);
            // Upsert = re-runnable. version is NOT bumped here: a migration
            // copy isn't a user edit, and bumping it on every re-run would
            // invalidate clients' versions for no reason (#40).
            $update = implode(', ', array_map(fn($c) => "$c = VALUES($c)", array_filter($names, fn($c) => $c !== 'id')));
            $sql = "INSERT INTO $table (" . implode(', ', $names) . ")
                    VALUES (" . implode(', ', array_fill(0, count($names), '?')) . ")
                    ON DUPLICATE KEY UPDATE $update";
            $pdo->prepare($sql)->execute(array_values($row));
        }
        $written++;
    }

    $have = 0;
    if (!$dryRun) {
        $have = (int)$pdo->query("SELECT COUNT(*) AS c FROM $table")->fetch()['c'];
    }
    printf("  %-11s kv: %4d  %s: %4d%s\n", $table, count($list),
        $dryRun ? 'would write' : 'rows now', $dryRun ? $written : $have,
        $skipped ? "  ($skipped skipped — no id)" : '');
    $totalRows += $written;
    $totalSkipped += $skipped;
}

echo "\n" . ($dryRun ? "Would migrate" : "Migrated") . " $totalRows record(s)";
echo $totalSkipped ? ", skipped $totalSkipped with no id.\n" : ".\n";
if (!$dryRun) {
    echo "kv_store still holds the originals — nothing is committed to rows-only\n";
    echo "until the API actions are converted (step 3+).\n";
}
exit(0);
