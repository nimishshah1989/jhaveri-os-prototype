'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';

// A dispute is not a support ticket. It names the exact commission rows in
// question, becomes an owned ops action with an SLA, and its resolution lands
// back on the row that started it.
// ponytail: no auth — the prototype is hardwired to broker 4.

export async function raiseDispute(formData: FormData): Promise<void> {
  const reason = String(formData.get('reason') ?? '').trim();
  const refs = String(formData.get('rows') ?? '')
    .split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0);
  if (!reason || refs.length === 0) return;

  const conn = db();
  const amount = (conn.prepare(
    `SELECT COALESCE(SUM(reco_difference * bkr_payout_rate_precentage / 100), 0) v
     FROM brokerage_master WHERE bkr_id IN (${refs.map(() => '?').join(',')})`)
    .get(...refs) as { v: number }).v;

  const action = conn.prepare(`INSERT INTO actions
    (subject_type, subject_id, action_type, trigger_evidence, impact_score, owner_lens,
     assignee_sb_id, suggested_step, sla_due, state, created_from, created_at)
    VALUES ('broker', ?, 'payout_dispute', ?, ?, 'ops', NULL, ?, date(?, '+5 days'), 'assigned', 'dispute', ?)`)
    .run(String(DEMO_SB), JSON.stringify({ reason, brokerage_rows: refs.length, shortfall: Math.round(amount * 100) / 100 }),
      Math.abs(Math.round(amount * 100) / 100), 'Check the AMC statement against the rate card and re-raise with the AMC',
      TODAY, TODAY);
  const actionId = Number(action.lastInsertRowid);

  const dispute = conn.prepare(`INSERT INTO payout_disputes
    (sb_id, brokerage_row_refs, reason, state, raised_at, action_id)
    VALUES (?, ?, ?, 'open', ?, ?)`)
    .run(DEMO_SB, JSON.stringify(refs), reason, TODAY, actionId);

  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'dispute', ?, 'dispute_raised', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), String(dispute.lastInsertRowid),
      JSON.stringify({ reason, brokerage_rows: refs, action_id: actionId }));

  revalidatePath('/earnings');
  revalidatePath('/today');
}
