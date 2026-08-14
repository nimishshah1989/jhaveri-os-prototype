import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* ── Goals ───────────────────────────────────────────────────────────────────
   The denominator that is not rupees. ₹15.74L means nothing to a person;
   "fourteen months ahead of Ananya's first year" means everything. Every figure
   in this file is derived, and where it cannot be derived honestly it is null
   and the page prints a dash — a projected date computed off a rate we do not
   have is a promise, and we do not make promises.

   A goal owns the schemes whose transactions carry its id, so progress is read
   off `fifo_summary_holding_active` — the same table every other page prices
   from. One denominator, extended rather than replaced.                       */

/** Every assumption this file applies, in one place. Nothing is hidden in a formula. */
export const GOAL_RULES = {
  /**
   * Projection rates, by what the money is actually in. Published, deliberately
   * sober, and the same for every client.
   *
   * We do NOT project a client's own return forward, and that is a deliberate
   * refusal rather than a missing feature. One of Meera's goals has earned 48.7%
   * and another −9.2%; compounding either for twenty years produces a number that
   * is arithmetically perfect and completely false. Her own rate is history, and
   * it is shown as history. What happens next is an assumption, priced the same
   * way for everyone, and named on screen.
   */
  rates: { Equity: 11, Hybrid: 9, Debt: 6.5, Gold: 7, Other: 8 } as Record<string, number>,
  fallback_rate: 9,
  /** A projection past this is arithmetic, not foresight. Beyond it we say so. */
  horizon_years: 25,
  /** Under this, a goal is "reached" — pennies are not a shortfall. */
  reached_within: 0.995,
  version: 'goals-v1 (12-Aug-2026)',
} as const;

export interface Goal {
  goal_id: number;
  name: string;
  kind: string;
  target: number;
  on: string;
  /** What the schemes tagged to this goal are worth this morning. */
  now: number;
  /** What was put into them. */
  put: number;
  /** The rate this goal is projected at — always the published assumption, never their own. */
  rate: number;
  /** What this money has actually done so far. History, shown as history, never projected. */
  ownRate: number | null;
  /** The asset mix the projection rate was blended from, biggest first. */
  mix: { asset: string; pct: number }[];
  /** What is going in every month, from live instalments on those schemes. */
  monthly: number;
  /** How many schemes stand behind it. */
  schemes: number;
}

export interface Outlook extends Goal {
  /** Projected value on the target date. */
  projected: number;
  /** Positive = surplus, negative = shortfall, both in rupees. */
  gap: number;
  /** The month the target is actually reached, or null if not inside the horizon. */
  reachedOn: string | null;
  /** Negative = early, positive = late, in months. Null when `reachedOn` is null. */
  monthsOff: number | null;
  /** Already there. */
  met: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const monthsBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 2.6298e9);

function addMonths(from: string, n: number): string {
  const d = new Date(from);
  d.setMonth(d.getMonth() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Walks the money forward one month at a time rather than solving a closed form:
 * the instalment lands monthly and compounds from the month it lands, and an
 * annuity formula written from memory is exactly the kind of thing that is
 * wrong by a year and looks right.
 */
function walk(from: number, monthly: number, annualPct: number, months: number): number {
  const r = annualPct / 100 / 12;
  let v = from;
  for (let i = 0; i < months; i++) v = v * (1 + r) + monthly;
  return v;
}

/**
 * The goals a client has named, with their own money attached.
 *
 * Goals the household owns are deliberately not here. They are funded from more
 * than one member's accounts, so counting them on one person's page would put
 * somebody else's money inside that person's denominator — see `lib/household.ts`.
 */
export function goals(clientId: number): Goal[] {
  const rows = db().prepare(
    `SELECT goal_id, goal_name name, goal_kind kind, target_amount target, target_date "on"
     FROM client_goals WHERE fk_cm_user_id = ? AND is_active = 1 AND is_family = 0
     ORDER BY target_date`,
  ).all(clientId) as Omit<Goal, 'now' | 'put' | 'rate' | 'assumed' | 'monthly' | 'schemes'>[];

  // Per asset class, so the projection rate can be blended from what the money is
  // actually in rather than applied as one number to everything.
  const money = db().prepare(
    `WITH tagged AS (
       SELECT DISTINCT fk_goal_id g, fk_scheme_id sid
       FROM transaction_master
       WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id IS NOT NULL
     )
     SELECT t.g, COALESCE(f.asset_name, 'Other') asset, COUNT(*) schemes,
            SUM(f.present_market_value) now,
            SUM(f.cost_amount) put,
            SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value ELSE 0 END) rated,
            SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value * f.xirr ELSE 0 END) weighted
     FROM tagged t
     JOIN fifo_summary_holding_active f ON f.client_id = ? AND f.scheme_id = t.sid
     GROUP BY t.g, asset`,
  ).all(clientId, clientId) as {
    g: number; asset: string; schemes: number; now: number; put: number; rated: number; weighted: number;
  }[];

  const sips = db().prepare(
    `WITH tagged AS (
       SELECT DISTINCT fk_goal_id g, fk_scheme_id sid
       FROM transaction_master WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id IS NOT NULL
     )
     SELECT t.g, COALESCE(SUM(s.tr_amount), 0) monthly
     FROM tagged t
     JOIN sip_master s ON s.fk_acc_id = ? AND s.fk_to_scheme_id = t.sid AND s.is_live_sip = 1
     GROUP BY t.g`,
  ).all(clientId, clientId) as { g: number; monthly: number }[];

  const bySip = new Map(sips.map(s => [s.g, s.monthly]));

  return rows.map(g => {
    const parts = money.filter(m => m.g === g.goal_id);
    const now = parts.reduce((s, p) => s + p.now, 0);
    const rated = parts.reduce((s, p) => s + p.rated, 0);

    const mix = parts
      .map(p => ({ asset: p.asset, pct: now > 0 ? Math.round((p.now / now) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);

    // The projection rate is the published one for each asset class, weighted by
    // what is actually held. Never this client's own return — see GOAL_RULES.
    const rate = now > 0
      ? Math.round(parts.reduce((s, p) =>
          s + (GOAL_RULES.rates[p.asset] ?? GOAL_RULES.fallback_rate) * (p.now / now), 0) * 10) / 10
      : GOAL_RULES.fallback_rate;

    // A holding with no XIRR is excluded from this blend, never counted as zero —
    // the house rule that keeps a young fund from dragging a real record down.
    const ownRate = rated > 0
      ? Math.round((parts.reduce((s, p) => s + p.weighted, 0) / rated) * 10) / 10
      : null;

    return {
      ...g,
      now: Math.round(now),
      put: Math.round(parts.reduce((s, p) => s + p.put, 0)),
      schemes: parts.reduce((s, p) => s + p.schemes, 0),
      rate, ownRate, mix,
      monthly: Math.round(bySip.get(g.goal_id) ?? 0),
    };
  });
}

/** Where a goal lands, and when. */
export function outlook(g: Goal): Outlook {
  const months = Math.max(0, monthsBetween(TODAY, g.on));
  const rate = g.rate;
  const met = g.now >= g.target * GOAL_RULES.reached_within;

  const projected = Math.round(walk(g.now, g.monthly, rate, months));
  const gap = projected - g.target;

  let reachedOn: string | null = met ? TODAY : null;
  if (!met) {
    const limit = GOAL_RULES.horizon_years * 12;
    let v = g.now;
    for (let i = 1; i <= limit; i++) {
      v = walk(v, g.monthly, rate, 1);
      if (v >= g.target) { reachedOn = addMonths(TODAY, i); break; }
    }
  }
  return {
    ...g, projected, gap, reachedOn, met,
    monthsOff: reachedOn ? monthsBetween(g.on, reachedOn) : null,
  };
}

export function outlooks(clientId: number): Outlook[] {
  return goals(clientId).map(outlook);
}

/**
 * The sentence a page prints under a goal. Written here rather than in each
 * component so the same situation never gets two different phrasings.
 */
export function verdict(o: Outlook): string {
  if (o.met) return 'Already there. Nothing more has to go in for this one.';
  if (o.monthsOff == null) {
    return `At this pace it does not get there inside ${GOAL_RULES.horizon_years} years, and projecting further would be arithmetic rather than foresight.`;
  }
  const n = Math.abs(o.monthsOff);
  const when = n === 0 ? 'almost exactly on time'
    : `${n} month${n === 1 ? '' : 's'} ${o.monthsOff < 0 ? 'early' : 'late'}`;
  const how = o.monthly > 0
    ? `on what is already going in every month`
    : `on what is already invested, with nothing further going in`;
  return `${when}, ${how}.`;
}

/**
 * The rate this goal would have to earn, from today, to land its target on its
 * date on the instalments already going in. Solved by bisection rather than
 * algebra because `walk` is the same month-by-month function the projection uses —
 * inverting it in closed form would be a second model, and the two would disagree
 * the first time someone changed the compounding.
 *
 * Null when no rate inside a sane band gets there: a goal needing 60% a year is
 * not a rate problem, and printing "needs 60%" invites someone to go looking for
 * a fund that does it.
 */
export function requiredRate(g: Goal): number | null {
  const months = Math.max(1, monthsBetween(TODAY, g.on));
  if (g.now >= g.target) return 0;
  let lo = 0, hi = 40;
  if (walk(g.now, g.monthly, hi, months) < g.target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (walk(g.now, g.monthly, mid, months) < g.target) lo = mid; else hi = mid;
  }
  return Math.round(hi * 10) / 10;
}

/**
 * The gap the client is actually being asked to close, in the only two terms that
 * mean anything: the rate this money is assumed to earn, and the rate the target
 * demands. `shortfall_pts` positive means the goal needs more than the published
 * assumption — which is a conversation about the target, the date or the
 * instalment, and never about finding a hotter fund.
 */
export function rateGap(g: Goal): { assumed: number; required: number | null; shortfall_pts: number | null } {
  const required = requiredRate(g);
  return {
    assumed: g.rate,
    required,
    shortfall_pts: required === null ? null : Math.round((required - g.rate) * 10) / 10,
  };
}

export interface PathPoint {
  /** Month key, YYYY-MM-01. */
  m: string;
  /** Where the money gets to on what is already going in. */
  projected: number;
  /** The same path with one more instalment on top — the lever, drawn. */
  boosted: number;
  /** Flat, so the target reads as a line to cross rather than a number to recall. */
  target: number;
}

/**
 * The path to the target, month by month, so "14 months late" stops being a fact
 * to take on trust and becomes a line that misses a line. Walked exactly the way
 * `outlook` walks it — same function, same rate — because a chart that disagreed
 * with the sentence beside it would be worse than no chart.
 *
 * Runs to the target date, or to wherever the money actually arrives if that is
 * later, so a goal that lands late still shows the crossing rather than stopping
 * at the target date with the gap unexplained.
 */
export function goalPath(g: Goal, extraMonthly = 0): PathPoint[] {
  const o = outlook(g);
  const toTarget = Math.max(1, monthsBetween(TODAY, g.on));
  const toArrival = o.reachedOn ? monthsBetween(TODAY, o.reachedOn) : 0;
  const months = Math.min(GOAL_RULES.horizon_years * 12, Math.max(toTarget, toArrival) + 2);

  const out: PathPoint[] = [];
  let plain = g.now;
  let boost = g.now;
  for (let i = 0; i <= months; i++) {
    out.push({
      m: addMonths(TODAY, i).slice(0, 7) + '-01',
      projected: Math.round(plain),
      boosted: Math.round(boost),
      target: g.target,
    });
    plain = walk(plain, g.monthly, g.rate, 1);
    boost = walk(boost, g.monthly + extraMonthly, g.rate, 1);
  }
  return out;
}

export interface Step {
  extra: number;
  /** The arrival month, already formatted — the slider takes data, not a formatter. */
  label: string;
  /** Where the money lands on the target date at this instalment. */
  projected: number;
  reachedOn: string | null;
  /** Negative = early, positive = late. Null when it never gets there. */
  monthsOff: number | null;
  met: boolean;
}

/**
 * Every instalment the client could choose, priced in advance.
 *
 * Computed on the server through the same `outlook` the page prints, then handed
 * to the slider as a finished list — so dragging cannot produce a number the rest
 * of the page disagrees with. The alternative, re-implementing the walk in the
 * browser, is two models of the same money and they diverge the first time either
 * one is touched.
 */
export function simulate(g: Goal, max = 20000, step = 500): Step[] {
  const out: Step[] = [];
  for (let extra = 0; extra <= max; extra += step) {
    const o = outlook({ ...g, monthly: g.monthly + extra });
    const at = o.reachedOn;
    out.push({
      extra,
      label: at ? `${MONTHS[Number(at.slice(5, 7)) - 1]}-${at.slice(0, 4)}` : '—',
      projected: o.projected, reachedOn: at, monthsOff: o.monthsOff, met: o.met,
    });
  }
  return out;
}

/**
 * What one more rupee a month is worth, in time. This is the number that makes a
 * goal actionable: not "you are short ₹4L" but "₹2,000 a month buys back a year".
 */
export function monthsBoughtBy(g: Goal, extraMonthly: number): number | null {
  const base = outlook(g);
  if (base.reachedOn == null) return null;
  const faster = outlook({ ...g, monthly: g.monthly + extraMonthly });
  if (faster.reachedOn == null) return null;
  return monthsBetween(faster.reachedOn, base.reachedOn);
}

/** How a client's whole book divides across what they said it was for. */
export function untagged(clientId: number): { value: number; schemes: number } {
  const r = db().prepare(
    `SELECT COUNT(*) schemes, COALESCE(SUM(f.present_market_value), 0) value
     FROM fifo_summary_holding_active f
     WHERE f.client_id = ?
       AND f.scheme_id NOT IN (
         SELECT DISTINCT fk_scheme_id FROM transaction_master
         WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id IS NOT NULL)`,
  ).get(clientId, clientId) as { schemes: number; value: number };
  return { value: Math.round(r.value), schemes: r.schemes };
}
