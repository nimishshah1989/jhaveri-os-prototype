import type { QueueItem } from '../lib/queries';
import { inrCompact, dmy, dmy2 } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import { ClientLink } from './ClientLink';
import { Collapse } from './Collapse';
import { Icon } from './Icon';
import { QueueActions } from './QueueActions';

// The queue is a list of work, so it is a table. Six stacked boxes wasted the
// space between them and made every row look equally important.
//
// ONE hierarchy law, applied here and everywhere else:
//   1. the subject — who this is about — is the strongest thing in the row
//   2. the money is second, tabular, right-aligned
//   3. the category is an icon and a quiet chip; it is a filter, not a headline
//   4. everything else is muted, and only the numbers inside it get weight
// Nothing outside that list is bold. That rule is what makes a row scannable.

const TYPE: Record<string, { label: string; icon: string; tone: string }> = {
  sip_bounce_save: { label: 'SIP bounce', icon: 'alert', tone: 'red' },
  kyc_unstick: { label: 'Onboarding', icon: 'clock', tone: 'amber' },
  mandate_expiring: { label: 'Mandate', icon: 'calendar', tone: 'amber' },
  idle_no_sip: { label: 'No SIP', icon: 'target', tone: 'blue' },
  concentration_review: { label: 'Concentration', icon: 'alert', tone: 'amber' },
  dormant_review: { label: 'Dormant', icon: 'users', tone: 'grey' },
  tax_window: { label: 'Tax window', icon: 'money', tone: 'green' },
  birthday_week: { label: 'Birthday', icon: 'spark', tone: 'grey' },
  campaign_responder: { label: 'Campaign', icon: 'mail', tone: 'blue' },
  health_lever: { label: 'Health', icon: 'spark', tone: 'green' },
  review_meeting: { label: 'Review', icon: 'file', tone: 'blue' },
  payout_dispute: { label: 'Dispute', icon: 'money', tone: 'amber' },
  consent_request: { label: 'Consent', icon: 'shield', tone: 'grey' },
  euin_remediation: { label: 'EUIN', icon: 'shield', tone: 'amber' },
  manual: { label: 'My task', icon: 'check', tone: 'grey' },
};

// Evidence keys → plain English. Only the values carry weight; the connecting
// words stay quiet, so the eye lands on the number and not on "stalled at".
function evidence(raw: string): { lead: string; value: string }[] {
  const ev = JSON.parse(raw) as Record<string, unknown>;
  const out: { lead: string; value: string }[] = [];
  for (const [k, v] of Object.entries(ev)) {
    if (v == null) continue;
    switch (k) {
      case 'folio': out.push({ lead: 'folio', value: String(v) }); break;
      case 'missed': out.push({ lead: 'bounced', value: `×${v}` }); break;
      case 'monthly': out.push({ lead: '', value: `${inrCompact(Number(v))}/mo` }); break;
      case 'mandate_expires':
      case 'mandate_ends': out.push({ lead: 'mandate ends', value: dmy2(String(v)) }); break;
      case 'stalled_at': out.push({ lead: 'stuck at', value: String(v) }); break;
      case 'since': out.push({ lead: 'since', value: dmy2(String(v)) }); break;
      case 'value': out.push({ lead: 'holds', value: inrCompact(Number(v)) }); break;
      case 'holdings': out.push({ lead: '', value: `${v} schemes` }); break;
      case 'suggested_monthly': out.push({ lead: 'suggest', value: `${inrCompact(Number(v))}/mo` }); break;
      case 'last_transaction': out.push({ lead: 'last txn', value: dmy2(String(v)) }); break;
      case 'weight_pct': out.push({ lead: '', value: `${v}% in one scheme` }); break;
      case 'unrealized_ltcg': out.push({ lead: 'unrealised LTCG', value: inrCompact(Number(v)) }); break;
      case 'fy_exemption': out.push({ lead: 'exemption', value: inrCompact(Number(v)) }); break;
      case 'birthday': out.push({ lead: 'birthday', value: dmy2(String(v)) }); break;
      case 'error_code': out.push({ lead: 'KRA', value: String(v) }); break;
      case 'campaign': out.push({ lead: '', value: String(v) }); break;
      case 'response': out.push({ lead: '', value: String(v).replace(/_/g, ' ') }); break;
      case 'channel': out.push({ lead: 'on', value: String(v) }); break;
      case 'rejected_by':
      case 'in_days':
      case 'note':
      case 'resolved_by': break;
      default: out.push({ lead: k.replace(/_/g, ' '), value: String(v) });
    }
  }
  return out.slice(0, 3);
}

function sla(due: string): { text: string; tone: 'now' | 'soon' | 'later' } {
  const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 86400000);
  if (days < 0) return { text: `${-days}d over`, tone: 'now' };
  if (days === 0) return { text: 'today', tone: 'now' };
  if (days === 1) return { text: 'tomorrow', tone: 'soon' };
  if (days <= 7) return { text: `${days}d`, tone: 'soon' };
  return { text: dmy2(due), tone: 'later' };
}

export function QueueTable({ items, readonly = false, shown = 5 }: {
  items: QueueItem[]; readonly?: boolean; shown?: number;
}) {
  if (items.length === 0) return <div className="empty">Nothing here today.</div>;

  const rows = items.map(item => {
    const t = TYPE[item.action_type] ?? { label: item.action_type, icon: 'info', tone: 'grey' };
    const auto = item.outcome_type === 'auto_resolved';
    const d = sla(item.sla_due);
    return (
      <tr key={item.action_id}>
        <td className="qtype">
          <span className={`tchip ${t.tone}`} title={item.action_type}>
            <Icon name={t.icon} /> {t.label}
          </span>
        </td>
        <td className="qwho">
          <ClientLink id={item.client_id} name={item.client_name ?? '—'} />
        </td>
        <td className="qwhy">
          {evidence(item.trigger_evidence).map((p, i) => (
            <span key={i}>
              {p.lead && <span className="lead">{p.lead} </span>}
              <b>{p.value}</b>
              {i < evidence(item.trigger_evidence).length - 1 ? <span className="lead"> · </span> : null}
            </span>
          ))}
        </td>
        <td className="r num qmoney">{item.impact_score > 0 ? inrCompact(item.impact_score) : ''}</td>
        <td className="qgain">
          {(item.score_gain ?? 0) > 0 && <span className="gainchip">+{item.score_gain}</span>}
        </td>
        <td className="qdue">
          {auto
            ? <span className="tchip grey">auto-closed</span>
            : <span className={`due ${d.tone}`}>{d.text}</span>}
        </td>
        <td className="qact">
          {!auto && !readonly && <QueueActions actionId={item.action_id} step={item.suggested_step} />}
        </td>
      </tr>
    );
  });

  return (
    <div className="tblwrap queue">
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Type</th>
            <th style={{ textAlign: 'left' }}>Client</th>
            <th style={{ textAlign: 'left' }}>Why</th>
            <th className="r">At stake</th>
            <th>Health</th>
            <th>Due</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <Collapse items={rows} shown={shown} noun="in this queue" as="rows" span={7} />
        </tbody>
      </table>
    </div>
  );
}
