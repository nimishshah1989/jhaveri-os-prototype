import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* ── The Desk ────────────────────────────────────────────────────────────────
   research/14 §12.7: "Tax is a statement, not a plan. Everyone offers a
   capital-gains download; only Kuvera, Scripbox and INDmoney do anything
   forward-looking. For an HNI, tax-aware sequencing is worth more than the
   return difference between two large-cap funds." So this looks forward. */

const LTCG_EXEMPT = 125000;   // equity long-term gains free of tax each financial year
const LT_DAYS = 365;
const ELSS_LOCK_YEARS = 3;

const addYears = (iso: string, n: number) => {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + n);
  return d.toISOString().slice(0, 10);
};
const fyOf = (iso: string) => {
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return `${m >= 4 ? y : y - 1}–${String(m >= 4 ? y + 1 : y).slice(2)}`;
};

export interface Unlock { d: string; fund: string; value: number; units: number; days: number }
export interface FreeFrom { scheme_id: number; fund: string; load: number; lockedValue: number; nextFree: string | null; allFreeBy: string | null }

export interface TaxAhead {
  fy: string;
  unlocks: Unlock[];
  exit: FreeFrom[];
  unrealLt: number; unrealSt: number; realLt: number;
  exempt: number; headroom: number; taxableIfAllSold: number;
}

/** Dates ahead, not proofs behind: when money unlocks, when a fee stops, what is free to take. */
export function taxAhead(clientId: number): TaxAhead {
  const lots = db().prepare(
    `SELECT d.fk_scheme_id sid, sm.scheme_short_name fund, cm.category_name category,
            d.dhl_purchase_date bought, d.dhl_purchase_units units, d.dhl_current_value value,
            d.dhl_holding_days days, d.dhl_unrealized_ltcg lt, d.dhl_unrealized_stcg st,
            sm.scheme_exit_load load
     FROM fifo_detail_holding_latest d
     JOIN scheme_master sm ON sm.scheme_id = d.fk_scheme_id
     JOIN category_master cm ON cm.category_id = sm.fk_category_id
     WHERE d.fk_acc_id = ? ORDER BY d.dhl_purchase_date`,
  ).all(clientId) as {
    sid: number; fund: string; category: string; bought: string; units: number;
    value: number; days: number; lt: number; st: number; load: number;
  }[];

  const unlocks: Unlock[] = lots
    .filter(l => /ELSS/i.test(l.category))
    .map(l => ({
      d: addYears(l.bought, ELSS_LOCK_YEARS), fund: l.fund, value: Math.round(l.value),
      units: l.units, days: Math.round((Date.parse(addYears(l.bought, ELSS_LOCK_YEARS)) - Date.parse(TODAY)) / 864e5),
    }))
    .filter(u => u.days > 0)
    .sort((a, b) => (a.d < b.d ? -1 : 1));

  const bySid = new Map<number, typeof lots>();
  for (const l of lots) bySid.set(l.sid, [...(bySid.get(l.sid) ?? []), l]);
  const exit: FreeFrom[] = [...bySid.entries()].map(([sid, ls]) => {
    const locked = ls.filter(l => l.days < LT_DAYS && !/ELSS/i.test(l.category));
    return {
      scheme_id: sid, fund: ls[0].fund, load: ls[0].load,
      lockedValue: Math.round(locked.reduce((s, l) => s + l.value, 0)),
      nextFree: locked.length ? addYears(locked[0].bought, 1) : null,
      allFreeBy: locked.length ? addYears(locked[locked.length - 1].bought, 1) : null,
    };
  });

  const unrealLt = lots.reduce((s, l) => s + l.lt, 0);
  const unrealSt = lots.reduce((s, l) => s + l.st, 0);
  const realLt = (db().prepare(
    `SELECT COALESCE(SUM(sh_realized_ltcg),0) v FROM fifo_summary_holding WHERE fk_acc_id=?`,
  ).get(clientId) as { v: number }).v;
  const headroom = Math.max(0, LTCG_EXEMPT - Math.max(0, realLt));

  return {
    fy: fyOf(TODAY), unlocks, exit,
    unrealLt: Math.round(unrealLt), unrealSt: Math.round(unrealSt), realLt: Math.round(realLt),
    exempt: LTCG_EXEMPT, headroom: Math.round(headroom),
    taxableIfAllSold: Math.round(Math.max(0, unrealLt - headroom)),
  };
}

export interface Earned { folio: string; fund: string; plan: 'Direct' | 'Regular'; months: number; total: number }
export interface Fee { rows: Earned[]; regularTotal: number; directBooked: number; bps: number; source: string; runRate: number }

/**
 * What Jhaveri is paid on this client, folio by folio. A Direct plan pays a
 * distributor nothing — that is the definition of Direct — so the page prints ₹0
 * for those and names our own ledger as the fault where it disagrees.
 */
export function feeOnMe(clientId: number): Fee {
  const rows = db().prepare(
    `SELECT b.bkr_folio_no folio, sm.scheme_short_name fund,
            COUNT(*) months, ROUND(SUM(b.bkr_amount), 2) total
     FROM brokerage_master b
     JOIN folio_master f ON f.fm_folio_no = b.bkr_folio_no
     JOIN scheme_master sm ON sm.scheme_id = b.fk_scheme_id
     WHERE f.fk_acc_id = ? GROUP BY b.bkr_folio_no ORDER BY total DESC`,
  ).all(clientId) as { folio: string; fund: string; months: number; total: number }[];
  const card = db().prepare(
    `SELECT agreed_trail_bps bps, source_doc_ref src FROM amc_rate_card WHERE scheme_category='Equity' ORDER BY effective_from DESC LIMIT 1`,
  ).get() as { bps: number; src: string };
  const held = db().prepare(
    `SELECT scheme_id, fund_name, present_market_value v FROM fifo_summary_holding_active WHERE client_id=?`,
  ).all(clientId) as { scheme_id: number; fund_name: string; v: number }[];

  const out: Earned[] = rows.map(r => ({
    ...r, plan: /Dir/.test(r.fund) ? 'Direct' : 'Regular',
  }));
  return {
    rows: out,
    regularTotal: out.filter(r => r.plan === 'Regular').reduce((s, r) => s + r.total, 0),
    directBooked: out.filter(r => r.plan === 'Direct').reduce((s, r) => s + r.total, 0),
    bps: card.bps, source: card.src,
    runRate: held.filter(h => !/Dir/.test(h.fund_name)).reduce((s, h) => s + h.v * card.bps / 10000, 0),
  };
}

export interface Consent { channel: string; purpose: string; state: string; via: string; ts: string }

/** research/14 §13.6 — the permission model is the differentiator, so it is visible. */
export function consents(clientId: number): Consent[] {
  return db().prepare(
    `SELECT channel, purpose, state, captured_via via, ts FROM consents WHERE client_id=? ORDER BY ts DESC`,
  ).all(clientId) as Consent[];
}
