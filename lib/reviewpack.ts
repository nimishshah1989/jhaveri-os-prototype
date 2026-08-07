import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { Figure } from './queries';
import { clientHeader, clientKpis, taxPosition, clientHoldings, fundVerdict, clientInteractions } from './client360';
import { clientHealth } from './scoring';

// A review pack is the client-facing version of what the broker already sees. It
// is assembled from the same functions Client 360 renders — nothing is retyped,
// so the pack and the screen can never disagree.
//
// Founder rulings (07-Aug-2026):
//   · Due = 12 months since the last pack OR an attention flag, whichever comes first.
//   · Packs carry proposals, not just performance — which makes them advice, so the
//     disclaimer and the audit trail are not optional.
//   · Co-branded: Jhaveri's compliance footing, the broker's name as the adviser.

export const REVIEW_RULES = {
  /** An annual review is the obligation; a flag pulls it forward. */
  review_months: 12,
  /** Written proposals are advice. This rides on every pack that carries one. */
  disclaimer: 'Mutual fund investments are subject to market risk. Read all scheme related documents carefully. '
    + 'Past performance does not indicate future returns. This review is prepared for the named investor and '
    + 'reflects holdings as at the stated date.',
  branding: 'co-branded',
} as const;

export interface DueRow {
  client_id: number; name: string; value: number;
  last_pack: string | null; months_since: number | null;
  flags: string; flag_count: number; health: number; gain: number;
  why: string; priority: number;
}

/**
 * Who needs a review, ranked. The ordering is money at stake × how overdue ×
 * whether anything is actually wrong — so a big portfolio that has gone quiet
 * outranks a small one that is merely due.
 */
export function due(sbId: number): Figure<DueRow[]> {
  const sql = `SELECT h.client_id, MAX(h.client_name) name, SUM(h.present_market_value) value,
      (SELECT MAX(p.generated_at) FROM review_packs p WHERE p.client_id = h.client_id) last_pack,
      (SELECT GROUP_CONCAT(DISTINCT a.flag_type) FROM mv_portfolio_attention a
        WHERE a.client_id = h.client_id) flags,
      (SELECT COUNT(DISTINCT a.flag_type) FROM mv_portfolio_attention a
        WHERE a.client_id = h.client_id) flag_count
    FROM fifo_summary_holding_active h
    WHERE h.advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id = ?)
      AND h.balance_units > 0.0001
    GROUP BY h.client_id ORDER BY value DESC`;
  const rows = db().prepare(sql).all(sbId) as Omit<DueRow, 'months_since' | 'health' | 'gain' | 'why' | 'priority'>[];

  const value = rows.map(r => {
    const months = r.last_pack
      ? Math.floor((Date.parse(TODAY) - Date.parse(r.last_pack)) / (86400000 * 30.44))
      : null;
    const overdue = months === null || months >= REVIEW_RULES.review_months;
    const h = clientHealth(r.client_id);
    const why = r.last_pack === null ? 'never had a review'
      : overdue ? `${months} months since the last pack`
        : r.flag_count > 0 ? `${(r.flags ?? '').split(',').join(' + ')} flagged since the last pack`
          : 'up to date';
    // Overdue and flagged both pull a client forward; money decides between equals.
    const urgency = (overdue ? 2 : 0) + Math.min(r.flag_count, 2) + (months === null ? 1 : 0);
    return {
      ...r, months_since: months, health: h.total, gain: h.gain, why,
      priority: Math.round(r.value * (1 + urgency) / 100000),
    };
  }).filter(r => r.why !== 'up to date')
    .sort((a, b) => b.priority - a.priority);

  return {
    value, tag: 'rule',
    sql: `${sql}\n-- then: due when no pack exists, or ${REVIEW_RULES.review_months}+ months since the last one,\n-- or an attention flag was raised. Ranked by value × urgency.`,
    sources: ['review_packs.generated_at', 'mv_portfolio_attention.flag_type', 'fifo_summary_holding_active.present_market_value'],
  };
}

export interface PackSection { key: string; title: string; source: string; lines: string[] }

export interface Pack {
  client_id: number; name: string; as_of: string;
  value: number; invested: number; xirr: number | null; benchmark: number | null;
  sections: PackSection[]; proposals: { label: string; why: string; gain: number }[];
  lastConversation: { kind: string; on: string; note: string } | null;
}

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;
const pct = (n: number | null) => (n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`);

/** The pack itself, assembled from the same functions Client 360 renders. */
export function pack(clientId: number): Pack | null {
  const head = clientHeader(clientId);
  if (!head) return null;
  const kpi = clientKpis(clientId).value;
  const tax = taxPosition(clientId).value;
  const holdings = clientHoldings(clientId).rows;
  const health = clientHealth(clientId);
  const chats = clientInteractions(clientId);

  const lagging = holdings.filter(h => fundVerdict(h).verdict === 'lagging');
  const sections: PackSection[] = [
    {
      key: 'performance', title: 'How your money has done',
      source: 'fifo_summary_holding.sh_xirr / .sh_bmxirr',
      lines: [
        `Your portfolio is worth ${inr(kpi.v)} against ${inr(kpi.invested)} invested.`,
        `Annualised return ${pct(kpi.wx)} against the benchmark's ${pct(kpi.bmx)}.`,
        kpi.wx != null && kpi.bmx != null
          ? kpi.wx >= kpi.bmx
            ? `You are ahead of the benchmark by ${(kpi.wx - kpi.bmx).toFixed(1)} percentage points.`
            : `You are behind the benchmark by ${(kpi.bmx - kpi.wx).toFixed(1)} percentage points.`
          : 'Holdings under a year are not annualised, so no comparison is shown for them.',
      ],
    },
    {
      key: 'holdings', title: 'What you hold',
      source: 'fifo_summary_holding_active',
      lines: [
        `${holdings.length} funds across ${new Set(holdings.map(h => h.folio_no)).size} folios.`,
        ...holdings.slice(0, 6).map(h => `${h.fund_name} — ${inr(h.value)}, ${pct(h.xirr)}`),
        holdings.length > 6 ? `… and ${holdings.length - 6} more, listed in full in the pack.` : '',
      ].filter(Boolean),
    },
    {
      key: 'tax', title: 'Where you stand on tax',
      source: 'fifo_summary_holding.sh_realized_* / .sh_unrealized_*',
      lines: [
        `Realised this year: ${inr(tax.real_lt)} long-term, ${inr(tax.real_st)} short-term.`,
        `Unrealised: ${inr(tax.unreal_lt)} long-term, ${inr(tax.unreal_st)} short-term.`,
        tax.unreal_lt > 0 && tax.unreal_lt < 125000
          ? `You have ${inr(125000 - tax.unreal_lt)} of long-term exemption unused this year.`
          : 'Long-term gains are above the annual exemption — worth planning the timing of any exit.',
      ],
    },
    {
      key: 'attention', title: 'What we are watching',
      source: 'mv_portfolio_attention + fund verdict rule',
      lines: lagging.length
        ? lagging.map(h => `${h.fund_name} is behind its benchmark — ${pct(h.xirr)} against ${pct(h.bmxirr)}.`)
        : ['Nothing in your portfolio is currently behind its benchmark.'],
    },
  ];

  // Proposals come from the same health levers as Client 360, so what the client
  // reads and what the broker is prompted to do are one thing, not two.
  const proposals = health.components
    .flatMap(c => c.levers.filter(l => !l.ghosted && l.kind !== 'hygiene')
      .map(l => ({ label: l.label, why: c.why, gain: l.delta })))
    .sort((a, b) => b.gain - a.gain).slice(0, 4);

  const last = chats[0];
  return {
    client_id: clientId, name: head.name, as_of: TODAY,
    value: kpi.v, invested: kpi.invested, xirr: kpi.wx, benchmark: kpi.bmx,
    sections, proposals,
    lastConversation: last ? { kind: last.kind, on: last.occurred_at, note: last.transcript ?? '' } : null,
  };
}

export interface PackRow {
  pack_id: number; client_id: number; name: string; generated_at: string;
  content_ref: string; sent_via: string; client_response: string | null; status: string;
}

/** What has been sent, and what came back. */
export function history(sbId: number): Figure<PackRow[]> {
  const sql = `SELECT p.pack_id, p.client_id, c.cm_full_name name, p.generated_at,
      p.content_ref, p.sent_via, p.client_response,
      COALESCE((SELECT d.status FROM download_history_logs d
        WHERE d.report_for = 'client:' || p.client_id AND d.pdf_type='REVIEW_PACK'
        ORDER BY d.id DESC LIMIT 1), 'COMPLETED') status
    FROM review_packs p
    JOIN client_master c ON c.cm_user_id = p.client_id
    WHERE p.sb_id = ? ORDER BY p.generated_at DESC`;
  return {
    value: db().prepare(sql).all(sbId) as PackRow[], tag: 'computed', sql,
    sources: ['review_packs.generated_at', '.sent_via', '.client_response', 'download_history_logs.status'],
  };
}

/** Packs still being rendered. Production runs this async; so does the prototype. */
export function queue(sbId: number): { id: number; report_for: string; requested_at: string }[] {
  return db().prepare(`SELECT id, report_for, requested_at FROM download_history_logs
    WHERE user_id = ? AND pdf_type='REVIEW_PACK' AND status='RUNNING' ORDER BY id DESC`)
    .all(sbId) as { id: number; report_for: string; requested_at: string }[];
}

export interface Coverage { book: number; reviewed: number; overdue: number; never: number; responded: number }

export function coverage(sbId: number): Figure<Coverage> {
  const rows = due(sbId).value;
  const sql = `SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active
    WHERE advisor_code = (SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)
      AND balance_units > 0.0001`;
  const book = (db().prepare(sql).get(sbId) as { n: number }).n;
  const packs = history(sbId).value;
  return {
    value: {
      book,
      reviewed: new Set(packs.map(p => p.client_id)).size,
      overdue: rows.filter(r => r.last_pack !== null).length,
      never: rows.filter(r => r.last_pack === null).length,
      responded: packs.filter(p => p.client_response).length,
    },
    tag: 'computed', sql,
    sources: ['review_packs.client_id', 'fifo_summary_holding_active.client_id'],
  };
}
