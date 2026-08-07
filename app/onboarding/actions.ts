'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// Every move on this page is written to the ledger before anything else changes,
// so an application's history reads as a sequence of decisions with owners.
// ponytail: no auth — the prototype is hardwired to broker 4. The real build
// derives the actor from the session and enforces RLS before any of these run.

function emit(applicationId: number, eventType: string, payload: unknown, actorId: string | number = DEMO_SB): void {
  db().prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'application', ?, ?, ?, 'ui')`)
    .run(TODAY, String(actorId), String(applicationId), eventType, JSON.stringify(payload));
}

function refresh(): void {
  revalidatePath('/onboarding');
  revalidatePath('/today');
}

/** The broker takes it on: the action starts moving and the client hears from us. */
export async function nudgeApplication(formData: FormData): Promise<void> {
  const id = Number(formData.get('application_id'));
  const channel = String(formData.get('via') ?? 'whatsapp');
  if (!id) return;
  db().prepare(`UPDATE actions SET state='in_progress' WHERE subject_type='application'
    AND subject_id=? AND state IN ('proposed','assigned')`).run(String(id));
  emit(id, 'onboarding_nudged', { via: channel });
  refresh();
}

/** Escalation: a backend failure the broker cannot fix goes to the ops queue. */
export async function escalateToOps(formData: FormData): Promise<void> {
  const id = Number(formData.get('application_id'));
  const reason = String(formData.get('reason') ?? '').trim();
  if (!id || !reason) return;
  const existing = db().prepare(`SELECT action_id FROM actions WHERE subject_type='application'
    AND subject_id=? AND state NOT IN ('done','dismissed') ORDER BY action_id DESC LIMIT 1`)
    .get(String(id)) as { action_id: number } | undefined;
  if (existing) {
    db().prepare("UPDATE actions SET owner_lens='ops', assignee_sb_id=NULL, state='assigned', suggested_step=? WHERE action_id=?")
      .run(`Ops: ${reason}`, existing.action_id);
  }
  emit(id, 'onboarding_escalated', { to: 'ops', reason, action_id: existing?.action_id });
  refresh();
}

/** A rejection is answered: the corrected document is in, the file goes back. */
export async function refileRejection(formData: FormData): Promise<void> {
  const id = Number(formData.get('application_id'));
  const note = String(formData.get('note') ?? '').trim();
  if (!id || !note) return;
  db().prepare("UPDATE onboarding_applications SET kyc_status='PENDING', kra_status='Under Process', started_at=? WHERE application_id=?")
    .run(TODAY, id);
  db().prepare(`UPDATE client_kyc_logs SET status='PENDING', kra_status='Under Process', modification_date=?
    WHERE id = (SELECT kyc_log_id FROM onboarding_applications WHERE application_id=?)`).run(TODAY, id);
  db().prepare(`UPDATE actions SET state='done', outcome_type='refiled', outcome_value=?, closed_at=?
    WHERE subject_type='application' AND subject_id=? AND state NOT IN ('done','dismissed')`)
    .run(JSON.stringify({ note }), TODAY, String(id));
  emit(id, 'kyc_refiled', { note });
  refresh();
}

/** Start a new client: one lead, one KYC record, one application, on the board now. */
export async function startApplication(formData: FormData): Promise<void> {
  const name = String(formData.get('name') ?? '').trim();
  const mobile = String(formData.get('mobile') ?? '').trim();
  const channel = String(formData.get('channel') ?? 'digital');
  const source = String(formData.get('source') ?? 'link');
  // DPDP: no contact detail is stored without a recorded basis for holding it.
  if (!name || !mobile || formData.get('consent') !== 'on') return;

  const conn = db();
  const next = (table: string, col: string) =>
    ((conn.prepare(`SELECT COALESCE(MAX(${col}), 0) + 1 n FROM ${table}`).get() as { n: number }).n);
  const leadId = next('leads', 'lead_id');
  const appId = next('onboarding_applications', 'application_id');
  const logId = next('client_kyc_logs', 'id');
  const digital = channel === 'digital';

  conn.prepare(`INSERT INTO leads (lead_id, source, sb_id, name, mobile, consent_state, stage, created_at)
    VALUES (?, ?, ?, ?, ?, 'granted', 'onboarding', ?)`).run(leadId, source, DEMO_SB, name, mobile, TODAY);
  conn.prepare(`INSERT INTO client_kyc_logs (id, name, mobile_no, request_id, status, kra_status, kra_status_code, kyc_type, is_digio, kyc_linked, entry_date, modification_date)
    VALUES (?, ?, ?, ?, 'PENDING', 'Under Process', 'ERR-00000', ?, ?, 0, ?, ?)`)
    .run(logId, name, mobile, digital ? `DGO-${9000 + appId}` : `KRA-${9000 + appId}`, digital ? 'Aadhaar eKYC' : 'Physical KRA', digital ? 1 : 0, TODAY, TODAY);
  conn.prepare(`INSERT INTO onboarding_applications
    (application_id, lead_id, sb_id, channel, holding_type, digio_request_id, kyc_log_id, kyc_status, kra_status, started_at)
    VALUES (?, ?, ?, ?, 'Single', ?, ?, 'PENDING', 'Under Process', ?)`)
    .run(appId, leadId, DEMO_SB, channel, digital ? `DGO-${9000 + appId}` : null, logId, TODAY);

  emit(appId, 'lead_created', { source, consent: 'granted' });
  emit(appId, 'application_started', { channel, sb_id: DEMO_SB });
  refresh();
}
