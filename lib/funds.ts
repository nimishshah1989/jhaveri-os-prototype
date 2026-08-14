import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* ── Fund intelligence, on the way to a page ─────────────────────────────────
   Phase 4. Everything here reads the tables `mockdb/seed-funds.ts` writes, and
   every function carries the provenance forward rather than dropping it: a
   screen that cannot say whether a number was measured or supplied is a screen
   that will eventually print a vendor's guess as our own arithmetic.

   Two rules this file enforces on the way out:

   1. A held fund with no manager renders a dash and a reason, never a blank.
   2. Nothing Morningstar-branded reaches the client until the licensing question
      is answered. `scheme_rating` is deliberately unexported — the ratings are
      stored, and `ratingVisible()` is the single gate that would let them out.  */

export type Provenance = 'computed' | 'seeded';

/** The one sentence a page prints under a seeded figure. Written once, used everywhere. */
export const SEEDED_NOTE =
  'Stands in for the Morningstar feed, which is not connected yet. The shape is real; this particular number is not.';

export interface Manager {
  manager_id: number;
  name: string;
  first: string;
  /** When they took this fund. */
  since: string;
  /** Whole months at the helm of this fund, today. */
  months: number;
  managing_since: string | null;
  qualification: string | null;
  philosophy: string;
  role: string;
  source: Provenance;
}

const monthsBetween = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 2.6298e9));

/** Who runs this fund today, and since when. Null when nobody is on file. */
export function manager(schemeId: number): Manager | null {
  const r = db().prepare(
    `SELECT m.manager_id, m.full_name name, m.managing_since, m.qualification, m.philosophy,
            sm.from_date since, sm.role, sm.source
     FROM scheme_manager sm JOIN fund_manager m ON m.manager_id = sm.fk_manager_id
     WHERE sm.fk_scheme_id = ? AND sm.to_date IS NULL
     ORDER BY sm.from_date DESC LIMIT 1`,
  ).get(schemeId) as (Omit<Manager, 'first' | 'months'>) | undefined;
  if (!r) return null;
  return { ...r, first: r.name.split(' ')[0], months: monthsBetween(r.since, TODAY) };
}

export interface Handover {
  from_name: string;
  to_name: string;
  on: string;
  months_ago: number;
  reason: string | null;
}

/**
 * Every time this fund changed hands. A manager change is an event, not a
 * footnote: a three-year record run by two different people is two records.
 */
export function handovers(schemeId: number): Handover[] {
  const spells = db().prepare(
    `SELECT m.full_name name, sm.from_date, sm.to_date
     FROM scheme_manager sm JOIN fund_manager m ON m.manager_id = sm.fk_manager_id
     WHERE sm.fk_scheme_id = ? ORDER BY sm.from_date`,
  ).all(schemeId) as { name: string; from_date: string; to_date: string | null }[];

  const said = db().prepare(
    `SELECT occurred_at, payload FROM events
     WHERE subject_type = 'scheme' AND subject_id = ? AND event_type = 'fund_manager_changed'`,
  ).all(String(schemeId)) as { occurred_at: string; payload: string | null }[];

  const out: Handover[] = [];
  for (let i = 1; i < spells.length; i++) {
    const on = spells[i].from_date;
    let reason: string | null = null;
    const ev = said.find(e => e.occurred_at === on);
    if (ev?.payload) {
      try { reason = (JSON.parse(ev.payload) as { reason?: string }).reason ?? null; } catch { reason = null; }
    }
    out.push({
      from_name: spells[i - 1].name, to_name: spells[i].name, on,
      months_ago: monthsBetween(on, TODAY), reason,
    });
  }
  return out.sort((a, b) => (a.on < b.on ? 1 : -1));
}

export interface Commentary {
  headline: string; body: string; as_of: string; manager: string; source: Provenance;
}

export function commentary(schemeId: number): Commentary | null {
  return db().prepare(
    `SELECT c.headline, c.body, c.as_of, m.full_name manager, c.source
     FROM manager_commentary c JOIN fund_manager m ON m.manager_id = c.fk_manager_id
     WHERE c.fk_scheme_id = ? ORDER BY c.as_of DESC LIMIT 1`,
  ).get(schemeId) as Commentary | null;
}

/* ── how it behaved, and how much of that we measured ourselves ─────────────── */

export interface RiskStats {
  period_months: number;
  months_up: number; months_down: number;
  /** Measured here, from the fund's own NAV series. */
  std_dev: number; max_drawdown: number; sharpe: number | null;
  /** Supplied in the live build. Seeded here — see `mockdb/seed-funds.ts`. */
  upside_capture: number; downside_capture: number;
  /** How closely this fund actually tracks its index in the data we hold. */
  correlation: number | null;
  /** True where the stored correlation is too weak to derive a capture ratio from. */
  capture_is_seeded: boolean;
}

export function riskStats(schemeId: number): RiskStats | null {
  const r = db().prepare(
    `SELECT period_months, months_up, months_down, std_dev, max_drawdown, sharpe,
            upside_capture, downside_capture, correlation, source
     FROM scheme_risk_stats WHERE fk_scheme_id = ? ORDER BY as_of DESC LIMIT 1`,
  ).get(schemeId) as (Omit<RiskStats, 'capture_is_seeded'> & { source: string }) | undefined;
  if (!r) return null;
  return { ...r, capture_is_seeded: r.source.includes('seeded') };
}

export interface StylePoint {
  as_of: string; size_score: number; value_score: number; box: string;
  avg_mcap_cr: number | null; source: Provenance;
}

/** The style box today, and the three quarters behind it. Oldest first. */
export function styleHistory(schemeId: number): StylePoint[] {
  return db().prepare(
    `SELECT as_of, size_score, value_score, box, avg_mcap_cr, source
     FROM scheme_style WHERE fk_scheme_id = ? ORDER BY as_of`,
  ).all(schemeId) as StylePoint[];
}

export interface Drift {
  from: StylePoint; to: StylePoint;
  /** Positive = drifted towards growth; negative = towards value. */
  value_move: number;
  /** Positive = drifted larger; negative = smaller. */
  size_move: number;
  /** True when the box itself changed, which is the version a client can read. */
  changed_box: boolean;
  /** The sentence to print. Null when nothing moved enough to be worth a sentence. */
  says: string | null;
}

/** Where the fund has moved inside its own category. Null when there is no history. */
export function drift(schemeId: number): Drift | null {
  const pts = styleHistory(schemeId);
  if (pts.length < 2) return null;
  const [from, to] = [pts[0], pts[pts.length - 1]];
  const value_move = Math.round((to.value_score - from.value_score) * 100) / 100;
  const size_move = Math.round((to.size_score - from.size_score) * 100) / 100;
  const changed_box = from.box !== to.box;

  // A tenth of a point on a three-point axis is noise. Only a move a client
  // would notice in the holdings gets a sentence.
  const MATTERS = 0.2;
  let says: string | null = null;
  if (changed_box) {
    says = `It has moved from ${from.box.toLowerCase()} to ${to.box.toLowerCase()} over the last nine months. You bought one kind of fund; you own a slightly different one.`;
  } else if (Math.abs(value_move) >= MATTERS) {
    says = `Still ${to.box.toLowerCase()}, but drifting ${value_move > 0 ? 'towards growth' : 'towards value'} inside the box.`;
  } else if (Math.abs(size_move) >= MATTERS) {
    says = `Still ${to.box.toLowerCase()}, but the average company in it has got ${size_move > 0 ? 'bigger' : 'smaller'}.`;
  }
  return { from, to, value_move, size_move, changed_box, says };
}

/* ── the neighbours ─────────────────────────────────────────────────────────── */

export interface Peer {
  scheme_id: number; name: string; short: string;
  /** Compounded from this database's own NAV history, over the same window. */
  ret_3y: number | null;
  expense: number | null;
  downside_capture: number | null;
  is_pick: number;
  is_this: boolean;
}

/**
 * The fund's own category, ranked on what this database can actually measure.
 * Computed, all of it — no vendor number decides who is above whom.
 */
export function peers(schemeId: number, limit = 6): { rows: Peer[]; category: string | null; rank: number | null } {
  const cat = db().prepare(
    `SELECT c.category_id, c.category_name FROM scheme_master s
     JOIN category_master c ON c.category_id = s.fk_category_id WHERE s.scheme_id = ?`,
  ).get(schemeId) as { category_id: number; category_name: string } | undefined;
  if (!cat) return { rows: [], category: null, rank: null };

  // The oldest NAV inside the same 36-month window every other statistic uses,
  // so a peer table and a risk table can never describe different periods.
  const rows = db().prepare(
    `WITH win AS (
       SELECT p.fk_scheme_id sid,
              MIN(CASE WHEN p.price_date >= date(?, '-36 months') THEN p.price_date END) first_d,
              MAX(p.price_date) last_d
       FROM mf_historical_price_master p GROUP BY p.fk_scheme_id)
     SELECT s.scheme_id, s.scheme_full_name name, s.scheme_short_name short,
            s.scheme_expense_ratio expense, s.is_jhaveri_pick is_pick,
            (SELECT downside_capture FROM scheme_risk_stats r WHERE r.fk_scheme_id = s.scheme_id) downside_capture,
            ROUND((POWER(
              (SELECT price FROM mf_historical_price_master q WHERE q.fk_scheme_id = s.scheme_id AND q.price_date = w.last_d)
              / (SELECT price FROM mf_historical_price_master q WHERE q.fk_scheme_id = s.scheme_id AND q.price_date = w.first_d),
              1.0 / 3.0) - 1) * 100, 1) ret_3y
     FROM scheme_master s JOIN win w ON w.sid = s.scheme_id
     WHERE s.fk_category_id = ? AND w.first_d IS NOT NULL`,
  ).all(TODAY, cat.category_id) as Omit<Peer, 'is_this'>[];

  rows.sort((a, b) => (b.ret_3y ?? -999) - (a.ret_3y ?? -999));
  const rank = rows.findIndex(r => r.scheme_id === schemeId);
  const marked = rows.map(r => ({ ...r, is_this: r.scheme_id === schemeId }));

  // Always keep the fund itself on screen, even when it is not in the top few —
  // a peer table a fund can fall off is a peer table that flatters.
  const head = marked.slice(0, limit);
  if (rank >= limit) head[head.length - 1] = marked[rank];
  return { rows: head, category: cat.category_name, rank: rank < 0 ? null : rank + 1 };
}

/* ── overlap, from holdings rather than from category labels ────────────────── */

export interface Overlap {
  scheme_id: number; name: string; shared: number; shared_pct: number;
}

/**
 * Which of the client's OTHER funds hold the same companies as this one, by
 * weight. Same arithmetic as `fundOverlap` in lib/portfolio — the minimum of the
 * two weights, summed — asked from one fund's side rather than across the book.
 */
export function overlapWith(clientId: number, schemeId: number): Overlap[] {
  // The client's DISTINCT schemes, not their holding rows. The serving table
  // carries one row per folio, so a fund held on two folios joined twice and
  // reported double the shared weight — 162.5% of a portfolio that is 81.2%.
  return db().prepare(
    `WITH mine AS (SELECT DISTINCT scheme_id FROM fifo_summary_holding_active WHERE client_id = ?)
     SELECT m.scheme_id, sb.scheme_full_name name,
            COUNT(*) shared, ROUND(SUM(MIN(ha.weight_pct, hb.weight_pct)), 1) shared_pct
     FROM mine m
     JOIN mf_scheme_holdings ha ON ha.fk_scheme_id = ?
     JOIN mf_scheme_holdings hb ON hb.fk_scheme_id = m.scheme_id AND hb.stock_id = ha.stock_id
     JOIN scheme_master sb ON sb.scheme_id = m.scheme_id
     WHERE m.scheme_id != ?
     GROUP BY m.scheme_id HAVING shared > 0
     ORDER BY shared_pct DESC`,
  ).all(clientId, schemeId, schemeId) as Overlap[];
}

/* ── the recommendation, in five parts or not at all ─────────────────────────
   Plan, phase 4: "Every recommendation states five things: the finding · the
   number · the alternative · the cost of doing nothing · the confidence."
   The type makes all five required, so a four-part recommendation cannot be
   constructed, let alone rendered. */

export interface Finding {
  key: string;
  /** What we noticed. */
  finding: string;
  /** The one figure it rests on, already formatted. */
  number: string;
  /** What could be done instead. Never a single named "buy" — a kind, or a fund we back. */
  alternative: string;
  /** What it costs to do nothing. */
  cost: string;
  /** How sure we are, and why that much. */
  confidence: 'high' | 'medium' | 'low';
  why_confidence: string;
}

/**
 * What this fund's own data says, for the client who holds it. Every branch
 * either returns all five parts or returns nothing — there is no partial finding.
 */
export function findings(clientId: number, schemeId: number): Finding[] {
  const out: Finding[] = [];
  const rs = riskStats(schemeId);
  const d = drift(schemeId);
  const p = peers(schemeId);
  const mgr = manager(schemeId);
  const hand = handovers(schemeId);
  const held = db().prepare(
    `SELECT ROUND(present_market_value) value, xirr FROM fifo_summary_holding_active
     WHERE client_id = ? AND scheme_id = ?`,
  ).get(clientId, schemeId) as { value: number; xirr: number | null } | undefined;
  if (!held) return out;

  // A manager change inside the window the record covers.
  const recent = hand.find(h => h.months_ago <= 24);
  if (recent && mgr) {
    out.push({
      key: 'manager_change',
      finding: `The person running this fund changed ${recent.months_ago} months ago. ${recent.to_name} took it from ${recent.from_name}${recent.reason ? `, who ${recent.reason}` : ''}.`,
      number: `${Math.max(0, 36 - recent.months_ago)} of the last 36 months of this fund's record were somebody else's work`,
      alternative: 'Nothing, yet. A new manager is a reason to watch a fund, not a reason to sell one.',
      cost: 'Judging the next three years on a record the current manager did not produce.',
      confidence: 'high',
      why_confidence: 'The handover date is a dated record, not an inference.',
    });
  }

  // Style drift: you bought one thing and own another.
  if (d?.says && d.changed_box) {
    out.push({
      key: 'style_drift',
      finding: `This fund has moved inside its own category. ${d.says}`,
      number: `${d.from.box} nine months ago, ${d.to.box} today`,
      alternative: `If you wanted ${d.from.box.toLowerCase()} exposure, it now has to come from somewhere else in your portfolio.`,
      cost: `Your ${d.from.box.toLowerCase()} exposure has quietly shrunk without you selling anything.`,
      confidence: d.to.source === 'computed' ? 'medium' : 'low',
      why_confidence: d.to.source === 'computed'
        ? "Today's box is computed from what the fund actually holds; the earlier ones stand in for a vendor history we do not have yet."
        : 'Both ends of this comparison are seeded pending the Morningstar feed.',
    });
  }

  // Downside capture: the half of a record nobody is shown.
  if (rs && rs.downside_capture > 105) {
    out.push({
      key: 'downside',
      finding: 'This fund falls further than its index when the market falls.',
      number: `${rs.downside_capture}% of the index's falls, against ${rs.upside_capture}% of its rises, over ${rs.period_months} months`,
      alternative: 'A lower-beta fund in the same category, or the same fund at a smaller weight. Both are decisions for your manager, not for this page.',
      cost: `On ${rs.months_down} down months in three years, that difference is what a bad year feels like in your own account.`,
      confidence: rs.capture_is_seeded ? 'low' : 'high',
      why_confidence: rs.capture_is_seeded
        ? `${SEEDED_NOTE} The measured correlation between this fund and its index here is ${rs.correlation}, which is too weak to derive a capture ratio from.`
        : 'Computed from 36 months of monthly returns against the fund’s own benchmark.',
    });
  }

  // Where it sits among the funds doing the same job.
  if (p.rank != null && p.rows.length > 2 && p.rank > Math.ceil(p.rows.length / 2)) {
    const best = p.rows[0];
    out.push({
      key: 'peer_rank',
      finding: `Among the ${p.category} funds we track, this one is not in the top half over three years.`,
      number: `${p.rank}${p.rank === 1 ? 'st' : p.rank === 2 ? 'nd' : p.rank === 3 ? 'rd' : 'th'} of ${p.rows.length}, at ${p.rows.find(x => x.is_this)?.ret_3y ?? '—'}% a year against ${best.ret_3y}% for the best of them`,
      alternative: `A same-category fund on the house list${best.is_pick ? `, of which ${best.short ?? best.name} is one` : ''}. Switching sells units, so the tax comes first.`,
      cost: held.value > 0
        ? `On ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(held.value)}, one percentage point a year is roughly ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(held.value * 0.01)} a year.`
        : 'Nothing, while you hold none of it.',
      confidence: 'medium',
      why_confidence: 'Three-year returns are computed here from NAV history, but three years is a short window to judge a manager on.',
    });
  }

  return out;
}

/**
 * The single gate on anything Morningstar-branded reaching a client.
 *
 * Ratings are seeded and stored. They are NOT rendered: redistributing a
 * vendor's rating to an investor is a licensing question the founder has not
 * answered, and DESIGN.md refuses star ratings on this lens regardless. When
 * both change, this function changes and nothing else does.
 */
export function ratingVisible(): boolean {
  return false;
}
