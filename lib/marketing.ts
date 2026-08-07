import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { Figure } from './queries';

// Two rules govern this page, and both are enforced in SQL rather than in policy:
//
//   1. A campaign cannot be sent unless its template carries a compliance approval
//      artefact. No artefact, no launch — the gate is a join, not a checkbox.
//   2. A client can only be contacted on a channel they consented to, for the
//      purpose in question, and only while that consent was in force. Consent is
//      a timeline, not a flag.
//
// ROI follows the founder's ruling (07-Aug-2026): money counts only when a human
// closed the responder action and named the transaction. Nothing is attributed by
// a coincidence window.

export const MARKETING_RULES = {
  purpose: 'marketing',
  channels: ['whatsapp', 'email', 'sms'] as const,
  /** SPEC ruling 8: build 1 is HO-through-brokers. Broker-authored creative is phase 2. */
  mode: 'through_broker',
} as const;

export interface Shelf {
  campaign_id: number; name: string; state: string; launched_at: string;
  template_id: number; template: string; creative_ref: string;
  approval_artefact_ref: string | null; approved_by: string | null; approved_at: string | null;
  segment_id: number; segment: string; sends: number; responses: number; runnable: number;
}

/** What this broker may run. Unapproved templates appear, and say why they can't. */
export function shelf(): Figure<Shelf[]> {
  const sql = `SELECT c.campaign_id, c.name, c.state, c.launched_at,
      t.template_id, t.name template, t.creative_ref,
      t.approval_artefact_ref, t.approved_by, t.approved_at,
      s.segment_id, s.name segment,
      (SELECT COUNT(*) FROM campaign_sends x WHERE x.campaign_id=c.campaign_id) sends,
      (SELECT COUNT(*) FROM campaign_responses rr JOIN campaign_sends xx ON xx.send_id=rr.send_id
        WHERE xx.campaign_id=c.campaign_id) responses,
      CASE WHEN t.approval_artefact_ref IS NOT NULL THEN 1 ELSE 0 END runnable
    FROM campaigns c
    JOIN campaign_templates t ON t.template_id = c.template_id
    JOIN segments s ON s.segment_id = c.segment_id
    ORDER BY c.launched_at DESC`;
  return {
    value: db().prepare(sql).all() as Shelf[], tag: 'rule', sql,
    sources: ['campaigns.state', 'campaign_templates.approval_artefact_ref', '.approved_by', 'segments.name'],
  };
}

/** Templates head office has written but compliance has not signed off. */
export function awaitingApproval(): { template_id: number; name: string; creative_ref: string }[] {
  return db().prepare(`SELECT template_id, name, creative_ref FROM campaign_templates
    WHERE approval_artefact_ref IS NULL ORDER BY template_id`).all() as
    { template_id: number; name: string; creative_ref: string }[];
}

export interface Segment { segment_id: number; name: string; definition: string; is_shared: number }

export function segments(): Segment[] {
  return db().prepare('SELECT segment_id, name, definition, is_shared FROM segments ORDER BY segment_id')
    .all() as Segment[];
}

export interface SendSet {
  inSegment: number; noConsent: number; withdrawn: number; reachable: number;
  byChannel: { channel: string; n: number }[];
}

/**
 * The send-set arithmetic, shown as a subtraction rather than asserted. Segment
 * membership is deliberately computed the same way the seeded segments define it
 * — value in the book — so the numbers on screen are the numbers a send would use.
 */
export function sendSet(sbId: number, channel: string): Figure<SendSet> {
  const base = `SELECT DISTINCT h.client_id FROM fifo_summary_holding_active h
    WHERE h.advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)
    GROUP BY h.client_id HAVING SUM(h.present_market_value) > 100000`;
  const consented = `SELECT 1 FROM consents c WHERE c.client_id = b.client_id
    AND c.channel = ? AND c.purpose = 'marketing' AND c.state = 'granted'`;
  const everAsked = `SELECT 1 FROM consents c WHERE c.client_id = b.client_id
    AND c.channel = ? AND c.purpose = 'marketing'`;
  const conn = db();
  const inSegment = (conn.prepare(`SELECT COUNT(*) n FROM (${base})`).get(sbId) as { n: number }).n;
  const reachable = (conn.prepare(`SELECT COUNT(*) n FROM (${base}) b WHERE EXISTS (${consented})`)
    .get(sbId, channel) as { n: number }).n;
  const asked = (conn.prepare(`SELECT COUNT(*) n FROM (${base}) b WHERE EXISTS (${everAsked})`)
    .get(sbId, channel) as { n: number }).n;
  const byChannel = MARKETING_RULES.channels.map(ch => ({
    channel: ch,
    n: (conn.prepare(`SELECT COUNT(*) n FROM (${base}) b WHERE EXISTS (${consented})`)
      .get(sbId, ch) as { n: number }).n,
  }));
  return {
    value: { inSegment, noConsent: inSegment - asked, withdrawn: asked - reachable, reachable, byChannel },
    tag: 'rule',
    sql: `${base}\n-- then, per channel: EXISTS (${consented})\n-- never-asked = in segment minus ever-asked; withdrawn = ever-asked minus still-granted`,
    sources: ['fifo_summary_holding_active.present_market_value', 'consents.channel', '.purpose', '.state'],
  };
}

export interface Unreachable { client_id: number; name: string; value: number; reason: string; since: string | null }

/**
 * Named, but not contactable. Founder's ruling: show them greyed with a way to
 * ask, so the broker can see the gap and close it legitimately — rather than
 * hiding the fact that a third of his book cannot be reached.
 */
export function unreachable(sbId: number, channel: string): Figure<Unreachable[]> {
  const sql = `SELECT h.client_id, MAX(h.client_name) name, SUM(h.present_market_value) value,
      CASE WHEN MAX(CASE WHEN c.state='withdrawn' THEN 1 ELSE 0 END)=1
           THEN 'withdrew consent' ELSE 'never asked' END reason,
      MAX(CASE WHEN c.state='withdrawn' THEN c.ts END) since
    FROM fifo_summary_holding_active h
    LEFT JOIN consents c ON c.client_id=h.client_id AND c.channel=? AND c.purpose='marketing'
    WHERE h.advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)
    GROUP BY h.client_id
    HAVING SUM(h.present_market_value) > 100000
       AND MAX(CASE WHEN c.state='granted' THEN 1 ELSE 0 END) = 0
    ORDER BY value DESC`;
  return {
    value: db().prepare(sql).all(channel, sbId) as Unreachable[], tag: 'rule', sql,
    sources: ['consents.state', '.channel', '.ts', 'fifo_summary_holding_active.present_market_value'],
  };
}

export interface SendStat { channel: string; sent: number; delivered: number; failed: number; pending: number }

export function delivery(sbId: number): Figure<SendStat[]> {
  const sql = `SELECT channel, COUNT(*) sent,
      SUM(delivery_state='delivered') delivered,
      SUM(delivery_state='failed') failed,
      SUM(delivery_state='pending') pending
    FROM campaign_sends WHERE sb_id=? GROUP BY channel ORDER BY sent DESC`;
  return {
    value: db().prepare(sql).all(sbId) as SendStat[], tag: 'computed', sql,
    sources: ['campaign_sends.channel', '.delivery_state'],
  };
}

export interface ResponseRow {
  response_id: number; client_id: number; name: string; campaign: string; channel: string;
  response_type: string; responded_at: string;
  action_id: number | null; action_state: string | null; outcome_type: string | null;
  linked_amount: number | null;
}

/** Every response, and where it went. An interested reply becomes owned work. */
export function responses(sbId: number): Figure<ResponseRow[]> {
  const sql = `SELECT r.response_id, s.client_id, cm.cm_full_name name, c.name campaign, s.channel,
      r.response_type, r.responded_at,
      a.action_id, a.state action_state, a.outcome_type,
      (SELECT SUM(t.tr_amount) FROM json_each(a.linked_txn_ids) j
       JOIN transaction_master t ON t.tr_id = j.value) linked_amount
    FROM campaign_responses r
    JOIN campaign_sends s ON s.send_id = r.send_id
    JOIN campaigns c ON c.campaign_id = s.campaign_id
    JOIN client_master cm ON cm.cm_user_id = s.client_id
    LEFT JOIN actions a ON a.action_id = r.minted_action_id
    WHERE s.sb_id = ? ORDER BY r.responded_at DESC`;
  return {
    value: db().prepare(sql).all(sbId) as ResponseRow[], tag: 'computed', sql,
    sources: ['campaign_responses.response_type', '.minted_action_id', 'actions.outcome_type', '.linked_txn_ids'],
  };
}

export interface Roi {
  campaign: string; campaign_id: number; sends: number; delivered: number; responses: number;
  interested: number; closed: number; invested: number; attributed: number;
}

/**
 * ROI in rupees, the conservative way. `attributed` counts only transactions a
 * human named when closing the action. Responses that never closed, and money that
 * arrived without being linked, stay out of it — deliberately.
 */
export function roi(sbId: number): Figure<Roi[]> {
  const sql = `SELECT c.campaign_id, c.name campaign,
      COUNT(DISTINCT s.send_id) sends,
      SUM(s.delivery_state='delivered') delivered,
      COUNT(DISTINCT r.response_id) responses,
      COUNT(DISTINCT CASE WHEN r.response_type='replied_interested' THEN r.response_id END) interested,
      COUNT(DISTINCT CASE WHEN a.state='done' THEN a.action_id END) closed,
      COUNT(DISTINCT CASE WHEN a.outcome_type='invested' THEN a.action_id END) invested,
      COALESCE(SUM((SELECT SUM(t.tr_amount) FROM json_each(a.linked_txn_ids) j
        JOIN transaction_master t ON t.tr_id = j.value)), 0) attributed
    FROM campaigns c
    JOIN campaign_sends s ON s.campaign_id = c.campaign_id AND s.sb_id = ?
    LEFT JOIN campaign_responses r ON r.send_id = s.send_id
    LEFT JOIN actions a ON a.action_id = r.minted_action_id
    GROUP BY c.campaign_id ORDER BY attributed DESC, sends DESC`;
  return {
    value: db().prepare(sql).all(sbId) as Roi[], tag: 'computed', sql,
    sources: ['campaign_sends.delivery_state', 'campaign_responses.response_type', 'actions.linked_txn_ids', 'transaction_master.tr_amount'],
  };
}

export interface ConsentRow {
  client_id: number; name: string; channel: string; state: string;
  captured_via: string; ts: string;
}

/** The register itself — who agreed to what, when, and how it was captured. */
export function consentRegister(sbId: number): Figure<ConsentRow[]> {
  const sql = `SELECT DISTINCT c.client_id, cm.cm_full_name name, c.channel, c.state, c.captured_via, c.ts
    FROM consents c
    JOIN client_master cm ON cm.cm_user_id = c.client_id
    JOIN fifo_summary_holding_active h ON h.client_id = c.client_id
    WHERE c.purpose='marketing'
      AND h.advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)
    ORDER BY c.state DESC, c.ts DESC`;
  return {
    value: db().prepare(sql).all(sbId) as ConsentRow[], tag: 'computed', sql,
    sources: ['consents.channel', '.state', '.captured_via', '.ts'],
  };
}

/** Sent this month, for the card. Bounded by today — the seed holds no future rows. */
export function sentThisMonth(sbId: number): number {
  return (db().prepare(`SELECT COUNT(*) n FROM campaign_sends
    WHERE sb_id=? AND sent_at >= ? AND sent_at <= ?`)
    .get(sbId, TODAY.slice(0, 8) + '01', TODAY) as { n: number }).n;
}
