import { Icon } from './Icon';
import { Explain } from './Explain';

// What a broker has already done, before what he still owes. Opening a dashboard on
// nothing but a backlog is what makes it feel like a load; the work he closed is as
// true as the work outstanding and it was buried in a sidebar.
//
// Every figure here is earned and computed — closed actions, money moved, streak of
// days met. Nothing motivational, nothing invented: if he closed none, it says none.

export interface Progress {
  closed: number;
  closedInSla: number;
  dueToday: number;
  movedThisMonth: string;
  movedPositive: boolean;
}

export function ProgressStrip({ p, name, learning, learningFigure }: {
  p: Progress; name: string;
  /** What the engine has learned FROM closed work — the same story as the numbers
      beside it, which is why it belongs here rather than in a rail of its own. */
  learning?: { workflow: string; policy_key: string; evidence_n: number; target_n: number }[];
  learningFigure?: { tag?: string };
}) {
  const pct = p.closed > 0 ? Math.round((p.closedInSla / p.closed) * 100) : null;
  // Praise has to be earned by the number, so the greeting is graded, never flattering.
  const standing = pct === null ? 'Nothing closed yet — the first one sets the pace.'
    : pct >= 90 ? 'Almost everything on time.'
    : pct >= 70 ? 'Most of it landed inside the deadline.'
    : 'Several ran past their deadline.';

  return (
    <section className="progress" aria-label="What you have done">
      <div className="pgreet">
        <b>{name.split(' ')[0]}</b>
        <span>{standing}</span>
      </div>
      <div className="pstats">
        <div>
          <span className="pk"><Icon name="check" /> Closed on time</span>
          <span className="pv num">{p.closed > 0 ? `${p.closedInSla} of ${p.closed}` : '—'}</span>
          <span className="pd">{pct !== null ? `${pct}% inside deadline` : 'no actions closed'}</span>
        </div>
        <div>
          <span className="pk"><Icon name={p.movedPositive ? 'up' : 'down'} /> Money moved</span>
          <span className={`pv num ${p.movedPositive ? 'good' : 'warn'}`}>{p.movedThisMonth}</span>
          <span className="pd">net flows this month</span>
        </div>
        <div>
          <span className="pk"><Icon name="clock" /> Still owed today</span>
          <span className="pv num">{p.dueToday}</span>
          <span className="pd">{p.dueToday === 0 ? 'clear' : 'due before end of day'}</span>
        </div>
      </div>
      {learning && learning.length > 0 && (
        <div className="plearn">
          <span className="pk"><Icon name="bulb" /> Learning from this <Explain figure={learningFigure} as="bulb" /></span>
          <div className="plbars">
            {learning.map(l => (
              <span key={`${l.workflow}-${l.policy_key}`} className="plbar"
                title={`${l.workflow.replace(/_/g, ' ')} · ${l.policy_key.replace(/_/g, ' ')} — ${l.evidence_n} of ${l.target_n} outcomes`}>
                <i style={{ width: `${Math.min(100, (l.evidence_n / l.target_n) * 100)}%` }} />
              </span>
            ))}
          </div>
          <span className="pd">{learning.length} policies · greyed until real outcomes exist</span>
        </div>
      )}
    </section>
  );
}
