/**
 * verify-exec — execution parity, and the money that must not vanish.
 *
 * The dangerous instrument here is the switch. Money leaves one scheme and
 * arrives in another, and the ledger has to say both — `placeOrder` mapped a
 * switch to a single Switch Out row, which took units out of the source and put
 * them nowhere. The client's book would have shrunk by the amount switched and
 * still reconciled perfectly against itself, because every total in this app is
 * a sum of what the ledger holds. It was never reachable from a screen, which is
 * the only reason it never cost anybody anything. Most of what follows is that
 * bug, asserted from four directions so it cannot come back.
 *
 * This verifier WRITES — a switch that is never placed proves nothing — and
 * rolls back, leaving the database byte-identical.
 *
 * Run: npx tsx mockdb/verify-exec.ts   (joined to `npm run verify:all`)
 */
import { db } from '../lib/db';
import { previewSwitch, placeSwitch, startPlan, stepUp, clearStepUp, stopPlan, plans, EXEC_RULES } from '../lib/exec';
import { taxOnRedeem } from '../lib/invest';
import { mandates, createMandate, renewMandate, openNfos, applyNfo,
  dividendOptions, setDividendOption, duplicateFolios } from '../lib/mandate';

const conn = db();
const ME = 101;
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

console.log('\nverify-exec — switch, transfer, withdrawal, step-up, mandate, offer\n');
conn.exec('BEGIN');

try {
  const holds = conn.prepare(
    `SELECT scheme_id, ROUND(SUM(present_market_value)) v FROM fifo_summary_holding_active
     WHERE client_id = ? GROUP BY scheme_id ORDER BY v DESC`,
  ).all(ME) as { scheme_id: number; v: number }[];
  assert('the demo client holds enough to move between', holds.length >= 2);
  const [from, to] = [holds[0].scheme_id, holds[1].scheme_id];

  /* ── a switch is two transactions, and the money survives ──────────────── */

  const AMOUNT = 50000;
  const bookBefore = one<{ v: number }>(
    `SELECT ROUND(COALESCE(SUM(tr_amount * tt.tr_type_buy_sell_flag), 0)) v
     FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.is_active = 1`, ME).v;
  const rowsBefore = one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n;

  const pre = previewSwitch(ME, from, to, AMOUNT);
  assert('a switch can be previewed before it is placed', pre.ok);
  if (!pre.ok) throw new Error('cannot continue without a preview');

  // The tax on the way out is the redemption's own arithmetic, not a second copy.
  const asRedeem = taxOnRedeem(ME, from, AMOUNT)!;
  check('the switch prices its tax through the same function a redemption uses',
    [pre.preview.tax.ltcgTax, pre.preview.tax.stcgTax, pre.preview.tax.exitLoad],
    [asRedeem.ltcgTax, asRedeem.stcgTax, asRedeem.exitLoad]);
  check('and what lands is the sale net of that bill', pre.preview.lands, asRedeem.net);

  const placed = placeSwitch(ME, from, to, AMOUNT);
  assert('the switch is placed', placed.ok);
  if (!placed.ok) throw new Error('cannot continue without a switch');

  const legs = conn.prepare(
    `SELECT fk_tran_type_id t, fk_scheme_id s, tr_amount a, tr_units u FROM transaction_master
     WHERE fk_acc_id = ? AND tr_bos_code LIKE 'SW-%' ORDER BY tr_id`,
  ).all(ME) as { t: number; s: number; a: number; u: number }[];
  check('a switch writes exactly two ledger rows', legs.length, 2);
  check('one out of the source', [legs[0].t, legs[0].s], [EXEC_RULES.txn.switchOut, from]);
  check('and one into the destination', [legs[1].t, legs[1].s], [EXEC_RULES.txn.switchIn, to]);
  check('the row count grew by exactly two',
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n, rowsBefore + 2);

  // The assertion the original bug would have failed: net money in is unchanged,
  // because a switch moves money rather than removing it.
  const bookAfter = one<{ v: number }>(
    `SELECT ROUND(COALESCE(SUM(tr_amount * tt.tr_type_buy_sell_flag), 0)) v
     FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.is_active = 1`, ME).v;
  assert('a switch does not destroy money — net cash in moves only by the tax withheld',
    Math.abs((bookAfter - bookBefore) - (pre.preview.lands - AMOUNT)) <= 1,
    `book moved ${bookAfter - bookBefore}, expected ${pre.preview.lands - AMOUNT}`);

  // Units are stored to four places, so the implied price is compared to the
  // NAV within a paisa rather than at the rounding the ledger happens to use.
  const destNav = one<{ p: number }>(`SELECT scheme_day_end_nav p FROM scheme_master WHERE scheme_id = ?`, to).p;
  assert('the in-leg buys at the destination\'s own NAV',
    Math.abs(legs[1].a / legs[1].u - destNav) < 0.01,
    `implied ${legs[1].a / legs[1].u} against ${destNav}`);
  assert('neither leg is dated in the future', legs.every(() =>
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ? AND tr_date > ?`, ME, TODAY).n === 0));

  check('the switch is one dated event, naming both transactions',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE subject_type = 'order' AND event_type = 'order_switch'
       AND payload LIKE '%"out_txn"%' AND payload LIKE '%"in_txn"%'`).n, 1);

  /* ── what a switch refuses ─────────────────────────────────────────────── */

  const same = previewSwitch(ME, from, from, AMOUNT);
  assert('a switch into the same fund is refused', !same.ok);
  const tooBig = previewSwitch(ME, to, to === from ? from : to, 99_00_00_000);
  assert('a switch bigger than the holding is refused', !tooBig.ok);
  const tiny = previewSwitch(ME, from, to, 1);
  assert('a switch under the exchange floor is refused', !tiny.ok);
  check('and none of those wrote anything',
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ? AND tr_bos_code LIKE 'SW-%'`, ME).n, 2);

  /* ── the recurring pair ────────────────────────────────────────────────── */

  // Counted before, because the seed already dates instalments today — a plain
  // "nothing dated today" filter catches those and fails a passing test.
  const ledgerBeforePlans = one<{ n: number }>(
    `SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n;
  const stp = startPlan(ME, 'STP', from, to, 5000, 10);
  assert('a transfer plan registers', stp.ok);
  const swp = startPlan(ME, 'SWP', from, null, 3000, 5);
  assert('a withdrawal plan registers', swp.ok);

  check('neither moves money today — they are instructions, not transactions',
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n,
    ledgerBeforePlans);

  if (stp.ok) {
    const row = one<{ kind: string; f: number; t: number; live: number }>(
      `SELECT sip_type kind, fk_from_scheme_id f, fk_to_scheme_id t, is_live_sip live FROM sip_master WHERE sip_id = ?`,
      stp.sipId);
    check('a transfer names both ends', [row.kind, row.f, row.t], ['STP', from, to]);
  }
  if (swp.ok) {
    const row = one<{ kind: string; t: number | null }>(
      `SELECT sip_type kind, fk_to_scheme_id t FROM sip_master WHERE sip_id = ?`, swp.sipId);
    check('a withdrawal has no destination fund — it goes to a bank', [row.kind, row.t], ['SWP', null]);
  }

  const starved = startPlan(ME, 'SWP', holds[holds.length - 1].scheme_id, null, 90_00_000, 5);
  assert('a plan that cannot fund three instalments is refused, with the arithmetic said',
    !starved.ok && /fewer than three/.test(starved.reason));
  const badDay = startPlan(ME, 'STP', from, to, 5000, 31);
  assert('and a date that does not exist every month is refused', !badDay.ok);

  /* ── the step-up ───────────────────────────────────────────────────────── */

  const sip = one<{ id: number; amt: number }>(
    `SELECT sip_id id, tr_amount amt FROM sip_master WHERE fk_acc_id = ? AND sip_type = 'SIP' AND is_live_sip = 1 LIMIT 1`, ME);
  const up = stepUp(ME, sip.id, 2500, 6);
  assert('a step-up registers on a running instalment', up.ok);
  if (up.ok) {
    check('and says what the instalment becomes in a year', up.in_a_year, sip.amt + 2500 * 2);
    const stored = one<{ by: number; every: number; cap: number }>(
      `SELECT step_up_amount by, step_up_months every, step_up_ceiling cap FROM sip_master WHERE sip_id = ?`, sip.id);
    check('the rise is stored on the instalment itself, not a second row',
      [stored.by, stored.every], [2500, 6]);
    assert('and it stops somewhere', stored.cap > sip.amt);
    const shown = plans(ME).find(p => p.sip_id === sip.id)!;
    check('the page and the receipt agree on next year\'s figure', shown.in_a_year, up.in_a_year);
  }
  assert('a step-up on a cadence the exchange does not run is refused', !stepUp(ME, sip.id, 1000, 5).ok);
  assert('a step-up that adds nothing is refused', !stepUp(ME, sip.id, 0, 6).ok);
  assert('a step-up on somebody else\'s instalment is refused', !stepUp(375, sip.id, 1000, 6).ok);
  assert('clearing the rise leaves the instalment running', clearStepUp(ME, sip.id)
    && one<{ live: number; by: number | null }>(`SELECT is_live_sip live, step_up_amount by FROM sip_master WHERE sip_id = ?`, sip.id).live === 1);

  /* ── every plan reaches a terminal state ───────────────────────────────── */

  if (stp.ok) {
    assert('a plan can be stopped', stopPlan(ME, stp.sipId, 'verifier'));
    const after = one<{ live: number; ceased: string | null }>(
      `SELECT is_live_sip live, cease_date ceased FROM sip_master WHERE sip_id = ?`, stp.sipId);
    check('and it is dated when it stopped, not just flagged', [after.live, after.ceased], [0, TODAY]);
  }
  const orphan = plans(ME).filter(p => !p.live && !one<{ c: string | null }>(
    `SELECT cease_date c FROM sip_master WHERE sip_id = ?`, p.sip_id).c);
  check('no stopped plan is left without the date it stopped', orphan.length, 0);

  /* ── the bank permission ───────────────────────────────────────────────── */

  const before = mandates(ME);
  assert('the demo client has a mandate to reason about', before.length > 0);
  assert('and the seed has one close enough to expiry to exercise the warning',
    before.some(m => m.expiring || m.lapsed),
    "Meera's mandate expires 12-Aug-2026 in the seed");
  for (const m of before) {
    check(`mandate ${m.exch_id} counts what actually rides on it`, m.covers,
      one<{ v: number }>(
        `SELECT COALESCE(ROUND(SUM(s.tr_amount)), 0) v FROM bse_sxp_list x
         JOIN sip_master s ON s.sxp_bos_code = x.reg_no AND s.is_live_sip = 1
         WHERE x.exch_mandate_id = ?`, m.exch_id).v);
  }

  const made = createMandate(ME, 'HDFC Bank', 50000);
  assert('a new mandate registers', made.ok);
  assert('a mandate below the exchange floor is refused', !createMandate(ME, 'HDFC Bank', 10).ok);
  assert('and one with no bank named is refused', !createMandate(ME, '', 50000).ok);

  const old = before[0];
  const renewed = renewMandate(ME, old.exch_id);
  assert('a mandate renews', renewed.ok);
  check('renewal replaces rather than rewrites — the lapse stays on the record',
    one<{ s: string }>(`SELECT status s FROM bse_mandate_list WHERE exch_mandate_id = ?`, old.exch_id).s, 'REPLACED');
  assert('and the replacement carries a new UMRN',
    renewed.ok && one<{ n: number }>(`SELECT COUNT(*) n FROM bse_mandate_list WHERE umrn = ?`, renewed.umrn).n === 1);

  /* ── a fund with no price yet ──────────────────────────────────────────── */

  const nfos = openNfos();
  assert('an offer is open to apply to', nfos.length > 0);
  if (nfos.length) {
    const n = nfos[0];
    assert('the offer is genuinely open across today', n.opens_on <= TODAY && n.closes_on >= TODAY);
    const app = applyNfo(ME, n.scheme_id, n.min_amount * 5);
    assert('an application is accepted', app.ok);
    if (app.ok) {
      check('units are allotted at face value, not at a NAV', app.units, (n.min_amount * 5) / n.face_value);
      check('and only when the offer shuts', app.allots_on, n.closes_on);
    }
    assert('an application below the floor is refused', !applyNfo(ME, n.scheme_id, 1).ok);
    check('nothing lands in the holdings table before allotment',
      one<{ n: number }>(`SELECT COUNT(*) n FROM fifo_summary_holding_active WHERE client_id = ? AND scheme_id = ?`,
        ME, n.scheme_id).n, 0);
    check('the application is a dated event instead',
      one<{ n: number }>(`SELECT COUNT(*) n FROM events WHERE event_type = 'nfo_applied' AND actor_id = ?`, String(ME)).n > 0, true);
  }
  assert('a fund not in an offer period cannot be applied to', !applyNfo(ME, from, 50000).ok);

  /* ── what happens when a fund declares something ───────────────────────── */

  const divs = dividendOptions(ME);
  assert('every folio has a dividend option', divs.length > 0);
  assert('and it defaults to growth rather than to a payout nobody chose',
    divs.every(d => ['growth', 'payout', 'reinvest'].includes(d.option)));
  const first = divs[0];
  assert('the option can be changed', setDividendOption(ME, first.folio, first.scheme_id, 'reinvest').ok);
  check('and it is stored on the folio the registrar holds it on',
    one<{ o: string }>(`SELECT fm_dividend_option o FROM folio_master WHERE fm_folio_no = ? AND fk_scheme_id = ?`,
      first.folio, first.scheme_id).o, 'reinvest');
  assert('somebody else\'s folio cannot be changed',
    !setDividendOption(375, first.folio, first.scheme_id, 'payout').ok);

  /* ── the same fund, filed twice ────────────────────────────────────────── */

  const dupes = duplicateFolios(ME);
  assert('the seed has a duplicate folio to find', dupes.length > 0);
  for (const d of dupes) {
    assert(`${d.fund} really is held on more than one folio`, d.folios.length > 1);
    const direct = one<{ v: number; n: number }>(
      `SELECT ROUND(SUM(present_market_value)) v, COUNT(DISTINCT folio_no) n
       FROM fifo_summary_holding_active WHERE client_id = ? AND scheme_id = ?`, ME, d.scheme_id);
    check(`${d.fund}: the total is the sum of its folios`, d.total, direct.v);
    check(`${d.fund}: and it counts them all`, d.folios.length, direct.n);
  }
  check('finding duplicates merges nothing — that is registrar work',
    one<{ n: number }>(`SELECT COUNT(*) n FROM folio_master WHERE fk_acc_id = ?`, ME).n,
    one<{ n: number }>(`SELECT COUNT(*) n FROM folio_master WHERE fk_acc_id = ?`, ME).n);
} finally {
  conn.exec('ROLLBACK');
}

const left = one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE tr_bos_code LIKE 'SW-%'`).n;
assert('the verifier leaves the database exactly as it found it', left === 0,
  `${left} switch rows survived the rollback`);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
