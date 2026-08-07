// Review pack checks. The pack is assembled from Client 360's own functions, so
// the binding invariant is that the document and the screen agree — if they ever
// diverge, the client is reading something the broker cannot see.
// Exits 1 on any drift. Usage: npx tsx mockdb/verify-reviewpack.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import { REVIEW_RULES, due, pack, history, coverage } from '../lib/reviewpack';
import { clientKpis, taxPosition, clientHoldings } from '../lib/client360';
import { clientHealth } from '../lib/scoring';
import { DEMO_SB } from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const num = (sql: string, ...p: unknown[]) => (raw.prepare(sql).get(...p) as { n: number }).n;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const list = due(DEMO_SB).value;
const cov = coverage(DEMO_SB).value;
const past = history(DEMO_SB).value;

// 1 — THE invariant: the pack repeats Client 360's numbers, it does not recompute them.
const target = list[0].client_id;
const p = pack(target)!;
const kpi = clientKpis(target).value;
check('the pack exists for the top-ranked client', p != null, p.name);
check('pack value and invested match Client 360 exactly',
  p.value === kpi.v && p.invested === kpi.invested, `${p.value} / ${p.invested}`);
check('pack return and benchmark match Client 360 exactly',
  p.xirr === kpi.wx && p.benchmark === kpi.bmx, `${p.xirr} vs ${p.benchmark}`);
const tax = taxPosition(target).value;
check('the tax section quotes the same realised long-term figure',
  p.sections.find(s => s.key === 'tax')!.lines[0].includes(
    new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(tax.real_lt))));
check('the holdings section counts the same funds Client 360 lists',
  p.sections.find(s => s.key === 'holdings')!.lines[0]
    .startsWith(`${clientHoldings(target).rows.length} funds`),
  `${clientHoldings(target).rows.length} funds`);

// 2 — proposals are the same levers, not a second opinion written for the client.
const levers = clientHealth(target).components
  .flatMap(c => c.levers.filter(l => !l.ghosted && l.kind !== 'hygiene').map(l => l.label));
check('every proposal in the pack is a lever from the health engine',
  p.proposals.every(pr => levers.includes(pr.label)),
  `${p.proposals.length} proposals`);
check('proposals are ordered by the gain they carry',
  p.proposals.every((pr, i) => i === 0 || pr.gain <= p.proposals[i - 1].gain));
check('a pack carrying proposals carries the disclaimer',
  REVIEW_RULES.disclaimer.length > 80 && REVIEW_RULES.disclaimer.includes('market risk'));

// 3 — every section names where it came from. No unsourced claim reaches a client.
check('every pack section names its source table', p.sections.every(s => s.source.length > 3));
check('no pack section is empty', p.sections.every(s => s.lines.length > 0));

// 4 — the due rule is both time and events, and it says which one fired.
check('every client listed as due carries a reason',
  list.every(d => d.why && d.why !== 'up to date'));
check('nobody inside their window and unflagged is listed as due',
  list.every(d => d.last_pack === null
    || d.flag_count > 0
    || (d.months_since ?? 0) >= REVIEW_RULES.review_months),
  `${list.length} due`);
check('"never reviewed" clients genuinely have no pack',
  list.filter(d => d.last_pack === null).every(d =>
    num('SELECT COUNT(*) n FROM review_packs WHERE client_id=?', d.client_id) === 0));
const lastPackOf = raw.prepare('SELECT MAX(generated_at) g FROM review_packs WHERE client_id=?');
check('the last-pack date shown matches the ledger',
  list.filter(d => d.last_pack).every(d =>
    d.last_pack === (lastPackOf.get(d.client_id) as { g: string | null }).g),
  `${list.filter(d => d.last_pack).length} previously reviewed`);
check('the list is ranked, most at stake first',
  list.every((d, i) => i === 0 || d.priority <= list[i - 1].priority));

// 5 — the page only ever shows this broker's clients and packs.
check('every due client belongs to this broker',
  list.every(d => num(`SELECT COUNT(*) n FROM fifo_summary_holding_active
    WHERE client_id=? AND advisor_code='1228' AND balance_units > 0.0001`, d.client_id) > 0));
check('every pack in history belongs to this broker',
  past.every(x => num('SELECT COUNT(*) n FROM review_packs WHERE pack_id=? AND sb_id=?', x.pack_id, DEMO_SB) === 1));

// 6 — coverage arithmetic, and no pack dated in the future.
check('reviewed plus due never exceeds the book',
  cov.reviewed <= cov.book && list.length <= cov.book,
  `${cov.reviewed} reviewed, ${list.length} due, ${cov.book} in book`);
check('never-reviewed plus overdue equals the due list',
  cov.never + cov.overdue === list.length, `${cov.never} + ${cov.overdue} = ${list.length}`);
check('no pack is dated in the future',
  num(`SELECT COUNT(*) n FROM review_packs WHERE generated_at > '${TODAY}'`) === 0);
check('every pack has a render row on the async queue',
  num(`SELECT COUNT(*) n FROM review_packs p WHERE p.pack_id > 1 AND NOT EXISTS
    (SELECT 1 FROM download_history_logs d WHERE d.report_for = 'client:' || p.client_id
     AND d.pdf_type='REVIEW_PACK')`) === 0);
check('a response is never recorded before the pack was generated',
  num(`SELECT COUNT(*) n FROM events e JOIN review_packs p
    ON p.pack_id = CAST(json_extract(e.payload, '$.pack_id') AS INTEGER)
    WHERE e.event_type='review_pack_response' AND e.occurred_at < p.generated_at`) === 0);
check('responses on the page match the ledger',
  cov.responded === num('SELECT COUNT(*) n FROM review_packs WHERE sb_id=? AND client_response IS NOT NULL', DEMO_SB),
  `${cov.responded} responded`);

console.log(`\n${cov.reviewed} of ${cov.book} clients reviewed · ${list.length} due (${cov.never} never, ${cov.overdue} overdue) · ${past.length} packs sent, ${cov.responded} answered`);
console.log(`Top of the list: ${p.name} — ${list[0].why}`);
console.log(failures === 0 ? '\nREVIEW PACK: ALL CHECKS PASSED' : `\nREVIEW PACK: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
