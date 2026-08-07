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
