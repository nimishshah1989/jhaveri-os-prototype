'use server';

import { revalidatePath } from 'next/cache';
import { db } from '../../lib/db';
import { TODAY } from '../../mockdb/engines';
import { DEMO_SB } from '../../lib/queries';
import { REPORTS, expiryFor } from '../../lib/reports';

// Requesting a report queues a job on the same table production already uses for
// its async PDFs. The row records what was asked for, how many rows it covers and
// when the download stops working — so "where is my report" is answerable without
// asking anyone.

export async function requestReport(formData: FormData): Promise<void> {
  const id = String(formData.get('report_id') ?? '');
  const format = String(formData.get('format') ?? 'pdf');
  const scope = String(formData.get('scope') ?? 'my book');
  const def = REPORTS.find(r => r.id === id);
  if (!def || !def.formats.includes(format as 'pdf' | 'xlsx')) return;

  const conn = db();
  const next = (conn.prepare('SELECT COALESCE(MAX(id),0)+1 n FROM download_history_logs').get() as { n: number }).n;
  const rows = def.rows(DEMO_SB);

  conn.prepare(`INSERT INTO download_history_logs
    (id, user_id, pdf_type, format, params, row_count, status, file_url, report_for,
     is_broker, requested_at, completed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?, 1, ?, ?, ?)`)
    .run(next, DEMO_SB, def.id, format, JSON.stringify({ scope, as_at: TODAY }), rows,
      `reports/${def.id}-${TODAY}.${format}`, scope, TODAY, TODAY, expiryFor(TODAY));

  conn.prepare(`INSERT INTO events (occurred_at, actor_type, actor_id, subject_type, subject_id, event_type, payload, source)
    VALUES (?, 'user', ?, 'report', ?, 'report_requested', ?, 'ui')`)
    .run(TODAY, String(DEMO_SB), def.id, JSON.stringify({ format, scope, rows }));

  revalidatePath('/reports');
}
