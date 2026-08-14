import { db } from './db';
import { TODAY } from '../mockdb/engines';

// Every figure the UI renders carries its provenance: the SQL that produced it,
// the source columns, and the honesty tag (computed | rule | learned).
export type ProvenanceTag = 'computed' | 'rule' | 'learned';

export interface Figure<T> {
  value: T;
  tag: ProvenanceTag;
  sql: string;
  sources: string[];
}

export interface StatList {
  /** client_id, where present, turns the label into a link to that client's 360. */
  rows: { label: string; detail: string; amount: number; client_id?: number | null }[];
  total: number;
}

export const DEMO_SB = 4;

export function broker(): { sb_id: number; name: string; code: string } {
  const row = db()
    .prepare('SELECT sb_id, sb_holder_name name, sb_sub_broker_code code FROM sub_broker_master WHERE sb_id=?')
    .get(DEMO_SB) as { sb_id: number; name: string; code: string };
  return row;
}

export function figure<T>(sql: string, sources: string[], tag: ProvenanceTag, params: unknown[]): Figure<T> {
  return { value: db().prepare(sql).get(...params) as T, tag, sql, sources };
}

const MY_BOOK_SQL = `SELECT COALESCE(SUM(present_market_value),0) v, MAX(holding_date) as_of
FROM fifo_summary_holding_active WHERE advisor_code = ?`;

export function myBook(code: string): Figure<{ v: number; as_of: string }> {
  return figure(MY_BOOK_SQL, ['fifo_summary_holding_active.present_market_value', '.advisor_code', '.holding_date'], 'computed', [code]);
}

const NET_FLOWS_SQL = `SELECT COALESCE(SUM(t.tr_amount * tt.tr_type_buy_sell_flag),0) v, COUNT(*) n
FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
WHERE t.fk_sb_id=? AND t.tr_date >= ? AND t.tr_date <= ? AND tt.tr_type_buy_sell_flag != 0`;

export function netFlowsMtd(): Figure<{ v: number; n: number }> {
  return figure(NET_FLOWS_SQL, ['transaction_master.tr_amount', '.tr_date', 'transaction_type_master.tr_type_buy_sell_flag'], 'computed', [DEMO_SB, TODAY.slice(0, 8) + '01', TODAY]);
}

// One denominator everywhere: "this broker's book" = distinct clients whose
// holdings carry his advisor_code. Money figures never mix in mapping joins.
const BOOK_SET = `SELECT DISTINCT client_id FROM fifo_summary_holding_active WHERE advisor_code = ?`;

const CHURN_SQL = `SELECT COUNT(*) n, COALESCE(SUM(v.value_now),0) v
FROM (SELECT DISTINCT client_id FROM mv_portfolio_attention WHERE client_id IN (${BOOK_SET})) a
JOIN v_client_value v ON v.client_id=a.client_id`;

export function churnRisk(code: string): Figure<{ n: number; v: number }> {
  return figure(CHURN_SQL, ['mv_portfolio_attention.client_id', 'v_client_value.value_now'], 'rule', [code]);
}

const IDLE_SQL = `SELECT COUNT(*) n, COALESCE(SUM(v),0) v FROM (
  SELECT f.client_id, SUM(f.present_market_value) v FROM fifo_summary_holding_active f
  WHERE f.advisor_code=? AND f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)
  GROUP BY f.client_id)`;

export function idleNoSip(code: string): Figure<{ n: number; v: number }> {
  return figure(IDLE_SQL, ['fifo_summary_holding_active.present_market_value', 'sip_master.is_live_sip'], 'computed', [code]);
}

const SIP_RISK_SQL = `SELECT COUNT(*) n, COALESCE(SUM(s.tr_amount*12),0) v
FROM sip_master s
JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
WHERE s.is_live_sip=1 AND s.fk_acc_id IN (${BOOK_SET})
  AND (x.npayments_missed>=2 OR (ml.end_date IS NOT NULL AND ml.end_date <= date(?,'+45 days')))`;

export function sipsAtRisk(code: string): Figure<{ n: number; v: number }> {
  return figure(SIP_RISK_SQL, ['sip_master.tr_amount', 'bse_sxp_list.npayments_missed', 'bse_mandate_list.end_date'], 'rule', [code, TODAY]);
}

// "Stuck" means the same thing here as on the Onboarding page: an unsigned BSE
// e-log, a KRA rejection, or documents still not filed past the promised TAT.
// Independent SQL, deliberately — verify-onboarding.ts asserts it agrees with
// stalls() in lib/onboarding.ts, so the two can never quietly drift apart.
const STUCK_WHERE = `oa.sb_id = ? AND oa.ucc_status IS NOT 'ACTIVE' AND (
    oa.kyc_status = 'REJECTED'
 OR (oa.elog_status IN ('sent','stalled') AND julianday(?) - julianday(oa.stall_since) > 7)
 OR (oa.kyc_status = 'PENDING' AND julianday(?) - julianday(oa.started_at) > 7))`;

const STUCK_SQL = `SELECT COUNT(*) n,
  COALESCE(MAX(CAST(julianday(?) - julianday(COALESCE(oa.stall_since, oa.started_at)) AS INTEGER)), 0) days
FROM onboarding_applications oa WHERE ${STUCK_WHERE}`;

export function onboardingStuck(): Figure<{ n: number; days: number }> {
  return figure(STUCK_SQL, ['onboarding_applications.elog_status', '.stall_since', '.kyc_status', '.started_at'], 'rule', [TODAY, DEMO_SB, TODAY, TODAY]);
}

// Click-through lists — the rows behind each card, so no number is a dead end.
export function bookList(code: string): StatList {
  const rows = db().prepare(`SELECT client_name label, client_id, COUNT(*) || ' holdings' detail, SUM(present_market_value) amount
    FROM fifo_summary_holding_active WHERE advisor_code=? GROUP BY client_id ORDER BY amount DESC LIMIT 10`).all(code) as StatList['rows'];
  const total = (db().prepare('SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active WHERE advisor_code=?').get(code) as { n: number }).n;
  return { rows, total };
}

export function flowsList(): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label, c.cm_user_id client_id, tt.tr_type_name || ' · ' || t.tr_date detail,
    CASE WHEN tt.tr_type_buy_sell_flag=-1 THEN -t.tr_amount ELSE t.tr_amount END amount
    FROM transaction_master t
    JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    JOIN client_master c ON c.cm_user_id=t.fk_acc_id
    WHERE t.fk_sb_id=? AND t.tr_date >= ? AND tt.tr_type_buy_sell_flag != 0
    ORDER BY ABS(t.tr_amount) DESC LIMIT 10`).all(DEMO_SB, TODAY.slice(0, 8) + '01') as StatList['rows'];
  const total = (db().prepare(`SELECT COUNT(*) n FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    WHERE t.fk_sb_id=? AND t.tr_date >= ? AND tt.tr_type_buy_sell_flag != 0`).get(DEMO_SB, TODAY.slice(0, 8) + '01') as { n: number }).n;
  return { rows, total };
}

export function churnList(code: string): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label, c.cm_user_id client_id, GROUP_CONCAT(DISTINCT a.flag_type) detail, v.value_now amount
    FROM mv_portfolio_attention a
    JOIN client_master c ON c.cm_user_id=a.client_id
    JOIN v_client_value v ON v.client_id=a.client_id
    WHERE a.client_id IN (${BOOK_SET})
    GROUP BY a.client_id ORDER BY amount DESC LIMIT 10`).all(code) as StatList['rows'];
  // The list is capped at 10; the total must stay the real count so the card can
  // say "… N more" instead of quietly pretending 10 is all of them.
  return { rows, total: churnRisk(code).value.n };
}

export function idleList(code: string): StatList {
  const rows = db().prepare(`SELECT f.client_name label, f.client_id, COUNT(*) || ' holdings, no SIP' detail, SUM(f.present_market_value) amount
    FROM fifo_summary_holding_active f
    WHERE f.advisor_code=? AND f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)
    GROUP BY f.client_id ORDER BY amount DESC LIMIT 10`).all(code) as StatList['rows'];
  const total = idleNoSip(code).value.n;
  return { rows, total };
}

export function sipRiskList(code: string): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label, c.cm_user_id client_id,
    CASE WHEN x.npayments_missed>=2 THEN 'bounced ×' || x.npayments_missed ELSE 'mandate ends ' || ml.end_date END detail,
    s.tr_amount*12 amount
    FROM sip_master s
    JOIN client_master c ON c.cm_user_id=s.fk_acc_id
    JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
    LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
    WHERE s.is_live_sip=1 AND s.fk_acc_id IN (${BOOK_SET})
      AND (x.npayments_missed>=2 OR (ml.end_date IS NOT NULL AND ml.end_date <= date(?,'+45 days')))
    ORDER BY amount DESC`).all(code, TODAY) as StatList['rows'];
  return { rows, total: rows.length };
}

export function stuckList(): StatList {
  const rows = db().prepare(`SELECT k.name label, oa.client_id,
    CASE WHEN oa.elog_status='stalled' THEN 'BSE e-log unsigned since ' || oa.stall_since
         WHEN oa.kyc_status='REJECTED' THEN 'KRA rejected · ' || k.kra_status_code
         ELSE 'documents not with the KRA since ' || oa.started_at END detail,
    CAST(julianday(?) - julianday(COALESCE(oa.stall_since, oa.started_at)) AS INTEGER) amount
    FROM onboarding_applications oa
    JOIN client_kyc_logs k ON k.id = oa.kyc_log_id
    WHERE ${STUCK_WHERE} ORDER BY amount DESC`).all(TODAY, DEMO_SB, TODAY, TODAY) as StatList['rows'];
  return { rows, total: rows.length };
}

// The queue — MS-NBA three streams over the actions table.
export interface QueueItem {
  action_id: number;
  action_type: string;
  subject_type: string;
  subject_id: string;
  client_id?: number | null;
  score_gain?: number;
  client_name: string | null;
  trigger_evidence: string;
  impact_score: number;
  sla_due: string;
  state: string;
  suggested_step: string | null;
  outcome_type: string | null;
  closed_at: string | null;
}

const QUEUE_SQL = `SELECT a.action_id, a.action_type, a.subject_type, a.subject_id, a.trigger_evidence,
  a.impact_score, a.sla_due, a.state, a.suggested_step, a.outcome_type, a.closed_at,
  COALESCE(c1.cm_user_id, c2.cm_user_id, c3.cm_user_id) client_id,
  COALESCE(c1.cm_full_name, c2.cm_full_name, c3.cm_full_name, l.name) client_name
FROM actions a
LEFT JOIN client_master c1 ON a.subject_type='client' AND c1.cm_user_id=CAST(a.subject_id AS INTEGER)
LEFT JOIN sip_master s ON a.subject_type='sip' AND s.sip_id=CAST(a.subject_id AS INTEGER)
LEFT JOIN client_master c2 ON c2.cm_user_id=s.fk_acc_id
LEFT JOIN onboarding_applications oa ON a.subject_type='application' AND oa.application_id=CAST(a.subject_id AS INTEGER)
LEFT JOIN client_master c3 ON c3.cm_user_id=oa.client_id
LEFT JOIN leads l ON l.lead_id=oa.lead_id`;

export interface Streams {
  red: QueueItem[];
  amber: QueueItem[];
  grey: QueueItem[];
  sql: string;
}

export function streams(): Streams {
  const open = db().prepare(`${QUEUE_SQL}
    WHERE a.assignee_sb_id=? AND a.state IN ('proposed','assigned','in_progress')
    ORDER BY a.sla_due ASC, a.impact_score DESC`).all(DEMO_SB) as QueueItem[];
  const autoResolved = db().prepare(`${QUEUE_SQL}
    WHERE a.assignee_sb_id=? AND a.state='done' AND a.outcome_type='auto_resolved' AND a.closed_at >= date(?, '-2 days')`)
    .all(DEMO_SB, TODAY) as QueueItem[];
  const cutoff = db().prepare("SELECT date(?, '+1 day') d").get(TODAY) as { d: string };
  // Relationship items (impact 0) never escalate to Act-now — a birthday due
  // tomorrow is not a fire. MS-NBA keeps the streams by kind, urgency ranks within.
  const money = open.filter(a => a.impact_score > 0);
  const red = money.filter(a => a.sla_due <= cutoff.d);
  const amber = money.filter(a => a.sla_due > cutoff.d).sort((a, b) => b.impact_score - a.impact_score);
  const grey = [...open.filter(a => a.impact_score === 0), ...autoResolved];
  return { red, amber, grey, sql: QUEUE_SQL };
}

export interface Scoreboard {
  closed: number;
  closedInSla: number;
  dueToday: number;
}

export function scoreboard(): Figure<Scoreboard> {
  const sql = `SELECT
    SUM(CASE WHEN state IN ('done','dismissed') THEN 1 ELSE 0 END) closed,
    SUM(CASE WHEN state IN ('done','dismissed') AND (closed_at IS NULL OR closed_at <= sla_due) THEN 1 ELSE 0 END) closedInSla,
    SUM(CASE WHEN state NOT IN ('done','dismissed') AND sla_due <= ? THEN 1 ELSE 0 END) dueToday
  FROM actions WHERE assignee_sb_id=?`;
  return figure(sql, ['actions.state', '.closed_at', '.sla_due'], 'computed', [TODAY, DEMO_SB]);
}

export interface PolicyRow {
  workflow: string;
  policy_key: string;
  evidence_n: number;
  target_n: number;
}

export function learning(): Figure<PolicyRow[]> {
  const sql = `SELECT workflow, policy_key, evidence_n, target_n FROM policies ORDER BY evidence_n DESC`;
  return { value: db().prepare(sql).all() as PolicyRow[], tag: 'learned', sql, sources: ['policies.evidence_n', '.target_n', '.belief'] };
}

// NULL-xirr holdings are EXCLUDED from both sides of the blend — a holding with
// no computable return must not silently count as 0% (financial-domain rule).
const BLEND = `SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value*xirr END)
             / SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value END)`;

export function blendedReturn(code: string): Figure<{ x: number; as_of: string }> {
  const sql = `SELECT ROUND(${BLEND},1) x, MAX(holding_date) as_of
FROM fifo_summary_holding_active WHERE advisor_code=?`;
  return figure(sql, ['fifo_summary_holding_active.xirr', '.present_market_value'], 'computed', [code]);
}

export function sipParticipation(code: string): Figure<{ n: number; of: number }> {
  const sql = `SELECT
  (SELECT COUNT(DISTINCT fk_acc_id) FROM sip_master WHERE is_live_sip=1 AND fk_acc_id IN (${BOOK_SET})) n,
  (SELECT COUNT(*) FROM (${BOOK_SET})) of`;
  return figure(sql, ['sip_master.is_live_sip', 'fifo_summary_holding_active.advisor_code'], 'computed', [code, code]);
}

export function dormantClients(code: string): Figure<{ n: number }> {
  const sql = `SELECT COUNT(*) n FROM (
  SELECT f.client_id, MAX(t.tr_date) lt FROM fifo_summary_holding_active f
  JOIN transaction_master t ON t.fk_acc_id=f.client_id AND t.tr_date <= '${TODAY}'
  WHERE f.advisor_code=? GROUP BY f.client_id HAVING lt < date('${TODAY}','-14 months'))`;
  return figure(sql, ['transaction_master.tr_date'], 'rule', [code]);
}

export function taxWindowClients(code: string): Figure<{ n: number }> {
  const sql = `SELECT COUNT(*) n FROM (
  SELECT h.fk_acc_id, SUM(h.sh_unrealized_ltcg) g FROM fifo_summary_holding h
  WHERE h.fk_acc_id IN (${BOOK_SET}) GROUP BY h.fk_acc_id HAVING g BETWEEN 40000 AND 120000)`;
  return figure(sql, ['fifo_summary_holding.sh_unrealized_ltcg'], 'rule', [code]);
}

export interface MixRow { label: string; v: number }

export function assetMix(code: string): Figure<MixRow[]> {
  const sql = `SELECT asset_name label, SUM(present_market_value) v
FROM fifo_summary_holding_active WHERE advisor_code=? GROUP BY asset_name ORDER BY v DESC`;
  return { value: db().prepare(sql).all(code) as MixRow[], tag: 'computed', sql, sources: ['fifo_summary_holding_active.asset_name', '.present_market_value'] };
}

export function healthSplit(code: string): Figure<{ healthy: number; dormant: number; concentrated: number }> {
  const dormant = dormantClients(code).value.n;
  const conc = (db().prepare(`SELECT COUNT(DISTINCT client_id) n FROM mv_portfolio_attention
    WHERE flag_type != 'stale' AND client_id IN (${BOOK_SET})`).get(code) as { n: number }).n;
  const total = (db().prepare(`SELECT COUNT(*) n FROM (${BOOK_SET})`).get(code) as { n: number }).n;
  return {
    value: { healthy: total - dormant - conc, dormant, concentrated: conc },
    tag: 'rule',
    sql: `dormant: no txn in 14 months · concentrated: mv_portfolio_attention non-stale flags · healthy: the rest of ${total}`,
    sources: ['transaction_master.tr_date', 'mv_portfolio_attention.flag_type'],
  };
}

export function xirrBands(code: string): Figure<{ band: string; n: number }[]> {
  const sql = `SELECT CASE WHEN wx < 0 THEN '< 0%' WHEN wx < 8 THEN '0–8%' WHEN wx < 15 THEN '8–15%' ELSE '> 15%' END band, COUNT(*) n
FROM (SELECT client_id, ${BLEND} wx
      FROM fifo_summary_holding_active WHERE advisor_code=? GROUP BY client_id)
GROUP BY band`;
  const order = ['< 0%', '0–8%', '8–15%', '> 15%'];
  const raw = db().prepare(sql).all(code) as { band: string; n: number }[];
  const value = order.map(b => ({ band: b, n: raw.find(r => r.band === b)?.n ?? 0 }));
  return { value, tag: 'computed', sql, sources: ['fifo_summary_holding_active.xirr', '.present_market_value'] };
}

export interface ClientRow {
  client_id: number;
  name: string;
  dup: number;
  v: number;
  invested: number;
  pnl: number;
  wx: number | null;
  /** Kept as the widest definition of "something happened", for the dormant filter. */
  last_activity: string | null;
  /**
   * Split deliberately. An automated instalment and a transaction someone chose to
   * make say opposite things about engagement: a book can look busy on the first
   * and be silent on the second, which is exactly the client who leaves.
   */
  last_txn: string | null;
  last_sip: string | null;
  /** The last time anyone from the firm actually spoke to them. */
  last_spoke: string | null;
  /** Liquid capital sitting past the point it was parked for. */
  parked: number;
  sip_monthly: number;
  top_action: string | null;
  open_actions: number;
  flags: string;
}

export interface ClientFilters {
  seg?: string;
  q?: string;
  risk?: string;
  sort?: string;
}

const SORTS: Record<string, string> = {
  value: 'v DESC',
  pnl: 'pnl DESC',
  xirr: 'wx DESC',
  activity: 'last_activity ASC',
  // Two more the split makes possible: the client nobody has spoken to, and the
  // money waiting to be deployed.
  spoke: 'last_spoke ASC',
  parked: 'parked DESC',
};

export function clientRows(code: string, f: ClientFilters): { rows: ClientRow[]; sql: string } {
  const where: string[] = [];
  const params: unknown[] = [code];
  if (f.seg === 'attention') where.push(`f.client_id IN (SELECT client_id FROM mv_portfolio_attention)`);
  if (f.seg === 'nosip') where.push(`f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)`);
  if (f.seg === 'taxwindow') where.push(`f.client_id IN (SELECT fk_acc_id FROM fifo_summary_holding GROUP BY fk_acc_id HAVING SUM(sh_unrealized_ltcg) BETWEEN 40000 AND 120000)`);
  if (f.q) { where.push(`(f.client_name LIKE ? OR f.folio_no LIKE ? OR f.pan_no LIKE ?)`); params.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  if (f.risk) { where.push(`f.client_id IN (SELECT fk_cm_user_id FROM client_master_mf_related WHERE risk_profile=?)`); params.push(f.risk); }
  const having = f.seg === 'dormant' ? `HAVING last_activity < date('${TODAY}','-14 months')` : '';
  const sql = `SELECT f.client_id, f.client_name name,
  (SELECT COUNT(DISTINCT x.client_id) FROM fifo_summary_holding_active x WHERE x.client_name=f.client_name AND x.advisor_code=f.advisor_code) dup,
  SUM(f.present_market_value) v, SUM(f.cost_amount) invested,
  SUM(f.present_market_value) - SUM(f.cost_amount) pnl,
  ROUND(SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value*f.xirr END)
      / SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value END),1) wx,
  (SELECT MAX(t.tr_date) FROM transaction_master t WHERE t.fk_acc_id=f.client_id AND t.tr_date <= '${TODAY}') last_activity,
  (SELECT MAX(t.tr_date) FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
     WHERE t.fk_acc_id=f.client_id AND t.tr_date <= '${TODAY}' AND tt.tr_type_name NOT LIKE 'Systematic%') last_txn,
  (SELECT MAX(t.tr_date) FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
     WHERE t.fk_acc_id=f.client_id AND t.tr_date <= '${TODAY}' AND tt.tr_type_name LIKE 'Systematic%') last_sip,
  (SELECT MAX(i.occurred_at) FROM interactions i WHERE i.client_id=f.client_id) last_spoke,
  COALESCE((SELECT SUM(x.present_market_value) FROM fifo_summary_holding_active x
     WHERE x.client_id=f.client_id AND x.balance_units > 0.0001
       AND x.fund_category IN ('Liquid','Arbitrage Fund')
       AND x.inv_since_date <= date('${TODAY}','-3 months')),0) parked,
  (SELECT COALESCE(SUM(s.tr_amount),0) FROM sip_master s WHERE s.fk_acc_id=f.client_id AND s.is_live_sip=1) sip_monthly,
  (SELECT a.action_type FROM actions a WHERE a.state IN ('proposed','assigned','in_progress')
     AND ((a.subject_type='client' AND a.subject_id=CAST(f.client_id AS TEXT))
       OR (a.subject_type='sip' AND a.subject_id IN (SELECT CAST(sip_id AS TEXT) FROM sip_master WHERE fk_acc_id=f.client_id)))
     ORDER BY a.impact_score DESC LIMIT 1) top_action,
  (SELECT COUNT(*) FROM actions a WHERE a.state IN ('proposed','assigned','in_progress')
     AND ((a.subject_type='client' AND a.subject_id=CAST(f.client_id AS TEXT))
       OR (a.subject_type='sip' AND a.subject_id IN (SELECT CAST(sip_id AS TEXT) FROM sip_master WHERE fk_acc_id=f.client_id)))) open_actions,
  COALESCE((SELECT GROUP_CONCAT(DISTINCT p.flag_type) FROM mv_portfolio_attention p WHERE p.client_id=f.client_id),'') flags
FROM fifo_summary_holding_active f
WHERE f.advisor_code=? ${where.length ? 'AND ' + where.join(' AND ') : ''}
GROUP BY f.client_id ${having}
ORDER BY ${SORTS[f.sort ?? 'value'] ?? SORTS.value}`;
  return { rows: db().prepare(sql).all(...params) as ClientRow[], sql };
}

export function worthActingOn(): QueueItem[] {
  return db().prepare(`${QUEUE_SQL}
    WHERE a.assignee_sb_id=? AND a.state IN ('proposed','assigned','in_progress') AND a.impact_score > 0
    ORDER BY a.impact_score DESC LIMIT 3`).all(DEMO_SB) as QueueItem[];
}
