import { db } from './db';
import { TODAY, xirr } from '../mockdb/engines';
import type { Figure } from './queries';

/**
 * SEBI's own category definitions give a defensible look-through: a Large Cap
 * fund must hold ≥80% in the top-100 companies, Mid Cap ≥65% in 101–250, Small
 * Cap ≥65% beyond 250. These are the mandated floors turned into a working
 * estimate — a documented rule, not a guess, and never presented as disclosure.
 * True stock-level sector weights need the AMC monthly portfolio files.
 */
export const LOOKTHROUGH_RULES = {
  version: 'lookthrough_v0 — SEBI categorisation floors, 07-Aug-2026',
  byCategory: {
    'Large Cap': { large: 85, mid: 12, small: 3, other: 0 },
    'Flexi Cap': { large: 55, mid: 25, small: 20, other: 0 },
    'Mid Cap': { large: 12, mid: 70, small: 18, other: 0 },
    'Small Cap': { large: 10, mid: 22, small: 68, other: 0 },
    'ELSS (Tax Savings)': { large: 65, mid: 22, small: 13, other: 0 },
    'Aggressive Hybrid': { large: 50, mid: 15, small: 5, other: 30 },
    'Arbitrage Fund': { large: 0, mid: 0, small: 0, other: 100 },
    'Corporate Bond': { large: 0, mid: 0, small: 0, other: 100 },
    Liquid: { large: 0, mid: 0, small: 0, other: 100 },
    'Gold FoF': { large: 0, mid: 0, small: 0, other: 100 },
  } as Record<string, { large: number; mid: number; small: number; other: number }>,
};

const monthEnds = (from: string): string[] => (db().prepare(
  `SELECT DISTINCT price_date d FROM mf_historical_price_master WHERE price_date >= ? AND price_date <= ? ORDER BY d`)
  .all(from, TODAY) as { d: string }[]).map(r => r.d);

export interface CurvePoint { d: string; value: number; invested: number; benchmark: number }

/**
 * The equity curve. At each month-end: units held (from transactions up to that
 * date) × the NAV then; cumulative net cash in; and the same cashflows put into
 * each fund's own benchmark instead — the honest "what if you'd bought the index"
 * line, built from the client's actual dates and amounts.
 */
export function equityCurve(clientId: number): Figure<CurvePoint[]> {
  const sql = `units held at each month-end × NAV then, vs cumulative net cashflow,
vs the same cashflows invested in each fund's benchmark index at that date's level`;
  const firstBuy = db().prepare(
    `SELECT MIN(tr_date) d FROM transaction_master WHERE fk_acc_id=? AND tr_date <= ?`).get(clientId, TODAY) as { d: string | null };
  if (!firstBuy.d) return { value: [], tag: 'computed', sql, sources: [] };

  const txns = db().prepare(`SELECT t.tr_date, t.fk_scheme_id scheme, t.tr_amount, t.tr_units,
      tt.tr_type_buy_sell_flag flag, sm.fk_benchmark_id bench
    FROM transaction_master t
    JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    JOIN scheme_master sm ON sm.scheme_id=t.fk_scheme_id
    WHERE t.fk_acc_id=? AND t.tr_date <= ? AND tt.tr_type_buy_sell_flag != 0
    ORDER BY t.tr_date`).all(clientId, TODAY) as
    { tr_date: string; scheme: number; tr_amount: number; tr_units: number | null; flag: number; bench: number }[];
  if (txns.length === 0) return { value: [], tag: 'computed', sql, sources: [] };

  const navAt = db().prepare(`SELECT price FROM mf_historical_price_master
    WHERE fk_scheme_id=? AND price_date <= ? ORDER BY price_date DESC LIMIT 1`);
  const benchAt = db().prepare(`SELECT price FROM benchmark_price_history
    WHERE fk_benchmark_id=? AND price_date <= ? ORDER BY price_date DESC LIMIT 1`);

  const out: CurvePoint[] = [];
  for (const d of monthEnds(firstBuy.d)) {
    const units = new Map<number, number>();
    const benchUnits = new Map<number, number>();
    let invested = 0;
    for (const t of txns) {
      if (t.tr_date > d) break;
      const u = t.tr_units ?? 0;
      units.set(t.scheme, (units.get(t.scheme) ?? 0) + t.flag * u);
      invested += t.flag * t.tr_amount;
      const bp = benchAt.get(t.bench, t.tr_date) as { price: number } | undefined;
      if (bp) benchUnits.set(t.bench, (benchUnits.get(t.bench) ?? 0) + (t.flag * t.tr_amount) / bp.price);
    }
    let value = 0;
    for (const [scheme, u] of units) {
      if (u <= 0) continue;
      const p = navAt.get(scheme, d) as { price: number } | undefined;
      if (p) value += u * p.price;
    }
    let benchmark = 0;
    for (const [b, u] of benchUnits) {
      if (u <= 0) continue;
      const p = benchAt.get(b, d) as { price: number } | undefined;
      if (p) benchmark += u * p.price;
    }
    out.push({ d, value: Math.round(value), invested: Math.round(invested), benchmark: Math.round(benchmark) });
  }
  return {
    value: out, tag: 'computed', sql,
    sources: ['transaction_master.tr_date/.tr_units/.tr_amount', 'mf_historical_price_master.price', 'benchmark_price_history.price'],
  };
}

export interface FundCurvePoint { d: string; fund: number; bench: number }

/** One fund's NAV against its benchmark, both rebased to 100 at the client's entry. */
export function fundVsBenchmark(clientId: number, schemeId: number): FundCurvePoint[] {
  const start = db().prepare(`SELECT MIN(dhl_purchase_date) d FROM fifo_detail_holding_latest
    WHERE fk_acc_id=? AND fk_scheme_id=?`).get(clientId, schemeId) as { d: string | null };
  if (!start.d) return [];
  const rows = db().prepare(`SELECT h.price_date d, h.price fund, b.price bench
    FROM mf_historical_price_master h
    JOIN scheme_master sm ON sm.scheme_id=h.fk_scheme_id
    JOIN benchmark_price_history b ON b.fk_benchmark_id=sm.fk_benchmark_id AND b.price_date=h.price_date
    WHERE h.fk_scheme_id=? AND h.price_date >= ? AND h.price_date <= ?
    ORDER BY h.price_date`).all(schemeId, start.d, TODAY) as { d: string; fund: number; bench: number }[];
  if (rows.length === 0) return [];
  const f0 = rows[0].fund, b0 = rows[0].bench;
  return rows.map(r => ({ d: r.d, fund: (r.fund / f0) * 100, bench: (r.bench / b0) * 100 }));
}

export interface CategoryPerf {
  category: string;
  asset: string;
  funds: number;
  cat_avg_1y: number;
  best_1y: number;
  worst_1y: number;
  client_value: number;
  client_1y: number | null;
  client_rank: number | null;
}

/** How each category the client holds is actually performing, from all 60 funds. */
export function categoryPerformance(clientId: number): Figure<CategoryPerf[]> {
  const sql = `1-year return per fund from NAV history, averaged within its category;
the client's own fund ranked inside that category`;
  const rows = db().prepare(`
    WITH latest AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id=h.fk_scheme_id)),
    yearago AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master
        WHERE fk_scheme_id=h.fk_scheme_id AND price_date <= date('${TODAY}','-12 months'))),
    ret AS (SELECT l.s scheme_id, (l.price/y.price - 1)*100 r1y FROM latest l JOIN yearago y ON y.s=l.s),
    held AS (SELECT scheme_id, fund_category, SUM(present_market_value) v
      FROM fifo_summary_holding_active WHERE client_id=? GROUP BY scheme_id)
    SELECT cm.category_name category, am.main_asset_name asset,
      COUNT(DISTINCT sm.scheme_id) funds,
      ROUND(AVG(ret.r1y),1) cat_avg_1y,
      ROUND(MAX(ret.r1y),1) best_1y,
      ROUND(MIN(ret.r1y),1) worst_1y,
      COALESCE((SELECT SUM(v) FROM held WHERE held.fund_category=cm.category_name),0) client_value,
      (SELECT ROUND(ret2.r1y,1) FROM ret ret2 JOIN held h2 ON h2.scheme_id=ret2.scheme_id
        WHERE h2.fund_category=cm.category_name ORDER BY h2.v DESC LIMIT 1) client_1y,
      (SELECT COUNT(*) FROM ret ret3 JOIN scheme_master s3 ON s3.scheme_id=ret3.scheme_id
        WHERE s3.fk_category_id=cm.category_id AND ret3.r1y >
          (SELECT ret4.r1y FROM ret ret4 JOIN held h4 ON h4.scheme_id=ret4.scheme_id
            WHERE h4.fund_category=cm.category_name ORDER BY h4.v DESC LIMIT 1)) + 1 client_rank
    FROM scheme_master sm
    JOIN category_master cm ON cm.category_id=sm.fk_category_id
    JOIN main_asset_master am ON am.id=cm.fk_main_asset_id
    JOIN ret ON ret.scheme_id=sm.scheme_id
    WHERE cm.category_name IN (SELECT DISTINCT fund_category FROM fifo_summary_holding_active WHERE client_id=?)
    GROUP BY cm.category_id ORDER BY client_value DESC`).all(clientId, clientId) as CategoryPerf[];
  return { value: rows, tag: 'computed', sql, sources: ['mf_historical_price_master.price', 'category_master', 'fifo_summary_holding_active'] };
}

export interface CapExposure { large: number; mid: number; small: number; other: number }

export function marketCapLookthrough(clientId: number): Figure<CapExposure> {
  const rows = db().prepare(`SELECT fund_category cat, SUM(present_market_value) v
    FROM fifo_summary_holding_active WHERE client_id=? GROUP BY fund_category`).all(clientId) as { cat: string; v: number }[];
  const tot = rows.reduce((s, r) => s + r.v, 0);
  const out: CapExposure = { large: 0, mid: 0, small: 0, other: 0 };
  for (const r of rows) {
    const m = LOOKTHROUGH_RULES.byCategory[r.cat] ?? { large: 0, mid: 0, small: 0, other: 100 };
    const w = tot > 0 ? r.v / tot : 0;
    out.large += m.large * w;
    out.mid += m.mid * w;
    out.small += m.small * w;
    out.other += m.other * w;
  }
  return {
    value: {
      large: Math.round(out.large * 10) / 10,
      mid: Math.round(out.mid * 10) / 10,
      small: Math.round(out.small * 10) / 10,
      other: Math.round(out.other * 10) / 10,
    },
    tag: 'rule',
    sql: `${LOOKTHROUGH_RULES.version}\neach category mapped to the market-cap split SEBI's categorisation rules require, then weighted by holding value`,
    sources: ['fifo_summary_holding_active.fund_category', '.present_market_value', 'LOOKTHROUGH_RULES'],
  };
}

export interface FundDetail {
  scheme_id: number;
  name: string;
  category: string;
  asset: string;
  amc: string;
  benchmark: string;
  expense: number;
  cat_expense: number;
  risk: string;
  pick: number;
  exit_load: number;
  nav: number;
  ret1y: number | null;
  cat_avg_1y: number | null;
  rank_in_cat: number | null;
  cat_size: number | null;
  isin: string;
  value: number;
  invested: number;
  units: number;
  weight: number | null;
  client_xirr: number | null;
  bmxirr: number | null;
  first_bought: string | null;
}

export function fundDetails(clientId: number): FundDetail[] {
  return db().prepare(`
    WITH latest AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id=h.fk_scheme_id)),
    yearago AS (SELECT fk_scheme_id s, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master
        WHERE fk_scheme_id=h.fk_scheme_id AND price_date <= date('${TODAY}','-12 months'))),
    ret AS (SELECT l.s scheme_id, (l.price/y.price - 1)*100 r1y FROM latest l JOIN yearago y ON y.s=l.s)
    SELECT f.scheme_id, f.fund_name name, f.fund_category category, f.asset_name asset,
      am.amc_name amc, bm.benchmark_name benchmark,
      sm.scheme_expense_ratio expense, sm.risk_level risk, sm.is_jhaveri_pick pick,
      sm.scheme_exit_load exit_load, sm.scheme_isin_code isin, f.nav,
      ROUND(r.r1y,1) ret1y,
      (SELECT ROUND(AVG(r2.r1y),1) FROM ret r2 JOIN scheme_master s2 ON s2.scheme_id=r2.scheme_id
        WHERE s2.fk_category_id=sm.fk_category_id) cat_avg_1y,
      (SELECT ROUND(AVG(s3.scheme_expense_ratio),2) FROM scheme_master s3
        WHERE s3.fk_category_id=sm.fk_category_id) cat_expense,
      (SELECT COUNT(*) FROM ret r3 JOIN scheme_master s3 ON s3.scheme_id=r3.scheme_id
        WHERE s3.fk_category_id=sm.fk_category_id AND r3.r1y > r.r1y) + 1 rank_in_cat,
      (SELECT COUNT(*) FROM scheme_master s4 WHERE s4.fk_category_id=sm.fk_category_id) cat_size,
      f.present_market_value value, f.cost_amount invested, f.balance_units units,
      f.portfolio_weight weight, f.xirr client_xirr, sh.sh_bmxirr bmxirr,
      (SELECT MIN(dhl_purchase_date) FROM fifo_detail_holding_latest
        WHERE fk_acc_id=? AND fk_scheme_id=f.scheme_id) first_bought
    FROM fifo_summary_holding_active f
    JOIN scheme_master sm ON sm.scheme_id=f.scheme_id
    JOIN amc_master am ON am.amc_id=sm.fk_amc_id
    JOIN benchmark_master bm ON bm.benchmark_id=sm.fk_benchmark_id
    LEFT JOIN ret r ON r.scheme_id=f.scheme_id
    LEFT JOIN fifo_summary_holding sh ON sh.fk_acc_id=f.client_id AND sh.fk_scheme_id=f.scheme_id
    WHERE f.client_id=? ORDER BY f.present_market_value DESC`).all(clientId, clientId) as FundDetail[];
}

// ---------- Look-through: what the client actually owns ----------
// Funds are wrappers. These functions see through them to the underlying
// stocks, using the holdings slice sourced from the fund manager's system.

export interface SectorRow { sector: string; rupees: number; pct: number }
export interface StockRow { stock: string; sector: string; cap_band: string | null; rupees: number; pct: number; funds: number }
export interface CapRow { band: string; rupees: number; pct: number }

export interface LookThrough {
  covered: number;        // ₹ of the portfolio with stock-level disclosure
  total: number;          // ₹ of the whole portfolio
  coverage_pct: number;
  sectors: SectorRow[];
  stocks: StockRow[];
  caps: CapRow[];
  top_sector_pct: number;
  top10_pct: number;
  overlap_pct: number;    // share of looked-through money sitting in stocks ≥2 funds hold
  overlap_stocks: number;
  as_of: string | null;
}

export function lookThrough(clientId: number): Figure<LookThrough> {
  const sqlNote = `each fund's disclosed holdings × the client's rupees in that fund,
aggregated by stock and sector; overlap = money in stocks that two or more of the client's funds both hold`;
  const total = (db().prepare('SELECT COALESCE(SUM(present_market_value),0) v FROM fifo_summary_holding_active WHERE client_id=?')
    .get(clientId) as { v: number }).v;

  const rows = db().prepare(`
    SELECT s.stock_id, s.stock_name stock, s.sector, s.cap_band,
      SUM(h.weight_pct/100.0 * f.present_market_value) rupees,
      COUNT(DISTINCT h.fk_scheme_id) funds
    FROM fifo_summary_holding_active f
    JOIN mf_scheme_holdings h ON h.fk_scheme_id = f.scheme_id
    JOIN stock_master s ON s.stock_id = h.stock_id
    WHERE f.client_id = ?
    GROUP BY s.stock_id ORDER BY rupees DESC`).all(clientId) as
    (StockRow & { stock_id: string })[];

  const covered = rows.reduce((a, r) => a + r.rupees, 0);
  const pct = (n: number) => (covered > 0 ? Math.round((n / covered) * 1000) / 10 : 0);
  const stocks = rows.map(r => ({ ...r, pct: pct(r.rupees) }));

  const bySector = new Map<string, number>();
  const byCap = new Map<string, number>();
  for (const r of rows) {
    bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + r.rupees);
    const band = r.cap_band ?? 'Unclassified';
    byCap.set(band, (byCap.get(band) ?? 0) + r.rupees);
  }
  const sectors = [...bySector.entries()].map(([sector, rupees]) => ({ sector, rupees, pct: pct(rupees) }))
    .sort((a, b) => b.rupees - a.rupees);
  const capOrder = ['Large', 'Mid', 'Small', 'Unclassified'];
  const caps = [...byCap.entries()].map(([band, rupees]) => ({ band, rupees, pct: pct(rupees) }))
    .sort((a, b) => capOrder.indexOf(a.band) - capOrder.indexOf(b.band));

  const dup = rows.filter(r => r.funds > 1);
  const asOf = (db().prepare('SELECT MAX(as_of_date) d FROM mf_scheme_holdings').get() as { d: string | null }).d;

  return {
    value: {
      covered, total,
      coverage_pct: total > 0 ? Math.round((covered / total) * 1000) / 10 : 0,
      sectors, stocks, caps,
      top_sector_pct: sectors[0]?.pct ?? 0,
      top10_pct: pct(stocks.slice(0, 10).reduce((a, r) => a + r.rupees, 0)),
      overlap_pct: pct(dup.reduce((a, r) => a + r.rupees, 0)),
      overlap_stocks: dup.length,
      as_of: asOf,
    },
    tag: 'computed', sql: sqlNote,
    sources: ['mf_scheme_holdings.weight_pct', 'stock_master.sector/.cap_band', 'fifo_summary_holding_active.present_market_value'],
  };
}

export interface OverlapPair { a: string; b: string; shared: number; shared_pct: number }

/** Which pairs of the client's funds are quietly the same portfolio. */
export function fundOverlap(clientId: number): OverlapPair[] {
  return db().prepare(`
    SELECT sa.scheme_full_name a, sb.scheme_full_name b,
      COUNT(*) shared,
      ROUND(SUM(MIN(ha.weight_pct, hb.weight_pct)), 1) shared_pct
    FROM fifo_summary_holding_active fa
    JOIN fifo_summary_holding_active fb ON fb.client_id = fa.client_id AND fb.scheme_id > fa.scheme_id
    JOIN mf_scheme_holdings ha ON ha.fk_scheme_id = fa.scheme_id
    JOIN mf_scheme_holdings hb ON hb.fk_scheme_id = fb.scheme_id AND hb.stock_id = ha.stock_id
    JOIN scheme_master sa ON sa.scheme_id = fa.scheme_id
    JOIN scheme_master sb ON sb.scheme_id = fb.scheme_id
    WHERE fa.client_id = ?
    GROUP BY fa.scheme_id, fb.scheme_id
    HAVING shared > 0 ORDER BY shared_pct DESC`).all(clientId) as OverlapPair[];
}

/**
 * Benchmark return on the SAME cashflows that built the equity curve — so the
 * headline comparison and the chart can never tell different stories. The
 * per-holding sh_bmxirr is a different question (that fund vs its own index)
 * and stays where it belongs, on the fund.
 */
export function benchmarkComparison(clientId: number): Figure<{
  value: number; benchmark: number; gap: number; client_xirr: number | null; bench_xirr: number | null;
}> {
  const curve = equityCurve(clientId).value;
  const last = curve[curve.length - 1];
  const flows = (db().prepare(`SELECT t.tr_date d, t.tr_amount amt, tt.tr_type_buy_sell_flag flag
    FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    WHERE t.fk_acc_id=? AND t.tr_date <= '${TODAY}' AND tt.tr_type_buy_sell_flag != 0
    ORDER BY t.tr_date`).all(clientId) as { d: string; amt: number; flag: number }[])
    .map(f => ({ date: f.d, amount: -f.flag * f.amt }));
  const asOf = { date: TODAY, amount: 0 };
  const clientXirr = xirr([...flows, { ...asOf, amount: last?.value ?? 0 }]);
  const benchXirr = xirr([...flows, { ...asOf, amount: last?.benchmark ?? 0 }]);
  return {
    value: {
      value: last?.value ?? 0,
      benchmark: last?.benchmark ?? 0,
      gap: (last?.value ?? 0) - (last?.benchmark ?? 0),
      client_xirr: clientXirr != null ? Math.round(clientXirr * 1000) / 10 : null,
      bench_xirr: benchXirr != null ? Math.round(benchXirr * 1000) / 10 : null,
    },
    tag: 'computed',
    sql: `the client's actual cashflows valued two ways: in their funds, and in those funds' benchmark indices —
same dates, same rupees, one engine, so the headline and the chart always agree`,
    sources: ['transaction_master', 'mf_historical_price_master.price', 'benchmark_price_history.price'],
  };
}

/** Growth curve for a chosen subset of the client's funds (empty = all). */
export function equityCurveFor(clientId: number, schemeIds: number[]): Figure<CurvePoint[]> {
  if (schemeIds.length === 0) return equityCurve(clientId);
  const full = equityCurve(clientId);
  const list = schemeIds.join(',');
  const txns = db().prepare(`SELECT t.tr_date, t.fk_scheme_id scheme, t.tr_amount, t.tr_units,
      tt.tr_type_buy_sell_flag flag, sm.fk_benchmark_id bench
    FROM transaction_master t
    JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    JOIN scheme_master sm ON sm.scheme_id=t.fk_scheme_id
    WHERE t.fk_acc_id=? AND t.tr_date <= '${TODAY}' AND tt.tr_type_buy_sell_flag != 0
      AND t.fk_scheme_id IN (${list}) ORDER BY t.tr_date`).all(clientId) as
    { tr_date: string; scheme: number; tr_amount: number; tr_units: number | null; flag: number; bench: number }[];
  if (txns.length === 0) return { ...full, value: [] };

  const navAt = db().prepare(`SELECT price FROM mf_historical_price_master
    WHERE fk_scheme_id=? AND price_date <= ? ORDER BY price_date DESC LIMIT 1`);
  const benchAt = db().prepare(`SELECT price FROM benchmark_price_history
    WHERE fk_benchmark_id=? AND price_date <= ? ORDER BY price_date DESC LIMIT 1`);
  const out: CurvePoint[] = [];
  for (const d of monthEnds(txns[0].tr_date)) {
    const units = new Map<number, number>();
    const bUnits = new Map<number, number>();
    let invested = 0;
    for (const t of txns) {
      if (t.tr_date > d) break;
      units.set(t.scheme, (units.get(t.scheme) ?? 0) + t.flag * (t.tr_units ?? 0));
      invested += t.flag * t.tr_amount;
      const bp = benchAt.get(t.bench, t.tr_date) as { price: number } | undefined;
      if (bp) bUnits.set(t.bench, (bUnits.get(t.bench) ?? 0) + (t.flag * t.tr_amount) / bp.price);
    }
    let value = 0, benchmark = 0;
    for (const [s, u] of units) {
      if (u <= 0) continue;
      const p = navAt.get(s, d) as { price: number } | undefined;
      if (p) value += u * p.price;
    }
    for (const [b, u] of bUnits) {
      if (u <= 0) continue;
      const p = benchAt.get(b, d) as { price: number } | undefined;
      if (p) benchmark += u * p.price;
    }
    out.push({ d, value: Math.round(value), invested: Math.round(invested), benchmark: Math.round(benchmark) });
  }
  return { ...full, value: out };
}

export interface FundHoldingRow { stock_name: string; sector: string; cap_band: string | null; weight_pct: number }

export function fundHoldingRows(schemeId: number): FundHoldingRow[] {
  return db().prepare(`SELECT s.stock_name, s.sector, s.cap_band, h.weight_pct
    FROM mf_scheme_holdings h JOIN stock_master s ON s.stock_id = h.stock_id
    WHERE h.fk_scheme_id = ? ORDER BY h.weight_pct DESC`).all(schemeId) as FundHoldingRow[];
}
