'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/db';
import { TODAY } from '../../../mockdb/engines';
import { DEMO_SB } from '../../../lib/queries';

// The loop, closed: a lever is chosen, referred, or declined — and every one of
// those three is written to the ledger. Actions minted here carry
// created_from='lever:<component>:<key>', so when the action is later closed with
// an outcome on Today, the outcome traces back to the suggestion that caused it.
// ponytail: no auth — prototype is hardwired to broker 4.

function logDecision(clientId: number, ref: string, decision: string, payload: Record<string, unknown>): void {
  db().prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'client', ?, ?, ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(clientId), decision, JSON.stringify({ lever: ref, ...payload }));
}

export async function chooseLever(formData: FormData): Promise<void> {
  const clientId = Number(formData.get('client_id'));
  const component = String(formData.get('component') ?? '');
  const leverKey = String(formData.get('lever_key') ?? '');
  const label = String(formData.get('label') ?? '');
  const delta = Number(formData.get('delta') ?? 0);
  const mode = String(formData.get('mode') ?? 'self');
  if (!clientId || !leverKey) return;

  const ref = `lever:${component}:${leverKey}`;
  const manager = db().prepare('SELECT fk_reporting_to id FROM sb_hierarchy WHERE fk_sb_id=?').get(DEMO_SB) as { id: number | null } | undefined;
  const assignee = mode === 'rm' && manager?.id ? manager.id : DEMO_SB;
  const slaDays = mode === 'rm' ? 5 : 3;

  const info = db().prepare(`INSERT INTO actions
    (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens, assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
    VALUES ('client', ?, 'health_lever', ?, 0, 'broker', ?, ?, date(?, '+' || ? || ' days'), 'assigned', ?, ?)`)
    .run(String(clientId), JSON.stringify({ lever: label, health_gain: delta, component, routed: mode === 'rm' ? 'relationship manager' : 'self' }),
      assignee, label, TODAY, slaDays, ref, TODAY);

  logDecision(clientId, ref, mode === 'rm' ? 'lever_referred' : 'lever_accepted', {
    label, health_gain: delta, action_id: Number(info.lastInsertRowid), assignee_sb_id: assignee,
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/today');
}

export async function declineLever(formData: FormData): Promise<void> {
  const clientId = Number(formData.get('client_id'));
  const component = String(formData.get('component') ?? '');
  const leverKey = String(formData.get('lever_key') ?? '');
  const label = String(formData.get('label') ?? '');
  const reason = String(formData.get('reason') ?? '');
  if (!clientId || !leverKey || !reason) return;
  logDecision(clientId, `lever:${component}:${leverKey}`, 'lever_declined', { label, reason });
  revalidatePath(`/clients/${clientId}`);
}

export interface LeverDecision {
  occurred_at: string;
  event_type: string;
  lever: string;
  label: string;
  reason?: string;
  action_id?: number;
  action_state?: string;
  outcome_type?: string | null;
}

/** The decision trail: what was suggested, what was chosen, and how it ended. */
export async function leverTrail(clientId: number): Promise<LeverDecision[]> {
  const rows = db().prepare(`SELECT e.occurred_at, e.event_type, e.payload, a.action_id, a.state action_state, a.outcome_type
    FROM events e
    LEFT JOIN actions a ON a.action_id = CAST(json_extract(e.payload, '$.action_id') AS INTEGER)
    WHERE e.subject_type='client' AND e.subject_id=? AND e.event_type LIKE 'lever_%'
    ORDER BY e.event_id DESC LIMIT 20`).all(String(clientId)) as
    { occurred_at: string; event_type: string; payload: string; action_id: number | null; action_state: string | null; outcome_type: string | null }[];
  return rows.map(r => {
    const p = JSON.parse(r.payload) as Record<string, string>;
    return {
      occurred_at: r.occurred_at,
      event_type: r.event_type,
      lever: p.lever,
      label: p.label,
      reason: p.reason,
      action_id: r.action_id ?? undefined,
      action_state: r.action_state ?? undefined,
      outcome_type: r.outcome_type,
    };
  });
}
