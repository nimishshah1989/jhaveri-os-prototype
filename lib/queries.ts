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
  rows: { label: string; detail: string; amount: number }[];
  total: number;
}

export const DEMO_SB = 4;

export function broker(): { sb_id: number; name: string; code: string } {
  const row = db()
    .prepare('SELECT sb_id, sb_holder_name name, sb_sub_broker_code code FROM sub_broker_master WHERE sb_id=?')
    .get(DEMO_SB) as { sb_id: number; name: string; code: string };
  return row;
}

function figure<T>(sql: string, sources: string[], tag: ProvenanceTag, params: unknown[]): Figure<T> {
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

const CHURN_SQL = `SELECT COUNT(*) n, COALESCE(SUM(v.value_now),0) v
FROM (SELECT DISTINCT client_id FROM mv_portfolio_attention) a
JOIN client_sub_broker_mapping m ON m.cm_user_id=a.client_id AND m.sb_id=?
JOIN v_client_value v ON v.client_id=a.client_id`;

export function churnRisk(): Figure<{ n: number; v: number }> {
  return figure(CHURN_SQL, ['mv_portfolio_attention.client_id', 'v_client_value.value_now'], 'rule', [DEMO_SB]);
}

const IDLE_SQL = `SELECT COUNT(*) n, COALESCE(SUM(v),0) v FROM (
  SELECT f.client_id, SUM(f.present_market_value) v FROM fifo_summary_holding_active f
  JOIN client_sub_broker_mapping m ON m.cm_user_id=f.client_id AND m.sb_id=?
  WHERE f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)
  GROUP BY f.client_id)`;

export function idleNoSip(): Figure<{ n: number; v: number }> {
  return figure(IDLE_SQL, ['fifo_summary_holding_active.present_market_value', 'sip_master.is_live_sip'], 'computed', [DEMO_SB]);
}

const SIP_RISK_SQL = `SELECT COUNT(*) n, COALESCE(SUM(s.tr_amount*12),0) v
FROM sip_master s
JOIN client_sub_broker_mapping m ON m.cm_user_id=s.fk_acc_id AND m.sb_id=?
JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
WHERE s.is_live_sip=1 AND (x.npayments_missed>=2 OR (ml.end_date IS NOT NULL AND ml.end_date <= date(?,'+45 days')))`;

export function sipsAtRisk(): Figure<{ n: number; v: number }> {
  return figure(SIP_RISK_SQL, ['sip_master.tr_amount', 'bse_sxp_list.npayments_missed', 'bse_mandate_list.end_date'], 'rule', [DEMO_SB, TODAY]);
}

const STUCK_SQL = `SELECT COUNT(*) n, COALESCE(MAX(CAST(julianday(?) - julianday(stall_since) AS INTEGER)),0) days
FROM onboarding_applications WHERE sb_id=? AND elog_status='stalled'`;

export function onboardingStuck(): Figure<{ n: number; days: number }> {
  return figure(STUCK_SQL, ['onboarding_applications.elog_status', '.stall_since'], 'rule', [TODAY, DEMO_SB]);
}

// Click-through lists — the rows behind each card, so no number is a dead end.
export function bookList(code: string): StatList {
  const rows = db().prepare(`SELECT client_name label, COUNT(*) || ' holdings' detail, SUM(present_market_value) amount
    FROM fifo_summary_holding_active WHERE advisor_code=? GROUP BY client_id ORDER BY amount DESC LIMIT 10`).all(code) as StatList['rows'];
  const total = (db().prepare('SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active WHERE advisor_code=?').get(code) as { n: number }).n;
  return { rows, total };
}

export function flowsList(): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label, tt.tr_type_name || ' · ' || t.tr_date detail,
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

export function churnList(): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label, GROUP_CONCAT(DISTINCT a.flag_type) detail, v.value_now amount
    FROM mv_portfolio_attention a
    JOIN client_sub_broker_mapping m ON m.cm_user_id=a.client_id AND m.sb_id=?
    JOIN client_master c ON c.cm_user_id=a.client_id
    JOIN v_client_value v ON v.client_id=a.client_id
    GROUP BY a.client_id ORDER BY amount DESC LIMIT 10`).all(DEMO_SB) as StatList['rows'];
  return { rows, total: rows.length };
}

export function idleList(): StatList {
  const rows = db().prepare(`SELECT f.client_name label, COUNT(*) || ' holdings, no SIP' detail, SUM(f.present_market_value) amount
    FROM fifo_summary_holding_active f
    JOIN client_sub_broker_mapping m ON m.cm_user_id=f.client_id AND m.sb_id=?
    WHERE f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)
    GROUP BY f.client_id ORDER BY amount DESC LIMIT 10`).all(DEMO_SB) as StatList['rows'];
  const total = idleNoSip().value.n;
  return { rows, total };
}

export function sipRiskList(): StatList {
  const rows = db().prepare(`SELECT c.cm_full_name label,
    CASE WHEN x.npayments_missed>=2 THEN 'bounced ×' || x.npayments_missed ELSE 'mandate ends ' || ml.end_date END detail,
    s.tr_amount*12 amount
    FROM sip_master s
    JOIN client_sub_broker_mapping m ON m.cm_user_id=s.fk_acc_id AND m.sb_id=?
    JOIN client_master c ON c.cm_user_id=s.fk_acc_id
    JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
    LEFT JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
    WHERE s.is_live_sip=1 AND (x.npayments_missed>=2 OR (ml.end_date IS NOT NULL AND ml.end_date <= date(?,'+45 days')))
    ORDER BY amount DESC`).all(DEMO_SB, TODAY) as StatList['rows'];
  return { rows, total: rows.length };
}

export function stuckList(): StatList {
  const rows = db().prepare(`SELECT COALESCE(c.cm_full_name, l.name, 'Application #' || oa.application_id) label,
    'stalled at ' || 'BSE e-log' || ' since ' || oa.stall_since detail,
    CAST(julianday(?) - julianday(oa.stall_since) AS INTEGER) amount
    FROM onboarding_applications oa
    LEFT JOIN client_master c ON c.cm_user_id=oa.client_id
    LEFT JOIN leads l ON l.lead_id=oa.lead_id
    WHERE oa.sb_id=? AND oa.elog_status='stalled' ORDER BY amount DESC`).all(TODAY, DEMO_SB) as StatList['rows'];
  return { rows, total: rows.length };
}

// The queue — MS-NBA three streams over the actions table.
export interface QueueItem {
  action_id: number;
  action_type: string;
  subject_type: string;
  subject_id: string;
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
