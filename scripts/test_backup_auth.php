<?php
/**
 * backup_run cron-key auth checks. DB-FREE (php only, no mysql, no HTTP).
 *
 *   php scripts/test_backup_auth.php
 *
 * Why this exists: every possible cron misconfiguration used to return the same
 * bare "login required" — a typo, a stray space, an unencoded character and an
 * untouched PASTE_ placeholder were indistinguishable, with nothing to act on.
 * A backup cron that silently never authenticates is exactly the failure this
 * whole area is meant to prevent, so the four outcomes are pinned down here.
 */
$root = dirname(__DIR__);
$api = file_get_contents("$root/api.php");

$pass = 0; $fail = 0;
function ok($label, $cond) {
    global $pass, $fail;
    if ($cond) { echo "  PASS $label\n"; $pass++; } else { echo "  FAIL $label\n"; $fail++; }
}

// api.php can't be require'd (it would connect to a DB and serve a request), so
// lift just the pure helpers. One source of truth: what's asserted is what runs.
function lift($src, $pattern, $what) {
    if (!preg_match($pattern, $src, $m)) { echo "  FAIL could not find $what in api.php\n"; exit(1); }
    return $m[0];
}
eval(lift($api, '/function cronKeyVerdict\(.*?\n\}/s', 'cronKeyVerdict()'));
eval(lift($api, '/function cronKeyHint\(.*?\n\}/s', 'cronKeyHint()'));

$KEY = 'k7Qm2xR9vLpT4wY8nZbF3sH6jD1aC5gE';

// ── The happy path ────────────────────────────────────────────────────
ok('matching key accepted', cronKeyVerdict($KEY, $KEY) === 'accept');

// ── No key at all: must fall back to admin auth, NOT a 403 ────────────
// The admin "Back up now" button hits this same action with a token instead.
ok('no key -> fall back to admin auth', cronKeyVerdict('', $KEY) === 'no_key');
ok('null key -> fall back to admin auth', cronKeyVerdict(null, $KEY) === 'no_key');
ok('whitespace-only key -> fall back', cronKeyVerdict('   ', $KEY) === 'no_key');

// ── Wrong key ─────────────────────────────────────────────────────────
ok('wrong key rejected', cronKeyVerdict('nope', $KEY) === 'reject_mismatch');
ok('key is case-sensitive', cronKeyVerdict(strtolower($KEY), $KEY) === 'reject_mismatch');
ok('truncated key rejected', cronKeyVerdict(substr($KEY, 0, -1), $KEY) === 'reject_mismatch');
ok('prefix of key rejected (no partial match)', cronKeyVerdict('k7Qm', $KEY) === 'reject_mismatch');

// ── The literal placeholder from the docs — the mistake most likely to
//    be made when copy-pasting the cron command out of DEPLOY.md ───────
ok('literal YOUR_CRON_KEY rejected', cronKeyVerdict('YOUR_CRON_KEY', $KEY) === 'reject_mismatch');

// ── config.php not actually configured ────────────────────────────────
ok('unset CRON_KEY -> unconfigured', cronKeyVerdict($KEY, null) === 'reject_unconfigured');
ok('empty CRON_KEY -> unconfigured', cronKeyVerdict($KEY, '') === 'reject_unconfigured');
ok('untouched PASTE_ placeholder -> unconfigured',
    cronKeyVerdict($KEY, 'PASTE_A_LONG_RANDOM_STRING_HERE') === 'reject_unconfigured');
// A key that merely CONTAINS "PASTE_" later in the string is a real key.
ok('PASTE_ only rejected as a prefix', cronKeyVerdict('abcPASTE_x', 'abcPASTE_x') === 'accept');

// ── Whitespace tolerance: the cPanel File Manager paste problem ───────
// A trailing newline in config.php (or a space in the cron URL) must not
// silently break the nightly backup for months.
ok('trailing newline in config tolerated', cronKeyVerdict($KEY, $KEY . "\n") === 'accept');
ok('trailing space in config tolerated', cronKeyVerdict($KEY, $KEY . ' ') === 'accept');
ok('leading space in config tolerated', cronKeyVerdict($KEY, ' ' . $KEY) === 'accept');
ok('spaces around supplied key tolerated', cronKeyVerdict(" $KEY ", $KEY) === 'accept');

// ── The hint must be actionable and must never leak the key ───────────
$mismatchHint = cronKeyHint($KEY);
ok('mismatch hint never contains the key', strpos($mismatchHint, $KEY) === false);
ok('mismatch hint names the likely causes',
    stripos($mismatchHint, 'typo') !== false && stripos($mismatchHint, 'space') !== false
    && strpos($mismatchHint, 'YOUR_CRON_KEY') !== false && stripos($mismatchHint, 'encod') !== false);
$unconfHint = cronKeyHint(null);
ok('unconfigured hint points at config.php',
    stripos($unconfHint, 'config.php') !== false && stripos($unconfHint, 'PASTE_') !== false);
ok('placeholder gets the unconfigured hint, not the mismatch one',
    cronKeyHint('PASTE_A_LONG_RANDOM_STRING_HERE') === $unconfHint);

// ── The action must wire the verdicts up correctly ────────────────────
// Bound to the NEXT case label, not the first `break;` — the inner switch's
// `case 'accept': break;` would otherwise cut the extract short and make the
// assertions below silently vacuous.
$case = lift($api, "/case 'backup_run':.*?case 'backup_list':/s", "backup_run case");
ok('no_key branch still requires admin auth',
    preg_match("/case 'no_key':\s*\\\$user = requireAuth/s", $case) === 1
    && strpos($case, "requireRole(\$user, ['admin'])") !== false);
ok('rejected key responds 403 with the hint',
    strpos($case, 'respond(403') !== false && strpos($case, 'cronKeyHint(') !== false);
ok('accept branch does not require auth',
    preg_match("/case 'accept':\s*break;/s", $case) === 1);

// ── B2 credentials are trimmed at the point of use ───────────────────
ok('B2 auth sends trimmed credentials', strpos($api, "implode(':', b2Credentials())") !== false);
ok('offsiteConfigured trims before checking', preg_match('/function offsiteConfigured.*?trim\(/s', $api) === 1);

echo "\n  $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
