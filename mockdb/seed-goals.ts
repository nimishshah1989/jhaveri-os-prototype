import type Database from 'better-sqlite3';
import { rng, pick, between, intBetween, chance, TODAY, addDays, type Rand } from './engines';

/* ── Goals across the book ────────────────────────────────────────────────────
   Meera's five goals were hand-placed so the three honest projection outcomes
   could each be demonstrated. They are still hand-placed, and this file does not
   touch them: verify-goals and verify-household pin every figure on her pages,
   and re-rolling her would break both.

   What this adds is the rest of the book, because a broker-level view of goals
   over one client is not a view. Adoption is deliberately partial — a real
   distributor has named goals for a minority of clients, and the clients who have
   never named one are the most useful thing on the aggregate screen, not a gap in
   the demo. Roughly a third here.

   Nothing about the OUTCOME is typed. Targets are sized as a multiple of what the
   client already holds and dates are drawn inside a plausible horizon; whether a
   goal then lands early, late or already reached is whatever lib/goals.ts computes
   at the published rate. verify-goals-book asserts the spread is varied — it does
   not assert which client is late, because the moment a seed decides that, the
   projection is decoration.

   Own RNG stream, appended last, like the fund-intelligence and household blocks
   above it, so not one draw the story facts are pinned to can shift. */

type Ins = (table: string, row: Record<string, unknown>) => void;
type Emit = (e: { at: string; subjectType: string; subjectId: string | number; type: string; payload?: unknown; source?: string }) => void;

/** Goal ids from here up. Meera holds 1–3 and the family holds 100–101. */
const FIRST_ID = 1000;

/** Share of money-holding clients who have ever named a goal. */
export const ADOPTION = 0.34;

/**
 * What each kind of goal costs, as a multiple of what the client holds today, and
 * how far out it sits. Both are ranges, and both are the sort of thing a real
 * adviser would sanity-check rather than compute: a retirement number is a large
 * multiple of today's pot, a car is a fraction of it.
 */
const KINDS: {
  kind: string;
  names: string[];
  multiple: [number, number];
  years: [number, number];
  weight: number;
}[] = [
  { kind: 'retirement', weight: 30, multiple: [3.5, 9], years: [11, 24], names: ['Stop working at 58', 'Retire at 60', 'The last working day', 'Enough to stop'] },
  { kind: 'education', weight: 24, multiple: [1.2, 3.2], years: [5, 15], names: ['College fees', 'Postgraduate abroad', 'School through to eighteen', 'University, whichever one'] },
  { kind: 'home', weight: 20, multiple: [0.8, 2.4], years: [3, 9], names: ['The down payment', 'A bigger flat', 'The house in the hills', 'Somewhere of our own'] },
  { kind: 'freedom', weight: 14, multiple: [0.4, 1.1], years: [2, 6], names: ['Six months of runway', 'The emergency fund', 'A year off, eventually'] },
  { kind: 'car', weight: 12, multiple: [0.25, 0.7], years: [2, 5], names: ['The next car', 'Replace the old car'] },
];

const weighted = (r: Rand): typeof KINDS[number] => {
  const total = KINDS.reduce((s, k) => s + k.weight, 0);
  let n = r() * total;
  for (const k of KINDS) { n -= k.weight; if (n <= 0) return k; }
  return KINDS[KINDS.length - 1];
};

/** Nobody names a goal of ₹41,73,912. Round the way a person would. */
const humanise = (n: number): number => {
  if (n >= 1e7) return Math.round(n / 5e5) * 5e5;
  if (n >= 1e6) return Math.round(n / 1e5) * 1e5;
  return Math.max(50000, Math.round(n / 25000) * 25000);
};

const yearsOut = (iso: string, years: number, r: Rand): string => {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  // Land on the first of a month — a target date is a month, not a day.
  d.setDate(1);
  d.setMonth(intBetween(r, 0, 11));
  return d.toISOString().slice(0, 10);
};

export interface GoalSeedResult {
  clients: number;
  goals: number;
  funded: number;
  unfunded: number;
  skipped: number;
}

export function seedGoals(db: Database.Database, ins: Ins, emit: Emit): GoalSeedResult {
  const r = rng(20260814);

  // Only clients who actually hold something can have money working towards a
  // goal. Ordered by id so the draw is stable, and Meera and the household she
  // was given are excluded — they are already authored.
  const authored = (db.prepare(
    `SELECT DISTINCT fk_cm_user_id id FROM client_goals`,
  ).all() as { id: number }[]).map(x => x.id);
  const householdOf101 = (db.prepare(
    `SELECT cm_user_id id FROM client_master WHERE fk_family_id =
       (SELECT fk_family_id FROM client_master WHERE cm_user_id = 101)`,
  ).all() as { id: number }[]).map(x => x.id);
  const off = new Set([...authored, ...householdOf101]);

  const holders = (db.prepare(
    `SELECT client_id id, SUM(present_market_value) v, MIN(inv_since_date) since
       FROM fifo_summary_holding_active
      WHERE balance_units > 0.0001
      GROUP BY client_id
      ORDER BY client_id`,
  ).all() as { id: number; v: number; since: string }[]).filter(c => !off.has(c.id));

  // Who names a goal is not uniform: a bigger, older relationship has had more
  // conversations, so it is likelier to have one written down. The weighting is a
  // documented bias, not a random third.
  const maxV = Math.max(1, ...holders.map(c => c.v));
  const chosen = holders.filter(c => {
    const size = Math.min(1, c.v / maxV);
    const age = Math.min(1, Math.max(0, (Date.parse(TODAY) - Date.parse(c.since)) / (86400000 * 365 * 4)));
    return chance(r, ADOPTION * (0.55 + 0.75 * size + 0.5 * age));
  });

  let gid = FIRST_ID;
  let goals = 0, funded = 0, unfunded = 0, skipped = 0;

  for (const c of chosen) {
    // Which of their schemes can carry a goal. A scheme belongs to at most one
    // goal, because transaction_master.fk_goal_id is one column — the same
    // constraint Meera's block works within.
    const schemes = (db.prepare(
      `SELECT DISTINCT fk_scheme_id sid FROM transaction_master
        WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id IS NULL ORDER BY sid`,
    ).all(c.id) as { sid: number }[]).map(x => x.sid);
    if (schemes.length === 0) { skipped++; continue; }

    const howMany = Math.min(schemes.length + 1, intBetween(r, 1, schemes.length >= 3 ? 3 : 2));
    const used = new Set<string>();
    let next = 0;

    for (let i = 0; i < howMany; i++) {
      const k = weighted(r);
      if (used.has(k.kind)) continue;         // one retirement per person
      used.add(k.kind);

      const target = humanise(c.v * between(r, k.multiple[0], k.multiple[1]));
      const on = yearsOut(TODAY, intBetween(r, k.years[0], k.years[1]), r);
      const created = addDays(TODAY, -intBetween(r, 30, 900));

      ins('client_goals', {
        goal_id: gid, fk_cm_user_id: c.id, goal_name: pick(r, k.names), goal_kind: k.kind,
        target_amount: target, target_date: on, created_at: created, is_active: 1, is_family: 0,
      });
      emit({
        at: created, subjectType: 'client', subjectId: c.id, type: 'goal_named',
        payload: { goal_id: gid, kind: k.kind, target, on }, source: 'seed',
      });

      // A named goal with nothing behind it is a real and common state, and it is
      // the one a broker most wants to see — so roughly one in six stays unfunded
      // rather than every goal being tidily tagged.
      if (next < schemes.length && !chance(r, 0.17)) {
        db.prepare(`UPDATE transaction_master SET fk_goal_id = ? WHERE fk_acc_id = ? AND fk_scheme_id = ?`)
          .run(gid, c.id, schemes[next]);
        next++;
        funded++;
      } else {
        unfunded++;
      }
      gid++;
      goals++;
    }
  }

  return { clients: chosen.length, goals, funded, unfunded, skipped };
}
