import { db } from './db';
import { TODAY, addDays } from '../mockdb/engines';

/* ── The plumbing under an instalment ────────────────────────────────────────
   Phase 5, the half that is not a transaction: the bank permission that lets a
   monthly instalment happen, a fund still in its offer period, what happens to
   a dividend, and the duplicate folios a long client accumulates.

   None of this is interesting, and all of it is where a plan quietly dies. The
   commonest failure in this whole product is not a bad fund — it is a mandate
   that expired and a client who found out from a statement three months later.  */

export const MANDATE_RULES = {
  /** A mandate is registered for this long, then has to be renewed. */
  years: 5,
  /** The exchange refuses a cap below the instalment it has to cover. */
  min_cap: 500,
  /** Renewal is offered from this far out — early enough to act, late enough to matter. */
  warn_days: 120,
  version: 'mandate-v1 (14-Aug-2026)',
} as const;

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

function uccOf(clientId: number): string | null {
  return (db().prepare(`SELECT acc_bse_code c FROM accounts_master WHERE fk_cm_user_id = ?`)
    .get(clientId) as { c: string } | undefined)?.c ?? null;
}

function emit(clientId: number, subject: string, id: number | string, type: string, payload: object): void {
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, ?, ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(clientId), subject, String(id), type, JSON.stringify(payload));
}

/* ── the bank permission ──────────────────────────────────────────────────── */

export interface Mandate {
  id: number;
  exch_id: number;
  umrn: string | null;
  bank: string | null;
  cap: number;
  type: string;
  status: string;
  start: string | null;
  end: string | null;
  /** Negative once it has lapsed. */
  days_left: number | null;
  expiring: boolean;
  lapsed: boolean;
  /** What is riding on it every month. */
  covers: number;
  /** True when the instalments it covers exceed the cap it was registered for. */
  under_capped: boolean;
}

export function mandates(clientId: number): Mandate[] {
  const ucc = uccOf(clientId);
  if (!ucc) return [];
  const rows = db().prepare(
    `SELECT m.id, m.exch_mandate_id exch_id, m.umrn, m.bank_name bank, m.amount cap,
            m.type, m.status, m.start_date start, m.end_date "end",
            COALESCE((SELECT SUM(s.tr_amount) FROM bse_sxp_list x
                      JOIN sip_master s ON s.sxp_bos_code = x.reg_no AND s.is_live_sip = 1
                      WHERE x.exch_mandate_id = m.exch_mandate_id), 0) covers
     FROM bse_mandate_list m WHERE m.ucc = ? ORDER BY m.end_date`,
  ).all(ucc) as (Omit<Mandate, 'days_left' | 'expiring' | 'lapsed' | 'under_capped'>)[];

  return rows.map(r => {
    const left = r.end ? days(TODAY, r.end) : null;
    return {
      ...r,
      days_left: left,
      lapsed: left != null && left < 0,
      expiring: left != null && left >= 0 && left <= MANDATE_RULES.warn_days,
      under_capped: r.covers > r.cap,
    };
  });
}

export type Fail = { ok: false; reason: string };

/**
 * A new bank permission. The cap is the most that may ever be debited in one
 * go — set it at the instalment and the first step-up bounces, which is why the
 * screen asks for headroom rather than the exact figure.
 *
 * ponytail: the live build hands off to the bank's own NACH or e-mandate
 * journey and takes back a UMRN days later. Here it is registered at once and
 * the receipt says which of those two things happened.
 */
export function createMandate(clientId: number, bank: string, cap: number):
  { ok: true; id: number; umrn: string } | Fail {
  const ucc = uccOf(clientId);
  if (!ucc) return { ok: false, reason: 'This account has no exchange code yet, so no mandate can be registered.' };
  if (cap < MANDATE_RULES.min_cap) {
    return { ok: false, reason: `A mandate has to be for at least ₹${MANDATE_RULES.min_cap} a debit.` };
  }
  if (!/^[A-Za-z][A-Za-z .&'-]{2,49}$/.test(bank.trim())) {
    return { ok: false, reason: 'Name the bank the money will leave from.' };
  }
  const exch = ((db().prepare(`SELECT COALESCE(MAX(exch_mandate_id), 80000) n FROM bse_mandate_list`)
    .get() as { n: number }).n) + 1;
  const umrn = `UMRN${900000 + exch}`;
  const end = addDays(TODAY, 365 * MANDATE_RULES.years);
  const r = db().prepare(
    `INSERT INTO bse_mandate_list
      (exch_mandate_id, ucc, amount, type, status, umrn, bank_name, start_date, end_date, audit_trail)
     VALUES (?, ?, ?, 'E-MANDATE', 'APPROVED', ?, ?, ?, ?, 'registered→approved (app)')`,
  ).run(exch, ucc, cap, umrn, bank.trim(), TODAY, end);

  emit(clientId, 'mandate', exch, 'mandate_created', { bank: bank.trim(), cap, umrn, end });
  return { ok: true, id: Number(r.lastInsertRowid), umrn };
}

/**
 * Renewal. Deliberately a new registration rather than a date bumped in place:
 * a bank issues a fresh UMRN, and rewriting the old row would erase the fact
 * that instalments between the lapse and the renewal never had permission.
 */
export function renewMandate(clientId: number, exchId: number): { ok: true; umrn: string } | Fail {
  const ucc = uccOf(clientId);
  const old = db().prepare(
    `SELECT bank_name bank, amount cap FROM bse_mandate_list WHERE exch_mandate_id = ? AND ucc = ?`,
  ).get(exchId, ucc) as { bank: string; cap: number } | undefined;
  if (!old) return { ok: false, reason: 'That mandate is not one of yours.' };

  db().prepare(
    `UPDATE bse_mandate_list SET status = 'REPLACED', audit_trail = audit_trail || ' →replaced ' || ?
     WHERE exch_mandate_id = ?`,
  ).run(TODAY, exchId);
  const made = createMandate(clientId, old.bank ?? 'Bank', old.cap);
  if (!made.ok) return made;
  emit(clientId, 'mandate', exchId, 'mandate_renewed', { replaced_by: made.umrn });
  return { ok: true, umrn: made.umrn };
}

/* ── a fund that has no price yet ─────────────────────────────────────────── */

export interface Nfo {
  scheme_id: number; name: string; amc: string; category: string;
  opens_on: string; closes_on: string; face_value: number; min_amount: number;
  objective: string | null;
  days_left: number;
}

/** Funds whose offer period includes today. */
export function openNfos(): Nfo[] {
  return db().prepare(
    `SELECT n.fk_scheme_id scheme_id, s.scheme_short_name name, a.amc_name amc, c.category_name category,
            n.opens_on, n.closes_on, n.face_value, n.min_amount, n.objective
     FROM nfo_window n
     JOIN scheme_master s ON s.scheme_id = n.fk_scheme_id
     JOIN amc_master a ON a.amc_id = s.fk_amc_id
     JOIN category_master c ON c.category_id = s.fk_category_id
     WHERE n.opens_on <= ? AND n.closes_on >= ? ORDER BY n.closes_on`,
  ).all(TODAY, TODAY).map(r => {
    const n = r as Omit<Nfo, 'days_left'>;
    return { ...n, days_left: days(TODAY, n.closes_on) };
  });
}

/**
 * An application, not a purchase. Units are allotted at face value when the
 * window shuts, so there is no NAV to price against today and nothing lands in
 * the holdings table until then. The receipt says exactly that, because a client
 * who sees nothing in their portfolio after paying will assume it failed.
 */
export function applyNfo(clientId: number, schemeId: number, amount: number):
  { ok: true; units: number; allots_on: string } | Fail {
  const n = openNfos().find(x => x.scheme_id === schemeId);
  if (!n) return { ok: false, reason: 'That fund is not in its offer period.' };
  if (amount < n.min_amount) {
    return { ok: false, reason: `The smallest application for this offer is ₹${n.min_amount}.` };
  }
  const folio = (db().prepare(`SELECT fm_folio_no f FROM folio_master WHERE fk_acc_id = ? LIMIT 1`)
    .get(clientId) as { f: string } | undefined)?.f;
  if (!folio) return { ok: false, reason: 'No folio exists to apply against.' };

  const units = Math.round((amount / n.face_value) * 10000) / 10000;
  // Dated the day the window shuts. The ledger refuses a future date, so this is
  // recorded as an application event and becomes a transaction at allotment —
  // which is the truth, and also why the holdings page does not show it yet.
  emit(clientId, 'order', schemeId, 'nfo_applied', {
    scheme: n.name, amount, units, face_value: n.face_value, allots_on: n.closes_on, folio,
  });
  return { ok: true, units, allots_on: n.closes_on };
}

/* ── what happens when the fund declares something ────────────────────────── */

export type DividendOption = 'growth' | 'payout' | 'reinvest';

export const DIVIDEND_WORDS: Record<DividendOption, string> = {
  growth: 'Nothing is paid out. Everything the fund earns stays in and compounds — the default, and the right one for most goals more than three years away.',
  payout: 'Declared income is paid to your bank. It is taxed at your slab in the year it is paid, and the fund\'s value drops by what it pays.',
  reinvest: 'Declared income buys more units of the same fund. Taxed exactly as a payout is, then reinvested — so there is a tax bill with no cash arriving to pay it.',
};

export function dividendOptions(clientId: number): { scheme_id: number; fund: string; folio: string; option: DividendOption }[] {
  return db().prepare(
    `SELECT f.fk_scheme_id scheme_id, s.scheme_short_name fund, f.fm_folio_no folio,
            COALESCE(f.fm_dividend_option, 'growth') option
     FROM folio_master f JOIN scheme_master s ON s.scheme_id = f.fk_scheme_id
     WHERE f.fk_acc_id = ? AND f.is_active = 1
     ORDER BY s.scheme_short_name`,
  ).all(clientId) as { scheme_id: number; fund: string; folio: string; option: DividendOption }[];
}

export function setDividendOption(clientId: number, folio: string, schemeId: number, option: DividendOption):
  { ok: true } | Fail {
  if (!['growth', 'payout', 'reinvest'].includes(option)) return { ok: false, reason: 'Unknown option.' };
  const r = db().prepare(
    `UPDATE folio_master SET fm_dividend_option = ?
     WHERE fk_acc_id = ? AND fm_folio_no = ? AND fk_scheme_id = ?`,
  ).run(option, clientId, folio, schemeId);
  if (!r.changes) return { ok: false, reason: 'That folio is not one of yours.' };
  emit(clientId, 'folio', folio, 'dividend_option_set', { scheme: schemeId, option });
  return { ok: true };
}

/* ── the folios a long client accumulates ─────────────────────────────────── */

export interface DuplicateFolio {
  scheme_id: number; fund: string;
  folios: { folio_no: string; value: number; since: string | null }[];
  total: number;
}

/**
 * The same fund held twice under two folio numbers. It happens when an
 * application is filed without the existing folio quoted, and it costs the
 * client nothing except that every statement, every tax computation and every
 * exit is done twice. Consolidation is registrar work and needs a person, so
 * this only ever finds them — it never merges anything.
 */
export function duplicateFolios(clientId: number): DuplicateFolio[] {
  const rows = db().prepare(
    `SELECT f.scheme_id, f.fund_name fund, f.folio_no, ROUND(f.present_market_value) value,
            f.inv_since_date since
     FROM fifo_summary_holding_active f
     WHERE f.client_id = ? AND f.scheme_id IN (
       SELECT scheme_id FROM fifo_summary_holding_active
       WHERE client_id = ? GROUP BY scheme_id HAVING COUNT(DISTINCT folio_no) > 1)
     ORDER BY f.scheme_id, f.present_market_value DESC`,
  ).all(clientId, clientId) as
    { scheme_id: number; fund: string; folio_no: string; value: number; since: string | null }[];

  const by = new Map<number, DuplicateFolio>();
  for (const r of rows) {
    const at = by.get(r.scheme_id) ?? { scheme_id: r.scheme_id, fund: r.fund, folios: [], total: 0 };
    at.folios.push({ folio_no: r.folio_no, value: r.value, since: r.since });
    at.total += r.value;
    by.set(r.scheme_id, at);
  }
  return [...by.values()];
}
