import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { GOAL_RULES, outlook, type Goal, type Outlook } from './goals';

/* ── The household ───────────────────────────────────────────────────────────
   A family is not a joint account. Every member brings their own PAN, their own
   KYC and their own tax position, and the only thing that makes them a household
   is that somebody is allowed to look at more than their own column.

   So consent is the spine of this file, not a decoration on it. There are four
   ways money may be shown to someone who is not its owner, and exactly four:

     self      — it is yours
     guardian  — a minor's folio, operated by the guardian named on it. Law, not
                 preference, which is why a minor has no consent rows at all
     granted   — they were asked, and they said yes
     (nothing) — everything else. An absent row is a refusal, never a default yes

   `asked` and `refused` are shown as themselves rather than folded into "no",
   because "she hasn't answered yet" and "she would rather not" are different
   sentences to read about your own mother, and only one of them is worth asking
   again. The money still comes from `fifo_summary_holding_active` — the same
   denominator every other page prices from, filtered by who may see it.       */

export type Access = 'self' | 'guardian' | 'granted' | 'asked' | 'refused' | 'withdrawn' | 'none';

/** Ages in whole years, the way a person counts them. */
function ageOn(dob: string | null, on: string = TODAY): number | null {
  if (!dob) return null;
  const [by, bm, bd] = dob.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = on.slice(0, 10).split('-').map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}

export const MAJORITY = 18;

export interface Member {
  member_id: number;
  /** Null until they open an account. The household's own waiting list. */
  client_id: number | null;
  name: string;
  relation: string;
  dob: string | null;
  age: number | null;
  minor: boolean;
  guardian_id: number | null;
  /** May the viewer see what this member is worth, and why. */
  total: Access;
  /** May the viewer see what this member owns, and why. */
  detail: Access;
  /** What they are worth. Null when the viewer may not be told — never zero. */
  value: number | null;
  /** Their own return so far. Null when unreadable, or when there is nothing to rate. */
  rate: number | null;
  funds: number | null;
  open_actions: number;
  /** When they last decided anything about sharing. */
  decided_at: string | null;
}

export interface Household {
  family_id: number;
  family_name: string;
  members: Member[];
  /** Everything the viewer is allowed to add up. */
  combined: number;
  /** Members whose money is inside `combined`. */
  counted: number;
  /** Members who hold money the viewer may not add up. Named, never hidden. */
  withheld: Member[];
  /** Members with no account at all — the acquisition surface. */
  prospects: Member[];
}

/** The states a consent row may be in. Anything else on the row reads as no. */
const CONSENT_STATE: Record<string, Access> = {
  granted: 'granted', asked: 'asked', refused: 'refused', withdrawn: 'withdrawn',
};

/**
 * Everyone in the viewer's household, with each figure gated on a real consent
 * row. The viewer is resolved by the caller from `whoami()`; this function never
 * takes an identity from a form.
 */
export function household(viewerId: number): Household | null {
  const fam = db().prepare(
    `SELECT f.family_id, f.family_name FROM client_master c
     JOIN family_master f ON f.family_id = c.fk_family_id WHERE c.cm_user_id = ?`,
  ).get(viewerId) as { family_id: number; family_name: string } | undefined;
  if (!fam) return null;

  const rows = db().prepare(
    `SELECT m.member_id, m.client_id, m.full_name name, m.relation, m.date_of_birth dob,
            m.guardian_client_id guardian_id,
            (SELECT ROUND(SUM(present_market_value)) FROM fifo_summary_holding_active f
              WHERE f.client_id = m.client_id) value,
            (SELECT COUNT(*) FROM fifo_summary_holding_active f WHERE f.client_id = m.client_id) funds,
            (SELECT COUNT(*) FROM actions a WHERE a.subject_type = 'client'
              AND a.subject_id = CAST(m.client_id AS TEXT)
              AND a.state IN ('proposed','assigned','in_progress')) open_actions,
            (SELECT ROUND(SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value * xirr END)
                        / NULLIF(SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value END), 0), 1)
             FROM fifo_summary_holding_active f WHERE f.client_id = m.client_id) rate
     FROM household_members m
     WHERE m.family_id = ?
     ORDER BY m.member_id`,
  ).all(fam.family_id) as (Omit<Member, 'age' | 'minor' | 'total' | 'detail' | 'decided_at'> & {
    value: number | null; funds: number; rate: number | null;
  })[];

  // A family nobody has mapped still has one member in it. Without this the page
  // would render nothing for the 1,067 households that are a single person, and
  // a screen with no objects is a bug (DESIGN.md, rule 2).
  if (!rows.length) {
    const self = db().prepare(
      `SELECT c.cm_user_id client_id, c.cm_full_name name, c.cm_date_of_birth dob,
              (SELECT ROUND(SUM(present_market_value)) FROM fifo_summary_holding_active f
                WHERE f.client_id = c.cm_user_id) value,
              (SELECT COUNT(*) FROM fifo_summary_holding_active f WHERE f.client_id = c.cm_user_id) funds
       FROM client_master c WHERE c.cm_user_id = ?`,
    ).get(viewerId) as { client_id: number; name: string; dob: string | null; value: number | null; funds: number };
    rows.push({
      member_id: 0, client_id: self.client_id, name: self.name, relation: 'self', dob: self.dob,
      guardian_id: null, value: self.value, funds: self.funds, open_actions: 0, rate: null,
    });
  }

  const consents = db().prepare(
    `SELECT subject_id, scope, state, decided_at FROM household_consents
     WHERE family_id = ? AND viewer_id = ?`,
  ).all(fam.family_id, viewerId) as
    { subject_id: number; scope: string; state: string; decided_at: string | null }[];
  const said = new Map(consents.map(c => [`${c.subject_id}:${c.scope}`, c]));

  const members: Member[] = rows.map(r => {
    const age = ageOn(r.dob);
    const minor = age != null && age < MAJORITY;
    const decide = (scope: 'total' | 'holdings'): Access => {
      if (r.client_id == null) return 'none';
      if (r.client_id === viewerId) return 'self';
      // A guardian operates the folio; there is no question to ask, so asking
      // one and rendering a switch would be theatre.
      if (minor && r.guardian_id === viewerId) return 'guardian';
      const row = said.get(`${r.client_id}:${scope}`);
      return row ? (CONSENT_STATE[row.state] ?? 'none') : 'none';
    };
    const total = decide('total');
    const detail = decide('holdings');
    const open = total === 'self' || total === 'guardian' || total === 'granted';
    return {
      ...r,
      age, minor, total, detail,
      // Withheld is not zero. A member who has not shared reads as a dash, and
      // the page says whose choice that was.
      value: open ? (r.value ?? 0) : null,
      rate: open ? r.rate : null,
      funds: open ? r.funds : null,
      decided_at: said.get(`${r.client_id}:total`)?.decided_at ?? null,
    };
  });

  const visible = members.filter(m => m.client_id != null && m.value != null);
  return {
    ...fam,
    members,
    combined: visible.reduce((s, m) => s + (m.value ?? 0), 0),
    counted: visible.length,
    withheld: members.filter(m => m.client_id != null && m.value == null),
    prospects: members.filter(m => m.client_id == null),
  };
}

/** The one sentence a page prints about why a figure is missing. Written once. */
export function whyHidden(m: Member, scope: 'total' | 'holdings'): string | null {
  const state = scope === 'total' ? m.total : m.detail;
  const first = m.name.split(' ')[0];
  if (state === 'self' || state === 'guardian' || state === 'granted') return null;
  if (state === 'asked') return `${first} has been asked and has not answered yet.`;
  if (state === 'refused') return `${first} would rather not share ${scope === 'total' ? 'what this is worth' : 'the funds behind it'}.`;
  if (state === 'withdrawn') return `${first} shared this once and has since withdrawn it.`;
  return `${first} has not been asked, and nothing is shown until ${first} says yes.`;
}

/** How a member's access reads on screen, in three words or fewer. */
export function accessLabel(a: Access): string {
  return a === 'self' ? 'You'
    : a === 'guardian' ? 'You are guardian'
      : a === 'granted' ? 'Shared with you'
        : a === 'asked' ? 'Asked, waiting'
          : a === 'refused' ? 'Kept private'
            : a === 'withdrawn' ? 'Withdrawn'
              : 'Not shared';
}

export interface MemberFund {
  scheme_id: number; fund_name: string; fund_category: string; value: number; xirr: number | null;
}

/**
 * What one member owns — but only if they said so. The refusal is returned as a
 * value rather than thrown, because the page has to print the reason.
 */
export function memberHoldings(viewerId: number, memberId: number):
  { ok: true; member: Member; rows: MemberFund[] } | { ok: false; member: Member | null; why: string } {
  const h = household(viewerId);
  const m = h?.members.find(x => x.member_id === memberId) ?? null;
  if (!h || !m) return { ok: false, member: null, why: 'That member is not in your household.' };
  if (m.client_id == null) {
    return { ok: false, member: m, why: `${m.name.split(' ')[0]} has no account yet, so there is nothing to show.` };
  }
  if (!['self', 'guardian', 'granted'].includes(m.detail)) {
    return { ok: false, member: m, why: whyHidden(m, 'holdings') ?? 'Not shared.' };
  }
  const rows = db().prepare(
    `SELECT scheme_id, fund_name, fund_category, ROUND(present_market_value) value, xirr
     FROM fifo_summary_holding_active WHERE client_id = ? ORDER BY present_market_value DESC`,
  ).all(m.client_id) as MemberFund[];
  return { ok: true, member: m, rows };
}

/* ── Goals the family owns ───────────────────────────────────────────────────
   Same machinery as a personal goal, over more than one account. The rate is
   still the published assumption for what the money is in — never anybody's own
   past return, family or otherwise (GOAL_RULES). */

export interface FamilyGoal extends Outlook {
  /** Which members' money stands behind it, and how much of it is theirs. */
  from: { client_id: number; name: string; value: number }[];
}

export function familyGoals(viewerId: number): FamilyGoal[] {
  const h = household(viewerId);
  if (!h) return [];
  const accounts = h.members.map(m => m.client_id).filter((n): n is number => n != null);
  if (!accounts.length) return [];
  const marks = accounts.map(() => '?').join(',');

  const rows = db().prepare(
    `SELECT goal_id, goal_name name, goal_kind kind, target_amount target, target_date "on"
     FROM client_goals WHERE is_family = 1 AND is_active = 1 AND fk_cm_user_id IN (${marks})
     ORDER BY target_date`,
  ).all(...accounts) as { goal_id: number; name: string; kind: string; target: number; on: string }[];
  if (!rows.length) return [];

  const money = db().prepare(
    `SELECT t.fk_goal_id g, f.client_id, f.client_name name, COALESCE(f.asset_name, 'Other') asset,
            COUNT(*) schemes, SUM(f.present_market_value) now, SUM(f.cost_amount) put,
            SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value ELSE 0 END) rated,
            SUM(CASE WHEN f.xirr IS NOT NULL THEN f.present_market_value * f.xirr ELSE 0 END) weighted
     FROM (SELECT DISTINCT fk_goal_id, fk_acc_id, fk_scheme_id FROM transaction_master
           WHERE is_active = 1 AND fk_goal_id IS NOT NULL AND fk_acc_id IN (${marks})) t
     JOIN fifo_summary_holding_active f
       ON f.client_id = t.fk_acc_id AND f.scheme_id = t.fk_scheme_id
     GROUP BY t.fk_goal_id, f.client_id, asset`,
  ).all(...accounts) as {
    g: number; client_id: number; name: string; asset: string;
    schemes: number; now: number; put: number; rated: number; weighted: number;
  }[];

  const sips = db().prepare(
    `SELECT t.fk_goal_id g, COALESCE(SUM(s.tr_amount), 0) monthly
     FROM (SELECT DISTINCT fk_goal_id, fk_acc_id, fk_scheme_id FROM transaction_master
           WHERE is_active = 1 AND fk_goal_id IS NOT NULL AND fk_acc_id IN (${marks})) t
     JOIN sip_master s ON s.fk_acc_id = t.fk_acc_id AND s.fk_to_scheme_id = t.fk_scheme_id AND s.is_live_sip = 1
     GROUP BY t.fk_goal_id`,
  ).all(...accounts) as { g: number; monthly: number }[];
  const bySip = new Map(sips.map(s => [s.g, s.monthly]));

  return rows.map(g => {
    const parts = money.filter(m => m.g === g.goal_id);
    const now = parts.reduce((s, p) => s + p.now, 0);
    const rated = parts.reduce((s, p) => s + p.rated, 0);
    const byAsset = new Map<string, number>();
    for (const p of parts) byAsset.set(p.asset, (byAsset.get(p.asset) ?? 0) + p.now);
    const mix = [...byAsset].map(([asset, v]) => ({ asset, pct: now > 0 ? Math.round((v / now) * 100) : 0 }))
      .sort((a, b) => b.pct - a.pct);
    // The published rate per asset class, weighted by what is actually held.
    // Imported from lib/goals rather than restated, so a family goal and a
    // personal goal can never be projected on two different assumptions.
    const rate = now > 0
      ? Math.round([...byAsset].reduce((s, [asset, v]) =>
          s + (GOAL_RULES.rates[asset] ?? GOAL_RULES.fallback_rate) * (v / now), 0) * 10) / 10
      : GOAL_RULES.fallback_rate;

    const byMember = new Map<number, { client_id: number; name: string; value: number }>();
    for (const p of parts) {
      const at = byMember.get(p.client_id) ?? { client_id: p.client_id, name: p.name, value: 0 };
      at.value += p.now;
      byMember.set(p.client_id, at);
    }

    const base: Goal = {
      ...g,
      now: Math.round(now),
      put: Math.round(parts.reduce((s, p) => s + p.put, 0)),
      schemes: parts.reduce((s, p) => s + p.schemes, 0),
      rate,
      ownRate: rated > 0 ? Math.round((parts.reduce((s, p) => s + p.weighted, 0) / rated) * 10) / 10 : null,
      mix,
      monthly: Math.round(bySip.get(g.goal_id) ?? 0),
    };
    return {
      ...outlook(base),
      from: [...byMember.values()]
        .map(m => ({ ...m, value: Math.round(m.value) }))
        .sort((a, b) => b.value - a.value),
    };
  });
}

/* ── Starting someone ────────────────────────────────────────────────────────
   research/22: 29% of non-investors name a knowledge gap and 15% believe there
   is a minimum they cannot meet. The ₹100 SIP has existed for years and is
   barely known. The household is where that myth is cheapest to break, because
   the person who can break it is already reading this page.                   */

export const STARTING_FLOOR = 500;

export interface StartOffer {
  member: Member;
  /** Their age on the day the money would be wanted, if a goal names them. */
  goal: { goal_id: number; name: string; on: string } | null;
  /** Years between today and that date. */
  years: number | null;
}

/**
 * The members who could be started, and the goal that already names them. A goal
 * called "Ananya at university" with no Ananya in the register is the gap this
 * surfaces; matching on the first name is crude and deliberately so — it finds
 * the case rather than inventing a relationship.
 */
export function startable(viewerId: number): StartOffer[] {
  const h = household(viewerId);
  if (!h) return [];
  const goals = db().prepare(
    `SELECT goal_id, goal_name name, target_date "on" FROM client_goals
     WHERE fk_cm_user_id = ? AND is_active = 1`,
  ).all(viewerId) as { goal_id: number; name: string; on: string }[];

  return h.prospects.map(member => {
    const first = member.name.split(' ')[0].toLowerCase();
    const g = goals.find(x => x.name.toLowerCase().includes(first)) ?? null;
    return {
      member,
      goal: g,
      years: g ? Math.max(0, Math.round((Date.parse(g.on) - Date.parse(TODAY)) / 3.1557e10)) : null,
    };
  });
}
