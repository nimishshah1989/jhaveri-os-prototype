import { db } from './db';
import { DEMO_SB, type QueueItem } from './queries';

// Everything the broker needs before he picks up the phone. The queue row is the
// headline; this is the story behind it. Four questions, in the order he asks
// them: what happened · what do I do · who is this · has this ever worked.

export interface ActionDetail {
  item: QueueItem;
  created_at: string;
  created_from: string | null;
  client: ClientBrief | null;
  alsoOpen: { action_id: number; action_type: string; sla_due: string; impact_score: number }[];
  precedent: Precedent;
}

export interface ClientBrief {
  client_id: number;
  name: string;
  mobile: string | null;
  email: string | null;
  risk: string | null;
  value: number;
  since: string | null;
  last_contact: { kind: string; occurred_at: string } | null;
}

/**
 * How this kind of action has actually ended on this broker's own book — never a
 * global average dressed up as his number. Under five closed outcomes there is
 * nothing to learn from, so the drawer says so instead of printing a percentage
 * built on two data points.
 */
export interface Precedent {
  closed: number;
  won: number;
  enough: boolean;
}

const WON_OUTCOMES = "('saved','executed','invested','confirmed_genuine')";

export function actionDetail(id: number): ActionDetail | null {
  const item = db().prepare(`SELECT a.action_id, a.action_type, a.subject_type, a.subject_id, a.trigger_evidence,
      a.impact_score, a.sla_due, a.state, a.suggested_step, a.outcome_type, a.closed_at,
      a.created_at, a.created_from,
      COALESCE(c1.cm_user_id, c2.cm_user_id, c3.cm_user_id) client_id,
      COALESCE(c1.cm_full_name, c2.cm_full_name, c3.cm_full_name, l.name) client_name
    FROM actions a
    LEFT JOIN client_master c1 ON a.subject_type='client' AND c1.cm_user_id=CAST(a.subject_id AS INTEGER)
    LEFT JOIN sip_master s ON a.subject_type='sip' AND s.sip_id=CAST(a.subject_id AS INTEGER)
    LEFT JOIN client_master c2 ON c2.cm_user_id=s.fk_acc_id
    LEFT JOIN onboarding_applications oa ON a.subject_type='application' AND oa.application_id=CAST(a.subject_id AS INTEGER)
    LEFT JOIN client_master c3 ON c3.cm_user_id=oa.client_id
    LEFT JOIN leads l ON l.lead_id=oa.lead_id
    WHERE a.action_id=? AND a.assignee_sb_id=?`)
    .get(id, DEMO_SB) as (QueueItem & { created_at: string; created_from: string | null }) | undefined;
  if (!item) return null;

  // Only genuinely closed work counts. An item still sitting in the queue with a
  // provisional outcome on it is not a precedent, and auto-resolved ones were
  // never worked by a human — counting either would flatter the number.
  const precedent = db().prepare(`SELECT COUNT(*) closed,
      SUM(CASE WHEN outcome_type IN ${WON_OUTCOMES} THEN 1 ELSE 0 END) won
    FROM actions WHERE assignee_sb_id=? AND action_type=? AND state='done'
      AND outcome_type IS NOT NULL AND outcome_type != 'auto_resolved'`)
    .get(DEMO_SB, item.action_type) as { closed: number; won: number | null };

  return {
    item,
    created_at: item.created_at,
    created_from: item.created_from,
    client: item.client_id ? clientBrief(item.client_id) : null,
    alsoOpen: item.client_id ? alsoOpen(item.client_id, id) : [],
    precedent: { closed: precedent.closed, won: precedent.won ?? 0, enough: precedent.closed >= 5 },
  };
}

function clientBrief(id: number): ClientBrief | null {
  const row = db().prepare(`SELECT c.cm_user_id client_id, c.cm_full_name name,
      c.cm_mobile_number mobile, c.cm_email_id email, r.risk_profile risk,
      (SELECT COALESCE(SUM(present_market_value),0) FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id) value,
      (SELECT MIN(inv_since_date) FROM fifo_summary_holding_active WHERE client_id=c.cm_user_id) since
    FROM client_master c
    LEFT JOIN client_master_mf_related r ON r.fk_cm_user_id=c.cm_user_id
    WHERE c.cm_user_id=?`).get(id) as Omit<ClientBrief, 'last_contact'> | undefined;
  if (!row) return null;
  const last = db().prepare(`SELECT kind, occurred_at FROM interactions
    WHERE client_id=? ORDER BY occurred_at DESC LIMIT 1`).get(id) as ClientBrief['last_contact'];
  return { ...row, last_contact: last ?? null };
}

// The other work already sitting against this person. Without it he makes the
// same call three times in a week.
function alsoOpen(clientId: number, exceptId: number) {
  return db().prepare(`SELECT a.action_id, a.action_type, a.sla_due, a.impact_score
    FROM actions a
    LEFT JOIN sip_master s ON a.subject_type='sip' AND s.sip_id=CAST(a.subject_id AS INTEGER)
    LEFT JOIN onboarding_applications oa ON a.subject_type='application' AND oa.application_id=CAST(a.subject_id AS INTEGER)
    WHERE a.assignee_sb_id=? AND a.action_id != ?
      AND a.state IN ('proposed','assigned','in_progress')
      AND COALESCE(CASE WHEN a.subject_type='client' THEN CAST(a.subject_id AS INTEGER) END, s.fk_acc_id, oa.client_id) = ?
    ORDER BY a.sla_due ASC LIMIT 4`)
    .all(DEMO_SB, exceptId, clientId) as ActionDetail['alsoOpen'];
}
