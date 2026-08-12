import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* ── Putting money in, and taking it out ─────────────────────────────────────
   Until now the client lens could diagnose but not act: every button raised a
   request on the manager's desk. This is the other half — a real order that
   moves through real states and lands in the same ledger every other page reads.

   Three rules hold the whole file up:

   1. **An order is a receipt, not a message.** It is placed, sent, allotted or
      rejected, and each of those is a dated row in `bse_order_history`. A client
      who cannot see where their money is will assume the worst, and be right to.
   2. **Nothing sells without the tax being shown first.** Redemption prices the
      client's own lots, FIFO, and prints the bill before the button.
   3. **The ledger refuses the impossible.** No future-dated transaction, no
      selling units that were not owned on the day, no order without a folio.  */

/** Every threshold and label this file applies. One home, like SCORING_RULES. */
export const ORDER_RULES = {
  /** BSE's floor for a fresh SIP. Below this the exchange refuses the registration. */
  min_sip: 500,
  min_lumpsum: 1000,
  /** Long-term capital gains on equity: the slab that is exempt each year. */
  ltcg_exempt: 125000,
  ltcg_rate: 12.5,
  stcg_rate: 20,
  /** Equity units held beyond this are long-term. */
  ltcg_months: 12,
  /** Where an order sits before the exchange has seen it. */
  states: ['RECEIVED', 'SENT_TO_EXCHANGE', 'ALLOTTED'] as const,
  version: 'orders-v1 (12-Aug-2026)',
} as const;

export type OrderKind = 'PURCHASE' | 'REDEMPTION' | 'SWITCH';

export interface Placed {
  order_id: number;
  kind: OrderKind;
  scheme: string;
  amount: number;
  placed_at: string;
  status: string;
  trail: { state: string; at: string }[];
}

const cash = (n: number) => Math.round(n * 100) / 100;

/* ── the tax bill, before the button ──────────────────────────────────────── */

export interface TaxPreview {
  units: number;
  gross: number;
  /** Gain that has been held long enough to be long-term. */
  ltcgGain: number;
  stcgGain: number;
  /** What is left of this year's exemption before this sale. */
  exemptLeft: number;
  ltcgTax: number;
  stcgTax: number;
  exitLoad: number;
  net: number;
  /** The lots this sale would consume, oldest first. */
  lots: { bought: string; units: number; cost: number; value: number; months: number; long: boolean }[];
}

/**
 * What a redemption actually costs, computed from the client's own purchase lots
 * rather than an average. FIFO, because that is what the registrar does — an
 * average-cost preview would understate the bill on exactly the holdings a client
 * is most likely to sell.
 */
export function taxOnRedeem(clientId: number, schemeId: number, amount: number): TaxPreview | null {
  const holding = db().prepare(
    `SELECT balance_units units, nav, folio_no FROM fifo_summary_holding_active
     WHERE client_id = ? AND scheme_id = ?`,
  ).get(clientId, schemeId) as { units: number; nav: number; folio_no: string } | undefined;
  if (!holding || !holding.nav) return null;

  const exitLoadPct = (db().prepare(`SELECT scheme_exit_load l FROM scheme_master WHERE scheme_id = ?`)
    .get(schemeId) as { l: number } | undefined)?.l ?? 0;

  const buys = db().prepare(
    `SELECT t.tr_date d, t.tr_units u, t.tr_price p
     FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.fk_scheme_id = ? AND t.is_active = 1
       AND tt.tr_type_buy_sell_flag = 1
     ORDER BY t.tr_date, t.tr_id`,
  ).all(clientId, schemeId) as { d: string; u: number; p: number }[];

  const sold = (db().prepare(
    `SELECT COALESCE(SUM(t.tr_units), 0) u FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.fk_scheme_id = ? AND t.is_active = 1
       AND tt.tr_type_buy_sell_flag = -1`,
  ).get(clientId, schemeId) as { u: number }).u;

  // Walk the sales already made off the front of the queue, so the lots this
  // redemption consumes are the ones actually still owned.
  let consumed = sold;
  const open: { d: string; u: number; p: number }[] = [];
  for (const b of buys) {
    if (consumed >= b.u) { consumed -= b.u; continue; }
    open.push({ ...b, u: b.u - consumed });
    consumed = 0;
  }

  const wanted = Math.min(amount / holding.nav, holding.units);
  let left = wanted, ltcgGain = 0, stcgGain = 0;
  const lots: TaxPreview['lots'] = [];
  for (const lot of open) {
    if (left <= 0) break;
    const take = Math.min(left, lot.u);
    const months = Math.floor((Date.parse(TODAY) - Date.parse(lot.d)) / 2.6298e9);
    const long = months >= ORDER_RULES.ltcg_months;
    const cost = take * lot.p, value = take * holding.nav;
    if (long) ltcgGain += value - cost; else stcgGain += value - cost;
    lots.push({ bought: lot.d, units: cash(take), cost: Math.round(cost), value: Math.round(value), months, long });
    left -= take;
  }

  // Exit load applies only to units still inside the scheme's window. Modelled on
  // the shortest-held lot, which is the one that carries it.
  const youngest = lots.length ? Math.min(...lots.map(l => l.months)) : 99;
  const exitLoad = youngest < 12 ? Math.round((wanted * holding.nav) * (exitLoadPct / 100)) : 0;

  const usedExemption = ltcgUsedThisYear(clientId);
  const exemptLeft = Math.max(0, ORDER_RULES.ltcg_exempt - usedExemption);
  const taxableLtcg = Math.max(0, ltcgGain - exemptLeft);
  const ltcgTax = Math.round(taxableLtcg * ORDER_RULES.ltcg_rate / 100);
  const stcgTax = Math.round(Math.max(0, stcgGain) * ORDER_RULES.stcg_rate / 100);
  const gross = Math.round(wanted * holding.nav);

  return {
    units: cash(wanted), gross,
    ltcgGain: Math.round(ltcgGain), stcgGain: Math.round(stcgGain),
    exemptLeft, ltcgTax, stcgTax, exitLoad,
    net: gross - ltcgTax - stcgTax - exitLoad,
    lots,
  };
}

/**
 * Long-term gains already realised this financial year, which eat into the
 * exemption before this sale touches it.
 *
 * We cannot compute this honestly yet: the ledger stores the value of each sale,
 * not the gain inside it, so anything derived here would be the wrong number
 * wearing a rupee sign. It returns zero, every preview using it says on screen
 * that it assumes nothing else has been realised this year, and
 * `exemptionIsAssumed` is what the page reads to know it must say so.
 * ponytail: the real build reads the registrar's realised-gains file. Until then
 * a client with other sales sees an exemption that is too generous, which is
 * why the sentence on the page is not optional.
 */
export const exemptionIsAssumed = true;
export function ltcgUsedThisYear(_clientId: number): number {
  return 0;
}

/* ── placing ─────────────────────────────────────────────────────────────── */

function uccOf(clientId: number): string | null {
  const r = db().prepare(`SELECT acc_bse_code c FROM accounts_master WHERE fk_cm_user_id = ?`)
    .get(clientId) as { c: string } | undefined;
  return r?.c ?? null;
}

function folioFor(clientId: number, schemeId: number): string | null {
  const r = db().prepare(
    `SELECT folio_no f FROM fifo_summary_holding_active WHERE client_id = ? AND scheme_id = ?`,
  ).get(clientId, schemeId) as { f: string } | undefined;
  if (r) return r.f;
  const any = db().prepare(`SELECT fm_folio_no f FROM folio_master WHERE fk_acc_id = ? LIMIT 1`)
    .get(clientId) as { f: string } | undefined;
  return any?.f ?? null;
}

function trail(orderId: number, states: readonly string[]): void {
  states.forEach((state, i) => {
    db().prepare(
      `INSERT INTO bse_order_history (order_id, event_status, event_time, sort_order) VALUES (?, ?, ?, ?)`,
    ).run(orderId, state, TODAY, i + 1);
  });
}

export interface OrderRequest {
  clientId: number;
  schemeId: number;
  kind: OrderKind;
  amount: number;
  /** Only for a switch. */
  toSchemeId?: number;
  /** Which goal this money is for, when the client said. */
  goalId?: number;
}

export type OrderResult = { ok: true; order: Placed } | { ok: false; reason: string };

/**
 * Places an order and walks it to allotment. Real rails take hours and a cut-off;
 * here it completes at once and the receipt says so, because a prototype that
 * fakes a two-day wait teaches nobody anything.
 * ponytail: allotment at today's NAV. Real build takes the registrar's NAV for
 * the applicable cut-off date, which can differ by a day.
 */
export function placeOrder(req: OrderRequest): OrderResult {
  const { clientId, schemeId, kind, amount } = req;
  if (amount < ORDER_RULES.min_lumpsum && kind === 'PURCHASE') {
    return { ok: false, reason: `The smallest single investment is ${ORDER_RULES.min_lumpsum}.` };
  }
  const ucc = uccOf(clientId);
  if (!ucc) return { ok: false, reason: 'This account has no exchange code yet, so nothing can be placed.' };

  const scheme = db().prepare(
    `SELECT scheme_short_name name, scheme_day_end_nav nav FROM scheme_master WHERE scheme_id = ? AND is_active = 1`,
  ).get(schemeId) as { name: string; nav: number } | undefined;
  if (!scheme?.nav) return { ok: false, reason: 'That fund has no price today, so an order cannot be priced.' };

  const folio = folioFor(clientId, schemeId);
  if (!folio) return { ok: false, reason: 'No folio exists to place this against.' };

  if (kind === 'REDEMPTION') {
    const held = db().prepare(
      `SELECT balance_units u, present_market_value v FROM fifo_summary_holding_active
       WHERE client_id = ? AND scheme_id = ?`,
    ).get(clientId, schemeId) as { u: number; v: number } | undefined;
    if (!held) return { ok: false, reason: 'You do not hold this fund, so there is nothing to redeem.' };
    if (amount > held.v) {
      return { ok: false, reason: `You hold ${Math.round(held.v)} in this fund, which is less than you asked to take out.` };
    }
  }

  const orderId = ((db().prepare(`SELECT COALESCE(MAX(order_id), 100000) n FROM bse_order_list`)
    .get() as { n: number }).n) + 1;
  const units = cash(amount / scheme.nav);
  const dest = req.toSchemeId
    ? (db().prepare(`SELECT scheme_short_name n FROM scheme_master WHERE scheme_id = ?`)
        .get(req.toSchemeId) as { n: string } | undefined)?.n ?? null
    : null;

  db().prepare(
    `INSERT INTO bse_order_list
      (order_id, mem_ord_ref_id, ucc, order_type, scheme, dest_scheme, amount, is_units, status,
       placed_at, allotment_date, allotment_units, allotment_nav, allotment_amount, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'ALLOTTED', ?, ?, ?, ?, ?, 'client_app')`,
  ).run(orderId, `APP-${orderId}`, ucc, kind, scheme.name, dest, amount,
    TODAY, TODAY, units, scheme.nav, amount);

  trail(orderId, ORDER_RULES.states);

  // The ledger entry is what every other page in the app reads. Without it the
  // order is a receipt for money that never moved.
  const typeId = kind === 'REDEMPTION' ? 2 : kind === 'SWITCH' ? 6 : 20;
  db().prepare(
    `INSERT INTO transaction_master
      (tr_bos_code, fk_acc_id, fk_scheme_id, tr_folio_no, fk_tran_type_id, fk_txn_status_id,
       tr_date, tr_amount, tr_units, tr_price, fk_goal_id, is_active)
     VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, 1)`,
  ).run(`APP-${orderId}`, clientId, schemeId, folio, typeId, TODAY,
    amount, units, scheme.nav, req.goalId ?? null);

  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'order', ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(clientId), String(orderId), `order_${kind.toLowerCase()}`,
    JSON.stringify({ scheme: scheme.name, amount, units, goal: req.goalId ?? null }));

  return { ok: true, order: order(orderId)! };
}

/** Registers a monthly instalment. Nothing is debited today; the mandate does that. */
export function startSip(clientId: number, schemeId: number, amount: number, day: number, goalId?: number):
  { ok: true; sipId: number } | { ok: false; reason: string } {
  if (amount < ORDER_RULES.min_sip) {
    return { ok: false, reason: `The smallest monthly instalment the exchange accepts is ${ORDER_RULES.min_sip}.` };
  }
  if (day < 1 || day > 28) {
    return { ok: false, reason: 'Pick a date between the 1st and the 28th — later dates fail in February.' };
  }
  const folio = folioFor(clientId, schemeId);
  if (!folio) return { ok: false, reason: 'No folio exists to register this against.' };

  const sb = (db().prepare(`SELECT fk_primary_sub_broker_id s FROM client_master WHERE cm_user_id = ?`)
    .get(clientId) as { s: number } | undefined)?.s ?? null;

  const r = db().prepare(
    `INSERT INTO sip_master
      (fk_acc_id, fk_to_scheme_id, fk_sb_id, fk_freq_id, tr_folio_no, sip_type, tr_amount,
       day_of_sip, start_date, is_live_sip)
     VALUES (?, ?, ?, 1, ?, 'SIP', ?, ?, ?, 1)`,
  ).run(clientId, schemeId, sb, folio, amount, day, TODAY);

  const sipId = Number(r.lastInsertRowid);
  if (goalId) {
    // The instalment counts towards the goal only if the ledger says so.
    db().prepare(`UPDATE transaction_master SET fk_goal_id = ? WHERE fk_acc_id = ? AND fk_scheme_id = ? AND fk_goal_id IS NULL`)
      .run(goalId, clientId, schemeId);
  }
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'sip', ?, 'sip_started', ?, 'client_app')`,
  ).run(TODAY, String(clientId), String(sipId), JSON.stringify({ amount, day, scheme: schemeId, goal: goalId ?? null }));
  return { ok: true, sipId };
}

export function pauseSip(clientId: number, sipId: number, why: string): boolean {
  const owned = db().prepare(`SELECT sip_id FROM sip_master WHERE sip_id = ? AND fk_acc_id = ?`)
    .get(sipId, clientId);
  if (!owned) return false;
  db().prepare(`UPDATE sip_master SET is_live_sip = 0, cease_date = ?, termination_remarks = ? WHERE sip_id = ?`)
    .run(TODAY, why.slice(0, 200), sipId);
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'sip', ?, 'sip_paused', ?, 'client_app')`,
  ).run(TODAY, String(clientId), String(sipId), JSON.stringify({ why }));
  return true;
}

/* ── reading them back ────────────────────────────────────────────────────── */

export function order(orderId: number): Placed | null {
  const o = db().prepare(
    `SELECT order_id, order_type kind, scheme, amount, placed_at, status FROM bse_order_list WHERE order_id = ?`,
  ).get(orderId) as Omit<Placed, 'trail'> | undefined;
  if (!o) return null;
  const trailRows = db().prepare(
    `SELECT event_status state, event_time at FROM bse_order_history WHERE order_id = ? ORDER BY sort_order`,
  ).all(orderId) as { state: string; at: string }[];
  return { ...o, trail: trailRows };
}

/** Everything this client has placed from the app, newest first. */
export function myOrders(clientId: number): Placed[] {
  const ucc = uccOf(clientId);
  if (!ucc) return [];
  const rows = db().prepare(
    `SELECT order_id FROM bse_order_list WHERE ucc = ? ORDER BY order_id DESC LIMIT 25`,
  ).all(ucc) as { order_id: number }[];
  return rows.map(r => order(r.order_id)!).filter(Boolean);
}

export interface LiveSip {
  sip_id: number; scheme_id: number; fund: string; amount: number; day: number; since: string;
}

export function liveSips(clientId: number): LiveSip[] {
  return db().prepare(
    `SELECT s.sip_id, s.fk_to_scheme_id scheme_id, sm.scheme_short_name fund,
            s.tr_amount amount, s.day_of_sip day, s.start_date since
     FROM sip_master s JOIN scheme_master sm ON sm.scheme_id = s.fk_to_scheme_id
     WHERE s.fk_acc_id = ? AND s.is_live_sip = 1 ORDER BY s.tr_amount DESC`,
  ).all(clientId) as LiveSip[];
}
