/**
 * #29 — inline Omnisend stats: campaign revenue rollup + bulk refresh.
 *
 *   node scripts/test_email_stats.mjs
 *
 * The risk here is a PARTIAL total presented as a full one: if only two of a
 * campaign's five emails have had stats fetched, the card must not imply the
 * campaign earned that much. And one failing item must never abort the rest.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/globals.js'), 'utf8');
const lift = (re, what) => { const m = src.match(re); if (!m) { console.error(`  FAIL missing ${what}`); process.exit(1); } return m[0]; };
let pass = 0, fail = 0;
const ok = (l, c) => { if (c) { console.log(`  PASS ${l}`); pass++; } else { console.log(`  FAIL ${l}`); fail++; } };

const { campaignEmailRevenue } = new Function(
  lift(/function campaignEmailRevenue\([\s\S]*?\n\}/, 'campaignEmailRevenue') + '\nreturn { campaignEmailRevenue };')();

const items = [
  { id: 'a', campaignId: 'c1', channel: 'email', omnisendStats: { revenue: 120.4 } },
  { id: 'b', campaignId: 'c1', channel: 'email', omnisendStats: { revenue: 80 } },
  { id: 'c', campaignId: 'c1', channel: 'email' },                    // not fetched yet
  { id: 'd', campaignId: 'c1', channel: 'gbp', omnisendStats: { revenue: 999 } }, // not email
  { id: 'e', campaignId: 'c2', channel: 'email', omnisendStats: { revenue: 50 } },
];
const r = campaignEmailRevenue('c1', items);
ok('sums only this campaign', r.revenue === 200.4);
ok('ignores non-email items even if they carry stats', r.revenue !== 1199.4);
ok('counts emails vs those with stats', r.emails === 3 && r.withStats === 2);
ok('flags a partial total', r.partial === true);
const full = campaignEmailRevenue('c2', items);
ok('complete total is not flagged partial', full.partial === false && full.revenue === 50);
const none = campaignEmailRevenue('nope', items);
ok('unknown campaign yields zero, not NaN', none.revenue === 0 && none.withStats === 0);
ok('a campaign with no fetched stats is not rendered as $0 earned',
  campaignEmailRevenue('c3', [{ id: 'x', campaignId: 'c3', channel: 'email' }]).withStats === 0);
// Junk must not poison the sum.
const junk = campaignEmailRevenue('c4', [
  { id: 'y', campaignId: 'c4', channel: 'email', omnisendStats: { revenue: 'lots' } },
  { id: 'z', campaignId: 'c4', channel: 'email', omnisendStats: { revenue: 10 } },
]);
ok('non-numeric revenue skipped, not NaN', junk.revenue === 10 && junk.withStats === 1);

// ── bulk refresh: one failure must not stop the rest ──────────────────
const calls = [];
const store = [
  { id: '1', channel: 'email', omnisendCampaignId: 'o1' },
  { id: '2', channel: 'email', omnisendCampaignId: 'o2' },   // will throw
  { id: '3', channel: 'email', omnisendCampaignId: 'o3' },   // returns null
  { id: '4', channel: 'email' },                             // unlinked, skipped entirely
  { id: '5', channel: 'gbp', omnisendCampaignId: 'o5' },     // not email
];
const updates = [];
const { refreshAllOmnisendStats } = new Function(`
  const getContentItems = () => ${JSON.stringify(store)};
  const updateContentItem = (id, ch) => globalThis.__u.push([id, ch]);
  const fetchOmnisendCampaignStats = null;
  ${lift(/async function refreshAllOmnisendStats\([\s\S]*?\n\}/, 'refreshAllOmnisendStats')}
  return { refreshAllOmnisendStats };`)();
globalThis.__u = updates;
const fake = async (id) => {
  calls.push(id);
  if (id === 'o2') throw new Error('rate limited');
  if (id === 'o3') return null;
  return { opens: 5, clicks: 2, revenue: 30 };
};
const res = await refreshAllOmnisendStats(fake);
ok('only linked EMAIL items are fetched', calls.join(',') === 'o1,o2,o3');
ok('one failure does not abort the rest', res.updated === 1 && res.failed === 1 && res.skipped === 1);
ok('a null result is skipped, not written as zeros', updates.length === 1 && updates[0][0] === '1');
ok('stamps fetchedAt so staleness is visible', !!updates[0][1].omnisendStats.fetchedAt);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
