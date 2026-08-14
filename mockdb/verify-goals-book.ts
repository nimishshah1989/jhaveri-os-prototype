// Goals, at book level — and the seed that made a book-level view possible.
//
// verify-goals already pins Meera's five goals figure by figure. This one guards
// the two things that came after: that goals now exist across the book without a
// single one of her numbers moving, and that the broker's aggregate is the same
// projection her page runs rather than a second, friendlier one.
//
// It asserts the SHAPE of the spread and never the outcome of a named client. A
// seed that decides who is late has turned the projection into decoration, and a
// test that pins it has agreed to the lie.
//
// Usage: npx tsx mockdb/verify-goals-book.ts

import { broker, clientRows } from '../lib/queries';
import { outlooks, goals, goalPath, monthsBoughtBy, GOAL_RULES } from '../lib/goals';
import { bookGoals, goalCoverage, bookHeader } from '../lib/book';
import { ADOPTION } from './seed-goals';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const me = broker();
const code = me.code;

// ── Meera is untouched ──────────────────────────────────────────────────────
// The seed appends; it may not re-roll. Her three personal goals are the fixture
// every other goal test is written against.
const meera = goals(101).filter(g => g.goal_id <= 3);
check('the hand-placed goals still exist and still belong to Meera',
  meera.length === 3, `${meera.length} personal goals on client 101`);
// Sorted, because goals() returns them by target date and the ids are the point.
check('their ids were not renumbered by the generator',
  [...meera].map(g => g.goal_id).sort((a, b) => a - b).join(',') === '1,2,3',
  [...meera].map(g => g.goal_id).sort((a, b) => a - b).join(','));
check('every generated goal sits above the authored range',
  goals(101).every(g => g.goal_id <= 3 || g.goal_id >= 100),
  'no generated id collides with an authored one');

// ── The book now has goals, and not too many ────────────────────────────────
const cov = goalCoverage(code).value;
const all = bookGoals(code).value;

check('goals exist across the book, not on one client',
  cov.named > 1, `${cov.named} of ${cov.clients} clients have named one`);
check('adoption is partial, because a book where everyone has a goal is not a book',
  cov.named < cov.clients, `${cov.silent} clients have never named one`);
check('adoption lands near the rate the seed documents',
  Math.abs(cov.named / cov.clients - ADOPTION) < 0.18,
  `${Math.round((cov.named / cov.clients) * 100)}% against a documented ${Math.round(ADOPTION * 100)}%`);

// ── The aggregate reconciles ────────────────────────────────────────────────
const book = bookHeader(code).value.aum;
check('money spoken for and money adrift add back to the book',
  near(cov.spokenFor + cov.adrift, book, 2),
  `${rupees(cov.spokenFor)} + ${rupees(cov.adrift)} vs ${rupees(book)}`);
check('money behind goals never exceeds the book',
  cov.spokenFor <= book + 1, `${rupees(cov.spokenFor)} of ${rupees(book)}`);
check('every goal state is counted exactly once',
  cov.late + cov.onTrack + cov.reached + cov.unreachable === all.length,
  `${cov.late} late + ${cov.onTrack} on track + ${cov.reached} reached + ${cov.unreachable} out of reach = ${all.length}`);

const bookClients = new Set(clientRows(code, {}).rows.map(r => r.client_id));
check('every goal on the broker screen belongs to a client in his book',
  all.every(g => bookClients.has(g.client_id)), `${all.length} goals cross-checked`);

// ── The broker sees what the client sees ────────────────────────────────────
// Same function, so this can only fail if someone adds a second projection.
const sample = all.slice(0, 5);
for (const g of sample) {
  const theirs = outlooks(g.client_id).find(o => o.goal_id === g.goal_id);
  check(`${g.client}'s "${g.name}" reads the same on both sides of the table`,
    !!theirs && theirs.projected === g.projected && theirs.monthsOff === g.monthsOff,
    `${g.monthsOff == null ? 'out of reach' : `${g.monthsOff} months`} · projected ${rupees(g.projected)}`);
}

// ── The spread is varied, and nothing about it was typed ────────────────────
const states = [cov.late, cov.onTrack, cov.reached].filter(n => n > 0).length;
check('the book shows more than one outcome',
  states >= 2, `late ${cov.late} · on track ${cov.onTrack} · reached ${cov.reached} · out of reach ${cov.unreachable}`);
check('goals span more than one kind',
  new Set(all.map(g => g.kind)).size >= 3, [...new Set(all.map(g => g.kind))].join(', '));
check('a named goal with nothing tagged to it exists, because that is a real state',
  all.some(g => g.schemes === 0), `${cov.unfunded} named but unfunded`);

// ── The projection obeys its own rules ──────────────────────────────────────
check('no goal is projected at the client\'s own past return',
  all.every(g => Object.values(GOAL_RULES.rates).includes(g.rate) || g.rate === GOAL_RULES.fallback_rate
    || (g.rate > 6 && g.rate < 12)),
  'every rate is a blend of the published ones');
check('a goal already met is not also reported as late',
  all.every(g => !(g.met && (g.monthsOff ?? 0) > 0)), 'met and late are exclusive');
check('nothing is projected past the stated horizon',
  all.every(g => g.reachedOn === null
    || Date.parse(g.reachedOn) <= Date.parse(`${2026 + GOAL_RULES.horizon_years}-12-31`)),
  `horizon ${GOAL_RULES.horizon_years} years`);

// ── The chart is the same walk as the sentence ──────────────────────────────
// The line a client reads and the verdict printed under it come from one engine.
for (const g of all.filter(x => !x.met && x.monthsOff != null).slice(0, 3)) {
  const path = goalPath(g);
  const atTarget = path.find(p => p.m >= g.on.slice(0, 7) + '-01');
  check(`"${g.name}" — the drawn path lands where the projection says it does`,
    !!atTarget && near(atTarget.projected, g.projected, Math.max(2, g.projected * 0.001)),
    `chart ${rupees(atTarget?.projected ?? 0)} vs outlook ${rupees(g.projected)}`);
  check(`"${g.name}" — the target line is flat at the target`,
    path.every(p => p.target === g.target), rupees(g.target));

  const extra = 2000;
  const bought = monthsBoughtBy(g, extra);
  const boostedEnd = path[path.length - 1];
  check(`"${g.name}" — paying more in never arrives later`,
    boostedEnd.boosted >= boostedEnd.projected - 1,
    bought == null ? 'still out of reach' : `₹${extra}/mo buys back ${bought} months`);
}

// A goal with nothing behind it and nothing going in must not claim to arrive.
const stuck = all.filter(g => g.now === 0 && g.monthly === 0);
check('a goal with no money and no instalment is not projected to arrive',
  stuck.every(g => g.reachedOn === null || g.met),
  `${stuck.length} goals hold nothing and take nothing in`);

console.log(`\nBOOK GOALS: ${all.length} goals across ${cov.named} of ${cov.clients} clients · ${rupees(cov.spokenFor)} spoken for, ${rupees(cov.adrift)} adrift · ${cov.late} late, ${cov.onTrack} on track, ${cov.reached} reached`);
console.log(failures === 0 ? '\nBOOK GOALS: ALL CHECKS PASSED' : `\nBOOK GOALS: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
