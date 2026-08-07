import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { Figure, figure } from './queries';

// Every figure on My earnings resolves to `brokerage_master` rows, and every one
// of those rows names the folio, scheme and month that produced it. That is the
// point of this page: a broker can follow any rupee back to the client whose
// money earned it. Nothing here is an allocation of a monthly lump sum.
//
// Founder ruling (07-Aug-2026): show the broker their own chain and their tier
// position, never the firm's rupee margin. So `bkr_amount` (what the AMC paid the
// firm) drives the variance check but is never rendered as a headline figure.

export const EARNINGS_RULES = {
  gst_pct: 18,
  tds_pct: 5,
  /** sb_fy_brokerage_tracker flags a broker crossing this in a financial year. */
  fy_threshold: 2000000,
  /** An exit inside this window claws back trail already paid. */
  clawback_window_days: 365,
} as const;

export const THIS_MONTH = TODAY.slice(0, 7) + '-01';

/** The months this broker actually has commission for — no invented continuity. */
export function months(sbId: number): string[] {
  return (db().prepare(`SELECT DISTINCT bkr_from_date m FROM brokerage_master
    WHERE fk_sb_id=? ORDER BY m DESC`).all(sbId) as { m: string }[]).map(r => r.m);
}

export interface Ladder {
  trail: number; clawback: number; gross: number; gst: number; tds: number; net: number;
  hasGst: boolean; tierName: string; tierPct: number; lines: number; aum: number;
}

const LADDER_SQL = `SELECT
  COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=1 THEN b.bkr_payout_amount END),0) trail,
  COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=4 THEN b.bkr_payout_amount END),0) clawback,
  COALESCE(SUM(b.bkr_payout_amount),0) gross,
  COALESCE(SUM(b.payout_gst_amount),0) gst,
  COALESCE(SUM(b.payout_tds),0) tds,
  COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=1 THEN b.tr_amount END),0) aum,
  COUNT(*) lines,
  MAX(b.has_gst) hasGst, MAX(b.bkr_payout_rate_precentage) tierPct,
  (SELECT cat_category_name FROM sub_broker_category_master c
     JOIN sub_broker_master s ON s.fk_cat_id=c.cat_id WHERE s.sb_id=b.fk_sb_id) tierName
FROM brokerage_master b WHERE b.fk_sb_id=? AND b.bkr_from_date=?`;

// SQLite hands back has_gst as 0/1 and knows nothing about `net`; both are
// resolved in TypeScript, so the row shape differs from what callers see.
type LadderRow = Omit<Ladder, 'hasGst' | 'net'> & { hasGst: number };

/** The whole payout arithmetic for one month, shown rung by rung. */
export function ladder(sbId: number, month: string): Figure<Ladder> {
  const f = figure<LadderRow>(LADDER_SQL,
    ['brokerage_master.bkr_payout_amount', '.payout_gst_amount', '.payout_tds', '.bkr_payout_rate_precentage', '.tr_amount'],
    'computed', [sbId, month]);
  const v = f.value;
  const net = Math.round((v.gross + v.gst - v.tds) * 100) / 100;
  return { ...f, value: { ...v, hasGst: v.hasGst === 1, net } };
}

export interface Tier { name: string; pct: number }
export interface TierStep { current: Tier; next: Tier | null; upliftPerMonth: number }

/**
 * Where this broker sits on the payout ladder and what the next rung is worth.
 * Deliberately expressed as their uplift, not as the firm's retained share.
 */
export function tierStep(sbId: number, month: string): Figure<TierStep> {
  const sql = `SELECT c.cat_category_name name, p.trail_1st_yr_pct pct
    FROM broker_category_payout_pct_master p
    JOIN sub_broker_category_master c ON c.cat_id = p.fk_sb_category_id
    WHERE p.is_active = 1 ORDER BY p.trail_1st_yr_pct`;
  const tiers = db().prepare(sql).all() as Tier[];
  const l = ladder(sbId, month).value;
  const current = tiers.find(t => t.pct === l.tierPct) ?? { name: '—', pct: l.tierPct };
  const next = tiers.find(t => t.pct > current.pct) ?? null;
  // Their trail at the current rate implies the AMC receipt; re-rate it at the
  // next rung to price the step. No firm-side figure is produced or shown.
  const uplift = next && current.pct > 0
    ? Math.round(((l.trail / current.pct) * next.pct - l.trail) * 100) / 100
    : 0;
  return {
    value: { current, next, upliftPerMonth: uplift }, tag: 'rule', sql,
    sources: ['broker_category_payout_pct_master.trail_1st_yr_pct', 'sub_broker_category_master.cat_category_name'],
  };
}

export interface MonthPoint { month: string; net: number; trail: number; clawback: number }

/** The 14-month earnings series, straight off the commission rows. */
export function series(sbId: number): Figure<MonthPoint[]> {
  const sql = `SELECT bkr_from_date month,
      COALESCE(SUM(CASE WHEN fk_bkr_type_id=1 THEN bkr_payout_amount END),0) trail,
      COALESCE(SUM(CASE WHEN fk_bkr_type_id=4 THEN bkr_payout_amount END),0) clawback,
      COALESCE(SUM(bkr_payout_amount + payout_gst_amount - payout_tds),0) net
    FROM brokerage_master WHERE fk_sb_id=? GROUP BY 1 ORDER BY 1`;
  return {
    value: db().prepare(sql).all(sbId) as MonthPoint[], tag: 'computed', sql,
    sources: ['brokerage_master.bkr_from_date', '.bkr_payout_amount', '.payout_gst_amount', '.payout_tds'],
  };
}

export interface ClientEarning {
  client_id: number; name: string; lines: number; aum: number; payout: number; clawback: number;
}

/** Which clients paid this month's commission. Every row drills to its folios. */
export function byClient(sbId: number, month: string): Figure<ClientEarning[]> {
  const sql = `SELECT f.fk_acc_id client_id, c.cm_full_name name, COUNT(*) lines,
      COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=1 THEN b.tr_amount END),0) aum,
      COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=1 THEN b.bkr_payout_amount END),0) payout,
      COALESCE(SUM(CASE WHEN b.fk_bkr_type_id=4 THEN b.bkr_payout_amount END),0) clawback
    FROM brokerage_master b
    JOIN folio_master f ON f.folio_id = b.fk_folio_id
    JOIN client_master c ON c.cm_user_id = f.fk_acc_id
    WHERE b.fk_sb_id=? AND b.bkr_from_date=?
    GROUP BY 1 ORDER BY payout DESC`;
  return {
    value: db().prepare(sql).all(sbId, month) as ClientEarning[], tag: 'computed', sql,
    sources: ['brokerage_master.fk_folio_id', '.bkr_payout_amount', 'folio_master.fk_acc_id', 'client_master.cm_full_name'],
  };
}

export interface FolioLine {
  bkr_id: number; folio_no: string; scheme: string; amc: string; units: number;
  aum: number; paid_pct: number; agreed_pct: number; payout: number; reco_status: number; type: string;
}

/** The commission lines behind one client — the level the RTA actually sends. */
export function clientLines(sbId: number, month: string, clientId: number): FolioLine[] {
  return db().prepare(`SELECT b.bkr_id, b.bkr_folio_no folio_no, s.scheme_full_name scheme, a.amc_name amc,
      b.bkr_units units, b.tr_amount aum, b.bkr_percentage paid_pct, b.calc_rate agreed_pct,
      b.bkr_payout_amount payout, b.reco_status, t.brk_type_name type
    FROM brokerage_master b
    JOIN folio_master f ON f.folio_id = b.fk_folio_id
    JOIN scheme_master s ON s.scheme_id = b.fk_scheme_id
    JOIN amc_master a ON a.amc_id = s.fk_amc_id
    JOIN brokerage_type_master t ON t.brk_type_id = b.fk_bkr_type_id
    WHERE b.fk_sb_id=? AND b.bkr_from_date=? AND f.fk_acc_id=?
    ORDER BY b.bkr_payout_amount DESC`).all(sbId, month, clientId) as FolioLine[];
}

export interface SchemeEarning { scheme: string; amc: string; lines: number; aum: number; payout: number }

export function byScheme(sbId: number, month: string): Figure<SchemeEarning[]> {
  const sql = `SELECT s.scheme_full_name scheme, a.amc_name amc, COUNT(*) lines,
      SUM(b.tr_amount) aum, SUM(b.bkr_payout_amount) payout
    FROM brokerage_master b
    JOIN scheme_master s ON s.scheme_id = b.fk_scheme_id
    JOIN amc_master a ON a.amc_id = s.fk_amc_id
    WHERE b.fk_sb_id=? AND b.bkr_from_date=? AND b.fk_bkr_type_id=1
    GROUP BY 1,2 ORDER BY payout DESC`;
  return {
    value: db().prepare(sql).all(sbId, month) as SchemeEarning[], tag: 'computed', sql,
    sources: ['brokerage_master.fk_scheme_id', '.tr_amount', '.bkr_payout_amount', 'scheme_master.scheme_full_name'],
  };
}

export interface Clawback {
  bkr_id: number; month: string; amount: number; client_id: number; client: string;
  scheme: string; folio_no: string; redeemed_on: string; redeemed_amount: number; held_days: number;
}

/** Every clawback names the redemption that caused it. None is unexplained. */
export function clawbacks(sbId: number): Figure<Clawback[]> {
  const sql = `SELECT b.bkr_id, b.bkr_from_date month, b.bkr_payout_amount amount,
      f.fk_acc_id client_id, c.cm_full_name client, s.scheme_full_name scheme, b.bkr_folio_no folio_no,
      t.tr_date redeemed_on, t.tr_amount redeemed_amount,
      CAST(julianday(t.tr_date) - julianday(f.folio_start_date) AS INTEGER) held_days
    FROM brokerage_master b
    JOIN folio_master f ON f.folio_id = b.fk_folio_id
    JOIN client_master c ON c.cm_user_id = f.fk_acc_id
    JOIN scheme_master s ON s.scheme_id = b.fk_scheme_id
    JOIN transaction_master t ON t.tr_id = b.clawback_source_txn
    WHERE b.fk_sb_id=? AND b.fk_bkr_type_id=4
    ORDER BY b.bkr_from_date DESC, b.bkr_payout_amount`;
  return {
    value: db().prepare(sql).all(sbId) as Clawback[], tag: 'computed', sql,
    sources: ['brokerage_master.clawback_source_txn', '.bkr_payout_amount', 'transaction_master.tr_date', 'folio_master.folio_start_date'],
  };
}

export interface Variance {
  amc: string; scheme_category: string; agreed_bps: number; paid_bps: number;
  months: number; lines: number; shortfall: number; since: string; doc: string;
}

/**
 * What the AMC actually paid against what was agreed on paper. This is the
 * commercial-terms check `amc_rate_card` exists for — the shortfall is stated in
 * what it cost the broker, at their own rate.
 */
export function variance(sbId: number): Figure<Variance[]> {
  const sql = `SELECT a.amc_name amc,
      CASE WHEN sm.fk_category_id <= 5 THEN 'Equity' ELSE 'Non-Equity' END scheme_category,
      ROUND(MAX(b.calc_rate) * 100) agreed_bps, ROUND(MIN(b.bkr_percentage) * 100) paid_bps,
      COUNT(DISTINCT b.bkr_from_date) months, COUNT(*) lines,
      ROUND(SUM(b.reco_difference) * MAX(b.bkr_payout_rate_precentage) / 100, 2) shortfall,
      MIN(b.bkr_from_date) since, MAX(rc.source_doc_ref) doc
    FROM brokerage_master b
    JOIN scheme_master sm ON sm.scheme_id = b.fk_scheme_id
    JOIN amc_master a ON a.amc_id = sm.fk_amc_id
    LEFT JOIN amc_rate_card rc ON rc.amc_id = sm.fk_amc_id
      AND rc.scheme_category = CASE WHEN sm.fk_category_id <= 5 THEN 'Equity' ELSE 'Non-Equity' END
    WHERE b.fk_sb_id=? AND b.reco_status=2
    GROUP BY 1,2 ORDER BY shortfall`;
  return {
    value: db().prepare(sql).all(sbId) as Variance[], tag: 'rule', sql,
    sources: ['brokerage_master.reco_status', '.reco_difference', '.bkr_percentage', '.calc_rate', 'amc_rate_card.agreed_trail_bps', '.source_doc_ref'],
  };
}

/** The exact rows a dispute would cite, so the form carries ids, not prose. */
export function shortPaidRowIds(sbId: number): number[] {
  return (db().prepare('SELECT bkr_id FROM brokerage_master WHERE fk_sb_id=? AND reco_status=2 ORDER BY bkr_id')
    .all(sbId) as { bkr_id: number }[]).map(r => r.bkr_id);
}

export interface Invoice {
  invoice_id: number; invoice_no: string; period_start_date: string; invoice_date: string;
  sub_total: number; cgst: number; sgst: number; tds: number; total_amount: number;
  payment_date: string | null; lines: number;
}

export function invoices(sbId: number): Figure<Invoice[]> {
  const sql = `SELECT i.invoice_id, i.invoice_no, i.period_start_date, i.invoice_date,
      i.sub_total, i.cgst, i.sgst, i.tds, i.total_amount, i.payment_date,
      (SELECT COUNT(*) FROM brokerage_master b WHERE b.fk_invoice_id = i.invoice_id) lines
    FROM invoice_master i WHERE i.fk_sb_id=? ORDER BY i.period_start_date DESC`;
  return {
    value: db().prepare(sql).all(sbId) as Invoice[], tag: 'computed', sql,
    sources: ['invoice_master.sub_total', '.cgst', '.sgst', '.tds', '.total_amount', '.payment_date'],
  };
}

export interface FyTracker { financial_year: string; cumulative_payout: number; threshold_crossed: number; crossing_month: string | null }

export function fyTracker(sbId: number): Figure<FyTracker> {
  const sql = `SELECT financial_year, cumulative_payout, threshold_crossed, crossing_month
    FROM sb_fy_brokerage_tracker WHERE fk_sb_id=?`;
  return figure(sql, ['sb_fy_brokerage_tracker.cumulative_payout', '.threshold_crossed'], 'computed', [sbId]);
}

export interface Dispute {
  dispute_id: number; reason: string; state: string; raised_at: string;
  resolved_at: string | null; resolution_note: string | null; action_id: number | null; rows: number;
}

export function disputes(sbId: number): Dispute[] {
  return (db().prepare(`SELECT dispute_id, brokerage_row_refs, reason, state, raised_at,
      resolved_at, resolution_note, action_id
    FROM payout_disputes WHERE sb_id=? ORDER BY dispute_id DESC`).all(sbId) as
    (Omit<Dispute, 'rows'> & { brokerage_row_refs: string })[])
    .map(d => ({ ...d, rows: (JSON.parse(d.brokerage_row_refs) as number[]).length }));
}

/** Buckets the backend carries but MF regular plans do not fill. Stated, not hidden. */
export function emptyBuckets(sbId: number): string[] {
  const used = new Set((db().prepare(`SELECT DISTINCT t.brk_type_name n FROM brokerage_master b
    JOIN brokerage_type_master t ON t.brk_type_id=b.fk_bkr_type_id WHERE b.fk_sb_id=?`)
    .all(sbId) as { n: string }[]).map(r => r.n));
  return (db().prepare('SELECT brk_type_name n FROM brokerage_type_master ORDER BY brk_type_id')
    .all() as { n: string }[]).map(r => r.n).filter(n => !used.has(n));
}
