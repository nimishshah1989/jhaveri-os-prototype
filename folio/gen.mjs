#!/usr/bin/env node
// Computes every derived dataset the Folio needs, from prototype/mockdb/jhaveri.db,
// writes data/folio2.json, and inlines it into folio.html between the F2 markers.
// Run: node prototype/folio/gen.mjs
// Provenance rule: computed or dash. Nothing here invents a number.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(HERE, '../mockdb/jhaveri.db'), { readOnly: true });
const q = (sql, ...p) => db.prepare(sql).all(...p);
const q1 = (sql, ...p) => db.prepare(sql).get(...p);

const CLIENT = 101, ACC = 101;
const ASOF = q1(`SELECT MAX(price_date) d FROM mf_historical_price_master`).d;   // 2026-08-07
const TODAY = '2026-08-11';                                                      // the edition's date
const log = [];
const note = (m) => { log.push(m); console.log('  ' + m); };

/* ─────────────────────────── helpers ─────────────────────────── */
const days = (a, b) => (new Date(b) - new Date(a)) / 864e5;
const addYears = (d, n) => { const x = new Date(d); x.setFullYear(x.getFullYear() + n); return x.toISOString().slice(0, 10); };
const r2 = (x) => x == null ? null : Math.round(x * 100) / 100;
const r1 = (x) => x == null ? null : Math.round(x * 10) / 10;

// XIRR by bisection — robust where Newton diverges on short or odd cashflow sets.
function xirr(flows) {                     // flows: [{d:'YYYY-MM-DD', a:number}], outflow negative
  if (flows.length < 2) return null;
  const t0 = flows[0].d;
  const npv = (r) => flows.reduce((s, f) => s + f.a / Math.pow(1 + r, days(t0, f.d) / 365.25), 0);
  let lo = -0.9999, hi = 10;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) { const m = (lo + hi) / 2; (npv(lo) * npv(m) <= 0 ? hi = m : lo = m); }
  return (lo + hi) / 2 * 100;
}
const cagr = (start, end, d) => (start > 0 && d > 0) ? (Math.pow(end / start, 365.25 / d) - 1) * 100 : null;

/* ─────────────────── prices, schemes, categories ─────────────────── */
const DATES = q(`SELECT DISTINCT price_date d FROM mf_historical_price_master ORDER BY d`).map(r => r.d);
note(`price dates: ${DATES.length} (${DATES[0]} → ${DATES.at(-1)}) — monthly grain, no daily NAV feed`);

const PX = {};                              // PX[sid][date] = nav
for (const r of q(`SELECT fk_scheme_id s, price_date d, price p FROM mf_historical_price_master`))
  (PX[r.s] ||= {})[r.d] = r.p;

const SCHEMES = {};
for (const r of q(`SELECT s.scheme_id id, s.scheme_short_name n, s.fk_amc_id amc, a.amc_name amcn,
                          c.category_name cat, s.scheme_expense_ratio exp, s.scheme_exit_load exl,
                          s.risk_level risk, s.is_jhaveri_pick pick
                   FROM scheme_master s JOIN amc_master a ON a.amc_id=s.fk_amc_id
                   JOIN category_master c ON c.category_id=s.fk_category_id`)) SCHEMES[r.id] = r;
note(`schemes: ${Object.keys(SCHEMES).length}`);

const BENCH = {};                           // NIFTY 500 TRI
for (const r of q(`SELECT price_date d, price p FROM benchmark_price_history WHERE fk_benchmark_id=1`)) BENCH[r.d] = r.p;

/* ───────────────────────── her ledger ───────────────────────── */
const LEDGER = q(`
  SELECT t.tr_date d, t.fk_scheme_id sid, t.tr_folio_no folio, tt.tr_type_name typ,
         tt.tr_type_buy_sell_flag flag, ts.trans_status_name st,
         t.tr_amount amt, t.tr_units units, t.tr_price px
  FROM transaction_master t
  JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
  JOIN trans_status_master ts ON ts.trans_status_id=t.fk_txn_status_id
  WHERE t.fk_acc_id=? AND t.is_active=1 ORDER BY t.tr_date, t.tr_id`, ACC);
note(`ledger rows: ${LEDGER.length}`);
const MONEY = LEDGER.filter(t => t.units > 0 || t.flag === -1);          // real unit movements
const REJECTED = LEDGER.filter(t => t.typ === 'SIP Rejection');
note(`  of which money movements: ${MONEY.length}, SIP rejections: ${REJECTED.length}`);

const HOLD = q(`SELECT scheme_id sid, folio_no folio, fund_name name, fund_category cat,
                       balance_units units, cost_amount cost, nav, present_market_value mv,
                       xirr, inv_since_date since
                FROM fifo_summary_holding_active WHERE client_id=? ORDER BY present_market_value DESC`, CLIENT);
const TOTMV = HOLD.reduce((s, h) => s + h.mv, 0);
const TOTCOST = HOLD.reduce((s, h) => s + h.cost, 0);
note(`holdings: ${HOLD.length}, market value ₹${TOTMV.toFixed(2)}, cost ₹${TOTCOST.toFixed(2)}`);

const FOLIOS = q(`SELECT fm_folio_no folio, fk_scheme_id sid, fm_nominee1_name nom, folio_start_date start
                  FROM folio_master WHERE fk_acc_id=?`, ACC);
const NOMOF = Object.fromEntries(FOLIOS.map(f => [f.folio, f.nom || null]));
const CLI = q1(`SELECT cm_full_name n, cm_pan_no pan, cm_date_of_birth dob, cm_mobile_number mob,
                       cm_email_id em, is_kyc_done kyc, fk_family_id fam FROM client_master WHERE cm_user_id=?`, CLIENT);
const ACCT = q1(`SELECT acc_bse_code ucc, acc_activation_date act FROM accounts_master WHERE acc_id=?`, ACC);
const SIPS = q(`SELECT sip_id id, fk_from_scheme_id sid, tr_folio_no folio, sip_type typ, tr_amount amt,
                       day_of_sip day, start_date start, cease_date cease, is_live_sip live
                FROM sip_master WHERE fk_acc_id=?`, ACC);
const SXP = q(`SELECT reg_no, amount, next_due_date next, npayments_missed missed, n_installment_paid paid,
                      previous_paid_date prev, status FROM bse_sxp_list WHERE ucc=?`, ACCT.ucc);
const MANDATE = q1(`SELECT amount, type, status, umrn, bank_name bank, start_date start, end_date end
                    FROM bse_mandate_list WHERE ucc=?`, ACCT.ucc);
const CONSENTS = q(`SELECT channel, purpose, state, captured_via via, ts FROM consents WHERE client_id=? ORDER BY ts DESC`, CLIENT);
const ATTN = q(`SELECT flag_type, severity, evidence, as_of FROM mv_portfolio_attention WHERE client_id=?`, CLIENT);
note(`sips: ${SIPS.length}, mandate bank: ${MANDATE.bank} (ends ${MANDATE.end}), consents: ${CONSENTS.length}, attention flags: ${ATTN.length}`);

/* ─────────────────── her monthly arc (worth vs put-in) ─────────────────── */
const ARC = [];
for (const d of DATES) {
  if (d < MONEY[0].d) continue;
  const u = {}; let net = 0;
  for (const t of MONEY) {
    if (t.d > d) break;
    u[t.sid] = (u[t.sid] || 0) + t.units * t.flag;
    net += t.amt * t.flag;
  }
  let worth = 0, priced = true;
  for (const [sid, un] of Object.entries(u)) {
    const p = PX[sid]?.[d];
    if (p == null) { priced = false; break; }             // never partial-price a total
    worth += un * p;
  }
  if (!priced) continue;
  ARC.push([d, Math.round(worth), Math.round(net)]);
}
note(`arc points: ${ARC.length} (${ARC[0][0]} → ${ARC.at(-1)[0]}); last worth ₹${ARC.at(-1)[1]}`);
if (Math.abs(ARC.at(-1)[1] - TOTMV) > 2) note(`  WARN arc tail ${ARC.at(-1)[1]} vs holdings ${TOTMV.toFixed(0)}`);

/* ─────────────────── XIRR: hers, and the peer distribution ─────────────────── */
const herFlows = MONEY.map(t => ({ d: t.d, a: -t.amt * t.flag })).concat([{ d: ASOF, a: TOTMV }]);
const HERX = xirr(herFlows);
note(`her portfolio XIRR: ${HERX.toFixed(2)}% over ${MONEY.length} movements since ${MONEY[0].d}`);

// Percentile against every client with >=6 months of history, same method, same day.
const allTx = q(`SELECT t.fk_acc_id acc, t.tr_date d, t.tr_amount amt, t.tr_units u,
                        tt.tr_type_buy_sell_flag flag, t.fk_scheme_id sid
                 FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
                 WHERE t.is_active=1 AND (t.tr_units>0 OR tt.tr_type_buy_sell_flag=-1) ORDER BY t.tr_date`);
const byAcc = {};
for (const t of allTx) (byAcc[t.acc] ||= []).push(t);
function portXirrAt(tx, asof) {
  const u = {}, fl = [];
  for (const t of tx) { if (t.d > asof) break; u[t.sid] = (u[t.sid] || 0) + t.u * t.flag; fl.push({ d: t.d, a: -t.amt * t.flag }); }
  if (!fl.length || days(fl[0].d, asof) < 180) return null;
  let mv = 0;
  for (const [sid, un] of Object.entries(u)) { const p = PX[sid]?.[asof]; if (p == null) return null; mv += un * p; }
  if (mv <= 0) return null;
  fl.push({ d: asof, a: mv });
  return xirr(fl);
}
const pctCache = {};
function percentileAt(asof, mine) {
  if (mine == null) return null;
  const xs = pctCache[asof] || (pctCache[asof] = (() => {
    const a = [];
    for (const tx of Object.values(byAcc)) { const x = portXirrAt(tx, asof); if (x != null && isFinite(x)) a.push(x); }
    return a;
  })());
  if (xs.length < 20) return null;
  return { pct: xs.filter(x => x < mine).length / xs.length, n: xs.length };
}
const PCT = percentileAt(ASOF, HERX);
note(`XIRR percentile: beats ${(PCT.pct * 100).toFixed(1)}% of ${PCT.n} clients with >=6 months`);

/* ─────────────────── per-fund detail: 1-month change, rate, standing instruction ─────────────────── */
const prevD = DATES[DATES.indexOf(ASOF) - 1];
const lotsOf = (sid) => q(`SELECT tr_date d, balance_unit u, purchase_price p FROM fifo_purchase_log
                           WHERE acc_id=? AND scheme_id=? AND balance_unit>0 ORDER BY tr_date`, ACC, sid);
const FUNDS = HOLD.map(h => {
  const sc = SCHEMES[h.sid];
  const p0 = PX[h.sid][prevD], p1 = PX[h.sid][ASOF];
  const flows = MONEY.filter(t => t.sid === h.sid).map(t => ({ d: t.d, a: -t.amt * t.flag })).concat([{ d: ASOF, a: h.mv }]);
  const sip = SIPS.find(s => s.sid === h.sid && s.live);
  const lots = lotsOf(h.sid);
  const locked = lots.filter(l => days(l.d, ASOF) < 365);
  const first = MONEY.filter(t => t.sid === h.sid)[0];
  // her rate vs the fund's own vs the market, all over HER window, all from the same two dates
  const d0 = DATES.filter(d => d <= first.d).at(-1) || DATES[0], span = days(d0, ASOF);
  const own = cagr(PX[h.sid][d0], p1, span);
  const mkt = BENCH[d0] ? cagr(BENCH[d0], BENCH[ASOF], span) : null;
  return {
    own: r2(own), mkt: r2(mkt), windowFrom: d0,
    sid: h.sid, folio: h.folio, name: sc.n, cat: h.cat, amc: sc.amcn, plan: /Dir/.test(sc.n) ? 'Direct' : 'Regular',
    units: r2(h.units), cost: Math.round(h.cost), mv: Math.round(h.mv), nav: h.nav, since: first.d,
    xirr: r2(xirr(flows)), exp: sc.exp, risk: sc.risk, nom: NOMOF[h.folio],
    m1: r2((p1 / p0 - 1) * 100), m1rs: Math.round(h.units * (p1 - p0)), m1from: prevD,
    wt: r2(100 * h.mv / TOTMV), n: MONEY.filter(t => t.sid === h.sid).length,
    sip: sip ? { amt: sip.amt, day: sip.day, start: sip.start, next: SXP[0]?.next || null, paid: SXP[0]?.paid ?? null, live: !!sip.live } : null,
    lots: lots.length, lockedU: r2(locked.reduce((s, l) => s + l.u, 0)),
    freeFrom: locked.length ? addYears(locked.at(-1).d, 1) : null,
    elssFree: h.cat === 'ELSS (Tax Savings)' ? lots.map(l => [addYears(l.d, 3), Math.round(l.u * h.nav), r2(l.u)]) : null,
  };
});
note(`funds detailed: ${FUNDS.length}; 1-month window ${prevD} -> ${ASOF}`);
note(`  1-day change: NOT computable (price grain is monthly). The column prints a dash.`);

/* ─────────────────── look-through register ─────────────────── */
const mvBySid = Object.fromEntries(HOLD.map(h => [h.sid, h.mv]));
const rawHold = q(`SELECT h.fk_scheme_id sid, s.stock_name nm, s.sector sec, s.cap_band cap, h.weight_pct w, h.as_of_date d
                   FROM mf_scheme_holdings h JOIN stock_master s ON s.stock_id=h.stock_id
                   WHERE h.fk_scheme_id IN (${HOLD.map(h => h.sid).join(',')})`);
note(`look-through rows in: ${rawHold.length}`);
const regMap = new Map();
for (const r of rawHold) {
  const rs = r.w / 100 * mvBySid[r.sid];
  const e = regMap.get(r.nm) || { nm: r.nm, sec: r.sec, cap: r.cap || null, rs: 0, via: {} };
  e.rs += rs; e.via[r.sid] = (e.via[r.sid] || 0) + rs; regMap.set(r.nm, e);
}
const REG = [...regMap.values()].sort((a, b) => b.rs - a.rs)
  .map(e => [e.nm.replace(/ Limited$/, ''), e.sec, e.cap, Math.round(e.rs),
             Object.fromEntries(Object.entries(e.via).map(([k, v]) => [k, Math.round(v)]))]);
const COVERAGE = rawHold.reduce((s, r) => s + r.w / 100 * mvBySid[r.sid], 0) / TOTMV * 100;
note(`register: ${REG.length} distinct companies (rows out ${REG.length}); coverage ${COVERAGE.toFixed(2)}% of portfolio`);

const secMap = new Map();
for (const r of REG) { const e = secMap.get(r[1]) || { rs: 0, n: 0 }; e.rs += r[3]; e.n++; secMap.set(r[1], e); }
const SECTORS = [...secMap.entries()].map(([s, e]) => [s, e.rs, r2(100 * e.rs / TOTMV), e.n]).sort((a, b) => b[1] - a[1]);
const capMap = new Map();
for (const r of REG) { const k = r[2] || '—'; capMap.set(k, (capMap.get(k) || 0) + r[3]); }
const CAPS = [...capMap.entries()].map(([c, rs]) => [c, rs, r2(100 * rs / TOTMV)]).sort((a, b) => b[1] - a[1]);
note(`sectors: ${SECTORS.length}; cap bands: ${CAPS.map(c => c[0] + ' ' + c[2] + '%').join(', ')}`);

// Per-fund full holdings for all 60 schemes, name-dictionary encoded to keep the page small.
const NAMES = [], nameIx = new Map();
const ix = (n) => { const k = n.replace(/ Limited$/, ''); if (!nameIx.has(k)) { nameIx.set(k, NAMES.length); NAMES.push(k); } return nameIx.get(k); };
const FH = {};
for (const r of q(`SELECT h.fk_scheme_id sid, s.stock_name nm, s.sector sec, h.weight_pct w
                   FROM mf_scheme_holdings h JOIN stock_master s ON s.stock_id=h.stock_id ORDER BY h.weight_pct DESC`))
  (FH[r.sid] ||= []).push([ix(r.nm), r2(r.w), r.sec]);
note(`per-fund holdings: ${Object.values(FH).reduce((s, a) => s + a.length, 0)} rows over ${Object.keys(FH).length} schemes, ${NAMES.length}-name dictionary`);

/* ─────────────────── examination v0 — rules stated, inputs measured ─────────────────── */
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const catAgg = {};
for (const s of Object.values(SCHEMES)) {
  const px = PX[s.id], last = px[ASOF], y1 = px[DATES[DATES.length - 13]], y3 = px[DATES[DATES.length - 37]];
  (catAgg[s.cat] ||= []).push({ c1: y1 ? (last / y1 - 1) * 100 : null, c3: y3 ? cagr(y3, last, days(DATES[DATES.length - 37], ASOF)) : null });
}
const catMean = Object.fromEntries(Object.entries(catAgg).map(([c, a]) => [c,
  { c1: a.reduce((s, x) => s + (x.c1 ?? 0), 0) / a.length, c3: a.reduce((s, x) => s + (x.c3 ?? 0), 0) / a.length }]));

function examineAt(asof, obs) {
  obs = obs || asof;                       // prices as of `asof`; calendar facts as of `obs`
  const tx = MONEY.filter(t => t.d <= asof), rej = REJECTED.filter(t => t.d <= asof);
  if (!tx.length) return null;
  const u = {}; for (const t of tx) u[t.sid] = (u[t.sid] || 0) + t.units * t.flag;
  const vals = {}; let tot = 0;
  for (const [sid, un] of Object.entries(u)) { const p = PX[sid]?.[asof]; if (p == null) return null; vals[sid] = un * p; tot += un * p; }
  if (tot <= 0) return null;
  const i = DATES.indexOf(asof);

  const px = percentileAt(asof, portXirrAt(byAcc[ACC], asof));
  const P1 = px ? Math.round(60 * px.pct) : 0;
  let beat = 0, neg = 0;
  for (const [sid, v] of Object.entries(vals)) {
    const s = SCHEMES[sid], p = PX[sid], last = p[asof], m = catMean[s.cat];
    const y1 = i >= 12 ? p[DATES[i - 12]] : null, y3 = i >= 36 ? p[DATES[i - 36]] : null;
    const r1y = y1 ? (last / y1 - 1) * 100 : null, r3y = y3 ? cagr(y3, last, days(DATES[i - 36], asof)) : null;
    if (r1y != null && r3y != null && r1y >= m.c1 && r3y >= m.c3) beat += v;
    const fl = tx.filter(t => t.sid === +sid).map(t => ({ d: t.d, a: -t.amt * t.flag })).concat([{ d: asof, a: v }]);
    const x = xirr(fl); if (x != null && x < 0) neg += v;
  }
  const P2 = Math.round(30 * beat / tot), P3 = Math.round(10 * (1 - neg / tot));

  const inst = [...tx.filter(t => t.typ === 'Systematic Investment'), ...rej].sort((a, b) => a.d < b.d ? -1 : 1);
  const paid = tx.filter(t => t.typ === 'Systematic Investment').length, attempts = inst.length;
  let consec = 0; for (let j = inst.length - 1; j >= 0 && inst[j].typ === 'SIP Rejection'; j--) consec++;
  let streak = 0; for (let j = inst.length - 1; j >= 0 && inst[j].typ === 'Systematic Investment'; j--) streak++;
  const D1 = attempts ? Math.max(0, Math.round(60 * paid / attempts) - 8 * consec) : 0;
  const D2 = Math.min(25, Math.round(25 * streak / 6));
  const D3 = (MANDATE && MANDATE.status === 'APPROVED' && MANDATE.start <= asof) ? 15 : 0;

  const w = Math.max(...Object.values(vals)) / tot * 100;
  const C1 = Math.round(50 * clamp((80 - w) / 40, 0, 1));
  const secs = {}, comps = {};
  for (const r of rawHold) { if (!vals[r.sid]) continue; const rs = r.w / 100 * vals[r.sid]; secs[r.sec] = (secs[r.sec] || 0) + rs; comps[r.nm] = (comps[r.nm] || 0) + rs; }
  const topSec = Math.max(...Object.values(secs), 0) / tot * 100, topCo = Math.max(...Object.values(comps), 0) / tot * 100;
  const C2 = Math.round(25 * clamp((40 - topSec) / 20, 0, 1));
  const C3 = Math.round(25 * clamp((15 - topCo) / 10, 0, 1));

  const houses = new Set(Object.keys(vals).map(s => SCHEMES[s].amc)).size;
  const classes = new Set(Object.keys(vals).map(s => /Corporate Bond|Liquid/.test(SCHEMES[s].cat) ? 'Debt'
    : /Gold/.test(SCHEMES[s].cat) ? 'Commodity' : /Hybrid|Arbitrage/.test(SCHEMES[s].cat) ? 'Hybrid' : 'Equity')).size;
  const breadth = new Set(rawHold.filter(r => vals[r.sid]).map(r => r.nm)).size;
  const V1 = Math.round(40 * clamp((houses - 1) / 2, 0, 1));
  const V2 = Math.round(30 * clamp(classes / 3, 0, 1));
  const V3 = Math.round(30 * clamp(breadth / 120, 0, 1));

  const covered = Object.entries(vals).reduce((s, [sid, v]) => {
    const f = FOLIOS.find(f => f.sid === +sid); return s + (f && f.nom ? v : 0); }, 0);
  const R1 = Math.round(50 * covered / tot);
  const dte = MANDATE ? days(obs, MANDATE.end) : null;
  const R2 = dte == null ? 0 : dte > 90 ? 30 : dte > 30 ? 15 : 5;
  const R3 = CLI.kyc ? 20 : 0;

  const areas = [
    ['Performance', [['Your rate against every investor on our books', P1, 60, px ? `you beat ${Math.round(px.pct * 100)}% of ${px.n}` : 'not enough history'],
      ['Consistent above category — 1 year and 3', P2, 30, `${Math.round(100 * beat / tot)}% of your value`],
      ['Drag from anything in the red', P3, 10, `${Math.round(100 * neg / tot)}% of value negative`]]],
    ['Discipline', [['On-time record', D1, 60, `${paid} of ${attempts} instalments`],
      ['The current streak', D2, 25, `${streak} in a row`],
      ['Auto-pay standing', D3, 15, MANDATE ? MANDATE.status.toLowerCase() : 'none']]],
    ['Concentration', [['Largest single fund — 40% ceiling', C1, 50, `${w.toFixed(1)}%`],
      ['Largest sector — 20% ceiling', C2, 25, `${topSec.toFixed(1)}%`],
      ['Largest company — 5% ceiling', C3, 25, `${topCo.toFixed(1)}%`]]],
    ['Diversification', [['Fund houses', V1, 40, `${houses}`],
      ['Asset classes', V2, 30, `${classes} of 3`],
      ['Breadth of companies', V3, 30, `${breadth}`]]],
    ['Protection', [['Nominee coverage', R1, 50, `${Math.round(100 * covered / tot)}% of value`],
      ['Mandate health', R2, 30, dte == null ? 'none' : dte < 0 ? 'expired' : `${Math.round(dte)} days left`],
      ['Identity papers', R3, 20, CLI.kyc ? 'current' : 'lapsed']]],
  ].map(([n, rules]) => ({ n, score: rules.reduce((s, r) => s + (r[1] ?? 0), 0), rules }));
  return { areas, total: Math.round(areas.reduce((s, a) => s + a.score, 0) / areas.length),
    w: r1(w), topSec: r1(topSec), topCo: r1(topCo), houses, classes, breadth,
    covered: r2(covered / tot * 100), coveredRs: Math.round(covered), paid, attempts, streak, consec,
    dte: dte == null ? null : Math.round(dte) };
}
const EXAM = examineAt(ASOF, TODAY);
note(`examination v0: ${EXAM.areas.map(a => a.n.slice(0, 4) + ' ' + a.score).join(' | ')} -> ${EXAM.total}/100`);
const EXAMHIST = ARC.map(a => { const e = examineAt(a[0]); return e ? [a[0], e.total, ...e.areas.map(x => x.score)] : null; }).filter(Boolean);
note(`examination history: ${EXAMHIST.length} editions, ${EXAMHIST[0][1]} -> ${EXAMHIST.at(-1)[1]}`);
/* ─────────────────── the road: acts ranked by points gained ─────────────────── */
const ROAD = [];
{
  const A = Object.fromEntries(EXAM.areas.map(a => [a.n, a]));
  const gap = (area, i, to) => Math.round((to - A[area].rules[i][1]) / 5);   // area points / 5 areas = overall points
  const unc = HOLD.filter(h => !NOMOF[h.folio]);
  if (unc.length) ROAD.push({ act: `Add a nominee to folio ${unc.map(h => h.folio).join(', ')}`, area: 'Protection',
    pts: gap('Protection', 0, 50), go: 'nomineeSheet',
    why: `₹${Math.round(unc.reduce((s, h) => s + h.mv, 0)).toLocaleString('en-IN')} — ${(100 - EXAM.covered).toFixed(0)}% of your wealth — has no nominee on record` });
  if (EXAM.dte != null && EXAM.dte <= 90) ROAD.push({ act: 'Renew the bank mandate, restart the SIP', area: 'Discipline + Protection',
    pts: gap('Discipline', 0, 60) + gap('Discipline', 1, 25) + gap('Protection', 1, 30), go: 'mandateSheet',
    why: `${EXAM.consec} instalments missed; the ${MANDATE.bank} mandate ends ${MANDATE.end}` });
  if (EXAM.houses < 3) ROAD.push({ act: 'Point new investing at a second fund house', area: 'Diversification + Concentration',
    pts: Math.round((40 * clamp((Math.min(EXAM.houses + 1, 3) - 1) / 2, 0, 1) - A.Diversification.rules[0][1]) / 5)
       + Math.round((50 * clamp((80 - EXAM.w * 0.85) / 40, 0, 1) - A.Concentration.rules[0][1]) / 5), go: 'overlapFix',
    why: `all ${EXAM.breadth} companies reach you through ${EXAM.houses} house${EXAM.houses > 1 ? 's' : ''}; one fund is ${EXAM.w}% of you` });
  if (EXAM.classes < 3) ROAD.push({ act: 'Add one holding outside equity', area: 'Diversification',
    pts: Math.round((30 * clamp((EXAM.classes + 1) / 3, 0, 1) - A.Diversification.rules[1][1]) / 5), go: 'shapesGo',
    why: `${EXAM.classes} of 3 asset classes present — every rupee rides the same weather` });
  ROAD.sort((a, b) => b.pts - a.pts);
  note(`road: ${EXAM.total} -> ${EXAM.total + ROAD.reduce((s, r) => s + r.pts, 0)} via ${ROAD.map(r => r.act.slice(0, 22) + ' +' + r.pts).join(' | ')}`);
}

/* ─────────────────── notices: generated from real events ─────────────────── */
const NOTICES = [];
{
  const push = (d, kind, text, go) => NOTICES.push({ d, kind, text, go: go || null });
  const money = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const ord = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
  if (EXAM.consec) push(REJECTED.at(-1).d, 'miss',
    `A <b>${ord[EXAM.consec - 1] || EXAM.consec + 'th'} consecutive</b> SIP month missed — ${money(EXAM.consec * SIPS[0].amt)} now idle.`, 'mandateSheet');
  let peak = 0, lastHigh = null;
  for (const [d, w] of ARC) if (w > peak) { peak = w; lastHigh = [d, w]; }
  if (lastHigh) push(lastHigh[0], 'high', `Portfolio touched <b>₹${(lastHigh[1] / 1e5).toFixed(2)}L — its highest mark</b> on record.`);
  for (let i = 1; i < ARC.length; i++) {
    const dp = (ARC[i][1] - ARC[i - 1][1]) / ARC[i - 1][1] * 100;
    if (dp <= -4) push(ARC[i][0], 'fall', `Your worth fell <b>${dp.toFixed(1)}%</b> in the month — ${money(Math.abs(ARC[i][1] - ARC[i - 1][1]))} on paper. Not one rupee left your folios.`);
  }
  for (const t of MONEY.filter(t => t.flag === -1))
    push(t.d, 'exit', `${money(t.amt)} withdrawn; those units are worth <b>${money(t.units * PX[t.sid][ASOF])} today</b>.`, 'mirrorOpen');
  const sipAmt = SIPS[0]?.amt || 25000;
  for (const t of MONEY.filter(t => t.flag === 1 && /Purchase/.test(t.typ) && t.amt >= 2 * sipAmt))
    push(t.d, 'lump', `A <b>${money(t.amt)}</b> lumpsum went to work in ${SCHEMES[t.sid].n} — ${money(t.units * PX[t.sid][ASOF])} today.`);
  const firstBySid = {}; for (const t of MONEY) if (!firstBySid[t.sid]) firstBySid[t.sid] = t;
  for (const t of Object.values(firstBySid).slice(1))
    push(t.d, 'new', `${SCHEMES[t.sid].n} joined your schedule — folio ${t.folio} opened.`);
  for (const f of FUNDS) for (const [d, val] of (f.elssFree || []))
    if (days(TODAY, d) > 0 && days(TODAY, d) < 550) push(TODAY, 'unlock', `<b>${money(val)}</b> of your ELSS turns three on ${d} and comes free.`, 'taxGo');
  if (EXAM.dte != null && EXAM.dte <= 30)
    push(TODAY, 'mandate', `Your ${MANDATE.bank} mandate ends <b>${MANDATE.end}</b> — ${EXAM.dte} day${EXAM.dte === 1 ? '' : 's'} away.`, 'mandateSheet');
  for (const h of HOLD) if (!NOMOF[h.folio])
    push(TODAY, 'nominee', `Folio ${h.folio} — <b>₹${(h.mv / 1e5).toFixed(2)}L</b> — still carries no nominee.`, 'nomineeSheet');
  for (const a of ATTN) { const e = JSON.parse(a.evidence);
    push(a.as_of, 'flag', `House rule flagged <b>${a.flag_type}</b> — folio ${e.folio} is ${e.weight_pct}% of your wealth.`, 'examGo'); }
  NOTICES.sort((a, b) => a.d < b.d ? 1 : -1);
}
note(`notices generated: ${NOTICES.length} (${[...new Set(NOTICES.map(n => n.kind))].join(', ')})`);

/* ─────────────────── editions archive ─────────────────── */
const EDITIONS = ARC.map(([d, w, inv], i) => {
  const prev = i ? ARC[i - 1] : null;
  const dw = prev ? w - prev[1] : null, dinv = prev ? inv - prev[2] : null;
  const e = EXAMHIST.find(x => x[0] === d);
  return { no: i + 1, d, w, inv, earned: w - inv, dw, dinv, mkt: dw == null ? null : dw - dinv, exam: e ? e[1] : null,
    n: NOTICES.filter(x => x.d > (prev ? prev[0] : '0000-00-00') && x.d <= d).length };
}).reverse();
note(`editions archive: ${EDITIONS.length}; current is No. ${EDITIONS[0].no} (${EDITIONS[0].d})`);

/* ─────────────────── the Mirror: entries generated from history ─────────────────── */
const MIRROR = [];
{
  const nav = (sid) => PX[sid][ASOF];
  const money = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
  const months = Math.round(days(MONEY[0].d, ASOF) / 30.44);
  const eng = FUNDS.reduce((a, b) => a.mv > b.mv ? a : b);
  let worstDrop = 0, worstAt = null, falls = 0;
  for (let i = 1; i < ARC.length; i++) { const dp = (ARC[i][1] - ARC[i - 1][1]) / ARC[i - 1][1] * 100;
    if (dp < 0) falls++; if (dp < worstDrop) { worstDrop = dp; worstAt = ARC[i][0]; } }
  const monthName = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'long' });

  MIRROR.push({ k: 'patience', dd: `${MONEY[0].d} → today`, sign: 1,
    deed: `You stayed. Through every dip, including ${monthName(worstAt)}’s ${worstDrop.toFixed(1)}%.`,
    cv: `+${money(TOTMV - TOTCOST)}`, cl: 'earned by patience',
    verd: `The hardest thing in investing is nothing — and you did it for ${months} months. ${falls} of those months fell, and not one rupee left in fear.` });

  const sipTx = MONEY.filter(t => t.sid === eng.sid && t.typ === 'Systematic Investment');
  const cheap = Math.min(...sipTx.map(t => t.px)), dear = Math.max(...sipTx.map(t => t.px));
  MIRROR.push({ k: 'instalments', dd: `${sipTx.length} instalments`, sign: eng.xirr >= eng.own ? 1 : -1,
    deed: 'You bought every month — including the months that hurt.',
    cv: `${eng.xirr.toFixed(2)}% vs ${eng.own.toFixed(2)}%`, cl: 'you, against your own fund',
    verd: `Cheap months bought more units; the recovery paid them best. The same ₹${sipTx[0].amt.toLocaleString('en-IN')} bought ${(sipTx[0].amt / cheap).toFixed(0)} units at your best price and ${(sipTx[0].amt / dear).toFixed(0)} at your worst — the average did the work.` });

  for (const t of MONEY.filter(t => t.flag === -1)) {
    const now = t.units * nav(t.sid), diff = now - t.amt;
    MIRROR.push({ k: 'exit', id: 'x' + t.d, dd: t.d, sign: diff > 0 ? -1 : 1,
      deed: `You withdrew ${money(t.amt)} from ${SCHEMES[t.sid].n}.`,
      cv: `${diff > 0 ? '−' : '+'}${money(Math.abs(diff))}`, cl: 'the exit’s cost, so far',
      verd: `Those ${t.units.toFixed(3)} units would be worth ${money(now)} this morning. Printed not to scold — the habit is what compounds, in either column.`, strike: true });
  }
  if (EXAM.consec) {
    const missed = REJECTED.slice(-EXAM.consec);
    const wouldBe = missed.reduce((s, t) => s + (t.amt / t.px) * nav(t.sid), 0);
    MIRROR.push({ k: 'miss', dd: missed.map(t => new Date(t.d).toLocaleDateString('en-GB', { month: 'short' })).join(' · '), sign: -1,
      deed: `${EXAM.consec} instalments missed — a mandate quietly expiring.`,
      cv: money(EXAM.consec * SIPS[0].amt), cl: 'standing idle',
      verd: `Not a decision — an expiry. Collected, they would stand at ${money(wouldBe)} today. The right column doesn’t know the difference, and it is charging you anyway.`,
      act: { label: 'Renew — restart the streak', go: 'mandateSheet' } });
  }
  { const step = 5000; let units = 0, put = 0;
    for (const t of sipTx) { units += step / t.px; put += step; }
    const would = units * nav(eng.sid);
    MIRROR.push({ k: 'stepup', dd: 'A page from tomorrow', sign: 1,
      deed: `Had you added ₹${step.toLocaleString('en-IN')} a month from the first instalment —`,
      cv: `+${money(would - put)}`, cl: 'more, by this morning',
      verd: `Replayed on your own fund’s true prices — ₹${(put / 1e5).toFixed(2)}L more in would stand at ₹${(would / 1e5).toFixed(2)}L. History, not a promise; consistency, not timing.`,
      act: { label: 'Put it on Ravi’s desk', go: 'mravi' } }); }
  const lumps = MONEY.filter(t => t.flag === 1 && /Purchase/.test(t.typ) && t.amt >= 2 * (SIPS[0]?.amt || 25000));
  if (lumps.length) {
    const big = lumps.reduce((a, b) => a.amt > b.amt ? a : b), now = big.units * nav(big.sid);
    MIRROR.push({ k: 'lump', dd: big.d, sign: now >= big.amt ? 1 : -1,
      deed: `You put ${money(big.amt)} in at once — your largest single decision.`,
      cv: `${now >= big.amt ? '+' : '−'}${money(Math.abs(now - big.amt))}`, cl: 'since that day',
      verd: `Bought at ₹${big.px.toFixed(2)}; ₹${nav(big.sid).toFixed(2)} this morning — ${((now / big.amt - 1) * 100).toFixed(1)}% in ${Math.round(days(big.d, ASOF) / 30.44)} months. Courage, dated and priced.` });
  }
}
note(`mirror entries generated: ${MIRROR.length} (${MIRROR.map(m => m.k).join(', ')})`);

/* ─────────────────── quarterly story ─────────────────── */
const QUARTERS = [];
{
  const qOf = (d) => d.slice(0, 4) + '-Q' + Math.ceil(+d.slice(5, 7) / 3);
  const byQ = {};
  for (const p of ARC) (byQ[qOf(p[0])] ||= []).push(p);
  const keys = Object.keys(byQ).sort();
  for (const k of keys.slice(-4)) {
    const pts = byQ[k], last = pts.at(-1), prevKey = keys[keys.indexOf(k) - 1];
    const open = prevKey ? byQ[prevKey].at(-1) : pts[0];
    const dw = last[1] - open[1], din = last[2] - open[2];
    const tx = MONEY.filter(t => qOf(t.d) === k), rej = REJECTED.filter(t => qOf(t.d) === k);
    const best = tx.filter(t => t.flag === 1).map(t => ({ t, gain: t.units * PX[t.sid][ASOF] - t.amt })).sort((a, b) => b.gain - a.gain)[0];
    QUARTERS.push({ k, label: 'Q' + k.slice(-1) + ' ' + k.slice(0, 4), open: open[1], close: last[1], dw, din, mkt: dw - din,
      inCount: tx.filter(t => t.flag === 1).length, outCount: tx.filter(t => t.flag === -1).length, missed: rej.length,
      best: best ? { d: best.t.d, amt: best.t.amt, gain: Math.round(best.gain), fund: SCHEMES[best.t.sid].n } : null,
      exam: EXAMHIST.filter(e => qOf(e[0]) === k).at(-1)?.[1] ?? null });
  }
}
note(`quarterly spreads: ${QUARTERS.length} (${QUARTERS.map(x => x.label).join(', ')})`);

/* ─────────────────── tax page ─────────────────── */
const TAX = { unlocks: [], exitLoad: [], realised: [], asof: ASOF };
{
  for (const f of FUNDS) for (const [d, val, u] of (f.elssFree || []))
    TAX.unlocks.push({ d, val, u, fund: f.name, days: Math.round(days(TODAY, d)) });
  TAX.unlocks.sort((a, b) => a.d < b.d ? -1 : 1);

  let ltGain = 0, ltVal = 0, stGain = 0, stVal = 0;
  for (const f of FUNDS) {
    const lots = lotsOf(f.sid);
    const locked = lots.filter(l => days(l.d, TODAY) < 365), free = lots.filter(l => days(l.d, TODAY) >= 365);
    TAX.exitLoad.push({ fund: f.name, sid: f.sid, elss: !!f.elssFree, load: SCHEMES[f.sid].exl,
      freeU: r2(free.reduce((s, l) => s + l.u, 0)), freeRs: Math.round(free.reduce((s, l) => s + l.u, 0) * f.nav),
      lockedU: r2(locked.reduce((s, l) => s + l.u, 0)), lockedRs: Math.round(locked.reduce((s, l) => s + l.u, 0) * f.nav),
      nextFree: locked.length ? addYears(locked[0].d, 1) : null, allFreeBy: locked.length ? addYears(locked.at(-1).d, 1) : null });
    for (const l of lots) {
      const g = l.u * (f.nav - l.p), v = l.u * f.nav;
      if (days(l.d, TODAY) >= 365) { ltGain += g; ltVal += v; } else { stGain += g; stVal += v; }
    }
  }
  const fyOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return (m >= 4 ? y : y - 1) + '–' + String(m >= 4 ? y + 1 : y).slice(2); };
  for (const s of q(`SELECT l.tr_date d, l.sell_unit u, l.sell_price sp, l.holding_days hd, p.purchase_price pp, l.scheme_id sid
                     FROM fifo_purchase_sales_log l LEFT JOIN fifo_purchase_log p ON p.id=l.fifo_purchase_log_id
                     WHERE l.acc_id=?`, ACC)) {
    const buy = s.pp ?? MONEY.filter(t => t.sid === s.sid && t.flag === 1)[0]?.px;
    TAX.realised.push({ fy: fyOf(s.d), d: s.d, fund: SCHEMES[s.sid].n, u: r2(s.u), gain: Math.round(s.u * (s.sp - buy)),
      term: s.hd >= 365 ? 'Long' : 'Short', hd: s.hd, buy: r2(buy), sell: r2(s.sp) });
  }
  TAX.currentFy = fyOf(TODAY);
  const EXEMPT = 125000, realisedLtThisFy = TAX.realised.filter(r => r.fy === TAX.currentFy && r.term === 'Long').reduce((s, r) => s + r.gain, 0);
  TAX.ltcg = { ltGain: Math.round(ltGain), ltVal: Math.round(ltVal), stGain: Math.round(stGain), stVal: Math.round(stVal),
    exempt: EXEMPT, realisedLtThisFy, headroom: Math.max(0, EXEMPT - realisedLtThisFy),
    taxableIfAllSold: Math.round(Math.max(0, ltGain - Math.max(0, EXEMPT - realisedLtThisFy))), rate: 12.5, strate: 20 };
}
note(`tax: ${TAX.unlocks.length} ELSS unlocks, notional LT gain ₹${TAX.ltcg.ltGain} on ₹${TAX.ltcg.ltVal}, ST ₹${TAX.ltcg.stGain}; realised rows ${TAX.realised.length}`);

/* ─────────────────── what Jhaveri earns ─────────────────── */
const FEE = { rows: [], byFy: {} };
{
  const rows = q(`SELECT bkr_folio_no folio, fk_scheme_id sid, bkr_from_date f, tr_amount base, bkr_percentage pct, bkr_amount amt
                  FROM brokerage_master WHERE bkr_folio_no IN (${HOLD.map(h => `'${h.folio}'`).join(',')}) ORDER BY bkr_from_date`);
  const fyOf = (d) => { const y = +d.slice(0, 4), m = +d.slice(5, 7); return (m >= 4 ? y : y - 1) + '–' + String(m >= 4 ? y + 1 : y).slice(2); };
  for (const r of rows) {
    const plan = /Dir/.test(SCHEMES[r.sid].n) ? 'Direct' : 'Regular', fy = fyOf(r.f);
    const b = (FEE.byFy[fy] ||= { total: 0, Regular: 0, Direct: 0, months: new Set() });
    b.total += r.amt; b[plan] += r.amt; b.months.add(r.f.slice(0, 7));
    FEE.rows.push({ folio: r.folio, sid: r.sid, plan, m: r.f.slice(0, 7), base: Math.round(r.base), pct: r.pct, amt: r2(r.amt), fy });
  }
  for (const k of Object.keys(FEE.byFy)) FEE.byFy[k] = { total: r2(FEE.byFy[k].total), Regular: r2(FEE.byFy[k].Regular), Direct: r2(FEE.byFy[k].Direct), months: FEE.byFy[k].months.size };
  FEE.card = q1(`SELECT agreed_trail_bps bps, effective_from f, source_doc_ref src FROM amc_rate_card WHERE amc_id=13 AND scheme_category='Equity'`);
  FEE.regular = FUNDS.filter(f => f.plan === 'Regular').map(f => ({ name: f.name, mv: f.mv, bps: FEE.card.bps, yr: r2(f.mv * FEE.card.bps / 10000) }));
  FEE.runRate = r2(FEE.regular.reduce((s, f) => s + f.yr, 0));
  FEE.directBooked = r2(FEE.rows.filter(r => r.plan === 'Direct').reduce((s, r) => s + r.amt, 0));
  FEE.fyToDate = r2(FEE.rows.filter(r => r.fy === TAX.currentFy && r.plan === 'Regular').reduce((s, r) => s + r.amt, 0));
  FEE.fyMonths = new Set(FEE.rows.filter(r => r.fy === TAX.currentFy && r.plan === 'Regular').map(r => r.m)).size;
}
note(`fee: ${FEE.rows.length} brokerage rows; Regular run-rate ₹${FEE.runRate}/yr, FY${TAX.currentFy} to date ₹${FEE.fyToDate} over ${FEE.fyMonths} months`);
note(`  SEED CONFLICT: brokerage_master books ₹${FEE.directBooked} of trail against DIRECT plans — Direct pays no distributor trail. Page prints ₹0 for Direct.`);

/* ─────────────────── rolling 1-year returns ─────────────────── */
const ROLL = {};
for (const s of Object.values(SCHEMES)) {
  const px = PX[s.id], wins = [];
  for (let i = 12; i < DATES.length; i++) { const a = px[DATES[i - 12]], b = px[DATES[i]]; if (a != null && b != null) wins.push((b / a - 1) * 100); }
  if (wins.length < 6) continue;
  const so = [...wins].sort((a, b) => a - b);
  ROLL[s.id] = { n: wins.length, best: r1(so.at(-1)), worst: r1(so[0]), med: r1(so[Math.floor(so.length / 2)]),
    pos: Math.round(100 * wins.filter(w => w > 0).length / wins.length) };
}
note(`rolling 1y: ${Object.keys(ROLL).length} schemes, ${ROLL[1].n} windows each (monthly grain, ${DATES[0]}→${ASOF})`);

/* ─────────────────── Jhaveri Picks scoreboard ─────────────────── */
const PICKS = Object.values(SCHEMES).filter(s => s.pick).map(s => {
  const start = DATES[0], mine = cagr(PX[s.id][start], PX[s.id][ASOF], days(start, ASOF));
  const peers = Object.values(SCHEMES).filter(x => x.cat === s.cat);
  const catRet = peers.reduce((t, x) => t + cagr(PX[x.id][start], PX[x.id][ASOF], days(start, ASOF)), 0) / peers.length;
  return { id: s.id, n: s.n, cat: s.cat, since: start, ret: r1(mine), catRet: r1(catRet), beat: mine >= catRet, exp: s.exp, risk: s.risk, held: !!mvBySid[s.id] };
}).sort((a, b) => b.ret - a.ret);
note(`picks scoreboard: ${PICKS.length} picks, ${PICKS.filter(p => p.beat).length} above their category average since ${DATES[0]}`);

/* ─────────────────── market wire (real benchmark) ─────────────────── */
const bd = Object.keys(BENCH).sort(), bi = bd.indexOf(ASOF);
const WIRE = { name: 'NIFTY 500 TRI', asof: ASOF, prev: bd[bi - 1], grain: 'monthly',
  m1: r2((BENCH[ASOF] / BENCH[bd[bi - 1]] - 1) * 100),
  y1: r2((BENCH[ASOF] / BENCH[bd[bi - 12]] - 1) * 100),
  y3: r1(cagr(BENCH[bd[bi - 36]], BENCH[ASOF], days(bd[bi - 36], ASOF))),
  mine1: r2((ARC.at(-1)[1] - ARC.at(-2)[1] - (ARC.at(-1)[2] - ARC.at(-2)[2])) / ARC.at(-2)[1] * 100),
  mineRs: ARC.at(-1)[1] - ARC.at(-2)[1] - (ARC.at(-1)[2] - ARC.at(-2)[2]), herX: r2(HERX) };
note(`wire: market ${WIRE.m1}% month / ${WIRE.y1}% year / ${WIRE.y3}%/yr over 3; her ${WIRE.mine1}% month (₹${WIRE.mineRs})`);

/* ─────────────────── search index over all 60 funds ─────────────────── */
const SEARCH = Object.values(SCHEMES).map(s => ({ id: s.id, n: s.n, cat: s.cat, amc: s.amcn,
  k: [s.n, s.cat, s.amcn, s.risk, /Dir/.test(s.n) ? 'direct' : 'regular', s.pick ? 'jhaveri pick house list' : '',
      /ELSS/.test(s.cat) ? 'tax saver 80c saving' : '', /Small/.test(s.cat) ? 'smallcap' : '',
      /Mid/.test(s.cat) ? 'midcap' : '', /Large/.test(s.cat) ? 'largecap bluechip' : '',
      /Gold/.test(s.cat) ? 'commodity bullion' : '', /Liquid|Bond/.test(s.cat) ? 'debt income safe' : ''].join(' ').toLowerCase() }));

/* ─────────────────── assemble ─────────────────── */
const F2 = {
  asof: ASOF, today: TODAY,
  client: { n: CLI.n, pan: CLI.pan.slice(0, 3) + '····' + CLI.pan.slice(-1), dob: CLI.dob,
    mob: '·····' + CLI.mob.slice(-4), em: CLI.em, kyc: !!CLI.kyc, ucc: ACCT.ucc, act: ACCT.act, fam: CLI.fam },
  tot: { mv: Math.round(TOTMV), cost: Math.round(TOTCOST), earned: Math.round(TOTMV - TOTCOST), xirr: r2(HERX),
    moves: MONEY.length, txns: LEDGER.length, since: MONEY[0].d, pct: r1(PCT.pct * 100), pctN: PCT.n },
  funds: FUNDS, arc: ARC, editions: EDITIONS,
  ledger: LEDGER.map(t => ({ d: t.d, sid: t.sid, folio: t.folio, typ: t.typ, st: t.st, amt: t.amt, u: r2(t.units), px: t.px })),
  reg: REG, sectors: SECTORS, caps: CAPS, coverage: r2(COVERAGE), holdAsOf: rawHold[0].d,
  exam: EXAM, examHist: EXAMHIST, road: ROAD, notices: NOTICES, mirror: MIRROR, quarters: QUARTERS,
  tax: TAX, fee: FEE, roll: ROLL, picks: PICKS, wire: WIRE, search: SEARCH, names: NAMES, fh: FH,
  mandate: MANDATE, sxp: SXP[0] || null, sips: SIPS, folios: FOLIOS, consents: CONSENTS,
  cat: Object.fromEntries(Object.entries(catMean).map(([k, v]) => [k, { c1: r1(v.c1), c3: r1(v.c3) }])),
  log,
};

const json = JSON.stringify(F2);
writeFileSync(join(HERE, 'data/folio2.json'), json);
console.log(`\nwrote data/folio2.json — ${(json.length / 1024).toFixed(0)} KB`);

const htmlPath = join(HERE, 'folio.html');
let html = readFileSync(htmlPath, 'utf8');
const marker = /\/\*F2\*\/[\s\S]*?\/\*F2END\*\//;
if (!marker.test(html)) { console.error('!! /*F2*/ … /*F2END*/ markers not found in folio.html — not inlined'); process.exit(1); }
html = html.replace(marker, '/*F2*/const F2=' + json + ';/*F2END*/');
writeFileSync(htmlPath, html);
console.log(`inlined into folio.html — ${(html.length / 1024).toFixed(0)} KB total`);
