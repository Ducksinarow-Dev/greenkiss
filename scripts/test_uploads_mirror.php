<?php
/**
 * uploadsPending() checks — the image-library mirror (#42a).
 *
 *   php scripts/test_uploads_mirror.php
 *
 * Runs against a real temp directory but needs NO B2 credentials and no
 * network: the file walk, the manifest filter and the per-run cap are the parts
 * that decide what gets sent, and they're the parts that can silently skip a
 * file forever. The upload call itself is offsiteUpload(), already exercised by
 * the off-site assertions in test_backup_restore.sh.
 */
$root = dirname(__DIR__);
$api = file_get_contents("$root/api.php");

$pass = 0; $fail = 0;
function ok($label, $cond) {
    global $pass, $fail;
    if ($cond) { echo "  PASS $label\n"; $pass++; } else { echo "  FAIL $label\n"; $fail++; }
}
function lift($src, $pattern, $what) {
    if (!preg_match($pattern, $src, $m)) { echo "  FAIL could not find $what in api.php\n"; exit(1); }
    return $m[0];
}
// GK_UPLOADS_SYNC_CAP is the default arg, so it must exist before the function.
eval(lift($api, "/define\('GK_UPLOADS_SYNC_CAP', \d+\);/", 'GK_UPLOADS_SYNC_CAP'));
eval(lift($api, '/function uploadsPending\(.*?\n\}/s', 'uploadsPending()'));

$tmp = sys_get_temp_dir() . '/gk_uploads_test_' . getmypid();
@mkdir("$tmp/2026-07", 0777, true);
@mkdir("$tmp/2026-08", 0777, true);
file_put_contents("$tmp/2026-07/rose.jpg", 'a');
file_put_contents("$tmp/2026-08/lavender.png", 'b');
file_put_contents("$tmp/2026-08/clay mask.jpg", 'c'); // spaces are legal in uploads
file_put_contents("$tmp/.htaccess", 'php_flag engine off');
register_shutdown_function(function () use ($tmp) {
    foreach (['2026-07/rose.jpg','2026-08/lavender.png','2026-08/clay mask.jpg','.htaccess'] as $f) @unlink("$tmp/$f");
    @rmdir("$tmp/2026-07"); @rmdir("$tmp/2026-08"); @rmdir($tmp);
});

// ── The walk ──────────────────────────────────────────────────────────
$all = uploadsPending($tmp, []);
ok('finds files in month subfolders', in_array('2026-07/rose.jpg', $all, true) && in_array('2026-08/lavender.png', $all, true));
ok('returns paths RELATIVE to the uploads root', !in_array($tmp . '/2026-07/rose.jpg', $all, true));
ok('keeps filenames containing spaces', in_array('2026-08/clay mask.jpg', $all, true));
// .htaccess is written by ensureUploadsDir on any server; mirroring it would
// restore a config file over one the new host already made correctly.
ok('skips .htaccess', !in_array('.htaccess', $all, true));
ok('found exactly the three real files', count($all) === 3);

// ── The manifest filter — the bit that makes this a mirror, not a re-upload
$some = uploadsPending($tmp, ['2026-07/rose.jpg' => 0]);
ok('skips files already sent', !in_array('2026-07/rose.jpg', $some, true) && count($some) === 2);
$none = uploadsPending($tmp, array_flip($all));
ok('nothing pending once everything is sent', $none === []);
// A stale manifest naming a deleted file must not break the walk.
$ghost = uploadsPending($tmp, ['2020-01/gone.jpg' => 0]);
ok('manifest entries for missing files are harmless', count($ghost) === 3);

// ── The cap ───────────────────────────────────────────────────────────
$capped = uploadsPending($tmp, [], 2);
ok('cap limits one run', count($capped) === 2);
ok('capped run is deterministic (sorted), so a backlog drains', $capped === array_slice($all, 0, 2));
// Draining across runs must reach the end rather than looping on the same files.
$drained = array_merge($capped, uploadsPending($tmp, array_flip($capped), 2));
sort($drained);
ok('two capped runs cover everything', $drained === $all);

// ── Edge cases ────────────────────────────────────────────────────────
ok('missing uploads dir is not an error', uploadsPending($tmp . '/nope', []) === []);
@mkdir("$tmp/empty", 0777, true);
ok('empty subfolder yields nothing', !in_array('empty', uploadsPending($tmp, []), true));
@rmdir("$tmp/empty");

// ── Wiring ────────────────────────────────────────────────────────────
ok('uploadsSync never throws into the caller', preg_match('/function uploadsSync.*?catch \(Throwable/s', $api) === 1);
ok('manifest is appended per file, not once at the end',
    preg_match('/file_put_contents\(uploadsManifestPath\(\).*?FILE_APPEND/s', $api) === 1);
ok('backup_run mirrors uploads', str_contains($api, "'uploads' => uploadsSync(\$pdo)"));
ok('backup_list reports mirror status', preg_match("/'uploads' => offsiteConfigured\(\)/", $api) === 1);
ok('remote name keeps its path separators',
    str_contains($api, "implode('/', array_map('rawurlencode', explode('/', \$prefix . (\$remoteName ?? basename(\$path)))))"));
// Bound to maybeAutoBackup's OWN body: an unbounded `/function maybeAutoBackup
// .*?uploadsSync/s` matches the next uploadsSync anywhere later in the file and
// so can never pass, no matter what the function does.
$autoSrc = lift($api, '/function maybeAutoBackup\(\$pdo\) \{.*?\n\}/s', 'maybeAutoBackup()');
ok('uploads are NOT wired into maybeAutoBackup', !str_contains($autoSrc, 'uploadsSync'));
ok('nor is the off-site DB copy', !str_contains($autoSrc, 'offsiteSync'));

echo "\n  $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
