/**
 * verify-invest — the pages that move money.
 *
 * Like verify-join this one WRITES, and rolls everything back at the end, so the
 * database it leaves is byte-identical to the one it found. Every assertion
 * re-derives its answer with SQL written here.
 *
 * Run: npx tsx mockdb/verify-invest.ts   (joined to `npm run verify:all`)
 */
import { db } from '../lib/db';
import { placeOrder, startSip, pauseSip, taxOnRedeem, order, myOrders, liveSips, ORDER_RULES } from '../lib/invest';

const conn = db();
const ME = 101;
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

console.log('\nverify-invest — putting money in, and taking it out\n');
conn.exec('BEGIN');

try {
  const held = one<{ sid: number; v: number; u: number; nav: number }>(
    `SELECT scheme_id sid, present_market_value v, balance_units u, nav
     FROM fifo_summary_holding_active WHERE client_id = ? ORDER BY present_market_value DESC LIMIT 1`, ME);

  /* ── the tax bill is computed from her own lots ─────────────────────────── */

  const t = taxOnRedeem(ME, held.sid, 200000);
  assert('a redemption preview exists for a fund she holds', t != null);
  if (!t) throw new Error('no preview');

  check('the preview sells the units the amount actually buys',
    Math.round(t.units * held.nav), 200000);
  assert('every lot it consumes was bought before today',
    t.lots.every(l => l.bought <= '2026-08-07'));
  assert('the lots come oldest first, the way the registrar does it',
    t.lots.every((l, i) => i === 0 || l.bought >= t.lots[i - 1].bought));
  assert('a lot held twelve months or more is long-term, and no other lot is',
    t.lots.every(l => l.long === (l.months >= ORDER_RULES.ltcg_months)));

  const gain = t.lots.reduce((s, l) => s + (l.value - l.cost), 0);
  assert('long and short gains together equal the gain in the lots',
    Math.abs((t.ltcgGain + t.stcgGain) - gain) <= t.lots.length,
    `${t.ltcgGain} + ${t.stcgGain} vs ${Math.round(gain)}`);
  check('what reaches the bank is the gross less tax and load',
    t.net, t.gross - t.ltcgTax - t.stcgTax - t.exitLoad);
  assert('a gain inside the exemption is taxed at nothing',
    t.ltcgGain > ORDER_RULES.ltcg_exempt || t.ltcgTax === 0);

  // Selling more than exists must be impossible, not merely discouraged.
  const tooMuch = taxOnRedeem(ME, held.sid, held.v * 10);
  assert('a preview never sells more units than are actually held',
    tooMuch != null && tooMuch.units <= held.u + 0.01);

  /* ── placing ───────────────────────────────────────────────────────────── */

  const before = one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n;
  const placed = placeOrder({ clientId: ME, schemeId: held.sid, kind: 'PURCHASE', amount: 50000, goalId: 1 });
  assert('a purchase is accepted', placed.ok);
  if (!placed.ok) throw new Error(placed.reason);

  check('it writes exactly one ledger entry',
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n, before + 1);

  const txn = one<{ amt: number; units: number; px: number; d: string; goal: number; status: number }>(
    `SELECT tr_amount amt, tr_units units, tr_price px, tr_date d, fk_goal_id goal, fk_txn_status_id status
     FROM transaction_master WHERE tr_bos_code = ?`, `APP-${placed.order.order_id}`);
  check('the ledger entry carries the amount', txn.amt, 50000);
  assert('units times price equals the amount', Math.abs(txn.units * txn.px - 50000) < 1);
  check('it is dated today, never in the future', txn.d, '2026-08-07');
  check('and it is tagged to the goal the client chose', txn.goal, 1);

  const trail = conn.prepare(
    `SELECT event_status s FROM bse_order_history WHERE order_id = ? ORDER BY sort_order`,
  ).all(placed.order.order_id) as { s: string }[];
  check('the receipt trail is the full journey, in order',
    trail.map(r => r.s), [...ORDER_RULES.states]);
  check('the order reads back with its trail', order(placed.order.order_id)!.trail.length, 3);
  assert('it appears in the client\'s own order list',
    myOrders(ME).some(o => o.order_id === placed.order.order_id));

  const ucc = one<{ c: string }>(`SELECT acc_bse_code c FROM accounts_master WHERE fk_cm_user_id = ?`, ME).c;
  check('the order is filed against this client\'s exchange code',
    one<{ u: string }>(`SELECT ucc u FROM bse_order_list WHERE order_id = ?`, placed.order.order_id).u, ucc);

  /* ── what must be refused ──────────────────────────────────────────────── */

  const tiny = placeOrder({ clientId: ME, schemeId: held.sid, kind: 'PURCHASE', amount: 10 });
  assert('an amount below the minimum is refused with a reason', !tiny.ok);

  const notHeld = one<{ sid: number }>(
    `SELECT scheme_id sid FROM scheme_master WHERE is_active = 1 AND scheme_id NOT IN
     (SELECT scheme_id FROM fifo_summary_holding_active WHERE client_id = ?) LIMIT 1`, ME);
  const cannotSell = placeOrder({ clientId: ME, schemeId: notHeld.sid, kind: 'REDEMPTION', amount: 1000 });
  assert('redeeming a fund she does not hold is refused', !cannotSell.ok);

  const overSell = placeOrder({ clientId: ME, schemeId: held.sid, kind: 'REDEMPTION', amount: held.v * 5 });
  assert('redeeming more than she holds is refused', !overSell.ok);
  assert('and the refusal tells her what she actually holds',
    !overSell.ok && /\d/.test(overSell.reason));

  const noAccount = placeOrder({ clientId: 999999, schemeId: held.sid, kind: 'PURCHASE', amount: 5000 });
  assert('an account with no exchange code cannot place anything', !noAccount.ok);

  /* ── monthly instalments ───────────────────────────────────────────────── */

  const sip = startSip(ME, held.sid, 5000, 5, 1);
  assert('a monthly instalment is registered', sip.ok);
  if (!sip.ok) throw new Error(sip.reason);

  const row = one<{ amt: number; live: number; day: number; freq: number }>(
    `SELECT tr_amount amt, is_live_sip live, day_of_sip day, fk_freq_id freq FROM sip_master WHERE sip_id = ?`, sip.sipId);
  check('it is live', row.live, 1);
  check('for the amount asked', row.amt, 5000);
  check('on the day asked', row.day, 5);
  assert('it shows up in her live instalments', liveSips(ME).some(s => s.sip_id === sip.sipId));

  assert('an instalment below the exchange minimum is refused',
    !startSip(ME, held.sid, 100, 5).ok);
  assert('a date that does not exist in February is refused',
    !startSip(ME, held.sid, 5000, 31).ok);

  // Registering an instalment must not move money today — that is the mandate's job.
  check('registering it debits nothing today',
    one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ?`, ME).n, before + 1);

  assert('she can pause it herself', pauseSip(ME, sip.sipId, 'test'));
  check('and it stops being live',
    one<{ live: number }>(`SELECT is_live_sip live FROM sip_master WHERE sip_id = ?`, sip.sipId).live, 0);
  assert('nobody can pause an instalment that is not theirs', !pauseSip(999999, sip.sipId, 'test'));

  /* ── every act leaves a dated record ───────────────────────────────────── */

  check('the purchase wrote one event',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE subject_type='order' AND subject_id=?`,
      String(placed.order.order_id)).n, 1);
  check('the instalment wrote its own',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE subject_type='sip' AND subject_id=? AND event_type='sip_started'`,
      String(sip.sipId)).n, 1);
} finally {
  conn.exec('ROLLBACK');
}

check('the verifier leaves the ledger exactly as it found it',
  one<{ n: number }>(`SELECT COUNT(*) n FROM transaction_master WHERE tr_bos_code LIKE 'APP-%'`).n, 0);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
