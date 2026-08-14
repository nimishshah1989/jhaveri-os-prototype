import { db } from './db';
import { TODAY } from '../mockdb/engines';
import type { Figure } from './queries';
import { outlooks, GOAL_RULES, type Outlook } from './goals';

// My book — Client 360's lens with the client filter taken off.
//
// Everything here answers "what is the money in", not "who owns it": that second
// question is what /clients already does, and duplicating it would give a broker
// two screens that disagree. The one number that governs the whole page is
// coverage — a fund only discloses stock holdings if it holds stocks, so debt,
// gold and liquid money can never be looked through. Every percentage below is
// therefore a statement about the covered part, and the page says so rather than
// quietly rebasing to the whole book.
//
// Scale: 53 clients, 48 schemes, ~3,900 disclosed holding rows. Aggregation is in
// SQL, not in TypeScript (data-engineering rule); nothing here loads a table to
// group it in memory.

export interface BookHeader {
  aum: number;
  clients: number;
  schemes: number;
  folios: number;
  as_of: string;
}

export function bookHeader(code: string): Figure<BookHeader> {
  const sql = `SELECT COALESCE(SUM(present_market_value),0) aum,
      COUNT(DISTINCT client_id) clients, COUNT(DISTINCT scheme_id) schemes,
      COUNT(DISTINCT folio_no) folios, MAX(holding_date) as_of
    FROM fifo_summary_holding_active WHERE advisor_code=? AND balance_units > 0.0001`;
  return {
    value: db().prepare(sql).get(code) as BookHeader,
    tag: 'computed', sql,
    sources: ['fifo_summary_holding_active.present_market_value', '.client_id', '.scheme_id'],
  };
}

export interface Slice {
  label: string;
  /** The asset class this slice belongs to, so a category can be coloured by what
   *  it actually is. On an asset-class slice it is the label itself. */
  asset: string;
  v: number;
  funds: number;
  clients: number;
  pct: number;
}

/** One grouping, two columns — asset class and fund category read identically. */
function sliceBy(column: 'asset_name' | 'fund_category', code: string): Figure<Slice[]> {
  const sql = `SELECT ${column} label, MAX(asset_name) asset, SUM(present_market_value) v,
      COUNT(DISTINCT scheme_id) funds, COUNT(DISTINCT client_id) clients
    FROM fifo_summary_holding_active WHERE advisor_code=? AND balance_units > 0.0001
    GROUP BY ${column} ORDER BY v DESC`;
  const rows = db().prepare(sql).all(code) as Omit<Slice, 'pct'>[];
  const total = rows.reduce((s, r) => s + r.v, 0);
  // Largest remainder, so the shares on screen add to exactly 100. Rounding each
  // share on its own drifts with the number of slices — it read 100.0% at eleven
  // categories and 99.8% at twelve, and a pie whose labels sum to 99.8% looks
  // broken to the person reading it whatever the underlying rupees say.
  const exact = rows.map(r => (total > 0 ? (r.v / total) * 1000 : 0));
  const floors = exact.map(Math.floor);
  let left = 1000 - floors.reduce((s, n) => s + n, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - floors[i] }))
    .sort((a, b) => b.frac - a.frac);
  const tenths = [...floors];
  for (const o of order) {
    if (left <= 0) break;
    tenths[o.i] += 1;
    left -= 1;
  }
  return {
    value: rows.map((r, i) => ({ ...r, pct: total > 0 ? tenths[i] / 10 : 0 })),
    tag: 'computed', sql,
    sources: [`fifo_summary_holding_active.${column}`, '.present_market_value'],
  };
}

/** Equity · Debt · Hybrid · Commodities, across every client at once. */
export function bookAssetMix(code: string): Figure<Slice[]> {
  return sliceBy('asset_name', code);
}

/** The SEBI category the money actually sits in — where hybrids become visible. */
export function bookCategoryMix(code: string): Figure<Slice[]> {
  return sliceBy('fund_category', code);
}

export interface SectorClient {
  client_id: number;
  name: string;
  rupees: number;
  portfolio: number;
  pct_of_theirs: number;
}

/**
 * Who is actually carrying a sector. This is the difference between a factsheet
 * and a call list: a book that is 19% Banking says nothing about which client to
 * ring, because the exposure is never spread evenly.
 */
export function sectorClients(code: string, sector: string): Figure<SectorClient[]> {
  const sql = `SELECT f.client_id, MAX(f.client_name) name,
      SUM(h.weight_pct/100.0 * f.present_market_value) rupees,
      (SELECT SUM(x.present_market_value) FROM fifo_summary_holding_active x
        WHERE x.client_id = f.client_id) portfolio
    FROM fifo_summary_holding_active f
    JOIN mf_scheme_holdings h ON h.fk_scheme_id = f.scheme_id
    JOIN stock_master s ON s.stock_id = h.stock_id
    WHERE f.advisor_code = ? AND s.sector = ?
    GROUP BY f.client_id ORDER BY rupees DESC`;
  const rows = db().prepare(sql).all(code, sector) as Omit<SectorClient, 'pct_of_theirs'>[];
  return {
    value: rows.map(r => ({
      ...r,
      pct_of_theirs: r.portfolio > 0 ? Math.round((r.rupees / r.portfolio) * 1000) / 10 : 0,
    })),
    tag: 'computed', sql,
    sources: ['mf_scheme_holdings.weight_pct', 'stock_master.sector', 'fifo_summary_holding_active.present_market_value'],
  };
}

export interface BookFund {
  scheme_id: number;
  fund: string;
  category: string;
  asset: string;
  v: number;
  clients: number;
  folios: number;
  ret1y: number | null;
  cat_avg_1y: number | null;
}

/**
 * Every fund the book holds, with its own year against its category's average.
 * The comparison is the point — a fund can be the biggest line in the book and
 * still be the worst thing in its category, and only the second column says so.
 */
export function bookFunds(code: string): Figure<BookFund[]> {
  const sql = `WITH latest AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id=h.fk_scheme_id)),
    yearago AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master
        WHERE fk_scheme_id=h.fk_scheme_id AND price_date <= date('${TODAY}','-12 months'))),
    ret AS (SELECT l.s scheme_id, (l.price/y.price - 1)*100 r1y FROM latest l JOIN yearago y ON y.s=l.s),
    catavg AS (SELECT sm.fk_category_id cid, AVG(ret.r1y) avg1y FROM scheme_master sm
      JOIN ret ON ret.scheme_id=sm.scheme_id GROUP BY sm.fk_category_id)
    SELECT f.scheme_id, MAX(f.fund_name) fund, MAX(f.fund_category) category, MAX(f.asset_name) asset,
      SUM(f.present_market_value) v, COUNT(DISTINCT f.client_id) clients, COUNT(DISTINCT f.folio_no) folios,
      ROUND((SELECT r1y FROM ret WHERE ret.scheme_id=f.scheme_id),1) ret1y,
      ROUND((SELECT avg1y FROM catavg JOIN scheme_master s2 ON s2.fk_category_id=catavg.cid
             WHERE s2.scheme_id=f.scheme_id LIMIT 1),1) cat_avg_1y
    FROM fifo_summary_holding_active f
    WHERE f.advisor_code=? AND f.balance_units > 0.0001
    GROUP BY f.scheme_id ORDER BY v DESC`;
  return {
    value: db().prepare(sql).all(code) as BookFund[],
    tag: 'computed', sql,
    sources: ['fifo_summary_holding_active.present_market_value', 'mf_historical_price_master.price', 'scheme_master.fk_category_id'],
  };
}

export interface CategoryStanding {
  category: string;
  asset: string;
  v: number;
  funds: number;
  book_1y: number | null;
  cat_avg_1y: number | null;
}

/**
 * How each category earned for the book, value-weighted across the funds actually
 * held — not the simple average of the funds, which would let a ₹20,000 position
 * argue as loudly as a ₹20 lakh one.
 */
export function categoryStanding(code: string): Figure<CategoryStanding[]> {
  const funds = bookFunds(code).value;
  const byCat = new Map<string, CategoryStanding & { weighted: number; weight: number }>();
  for (const f of funds) {
    const row = byCat.get(f.category) ?? {
      category: f.category, asset: f.asset, v: 0, funds: 0,
      book_1y: null, cat_avg_1y: f.cat_avg_1y, weighted: 0, weight: 0,
    };
    row.v += f.v;
    row.funds += 1;
    // A fund with no year of NAV history is excluded from both sides of the
    // weighting rather than counted as zero (financial-domain rule).
    if (f.ret1y !== null) {
      row.weighted += f.ret1y * f.v;
      row.weight += f.v;
    }
    byCat.set(f.category, row);
  }
  const value = [...byCat.values()]
    .map(r => ({
      category: r.category, asset: r.asset, v: r.v, funds: r.funds,
      book_1y: r.weight > 0 ? Math.round((r.weighted / r.weight) * 10) / 10 : null,
      cat_avg_1y: r.cat_avg_1y,
    }))
    .sort((a, b) => b.v - a.v);
  return {
    value, tag: 'computed',
    sql: 'bookFunds(), then value-weighted 1-year return per category; funds with no full year excluded from both sides',
    sources: ['mf_historical_price_master.price', 'fifo_summary_holding_active.present_market_value'],
  };
}

// ── Goals, at the level the broker works at ─────────────────────────────────
// The client lens has answered "am I going to get there" since goals-v1. The
// broker could not see a single goal anywhere — not on Client 360 before a review
// call, and not across the book. These two functions are the same projection the
// client sees, read from the other side of the table, so a broker and his client
// can never be looking at two different arrival dates.

export interface BookGoal extends Outlook {
  client_id: number;
  client: string;
}

/** Every goal the broker's clients have named, worst first. */
export function bookGoals(code: string): Figure<BookGoal[]> {
  const clients = db().prepare(
    `SELECT DISTINCT f.client_id id, MAX(f.client_name) name
       FROM fifo_summary_holding_active f
      WHERE f.advisor_code = ? AND f.balance_units > 0.0001
      GROUP BY f.client_id`,
  ).all(code) as { id: number; name: string }[];

  const value = clients
    .flatMap(c => outlooks(c.id).map(o => ({ ...o, client_id: c.id, client: c.name })))
    // Late first, and the latest of those first — a goal that is behind is the
    // only kind that needs a conversation. Reached ones sort to the bottom.
    .sort((a, b) => {
      const rank = (g: BookGoal) => (g.met ? 2 : g.monthsOff == null ? -1 : g.monthsOff > 0 ? 0 : 1);
      return rank(a) - rank(b) || (b.monthsOff ?? 0) - (a.monthsOff ?? 0);
    });

  return {
    value, tag: 'rule',
    sql: `client_goals × the money tagged to each, projected at the published rate — ${GOAL_RULES.version}`,
    sources: ['client_goals.target_amount', '.target_date', 'transaction_master.fk_goal_id', 'GOAL_RULES.rates'],
  };
}

export interface GoalCoverage {
  clients: number;
  named: number;
  silent: number;
  /** Money sitting behind a named goal, and money that is not. */
  spokenFor: number;
  adrift: number;
  late: number;
  onTrack: number;
  reached: number;
  unreachable: number;
  /** Goals named with nothing tagged to them yet. */
  unfunded: number;
}

/**
 * The book's answer to "what is this money for". `silent` is the number worth
 * putting first: a client who has never named a goal is not a data gap, it is the
 * conversation that has not happened yet, and it is the one the broker can act on.
 */
export function goalCoverage(code: string): Figure<GoalCoverage> {
  const all = bookGoals(code).value;
  const clients = db().prepare(
    `SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active
      WHERE advisor_code = ? AND balance_units > 0.0001`,
  ).get(code) as { n: number };
  const named = new Set(all.map(g => g.client_id));
  const spokenFor = all.reduce((s, g) => s + g.now, 0);
  const book = bookHeader(code).value.aum;

  return {
    value: {
      clients: clients.n,
      named: named.size,
      silent: clients.n - named.size,
      spokenFor,
      adrift: Math.max(0, book - spokenFor),
      late: all.filter(g => !g.met && g.monthsOff != null && g.monthsOff > 0).length,
      onTrack: all.filter(g => !g.met && g.monthsOff != null && g.monthsOff <= 0).length,
      reached: all.filter(g => g.met).length,
      unreachable: all.filter(g => !g.met && g.monthsOff == null).length,
      unfunded: all.filter(g => g.schemes === 0).length,
    },
    tag: 'rule',
    sql: 'bookGoals() folded by state, against every client holding units',
    sources: ['client_goals', 'fifo_summary_holding_active.present_market_value'],
  };
}
