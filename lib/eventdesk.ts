import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { inr, inrCompact, dmy } from './format';
import { drift, handovers, commentary, riskStats } from './funds';

/* ── The answering fabric ────────────────────────────────────────────────────
   Phase 6, in three files rather than one: the event desk (what changed), ask
   (what you wanted to know), and the clock (what you asked us to do). They share
   one rule — every sentence is either derived from a row in this database, or it
   is written policy stored in one place and marked as such. Nothing is composed
   at render time.                                                             */


export type EventKind =
  | 'manager_changed' | 'manager_wrote' | 'style_moved' | 'mandate_ending'
  | 'instalment_failed' | 'worst_month';

/**
 * The house view, one sentence per kind of event. Written policy, edited by
 * people, stored in one place — not generated, and not per-fund. A kind with no
 * sentence renders the fact alone and says a view has not been written yet,
 * which is honest in a way an invented sentence never is.
 */
const HOUSE_VIEW: Partial<Record<EventKind, string>> = {
  manager_changed:
    'A change of manager is a reason to watch a fund for a few quarters, not a reason to sell one. What we look for is whether the portfolio starts to look different from the one described to you when you bought it.',
  manager_wrote:
    'We read every one of these. A manager who writes about what went wrong is worth more than one who only writes when it went right.',
  style_moved:
    'Funds drift. It matters when it changes what job the fund is doing in your portfolio — a large-cap that has quietly become a mid-cap is a different risk, not a different label.',
  mandate_ending:
    'A mandate is a bank permission with an expiry date, and it is the commonest way a good habit stops by accident. Renewing takes a minute and nothing else about your plan changes.',
  instalment_failed:
    'Almost none of these are decisions. The bank refused, and the plan stopped without anyone choosing to stop it — which is why we surface it rather than waiting for you to notice.',
  worst_month:
    'A fund below its high is not a fund that has failed; it is a fund you are holding at a discount to a price it once reached. What matters is whether the reason it fell is the reason you bought it.',
};

export interface DeskEvent {
  key: string;
  kind: EventKind;
  on: string;
  days_ago: number;
  /** What happened, in plain words, derived from a row. */
  what: string;
  /** What it means for this client's money, in rupees. Null when there is none. */
  consequence: string | null;
  /** Which fund it touches, when it touches one. */
  scheme_id: number | null;
  fund: string | null;
  /** The house's written view, or null when we have not written one. */
  view: string | null;
  /** Something to do about it, when there is something. */
  act: { kind: string; label: string } | null;
}

const daysAgo = (d: string) => Math.round((Date.parse(TODAY) - Date.parse(d)) / 864e5);

interface Held { scheme_id: number; fund_name: string; value: number }
type Add = (e: Omit<DeskEvent, 'days_ago' | 'view'>) => void;

/** What changed on the funds themselves — the manager, the words, the shape. */
function fundEvents(add: Add, held: Held[]): void {
  for (const h of held) {
    const short = h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '');

    for (const hv of handovers(h.scheme_id)) {
      add({
        key: `mgr-${h.scheme_id}-${hv.on}`, kind: 'manager_changed', on: hv.on,
        scheme_id: h.scheme_id, fund: short,
        what: `${hv.to_name} took over ${short} from ${hv.from_name}${hv.reason ? `, who ${hv.reason}` : ''}.`,
        consequence: `${inr(h.value)} of yours is in this fund — ${Math.round((h.value / Math.max(1, held.reduce((s, x) => s + x.value, 0))) * 100)}% of everything you hold here.`,
        act: { kind: 'call_rm', label: `Ask about the change on ${short}` },
      });
    }

    const note = commentary(h.scheme_id);
    if (note) {
      add({
        key: `note-${h.scheme_id}-${note.as_of}`, kind: 'manager_wrote', on: note.as_of,
        scheme_id: h.scheme_id, fund: short,
        what: `${note.manager} wrote about ${short}: “${note.headline}”.`,
        consequence: null,
        act: null,
      });
    }

    const d = drift(h.scheme_id);
    if (d?.changed_box) {
      add({
        key: `style-${h.scheme_id}`, kind: 'style_moved', on: d.to.as_of,
        scheme_id: h.scheme_id, fund: short,
        what: `${short} has moved from ${d.from.box.toLowerCase()} to ${d.to.box.toLowerCase()}.`,
        consequence: `Your ${inr(h.value)} in it is now buying a different kind of company than when you bought it.`,
        act: null,
      });
    }

    const rs = riskStats(h.scheme_id);
    if (rs && rs.max_drawdown < -12) {
      // The worst month is a fact about the fund's own price history, dated from it.
      const worst = db().prepare(
        `SELECT price_date d FROM mf_historical_price_master WHERE fk_scheme_id = ?
         ORDER BY price DESC LIMIT 1`,
      ).get(h.scheme_id) as { d: string } | undefined;
      if (worst) {
        add({
          key: `fall-${h.scheme_id}`, kind: 'worst_month', on: worst.d,
          scheme_id: h.scheme_id, fund: short,
          what: `${short} is ${Math.abs(rs.max_drawdown).toFixed(1)}% below its highest point, which it last touched in ${dmy(worst.d).slice(3)}.`,
          consequence: `On ${inr(h.value)}, that peak-to-here fall is about ${inrCompact(h.value * Math.abs(rs.max_drawdown) / 100)}.`,
          act: null,
        });
      }
    }
  }

}

/** A mandate with an end date: the commonest silent failure in this product. */
function mandateEvents(add: Add, clientId: number): void {
  const mandates = db().prepare(
    `SELECT m.end_date, m.amount, s.tr_amount monthly, sm.scheme_short_name fund, s.fk_from_scheme_id sid
     FROM sip_master s
     JOIN bse_sxp_list x ON x.reg_no = s.sxp_bos_code
     JOIN bse_mandate_list m ON m.exch_mandate_id = x.exch_mandate_id
     JOIN scheme_master sm ON sm.scheme_id = s.fk_from_scheme_id
     WHERE s.fk_acc_id = ? AND s.is_live_sip = 1 AND m.end_date IS NOT NULL`,
  ).all(clientId) as { end_date: string; monthly: number; fund: string; sid: number }[];
  for (const m of mandates) {
    const left = -daysAgo(m.end_date);
    if (left > 120) continue;
    add({
      key: `mandate-${m.sid}`, kind: 'mandate_ending',
      // Dated today when it has already lapsed, because it is today's problem.
      on: left >= 0 ? TODAY : m.end_date,
      scheme_id: m.sid, fund: m.fund,
      what: left >= 0
        ? `The bank permission behind your ${inr(m.monthly)} instalment ends on ${dmy(m.end_date)} — ${left === 0 ? 'today' : `in ${left} days`}.`
        : `The bank permission behind your ${inr(m.monthly)} instalment expired on ${dmy(m.end_date)}.`,
      consequence: `${inr(m.monthly)} a month stops going in, and nothing on your statement will say why.`,
      act: { kind: 'fix_mandate', label: 'Renew the mandate' },
    });
  }

}

/** Instalments the bank refused. Almost none of them were decisions. */
function bounceEvents(add: Add, clientId: number): void {
  const bounced = db().prepare(
    `SELECT t.tr_date d, t.tr_amount amt, sm.scheme_short_name fund, t.fk_scheme_id sid
     FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     JOIN scheme_master sm ON sm.scheme_id = t.fk_scheme_id
     WHERE t.fk_acc_id = ? AND tt.tr_type_name = 'SIP Rejection' AND t.is_active = 1
     ORDER BY t.tr_date DESC LIMIT 4`,
  ).all(clientId) as { d: string; amt: number; fund: string; sid: number }[];
  for (const b of bounced) {
    add({
      key: `bounce-${b.sid}-${b.d}`, kind: 'instalment_failed', on: b.d,
      scheme_id: b.sid, fund: b.fund,
      what: `Your ${inr(b.amt)} instalment into ${b.fund} was refused by the bank.`,
      consequence: `${inr(b.amt)} that should have bought units did not.`,
      act: { kind: 'fix_mandate', label: 'Fix the mandate' },
    });
  }

}

/**
 * Everything that has happened to this client's money, newest first. Every entry
 * traces to a row; none is written here.
 */
export function eventDesk(clientId: number, withinDays = 400): DeskEvent[] {
  const out: DeskEvent[] = [];
  const held = db().prepare(
    `SELECT scheme_id, fund_name, ROUND(present_market_value) value
     FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).all(clientId) as Held[];

  const add: Add = e => {
    const days = daysAgo(e.on);
    if (days > withinDays || days < 0) return;
    out.push({ ...e, days_ago: days, view: HOUSE_VIEW[e.kind] ?? null });
  };

  fundEvents(add, held);
  mandateEvents(add, clientId);
  bounceEvents(add, clientId);
  return out.sort((a, b) => (a.on < b.on ? 1 : a.on > b.on ? -1 : 0));
}

/** Event kinds with no written house view. Surfaced, never hidden. */
export function unviewedKinds(): EventKind[] {
  const kinds: EventKind[] = ['manager_changed', 'manager_wrote', 'style_moved', 'mandate_ending',
    'instalment_failed', 'worst_month'];
  return kinds.filter(k => !HOUSE_VIEW[k]);
}

