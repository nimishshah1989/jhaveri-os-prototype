'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';

// The loop, from the client's end. Everything the client does here mints a real
// action on their manager's queue and writes a dated event — the same two tables
// the broker lens reads, so an act taken in the app appears on Ravi's desk without
// a second system in between.
//
// SECURITY. The acting client is resolved on the server and is NEVER read from the
// form. A hidden client_id in a form is a client-supplied identity: today the lens
// has no auth so it changes nothing, but the day a session exists it would be an
// account-takeover shaped exactly like a feature. `whoami()` in `lib/whoami.ts` is
// the single place that changes — it becomes the session lookup, and RLS scopes
// every write beneath it. It moved out of this file because a `'use server'` module
// may only export async functions, and the money actions need it too.
import { whoami } from '../../lib/whoami';

function managerOf(clientId: number): number | null {
  const r = db().prepare(
    `SELECT fk_primary_sub_broker_id id FROM client_master WHERE cm_user_id=?`,
  ).get(clientId) as { id: number | null } | undefined;
  return r?.id ?? null;
}

/**
 * One entry point for every client act. `kind` is what happened, `label` is what
 * the client will see printed back, `evidence` is why it was offered.
 */
export async function raise(formData: FormData): Promise<void> {
  const clientId = whoami();          // never formData — see the note above
  const kind = String(formData.get('kind') ?? '').trim();
  const label = String(formData.get('label') ?? '').trim();
  const evidence = String(formData.get('evidence') ?? '');
  if (!clientId || !kind || !label) return;
  // kind and label reach a query and a queue, so bound them rather than trusting length.
  if (!/^[a-z0-9_]{2,40}$/.test(kind) || label.length > 160 || evidence.length > 400) return;

  const sb = managerOf(clientId);
  const sla = kind === 'call_rm' ? 1 : 3;

  db().prepare(
    `INSERT INTO actions
      (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens,
       assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
     VALUES ('client', ?, ?, ?, 0, 'broker', ?, ?, date(?, '+' || ? || ' days'), 'assigned', 'client_app', ?)`,
  ).run(String(clientId), kind, JSON.stringify({ asked_by: 'client', label, evidence }),
    sb, label, TODAY, sla, TODAY);

  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'client', ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(clientId), String(clientId), `client_${kind}`, JSON.stringify({ label, evidence }));

  revalidatePath('/me');
  revalidatePath('/me/desk');
  revalidatePath('/me/portfolio');
}
