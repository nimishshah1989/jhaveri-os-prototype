import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { Figure, figure } from './queries';

// My business answers one question: is the book growing because this broker is
// working, or because the market went up? Everything here is built so that
// question has a provable answer — the monthly AUM rows carry opening, net flows
// and market movement, and opening + flows + market == closing to the rupee.

export const BUSINESS_RULES = {
  /** Window for the SIP bounce rate. */
  bounce_window_months: 6,
  /** A mandate inside this many days of expiry is at risk. */
  mandate_expiry_days: 45,
  /**
   * Ruling 7: the firm reports peak-day monthly AUM, and every monthly figure
   * must say which definition it uses. Month-end is carried beside it because
   * only month-end makes the growth identity hold exactly.
   */
  aum_definition: 'peak-day (highest daily AUM in the month)',
} as const;

export interface MonthAum {
  month: string; peak_day_aum: number; peak_date: string; month_end_aum: number;
  opening_aum: number; net_flows: number; market_movement: number; client_count: number;
}

/** The 14-month AUM spine, with growth already split into flows vs market. */
export function aumSeries(sbId: number): Figure<MonthAum[]> {
  const sql = `SELECT month, peak_day_aum, peak_date, month_end_aum, opening_aum,
      net_flows, market_movement, client_count
    FROM mv_monthly_aum WHERE sb_id=? ORDER BY month`;
  return {
    value: db().prepare(sql).all(sbId) as MonthAum[], tag: 'computed', sql,
    sources: ['mv_monthly_aum.peak_day_aum', '.month_end_aum', '.net_flows', '.market_movement'],
  };
}

/** Today's book, off the daily spine — the same number My clients totals. */
export function bookNow(sbId: number): Figure<{ aum: number; clients: number; as_of: string }> {
  const sql = `SELECT aum, client_count clients, aum_date as_of FROM mv_aum_daily
    WHERE sb_id=? ORDER BY aum_date DESC LIMIT 1`;
  return figure(sql, ['mv_aum_daily.aum', '.client_count', '.aum_date'], 'computed', [sbId]);
}

export interface Growth {
  from: string; to: string; opening: number; flows: number; market: number; closing: number;
  flowsPct: number; marketPct: number;
}

/** The whole window as one waterfall. The identity is the point of this block. */
export function growth(sbId: number): Figure<Growth> {
  const rows = aumSeries(sbId).value;
  const opening = rows[0]?.opening_aum ?? 0;
  const closing = rows[rows.length - 1]?.month_end_aum ?? 0;
  const flows = Math.round(rows.reduce((s, m) => s + m.net_flows, 0) * 100) / 100;
  const market = Math.round(rows.reduce((s, m) => s + m.market_movement, 0) * 100) / 100;
  const gained = closing - opening;
  return {
    value: {
      from: rows[0]?.month ?? '', to: rows[rows.length - 1]?.month ?? '',
      opening, flows, market, closing,
      flowsPct: gained !== 0 ? Math.round((flows / gained) * 100) : 0,
      marketPct: gained !== 0 ? Math.round((market / gained) * 100) : 0,
    },
    tag: 'computed',
    sql: `SELECT SUM(net_flows), SUM(market_movement) FROM mv_monthly_aum WHERE sb_id=?
-- opening = first month's opening_aum, closing = last month's month_end_aum
-- identity: opening + Σ net_flows + Σ market_movement == closing`,
    sources: ['mv_monthly_aum.opening_aum', '.net_flows', '.market_movement', '.month_end_aum'],
  };
}

export interface SipBook {
  live: number; monthly: number; annual: number;
  instalments: number; bounced: number; bounceRate: number;
  mandatesExpiring: number; valueAtRisk: number;
}

/** SIP book health. The bounce rate is bounced ÷ due over the window, not a count. */
export function sipBook(sbId: number): Figure<SipBook> {
  const sql = `SELECT
    (SELECT COUNT(*) FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1) live,
    (SELECT COALESCE(SUM(tr_amount),0) FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1) monthly,
    (SELECT COUNT(*) FROM transaction_master WHERE fk_sb_id=? AND fk_tran_type_id=3
       AND tr_date >= date(?, '-6 months')) instalments,
    (SELECT COUNT(*) FROM transaction_master WHERE fk_sb_id=? AND fk_tran_type_id=33
       AND tr_date >= date(?, '-6 months')) bounced,
    (SELECT COUNT(*) FROM sip_master s JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
       LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
     WHERE s.fk_sb_id=? AND s.is_live_sip=1 AND ml.end_date IS NOT NULL
       AND ml.end_date <= date(?, '+45 days')) mandatesExpiring,
    (SELECT COALESCE(SUM(s.tr_amount*12),0) FROM sip_master s JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
     WHERE s.fk_sb_id=? AND s.is_live_sip=1 AND x.npayments_missed >= 2) valueAtRisk`;
  const f = figure<Omit<SipBook, 'annual' | 'bounceRate'>>(sql,
    ['sip_master.is_live_sip', '.tr_amount', 'transaction_master.fk_tran_type_id', 'bse_sxp_list.npayments_missed', 'bse_mandate_list.end_date'],
    'computed', [sbId, sbId, sbId, TODAY, sbId, TODAY, sbId, TODAY, sbId]);
  const v = f.value;
  const due = v.instalments + v.bounced;
  return {
    ...f,
    value: {
      ...v, annual: Math.round(v.monthly * 12 * 100) / 100,
      // Bounced ÷ due. A bounce is a type-33 row, so it never counted as an
      // instalment — the denominator has to add them back.
      bounceRate: due > 0 ? Math.round((v.bounced / due) * 1000) / 10 : 0,
    },
  };
}

export interface TargetRow {
  key: string; label: string; target: number; actual: number; pct: number; kind: 'money' | 'count';
}

/** The four targets against what actually happened in the same month. */
export function targets(sbId: number, month: string): Figure<TargetRow[]> {
  const sql = `SELECT t.target_lumpsum_amount, t.target_sip_count, t.target_sip_amount, t.target_client_count,
    (SELECT COALESCE(SUM(x.tr_amount),0) FROM transaction_master x
       JOIN transaction_type_master tt ON tt.tr_type_id=x.fk_tran_type_id
     WHERE x.fk_sb_id=t.fk_sb_id AND tt.tr_type_buy_sell_flag=1
       AND substr(x.tr_date,1,7)=substr(t.target_month,1,7)) act_lumpsum,
    (SELECT COUNT(*) FROM sip_master s WHERE s.fk_sb_id=t.fk_sb_id
       AND substr(s.start_date,1,7)=substr(t.target_month,1,7)) act_sip_count,
    (SELECT COALESCE(SUM(s.tr_amount),0) FROM sip_master s WHERE s.fk_sb_id=t.fk_sb_id
       AND substr(s.start_date,1,7)=substr(t.target_month,1,7)) act_sip_amount,
    (SELECT COUNT(DISTINCT f.fk_acc_id) FROM folio_master f
       JOIN sub_broker_master sb ON sb.sb_sub_broker_code=f.fm_sub_broker_code
     WHERE sb.sb_id=t.fk_sb_id AND substr(f.folio_start_date,1,7)=substr(t.target_month,1,7)) act_clients
    FROM sb_monthly_target t WHERE t.fk_sb_id=? AND t.target_month=?`;
  const row = db().prepare(sql).get(sbId, month) as Record<string, number> | undefined;
  const spec: [string, string, string, string, TargetRow['kind']][] = [
    ['lumpsum', 'Lump-sum brought in', 'target_lumpsum_amount', 'act_lumpsum', 'money'],
    ['sip_count', 'New SIPs started', 'target_sip_count', 'act_sip_count', 'count'],
    ['sip_amount', 'New SIP value / month', 'target_sip_amount', 'act_sip_amount', 'money'],
    ['clients', 'New clients', 'target_client_count', 'act_clients', 'count'],
  ];
  const value: TargetRow[] = row ? spec.map(([key, label, t, a, kind]) => ({
    key, label, kind, target: row[t] ?? 0, actual: row[a] ?? 0,
    pct: row[t] > 0 ? Math.round(((row[a] ?? 0) / row[t]) * 100) : 0,
  })) : [];
  return { value, tag: 'computed', sql, sources: ['sb_monthly_target.target_lumpsum_amount', '.target_sip_count', '.target_client_count', 'transaction_master.tr_amount', 'sip_master.start_date', 'folio_master.folio_start_date'] };
}

/** Attainment across the window, so a good month is visible as a good month. */
export function targetHistory(sbId: number): Figure<{ month: string; pct: number }[]> {
  const sql = `SELECT t.target_month month,
    CASE WHEN t.target_lumpsum_amount > 0 THEN ROUND(100.0 * (
      SELECT COALESCE(SUM(x.tr_amount),0) FROM transaction_master x
        JOIN transaction_type_master tt ON tt.tr_type_id=x.fk_tran_type_id
      WHERE x.fk_sb_id=t.fk_sb_id AND tt.tr_type_buy_sell_flag=1
        AND substr(x.tr_date,1,7)=substr(t.target_month,1,7)) / t.target_lumpsum_amount) ELSE 0 END pct
    FROM sb_monthly_target t WHERE t.fk_sb_id=? ORDER BY t.target_month`;
  return {
    value: db().prepare(sql).all(sbId) as { month: string; pct: number }[], tag: 'computed', sql,
    sources: ['sb_monthly_target.target_lumpsum_amount', 'transaction_master.tr_amount'],
  };
}

export interface ClientMove {
  client_id: number; name: string; on: string; value: number; reason: string;
}

/** Clients gained: their first folio with this broker opened in the window. */
export function wins(sbId: number): Figure<ClientMove[]> {
  const sql = `SELECT c.cm_user_id client_id, c.cm_full_name name, MIN(f.folio_start_date) on_,
      COALESCE((SELECT SUM(h.present_market_value) FROM fifo_summary_holding_active h
                WHERE h.client_id=c.cm_user_id), 0) value,
      'first investment' reason
    FROM folio_master f
    JOIN client_master c ON c.cm_user_id=f.fk_acc_id
    JOIN sub_broker_master sb ON sb.sb_sub_broker_code=f.fm_sub_broker_code
    WHERE sb.sb_id=? GROUP BY c.cm_user_id
    HAVING on_ >= date(?, '-14 months') ORDER BY on_ DESC`;
  const rows = db().prepare(sql).all(sbId, TODAY) as (Omit<ClientMove, 'on'> & { on_: string })[];
  return {
    value: rows.map(({ on_, ...r }) => ({ ...r, on: on_ })), tag: 'computed', sql,
    sources: ['folio_master.folio_start_date', '.fm_sub_broker_code', 'client_master.cm_full_name'],
  };
}

/**
 * Clients lost. Founder's definition (07-Aug-2026): they transferred out to
 * another distributor, OR they redeemed everything and hold nothing. Dormant
 * clients are NOT counted — those are still saveable and live on Today.
 */
export function losses(sbId: number): Figure<ClientMove[]> {
  const sql = `SELECT c.cm_user_id client_id, c.cm_full_name name,
      MAX(COALESCE(f.transfer_out_date, t.tr_date)) on_,
      COALESCE(SUM(CASE WHEN tt.tr_type_buy_sell_flag=-1 THEN t.tr_amount END),0) value,
      CASE WHEN MAX(COALESCE(f.is_transferred_out,0))=1
           THEN 'transferred to another distributor' ELSE 'redeemed everything' END reason
    FROM folio_master f
    JOIN client_master c ON c.cm_user_id=f.fk_acc_id
    JOIN sub_broker_master sb ON sb.sb_sub_broker_code=f.fm_sub_broker_code
    LEFT JOIN transaction_master t ON t.tr_folio_no=f.fm_folio_no
    LEFT JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    WHERE sb.sb_id=?
      AND c.cm_user_id NOT IN (SELECT client_id FROM fifo_summary_holding_active WHERE balance_units > 0.0001)
    GROUP BY c.cm_user_id ORDER BY on_ DESC`;
  const rows = db().prepare(sql).all(sbId) as (Omit<ClientMove, 'on'> & { on_: string })[];
  return {
    value: rows.map(({ on_, ...r }) => ({ ...r, on: on_ })), tag: 'rule', sql,
    sources: ['folio_master.is_transferred_out', '.transfer_out_date', 'fifo_summary_holding_active.balance_units', 'transaction_master.tr_amount'],
  };
}

/** How far into the month we are — a target is not missed on the 7th. */
export function monthPace(month: string): { elapsed: number; days: number; fraction: number } {
  const days = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const isCurrent = month.slice(0, 7) === TODAY.slice(0, 7);
  const elapsed = isCurrent ? Number(TODAY.slice(8, 10)) : days;
  return { elapsed, days, fraction: elapsed / days };
}
