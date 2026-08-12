import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* The clock. Anything the client asked for, with who holds it and when it was
   promised. research/22 puts support at 24% of what makes a house trustworthy —
   ahead of digital experience — and research/15 records that our predecessor app
   died of unanswered support. A queue you cannot see is the same as no queue. */

const daysAgo = (d: string) => Math.round((Date.parse(TODAY) - Date.parse(d)) / 864e5);

export interface Ticket {
  action_id: number;
  label: string;
  kind: string;
  raised: string;
  days_open: number;
  promised: string;
  /** Negative = overdue by that many days. */
  days_left: number;
  /** The named human holding it. Never "the team". */
  with_whom: string;
  state: string;
  closed: string | null;
  /** How it ended, when it has. */
  outcome: string | null;
  overdue: boolean;
}

/**
 * Everything this client has asked for, with a clock on it. research/22 ranks
 * support at 24% of what makes a house trustworthy — ahead of digital experience
 * — and research/15 records that our predecessor app died of unanswered support.
 * A queue you cannot see is the same as no queue.
 */
export function tickets(clientId: number): Ticket[] {
  const rows = db().prepare(
    `SELECT a.action_id, COALESCE(a.suggested_step, a.action_type) label, a.action_type kind,
            a.created_at raised, a.sla_due promised, a.state, a.closed_at closed,
            a.outcome_type outcome,
            COALESCE(sb.sb_holder_name, 'the house desk') with_whom
     FROM actions a
     LEFT JOIN sub_broker_master sb ON sb.sb_id = a.assignee_sb_id
     WHERE a.subject_type = 'client' AND a.subject_id = ? AND a.created_from = 'client_app'
     ORDER BY a.created_at DESC, a.action_id DESC`,
  ).all(String(clientId)) as Omit<Ticket, 'days_open' | 'days_left' | 'overdue'>[];

  return rows.map(r => {
    const open = !['done', 'closed', 'dismissed'].includes(r.state);
    const days_left = -daysAgo(r.promised);
    return {
      ...r,
      days_open: daysAgo(r.raised) - (r.closed ? daysAgo(r.closed) : 0),
      days_left,
      overdue: open && days_left < 0,
    };
  });
}

/** The one line a Desk prints about its own record. Derived, never claimed. */
export function clockSummary(clientId: number): { open: number; overdue: number; closed: number; median_days: number | null } {
  const t = tickets(clientId);
  const closed = t.filter(x => x.closed);
  const spans = closed.map(x => Math.max(0, daysAgo(x.raised) - daysAgo(x.closed!))).sort((a, b) => a - b);
  return {
    open: t.filter(x => !x.closed).length,
    overdue: t.filter(x => x.overdue).length,
    closed: closed.length,
    median_days: spans.length ? spans[Math.floor(spans.length / 2)] : null,
  };
}
