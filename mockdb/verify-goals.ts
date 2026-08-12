/**
 * verify-goals — the denominator that is not rupees.
 *
 * The dangerous number in this file is the arrival month: it is the one figure in
 * the app that describes the future, and the whole design rests on it being an
 * honest assumption rather than a flattering extrapolation. Most of what follows
 * checks exactly that.
 *
 * Run: npx tsx mockdb/verify-goals.ts   (joined to `npm run verify:all`)
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { goals, outlook, outlooks, untagged, verdict, monthsBoughtBy, GOAL_RULES } from '../lib/goals';

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

console.log('\nverify-goals — what the money is for\n');

const list = outlooks(ME);
check('the demo client has the three seeded goals', list.length, 3);

/* ── one denominator, extended rather than replaced ───────────────────────── */

const total = one<{ v: number }>(`SELECT ROUND(SUM(present_market_value)) v FROM fifo_summary_holding_active WHERE client_id = ?`, ME).v;
const tagged = list.reduce((s, g) => s + g.now, 0);
const loose = untagged(ME);
assert('goal money plus untagged money equals the client\'s whole book',
  Math.abs(tagged + loose.value - total) <= list.length + 1,
  `${tagged} + ${loose.value} vs ${total}`);

for (const g of list) {
  const direct = one<{ v: number; n: number }>(
    `SELECT ROUND(SUM(f.present_market_value)) v, COUNT(*) n
     FROM fifo_summary_holding_active f
     WHERE f.client_id = ? AND f.scheme_id IN (
       SELECT DISTINCT fk_scheme_id FROM transaction_master
       WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id = ?)`, ME, ME, g.goal_id);
  assert(`"${g.name}" is worth what its own funds are worth`, Math.abs(g.now - direct.v) <= 1,
    `${g.now} vs ${direct.v}`);
  check(`"${g.name}" counts its funds correctly`, g.schemes, direct.n);
}

/* ── the projection is an assumption, and never their own return ──────────── */

const published = Object.values(GOAL_RULES.rates);
for (const g of list) {
  assert(`"${g.name}" projects inside the published range`,
    g.rate >= Math.min(...published) && g.rate <= Math.max(...published),
    `${g.rate}% is outside ${Math.min(...published)}–${Math.max(...published)}%`);
  assert(`"${g.name}" states the mix its rate was blended from`, g.mix.length > 0);
  assert(`"${g.name}" mix adds to about 100%`,
    Math.abs(g.mix.reduce((s, m) => s + m.pct, 0) - 100) <= 1);
}

// The point of the whole design: replacing what the money HAS done must not move
// what the page says it WILL do.
const g0 = goals(ME)[0];
const wild = outlook({ ...g0, ownRate: 400 });
const grim = outlook({ ...g0, ownRate: -90 });
check('a spectacular past return does not move the projection', wild.projected, outlook(g0).projected);
check('nor does a terrible one', grim.projected, outlook(g0).projected);
assert('at least one goal has actually earned a rate wildly unlike the projection',
  list.some(g => g.ownRate != null && Math.abs(g.ownRate - g.rate) > 10),
  'nothing in the seed exercises the divergence this rule exists for');

/* ── the arrival month has to survive being recomputed ────────────────────── */

for (const g of list) {
  const o = outlook(g);
  if (o.reachedOn == null) {
    assert(`"${g.name}" that cannot be reached says so rather than printing a date`,
      verdict(o).includes('does not get there'));
    check(`"${g.name}" reports no months-off when there is no arrival`, o.monthsOff, null);
    continue;
  }
  const months = Math.round((Date.parse(o.reachedOn) - Date.parse('2026-08-07')) / 2.6298e9);
  const r = g.rate / 100 / 12;
  let v = g.now;
  for (let i = 0; i < months; i++) v = v * (1 + r) + g.monthly;
  assert(`"${g.name}" really does reach its target on the month it names`, v >= g.target * 0.999,
    `walked to ${Math.round(v)} against a target of ${g.target}`);

  const before = g.now;
  let u = before;
  for (let i = 0; i < months - 1; i++) u = u * (1 + r) + g.monthly;
  assert(`"${g.name}" names the FIRST month it arrives, not a later one`,
    months === 0 || u < g.target, 'it had already got there a month earlier');
}

/* ── more money never makes a goal later ──────────────────────────────────── */

for (const g of list) {
  const steps = [2000, 5000, 10000].map(a => monthsBoughtBy(g, a));
  const real = steps.filter((m): m is number => m != null);
  assert(`"${g.name}": every extra rupee a month buys time, never loses it`,
    real.every(m => m >= 0));
  assert(`"${g.name}": more per month is never worth less time`,
    real.every((m, i) => i === 0 || m >= real[i - 1]),
    `${JSON.stringify(steps)} is not increasing`);
}

/* ── nothing is invented where there is nothing ───────────────────────────── */

const empty = outlooks(375);
check('a client with no goals gets no goals, not a default one', empty.length, 0);
check('and no stray goal rows exist for them',
  one<{ n: number }>(`SELECT COUNT(*) n FROM client_goals WHERE fk_cm_user_id = 375`).n, 0);

const met = outlook({ ...g0, target: 1 });
assert('a goal already met says so instead of projecting', met.met && verdict(met).includes('Already there'));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
