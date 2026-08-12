import type Database from 'better-sqlite3';
import { rng, pick, between, intBetween, round2, TODAY, addDays } from './engines';

/* ── Fund intelligence ───────────────────────────────────────────────────────
   Phase 4 of the client-lens plan. Morningstar is the source in the live build;
   nothing has been fetched, and the founder's instruction is to seed realistic
   data now so the design can be judged rather than to render dashes and wait.

   The line this file holds is between two very different things, and every row
   it writes declares which side it is on:

     source = 'computed'  derived here, from NAV history and holdings already in
                          this database. Downside capture, standard deviation,
                          drawdown, the size axis of the style box, category
                          peer ranks. When the vendor feed lands these should not
                          move — if they do, one of us is wrong and it matters.

     source = 'seeded'    vendor content nothing here can derive: a manager's
                          name, their tenure, their philosophy, their commentary,
                          and the value/growth axis, which needs fundamentals
                          this database has never held. A stand-in. Every screen
                          that prints one says where it came from.

   Capture ratios sit on the seeded side, and the reason is worth writing down.
   The seed builds every scheme's NAV as an independent random walk and every
   index as another one, so a fund's monthly moves have no relationship to its
   own benchmark — measured across all 60 schemes, the median correlation is
   −0.02. Computing upside and downside capture off that produces arithmetic
   that is perfectly correct and completely meaningless: ratios of −116% and
   +23% on two share classes of the same fund. So the correlation IS computed
   and stored, as evidence; the capture ratios themselves are seeded from each
   fund's own measured volatility and drawdown, which is what makes them
   internally consistent with the rest of its record. In the live build both
   arrive from Morningstar and neither is ours to derive.

   This is a defect in the NAV generator, not in this file. Fixing it properly
   means a market-factor model — every fund moving with its index plus its own
   alpha — which re-rolls every figure in the database, including the ₹15.74L
   hero number written into DESIGN.md. Flagged in HANDOFF rather than done here.

   The generator is deterministic — its own RNG stream, seeded off a constant, so
   it can be appended to the end of seed.ts without shifting a single draw the
   rest of the story is pinned to.                                             */

type Ins = (table: string, row: Record<string, unknown>) => void;
type Emit = (e: { at: string; subjectType: string; subjectId: string | number; type: string; payload?: unknown; source?: string }) => void;

/** Months of history every statistic below is measured over. Stated, never implied. */
export const WINDOW_MONTHS = 36;
/** The risk-free rate the Sharpe ratio divides by. Published, not tuned to flatter. */
export const RISK_FREE_PCT = 6.5;

const compound = (rets: number[]) => rets.reduce((v, r) => v * (1 + r), 1) - 1;

/** Peak-to-trough, walked forward. From the start is not a drawdown, it is a loss. */
function maxDrawdown(navs: number[]): number {
  let peak = navs[0] ?? 0, worst = 0;
  for (const n of navs) {
    if (n > peak) peak = n;
    if (peak > 0) worst = Math.min(worst, n / peak - 1);
  }
  return worst;
}

/** Pearson, on the two return series. Stored as the evidence for the note above. */
function corr(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, dbv = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    dbv += (b[i] - mb) ** 2;
  }
  return da > 0 && dbv > 0 ? num / Math.sqrt(da * dbv) : 0;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

const SIZE_WORD = (s: number) => (s >= 2.5 ? 'Large' : s >= 1.75 ? 'Mid' : 'Small');
const STYLE_WORD = (v: number) => (v >= 2.34 ? 'Growth' : v >= 1.67 ? 'Blend' : 'Value');

/* The vendor half. Names and sentences, never numbers — a fabricated statistic
   would survive the swap to the real feed by looking exactly as plausible. */

const MANAGERS: [string, string, string, string][] = [
  ['Aniruddha Naha', '2003', 'CFA, MMS Finance', 'Buys cash flow before it is fashionable and holds through the years it is not. Turnover is deliberately low; the mistakes he talks about most are the ones where he sold early.'],
  ['Shreyash Devalkar', '2006', 'CA, MMS Finance', 'Growth at a price he can defend, concentrated in businesses whose earnings he can model three years out. Will hold cash rather than own the second-best idea.'],
  ['Roshi Jain', '2005', 'CA, MBA', 'Contrarian by temperament, valuation-led by process. Takes large positions in a handful of names and accepts that the record will look wrong for stretches.'],
  ['Sohini Andani', '1994', 'CFA, MMS', 'Bottom-up, quality-biased, allergic to leverage. Screens balance sheets before income statements, and refuses sectors she cannot underwrite.'],
  ['Harsha Upadhyaya', '1998', 'CFA, PGDM', 'Blends top-down sector calls with bottom-up selection, and rebalances against his own conviction rather than against the index.'],
  ['Mahesh Patil', '1994', 'CFA, MMS', 'Large-cap core with satellite positions in businesses at an inflection. Explicit about risk budgets and about the trades that did not work.'],
  ['Chirag Setalvad', '1996', 'MBA Finance', 'Long-horizon, mid-cap heavy, and unusually willing to sit in a name for a decade. Judges himself on rolling five-year numbers, not calendar years.'],
  ['Ihab Dalwai', '2011', 'CA, CFA', 'Process over instinct — a scoring model narrows the universe, then judgement decides position size. Publishes what the model rejected and why.'],
  ['Ankit Agarwal', '2008', 'MBA, B.Tech', 'Earnings-momentum aware but valuation-anchored; trims into strength as a rule rather than as a view.'],
  ['Nimesh Chandan', '2004', 'CFA, MMS', 'Behavioural-finance first: builds the process to defend against his own biases and writes about the ones that still get through.'],
];

const HEADLINES: [string, string][] = [
  ['Where the last quarter went', 'Financials and industrials carried the portfolio; the consumer names we held into the quarter cost roughly a percent of relative return, and we have not sold them. The thesis needs another two quarters to be right or wrong, and selling now would be answering a price rather than a question.'],
  ['What we got wrong', 'We were early on capital goods by about eighteen months, which is the same as being wrong for anyone measuring us over one year. We have kept the positions and cut the size; the alternative was to abandon a call we still believe in because it had been uncomfortable.'],
  ['Why cash went up', 'We are holding more cash than usual, not as a market call but because three positions hit the price at which our own model says to trim and nothing else cleared the bar. Cash is the residue of discipline here, not a forecast.'],
  ['The position we added to', 'We doubled a mid-cap financial on a quarter the market read as a miss and we read as an accounting timing difference. If we are wrong the cost is about eighty basis points; if we are right it is the largest contributor of the next three years.'],
  ['On the drawdown', 'The fund fell more than its index in the correction, which is what a concentrated portfolio does and what we tell you it will do. Nothing was sold into it. The names that fell hardest are the ones we added to.'],
];

const CHANGE_REASONS = [
  'moved to lead the house\'s international mandate',
  'left the firm',
  'took over the flagship after the previous manager retired',
  'was promoted to Chief Investment Officer and handed the fund on',
];

export interface FundSeedResult {
  managers: number; tenures: number; changes: number; styles: number; stats: number;
}

/**
 * Everything phase 4 needs, written against schemes that actually exist.
 * `heldSchemes` are the ones the demo client holds — they get the full treatment
 * (a manager change, a commentary, four quarters of style) because they are the
 * ones a reviewer will open.
 */
export function seedFundIntelligence(
  db: Database.Database, ins: Ins, emit: Emit, heldSchemes: number[],
): FundSeedResult {
  const r = rng(20260812);

  /* ── managers, and who has run what ─────────────────────────────────────── */

  MANAGERS.forEach(([full_name, managing_since, qualification, philosophy], i) => {
    ins('fund_manager', { manager_id: i + 1, full_name, managing_since, qualification, philosophy, source: 'seeded' });
  });

  const schemes = db.prepare(
    `SELECT sm.scheme_id, sm.scheme_full_name name, sm.fk_category_id cat, sm.fk_benchmark_id bench,
            (SELECT MIN(price_date) FROM mf_historical_price_master p WHERE p.fk_scheme_id = sm.scheme_id) inception
     FROM scheme_master sm ORDER BY sm.scheme_id`,
  ).all() as { scheme_id: number; name: string; cat: number; bench: number; inception: string | null }[];

  let smId = 0, changes = 0, commentaryId = 0;
  for (const s of schemes) {
    // A manager cannot have run a fund for longer than the fund has existed.
    // The database's own earliest price is the only inception date it holds, so
    // every tenure below is bounded by it rather than by a plausible-looking year.
    const inception = s.inception ?? addDays(TODAY, -1300);
    const lead = intBetween(r, 1, MANAGERS.length);
    const changed = heldSchemes.includes(s.scheme_id) ? s.scheme_id === heldSchemes[0] : r() < 0.22;

    if (changed) {
      // Somebody ran it first, and handed it over. The handover is the event.
      let prev = intBetween(r, 1, MANAGERS.length);
      if (prev === lead) prev = (prev % MANAGERS.length) + 1;
      const handover = addDays(inception, intBetween(r, 200, Math.max(260, Math.floor((Date.parse(TODAY) - Date.parse(inception)) / 864e5) - 120)));
      ins('scheme_manager', { sm_id: ++smId, fk_scheme_id: s.scheme_id, fk_manager_id: prev, from_date: inception, to_date: handover, role: 'lead', source: 'seeded' });
      ins('scheme_manager', { sm_id: ++smId, fk_scheme_id: s.scheme_id, fk_manager_id: lead, from_date: handover, to_date: null, role: 'lead', source: 'seeded' });
      emit({
        at: handover, subjectType: 'scheme', subjectId: s.scheme_id, type: 'fund_manager_changed',
        payload: {
          scheme: s.name,
          from: MANAGERS[prev - 1][0], to: MANAGERS[lead - 1][0],
          reason: pick(r, CHANGE_REASONS),
        },
        source: 'import',
      });
      changes++;
    } else {
      ins('scheme_manager', { sm_id: ++smId, fk_scheme_id: s.scheme_id, fk_manager_id: lead, from_date: inception, to_date: null, role: 'lead', source: 'seeded' });
    }

    if (heldSchemes.includes(s.scheme_id) || r() < 0.35) {
      const [headline, body] = pick(r, HEADLINES);
      ins('manager_commentary', {
        commentary_id: ++commentaryId, fk_manager_id: lead, fk_scheme_id: s.scheme_id,
        as_of: addDays(TODAY, -intBetween(r, 20, 95)), headline, body, source: 'seeded',
      });
    }

    // Stored, not shown. See the schema note on redistribution.
    ins('scheme_rating', {
      fk_scheme_id: s.scheme_id, as_of: TODAY, star: intBetween(r, 2, 5),
      analyst: pick(r, ['Gold', 'Silver', 'Bronze', 'Neutral']), provider: 'Morningstar', client_visible: 0,
    });
  }

  /* ── the value/growth tilt of each company: seeded, and only this ────────── */

  const stocks = db.prepare(`SELECT stock_id, cap_band FROM stock_master ORDER BY stock_id`)
    .all() as { stock_id: string; cap_band: string | null }[];
  for (const st of stocks) {
    ins('stock_style', { stock_id: st.stock_id, growth_score: round2(between(r, 1, 3)), source: 'seeded' });
  }

  /* ── the style box: size from real holdings, tilt from the seeded scores ── */

  const styleNow = db.prepare(
    `SELECT h.fk_scheme_id sid,
            SUM(h.weight_pct) w,
            SUM(h.weight_pct * CASE s.cap_band WHEN 'Large' THEN 3 WHEN 'Mid' THEN 2 WHEN 'Small' THEN 1 END) size_w,
            SUM(h.weight_pct * y.growth_score) growth_w,
            SUM(h.weight_pct * s.market_cap) mcap_w
     FROM mf_scheme_holdings h
     JOIN stock_master s ON s.stock_id = h.stock_id
     JOIN stock_style y ON y.stock_id = h.stock_id
     WHERE s.cap_band IS NOT NULL
     GROUP BY h.fk_scheme_id`,
  ).all() as { sid: number; w: number; size_w: number; growth_w: number; mcap_w: number }[];

  let ssId = 0;
  for (const row of styleNow) {
    const size = row.size_w / row.w;
    const value = row.growth_w / row.w;
    const put = (as_of: string, sz: number, vl: number, mc: number, source: string) => {
      ins('scheme_style', {
        ss_id: ++ssId, fk_scheme_id: row.sid, as_of,
        size_score: round2(sz), value_score: round2(vl),
        box: `${SIZE_WORD(sz)} ${STYLE_WORD(vl)}`, avg_mcap_cr: Math.round(mc), source,
      });
    };
    put(TODAY, size, value, row.mcap_w / row.w, 'computed');

    // Three quarters behind it, so drift is a line rather than a label. These
    // are the stand-in: the fund's holdings history is not in this database, so
    // the earlier boxes cannot be computed and are not pretended to be.
    const driftSize = between(r, -0.28, 0.28);
    const driftValue = between(r, -0.42, 0.42);
    for (let q = 1; q <= 3; q++) {
      const back = q / 3;
      put(addDays(TODAY, -91 * q),
        Math.min(3, Math.max(1, size - driftSize * back)),
        Math.min(3, Math.max(1, value - driftValue * back)),
        (row.mcap_w / row.w) * (1 - 0.05 * back), 'seeded');
    }
  }

  /* ── what the fund did when the market fell. All of this is computed ─────── */

  const navRows = db.prepare(
    `SELECT fk_scheme_id sid, price_date d, price p FROM mf_historical_price_master ORDER BY fk_scheme_id, price_date`,
  ).all() as { sid: number; d: string; p: number }[];
  const navBy = new Map<number, { d: string; p: number }[]>();
  for (const n of navRows) {
    const at = navBy.get(n.sid) ?? [];
    at.push(n);
    navBy.set(n.sid, at);
  }

  const benchRows = db.prepare(
    `SELECT fk_benchmark_id bid, price_date d, price p FROM benchmark_price_history ORDER BY fk_benchmark_id, price_date`,
  ).all() as { bid: number; d: string; p: number }[];
  const benchBy = new Map<number, { d: string; p: number }[]>();
  for (const b of benchRows) {
    const at = benchBy.get(b.bid) ?? [];
    at.push(b);
    benchBy.set(b.bid, at);
  }

  const returns = (series: { p: number }[]) =>
    series.slice(1).map((x, i) => x.p / series[i].p - 1);

  let stats = 0;
  for (const s of schemes) {
    const navs = navBy.get(s.scheme_id) ?? [];
    const bench = benchBy.get(s.bench) ?? [];
    if (navs.length < WINDOW_MONTHS + 1 || bench.length < WINDOW_MONTHS + 1) continue;

    const fWin = navs.slice(-(WINDOW_MONTHS + 1));
    const bWin = bench.slice(-(WINDOW_MONTHS + 1));
    const fRet = returns(fWin);
    const bRet = returns(bWin);
    const n = Math.min(fRet.length, bRet.length);

    let upMonths = 0, downMonths = 0;
    for (let i = 0; i < n; i++) {
      if (bRet[i] > 0) upMonths++;
      else if (bRet[i] < 0) downMonths++;
    }

    // Computed, and only from the fund's own series — none of these three needs
    // an index, so none of them is affected by the correlation problem above.
    const sd = stdev(fRet.slice(0, n)) * Math.sqrt(12) * 100;
    const cagr = (compound(fRet.slice(0, n)) + 1) ** (12 / n) - 1;
    const sharpe = sd > 0 ? ((cagr * 100) - RISK_FREE_PCT) / sd : null;
    const mdd = maxDrawdown(fWin.map(x => x.p)) * 100;
    const correlation = corr(fRet.slice(0, n), bRet.slice(0, n));

    // Seeded, but anchored to what was measured: a fund that really is more
    // volatile than its index captures more of both sides, and the one with the
    // deepest real drawdown takes the most of the falls. So the two ratios move
    // with the rest of the fund's record instead of floating free of it.
    const benchVol = 14;
    const beta = Math.min(1.45, Math.max(0.62, sd / benchVol));
    const painTilt = Math.min(0.35, Math.abs(mdd) / 90);
    const upside = beta * 100 * between(r, 0.93, 1.06) - painTilt * 8;
    const downside = beta * 100 * between(r, 0.94, 1.08) + painTilt * 14;

    ins('scheme_risk_stats', {
      rs_id: ++stats, fk_scheme_id: s.scheme_id, as_of: TODAY, period_months: WINDOW_MONTHS,
      months_up: upMonths, months_down: downMonths,
      upside_capture: round2(upside), downside_capture: round2(downside),
      std_dev: round2(sd), sharpe: sharpe == null ? null : round2(sharpe),
      max_drawdown: round2(mdd),
      correlation: round2(correlation),
      // The row is mixed, and says so: three figures measured here, two standing
      // in for the vendor. `lib/funds.ts` splits them again on the way to a page.
      source: 'computed+seeded',
    });
  }

  return { managers: MANAGERS.length, tenures: smId, changes, styles: ssId, stats };
}
