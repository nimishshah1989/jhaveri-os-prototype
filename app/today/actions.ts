'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// ponytail: no auth — the prototype is hardwired to broker 4. The real build
// derives the actor from the session and enforces RLS before any of these run.

// The drawer sends the next queue item along with the outcome, so working thirty
// items is one pass instead of thirty returns to the list. Called last, because
// redirect() throws by design.
function thenNext(formData: FormData): void {
  const next = Number(formData.get('next'));
  if (next) redirect(`/today?action=${next}`);
}

function emit(subjectId: number, eventType: string, payload: unknown): void {
  db().prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'action', ?, ?, ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(subjectId), eventType, JSON.stringify(payload));
}

export async function closeAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('action_id'));
  const outcome = String(formData.get('outcome_type') ?? '');
  if (!id || !outcome) return;
  const note = String(formData.get('note') ?? '');
  db().prepare("UPDATE actions SET state='done', outcome_type=?, outcome_value=?, closed_at=? WHERE action_id=? AND state != 'done'")
    .run(outcome, JSON.stringify({ note }), TODAY, id);
  emit(id, 'outcome_recorded', { outcome, note });
  revalidatePath('/today');
  thenNext(formData);
}

export async function dismissAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('action_id'));
  const reason = String(formData.get('dismiss_reason') ?? '');
  if (!id || !reason) return;
  db().prepare("UPDATE actions SET state='dismissed', dismiss_reason=?, closed_at=? WHERE action_id=?")
    .run(reason, TODAY, id);
  emit(id, 'action_dismissed', { reason });
  revalidatePath('/today');
  thenNext(formData);
}

export async function snoozeAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('action_id'));
  const days = Number(formData.get('days'));
  if (!id || !days) return;
  db().prepare("UPDATE actions SET sla_due = date(?, '+' || ? || ' days') WHERE action_id=?").run(TODAY, days, id);
  emit(id, 'action_snoozed', { days });
  revalidatePath('/today');
  thenNext(formData);
}

/**
 * Schedule, as distinct from snooze. Snooze says "not yet" and moves the date;
 * this says "here is when, and here is who with", and it writes an interaction so
 * the decision survives in the client's history rather than only in the queue.
 * The difference matters on the call afterwards: a broker can see that a meeting
 * was booked, not merely that an item went quiet for a week.
 */
export async function scheduleAction(formData: FormData): Promise<void> {
  const id = Number(formData.get('action_id'));
  const on = String(formData.get('on') ?? '').trim();
  const how = String(formData.get('how') ?? 'call').trim();
  if (!id || !on) return;

  const a = db().prepare(
    `SELECT subject_type, subject_id, assignee_sb_id FROM actions WHERE action_id = ?`,
  ).get(id) as { subject_type: string; subject_id: string; assignee_sb_id: number | null } | undefined;
  if (!a) return;

  // The SLA moves to the day it is booked for: an item scheduled for Friday is
  // not overdue on Wednesday, and leaving it red would train the broker to
  // ignore red.
  db().prepare('UPDATE actions SET sla_due = ? WHERE action_id = ?').run(on, id);
  emit(id, 'action_scheduled', { on, how });

  const clientId = a.subject_type === 'client' ? Number(a.subject_id)
    : (db().prepare('SELECT fk_acc_id id FROM sip_master WHERE sip_id = ?')
        .get(Number(a.subject_id)) as { id: number } | undefined)?.id;
  if (clientId) {
    db().prepare(`INSERT INTO interactions (client_id, sb_id, kind, transcript, structured, minted_action_id, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(clientId, a.assignee_sb_id, `${how}_scheduled`,
        `Scheduled a ${how} for ${on}`, JSON.stringify({ scheduled_for: on, how }), id, TODAY);
  }
  revalidatePath('/today');
  thenNext(formData);
}

export async function addTask(formData: FormData): Promise<void> {
  const note = String(formData.get('note') ?? '').trim();
  if (!note) return;
  const days = Number(formData.get('days') ?? 7);
  const info = db().prepare(`INSERT INTO actions
    (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens, assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
    VALUES ('broker', ?, 'manual', ?, 0, 'broker', ?, NULL, date(?, '+' || ? || ' days'), 'assigned', 'manual', ?)`)
    .run(String(DEMO_SB), JSON.stringify({ note }), DEMO_SB, TODAY, days, TODAY);
  emit(Number(info.lastInsertRowid), 'action_minted', { action_type: 'manual', note });
  revalidatePath('/today');
}
