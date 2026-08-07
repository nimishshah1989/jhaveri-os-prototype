'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// Generating a pack writes three things: the pack itself, a row on the same async
// render queue production already uses, and a ledger event. Sending and the
// client's reply are separate steps, because they are separate facts.
// ponytail: no auth — the prototype is hardwired to broker 4.

export async function generatePack(formData: FormData): Promise<void> {
  const clientId = Number(formData.get('client_id'));
  const via = String(formData.get('via') ?? 'whatsapp');
  if (!clientId) return;

  const conn = db();
  const owns = conn.prepare(`SELECT COUNT(*) n FROM fifo_summary_holding_active
    WHERE client_id = ? AND advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id = ?)`)
    .get(clientId, DEMO_SB) as { n: number };
  if (!owns.n) return;                       // not this broker's client to review

  const name = (conn.prepare('SELECT cm_full_name n FROM client_master WHERE cm_user_id=?')
    .get(clientId) as { n: string }).n;
  const packId = (conn.prepare('SELECT COALESCE(MAX(pack_id),0)+1 n FROM review_packs').get() as { n: number }).n;
  const slug = name.toLowerCase().replace(/[^a-z]/g, '-');

  conn.prepare(`INSERT INTO review_packs
    (pack_id, client_id, sb_id, generated_at, content_ref, sent_via, client_response, action_ids)
    VALUES (?, ?, ?, ?, ?, ?, NULL, '[]')`)
    .run(packId, clientId, DEMO_SB, TODAY, `packs/${slug}-${TODAY.slice(0, 7)}.pdf`, via);

  const dlId = (conn.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM download_history_logs').get() as { n: number }).n;
  conn.prepare(`INSERT INTO download_history_logs
    (id, user_id, pdf_type, status, file_url, report_for, is_broker, requested_at, completed_at)
    VALUES (?, ?, 'REVIEW_PACK', 'COMPLETED', ?, ?, 1, ?, ?)`)
    .run(dlId, DEMO_SB, `reports/pack-${packId}.pdf`, `client:${clientId}`, TODAY, TODAY);

  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'client', ?, 'review_pack_sent', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(clientId), JSON.stringify({ pack_id: packId, via }));

  revalidatePath('/review-packs');
  revalidatePath(`/clients/${clientId}`);
}

/** What the client did with it. Unanswered stays unanswered until someone says so. */
export async function recordResponse(formData: FormData): Promise<void> {
  const packId = Number(formData.get('pack_id'));
  const response = String(formData.get('response') ?? '');
  if (!packId || !response) return;

  const conn = db();
  const row = conn.prepare('SELECT client_id FROM review_packs WHERE pack_id=? AND sb_id=?')
    .get(packId, DEMO_SB) as { client_id: number } | undefined;
  if (!row) return;

  conn.prepare('UPDATE review_packs SET client_response=? WHERE pack_id=?').run(response, packId);
  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'client', ?, 'review_pack_response', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(row.client_id), JSON.stringify({ pack_id: packId, response }));

  // A booked meeting is work, so it becomes an owned action rather than a note.
  if (response === 'meeting_booked') {
    conn.prepare(`INSERT INTO actions
      (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens,
       assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
      VALUES ('client', ?, 'review_meeting', ?, 0, 'broker', ?, 'Hold the review meeting', date(?, '+7 days'), 'assigned', ?, ?)`)
      .run(String(row.client_id), JSON.stringify({ pack_id: packId }), DEMO_SB, TODAY, `pack:${packId}`, TODAY);
  }

  revalidatePath('/review-packs');
  revalidatePath('/today');
}
