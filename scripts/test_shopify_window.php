<?php
/**
 * #30 comparison window + #29 revenue rollup. DB-free.
 *
 *   php scripts/test_shopify_window.php
 *
 * The window maths is the part that fails silently: compare the 18th of this
 * month against ALL of last month and every month looks like a collapse. The
 * month-length clamp matters too — the 31st has no counterpart in February,
 * and an unclamped date rolls forward into March instead.
 */
$root = dirname(__DIR__);
$api = file_get_contents("$root/api.php");
$pass = 0; $fail = 0;
function ok($l, $c) { global $pass, $fail; if ($c) { echo "  PASS $l\n"; $pass++; } else { echo "  FAIL $l\n"; $fail++; } }

// Mirrors the window built in shopify_sales. Kept in step by the source
// assertions further down rather than by hope.
function window($nowStr, $tz = 'UTC') {
    $zone = new DateTimeZone($tz);
    $now = new DateTime($nowStr, $zone);
    $monthStart = new DateTime($now->format('Y-m-01 00:00:00'), $zone);
    $lastMonthStart = (clone $monthStart)->modify('first day of last month')->setTime(0, 0, 0);
    $lastMonthDays = (int)$lastMonthStart->format('t');
    $dayOfMonth = min((int)$now->format('j'), $lastMonthDays);
    $lastMonthEnd = (clone $lastMonthStart)
        ->setDate((int)$lastMonthStart->format('Y'), (int)$lastMonthStart->format('n'), $dayOfMonth)
        ->setTime((int)$now->format('H'), (int)$now->format('i'), (int)$now->format('s'));
    return [$lastMonthStart->format('Y-m-d H:i:s'), $lastMonthEnd->format('Y-m-d H:i:s')];
}

[$s, $e] = window('2026-08-18 14:30:00');
ok('last month starts on the 1st', $s === '2026-07-01 00:00:00');
ok('ends the same day-of-month at the same clock time', $e === '2026-07-18 14:30:00');

// 31st -> February: must clamp to the 28th, not roll into March.
[$s2, $e2] = window('2026-03-31 09:00:00');
ok('Mar 31 compares against Feb, not Mar', substr($e2, 0, 7) === '2026-02');
ok('clamped to the last day of a shorter month', $e2 === '2026-02-28 09:00:00');
// Leap year keeps the 29th.
[, $e3] = window('2028-03-30 09:00:00');
ok('leap February keeps the 29th', $e3 === '2028-02-29 09:00:00');
// January -> December of the previous YEAR.
[$s4, $e4] = window('2026-01-10 08:00:00');
ok('January compares against December of last year', $s4 === '2025-12-01 00:00:00' && $e4 === '2025-12-10 08:00:00');
// 1st of the month: a zero-length-ish window, still valid and not negative.
[$s5, $e5] = window('2026-08-01 00:00:00');
ok('1st of month yields a valid ordered window', $s5 <= $e5);

// ── The action must actually use a CLOSED window ──────────────────────
ok('shopifySumSales accepts an upper bound', str_contains($api, 'function shopifySumSales($minIso, $token, $maxIso = null)'));
ok('the bound is sent to Shopify', str_contains($api, "created_at_max="));
ok('omitting it keeps the old open-ended behaviour', str_contains($api, "(\$maxIso ? '&created_at_max=' . rawurlencode(\$maxIso) : '')"));
ok('the comparison call passes both ends',
    preg_match('/shopifySumSales\(\$lastMonthStart->format\(.c.\), \$token, \$lastMonthEnd->format\(.c.\)\)/', $api) === 1);
ok('the response carries the comparison + its label',
    str_contains($api, "'lastMonthToDate' => \$lastMonth") && str_contains($api, "'lastMonthLabel'"));
ok('day-of-month is clamped to the shorter month', str_contains($api, 'min((int)$now->format(\'j\'), $lastMonthDays)'));
// A failed comparison must not 502 the whole gauge set.
ok('only the three live sums can fail the request',
    preg_match('/if \(\$today === null \|\| \$wtd === null \|\| \$mtd === null\) respond\(502/', $api) === 1
    && !preg_match('/\$lastMonth === null.*respond\(502/s', $api));

echo "\n  $pass passed, $fail failed\n";
exit($fail === 0 ? 0 : 1);
