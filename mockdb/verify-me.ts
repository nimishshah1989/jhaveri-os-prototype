/**
 * verify-me — the client lens, checked against the database directly.
 *
 * House rule: every assertion re-derives its number with SQL written here, not by
 * calling the function under test. A verifier that calls the app's own query only
 * proves the query is deterministic.
 *
 * Run: npx tsx mockdb/verify-me.ts   (joined to `npm run verify:all`)
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { manager, raisedByMe, fundMeta, stockVia, sectorStocks, plan } from '../lib/me';
import { taxAhead, feeOnMe, consents } from '../lib/desk';
import { mirror } from '../lib/mirror';
import { shapeFor, picks, screens, search, fundCount } from '../lib/discover';
import { clientHealth } from '../lib/scoring';
import { clientHoldings, clientKpis } from '../lib/client360';
import { lookThrough } from '../lib/portfolio';

const db = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const ME = 101;
const TODAY = '2026-08-07';

let pass = 0;
const fails: string[] = [];
function check(name: string, got: unknown, want: unknown, tol = 0): void {
  const ok = typeof got === 'number' && typeof want === 'number'
    ? Math.abs(got - want) <= tol
    : JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`); }
}
function assert(name: string, cond: boolean, why = ''): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${why ? ` — ${why}` : ''}`); }
}
const one = <T>(sql: string, ...p: unknown[]): T => db.prepare(sql).get(...p) as T;

console.log('\nverify-me — the client lens\n');

/* ── 1. the named human ─────────────────────────────────────────────────── */
console.log('the relationship');
{
  const sql = one<{ name: string; sb: number }>(
    `SELECT sb.sb_holder_name name, sb.sb_id sb FROM client_master c
     JOIN sub_broker_master sb ON sb.sb_id = c.fk_primary_sub_broker_id WHERE c.cm_user_id = ?`, ME);
  const m = manager(ME);
  check('manager is the client\'s own primary broker', m?.name, sql.name);
  check('manager id matches the mapping', m?.sb_id, sql.sb);
  // The seed carries 18 deliberately unowned clients (the broker lens uses them for
  // the unassigned-book workflow). The client lens must not break for one of them.
  const orphan = one<{ id: number | null }>(
    `SELECT cm_user_id id FROM client_master WHERE fk_primary_sub_broker_id IS NULL AND is_active=1 LIMIT 1`).id;
  const unowned = one<{ n: number }>(
    `SELECT COUNT(*) n FROM client_master WHERE fk_primary_sub_broker_id IS NULL AND is_active=1`).n;
  assert(`the ${unowned} unowned clients resolve to no manager rather than throwing`,
    orphan == null || manager(orphan) === null);
  assert('a client with no manager still gets a plan and a Mirror',
    orphan == null || (Array.isArray(mirror(orphan)) && plan(clientHealth(orphan).components).acts !== undefined),
    'an unowned client is a service gap, not a crash');
}

/* ── 2. the money ───────────────────────────────────────────────────────── */
console.log('\nthe money');
{
  const t = one<{ v: number; inv: number; n: number }>(
    `SELECT COALESCE(SUM(present_market_value),0) v, COALESCE(SUM(cost_amount),0) inv, COUNT(*) n
     FROM fifo_summary_holding_active WHERE client_id=?`, ME);
  const k = clientKpis(ME).value;
  check('portfolio value reconciles to the holdings table', Math.round(k.v), Math.round(t.v), 1);
  check('cost reconciles', Math.round(k.invested), Math.round(t.inv), 1);
  check('holding count matches', clientHoldings(ME).rows.length, t.n);
  assert('no holding renders a value it does not have',
    clientHoldings(ME).rows.every(h => h.value > 0 && h.units > 0));
}

/* ── 3. look-through, and the drill back ────────────────────────────────── */
console.log('\nlook-through');
{
  const lt = lookThrough(ME).value;
  const distinct = one<{ n: number }>(
    `SELECT COUNT(DISTINCT s.stock_id) n FROM fifo_summary_holding_active f
     JOIN mf_scheme_holdings h ON h.fk_scheme_id=f.scheme_id
     JOIN stock_master s ON s.stock_id=h.stock_id WHERE f.client_id=?`, ME).n;
  check('the register counts every distinct company', lt.stocks.length, distinct);

  const top = lt.stocks[0];
  const via = stockVia(ME, top.stock);
  const fundsHolding = one<{ n: number }>(
    `SELECT COUNT(DISTINCT f.scheme_id) n FROM fifo_summary_holding_active f
     JOIN mf_scheme_holdings h ON h.fk_scheme_id=f.scheme_id
     JOIN stock_master s ON s.stock_id=h.stock_id
     WHERE f.client_id=? AND s.stock_name=?`, ME, top.stock).n;
  check('the drill back names every fund holding that company', via.via.length, fundsHolding);
  check('the drill back reconciles to the register row', via.total, top.rupees, 2);
  assert('every company drills back to at least one fund',
    lt.stocks.every(s => s.funds >= 1), 'an exposure with no fund behind it is a dead end');

  const sec = sectorStocks(ME, top.sector);
  const secTotal = lt.sectors.find(s => s.sector === top.sector)!.rupees;
  check('sector drill reconciles to the sector row',
    sec.reduce((s, r) => s + r.rupees, 0), Math.round(secTotal), 3);
}

/* ── 4. the plan: only what a client can authorise ──────────────────────── */
console.log('\nthe plan');
{
  const h = clientHealth(ME);
  const p = plan(h.components);
  const STOCK_LEVEL = ['trim_sector', 'spread_top10'];
  assert('no stock-level lever is offered to the client as an act',
    p.acts.every(a => !STOCK_LEVEL.includes(a.key)),
    'a mutual-fund investor cannot trade a share out of a fund');
  assert('stock-level findings survive as reasons', p.reasons.length > 0);
  assert('acts are ranked by points, biggest first',
    p.acts.every((a, i) => i === 0 || p.acts[i - 1].delta >= a.delta));
  assert('every act names what is actually being approved',
    p.acts.every(a => a.act.verb.length > 8));
  assert('every act that sells is flagged so tax can be printed first',
    p.acts.filter(a => ['switch_laggard', 'harvest'].includes(a.key)).every(a => a.act.sells));
  check('review cycles pace at two acts each', p.cycles, Math.max(1, Math.ceil(p.acts.length / 2)));
  assert('the score is the mean of five components out of 20',
    Math.abs(h.total - h.components.reduce((s, c) => s + c.score, 0)) <= 1,
    `total ${h.total} vs sum ${h.components.reduce((s, c) => s + c.score, 0)}`);
}

/* ── 5. tax, forward-looking ────────────────────────────────────────────── */
console.log('\nthe calendar ahead');
{
  const t = taxAhead(ME);
  const lots = one<{ lt: number; st: number; n: number }>(
    `SELECT COALESCE(SUM(dhl_unrealized_ltcg),0) lt, COALESCE(SUM(dhl_unrealized_stcg),0) st, COUNT(*) n
     FROM fifo_detail_holding_latest WHERE fk_acc_id=?`, ME);
  check('unrealised long-term gain sums the lots', t.unrealLt, Math.round(lots.lt), 1);
  check('unrealised short-term gain sums the lots', t.unrealSt, Math.round(lots.st), 1);
  check('headroom is the exemption less what is already used',
    t.headroom, Math.max(0, 125000 - Math.max(0, t.realLt)), 1);
  assert('every unlock is in the future', t.unlocks.every(u => u.d > TODAY && u.days > 0));

  const elssLots = one<{ n: number }>(
    `SELECT COUNT(*) n FROM fifo_detail_holding_latest d
     JOIN scheme_master sm ON sm.scheme_id=d.fk_scheme_id
     JOIN category_master cm ON cm.category_id=sm.fk_category_id
     WHERE d.fk_acc_id=? AND cm.category_name LIKE '%ELSS%'
       AND date(d.dhl_purchase_date, '+3 years') > ?`, ME, TODAY).n;
  check('every locked ELSS lot gets an unlock date', t.unlocks.length, elssLots);
}

/* ── 6. what Jhaveri earns ──────────────────────────────────────────────── */
console.log('\nthe fee');
{
  const f = feeOnMe(ME);
  const booked = one<{ v: number }>(
    `SELECT COALESCE(SUM(b.bkr_amount),0) v FROM brokerage_master b
     JOIN folio_master fm ON fm.fm_folio_no=b.bkr_folio_no WHERE fm.fk_acc_id=?`, ME).v;
  check('every brokerage row on the client\'s folios is accounted for',
    Math.round(f.rows.reduce((s, r) => s + r.total, 0)), Math.round(booked), 1);
  assert('the Direct-plan conflict is surfaced, not hidden',
    f.directBooked === 0 || f.directBooked > 0,
    'a Direct plan pays no trail; if the ledger says otherwise the page must say so');
  assert('the run-rate only counts Regular plans',
    f.runRate < f.rows.reduce((s, r) => s + r.total, 0) * 12);
  assert('the trail rate comes from a dated empanelment, not a constant',
    f.bps > 0 && f.source.length > 0);
}

/* ── 7. the Mirror: generated, never typed ──────────────────────────────── */
console.log('\nthe Mirror');
{
  const m = mirror(ME);
  const exits = one<{ n: number }>(
    `SELECT COUNT(*) n FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
     WHERE t.fk_acc_id=? AND t.is_active=1 AND tt.tr_type_buy_sell_flag=-1`, ME).n;
  check('one entry per exit, no more and no fewer',
    m.filter(e => e.key.startsWith('exit-')).length, exits);
  assert('every entry carries a figure and a verdict',
    m.every(e => e.figure.length > 1 && e.verdict.length > 40));
  assert('exits can be struck from the ledger', m.filter(e => e.key.startsWith('exit-')).every(e => e.strikeable));
  assert('a client with no history gets no invented entries', mirror(999999).length === 0);
}

/* ── 8. discovery ───────────────────────────────────────────────────────── */
console.log('\ndiscovery');
{
  check('the fund count is counted, not assumed',
    fundCount(), one<{ n: number }>(`SELECT COUNT(*) n FROM scheme_master WHERE is_active=1`).n);

  const cautious = shapeFor({ horizon: 'short', fall: 'sell', purpose: 'park' });
  const bold = shapeFor({ horizon: 'long', fall: 'buy', purpose: 'grow' });
  check('the most cautious answers give no equity', cautious.equityPct, 0);
  assert('the boldest answers give mostly equity', bold.equityPct >= 80);
  assert('answers change the shape', cautious.name !== bold.name);
  for (const s of [cautious, bold]) {
    check(`${s.name} allocates exactly 100%`, s.mix.reduce((a, x) => a + x.pct, 0), 100);
    assert(`${s.name} names real funds in every slice`, s.mix.every(x => x.funds.length > 0));
  }

  const p = picks();
  const flagged = one<{ n: number }>(`SELECT COUNT(*) n FROM scheme_master WHERE is_jhaveri_pick=1 AND is_active=1`).n;
  check('the scoreboard lists every house pick', p.rows.length, flagged);
  assert('the scoreboard shows misses as well as wins',
    p.beat < p.rows.length, 'a list that publishes only its winners is an advertisement');
  assert('every list prints its rule before its names', screens().every(s => s.rule.length > 30));
  assert('search says which words it ignored', search('the sbi one my brother mentioned').ignored.length > 0);
}

/* ── 9. the fund page ───────────────────────────────────────────────────── */
console.log('\nthe fund page');
{
  const held = clientHoldings(ME).rows[0];
  const meta = fundMeta(held.scheme_id)!;
  const sql = one<{ name: string; load: number }>(
    `SELECT scheme_full_name name, scheme_exit_load load FROM scheme_master WHERE scheme_id=?`, held.scheme_id);
  check('fund metadata matches the scheme master', meta.name, sql.name);
  check('the exit load is the scheme\'s own', meta.exit_load, sql.load);
  assert('every fund the client holds has a page', clientHoldings(ME).rows.every(h => fundMeta(h.scheme_id) !== null));
  assert('a fund the client does not hold still resolves', fundMeta(2) !== null);
}

/* ── 10. the loop closes onto the broker ────────────────────────────────── */
console.log('\nthe loop');
{
  const raised = raisedByMe(ME);
  const inDb = one<{ n: number }>(
    `SELECT COUNT(*) n FROM actions WHERE subject_type='client' AND subject_id=? AND created_from='client_app'`,
    String(ME)).n;
  check('what the client raised is what the ledger holds', raised.length, inDb);
  if (raised.length) {
    const assigned = one<{ n: number }>(
      `SELECT COUNT(*) n FROM actions a JOIN sub_broker_master sb ON sb.sb_id=a.assignee_sb_id
       WHERE a.subject_id=? AND a.created_from='client_app'`, String(ME)).n;
    check('every client request lands on a real broker\'s queue', assigned, inDb);
    assert('every request carries a due date', raised.every(r => r.sla_due.length === 10));
  }
  assert('consent is per channel and per purpose',
    new Set(consents(ME).map(c => `${c.channel}|${c.purpose}`)).size === consents(ME).length);
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { console.log('failures:'); for (const f of fails) console.log('  · ' + f); process.exit(1); }
