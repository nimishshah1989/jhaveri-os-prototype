import { closeAction, dismissAction, snoozeAction } from '../app/today/actions';

// The three things you can do to a piece of work: finish it, push it, or kill it.
// Killing it always costs a reason — that is what keeps the queue honest about
// why work disappears.

const OUTCOMES = [
  ['saved', 'Saved — client acted'],
  ['executed', 'Executed — transaction done'],
  ['client_declined', 'Client declined'],
  ['no_response', 'No response'],
] as const;

const DISMISS_REASONS = [
  ['not_relevant', 'Not relevant'],
  ['data_error', 'Data error'],
  ['duplicate', 'Duplicate'],
  ['client_unreachable', 'Client unreachable'],
] as const;

export function QueueActions({ actionId, step, next }: {
  actionId: number; step: string | null;
  /** When set, closing or dismissing lands on that item instead of the bare list. */
  next?: number;
}) {
  const nextField = next ? <input type="hidden" name="next" value={next} /> : null;
  return (
    <div className="qacts">
      <details>
        <summary title={step ?? 'Record the outcome'}>Done</summary>
        <form className="pop" action={closeAction}>
          <input type="hidden" name="action_id" value={actionId} />
          {nextField}
          {step && <p className="stephint">{step}</p>}
          {OUTCOMES.map(([v, l]) => (
            <label key={v}>
              <input type="radio" name="outcome_type" value={v} required /> {l}
            </label>
          ))}
          <input type="text" name="note" placeholder="Note (optional)" />
          <button type="submit">Record outcome</button>
        </form>
      </details>
      <details>
        <summary>Snooze</summary>
        <form className="pop" action={snoozeAction}>
          <input type="hidden" name="action_id" value={actionId} />
          {nextField}
          <label><input type="radio" name="days" value="1" required /> Tomorrow</label>
          <label><input type="radio" name="days" value="3" /> In 3 days</label>
          <label><input type="radio" name="days" value="7" /> Next week</label>
          <button type="submit">Snooze</button>
        </form>
      </details>
      <details>
        <summary>Dismiss</summary>
        <form className="pop" action={dismissAction}>
          <input type="hidden" name="action_id" value={actionId} />
          {nextField}
          <select name="dismiss_reason" required defaultValue="">
            <option value="" disabled>Reason (required)</option>
            {DISMISS_REASONS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
          <button type="submit">Dismiss</button>
        </form>
      </details>
    </div>
  );
}
