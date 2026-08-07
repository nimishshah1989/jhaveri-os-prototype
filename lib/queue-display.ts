import { inrCompact, dmy2 } from './format';
import { TODAY } from '../mockdb/engines';

// How a piece of queue work reads in English. One home, because the row and the
// drawer behind it must never describe the same action in two different ways.

export const TYPE: Record<string, { label: string; icon: string; tone: string }> = {
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

export function typeOf(actionType: string) {
  return TYPE[actionType] ?? { label: actionType.replace(/_/g, ' '), icon: 'info', tone: 'grey' };
}

// Evidence keys → plain English. Only the values carry weight; the connecting
// words stay quiet, so the eye lands on the number and not on "stalled at".
// Returns everything it can read — the row slices, the drawer does not.
export function evidence(raw: string): { lead: string; value: string }[] {
  const ev = JSON.parse(raw || '{}') as Record<string, unknown>;
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
      case 'note': out.push({ lead: '', value: String(v) }); break;
      case 'rejected_by': out.push({ lead: 'rejected by', value: String(v) }); break;
      case 'resolved_by': out.push({ lead: 'resolved by', value: String(v) }); break;
      case 'in_days': out.push({ lead: 'within', value: `${v} days` }); break;
      default: out.push({ lead: k.replace(/_/g, ' '), value: String(v) });
    }
  }
  return out;
}

export function sla(due: string): { text: string; tone: 'now' | 'soon' | 'later' } {
  const days = Math.round((Date.parse(due) - Date.parse(TODAY)) / 86400000);
  if (days < 0) return { text: `${-days}d over`, tone: 'now' };
  if (days === 0) return { text: 'today', tone: 'now' };
  if (days === 1) return { text: 'tomorrow', tone: 'soon' };
  if (days <= 7) return { text: `${days}d`, tone: 'soon' };
  return { text: dmy2(due), tone: 'later' };
}
