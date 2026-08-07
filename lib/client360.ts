import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { figure, type Figure, type MixRow } from './queries';

const CLIENT_BLEND = `SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value*xirr END)
                    / SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value END)`;

export interface ClientHeader {
  client_id: number;
  name: string;
  pan: string;
  family_id: number;
  family_name: string;
  risk: string;
  kyc: number;
  since: string | null;
  advisor_code: string;
}

export function clientHeader(id: number): ClientHeader | undefined {
  return db().prepare(`SELECT c.cm_user_id client_id, c.cm_full_name name, c.cm_pan_no pan,
      c.fk_family_id family_id, fm.family_name, r.risk_profile risk, c.is_kyc_done kyc,
      (SELECT MIN(inv_since_date) FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id) since,
      (SELECT advisor_code FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id LIMIT 1) advisor_code
    FROM client_master c
    LEFT JOIN family_master fm ON fm.family_id=c.fk_family_id
    LEFT JOIN client_master_mf_related r ON r.fk_cm_user_id=c.cm_user_id
    WHERE c.cm_user_id=?`).get(id) as ClientHeader | undefined;
}

export function clientKpis(id: number): Figure<{ v: number; invested: number; wx: number | null; bmx: number | null }> {
  const sql = `SELECT
  (SELECT SUM(present_market_value) FROM fifo_summary_holding_active WHERE client_id=?) v,
  (SELECT SUM(cost_amount) FROM fifo_summary_holding_active WHERE client_id=?) invested,
  (SELECT ROUND(${CLIENT_BLEND},1) FROM fifo_summary_holding_active WHERE client_id=?) wx,
  (SELECT ROUND(SUM(CASE WHEN sh_bmxirr IS NOT NULL THEN sh_current_value*sh_bmxirr END)
              / SUM(CASE WHEN sh_bmxirr IS NOT NULL THEN sh_current_value END),1)
     FROM fifo_summary_holding WHERE fk_acc_id=?) bmx`;
  return figure(sql, ['fifo_summary_holding_active.present_market_value', '.cost_amount', '.xirr', 'fifo_summary_holding.sh_bmxirr'], 'computed', [id, id, id, id]);
}

export function clientMix(id: number): Figure<MixRow[]> {
  const sql = `SELECT asset_name label, SUM(present_market_value) v
FROM fifo_summary_holding_active WHERE client_id=? GROUP BY asset_name ORDER BY v DESC`;
  return { value: db().prepare(sql).all(id) as MixRow[], tag: 'computed', sql, sources: ['fifo_summary_holding_active.asset_name', '.present_market_value'] };
}

export interface Lot {
  purchase_date: string;
  units: number;
  price: number;
  current_value: number;
  invested: number;
  holding_days: number;
  unreal_lt: number;
  unreal_st: number;
}

export interface Holding {
  scheme_id: number;
  fund_name: string;
  fund_category: string;
  folio_no: string;
  units: number;
  avg_cost: number | null;
  nav: number;
  value: number;
  invested: number;
  weight: number | null;
  xirr: number | null;
  bmxirr: number | null;
  exit_load: number;
  lots: Lot[];
}

export function clientHoldings(id: number): { rows: Holding[]; sql: string } {
  const sql = `SELECT f.scheme_id, f.fund_name, f.fund_category, f.folio_no, f.balance_units units,
  f.avg_cost, f.nav, f.present_market_value value, f.cost_amount invested, f.portfolio_weight weight,
  f.xirr, sh.sh_bmxirr bmxirr, sm.scheme_exit_load exit_load
FROM fifo_summary_holding_active f
JOIN scheme_master sm ON sm.scheme_id=f.scheme_id
LEFT JOIN fifo_summary_holding sh ON sh.fk_acc_id=f.client_id AND sh.fk_scheme_id=f.scheme_id
WHERE f.client_id=? ORDER BY value DESC`;
  const rows = db().prepare(sql).all(id) as (Omit<Holding, 'lots'> & { lots?: Lot[] })[];
  const lotStmt = db().prepare(`SELECT dhl_purchase_date purchase_date, dhl_purchase_units units,
    dhl_purchase_price price, dhl_current_value current_value, dhl_purchase_amount invested,
    dhl_holding_days holding_days, dhl_unrealized_ltcg unreal_lt, dhl_unrealized_stcg unreal_st
    FROM fifo_detail_holding_latest WHERE fk_acc_id=? AND fk_scheme_id=? ORDER BY dhl_purchase_date`);
  for (const r of rows) r.lots = lotStmt.all(id, r.scheme_id) as Lot[];
  return { rows: rows as Holding[], sql };
}

export function taxPosition(id: number): Figure<{ real_lt: number; real_st: number; unreal_lt: number; unreal_st: number }> {
  const sql = `SELECT COALESCE(SUM(sh_realized_ltcg),0) real_lt, COALESCE(SUM(sh_realized_stcg),0) real_st,
  COALESCE(SUM(sh_unrealized_ltcg),0) unreal_lt, COALESCE(SUM(sh_unrealized_stcg),0) unreal_st
FROM fifo_summary_holding WHERE fk_acc_id=?`;
  return figure(sql, ['fifo_summary_holding.sh_realized_ltcg', '.sh_realized_stcg', '.sh_unrealized_ltcg', '.sh_unrealized_stcg'], 'computed', [id]);
}

export interface Txn {
  tr_id: number;
  tr_date: string;
  type_name: string;
  flag: number;
  fund_name: string;
  tr_folio_no: string;
  tr_amount: number;
  tr_units: number | null;
  tr_price: number | null;
}

export function clientTxns(id: number): { rows: Txn[]; from: string; to: string; sql: string } {
  const from = db().prepare("SELECT date(?, '-12 months') d").get(TODAY) as { d: string };
  const sql = `SELECT t.tr_id, t.tr_date, tt.tr_type_name type_name, tt.tr_type_buy_sell_flag flag,
  sm.scheme_full_name fund_name, t.tr_folio_no, t.tr_amount, t.tr_units, t.tr_price
FROM transaction_master t
JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
JOIN scheme_master sm ON sm.scheme_id=t.fk_scheme_id
WHERE t.fk_acc_id=? AND t.tr_date BETWEEN ? AND ?
ORDER BY t.tr_date DESC`;
  return { rows: db().prepare(sql).all(id, from.d, TODAY) as Txn[], from: from.d, to: TODAY, sql };
}

export interface SipRow {
  sip_id: number;
  fund_name: string;
  tr_amount: number;
  day_of_sip: number;
  start_date: string;
  is_live_sip: number;
  cease_date: string | null;
  missed: number | null;
  mandate_end: string | null;
  umrn: string | null;
}

export function clientSips(id: number): { rows: SipRow[]; sql: string } {
  const sql = `SELECT s.sip_id, sm.scheme_full_name fund_name, s.tr_amount, s.day_of_sip,
  s.start_date, s.is_live_sip, s.cease_date, x.npayments_missed missed, ml.end_date mandate_end, ml.umrn
FROM sip_master s
LEFT JOIN scheme_master sm ON sm.scheme_id=s.fk_from_scheme_id
LEFT JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
WHERE s.fk_acc_id=? ORDER BY s.is_live_sip DESC, s.start_date DESC`;
  return { rows: db().prepare(sql).all(id) as SipRow[], sql };
}

export interface FamilyMember {
  client_id: number;
  name: string;
  is_head: number;
  v: number;
  wx: number | null;
  open_actions: number;
}

export function familyMembers(familyId: number): { rows: FamilyMember[]; sql: string } {
  const sql = `SELECT c.cm_user_id client_id, c.cm_full_name name, c.is_family_head is_head,
  COALESCE((SELECT SUM(present_market_value) FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id),0) v,
  (SELECT ROUND(${CLIENT_BLEND},1) FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id) wx,
  (SELECT COUNT(*) FROM actions a WHERE a.subject_type='client' AND a.subject_id=CAST(c.cm_user_id AS TEXT)
     AND a.state IN ('proposed','assigned','in_progress')) open_actions
FROM client_master c WHERE c.fk_family_id=? ORDER BY is_head DESC, v DESC`;
  return { rows: db().prepare(sql).all(familyId) as FamilyMember[], sql };
}

export interface ClientAction {
  action_id: number;
  action_type: string;
  state: string;
  impact_score: number;
  sla_due: string;
  trigger_evidence: string;
  outcome_type: string | null;
  closed_at: string | null;
}

export function clientActions(id: number): { open: ClientAction[]; closed: ClientAction[] } {
  const sipIds = (db().prepare('SELECT sip_id FROM sip_master WHERE fk_acc_id=?').all(id) as { sip_id: number }[])
    .map(r => String(r.sip_id));
  const rows = db().prepare(`SELECT action_id, action_type, state, impact_score, sla_due, trigger_evidence, outcome_type, closed_at
FROM actions
WHERE (subject_type='client' AND subject_id=?)
   OR (subject_type='sip' AND subject_id IN (${sipIds.map(() => '?').join(',') || "''"}))
ORDER BY CASE WHEN state IN ('proposed','assigned','in_progress') THEN 0 ELSE 1 END, impact_score DESC`)
    .all(String(id), ...sipIds) as ClientAction[];
  return {
    open: rows.filter(r => ['proposed', 'assigned', 'in_progress'].includes(r.state)),
    closed: rows.filter(r => !['proposed', 'assigned', 'in_progress'].includes(r.state)),
  };
}

export interface Interaction {
  interaction_id: number;
  kind: string;
  transcript: string | null;
  occurred_at: string;
}

export function clientInteractions(id: number): Interaction[] {
  return db().prepare(`SELECT interaction_id, kind, transcript, occurred_at
FROM interactions WHERE client_id=? ORDER BY occurred_at DESC LIMIT 20`).all(id) as Interaction[];
}
