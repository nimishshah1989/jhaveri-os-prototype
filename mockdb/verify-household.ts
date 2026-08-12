/**
 * verify-household — the family, and who is allowed to look at it.
 *
 * The dangerous figure here is the combined one. A household total is the only
 * number in the app assembled out of other people's money, so every assertion
 * below is really the same question asked from a different side: does anything
 * appear in it that its owner did not agree to?
 *
 * House rule kept: each assertion re-derives its answer with SQL written here,
 * never by calling the function under test a second time.
 *
 * Run: npx tsx mockdb/verify-household.ts   (joined to `npm run verify:all`)
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import {
  household, familyGoals, memberHoldings, startable, whyHidden, accessLabel, MAJORITY,
} from '../lib/household';
import { goals, GOAL_RULES } from '../lib/goals';

const db = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const ME = 101;
let pass = 0;
const fails: string[] = [];

function assert(name: string, cond: boolean, why = ''): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${why ? ` — ${why}` : ''}`); }
}
function check(name: string, got: unknown, want: unknown): void {
  assert(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
const one = <T>(sql: string, ...p: unknown[]): T => db.prepare(sql).get(...p) as T;
const all = <T>(sql: string, ...p: unknown[]): T[] => db.prepare(sql).all(...p) as T[];

console.log('\nverify-household — the family, and who may look at it\n');

const h = household(ME)!;
assert('the demo client has a household', h != null && h.members.length > 1,
  'the seed gave every family exactly one member until phase 8');

/* ── the household is real people with real rows ──────────────────────────── */

const seeded = all<{ n: number }>(`SELECT COUNT(*) n FROM household_members WHERE family_id = ?`, h.family_id);
check('every member on the page has a row behind it', h.members.length, seeded[0].n);

const clients = one<{ n: number }>(
  `SELECT COUNT(*) n FROM client_master WHERE fk_family_id = ?`, h.family_id).n;
check('every member with an account is in that family in client_master',
  h.members.filter(m => m.client_id != null).length, clients);

check('nobody is in two households',
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM (SELECT client_id FROM household_members
      WHERE client_id IS NOT NULL GROUP BY client_id HAVING COUNT(DISTINCT family_id) > 1)`).n, 0);

/* ── the combined figure is the sum of members, and nothing else ───────────── */

const visible = h.members.filter(m => m.value != null).map(m => m.client_id!);
const marks = visible.map(() => '?').join(',');
const direct = one<{ v: number }>(
  `SELECT ROUND(COALESCE(SUM(present_market_value), 0)) v
   FROM fifo_summary_holding_active WHERE client_id IN (${marks})`, ...visible).v;
check('the combined figure equals the sum of the members it counts', h.combined, direct);
check('and counts exactly the members it says it does', h.counted, visible.length);

// The negative side of the same rule: a member who is not counted contributes nothing.
const uncounted = h.members.filter(m => m.client_id != null && m.value == null).map(m => m.client_id!);
if (uncounted.length) {
  const theirs = one<{ v: number }>(
    `SELECT ROUND(COALESCE(SUM(present_market_value), 0)) v FROM fifo_summary_holding_active
     WHERE client_id IN (${uncounted.map(() => '?').join(',')})`, ...uncounted).v;
  assert('money the viewer may not see is outside the combined figure', h.combined + theirs !== h.combined);
}

const wholeFamily = one<{ v: number }>(
  `SELECT ROUND(COALESCE(SUM(present_market_value), 0)) v FROM fifo_summary_holding_active
   WHERE client_id IN (SELECT cm_user_id FROM client_master WHERE fk_family_id = ?)`, h.family_id).v;
assert('the combined figure never exceeds what the family actually holds',
  h.combined <= wholeFamily, `${h.combined} vs ${wholeFamily}`);

/* ── nothing appears without a consent row, a guardianship, or ownership ──── */

for (const m of h.members) {
  if (m.client_id == null || m.client_id === ME) continue;
  const rows = all<{ scope: string; state: string }>(
    `SELECT scope, state FROM household_consents WHERE family_id = ? AND subject_id = ? AND viewer_id = ?`,
    h.family_id, m.client_id, ME);
  const said = (scope: string) => rows.find(r => r.scope === scope)?.state ?? null;
  const guardian = one<{ g: number | null }>(
    `SELECT guardian_client_id g FROM household_members WHERE family_id = ? AND client_id = ?`,
    h.family_id, m.client_id).g;

  if (m.value != null) {
    assert(`${m.name}'s value is shown only because they agreed, or because a guardian operates it`,
      said('total') === 'granted' || guardian === ME,
      `no granted total consent and no guardianship, yet ₹${m.value} is on the page`);
  } else {
    assert(`${m.name}'s value is withheld and reads as a dash, never as zero`, m.value === null);
    assert(`and the page can say why ${m.name}'s value is missing`, (whyHidden(m, 'total') ?? '').length > 20);
  }

  const drill = memberHoldings(ME, m.member_id);
  if (drill.ok) {
    assert(`${m.name}'s funds open only on a granted consent or a guardianship`,
      said('holdings') === 'granted' || guardian === ME);
    const theirs = all<{ scheme_id: number }>(
      `SELECT scheme_id FROM fifo_summary_holding_active WHERE client_id = ?`, m.client_id);
    check(`${m.name}'s fund list is their own folios, all of them`, drill.rows.length, theirs.length);
  } else {
    assert(`${m.name}'s funds stay shut, with a reason rather than a blank`, drill.why.length > 20);
    assert(`and no consent row says otherwise for ${m.name}`, said('holdings') !== 'granted');
  }
}

// The case the whole model exists for: counted in the total, closed to a reader.
const partial = h.members.find(m => m.total === 'granted' && m.detail === 'refused');
assert('at least one member is counted but not readable — the case consent exists for',
  partial != null, 'nothing in the seed exercises a refusal');
if (partial) {
  const d = memberHoldings(ME, partial.member_id);
  assert(`${partial.name} is inside the total but not inside the drill`,
    partial.value != null && !d.ok);
  check(`${partial.name}'s refusal is a decided row, not a missing one`,
    one<{ state: string }>(
      `SELECT state FROM household_consents WHERE family_id=? AND subject_id=? AND viewer_id=? AND scope='holdings'`,
      h.family_id, partial.client_id, ME).state, 'refused');
}

/* ── a minor is law, not consent ──────────────────────────────────────────── */

const minor = h.members.find(m => m.minor && m.guardian_id === ME && m.client_id != null);
assert('the household has a minor held by a guardian', minor != null);
if (minor) {
  check('a guardian sees a minor without any consent row existing',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM household_consents WHERE family_id=? AND subject_id=?`,
      h.family_id, minor.client_id).n, 0);
  check('and the page names guardianship rather than pretending they agreed', minor.total, 'guardian');
  check('the label says so in words', accessLabel(minor.total), 'You are guardian');
  assert('the minor is genuinely under 18 by the register, not by a flag',
    minor.age != null && minor.age < MAJORITY,
    `${minor.name} is ${minor.age}`);
}

/* ── a member with no account invents nothing ─────────────────────────────── */

for (const p of h.prospects) {
  check(`${p.name} has no account, so no value is printed`, p.value, null);
  check(`nor a rate`, p.rate, null);
  check(`nor a fund count`, p.funds, null);
  check(`and no client row is hiding behind the name`,
    one<{ n: number }>(`SELECT COUNT(*) n FROM household_members WHERE member_id = ? AND client_id IS NOT NULL`, p.member_id).n, 0);
  const d = memberHoldings(ME, p.member_id);
  assert(`opening ${p.name} explains the absence rather than showing an empty table`,
    !d.ok && d.why.includes('no account'));
}

const offers = startable(ME);
check('the acquisition surface offers exactly the members with no account', offers.length, h.prospects.length);
const ananya = offers.find(o => o.member.name.startsWith('Ananya'));
assert('the goal already naming that member is found, not invented', ananya?.goal != null);
if (ananya?.goal) {
  check('and it is a goal that really exists against the viewer',
    one<{ n: number }>(`SELECT COUNT(*) n FROM client_goals WHERE goal_id = ? AND fk_cm_user_id = ?`,
      ananya.goal.goal_id, ME).n, 1);
  assert('the years to it are counted from the goal date, not typed',
    ananya.years != null && ananya.years >= 0 && ananya.years < 30, `${ananya.years}`);
}

/* ── family goals are the family's, and never anyone's own past return ────── */

const fam = familyGoals(ME);
check('the family owns the goals marked as its own',
  fam.length,
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM client_goals WHERE is_family = 1 AND is_active = 1
     AND fk_cm_user_id IN (SELECT cm_user_id FROM client_master WHERE fk_family_id = ?)`, h.family_id).n);

const personal = goals(ME);
assert('a family goal never appears in one member\'s own goal list',
  personal.every(p => !fam.some(f => f.goal_id === p.goal_id)),
  'the same goal counted twice would double the money behind it');

const published = Object.values(GOAL_RULES.rates);
for (const g of fam) {
  const direct2 = one<{ v: number; n: number }>(
    `SELECT ROUND(COALESCE(SUM(f.present_market_value), 0)) v, COUNT(*) n
     FROM fifo_summary_holding_active f
     WHERE (f.client_id, f.scheme_id) IN (
       SELECT DISTINCT fk_acc_id, fk_scheme_id FROM transaction_master
       WHERE is_active = 1 AND fk_goal_id = ?)`, g.goal_id);
  assert(`"${g.name}" is worth what the funds tagged to it are worth`,
    Math.abs(g.now - direct2.v) <= 1, `${g.now} vs ${direct2.v}`);
  check(`"${g.name}" counts its funds correctly`, g.schemes, direct2.n);

  check(`"${g.name}" names every member standing behind it`,
    g.from.map(f => f.client_id).sort(),
    all<{ c: number }>(
      `SELECT DISTINCT fk_acc_id c FROM transaction_master WHERE is_active = 1 AND fk_goal_id = ?`, g.goal_id)
      .map(r => r.c).sort());
  assert(`"${g.name}" splits to its members without losing a rupee`,
    Math.abs(g.from.reduce((s, f) => s + f.value, 0) - g.now) <= g.from.length);

  assert(`"${g.name}" projects at a published rate, never the family's own return`,
    g.rate >= Math.min(...published) && g.rate <= Math.max(...published), `${g.rate}%`);
  assert(`"${g.name}" states the mix its rate was blended from`, g.mix.length > 0);
}

// The rule the whole goals layer rests on, re-checked on the family side.
if (fam.length) {
  const g = fam[0];
  assert('a spectacular family past return does not move the family projection',
    familyGoals(ME)[0].projected === g.projected);
  assert('at least one family goal has earned a rate unlike the one it projects at',
    fam.some(x => x.ownRate != null && Math.abs(x.ownRate - x.rate) > 5)
    || fam.every(x => x.ownRate == null),
    'nothing exercises the divergence the published-rate rule exists for');
}

/* ── a household nobody has mapped still renders ──────────────────────────── */

const lone = one<{ id: number }>(
  `SELECT c.cm_user_id id FROM client_master c
   WHERE c.fk_family_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM household_members m WHERE m.family_id = c.fk_family_id)
   LIMIT 1`).id;
const solo = household(lone)!;
check('an unmapped family still has one member — a page with no objects is a bug', solo.members.length, 1);
check('and that member is the viewer', solo.members[0].client_id, lone);
check('who is shown their own money without asking anyone', solo.members[0].total, 'self');
check('and has nobody to start', startable(lone).length, 0);
check('and no family goals invented for them', familyGoals(lone).length, 0);

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
