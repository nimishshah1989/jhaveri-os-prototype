'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../../lib/db';
import { TODAY } from '../../../mockdb/engines';
import { whoami } from '../../../lib/whoami';
import { household, STARTING_FLOOR } from '../../../lib/household';

/* The household's two acts. Both mint a real action on the manager's queue the
   same way `raise()` does, so nothing here is a second loop — but each also
   writes the row that makes it true, which a generic "ask my manager" cannot.

   SECURITY. The viewer is `whoami()` on the server, never the form. A consent
   row keyed on a client id posted by the browser would let anyone grant
   themselves sight of anyone else's money, which is exactly the shape of the
   feature it would pretend to be. `memberId` IS taken from the form and is
   therefore checked against the viewer's own household before it is used. */

function queue(clientId: number, kind: string, label: string, evidence: string, slaDays: number): void {
  const sb = (db().prepare(`SELECT fk_primary_sub_broker_id id FROM client_master WHERE cm_user_id = ?`)
    .get(clientId) as { id: number | null } | undefined)?.id ?? null;
  db().prepare(
    `INSERT INTO actions
      (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens,
       assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
     VALUES ('client', ?, ?, ?, 0, 'broker', ?, ?, date(?, '+' || ? || ' days'), 'assigned', 'client_app', ?)`,
  ).run(String(clientId), kind, JSON.stringify({ asked_by: 'client', label, evidence }),
    sb, label, TODAY, slaDays, TODAY);
  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'client', ?, ?, ?, 'client_app')`,
  ).run(TODAY, String(clientId), String(clientId), `client_${kind}`, JSON.stringify({ label, evidence }));
}

/**
 * Ask a member to share something. This writes the question, not the answer:
 * the row lands in `asked`, and only the subject can move it to `granted`. A
 * client who could grant themselves sight of a relative's money by pressing a
 * button in their own app would make the whole consent model decorative.
 */
export async function askToShare(formData: FormData): Promise<void> {
  const viewer = whoami();
  const memberId = Number(formData.get('member_id'));
  const scope = String(formData.get('scope') ?? '');
  if (!['total', 'holdings'].includes(scope)) return;

  const h = household(viewer);
  const m = h?.members.find(x => x.member_id === memberId);
  if (!h || !m || m.client_id == null || m.client_id === viewer) return;
  // Asking a guardian's minor, or asking again for something already given, is
  // not a question — it is noise on somebody's phone.
  if (m.minor && m.guardian_id === viewer) return;
  const at = scope === 'total' ? m.total : m.detail;
  if (at === 'granted') return;

  const first = m.name.split(' ')[0];
  const what = scope === 'total' ? 'what their money is worth' : 'the funds behind it';

  db().prepare(
    `INSERT INTO household_consents (family_id, subject_id, viewer_id, scope, state, asked_at, decided_at, decided_via)
     VALUES (?, ?, ?, ?, 'asked', ?, NULL, NULL)
     ON CONFLICT (family_id, subject_id, viewer_id, scope)
     DO UPDATE SET state = 'asked', asked_at = excluded.asked_at, decided_at = NULL, decided_via = NULL`,
  ).run(h.family_id, m.client_id, viewer, scope, TODAY);

  db().prepare(
    `INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
     VALUES (?, 'client', ?, 'client', ?, 'household_consent_asked', ?, 'client_app')`,
  ).run(TODAY, String(viewer), String(m.client_id), JSON.stringify({ viewer, scope }));

  queue(viewer, 'household_consent', `Ask ${first} to share ${what}`,
    `${h.family_name} · ${m.relation} · asked from the household page`, 3);

  revalidatePath('/me/household');
  revalidatePath(`/me/household/${memberId}`);
}

/**
 * Start somebody who has nothing. research/22 puts the barrier at a myth about
 * the minimum, not at the money, so the amount is named on the button rather
 * than left to a form the person has to guess at.
 */
export async function startMember(formData: FormData): Promise<void> {
  const viewer = whoami();
  const memberId = Number(formData.get('member_id'));
  const h = household(viewer);
  const m = h?.members.find(x => x.member_id === memberId);
  if (!h || !m || m.client_id != null) return;

  queue(viewer, 'start_member', `Open an account for ${m.name} and start ₹${STARTING_FLOOR} a month`,
    `${h.family_name} · ${m.relation}, aged ${m.age ?? '—'} · asked from the household page`, 3);

  revalidatePath('/me/household');
  revalidatePath(`/me/household/${memberId}`);
  revalidatePath('/me/desk');
}
