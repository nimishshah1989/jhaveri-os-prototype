'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// ponytail: no auth — prototype is hardwired to broker 4; real build derives
// the actor from the session and RLS scopes every write.

export async function mintForClients(formData: FormData): Promise<void> {
  const ids = String(formData.get('client_ids') ?? '').split(',').map(Number).filter(Boolean);
  const note = String(formData.get('note') ?? '').trim() || 'Follow up';
  if (ids.length === 0) return;
  const insert = db().prepare(`INSERT INTO actions
    (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens, assignee_sb_id, sla_due, state, created_from, created_at)
    VALUES ('client', ?, 'manual', ?, 0, 'broker', ?, date(?, '+7 days'), 'assigned', 'manual', ?)`);
  const emit = db().prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'action', ?, 'action_minted', ?, 'ui')`);
  for (const id of ids) {
    const info = insert.run(String(id), JSON.stringify({ note, minted_from: 'my-clients bulk' }), DEMO_SB, TODAY, TODAY);
    emit.run(TODAY, String(DEMO_SB), String(info.lastInsertRowid), JSON.stringify({ action_type: 'manual', client_id: id, note }));
  }
  revalidatePath('/clients');
  revalidatePath('/today');
}
