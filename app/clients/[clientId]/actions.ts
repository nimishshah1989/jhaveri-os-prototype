'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/db';
import { TODAY } from '../../../mockdb/engines';
import { DEMO_SB } from '../../../lib/queries';

// ponytail: no auth — prototype is hardwired to broker 4; real build derives
// the actor from the session and RLS scopes every write.

export async function captureNote(formData: FormData): Promise<void> {
  const clientId = Number(formData.get('client_id'));
  const note = String(formData.get('note') ?? '').trim();
  if (!clientId || !note) return;
  const mint = formData.get('mint') === 'on';
  let mintedActionId: number | null = null;
  if (mint) {
    const a = db().prepare(`INSERT INTO actions
      (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens, assignee_sb_id, sla_due, state, created_from, created_at)
      VALUES ('client', ?, 'manual', ?, 0, 'broker', ?, date(?, '+3 days'), 'assigned', 'manual', ?)`)
      .run(String(clientId), JSON.stringify({ note, minted_from: 'client-360 note' }), DEMO_SB, TODAY, TODAY);
    mintedActionId = Number(a.lastInsertRowid);
  }
  const i = db().prepare(`INSERT INTO interactions
    (client_id, sb_id, kind, transcript, structured, minted_action_id, occurred_at)
    VALUES (?, ?, 'note', ?, NULL, ?, ?)`)
    .run(clientId, DEMO_SB, note, mintedActionId, TODAY);
  db().prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'client', ?, 'interaction_captured', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(clientId), JSON.stringify({ interaction_id: Number(i.lastInsertRowid), minted_action_id: mintedActionId }));
  revalidatePath(`/clients/${clientId}`);
  if (mintedActionId) revalidatePath('/today');
}
