// Growth triggers — does each prompt survive being asked why it exists?
//
// These three go looking for money rather than waiting for something to break, so
// they carry a risk the defensive triggers do not: a false one costs a client's
// patience and the broker's trust in the queue, and both are spent long before
// anyone notices the rule was wrong.
//
// So every minted action is re-derived here from the row in `rules_registry` — not
// from the constants in seed.ts. If the registry says 18% and the code fires at
// 12%, the registry is a decoration and this test fails. That is the whole claim
// of a rules registry and it is worth exactly one check.
//
// Usage: npx tsx mockdb/verify-triggers.ts

import { db } from '../lib/db';
import { TODAY } from './engines';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const TRIGGERS = ['sip_anniversary', 'abnormal_return', 'ideal_money'] as const;

interface Row { action_id: number; subject_id: string; impact_score: number; trigger_evidence: string; created_from: string; assignee_sb_id: number | null; sla_due: string }

const params = (key: string): Record<string, number> => {
  const r = db().prepare('SELECT params FROM rules_registry WHERE rule_key = ? AND is_active = 1').get(key) as { params: string } | undefined;
  return r ? JSON.parse(r.params) : {};
};
const rows = (type: string): Row[] => db().prepare(
  `SELECT action_id, subject_id, impact_score, trigger_evidence, created_from, assignee_sb_id, sla_due
     FROM actions WHERE action_type = ?`).all(type) as Row[];

// ── Every trigger is registered, and fires under its own name ───────────────
for (const t of TRIGGERS) {
  const p = params(t);
  check(`${t} has an approved rule with thresholds`,
    Object.keys(p).length > 0, Object.entries(p).map(([k, v]) => `${k} ${v}`).join(' · ') || 'no registry row');
  const all = rows(t);
  check(`${t} actually fired`, all.length > 0, `${all.length} minted`);
  check(`${t} every action names the rule that made it`,
    all.every(a => a.created_from === `rule:${t}`),
    all.length ? all[0].created_from : '—');
}

// ── 1 · SIP anniversary ────────────────────────────────────────────────────
{
  const p = params('sip_anniversary');
  const all = rows('sip_anniversary');
  const sip = db().prepare('SELECT sip_id, is_live_sip, tr_amount, start_date FROM sip_master WHERE sip_id = ?');

  let live = 0, inWindow = 0, aboveFloor = 0, correctImpact = 0, correctAsk = 0;
  for (const a of all) {
    const s = sip.get(Number(a.subject_id)) as { is_live_sip: number; tr_amount: number; start_date: string };
    const months = (Date.parse(TODAY) - Date.parse(s.start_date)) / (86400000 * 30.44);
    const ev = JSON.parse(a.trigger_evidence) as { monthly: number; suggested_monthly: number };
    const stepUp = Math.round((s.tr_amount * p.step_up_pct) / 100);
    if (s.is_live_sip === 1) live++;
    if (months >= p.months && months <= p.months + p.window_days / 30.44 + 0.1) inWindow++;
    if (s.tr_amount >= p.min_monthly) aboveFloor++;
    if (near(a.impact_score, stepUp * 12)) correctImpact++;
    if (ev.suggested_monthly === s.tr_amount + stepUp) correctAsk++;
  }
  check('every anniversary is a SIP that is still running', live === all.length, `${live}/${all.length}`);
  check(`every anniversary really crossed ${p.months} months inside the ${p.window_days}-day window`,
    inWindow === all.length, `${inWindow}/${all.length}`);
  check('no anniversary fires below the instalment floor',
    aboveFloor === all.length, `${aboveFloor}/${all.length} at or above ${rupees(p.min_monthly)}`);
  check('the ask is the registered step-up, not a number typed into the page',
    correctAsk === all.length, `${correctAsk}/${all.length} at ${p.step_up_pct}%`);
  check('what it is worth is the year of extra instalments',
    correctImpact === all.length, `${correctImpact}/${all.length} — step-up × 12`);
}

// ── 2 · Abnormal return ────────────────────────────────────────────────────
{
  const p = params('abnormal_return');
  const all = rows('abnormal_return');
  // Re-derived from NAV history, exactly as the rule states it.
  const ret = db().prepare(`SELECT ROUND((l.price / e.price - 1) * 100, 1) r
    FROM mf_historical_price_master l
    JOIN mf_historical_price_master e ON e.fk_scheme_id = l.fk_scheme_id
     AND e.price_date = (SELECT MAX(price_date) FROM mf_historical_price_master
                          WHERE fk_scheme_id = l.fk_scheme_id AND price_date <= date(?, '-' || ? || ' days'))
    WHERE l.fk_scheme_id = ? AND l.price_date = (SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id = l.fk_scheme_id)`);
  const held = db().prepare(`SELECT SUM(present_market_value) v FROM fifo_summary_holding_active
    WHERE client_id = ? AND scheme_id = (SELECT scheme_id FROM scheme_master WHERE scheme_full_name = ?)`);

  let hot = 0, material = 0, reallyHeld = 0, thirdOfGain = 0;
  for (const a of all) {
    const ev = JSON.parse(a.trigger_evidence) as { fund: string; return_pct: number; value: number; window_days: number };
    const scheme = db().prepare('SELECT scheme_id FROM scheme_master WHERE scheme_full_name = ?').get(ev.fund) as { scheme_id: number } | undefined;
    const r = scheme ? (ret.get(TODAY, p.window_days, scheme.scheme_id) as { r: number } | undefined) : undefined;
    if (r && r.r >= p.over_pct && near(r.r, ev.return_pct, 0.11)) hot++;
    if (ev.value * (ev.return_pct / 100) >= p.min_gain) material++;
    const h = held.get(Number(a.subject_id), ev.fund) as { v: number | null };
    if (h?.v != null && near(h.v, ev.value, 2)) reallyHeld++;
    if (near(a.impact_score, ev.value * (ev.return_pct / 100) / 3, 2)) thirdOfGain++;
  }
  check(`every run-up really cleared ${p.over_pct}% over ${p.window_days} days`,
    hot === all.length, `${hot}/${all.length} re-derived from NAV history`);
  check(`no run-up fires under ${rupees(p.min_gain)} actually on the table`,
    material === all.length, `${material}/${all.length}`);
  check('the client named really holds the fund, at the value claimed',
    reallyHeld === all.length, `${reallyHeld}/${all.length}`);
  check('what it is worth is a third of the run-up, never the whole holding',
    thirdOfGain === all.length, `${thirdOfGain}/${all.length}`);
}

// ── 3 · Ideal money ────────────────────────────────────────────────────────
{
  const p = params('ideal_money');
  const all = rows('ideal_money');
  const parked = db().prepare(`SELECT SUM(present_market_value) v, MIN(inv_since_date) since
    FROM fifo_summary_holding_active
    WHERE client_id = ? AND fund_category IN ('Liquid', 'Arbitrage Fund') AND balance_units > 0.0001`);

  let real = 0, aged = 0, aboveFloor = 0, isTheAmount = 0;
  for (const a of all) {
    const ev = JSON.parse(a.trigger_evidence) as { value: number; since: string };
    const q = parked.get(Number(a.subject_id)) as { v: number | null; since: string | null };
    const monthsHeld = q?.since ? (Date.parse(TODAY) - Date.parse(q.since)) / (86400000 * 30.44) : 0;
    if (q?.v != null && near(q.v, ev.value, 2)) real++;
    if (monthsHeld >= p.months) aged++;
    if (ev.value >= p.min_value) aboveFloor++;
    if (near(a.impact_score, ev.value, 2)) isTheAmount++;
  }
  check('every parked-cash prompt is money the client really holds in liquid',
    real === all.length, `${real}/${all.length}`);
  check(`every one has sat there longer than ${p.months} months`,
    aged === all.length, `${aged}/${all.length}`);
  check(`none fires under ${rupees(p.min_value)}`,
    aboveFloor === all.length, `${aboveFloor}/${all.length}`);
  check('what it is worth is the parked amount itself',
    isTheAmount === all.length, `${isTheAmount}/${all.length}`);

  // The distinction the spec draws, made structural: parked cash is not the same
  // client population as invested-with-no-SIP, and collapsing the two would give
  // a broker the same call twice under two names.
  const both = db().prepare(`SELECT COUNT(*) n FROM actions a
    WHERE a.action_type = 'ideal_money'
      AND EXISTS (SELECT 1 FROM actions b WHERE b.action_type = 'idle_no_sip'
                   AND b.subject_id = a.subject_id AND b.state NOT IN ('done', 'dismissed'))`).get() as { n: number };
  check('parked cash and no-SIP never raise the same client twice',
    both.n === 0, `${both.n} clients would have got both calls`);
}

// ── The queue can carry them ───────────────────────────────────────────────
{
  const orphan = db().prepare(`SELECT COUNT(*) n FROM actions
    WHERE action_type IN ('sip_anniversary','abnormal_return','ideal_money') AND assignee_sb_id IS NULL`).get() as { n: number };
  check('every growth prompt has an owner', orphan.n === 0, `${orphan.n} unassigned`);

  const dated = db().prepare(`SELECT COUNT(*) n FROM actions
    WHERE action_type IN ('sip_anniversary','abnormal_return','ideal_money') AND sla_due <= ?`).get(TODAY) as { n: number };
  check('none of them lands already overdue', dated.n === 0, `${dated.n} minted past their own date`);

  // A prompt nobody sees is not a prompt. Ravi is the broker the demo runs as.
  const mine = db().prepare(`SELECT action_type t, COUNT(*) n, ROUND(SUM(impact_score)) v FROM actions
    WHERE assignee_sb_id = 4 AND state IN ('proposed','assigned','in_progress')
      AND action_type IN ('sip_anniversary','abnormal_return','ideal_money')
    GROUP BY action_type`).all() as { t: string; n: number; v: number }[];
  check('all three reach the demo broker\'s own queue',
    mine.length === TRIGGERS.length,
    mine.map(m => `${m.t} ${m.n} (${rupees(m.v)})`).join(' · ') || 'none');
}

const total = TRIGGERS.reduce((s, t) => s + rows(t).length, 0);
console.log(`\nGROWTH TRIGGERS: ${total} prompts minted from 3 registered rules`);
console.log(failures === 0 ? '\nGROWTH TRIGGERS: ALL CHECKS PASSED' : `\nGROWTH TRIGGERS: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
