/**
 * verify-funds — the fund research layer, and the line between measured and supplied.
 *
 * Phase 4 brings numbers into the app that we did not compute. That is fine, and
 * it is the founder's instruction, but it creates exactly one new way to lie:
 * a seeded figure that reads on screen as if it were measured. So most of what
 * follows checks provenance rather than arithmetic — that every row says which
 * side of the line it is on, and that the ones claiming to be computed really
 * can be recomputed here, from scratch, in SQL written in this file.
 *
 * Run: npx tsx mockdb/verify-funds.ts   (joined to `npm run verify:all`)
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import {
  manager, handovers, commentary, riskStats, styleHistory, drift, peers,
  overlapWith, findings, ratingVisible,
} from '../lib/funds';
import { fundOverlap } from '../lib/portfolio';
import { WINDOW_MONTHS, RISK_FREE_PCT } from './seed-funds';

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

console.log('\nverify-funds — who runs it, how it behaves, and where each figure came from\n');

const held = all<{ scheme_id: number; fund_name: string }>(
  `SELECT scheme_id, fund_name FROM fifo_summary_holding_active WHERE client_id = ? ORDER BY scheme_id`, ME);
assert('the demo client holds funds to research', held.length > 0);

/* ── every held fund resolves a manager, or says why not ──────────────────── */

for (const h of held) {
  const m = manager(h.scheme_id);
  const onFile = one<{ n: number }>(
    `SELECT COUNT(*) n FROM scheme_manager WHERE fk_scheme_id = ? AND to_date IS NULL`, h.scheme_id).n;
  assert(`${h.fund_name} either names its manager or has none on file`,
    (m != null) === (onFile > 0),
    'a fund with a manager row and no manager on the page is a blank the client cannot explain');
  if (m) {
    assert(`${h.fund_name}'s manager has a philosophy worth printing`, m.philosophy.length > 40);
    check(`${h.fund_name}'s manager is marked as supplied, not measured`, m.source, 'seeded');
  }
}

check('every scheme in the register has exactly one current manager',
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM (SELECT fk_scheme_id FROM scheme_manager WHERE to_date IS NULL
      GROUP BY fk_scheme_id HAVING COUNT(*) > 1)`).n, 0);

check('no scheme is left without one',
  one<{ n: number }>(
    `SELECT COUNT(*) n FROM scheme_master s
     WHERE NOT EXISTS (SELECT 1 FROM scheme_manager m WHERE m.fk_scheme_id = s.scheme_id AND m.to_date IS NULL)`).n, 0);

/* ── a tenure cannot be longer than the fund ──────────────────────────────── */

const tooOld = all<{ scheme_id: number; from_date: string; inception: string }>(
  `SELECT sm.fk_scheme_id scheme_id, sm.from_date,
          (SELECT MIN(price_date) FROM mf_historical_price_master p WHERE p.fk_scheme_id = sm.fk_scheme_id) inception
   FROM scheme_manager sm
   WHERE inception IS NOT NULL AND sm.from_date < inception`);
check('no manager has run a fund since before the fund existed', tooOld.length, 0);

const future = one<{ n: number }>(
  `SELECT COUNT(*) n FROM scheme_manager WHERE from_date > '2026-08-07' OR to_date > '2026-08-07'`).n;
check('and nobody takes over on a date that has not happened', future, 0);

const gaps = one<{ n: number }>(
  `SELECT COUNT(*) n FROM scheme_manager a JOIN scheme_manager b
     ON b.fk_scheme_id = a.fk_scheme_id AND b.from_date > a.from_date
   WHERE a.to_date IS NOT NULL AND b.from_date != a.to_date`).n;
check('a handover has no gap and no overlap — one manager at a time', gaps, 0);

/* ── the handover is an event, not a footnote ─────────────────────────────── */

const changed = held.map(h => ({ h, hv: handovers(h.scheme_id) })).filter(x => x.hv.length > 0);
assert('at least one fund the client holds has changed hands', changed.length > 0,
  'nothing in the seed exercises the manager-change story');
for (const { h, hv } of changed) {
  for (const one_ of hv) {
    check(`${h.fund_name}'s handover has a dated event behind it`,
      one<{ n: number }>(
        `SELECT COUNT(*) n FROM events WHERE subject_type = 'scheme' AND subject_id = ?
         AND event_type = 'fund_manager_changed' AND occurred_at = ?`, String(h.scheme_id), one_.on).n, 1);
    assert(`${h.fund_name}'s handover names both people`, one_.from_name !== one_.to_name);
    assert(`and says how long ago it was`, one_.months_ago >= 0 && one_.months_ago < 600);
  }
}

/* ── the style box today is recomputable from what the fund actually holds ── */

for (const h of held) {
  const pts = styleHistory(h.scheme_id);
  if (!pts.length) continue;
  const today = pts[pts.length - 1];
  check(`${h.fund_name}'s current style box is marked as computed`, today.source, 'computed');
  assert(`${h.fund_name}'s earlier style points are marked as stand-ins`,
    pts.slice(0, -1).every(p => p.source === 'seeded'),
    'a seeded history rendering as measured is the exact failure this column exists to prevent');

  // Recomputed here, from the holdings and the per-stock scores, without calling
  // the function under test.
  const mine = one<{ size: number; value: number }>(
    `SELECT SUM(h.weight_pct * CASE s.cap_band WHEN 'Large' THEN 3 WHEN 'Mid' THEN 2 WHEN 'Small' THEN 1 END)
              / SUM(h.weight_pct) size,
            SUM(h.weight_pct * y.growth_score) / SUM(h.weight_pct) value
     FROM mf_scheme_holdings h
     JOIN stock_master s ON s.stock_id = h.stock_id
     JOIN stock_style y ON y.stock_id = h.stock_id
     WHERE h.fk_scheme_id = ? AND s.cap_band IS NOT NULL`, h.scheme_id);
  assert(`${h.fund_name}'s size axis matches its own holdings`,
    Math.abs(today.size_score - mine.size) < 0.02, `${today.size_score} vs ${mine.size}`);
  assert(`${h.fund_name}'s tilt matches the scores of the companies in it`,
    Math.abs(today.value_score - mine.value) < 0.02, `${today.value_score} vs ${mine.value}`);

  const d = drift(h.scheme_id);
  assert(`${h.fund_name} reports drift over its own history`, d != null);
  if (d) {
    check(`${h.fund_name}'s drift compares the oldest point to the newest`,
      [d.from.as_of, d.to.as_of], [pts[0].as_of, today.as_of]);
    if (d.says) {
      assert(`${h.fund_name}'s drift sentence only appears when something moved`,
        d.changed_box || Math.abs(d.value_move) >= 0.2 || Math.abs(d.size_move) >= 0.2);
    }
  }
}

/* ── risk: what was measured here, and what stood in ──────────────────────── */

for (const h of held) {
  const r = riskStats(h.scheme_id);
  assert(`${h.fund_name} has a risk record`, r != null);
  if (!r) continue;
  check(`${h.fund_name} measures over the stated window`, r.period_months, WINDOW_MONTHS);

  // The drawdown is claimed as measured, so it has to be re-derivable. Peak to
  // trough, walked forward — from the start would be a loss, not a drawdown.
  const navs = all<{ p: number }>(
    `SELECT price p FROM mf_historical_price_master WHERE fk_scheme_id = ?
     ORDER BY price_date DESC LIMIT ?`, h.scheme_id, WINDOW_MONTHS + 1).map(x => x.p).reverse();
  let peak = navs[0], worst = 0;
  for (const n of navs) { if (n > peak) peak = n; worst = Math.min(worst, n / peak - 1); }
  assert(`${h.fund_name}'s worst fall is really its worst peak-to-trough`,
    Math.abs(r.max_drawdown - worst * 100) < 0.02, `${r.max_drawdown} vs ${worst * 100}`);
  assert(`${h.fund_name}'s drawdown is a fall, never a gain`, r.max_drawdown <= 0);

  assert(`${h.fund_name}'s capture ratios are inside a band a real fund could be in`,
    r.downside_capture > 30 && r.downside_capture < 200
    && r.upside_capture > 30 && r.upside_capture < 200,
    `up ${r.upside_capture} down ${r.downside_capture}`);
  assert(`${h.fund_name} declares that its capture ratios were supplied, not measured`,
    r.capture_is_seeded,
    'the seed has no fund tracking its index, so a computed capture ratio here would be noise');
  assert(`${h.fund_name} stores the correlation that proves it`, r.correlation != null);
}

// The whole reason capture is seeded, asserted rather than asserted-in-a-comment.
const corr = all<{ c: number }>(`SELECT ABS(correlation) c FROM scheme_risk_stats WHERE correlation IS NOT NULL`);
const weak = corr.filter(x => x.c < 0.3).length;
assert('most schemes genuinely do not track their own index in this seed',
  weak > corr.length * 0.6,
  `only ${weak} of ${corr.length} are weakly correlated — if this has been fixed, capture can be computed`);

assert('every risk row states where its figures came from',
  one<{ n: number }>(`SELECT COUNT(*) n FROM scheme_risk_stats WHERE source IS NULL OR source = ''`).n === 0);

// Sharpe divides by the published rate, and says so.
const sample = held.map(h => riskStats(h.scheme_id)).find(r => r?.sharpe != null);
assert(`the risk-free rate the Sharpe ratio uses is published, not hidden`,
  RISK_FREE_PCT > 0 && sample != null);

/* ── overlap agrees with the number the portfolio page already prints ──────── */

const book = fundOverlap(ME);
for (const h of held) {
  const mine = overlapWith(ME, h.scheme_id);
  // Matched on the exact unordered pair of full names. Three of the client's
  // funds share a prefix, so a "starts with" match silently compares the wrong
  // two and reports a mismatch that is only in the test.
  const fullName = one<{ n: string }>(
    `SELECT scheme_full_name n FROM scheme_master WHERE scheme_id = ?`, h.scheme_id).n;
  for (const o of mine) {
    const pair = book.find(p =>
      (p.a === fullName && p.b === o.name) || (p.b === fullName && p.a === o.name));
    if (!pair) continue;
    assert(`${h.fund_name} × ${o.name.slice(0, 24)} overlaps by the same figure on both pages`,
      Math.abs(pair.shared_pct - o.shared_pct) < 0.05,
      `fund page ${o.shared_pct} vs portfolio ${pair.shared_pct}`);
  }
  // And the arithmetic itself, re-derived here.
  for (const o of mine) {
    const direct = one<{ v: number }>(
      `SELECT ROUND(SUM(MIN(a.weight_pct, b.weight_pct)), 1) v
       FROM mf_scheme_holdings a JOIN mf_scheme_holdings b
         ON b.fk_scheme_id = ? AND b.stock_id = a.stock_id
       WHERE a.fk_scheme_id = ?`, o.scheme_id, h.scheme_id).v;
    assert(`${h.fund_name} × ${o.name.slice(0, 24)} is the summed smaller weight, recomputed`,
      Math.abs(direct - o.shared_pct) < 0.05, `${o.shared_pct} vs ${direct}`);
  }
}

/* ── peers are ranked on arithmetic done here, not on a rating ─────────────── */

for (const h of held) {
  const p = peers(h.scheme_id);
  assert(`${h.fund_name} sits in a peer group`, p.rows.length > 0 && p.category != null);
  assert(`${h.fund_name} is always on its own peer list, however it ranks`,
    p.rows.some(x => x.is_this), 'a peer table a fund can fall off is a peer table that flatters');
  assert(`${h.fund_name}'s peers are ranked best first`,
    p.rows.every((x, i) => i === 0 || (x.ret_3y ?? -999) <= (p.rows[i - 1].ret_3y ?? -999)) || p.rank! >= p.rows.length,
    'out of order');

  const sameCat = one<{ n: number }>(
    `SELECT COUNT(*) n FROM scheme_master s
     WHERE s.fk_category_id = (SELECT fk_category_id FROM scheme_master WHERE scheme_id = ?)`, h.scheme_id).n;
  assert(`${h.fund_name}'s peer group never exceeds its category`, p.rows.length <= sameCat);
}

/* ── a recommendation is five parts, or it is not printed ─────────────────── */

let printed = 0;
for (const h of held) {
  for (const f of findings(ME, h.scheme_id)) {
    printed++;
    assert(`${h.fund_name} · ${f.key}: states the finding`, f.finding.length > 25);
    assert(`${h.fund_name} · ${f.key}: states the number under it`, f.number.length > 5);
    assert(`${h.fund_name} · ${f.key}: names an alternative`, f.alternative.length > 15);
    assert(`${h.fund_name} · ${f.key}: names the cost of doing nothing`, f.cost.length > 15);
    assert(`${h.fund_name} · ${f.key}: states how sure we are, and why`,
      ['high', 'medium', 'low'].includes(f.confidence) && f.why_confidence.length > 25);
    assert(`${h.fund_name} · ${f.key}: never names a single fund to buy`,
      !/\bbuy\b/i.test(f.alternative) || /manager|house list/i.test(f.alternative),
      'the answering layer ranks facts and hands off to a person; it does not sell');
  }
}
assert('the client sees at least one five-part finding across the funds held', printed > 0);

// A fund with a seeded capture ratio may not claim high confidence off it.
for (const h of held) {
  const r = riskStats(h.scheme_id);
  const f = findings(ME, h.scheme_id).find(x => x.key === 'downside');
  if (f && r?.capture_is_seeded) {
    check(`${h.fund_name}'s downside finding is low confidence while its capture is a stand-in`,
      f.confidence, 'low');
    assert(`and says the correlation is why`, f.why_confidence.includes('correlation'));
  }
}

/* ── nothing Morningstar-branded reaches the client yet ───────────────────── */

check('ratings are stored', one<{ n: number }>(`SELECT COUNT(*) n FROM scheme_rating`).n > 0, true);
check('and none of them is marked visible to a client',
  one<{ n: number }>(`SELECT COUNT(*) n FROM scheme_rating WHERE client_visible = 1`).n, 0);
check('the single gate on that stays shut until the licensing question is answered',
  ratingVisible(), false);

const commented = held.map(h => commentary(h.scheme_id)).filter(Boolean);
assert('a manager commentary that exists is marked as supplied',
  commented.every(c => c!.source === 'seeded'));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
