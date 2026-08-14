import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { ORDER_RULES, taxOnRedeem, type TaxPreview } from './invest';

/* ── Execution parity ────────────────────────────────────────────────────────
   Phase 5. The instruments a client can already use at any other distributor,
   so that leaving this app to do something ordinary never becomes the reason
   they leave it altogether. `lib/invest.ts` covers a purchase, a redemption and
   a plain instalment; this file covers the rest.

   The one thing worth reading before changing anything here:

   **A SWITCH IS TWO TRANSACTIONS, NOT ONE.** Money leaves one scheme and
   arrives in another, and the ledger has to say both. `placeOrder` mapped a
   switch to a single Switch Out row, which took units out of the source and put
   them nowhere — the client's book would have shrunk by the amount switched and
   still reconciled against itself, because every total is a sum of what the
   ledger holds. It was never reachable from a screen, which is the only reason
   it never cost anybody anything. `placeSwitch` below writes the pair, inside
   one transaction, or writes neither.

   **AND A SWITCH IS A SALE.** The registrar and the tax office both treat the
   out-leg as a redemption. So it prices the client's own lots through the same
   `taxOnRedeem` a redemption uses — not a copy of it — and the bill is on the
   screen before the button, like every other sale in this app.                */

export const EXEC_RULES = {
  /** BSE floors, the same ones the exchange itself refuses below. */
  min_stp: 1000,
  min_swp: 500,
  min_switch: 1000,
  /** A step-up that never stops eventually fails the mandate. */
  default_ceiling_multiple: 3,
  /** Types the ledger already knows. Named, never inlined as a number. */
  txn: { purchase: 1, redeem: 2, sip: 3, switchIn: 5, switchOut: 6,
    divReinvest: 9, divPaid: 10, addPurchase: 20, swp: 22 },
  version: 'exec-v1 (14-Aug-2026)',
} as const;

const cash = (n: number) => Math.round(n * 100) / 100;
export type Fail = { ok: false; reason: string };

interface SchemeRow { scheme_id: number; name: string; nav: number; category: string }

function scheme(id: number): SchemeRow | null {
  return db().prepare(
    `SELECT s.scheme_id, s.scheme_short_name name, s.scheme_day_end_nav nav, c.category_name category
     FROM scheme_master s JOIN category_master c ON c.category_id = s.fk_category_id
     WHERE s.scheme_id = ? AND s.is_active = 1`,
  ).get(id) as SchemeRow | null;
}

function folioOf(clientId: number, schemeId: number): string | null {
  const r = db().prepare(
    `SELECT folio_no f FROM fifo_summary_holding_active WHERE client_id = ? AND scheme_id = ?`,
  ).get(clientId, schemeId) as { f: string } | undefined;
  if (r) return r.f;
  return (db().prepare(`SELECT fm_folio_no f FROM folio_master WHERE fk_acc_id = ? LIMIT 1`)
    .get(clientId) as { f: string } | undefined)?.f ?? null;
}

function held(clientId: number, schemeId: number): { units: number; value: number } | null {
  return db().prepare(
    `SELECT balance_units units, present_market_value value FROM fifo_summary_holding_active
     WHERE client_id = ? AND scheme_id = ?`,
  ).get(clientId, schemeId) as { units: number; value: number } | null;
}

function emit(clientId: number, subject: string, id: number | string, type: string, payload: object): void {
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, ?, ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(clientId), subject, String(id), type, JSON.stringify(payload));
}

/* ── switch ───────────────────────────────────────────────────────────────── */

export interface SwitchPreview {
  from: string; to: string; amount: number;
  /** The out-leg is a sale, so it carries the whole tax bill. */
  tax: TaxPreview;
  /** Units bought in the destination, at its own NAV. */
  buys: number;
  /** What actually lands, after tax and any exit load. */
  lands: number;
  /** True when both funds do the same job — a switch that changes nothing. */
  sameCategory: boolean;
}

export function previewSwitch(clientId: number, fromId: number, toId: number, amount: number):
  { ok: true; preview: SwitchPreview } | Fail {
  if (fromId === toId) return { ok: false, reason: 'That is the same fund on both sides.' };
  if (amount < EXEC_RULES.min_switch) {
    return { ok: false, reason: `The smallest switch the exchange accepts is ₹${EXEC_RULES.min_switch}.` };
  }
  const a = scheme(fromId), b = scheme(toId);
  if (!a || !b?.nav) return { ok: false, reason: 'One of those funds has no price today, so a switch cannot be priced.' };
  const have = held(clientId, fromId);
  if (!have) return { ok: false, reason: 'You do not hold the fund you are switching out of.' };
  if (amount > have.value) {
    return { ok: false, reason: `You hold ₹${Math.round(have.value)} there, which is less than you asked to switch.` };
  }
  // The same function a plain redemption uses. A second tax path is a second
  // answer to the same question, and one of them would be wrong.
  const tax = taxOnRedeem(clientId, fromId, amount);
  if (!tax) return { ok: false, reason: 'The lots behind that holding cannot be priced, so the tax cannot be shown.' };
  const lands = cash(tax.net);
  return {
    ok: true,
    preview: {
      from: a.name, to: b.name, amount, tax, lands,
      buys: cash(lands / b.nav),
      sameCategory: a.category === b.category,
    },
  };
}

export interface SwitchResult { out_id: number; in_id: number; lands: number; buys: number }

/**
 * Both legs, or neither. Wrapped in a transaction because a switch that writes
 * its sale and then fails on its purchase destroys money that the ledger will
 * happily keep reconciling.
 */
export function placeSwitch(clientId: number, fromId: number, toId: number, amount: number):
  { ok: true; result: SwitchResult } | Fail {
  const pre = previewSwitch(clientId, fromId, toId, amount);
  if (!pre.ok) return pre;
  const a = scheme(fromId)!, b = scheme(toId)!;
  const fromFolio = folioOf(clientId, fromId), toFolio = folioOf(clientId, toId);
  if (!fromFolio || !toFolio) return { ok: false, reason: 'No folio exists on one side of this switch.' };

  const conn = db();
  const write = conn.prepare(
    `INSERT INTO transaction_master
      (tr_bos_code, fk_acc_id, fk_scheme_id, tr_folio_no, fk_tran_type_id, fk_txn_status_id,
       tr_date, tr_amount, tr_units, tr_price, is_active)
     VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, 1)`,
  );

  const run = conn.transaction(() => {
    const base = (conn.prepare(`SELECT COALESCE(MAX(tr_id), 0) n FROM transaction_master`).get() as { n: number }).n;
    const outUnits = cash(amount / a.nav);
    write.run(`SW-OUT-${base + 1}`, clientId, fromId, fromFolio, EXEC_RULES.txn.switchOut,
      TODAY, amount, outUnits, a.nav);
    const outId = (conn.prepare(`SELECT MAX(tr_id) n FROM transaction_master`).get() as { n: number }).n;
    write.run(`SW-IN-${base + 2}`, clientId, toId, toFolio, EXEC_RULES.txn.switchIn,
      TODAY, pre.preview.lands, pre.preview.buys, b.nav);
    const inId = (conn.prepare(`SELECT MAX(tr_id) n FROM transaction_master`).get() as { n: number }).n;
    return { outId, inId };
  });

  const { outId, inId } = run();
  emit(clientId, 'order', outId, 'order_switch', {
    from: a.name, to: b.name, amount, lands: pre.preview.lands,
    tax: cash(pre.preview.tax.ltcgTax + pre.preview.tax.stcgTax), out_txn: outId, in_txn: inId,
  });
  return { ok: true, result: { out_id: outId, in_id: inId, lands: pre.preview.lands, buys: pre.preview.buys } };
}

/* ── the recurring pair: money moving out on a schedule ───────────────────── */

export type Recurring = 'STP' | 'SWP';

export interface Plan {
  sip_id: number;
  kind: string;
  from: string | null;
  to: string | null;
  amount: number;
  day: number;
  started: string;
  live: boolean;
  step_up_amount: number | null;
  step_up_months: number | null;
  step_up_ceiling: number | null;
  /** What the instalment will be a year from now, if it steps up. */
  in_a_year: number;
}

export function plans(clientId: number): Plan[] {
  const rows = db().prepare(
    `SELECT s.sip_id, s.sip_type kind, s.tr_amount amount, s.day_of_sip day, s.start_date started,
            s.is_live_sip live, s.step_up_amount, s.step_up_months, s.step_up_ceiling,
            f.scheme_short_name "from", t.scheme_short_name "to"
     FROM sip_master s
     LEFT JOIN scheme_master f ON f.scheme_id = s.fk_from_scheme_id
     LEFT JOIN scheme_master t ON t.scheme_id = s.fk_to_scheme_id
     WHERE s.fk_acc_id = ? ORDER BY s.is_live_sip DESC, s.sip_id DESC`,
  ).all(clientId) as (Omit<Plan, 'live' | 'in_a_year'> & { live: number })[];

  return rows.map(r => {
    // Stepped forward the way it will actually rise: whole steps only, capped.
    let amount = r.amount;
    if (r.step_up_amount && r.step_up_months) {
      const steps = Math.floor(12 / r.step_up_months);
      amount = Math.min(r.step_up_ceiling ?? Infinity, r.amount + r.step_up_amount * steps);
    }
    return { ...r, live: !!r.live, in_a_year: Math.round(amount) };
  });
}

/**
 * An STP moves money between two of the client's own funds every month; an SWP
 * takes it out to their bank. Both are registered instructions rather than
 * transactions — nothing moves today, which is why neither writes to the ledger
 * here and both appear on the orders page as a plan rather than a receipt.
 */
export function startPlan(
  clientId: number, kind: Recurring, fromId: number, toId: number | null, amount: number, day: number,
): { ok: true; sipId: number } | Fail {
  const floor = kind === 'STP' ? EXEC_RULES.min_stp : EXEC_RULES.min_swp;
  if (amount < floor) return { ok: false, reason: `The smallest ${kind} the exchange accepts is ₹${floor} a month.` };
  if (day < 1 || day > 28) return { ok: false, reason: 'Pick a date between the 1st and the 28th — later dates fail in February.' };
  if (kind === 'STP' && !toId) return { ok: false, reason: 'A transfer needs a fund to move the money into.' };
  if (kind === 'STP' && toId === fromId) return { ok: false, reason: 'That is the same fund on both sides.' };

  const source = held(clientId, fromId);
  if (!source) return { ok: false, reason: 'You do not hold the fund this would draw from.' };
  // Twelve months of instalments out of a holding that cannot cover three is an
  // instruction that fails in public. Refused here, with the arithmetic said.
  if (source.value < amount * 3) {
    return { ok: false, reason: `₹${Math.round(source.value)} in that fund covers fewer than three instalments of ₹${amount}. Start smaller, or draw from a larger holding.` };
  }
  const folio = folioOf(clientId, fromId);
  if (!folio) return { ok: false, reason: 'No folio exists to register this against.' };

  const sb = (db().prepare(`SELECT fk_primary_sub_broker_id s FROM client_master WHERE cm_user_id = ?`)
    .get(clientId) as { s: number } | undefined)?.s ?? null;
  const r = db().prepare(
    `INSERT INTO sip_master
      (fk_acc_id, fk_from_scheme_id, fk_to_scheme_id, fk_sb_id, fk_freq_id, tr_folio_no,
       sip_type, tr_amount, day_of_sip, start_date, is_live_sip)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, 1)`,
  ).run(clientId, fromId, toId, sb, folio, kind, amount, day, TODAY);

  const sipId = Number(r.lastInsertRowid);
  emit(clientId, 'sip', sipId, `${kind.toLowerCase()}_started`, { from: fromId, to: toId, amount, day });
  return { ok: true, sipId };
}

/**
 * A step-up is the single highest-value thing a client can do to an instalment
 * and the one nobody does, because it means remembering. Registered once, it
 * happens on its own — which is the whole argument for it.
 */
export function stepUp(clientId: number, sipId: number, by: number, everyMonths: number, ceiling?: number):
  { ok: true; in_a_year: number } | Fail {
  const sip = db().prepare(
    `SELECT tr_amount amount, is_live_sip live, sip_type kind FROM sip_master WHERE sip_id = ? AND fk_acc_id = ?`,
  ).get(sipId, clientId) as { amount: number; live: number; kind: string } | undefined;
  if (!sip) return { ok: false, reason: 'That instalment is not one of yours.' };
  if (!sip.live) return { ok: false, reason: 'That instalment is not running, so there is nothing to step up.' };
  if (by <= 0) return { ok: false, reason: 'A step-up has to add something.' };
  if (![3, 6, 12].includes(everyMonths)) {
    return { ok: false, reason: 'A step-up runs every three, six or twelve months.' };
  }
  const cap = ceiling ?? sip.amount * EXEC_RULES.default_ceiling_multiple;
  if (cap <= sip.amount) return { ok: false, reason: 'The ceiling has to be above what you already pay.' };

  db().prepare(
    `UPDATE sip_master SET step_up_amount = ?, step_up_months = ?, step_up_ceiling = ? WHERE sip_id = ?`,
  ).run(by, everyMonths, cap, sipId);
  emit(clientId, 'sip', sipId, 'sip_step_up_set', { by, everyMonths, ceiling: cap });

  const steps = Math.floor(12 / everyMonths);
  return { ok: true, in_a_year: Math.round(Math.min(cap, sip.amount + by * steps)) };
}

/** Stops a step-up without stopping the instalment under it. */
export function clearStepUp(clientId: number, sipId: number): boolean {
  const owned = db().prepare(`SELECT sip_id FROM sip_master WHERE sip_id = ? AND fk_acc_id = ?`).get(sipId, clientId);
  if (!owned) return false;
  db().prepare(
    `UPDATE sip_master SET step_up_amount = NULL, step_up_months = NULL, step_up_ceiling = NULL WHERE sip_id = ?`,
  ).run(sipId);
  emit(clientId, 'sip', sipId, 'sip_step_up_cleared', {});
  return true;
}

/** Ends a plan of any kind. The same door SIPs already use. */
export function stopPlan(clientId: number, sipId: number, why: string): boolean {
  const owned = db().prepare(`SELECT sip_type k FROM sip_master WHERE sip_id = ? AND fk_acc_id = ?`)
    .get(sipId, clientId) as { k: string } | undefined;
  if (!owned) return false;
  db().prepare(`UPDATE sip_master SET is_live_sip = 0, cease_date = ?, termination_remarks = ? WHERE sip_id = ?`)
    .run(TODAY, why.slice(0, 200), sipId);
  emit(clientId, 'sip', sipId, `${owned.k.toLowerCase()}_stopped`, { why });
  return true;
}

/** Every ORDER_RULES threshold this file leans on, re-exported so a page reads one source. */
export const FLOORS = {
  sip: ORDER_RULES.min_sip, lumpsum: ORDER_RULES.min_lumpsum,
  stp: EXEC_RULES.min_stp, swp: EXEC_RULES.min_swp, switch: EXEC_RULES.min_switch,
} as const;
