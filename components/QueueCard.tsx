import type { QueueItem } from '../lib/queries';
import { inrCompact, dmy } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import { closeAction, dismissAction, snoozeAction } from '../app/today/actions';

const TYPE_LABEL: Record<string, string> = {
  sip_bounce_save: 'SIP bounce — save the plan',
  kyc_unstick: 'Onboarding stuck',
  mandate_expiring: 'Mandate expiring',
  idle_no_sip: 'Invested, no SIP',
  concentration_review: 'Concentration risk',
  dormant_review: 'Dormant client',
  tax_window: 'Tax-harvest window',
  birthday_week: 'Birthday',
  campaign_responder: 'Campaign response',
  manual: 'My task',
};

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

// Evidence keys → plain-English fragments. Unknown keys render as key: value.
function evidenceLine(raw: string): { key: string; text: string }[] {
  const ev = JSON.parse(raw) as Record<string, unknown>;
  const parts: { key: string; text: string }[] = [];
  const push = (key: string, text: string) => parts.push({ key, text });
  for (const [k, v] of Object.entries(ev)) {
    if (v == null) continue;
    switch (k) {
      case 'folio': push(k, `Folio ${v}`); break;
      case 'missed': push(k, `bounced ×${v}`); break;
      case 'monthly': push(k, `${inrCompact(Number(v))}/month`); break;
      case 'mandate_expires':
      case 'mandate_ends': push(k, `mandate ends ${dmy(String(v))}`); break;
      case 'stalled_at': push(k, `stalled at ${v}`); break;
      case 'since': push(k, `since ${dmy(String(v))}`); break;
      case 'value': push(k, `holds ${inrCompact(Number(v))}`); break;
      case 'holdings': push(k, `${v} schemes`); break;
      case 'suggested_monthly': push(k, `suggested ${inrCompact(Number(v))}/month`); break;
      case 'last_transaction': push(k, `last transaction ${dmy(String(v))}`); break;
      case 'weight_pct': push(k, `${v}% of portfolio in one scheme`); break;
      case 'unrealized_ltcg': push(k, `unrealised LTCG ${inrCompact(Number(v))}`); break;
      case 'fy_exemption': push(k, `FY exemption ${inrCompact(Number(v))}`); break;
      case 'birthday': push(k, `birthday ${dmy(String(v))}`); break;
      case 'in_days': break;
      case 'resolved_by': push(k, String(v)); break;
      case 'note': push(k, String(v)); break;
      default: push(k, `${k}: ${JSON.stringify(v)}`);
    }
  }
  return parts;
}

function slaLabel(due: string): { text: string; overdue: boolean } {
  const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 86400000);
  if (days < 0) return { text: `overdue ${-days}d`, overdue: true };
  if (days === 0) return { text: 'due today', overdue: true };
  if (days === 1) return { text: 'due tomorrow', overdue: false };
  return { text: `due in ${days}d`, overdue: false };
}

export function QueueCard({ item, readonly = false }: { item: QueueItem; readonly?: boolean }) {
  const auto = item.outcome_type === 'auto_resolved';
  const sla = slaLabel(item.sla_due);
  return (
    <div className="qcard">
      <div className="top">
        <span className="type">{TYPE_LABEL[item.action_type] ?? item.action_type}</span>
        {item.client_name && <span className="client">{item.client_name}</span>}
        {auto ? (
          <span className="chip auto">auto-closed</span>
        ) : (
          <span className={`sla ${sla.overdue ? 'overdue' : ''}`}>{sla.text}</span>
        )}
        {item.impact_score > 0 && <span className="impact num">{inrCompact(item.impact_score)}</span>}
      </div>
      <div className="evidence">
        {evidenceLine(item.trigger_evidence).map((p, i, arr) => (
          <span key={p.key}>
            <b>{p.text}</b>
            {i < arr.length - 1 ? ' · ' : ''}
          </span>
        ))}
      </div>
      {!auto && !readonly && (
        <div className="acts">
          <span className="step">{item.suggested_step}</span>
          <details>
            <summary>Done…</summary>
            <form className="pop" action={closeAction}>
              <input type="hidden" name="action_id" value={item.action_id} />
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
              <input type="hidden" name="action_id" value={item.action_id} />
              <label><input type="radio" name="days" value="1" required /> Tomorrow</label>
              <label><input type="radio" name="days" value="3" /> In 3 days</label>
              <label><input type="radio" name="days" value="7" /> Next week</label>
              <button type="submit">Snooze</button>
            </form>
          </details>
          <details>
            <summary>Dismiss…</summary>
            <form className="pop" action={dismissAction}>
              <input type="hidden" name="action_id" value={item.action_id} />
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
      )}
    </div>
  );
}
