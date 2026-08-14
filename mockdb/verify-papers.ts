/**
 * verify-papers — the documents, and the invariant that keeps them honest.
 *
 * The Review Pack rule, applied to client documents: **a paper is built from the
 * same functions the screen renders, never from a second query written for the
 * export.** The first thing anybody does with a statement is check it against
 * the app, and the second thing they do if it disagrees is stop trusting both.
 * So every assertion below re-derives a figure from SQL written here and holds
 * the document to it.
 *
 * The second thing checked is that these are documents at all. Until phase 7 the
 * Desk listed three papers and pressing one raised a request on the manager's
 * queue — a promise where a statement should have been.
 *
 * This verifier WRITES (producing a paper logs a download) and rolls back.
 *
 * Run: npx tsx mockdb/verify-papers.ts   (joined to `npm run verify:all`)
 */
import { db } from '../lib/db';
import { paper, toCsv, available, milestones, financialYear, PAPERS, type PaperKind } from '../lib/papers';
import { clientHoldings, clientTxns, taxPosition } from '../lib/client360';
import { nominees } from '../lib/desk';

const conn = db();
const ME = 101;
/** Counted before the transaction opens: the seed already ships download rows. */
const LOGGED_BEFORE = (conn.prepare(
  `SELECT COUNT(*) n FROM download_history_logs WHERE report_for = 'client:101' AND is_broker = 0`,
).get() as { n: number }).n;
const EMPTY = 375;
const TODAY = '2026-08-07';
let pass = 0;
const fails: string[] = [];

function assert(name: string, cond: boolean, why = ''): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${why ? ` — ${why}` : ''}`); }
}
function check(name: string, got: unknown, want: unknown): void {
  assert(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
const one = <T>(sql: string, ...p: unknown[]): T => conn.prepare(sql).get(...p) as T;

console.log('\nverify-papers — statements, proof, receipts, and who inherits it\n');
conn.exec('BEGIN');

try {
  const KINDS = Object.keys(PAPERS) as PaperKind[];
  check('every paper on offer builds', KINDS.filter(k => paper(ME, k) != null).length, KINDS.length);
  assert('an unknown kind builds nothing rather than an empty file',
    paper(ME, 'nonsense' as PaperKind) === null);

  /* ── the invariant: the paper and the screen are the same figures ───────── */

  const val = paper(ME, 'valuation')!;
  const holds = clientHoldings(ME).rows;
  check('the valuation lists exactly what the Portfolio page lists', val.rows.length, holds.length);

  const direct = one<{ v: number; n: number }>(
    `SELECT ROUND(SUM(present_market_value), 2) v, COUNT(*) n
     FROM fifo_summary_holding_active WHERE client_id = ?`, ME);
  const paperValue = val.rows.reduce((s, r) => s + Number(r[7]), 0);
  assert('and the values on it add to what the database holds',
    Math.abs(paperValue - direct.v) <= 1, `${paperValue} vs ${direct.v}`);
  check('one row per holding, none invented', val.rows.length, direct.n);

  // A holding too young to annualise must print a blank, never a zero: a zero
  // rate on a statement reads as a fund that earned nothing.
  for (const [i, h] of holds.entries()) {
    if (h.xirr == null) check(`${h.fund_name}: an uncomputable rate is blank, not zero`, val.rows[i][9], '');
  }

  const gains = paper(ME, 'gains')!;
  const t = taxPosition(ME).value;
  const said = new Map(gains.rows.filter(r => r[0] !== 'By fund').map(r => [`${r[0]}|${r[1]}`, Number(r[2])]));
  check('realised long-term matches the Desk\'s own tax card', said.get('Realised|Long term'), Math.round(t.real_lt * 100) / 100);
  check('realised short-term matches it too', said.get('Realised|Short term'), Math.round(t.real_st * 100) / 100);
  check('and so does the notional gain', said.get('Notional|Long term'), Math.round(t.unreal_lt * 100) / 100);
  assert('realised and notional are never added together on the page',
    gains.rows.every(r => r[0] === 'Realised' || r[0] === 'Notional' || r[0] === 'By fund'),
    'a statement that blends the two invites a client to pay tax on money they have not taken');

  const ledger = paper(ME, 'ledger')!;
  const txns = clientTxns(ME);
  check('the ledger carries every entry the app knows about', ledger.rows.length, txns.rows.length);
  assert('including the instalments the bank refused',
    ledger.rows.some(r => String(r[2]).includes('Rejection')) ===
    txns.rows.some(r => r.type_name.includes('Rejection')),
    'a ledger that drops the bounces is a brochure');
  assert('nothing on it is dated after today', ledger.rows.every(r => String(r[0]) <= TODAY));

  /* ── the 80C proof, and the lock nobody can otherwise date ─────────────── */

  const fy = financialYear();
  const elss = paper(ME, 'elss')!;
  const direct80c = conn.prepare(
    `SELECT t.tr_date, t.tr_amount a FROM transaction_master t
     JOIN scheme_master s ON s.scheme_id = t.fk_scheme_id
     JOIN category_master c ON c.category_id = s.fk_category_id
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.is_active = 1 AND tt.tr_type_buy_sell_flag = 1
       AND c.category_name LIKE '%ELSS%' AND t.tr_date >= ? AND t.tr_date <= ?`,
    ).all(ME, fy.from, fy.to) as { tr_date: string; a: number }[];
  check('the 80C proof carries this financial year\'s tax-saving purchases and no others',
    elss.rows.length, direct80c.length);
  for (const r of elss.rows) {
    const bought = String(r[0]);
    const unlocks = String(r[4]);
    check(`${bought} unlocks three years from its own date, not from the folio's`,
      unlocks, `${Number(bought.slice(0, 4)) + 3}${bought.slice(4)}`);
  }
  assert('a year with nothing in it says so rather than printing an empty table',
    elss.rows.length > 0 || elss.footer.some(f => /nothing went into/i.test(f)));
  check('the financial year runs April to March', [fy.from.slice(5), fy.to.slice(5)], ['04-01', '03-31']);

  /* ── it is a file, and it survives a spreadsheet ───────────────────────── */

  for (const kind of KINDS) {
    const p = paper(ME, kind)!;
    const csv = toCsv(p);
    const lines = csv.trim().split('\n');
    const header = lines.find(l => !l.startsWith('#') && l.trim());
    check(`${kind}: the header names every column`, header?.split(',').length, p.columns.length);
    assert(`${kind}: it says whose it is and when`, p.footer.join(' ').length > 40);
    assert(`${kind}: the filename says what it is`, /\.csv$/.test(p.meta.filename) && p.meta.filename.includes(String(ME)));
    // A fund name with a comma in it would silently shift every column right.
    const commas = p.rows.filter(r => r.some(c => /[",\n]/.test(String(c))));
    for (const r of commas) {
      assert(`${kind}: a value containing a comma is quoted`, csv.includes(`"${String(r.find(c => /[",]/.test(String(c)))).replace(/"/g, '""')}"`));
    }
  }

  /* ── a download is a record ────────────────────────────────────────────── */

  const before = one<{ n: number }>(`SELECT COUNT(*) n FROM download_history_logs WHERE report_for = ?`, `client:${ME}`).n;
  paper(ME, 'valuation');
  check('producing a paper logs it, so it can be asked about later',
    one<{ n: number }>(`SELECT COUNT(*) n FROM download_history_logs WHERE report_for = ?`, `client:${ME}`).n, before + 1);
  check('and it is logged as the client\'s, not the broker\'s',
    one<{ b: number }>(
      `SELECT is_broker b FROM download_history_logs WHERE report_for = ? ORDER BY id DESC LIMIT 1`,
      `client:${ME}`).b, 0);

  /* ── a client who holds nothing still has a history ─────────────────────
     Client 375 redeemed everything: no holdings, one transaction, and ₹41,002
     of realised gain. A valuation and an 80C proof are genuinely empty for them.
     A ledger and a capital-gains statement are NOT — hiding the sale that left
     them with nothing is the bug, not the empty file. So each paper is held to
     the function behind it rather than to zero. */

  check('a valuation for someone holding nothing is empty', paper(EMPTY, 'valuation')!.rows.length, 0);
  check('and so is their 80C proof', paper(EMPTY, 'elss')!.rows.length, 0);
  check('but their ledger still carries the sale that emptied it',
    paper(EMPTY, 'ledger')!.rows.length, clientTxns(EMPTY).rows.length);
  const emptyGains = paper(EMPTY, 'gains')!;
  const et = taxPosition(EMPTY).value;
  const eSaid = new Map(emptyGains.rows.filter(r => r[0] !== 'By fund').map(r => [`${r[0]}|${r[1]}`, Number(r[2])]));
  check('and their realised gain is stated rather than dropped',
    eSaid.get('Realised|Short term'), Math.round(et.real_st * 100) / 100);
  check('with no per-fund rows, because they hold no funds',
    emptyGains.rows.filter(r => r[0] === 'By fund').length, 0);
  for (const kind of KINDS) {
    assert(`${kind}: the paper still says whose it is`, paper(EMPTY, kind)!.footer.join(' ').length > 20);
  }
  check('and nothing is claimed for them in the milestones', milestones(EMPTY).length, 0);

  /* ── milestones are things that happened ───────────────────────────────── */

  const marks = milestones(ME);
  assert('the demo client has milestones worth printing', marks.length > 0);
  for (const m of marks) {
    assert(`"${m.title}" is dated`, /^\d{4}-\d{2}-\d{2}$/.test(m.on) && m.on <= TODAY);
    assert(`"${m.title}" says something specific`, m.detail.length > 30);
  }
  const ahead = marks.find(m => m.key === 'ahead');
  if (ahead) {
    const k = one<{ v: number; put: number }>(
      `SELECT SUM(present_market_value) v, SUM(cost_amount) put FROM fifo_summary_holding_active WHERE client_id = ?`, ME);
    assert('"worth more than you put in" is only claimed when it is true', k.v > k.put);
  }
  const instal = marks.find(m => m.key.startsWith('instalments-'));
  if (instal) {
    check('the instalment count is the ledger\'s own count',
      Number(instal.key.split('-')[1]),
      one<{ n: number }>(
        `SELECT COUNT(*) n FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
         WHERE t.fk_acc_id = ? AND tt.tr_type_name = 'Systematic Investment' AND t.is_active = 1`, ME).n);
  }
  assert('no milestone fires on a schedule rather than on an event',
    marks.every(m => m.key !== 'weekly' && !/reminder|check in|been a while/i.test(m.detail)),
    'DESIGN.md refuses engagement notifications');

  /* ── who inherits it ───────────────────────────────────────────────────── */

  const nom = nominees(ME);
  check('every active folio is accounted for',
    nom.rows.length,
    one<{ n: number }>(`SELECT COUNT(*) n FROM folio_master WHERE fk_acc_id = ? AND is_active = 1`, ME).n);
  check('named plus missing is all of them', nom.named + nom.missing, nom.rows.length);
  check('the missing count is the register\'s own',
    nom.missing,
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM folio_master WHERE fk_acc_id = ? AND is_active = 1 AND fm_nominee1_name IS NULL`, ME).n);
  assert('the seed has a folio with nobody named, so the gap is exercised', nom.missing > 0);
  const atRisk = one<{ v: number }>(
    `SELECT COALESCE(ROUND(SUM(h.present_market_value)), 0) v
     FROM fifo_summary_holding_active h
     JOIN folio_master f ON f.fk_acc_id = h.client_id AND f.fm_folio_no = h.folio_no AND f.fk_scheme_id = h.scheme_id
     WHERE h.client_id = ? AND f.fm_nominee1_name IS NULL AND f.is_active = 1`, ME).v;
  check('and the money on those folios is what the page says it is', nom.at_risk, atRisk);

  /* ── the Desk no longer promises a document instead of producing one ───── */

  // The whole Desk directory, not one file: the page was split into tabs on
  // 14-Aug-2026 and the papers moved with it. A check pinned to a filename
  // fails on a refactor that changed nothing it was actually asserting.
  const fs = require('node:fs') as typeof import('node:fs');
  const desk = fs.readdirSync('app/me/desk')
    .filter((f: string) => f.endsWith('.tsx'))
    .map((f: string) => fs.readFileSync(`app/me/desk/${f}`, 'utf8'))
    .join('\n');
  assert('the Desk links to the download rather than raising a request for it',
    /href=\{`\/me\/papers\//.test(desk) && !/paper_\$\{kind\}|paper_valuation/.test(desk),
    'pressing a statement must produce a statement');
  check('every paper offered on the Desk exists', available(ME).length, KINDS.length);
} finally {
  conn.exec('ROLLBACK');
}

const left = one<{ n: number }>(
  `SELECT COUNT(*) n FROM download_history_logs WHERE report_for = ? AND is_broker = 0`, `client:${ME}`).n;
check('the verifier leaves the database exactly as it found it', left, LOGGED_BEFORE);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
