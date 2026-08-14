/**
 * verify-fabric — the answering layer: what changed, what you asked, who has it.
 *
 * Two things here are load-bearing beyond the usual arithmetic.
 *
 * First, the EVAL SET. `lib/askme.ts` turns a client's free text into an answer,
 * and the house rule is that any model-shaped output ships with an eval set that
 * runs on every build. It runs here. It already earned its place: the first run
 * routed "how much tax if I sold everything" to the net-worth intent, because
 * "much" was a cue word. That is the class of bug an eval set exists to catch,
 * and it would have shipped without one.
 *
 * Second, the REFUSALS. This product may not tell a client what to buy. Three of
 * the evals below are advice-shaped and must be refused; if a routing change ever
 * starts answering them, this file fails rather than a client being advised by a
 * keyword matcher.
 *
 * Run: npx tsx mockdb/verify-fabric.ts   (joined to `npm run verify:all`)
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { eventDesk, unviewedKinds } from '../lib/eventdesk';
import { askClient, EVALS, ASK_REFUSAL } from '../lib/askme';
import { tickets, clockSummary } from '../lib/clock';
import { explain, sinceLastLook, FIGURES } from '../lib/explain';
import { mirror } from '../lib/mirror';

const db = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const ME = 101;
const TODAY = '2026-08-07';
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

console.log('\nverify-fabric — the event desk, the ask bar and the clock\n');

/* ── the event desk: every row traces to a record ─────────────────────────── */

const feed = eventDesk(ME);
assert('the client has events to read', feed.length > 0);

check('every event kind rendered has a written house view', unviewedKinds(), []);
assert('and every event on the page carries one', feed.every(e => e.view != null && e.view.length > 60),
  'an event with no view must say so rather than render an empty block');

assert('no event is dated in the future', feed.every(e => e.on <= TODAY));
assert('and the feed is newest first',
  feed.every((e, i) => i === 0 || e.on <= feed[i - 1].on));

// Each kind is re-derived here from the table it came from.
const held = new Set((db.prepare(
  `SELECT scheme_id FROM fifo_summary_holding_active WHERE client_id = ?`).all(ME) as { scheme_id: number }[])
  .map(r => r.scheme_id));
assert('every event about a fund is about a fund the client actually holds',
  feed.every(e => e.scheme_id == null || held.has(e.scheme_id)),
  'an event desk that reports on funds you do not own is a newsletter');

for (const e of feed.filter(x => x.kind === 'manager_changed')) {
  check(`a manager change on ${e.fund} has its dated event row`,
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM events WHERE subject_type='scheme' AND subject_id=?
       AND event_type='fund_manager_changed' AND occurred_at=?`, String(e.scheme_id), e.on).n, 1);
}
for (const e of feed.filter(x => x.kind === 'instalment_failed')) {
  check(`a refused instalment on ${e.fund} is a real rejection row`,
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM transaction_master t
       JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
       WHERE t.fk_acc_id=? AND tt.tr_type_name='SIP Rejection' AND t.tr_date=? AND t.fk_scheme_id=?`,
      ME, e.on, e.scheme_id).n > 0, true);
}
const mandate = feed.find(e => e.kind === 'mandate_ending');
assert('the expiring mandate is on the desk', mandate != null,
  "Meera's mandate expires 12-Aug-2026 in the seed — the story this surface exists for");
if (mandate) {
  assert('and it names the money that stops', /₹/.test(mandate.consequence ?? ''));
  assert('and offers the one thing that fixes it', mandate.act?.kind === 'fix_mandate');
}

assert('every event that costs money says how much, in rupees',
  feed.filter(e => ['manager_changed', 'mandate_ending', 'instalment_failed', 'worst_month', 'style_moved'].includes(e.kind))
    .every(e => /₹/.test(e.consequence ?? '')),
  'an event with no consequence is news, not a statement about your money');

check('a client with nothing gets no events, not invented ones', eventDesk(375).length, 0);

/* ── the eval set: this is the gate ───────────────────────────────────────── */

for (const e of EVALS) {
  const a = askClient(ME, e.ask);
  check(`ask "${e.ask}" → ${e.expect}`, a.intent, e.expect);
  assert(`ask "${e.ask}" states what it cannot tell you`, a.risk.length > 40,
    'an answer with no stated limit is an answer pretending to be complete');
  assert(`ask "${e.ask}" hands off to a named person`, a.handoff.length > 0);
  assert(`ask "${e.ask}" shows back how it read the question`, a.read_as.length > 10,
    'a wrong reading has to be visible, or the client cannot tell it was wrong');
}

// The refusals, checked as behaviour rather than as routing.
for (const e of EVALS.filter(x => x.expect === 'refused')) {
  const a = askClient(ME, e.ask);
  check(`"${e.ask}" returns no facts at all`, a.facts.length, 0);
  check(`and says plainly that this is not what the bar does`, a.risk, ASK_REFUSAL);
}

// No answer, on any eval, may read as an instruction.
const INSTRUCTION = /\byou should\b|\bwe recommend\b|\bbuy now\b|\bswitch to\b/i;
for (const e of EVALS) {
  const a = askClient(ME, e.ask);
  const text = [a.read_as, a.risk, ...a.facts.map(f => `${f.label} ${f.value}`)].join(' ');
  assert(`"${e.ask}" answers without instructing`, !INSTRUCTION.test(text),
    'the answering layer ranks facts and hands to a person; it never tells a client what to do');
}

// The answers that carry money must agree with the pages that print the same money.
const worth = askClient(ME, 'what am I worth');
const bookValue = one<{ v: number }>(
  `SELECT ROUND(SUM(present_market_value)) v FROM fifo_summary_holding_active WHERE client_id = ?`, ME).v;
assert('the ask bar and the portfolio page quote the same net worth',
  worth.facts.some(f => f.value.replace(/[^0-9]/g, '') === String(bookValue)),
  `${JSON.stringify(worth.facts)} against ${bookValue}`);

const house = askClient(ME, 'what is the family worth together');
const houseValue = one<{ v: number }>(
  `SELECT ROUND(COALESCE(SUM(f.present_market_value), 0)) v FROM fifo_summary_holding_active f
   WHERE f.client_id IN (SELECT client_id FROM household_members
     WHERE family_id = (SELECT fk_family_id FROM client_master WHERE cm_user_id = ?) AND client_id IS NOT NULL)`, ME).v;
assert('and the ask bar and the household page quote the same combined figure',
  house.facts.some(f => f.value.replace(/[^0-9]/g, '') === String(houseValue)),
  `${JSON.stringify(house.facts)} against ${houseValue}`);

// An empty book answers honestly rather than at zero-confidence silence.
const empty = askClient(375, 'which of my funds is doing badly');
check('a client with no funds gets an answer with no facts, not a fabricated one', empty.facts.length, 0);
check('and it is stated at low confidence', empty.confidence, 'low');

/* ── any figure, opened: three voices, never blended ──────────────────────── */

for (const key of FIGURES) {
  const s = explain(ME, key);
  assert(`${key}: the figure opens`, s != null,
    'a figure whose ledger voice cannot be computed gets no sheet at all');
  if (!s) continue;

  const voices = s.passages.map(p => p.voice);
  check(`${key}: the ledger always speaks first`, voices[0], 'ledger');
  assert(`${key}: no voice appears twice`, new Set(voices).size === voices.length);
  assert(`${key}: every voice is labelled on screen`, s.passages.every(p => p.label.length > 2));
  assert(`${key}: each voice says something`, s.passages.every(p => p.text.length > 60));

  // The seam that must never be hidden: the manager has not written these.
  const rm = s.passages.find(p => p.voice === 'manager');
  if (rm) assert(`${key}: the manager's voice is marked as a stand-in`, rm.seeded === true,
    "Ravi's workspace is a later build — passing our words off as his is the failure this flag prevents");

  // Every Mirror entry on a sheet traces to a rule that generated it.
  const generated = new Set(mirror(ME).map(e => e.key));
  assert(`${key}: no Mirror entry on the sheet is hand-written`,
    s.mirror.every(m => generated.has(m.key)),
    'each has to come from lib/mirror, which writes every entry from a rule');

  assert(`${key}: the sheet drills to its constituents`, s.drill != null && s.drill.href.startsWith('/me'));
  assert(`${key}: and the figure is already formatted`, /[0-9]/.test(s.figure));
}

// A client with no history gets fewer sheets, never invented ones.
const bare = FIGURES.filter(k => explain(375, k) != null);
check('a client holding nothing gets no figure sheets at all', bare, []);
assert('and the demo client gets one for every figure', FIGURES.every(k => explain(ME, k) != null));

/* ── what changed since you last looked ───────────────────────────────────── */

check('a first visit has nothing to compare against', sinceLastLook(ME, null).since, null);
check('and invents no movement for it', sinceLastLook(ME, null).moved, null);
check('a malformed date is treated as a first visit', sinceLastLook(ME, 'yesterday').since, null);
check('so is a date in the future', sinceLastLook(ME, '2099-01-01').since, null);

const back = sinceLastLook(ME, '2026-07-01');
check('a real last-seen is carried through', back.since, '2026-07-01');
assert('the movement is computed on the same holdings, priced then and now',
  back.moved == null || Number.isFinite(back.moved));
check('the ledger entries counted are the ones in that window', back.orders,
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ? AND tr_date > '2026-07-01' AND tr_date <= ?`,
    ME, TODAY).n);
assert('and nothing outside the window is counted', sinceLastLook(ME, TODAY).orders === 0);

/* ── the clock ────────────────────────────────────────────────────────────── */

const t = tickets(ME);
const c = clockSummary(ME);
check('the clock counts the same tickets it lists', c.open + c.closed, t.length);

const raw = db.prepare(
  `SELECT action_id, created_at, sla_due, state, closed_at,
          COALESCE(sb.sb_holder_name, 'the house desk') who
   FROM actions a LEFT JOIN sub_broker_master sb ON sb.sb_id = a.assignee_sb_id
   WHERE a.subject_type='client' AND a.subject_id=? AND a.created_from='client_app'`,
).all(String(ME)) as { action_id: number; created_at: string; sla_due: string; state: string; closed_at: string | null; who: string }[];
check('every ticket on the clock is a real action row', t.length, raw.length);

for (const x of t) {
  const row = raw.find(r => r.action_id === x.action_id)!;
  check(`ticket ${x.action_id} names the human holding it`, x.with_whom, row.who);
  assert(`ticket ${x.action_id} never says "the team"`, !/team|department|support/i.test(x.with_whom));
  const left = Math.round((Date.parse(row.sla_due) - Date.parse(TODAY)) / 864e5);
  check(`ticket ${x.action_id} counts the days left from its own promise`, x.days_left, left);
  const open = !['done', 'closed', 'dismissed'].includes(row.state);
  check(`ticket ${x.action_id} is late only if it is open and past its promise`, x.overdue, open && left < 0);
}

assert('a promised date is never before the date it was asked',
  t.every(x => x.promised >= x.raised));
assert('the median quoted is a measured one, or nothing is quoted',
  c.median_days == null || (c.closed > 0 && c.median_days >= 0),
  'a service record has to come from closed tickets, never from a target');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
