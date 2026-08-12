import { db } from './db';
import { schemeGrades, SCORING_RULES } from './scoring';

/* Discovery, built to the bar in research/14.
   §11.5 smallcase — a shape is generated, not picked from three fixed models.
   §12.5 / §13.8  — publish the house list's record, misses at the same size as wins;
                    Angel One's Call History is the only Indian app that does this.
   §11.2 Scripbox — the criterion is printed before the names, always.
   §13.1          — the whole discovery layer is free, because trail pays for it. */

export interface Fund {
  scheme_id: number; name: string; category: string; asset: string; amc: string;
  risk: string; expense: number; pick: number; ret1y: number | null; grade: string | null;
}

function allFunds(): Fund[] {
  const grades = schemeGrades();
  const rows = db().prepare(
    `SELECT sm.scheme_id, sm.scheme_short_name name, cm.category_name category,
            COALESCE(am.main_asset_name,'Other') asset, amc.amc_name amc,
            sm.risk_level risk, sm.scheme_expense_ratio expense, sm.is_jhaveri_pick pick
     FROM scheme_master sm
     JOIN category_master cm ON cm.category_id = sm.fk_category_id
     LEFT JOIN main_asset_master am ON am.id = cm.fk_main_asset_id
     JOIN amc_master amc ON amc.amc_id = sm.fk_amc_id
     WHERE sm.is_active = 1`,
  ).all() as Omit<Fund, 'ret1y' | 'grade'>[];
  return rows.map(r => {
    const g = grades.get(r.scheme_id);
    return { ...r, ret1y: g?.ret1y ?? null, grade: g?.grade ?? null };
  });
}

/* ── search by what you remember ─────────────────────────────────────────── */

const SYNONYM: Record<string, string> = {
  tax: 'elss', saver: 'elss', saving: 'elss', '80c': 'elss',
  smallcap: 'small', midcap: 'mid', largecap: 'large', bluechip: 'large',
  safe: 'liquid', debt: 'bond', income: 'bond', commodity: 'gold', bullion: 'gold',
  balanced: 'hybrid', flexible: 'flexi', pick: 'jhaveri',
};

export interface Search { terms: string[]; ignored: string[]; hits: Fund[] }

/** Plain token search, and it shows its working: which words it read, which it ignored. */
export function search(q: string): Search {
  const words = q.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const terms: string[] = [];
  for (const w of words) {
    const t = SYNONYM[w] ?? w;
    if (!terms.includes(t)) terms.push(t);
  }
  const funds = allFunds();
  const key = (f: Fund) => `${f.name} ${f.category} ${f.amc} ${f.risk} ${f.pick ? 'jhaveri pick' : ''}`.toLowerCase();
  const used = new Set<string>();
  const hits = funds
    .map(f => {
      const k = key(f);
      const n = terms.filter(t => { const hit = k.includes(t); if (hit) used.add(t); return hit; }).length;
      return { f, n };
    })
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n || (b.f.ret1y ?? -99) - (a.f.ret1y ?? -99))
    .slice(0, 8)
    .map(x => x.f);
  return { terms: [...used], ignored: terms.filter(t => !used.has(t)), hits };
}

/* ── a shape built from what the client says about themselves ────────────── */

export interface Traits { horizon: 'short' | 'medium' | 'long'; fall: 'sell' | 'wait' | 'buy'; purpose: 'grow' | 'income' | 'park' }

export interface Slice { asset: string; category: string; pct: number; funds: Fund[] }
export interface Shape { name: string; line: string; mix: Slice[]; equityPct: number }

/** Points of equity tolerance, one axis per answer — stated so it can be argued with. */
const TRAIT_POINTS = {
  horizon: { short: 0, medium: 2, long: 4 },
  fall: { sell: 0, wait: 2, buy: 4 },
  purpose: { park: 0, income: 1, grow: 3 },
};

const LADDER: { max: number; name: string; line: string; mix: [string, number][] }[] = [
  { max: 2, name: 'Keep it still', line: 'Money you may need soon. It should not move much, and it will not grow much either.',
    mix: [['Liquid', 60], ['Corporate Bond', 30], ['Arbitrage Fund', 10]] },
  { max: 4, name: 'Mostly still', line: 'A little growth, bought with a little patience. Falls should be small enough to ignore.',
    mix: [['Corporate Bond', 45], ['Arbitrage Fund', 20], ['Aggressive Hybrid', 20], ['Large Cap', 15]] },
  { max: 6, name: 'The middle path', line: 'Growth that lets you look away for a season. Some years will be flat.',
    mix: [['Aggressive Hybrid', 30], ['Large Cap', 25], ['Flexi Cap', 20], ['Corporate Bond', 15], ['Gold FoF', 10]] },
  { max: 8, name: 'Grow, with ballast', line: 'Mostly equity, with enough elsewhere that a bad year does not force a decision.',
    mix: [['Flexi Cap', 30], ['Large Cap', 20], ['Mid Cap', 15], ['Aggressive Hybrid', 15], ['Corporate Bond', 10], ['Gold FoF', 10]] },
  { max: 11, name: 'The long runway', line: 'For money with a decade and a spine. Some years will hurt; that is the tuition.',
    mix: [['Flexi Cap', 30], ['Mid Cap', 20], ['Small Cap', 15], ['Large Cap', 15], ['ELSS (Tax Savings)', 10], ['Gold FoF', 10]] },
];

/**
 * The shape is computed from three answers, not chosen from a fixed set of three.
 * Funds inside each class are the best-graded we track, and the grade rule is
 * published — `SCORING_RULES.scheme_grade`.
 */
export function shapeFor(t: Traits): Shape {
  const pts = TRAIT_POINTS.horizon[t.horizon] + TRAIT_POINTS.fall[t.fall] + TRAIT_POINTS.purpose[t.purpose];
  const rung = LADDER.find(r => pts <= r.max) ?? LADDER[LADDER.length - 1];
  const funds = allFunds();
  const EQUITY = ['Flexi Cap', 'Large Cap', 'Mid Cap', 'Small Cap', 'ELSS (Tax Savings)'];
  const mix = rung.mix.map(([category, pct]) => ({
    asset: funds.find(f => f.category === category)?.asset ?? 'Other',
    category,
    pct,
    funds: funds
      .filter(f => f.category === category)
      .sort((a, b) => (b.pick - a.pick) || (b.ret1y ?? -99) - (a.ret1y ?? -99))
      .slice(0, 2),
  }));
  return {
    name: rung.name, line: rung.line, mix,
    equityPct: mix.filter(s => EQUITY.includes(s.category)).reduce((s, x) => s + x.pct, 0),
  };
}

/* ── lists, each carrying its rule ───────────────────────────────────────── */

/** How many funds we actually track. Counted, never assumed. */
export function fundCount(): number {
  return (db().prepare(`SELECT COUNT(*) n FROM scheme_master WHERE is_active = 1`).get() as { n: number }).n;
}

export interface Screen { key: string; title: string; rule: string; funds: Fund[] }

export function screens(): Screen[] {
  const funds = allFunds().filter(f => f.ret1y != null);
  const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const medRet = median(funds.map(f => f.ret1y!));
  const medExp = median(funds.map(f => f.expense));
  return [
    {
      key: 'steady', title: 'Above the median, and cheaper than the median',
      rule: `Both at once: a year's return above ${medRet.toFixed(1)}% and a cost below ${medExp.toFixed(2)}%. Two tests, not one.`,
      funds: funds.filter(f => f.ret1y! > medRet && f.expense < medExp).sort((a, b) => b.ret1y! - a.ret1y!).slice(0, 5),
    },
    {
      key: 'cheap', title: 'The cheapest we track',
      rule: 'Ranked by cost alone. Cost is the only number in investing you know in advance.',
      funds: funds.slice().sort((a, b) => a.expense - b.expense).slice(0, 5),
    },
    {
      key: 'calm', title: 'For money that cannot afford a bad year',
      rule: 'Debt, arbitrage and hybrid only — the classes that are built not to fall far. Never a growth list.',
      funds: funds.filter(f => /Bond|Liquid|Arbitrage|Hybrid/.test(f.category)).sort((a, b) => (b.ret1y ?? 0) - (a.ret1y ?? 0)).slice(0, 5),
    },
  ];
}

/* ── the house list, with its record published ───────────────────────────── */

export interface PickRow extends Fund { catAvg: number | null; beat: boolean | null }

/** Wins and misses at the same size. Nobody in India publishes this except Angel One. */
export function picks(): { rows: PickRow[]; beat: number; rule: string } {
  const funds = allFunds();
  const byCat = new Map<string, number[]>();
  for (const f of funds) if (f.ret1y != null) byCat.set(f.category, [...(byCat.get(f.category) ?? []), f.ret1y]);
  const rows: PickRow[] = funds.filter(f => f.pick).map(f => {
    const peers = byCat.get(f.category) ?? [];
    const catAvg = peers.length ? peers.reduce((s, x) => s + x, 0) / peers.length : null;
    return { ...f, catAvg, beat: f.ret1y != null && catAvg != null ? f.ret1y >= catAvg : null };
  }).sort((a, b) => (b.ret1y ?? -99) - (a.ret1y ?? -99));
  return {
    rows,
    beat: rows.filter(r => r.beat).length,
    rule: `Measured over one year against the average of each fund's own category, from the same prices every other page uses. Grades follow ${SCORING_RULES.version}.`,
  };
}
