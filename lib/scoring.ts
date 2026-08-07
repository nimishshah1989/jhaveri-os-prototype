import { db } from './db';
import { TODAY } from '../mockdb/engines';

// v0 weights and gates — founder-delegated draft, proposed from the data.
// ONE home for every knob: the Admin page's rules view reads this object, and
// the real build moves it into rules_registry rows (versioned, approved).
export const SCORING_RULES = {
  version: 'health_v0 · scheme_grade_v0 — 07-Aug-2026',
  components: ['performance', 'diversification', 'discipline', 'tax', 'risk_fit'] as const,
  performance: { zero_at_gap_pts: 15 },
  diversification: { category_cap: 0.45, fund_cap: 0.45, w_category: 0.6, w_fund: 0.4 },
  discipline: { bounce: 8, mandate_expiring: 4, dormant: 6, no_sip_idle: 4, idle_floor: 100000, dormant_months: 14, mandate_window_days: 45 },
  tax: { harvest_open: 6, harvest_min_lt: 10000, st_heavy: 4, st_mix_cap: 0.5, fy_exemption: 125000 },
  risk_fit: { per_grade: 8 },
  bands: [
    { min: 70, label: 'healthy', cls: 'lt' },
    { min: 45, label: 'needs work', cls: 'conc' },
    { min: 0, label: 'at risk', cls: 'atrisk' },
  ],
  quick_win_single_lever: 8, // "one call, one fix" — a single lever this big
  scheme_grade: { pick_bonus_pctile: 5, expense_penalty_pctile: 10 },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const R = SCORING_RULES;

export interface Lever {
  key: string;
  label: string;
  delta: number;
  detail: string;
  ghosted?: string;
  kind?: 'hygiene'; // data-correctness fix, excluded from quick-win ranking
}

export interface Component {
  key: (typeof R.components)[number];
  label: string;
  score: number;
  why: string;
  levers: Lever[];
}

export interface Health {
  total: number;
  reachable: number;
  gain: number;
  band: { label: string; cls: string };
  components: Component[];
}

interface Inputs {
  wx: number | null;
  bmx: number | null;
  topCatShare: number;
  topFundWeight: number;
  bounced: boolean;
  mandateExpiring: boolean;
  dormant: boolean;
  noSipIdle: boolean;
  unrealLt: number;
  unrealSt: number;
  realLt: number;
  laggard: { name: string; v: number; xirr: number; bmxirr: number } | null;
  totalValue: number;
  profileGrade: number;
  portfolioGrade: number | null;
}

function gather(id: number): Inputs {
  const d = db();
  const k = d.prepare(`SELECT
    (SELECT ROUND(SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value*xirr END)/SUM(CASE WHEN xirr IS NOT NULL THEN present_market_value END),1) FROM fifo_summary_holding_active WHERE client_id=$id) wx,
    (SELECT ROUND(SUM(CASE WHEN sh_bmxirr IS NOT NULL THEN sh_current_value*sh_bmxirr END)/SUM(CASE WHEN sh_bmxirr IS NOT NULL THEN sh_current_value END),1) FROM fifo_summary_holding WHERE fk_acc_id=$id) bmx,
    (SELECT SUM(present_market_value) FROM fifo_summary_holding_active WHERE client_id=$id) tv,
    (SELECT MAX(cs) FROM (SELECT SUM(present_market_value) cs FROM fifo_summary_holding_active WHERE client_id=$id GROUP BY fund_category)) topcat,
    (SELECT MAX(present_market_value) FROM fifo_summary_holding_active WHERE client_id=$id) topfund,
    (SELECT COALESCE(SUM(sh_unrealized_ltcg),0) FROM fifo_summary_holding WHERE fk_acc_id=$id) ult,
    (SELECT COALESCE(SUM(sh_unrealized_stcg),0) FROM fifo_summary_holding WHERE fk_acc_id=$id) ust,
    (SELECT COALESCE(SUM(sh_realized_ltcg),0) FROM fifo_summary_holding WHERE fk_acc_id=$id) rlt,
    (SELECT COUNT(*) FROM sip_master s JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code WHERE s.fk_acc_id=$id AND s.is_live_sip=1 AND x.npayments_missed>=2) bounced,
    (SELECT COUNT(*) FROM sip_master s JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code JOIN bse_mandate_list ml ON ml.exch_mandate_id=x.exch_mandate_id
       WHERE s.fk_acc_id=$id AND s.is_live_sip=1 AND ml.end_date <= date('${TODAY}','+${R.discipline.mandate_window_days} days')) mexp,
    (SELECT COUNT(*) FROM sip_master WHERE fk_acc_id=$id AND is_live_sip=1) livesips,
    (SELECT MAX(tr_date) FROM transaction_master WHERE fk_acc_id=$id AND tr_date <= '${TODAY}') lastTxn`).get({ id }) as Record<string, number | string | null>;
  const lag = d.prepare(`SELECT f.fund_name name, f.present_market_value v, f.xirr, sh.sh_bmxirr bmxirr
    FROM fifo_summary_holding_active f
    LEFT JOIN fifo_summary_holding sh ON sh.fk_acc_id=f.client_id AND sh.fk_scheme_id=f.scheme_id
    WHERE f.client_id=? AND f.xirr IS NOT NULL AND sh.sh_bmxirr IS NOT NULL AND f.xirr < sh.sh_bmxirr - 10
    ORDER BY (sh.sh_bmxirr - f.xirr) * f.present_market_value DESC LIMIT 1`).get(id) as Inputs['laggard'];
  const risk = d.prepare(`SELECT r.risk_profile FROM client_master_mf_related r WHERE r.fk_cm_user_id=?`).get(id) as { risk_profile: string } | undefined;
  const port = d.prepare(`SELECT SUM(f.present_market_value * CASE sm.risk_level
      WHEN 'Low' THEN 1 WHEN 'Moderately Low' THEN 2 WHEN 'Moderate' THEN 3
      WHEN 'Moderately High' THEN 4 WHEN 'High' THEN 4.5 ELSE 5 END) / SUM(f.present_market_value) g
    FROM fifo_summary_holding_active f JOIN scheme_master sm ON sm.scheme_id=f.scheme_id WHERE f.client_id=?`).get(id) as { g: number | null };
  const profileGrade = { Conservative: 1, Moderate: 3, Aggressive: 4, 'Very Aggressive': 5 }[risk?.risk_profile ?? 'Moderate'] ?? 3;
  const tv = Number(k.tv ?? 0);
  const dormantCut = db().prepare(`SELECT date('${TODAY}', '-${R.discipline.dormant_months} months') d`).get() as { d: string };
  return {
    wx: k.wx as number | null,
    bmx: k.bmx as number | null,
    totalValue: tv,
    topCatShare: tv > 0 ? Number(k.topcat ?? 0) / tv : 0,
    topFundWeight: tv > 0 ? Number(k.topfund ?? 0) / tv : 0,
    bounced: Number(k.bounced) > 0,
    mandateExpiring: Number(k.mexp) > 0,
    dormant: k.lastTxn != null && String(k.lastTxn) < dormantCut.d,
    noSipIdle: Number(k.livesips) === 0 && tv > R.discipline.idle_floor,
    unrealLt: Number(k.ult),
    unrealSt: Number(k.ust),
    realLt: Number(k.rlt),
    laggard: lag ?? null,
    profileGrade,
    portfolioGrade: port.g != null ? Math.round(port.g * 10) / 10 : null,
  };
}

// Each component is a pure function of inputs, so a lever's delta is just the
// component recomputed with that condition fixed — score and suggestion stay
// two views of one rule by construction.
function perfScore(i: Inputs): number {
  if (i.wx == null || i.bmx == null) return 10;
  const gap = Math.max(0, i.bmx - i.wx);
  return Math.round(20 * clamp(1 - gap / R.performance.zero_at_gap_pts, 0, 1));
}
function divScore(i: Inputs): number {
  const c = R.diversification;
  const pen = (Math.max(i.topCatShare - c.category_cap, 0) / (1 - c.category_cap)) * c.w_category
    + (Math.max(i.topFundWeight - c.fund_cap, 0) / (1 - c.fund_cap)) * c.w_fund;
  return Math.round(20 * clamp(1 - pen, 0, 1));
}
function discScore(i: Inputs): number {
  const c = R.discipline;
  let s = 20;
  if (i.bounced) s -= c.bounce;
  if (i.mandateExpiring) s -= c.mandate_expiring;
  if (i.dormant) s -= c.dormant;
  if (i.noSipIdle) s -= c.no_sip_idle;
  return Math.max(0, s);
}
function taxScore(i: Inputs): number {
  const c = R.tax;
  let s = 20;
  const headroom = Math.max(0, c.fy_exemption - Math.max(0, i.realLt));
  if (i.unrealLt > c.harvest_min_lt && headroom > 0) s -= c.harvest_open;
  const mix = i.unrealSt + i.unrealLt;
  if (mix > 0 && i.unrealSt / mix > c.st_mix_cap && i.unrealSt > 25000) s -= c.st_heavy;
  return Math.max(0, s);
}
function fitScore(i: Inputs): number {
  if (i.portfolioGrade == null) return 10;
  return Math.max(0, Math.round(20 - R.risk_fit.per_grade * Math.abs(i.portfolioGrade - i.profileGrade)));
}

export function clientHealth(id: number): Health {
  const i = gather(id);
  const components: Component[] = [];

  const perf = perfScore(i);
  const perfLevers: Lever[] = [];
  if (i.laggard && i.wx != null && i.bmx != null) {
    // Counterfactual: laggard's value earns its benchmark rate instead.
    const fixedWx = i.wx + ((i.laggard.bmxirr - i.laggard.xirr) * i.laggard.v) / i.totalValue;
    const delta = perfScore({ ...i, wx: Math.round(fixedWx * 10) / 10 }) - perf;
    if (delta > 0) perfLevers.push({ key: 'switch_laggard', label: `Switch ${i.laggard.name} to a same-category house pick`, delta, detail: 'pre-trade tax cost computed from the actual lots' });
  }
  components.push({ key: 'performance', label: 'Performance', score: perf, why: i.wx != null && i.bmx != null && i.bmx > i.wx ? `trailing benchmark by ${Math.round((i.bmx - i.wx) * 10) / 10} pts` : 'tracking benchmark', levers: perfLevers });

  const dv = divScore(i);
  components.push({
    key: 'diversification', label: 'Diversification', score: dv,
    why: `${Math.round(i.topCatShare * 100)}% in one category, ${Math.round(i.topFundWeight * 100)}% in one fund`,
    levers: dv < 20 ? [{ key: 'rebalance_bands', label: 'Spread per the risk-band model', delta: 20 - dv, detail: '', ghosted: 'allocation bands per risk profile await compliance sign-off — schema exists, rows pending' }] : [],
  });

  const dc = discScore(i);
  const dcLevers: Lever[] = [];
  if (i.bounced || i.mandateExpiring) dcLevers.push({ key: 'fix_sip', label: 'Re-authorise the mandate and clear the bounces', delta: discScore({ ...i, bounced: false, mandateExpiring: false }) - dc, detail: 'one re-authorisation link' });
  if (i.dormant) dcLevers.push({ key: 'reengage', label: 'Re-engage — book the review', delta: discScore({ ...i, dormant: false }) - dc, detail: 'no transaction in 14+ months' });
  if (i.noSipIdle) dcLevers.push({ key: 'start_sip', label: 'Start a SIP on the idle money', delta: discScore({ ...i, noSipIdle: false }) - dc, detail: 'holds value with zero monthly commitment' });
  components.push({ key: 'discipline', label: 'Discipline', score: dc, why: [i.bounced && 'SIP bounced', i.mandateExpiring && 'mandate expiring', i.dormant && 'dormant', i.noSipIdle && 'idle, no SIP'].filter(Boolean).join(' · ') || 'clean', levers: dcLevers });

  const tx = taxScore(i);
  const headroom = Math.max(0, R.tax.fy_exemption - Math.max(0, i.realLt));
  const txLevers: Lever[] = [];
  if (i.unrealLt > R.tax.harvest_min_lt && headroom > 0) {
    txLevers.push({ key: 'harvest', label: `Harvest ₹${Math.round(Math.min(i.unrealLt, headroom)).toLocaleString('en-IN')} inside the FY exemption`, delta: taxScore({ ...i, unrealLt: 0 }) - tx, detail: 'tax-free; window closes 31-Mar' });
  }
  components.push({ key: 'tax', label: 'Tax efficiency', score: tx, why: txLevers.length ? 'harvest window open, unused' : 'no open windows', levers: txLevers });

  const ft = fitScore(i);
  components.push({
    key: 'risk_fit', label: 'Risk fit', score: ft,
    why: i.portfolioGrade != null ? `portfolio ${i.portfolioGrade} vs profile ${i.profileGrade}` : 'insufficient data',
    levers: ft < 12 ? [{ key: 'review_profile', label: 'Review the risk profile with the client', delta: 20 - ft, detail: 'portfolio and stated appetite disagree', kind: 'hygiene' as const }] : [],
  });

  const total = components.reduce((s, c) => s + c.score, 0);
  const gain = components.reduce((s, c) => s + c.levers.filter(l => !l.ghosted).reduce((a, l) => a + l.delta, 0), 0);
  const reachable = Math.min(100, total + gain);
  const band = R.bands.find(b => total >= b.min) ?? R.bands[R.bands.length - 1];
  return { total, reachable, gain, band: { label: band.label, cls: band.cls }, components };
}

export interface SchemeGrade { scheme_id: number; grade: string; ret1y: number; cat_avg: number; pctile: number }

// A–E by percentile of 1-year return within the scheme's own category,
// nudged by expense vs category median and the house view.
export function schemeGrades(): Map<number, SchemeGrade> {
  const rows = db().prepare(`
    WITH latest AS (SELECT fk_scheme_id, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id=h.fk_scheme_id)),
    yearago AS (SELECT fk_scheme_id, price FROM mf_historical_price_master h
      WHERE price_date=(SELECT MAX(price_date) FROM mf_historical_price_master WHERE fk_scheme_id=h.fk_scheme_id AND price_date <= date('${TODAY}','-12 months'))),
    ret AS (SELECT l.fk_scheme_id scheme_id, (l.price/y.price - 1) * 100 ret1y
      FROM latest l JOIN yearago y ON y.fk_scheme_id=l.fk_scheme_id)
    SELECT r.scheme_id, r.ret1y, sm.fk_category_id cat, sm.scheme_expense_ratio exp, sm.is_jhaveri_pick pick,
      AVG(r.ret1y) OVER (PARTITION BY sm.fk_category_id) cat_avg,
      PERCENT_RANK() OVER (PARTITION BY sm.fk_category_id ORDER BY r.ret1y) * 100 pctile,
      AVG(sm.scheme_expense_ratio) OVER (PARTITION BY sm.fk_category_id) cat_exp
    FROM ret r JOIN scheme_master sm ON sm.scheme_id=r.scheme_id`).all() as
    { scheme_id: number; ret1y: number; exp: number; pick: number; cat_avg: number; pctile: number; cat_exp: number }[];
  const out = new Map<number, SchemeGrade>();
  for (const r of rows) {
    let p = r.pctile;
    if (r.exp > r.cat_exp) p -= SCORING_RULES.scheme_grade.expense_penalty_pctile;
    if (r.pick === 1) p += SCORING_RULES.scheme_grade.pick_bonus_pctile;
    const grade = p >= 80 ? 'A' : p >= 60 ? 'B' : p >= 40 ? 'C' : p >= 20 ? 'D' : 'E';
    out.set(r.scheme_id, { scheme_id: r.scheme_id, grade, ret1y: Math.round(r.ret1y * 10) / 10, cat_avg: Math.round(r.cat_avg * 10) / 10, pctile: Math.round(p) });
  }
  return out;
}

export interface BookHealthRow {
  client_id: number;
  score: number;
  reachable: number;
  gain: number;
  maxLever: number;
  band: string;
  cls: string;
}

export function bookHealth(code: string): Map<number, BookHealthRow> {
  const ids = (db().prepare('SELECT DISTINCT client_id FROM fifo_summary_holding_active WHERE advisor_code=?').all(code) as { client_id: number }[]).map(r => r.client_id);
  const out = new Map<number, BookHealthRow>();
  for (const id of ids) {
    const h = clientHealth(id);
    const maxLever = Math.max(0, ...h.components.flatMap(c => c.levers.filter(l => !l.ghosted && l.kind !== 'hygiene').map(l => l.delta)));
    out.set(id, { client_id: id, score: h.total, reachable: h.reachable, gain: h.gain, maxLever, band: h.band.label, cls: h.band.cls });
  }
  return out;
}
