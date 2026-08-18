/**
 * Per-day sales target overrides (#31) + GBP post text (#34).
 *
 *   node scripts/test_store_targets.mjs
 *
 * Both are money/copy-facing: a wrong daily target makes staff think they're
 * behind when they aren't, and a dropped CTA link means a public post goes out
 * without its link. Pure logic lifted from source so what's asserted ships.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lift = (file, re, what) => {
  const m = readFileSync(join(root, file), 'utf8').match(re);
  if (!m) { console.error(`  FAIL could not find ${what}`); process.exit(1); }
  return m[0];
};
let pass = 0, fail = 0;
const ok = (l, c) => { if (c) { console.log(`  PASS ${l}`); pass++; } else { console.log(`  FAIL ${l}`); fail++; } };

// ── #31 dayTargetFor ──────────────────────────────────────────────────
const { dayTargetFor } = new Function(
  lift('src/globals.js', /function dayTargetFor\([\s\S]*?\n\}/, 'dayTargetFor') +
  '\nreturn { dayTargetFor };')();

const targets = { 9: 30000 };               // September: 30,000 over 30 days
const overrides = { '2026-09-12': 4000 };   // market day

ok('ordinary day = monthly / days in month',
  dayTargetFor('2026-09-05', targets, overrides).target === 1000);
ok('ordinary day is not flagged as overridden',
  dayTargetFor('2026-09-05', targets, overrides).overridden === false);
ok('override wins for its date', dayTargetFor('2026-09-12', targets, overrides).target === 4000);
ok('override is flagged so the UI can say which basis it used',
  dayTargetFor('2026-09-12', targets, overrides).overridden === true);
ok('override does not leak to the next day',
  dayTargetFor('2026-09-13', targets, overrides).target === 1000);
ok('month with no target yields 0, not NaN',
  dayTargetFor('2026-11-03', targets, overrides).target === 0);
// Month length must come from the actual month, not a fixed 30.
ok('February 2026 (28d) divides by 28',
  dayTargetFor('2026-02-10', { 2: 2800 }, {}).target === 100);
ok('leap February 2028 (29d) divides by 29',
  Math.round(dayTargetFor('2028-02-10', { 2: 2900 }, {}).target) === 100);
ok('31-day month divides by 31',
  dayTargetFor('2026-01-10', { 1: 3100 }, {}).target === 100);
// Junk overrides must fall back rather than zero the gauge out.
ok('zero override ignored', dayTargetFor('2026-09-05', targets, { '2026-09-05': 0 }).target === 1000);
ok('negative override ignored', dayTargetFor('2026-09-05', targets, { '2026-09-05': -50 }).target === 1000);
ok('non-numeric override ignored', dayTargetFor('2026-09-05', targets, { '2026-09-05': 'lots' }).target === 1000);

// ── #30 salesPace ─────────────────────────────────────────────────────
const { salesPace } = new Function(
  lift('src/globals.js', /function dayTargetFor\([\s\S]*?\n\}/, 'dayTargetFor') + '\n' +
  lift('src/globals.js', /function salesPace\([\s\S]*?\n\}/, 'salesPace') +
  '\nreturn { salesPace };')();

// September: 30,000 / 30 days = 1,000 a day. On the 11th, 10 days have
// completed, so 10,000 was expected.
const T = { 9: 30000 };
const p10 = salesPace(12000, '2026-09-11', T, {});
ok('expected = completed days x daily target', p10.expected === 10000);
ok('today is NOT counted (10 completed on the 11th)', p10.days === 10);
ok('ahead reports a positive delta', p10.ahead === true && p10.delta === 2000);
ok('pct is against expected, not the month total', Math.round(p10.pct) === 120);
const behind = salesPace(7000, '2026-09-11', T, {});
ok('behind reports a negative delta', behind.ahead === false && behind.delta === -3000);

// Per-day overrides must raise the bar only for their own day.
const pOv = salesPace(12000, '2026-09-11', T, { '2026-09-03': 5000 });
ok('override raises expected by the difference only', pOv.expected === 10000 - 1000 + 5000);
ok('a market day can flip ahead to behind', pOv.ahead === false);

// Nothing meaningful to say -> null, rather than a misleading zero.
ok('1st of the month => null (no completed days)', salesPace(500, '2026-09-01', T, {}) === null);
ok('no target for the month => null', salesPace(500, '2026-11-11', T, {}) === null);
ok('zero sales still reports (behind), not null', salesPace(0, '2026-09-11', T, {}).delta === -10000);
ok('non-numeric sales treated as 0, not NaN', Number.isFinite(salesPace('x', '2026-09-11', T, {}).delta));
// Month length must come from the real month.
ok('February expected uses 28 days',
  salesPace(0, '2026-02-11', { 2: 2800 }, {}).expected === 1000);

// ── #34 gbpPostText ───────────────────────────────────────────────────
const src34 = lift('src/components/ContentCalendar.jsx', /function gbpPostText\([\s\S]*?\n\}/, 'gbpPostText');
const { gbpPostText } = new Function(`
  const GBP_CTA_TYPES = [{key:'book',label:'Book'},{key:'learn',label:'Learn more'},{key:'',label:'None'}];
  const linkifyMagnets = (t) => (t||'').replace(/gk:product:(\\w+)/g, '@[Rose Serum](product:$1)');
  const parseMentionText = (text) => {
    const out=[]; let last=0; const re=/@\\[([^\\]]+)\\]\\((\\w+):([\\w-]+)\\)/g; let m;
    while ((m = re.exec(text||''))) {
      if (m.index>last) out.push({text:text.slice(last,m.index)});
      out.push({mention:{label:m[1],kind:m[2],id:m[3]}}); last = m.index+m[0].length;
    }
    if (last < (text||'').length) out.push({text:text.slice(last)});
    return out;
  };
  ${src34}
  return { gbpPostText };`)();

ok('body + CTA link joined',
  gbpPostText({ body: 'Fresh stock in', ctaType: 'book', ctaUrl: 'https://x.co' }) === 'Fresh stock in\n\nBook: https://x.co');
ok('no CTA url => body only',
  gbpPostText({ body: 'Fresh stock in', ctaType: 'book', ctaUrl: '' }) === 'Fresh stock in');
ok('no CTA type => body only',
  gbpPostText({ body: 'Fresh stock in', ctaUrl: 'https://x.co' }) === 'Fresh stock in');
ok('empty item => empty string (button can refuse)', gbpPostText({}) === '');
// The point of the feature: a mention must not paste as a raw token, and an
// internal magnet code must never reach a public post.
ok('mention flattened to its label',
  gbpPostText({ body: 'Try @[Rose Serum](product:p1) today' }) === 'Try Rose Serum today');
ok('bare gk: magnet flattened, not pasted raw',
  gbpPostText({ body: 'New: gk:product:p1' }) === 'New: Rose Serum');
ok('surrounding text preserved around a mention',
  gbpPostText({ body: 'a @[Rose Serum](product:p1) b' }) === 'a Rose Serum b');
ok('whitespace-only body with a CTA still emits the link',
  gbpPostText({ body: '   ', ctaType: 'learn', ctaUrl: 'https://y.co' }) === 'Learn more: https://y.co');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
