/**
 * Zenkit CSV importer (#64) — parser checks.
 *
 *   node scripts/test_zenkit_import.mjs
 *
 * The import itself is a one-time bulk move of the shop's real lists, so the
 * cost of a parsing bug is silently mangled tasks nobody notices until the
 * original Zenkit list is gone. Pure functions are lifted from the component
 * (which can't be imported here — it pulls in React and browser globals), so
 * what's asserted is what ships.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'src/components/ZenkitImporter.jsx'), 'utf8');
const lift = (re, what) => {
  const m = src.match(re);
  if (!m) { console.error(`  FAIL could not find ${what}`); process.exit(1); }
  return m[0];
};
const code = [
  lift(/function parseCsv\([\s\S]*?\n\}/, 'parseCsv'),
  lift(/function findCol\([\s\S]*?\n\}/, 'findCol'),
  lift(/const TRUEY = .*;/, 'TRUEY'),
  lift(/function toISODate\([\s\S]*?\n\}/, 'toISODate'),
  lift(/function splitSubtasks\([\s\S]*?\n\}/, 'splitSubtasks'),
  lift(/function rowsToTasks\([\s\S]*?\n  return \{ tasks, map, headers \};\n\}/, 'rowsToTasks'),
  'return { parseCsv, rowsToTasks, toISODate, splitSubtasks };',
].join('\n');
const { parseCsv, rowsToTasks, toISODate, splitSubtasks } = new Function(code)();

let pass = 0, fail = 0;
const ok = (l, c) => { if (c) { console.log(`  PASS ${l}`); pass++; } else { console.log(`  FAIL ${l}`); fail++; } };

// A realistic Zenkit To Do export: quoted commas, an escaped quote, CRLF line
// endings, newline-joined checklist items, mixed date formats, a blank row.
const CSV = 'Title,Description,Due Date,Done,Checklist,Priority\r\n'
  + '"Order stock, restock shelves","Call rep, then order",2026-09-01,No,"[ ] Call rep\n[x] Check levels",High\r\n'
  + '"Fix the ""squeaky"" door",,09/15/2026,Yes,,Low\r\n'
  + '\r\n'
  + 'Deep clean tester station,"Multi-line\nnotes here",,true,"Wipe counters;Refill alcohol",\r\n';

const rows = parseCsv(CSV);
ok('blank rows dropped', rows.length === 4); // header + 3 data
ok('quoted comma kept in one field', rows[1][0] === 'Order stock, restock shelves');
ok('escaped "" unescaped to one quote', rows[2][0] === 'Fix the "squeaky" door');
ok('CRLF handled', rows[1][5] === 'High');

const { tasks, map } = rowsToTasks(rows);
ok('three tasks parsed', tasks.length === 3);
ok('columns detected by NAME, not position',
  map.title === 0 && map.desc === 1 && map.due === 2 && map.done === 3 && map.subs === 4 && map.priority === 5);

const [t1, t2, t3] = tasks;
ok('title + description kept', t1.title === 'Order stock, restock shelves' && t1.description === 'Call rep, then order');
ok('ISO date passes through', t1.dueDate === '2026-09-01');
ok('US-style date normalised', t2.dueDate === '2026-09-15');
ok('missing date is empty, not a bogus one', t3.dueDate === '');
ok('priority mapped', t1.priority === 'high' && t2.priority === 'low' && t3.priority === 'medium');
ok('Done=No is not done, Yes/true are', t1.done === false && t2.done === true && t3.done === true);

ok('checklist split with checkbox state',
  t1.subTasks.length === 2 && t1.subTasks[0].text === 'Call rep' && t1.subTasks[0].done === false
  && t1.subTasks[1].text === 'Check levels' && t1.subTasks[1].done === true);
ok('semicolon-joined checklist also splits',
  t3.subTasks.length === 2 && t3.subTasks[0].text === 'Wipe counters');
ok('no checklist => no subtasks', t2.subTasks.length === 0);
ok('embedded newline survives in description', t3.description.includes('\n'));

// ── Degenerate inputs must not throw or invent data ───────────────────
ok('empty file yields nothing', rowsToTasks(parseCsv('')).tasks.length === 0);
ok('header-only file yields nothing', rowsToTasks(parseCsv('Title,Due\n')).tasks.length === 0);
ok('rows with no title are skipped', rowsToTasks(parseCsv('Title,Due\n,2026-01-01\nReal,\n')).tasks.length === 1);
// A file with no recognisable headers must still import: first column as title.
const noHdr = rowsToTasks(parseCsv('Widget A,x\nWidget B,y\n'));
ok('unrecognised headers fall back to first column', noHdr.map.title === 0 && noHdr.tasks.length === 1);
ok('short rows do not crash on missing columns', rowsToTasks(parseCsv('Title,Description,Due\nOnly title\n')).tasks[0].dueDate === '');
ok('garbage date becomes empty', toISODate('sometime next week') === '');
ok('bullet markers stripped from checklist', splitSubtasks('- one\n* two')[0].text === 'one');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
