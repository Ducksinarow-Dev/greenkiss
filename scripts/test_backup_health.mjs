/**
 * backupHealth() checks — the admin dashboard backup warning.
 *
 *   node scripts/test_backup_health.mjs
 *
 * Standalone (no test framework, matching the groupBackupsByYearMonth
 * precedent in #35): globals.js can't be imported here because it pulls in
 * browser globals, so the function is lifted out of the source by name. That
 * keeps ONE source of truth — the logic asserted below is the logic that ships.
 *
 * Why this exists: a backup system that silently stopped is indistinguishable
 * from one that works until the day you need it. The case that matters most is
 * "off-site succeeded once, then stopped" — credentials fine, cron dead — which
 * no credential check would ever catch.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/globals.js'), 'utf8');

// Lift the constant + function out of globals.js and evaluate just those.
const lift = (re, what) => {
  const m = src.match(re);
  if (!m) { console.error(`  FAIL could not find ${what} in globals.js`); process.exit(1); }
  return m[0];
};
const code = [
  lift(/const BACKUP_STALE_HOURS = \d+;/, 'BACKUP_STALE_HOURS'),
  lift(/function backupHealth\([\s\S]*?\n\}/, 'backupHealth()'),
  'return { backupHealth, BACKUP_STALE_HOURS };',
].join('\n');
const { backupHealth } = new Function(code)();

let pass = 0, fail = 0;
const ok = (label, cond) => {
  if (cond) { console.log(`  PASS ${label}`); pass++; }
  else { console.log(`  FAIL ${label}`); fail++; }
};

const NOW = Date.parse('2026-08-17T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const snap = (h) => [{ file: 'gk_x.json.gz', createdAt: hoursAgo(h), sizeMB: 0.1 }];

// ── Healthy ───────────────────────────────────────────────────────────
const good = backupHealth({ snapshots: undefined, backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(3) } }, NOW);
ok('healthy => ok, no problems', good.level === 'ok' && good.problems.length === 0);

// ── The case this feature exists for: worked once, then stopped ────────
const deadCron = backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(72) } }, NOW);
ok('off-site stopped 72h ago => bad', deadCron.level === 'bad');
ok('off-site stopped names the cron', /cron/i.test(deadCron.detail) && /72h/.test(deadCron.detail));

// ── Off-site outright failing ─────────────────────────────────────────
const failed = backupHealth({ backups: snap(1), offsite: { configured: true, ok: false, error: 'B2 auth returned HTTP 401 — bad_auth_token' } }, NOW);
ok('off-site failure => bad', failed.level === 'bad');
ok("off-site failure surfaces B2's own error text", failed.detail.includes('bad_auth_token'));

// ── Not configured ────────────────────────────────────────────────────
const unconfigured = backupHealth({ backups: snap(1), offsite: { configured: false } }, NOW);
ok('unconfigured off-site => bad', unconfigured.level === 'bad');
ok('unconfigured says only one copy exists', /only on this server/i.test(unconfigured.detail));

// ── Configured but never run ──────────────────────────────────────────
const neverRan = backupHealth({ backups: snap(1), offsite: { configured: true, ok: null } }, NOW);
ok('configured but never run => warn (not bad)', neverRan.level === 'warn');

// ── Local snapshots ───────────────────────────────────────────────────
const noBackups = backupHealth({ backups: [], offsite: { configured: true, ok: true, at: hoursAgo(1) } }, NOW);
ok('no backups at all => bad', noBackups.level === 'bad');
const staleLocal = backupHealth({ backups: snap(50), offsite: { configured: true, ok: true, at: hoursAgo(1) } }, NOW);
ok('stale local snapshot => warn', staleLocal.level === 'warn' && /50h/.test(staleLocal.detail));
// A quiet weekend is NOT a failure: maybeAutoBackup piggybacks on writes, so
// 20h with no snapshot is normal and must stay silent.
const quiet = backupHealth({ backups: snap(20), offsite: { configured: true, ok: true, at: hoursAgo(20) } }, NOW);
ok('20h quiet period stays silent (no false alarm)', quiet.level === 'ok');

// ── Robustness: junk/missing data must not crash or false-alarm ───────
ok('empty payload does not throw', (() => { try { backupHealth({}, NOW); return true; } catch { return false; } })());
ok('no-arg call does not throw', (() => { try { backupHealth(undefined, NOW); return true; } catch { return false; } })());
const badDate = backupHealth({ backups: [{ createdAt: 'not-a-date' }], offsite: { configured: true, ok: true, at: 'garbage' } }, NOW);
ok('unreadable dates => warn, not a crash or silence', badDate.level === 'warn');

// ── Uploads mirror (the image library) ────────────────────────────────
const upOk = { configured: true, ok: true, at: hoursAgo(1), uploaded: 3, pending: 0 };
ok('healthy mirror stays silent',
  backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(2) }, uploads: upOk }, NOW).level === 'ok');
const upFail = backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(2) }, uploads: { configured: true, ok: false, error: 'B2 auth returned HTTP 401 — bad_auth_token' } }, NOW);
ok('failing mirror => bad', upFail.level === 'bad');
ok('failing mirror surfaces the real error', upFail.detail.includes('bad_auth_token'));
const upPending = backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(2) }, uploads: { configured: true, ok: true, at: hoursAgo(1), pending: 12 } }, NOW);
ok('backlog => warn, not bad (the cap drains it)', upPending.level === 'warn' && /12 images/.test(upPending.detail));
ok('one pending image reads singular',
  /1 image /.test(backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(2) }, uploads: { configured: true, ok: true, at: hoursAgo(1), pending: 1 } }, NOW).detail));
// With B2 off entirely, "off-site is off" is the one actionable problem —
// repeating it per subsystem would turn it into a wall of red.
const b2Off = backupHealth({ backups: snap(2), offsite: { configured: false }, uploads: { configured: false } }, NOW);
ok('B2 unconfigured reports once, not per subsystem', b2Off.problems.length === 1);
// Missing uploads status (an older server, or before the first mirror run)
// must not invent a problem.
ok('absent uploads status is silent',
  backupHealth({ backups: snap(2), offsite: { configured: true, ok: true, at: hoursAgo(2) } }, NOW).level === 'ok');

// ── Severity ordering: a hard failure must not be downgraded by a warn ─
const both = backupHealth({ backups: snap(50), offsite: { configured: true, ok: false, error: 'x' } }, NOW);
ok('bad wins over warn', both.level === 'bad' && both.problems.length === 2);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
