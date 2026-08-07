'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// The two gates live here as guard clauses, not as UI state. Disabling a button
// is a courtesy; refusing the write is the control.
// ponytail: no auth — the prototype is hardwired to broker 4.

export async function launchCampaign(formData: FormData): Promise<void> {
  const campaignId = Number(formData.get('campaign_id'));
  const channel = String(formData.get('channel') ?? '');
  if (!campaignId || !channel) return;

  const conn = db();
  // GATE 1 — compliance. A template with no approval artefact cannot be sent,
  // whatever the UI allowed the user to click.
  const approved = conn.prepare(`SELECT t.approval_artefact_ref ref FROM campaigns c
    JOIN campaign_templates t ON t.template_id = c.template_id
    WHERE c.campaign_id = ?`).get(campaignId) as { ref: string | null } | undefined;
  if (!approved?.ref) return;

  // GATE 2 — DPDP. The recipient list IS the consent query. There is no separate
  // list that could drift out of step with it.
  const recipients = conn.prepare(`SELECT DISTINCT h.client_id
    FROM fifo_summary_holding_active h
    JOIN consents c ON c.client_id = h.client_id
      AND c.channel = ? AND c.purpose = 'marketing' AND c.state = 'granted'
    WHERE h.advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id = ?)
    GROUP BY h.client_id HAVING SUM(h.present_market_value) > 100000`)
    .all(channel, DEMO_SB) as { client_id: number }[];
  if (!recipients.length) return;

  const nextSend = (conn.prepare('SELECT COALESCE(MAX(send_id), 0) + 1 n FROM campaign_sends').get() as { n: number }).n;
  const insert = conn.prepare(`INSERT INTO campaign_sends
    (send_id, campaign_id, client_id, sb_id, channel, sent_at, delivery_state)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')`);
  recipients.forEach((rcp, i) => insert.run(nextSend + i, campaignId, rcp.client_id, DEMO_SB, channel, TODAY));

  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'campaign', ?, 'campaign_sent', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(campaignId),
      JSON.stringify({ channel, recipients: recipients.length, sb_id: DEMO_SB, approval_artefact: approved.ref }));

  revalidatePath('/marketing');
}

/**
 * Asking for consent is itself work, so it becomes an owned action rather than a
 * silent flag flip. Nothing about the client's consent changes here — only they
 * can grant it.
 */
export async function requestConsent(formData: FormData): Promise<void> {
  const clientId = Number(formData.get('client_id'));
  const channel = String(formData.get('channel') ?? '');
  if (!clientId || !channel) return;

  const conn = db();
  const already = conn.prepare(`SELECT action_id FROM actions WHERE subject_type='client'
    AND subject_id=? AND action_type='consent_request' AND state NOT IN ('done','dismissed')`)
    .get(String(clientId)) as { action_id: number } | undefined;
  if (already) return;

  const info = conn.prepare(`INSERT INTO actions
    (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens,
     assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
    VALUES ('client', ?, 'consent_request', ?, 0, 'broker', ?, ?, date(?, '+14 days'), 'assigned', 'manual', ?)`)
    .run(String(clientId), JSON.stringify({ channel, purpose: 'marketing' }), DEMO_SB,
      `Ask for ${channel} marketing consent at the next conversation`, TODAY, TODAY);

  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'client', ?, 'consent_requested', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(clientId),
      JSON.stringify({ channel, action_id: Number(info.lastInsertRowid) }));

  revalidatePath('/marketing');
  revalidatePath('/today');
}
