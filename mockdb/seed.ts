// Deterministic seed for the Jhaveri OS mock database.
// Usage: npm run seed  →  mockdb/jhaveri.db
// Same seed, same database, every run. Every derived figure (XIRR, gains, payouts)
// is computed by the engines — never typed in.

import Database from 'better-sqlite3';
import { readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  rng, pick, between, intBetween, chance, round2, round4,
  TODAY, addDays, daysBetween, monthStart,
  makeNavSeries, navAt, NavSeries, xirr, runFifo, unrealizedSplit, Txn,
} from './engines';

const DIR = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(DIR, 'jhaveri.db');
// The app opens this db in WAL mode; a fresh file must not inherit the old
// -wal/-shm sidecars or SQLite fails with a disk I/O error.
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(readFileSync(join(DIR, 'schema.sql'), 'utf8'));

const r = rng(20260807);
const stmtCache = new Map<string, Database.Statement>();
function ins(table: string, row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const sig = table + ':' + keys.join(',');
  let st = stmtCache.get(sig);
  if (!st) {
    st = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(k => '@' + k).join(',')})`);
    stmtCache.set(sig, st);
  }
  st.run(row);
}

interface EventIn {
  at: string; actorType?: string; actorId?: string | number;
  subjectType: string; subjectId: string | number; type: string;
  payload?: unknown; source?: string;
}
let eventId = 0;
function emit(e: EventIn) {
  ins('events', {
    event_id: ++eventId, occurred_at: e.at, actor_type: e.actorType ?? 'system',
    actor_id: String(e.actorId ?? 'seed'), subject_type: e.subjectType,
    subject_id: String(e.subjectId), event_type: e.type,
    payload: e.payload ? JSON.stringify(e.payload) : null, source: e.source ?? 'system',
  });
}

const FIRST = ['Meera', 'Arjun', 'Rajesh', 'Priya', 'Amit', 'Sneha', 'Vikram', 'Kavita', 'Suresh', 'Anita', 'Rahul', 'Pooja', 'Nilesh', 'Deepa', 'Kiran', 'Manish', 'Rekha', 'Sanjay', 'Falguni', 'Harsh', 'Jigna', 'Ketan', 'Lata', 'Mahesh', 'Nisha', 'Paresh', 'Rita', 'Tushar', 'Usha', 'Yash'];
const LAST = ['Shah', 'Patel', 'Desai', 'Mehta', 'Joshi', 'Trivedi', 'Vyas', 'Parikh', 'Gandhi', 'Modi', 'Bhatt', 'Dave', 'Rana', 'Solanki', 'Chauhan', 'Pandya', 'Raval', 'Thakkar', 'Kapoor', 'Rao'];
function pan(i: number) { const L = 'ABCDEFGHJKLMNPRSTUVWXYZ'; const c = (n: number) => L[n % L.length]; return `${c(i)}${c(i + 3)}${c(i + 7)}P${c(i + 11)}${String(1000 + (i * 37) % 9000)}${c(i + 13)}`; }

const ASSETS = ['Equity', 'Debt', 'Hybrid', 'Commodities', 'Solution Oriented', 'Other Schemes'];
ASSETS.forEach((a, i) => ins('main_asset_master', { id: i + 1, main_asset_name: a }));
const CATS: [string, number][] = [['Flexi Cap', 1], ['Large Cap', 1], ['Mid Cap', 1], ['Small Cap', 1], ['ELSS (Tax Savings)', 1], ['Corporate Bond', 2], ['Liquid', 2], ['Aggressive Hybrid', 3], ['Arbitrage Fund', 3], ['Gold FoF', 4]];
CATS.forEach(([name, asset], i) => ins('category_master', { category_id: i + 1, category_name: name, fk_main_asset_id: asset }));
const BENCH = ['NIFTY 500 TRI', 'NIFTY 100 TRI', 'NIFTY Midcap 150 TRI', 'NIFTY Smallcap 250 TRI', 'CRISIL Corporate Bond Index', 'CRISIL Liquid Index', 'CRISIL Hybrid 35+65 Index', 'Domestic Gold Index'];
BENCH.forEach((b, i) => ins('benchmark_master', { benchmark_id: i + 1, benchmark_name: b }));
const catBench = [1, 2, 3, 4, 1, 5, 6, 7, 7, 8];
// Real funds, their real holdings, real sectors — a slice of Atlas (the fund
// manager's system) snapshotted by mockdb/extract-atlas.sh. Atlas is a data
// source only; nothing in the app links to it. The real build ingests these same
// shapes from the AMC portfolio-disclosure feed.
interface AtlasHolding { stock_id: string; stock: string; sector: string; industry: string | null; weight: number; cap_band: string | null }
interface AtlasFund { mstar_id: string; fund_name: string; amc_name: string; category: string; holdings: AtlasHolding[] }
interface AtlasStock { stock_id: string; name: string; sector: string; industry: string | null; cap_band: string | null; market_cap: number | null }
const atlas = JSON.parse(readFileSync(join(DIR, 'atlas-slice.json'), 'utf8')) as
  { as_of: string; funds: AtlasFund[]; stocks: AtlasStock[] };
const ATLAS_CAT: Record<string, string> = {
  'India Fund Flexi Cap': 'Flexi Cap', 'India Fund Large-Cap': 'Large Cap',
  'India Fund Mid-Cap': 'Mid Cap', 'India Fund Small-Cap': 'Small Cap',
  'India Fund ELSS (Tax Savings)': 'ELSS (Tax Savings)',
};
const atlasByCat = new Map<string, AtlasFund[]>();
for (const f of atlas.funds) {
  const c = ATLAS_CAT[f.category];
  if (!c) continue;
  if (!atlasByCat.has(c)) atlasByCat.set(c, []);
  atlasByCat.get(c)!.push(f);
}
for (const st of atlas.stocks) {
  ins('stock_master', { stock_id: st.stock_id, stock_name: st.name, sector: st.sector, industry: st.industry, cap_band: st.cap_band, market_cap: st.market_cap });
}

const SYNTH_AMCS = ['HDFC', 'ICICI Prudential', 'SBI', 'Axis', 'Kotak', 'Nippon India', 'Aditya Birla SL', 'UTI', 'Mirae Asset', 'DSP', 'Tata', 'Franklin India'];
const REAL_AMCS = [...new Set(atlas.funds.map(f => f.amc_name))];
const AMCS = [...SYNTH_AMCS, ...REAL_AMCS];
const amcId = new Map<string, number>();
AMCS.forEach((a, i) => {
  const label = SYNTH_AMCS.includes(a) ? a + ' Mutual Fund' : a;
  amcId.set(a, i + 1);
  ins('amc_master', { amc_id: i + 1, amc_name: label });
});

const TXN_TYPES: [number, string, number, Partial<Record<string, number>>][] = [
  [1, 'Purchase', 1, {}], [2, 'Redemption', -1, {}], [3, 'Systematic Investment', 1, {}],
  [5, 'Switch In', 1, {}], [6, 'Switch Out', -1, {}], [20, 'Additional Purchase', 1, {}],
  [22, 'Systematic Withdrawal', -1, {}], [9, 'Dividend Reinvest', 1, {}],
  [10, 'Dividend Paid', 0, { tr_type_add_in_fifo: 0 }],
  [33, 'SIP Rejection', 0, { tr_type_add_in_fifo: 0, tr_type_add_in_xirr: 0, tr_type_add_in_tax: 0, tr_type_add_in_capital_gains: 0, tr_type_add_in_portfolio_valuation: 0 }],
];
TXN_TYPES.forEach(([id, name, flag, over]) => ins('transaction_type_master', { tr_type_id: id, tr_type_name: name, tr_type_buy_sell_flag: flag, tr_type_add_in_fifo: 1, tr_type_add_in_xirr: 1, tr_type_add_in_tax: 1, tr_type_add_in_capital_gains: 1, tr_type_add_in_portfolio_valuation: 1, ...over }));
([['Fresh Purchase', 1], ['Systematic - Instalment', 3], ['Full Redemption', 2], ['Systematic84/ER04: Insufficient Balance', 33]] as [string, number][]).forEach(([d, t], i) => ins('rta_trxn_type', { rta_trxn_type_id: i + 1, rta_trxn_type_desc: d, fk_tr_type_id: t }));
['Pending', 'Completed', 'Failed', 'Pending with AMC', 'Rejected', 'Payment Pending', 'Client Confirmation Pending', 'Initiated', 'Approved', 'Expired'].forEach((s, i) => ins('trans_status_master', { trans_status_id: i + 1, trans_status_name: s }));
ins('frequency_master', { freq_id: 1, freq_code: 'OM', freq_name: 'Monthly' });
ins('gst_master', { gst_id: 1, gst_percentage: 18.0, from_date: '2017-07-01' });
ins('capital_gain_period_master', { id: 1, fk_asset_id: 1, from_date: '2024-07-23', holding_period_years: 1, gain_term_if_less_than: 'SE', gain_term_if_equal_or_more_than: 'LE' });
ins('capital_gain_period_master', { id: 2, fk_asset_id: 2, from_date: '2024-07-23', holding_period_years: 3, gain_term_if_less_than: 'SD', gain_term_if_equal_or_more_than: 'LD' });
([['ERR-00000', 'Success'], ['ERR-00009', 'INVALID PAN'], ['ERR-00004', 'ADDRESS ON APPLICATION NOT MATCHING WITH PROOF'], ['ERR-00010', 'MINOR PAN CARD COPY SUBMITTED'], ['ERR-00031', 'KYC DOCUMENTS NOT RECEIVED WITHIN DEFINED TAT'], ['ERR-00017', 'SIGNATURE MISMATCH WITH PROOF']] as [string, string][]).forEach(([c, d], i) => ins('kra_error_codes', { id: i + 1, error_code: c, error_description: d }));

const TIERS = [['Silver', 60], ['Silver Plus', 65], ['Gold', 70], ['Gold Plus', 75], ['Diamond', 80], ['Platinum', 90], ['BRONZE', 40], ['MOTI', 50], ['Urja', 67], ['YASH', 48]] as const;
TIERS.forEach(([n], i) => ins('sub_broker_category_master', { cat_id: i + 1, cat_category_name: n }));
TIERS.forEach(([, pct], i) => ins('broker_category_payout_pct_master', { payout_id: i + 1, fk_sb_category_id: i + 1, trail_1st_yr_pct: pct, from_date: '2024-04-01', is_active: 1 }));

([['Head Office', null, 1], ['West - Wealth', 1, 2], ['West - B2C', 1, 2], ['West - B2B', 1, 2], ['Vadodara Branch', 2, 4], ['Bhavnagar Branch', 2, 4]] as [string, number | null, number][]).forEach(([n, p, ty], i) =>
  ins('territory_master', { territory_id: i + 1, territory_name: n, parent_territory: p, fk_territory_type_id: ty, territory_city: 'Vadodara' }));

const RULES: [string, string, Record<string, number>][] = [
  ['sip_bounce_x2', 'SIP bounced ≥2 in window', { bounces: 2, window_days: 90 }],
  ['dormant_client', 'No transaction for N months with value above floor', { months: 14, min_value: 500000 }],
  ['concentration_pct', 'Single scheme above % of a multi-scheme portfolio', { max_weight: 45, min_schemes: 3, min_value: 500000 }],
  ['laggard_vs_benchmark', 'Scheme XIRR below benchmark by gap over horizon', { gap_pct: 10, min_value: 500000 }],
  ['bottom_percentile', 'Client XIRR in bottom decile of comparable book', { percentile: 10, min_value: 100000 }],
  ['kyc_stall_days', 'Onboarding stalled at a step', { days: 7 }],
  ['tax_window_headroom', 'Unrealized LTCG within FY exemption window', { exemption: 125000, min_gain: 40000 }],
  ['large_redemption', 'Single redemption above threshold', { amount: 500000 }],
];
RULES.forEach(([k, name, params], i) => ins('rules_registry', { rule_id: i + 1, rule_key: k, name, params: JSON.stringify(params), version: 1, owner: 'ops', approved_by: 'management', is_active: 1, valid_from: '2026-08-01' }));

interface SchemeSeed { id: number; name: string; amc: number; cat: number; bench: number; series: NavSeries; equity: boolean }
const schemes: SchemeSeed[] = [];
const CAT_PROFILE: Record<number, [number, number, number]> = { 1: [0.14, 0.16, 45], 2: [0.12, 0.13, 60], 3: [0.17, 0.22, 55], 4: [0.19, 0.28, 40], 5: [0.14, 0.17, 30], 6: [0.07, 0.02, 28], 7: [0.065, 0.005, 35], 8: [0.11, 0.11, 32], 9: [0.07, 0.015, 24], 10: [0.10, 0.14, 20] };
const STYLE = ['Fund', 'Opportunities Fund', 'Advantage Fund', 'Growth Fund'];
const histStmt = db.prepare('INSERT INTO mf_historical_price_master (fk_scheme_id, price_date, price) VALUES (?,?,?)');
for (let i = 0; i < 60; i++) {
  const cat = (i % 10) + 1;
  const amc = (i % 12) + 1;
  const [drift, vol, startNav] = CAT_PROFILE[cat];
  const series = makeNavSeries(r, startNav * between(r, 0.7, 1.4), 44, drift + between(r, -0.03, 0.03), vol, TODAY);
  const equity = cat <= 5;
  // Equity schemes ARE real funds (name, AMC, holdings) from the Atlas slice;
  // non-equity keep synthetic identities — Atlas's universe is equity-only, and
  // a liquid or gold fund has no stock look-through to show.
  const pool = atlasByCat.get(CATS[cat - 1][0]) ?? [];
  const real = equity ? pool[Math.floor(i / 10) % Math.max(pool.length, 1)] : undefined;
  // "Arbitrage Fund" + "Fund" reads as a typo to anyone looking at a report, so a
  // category that already names the vehicle does not take a style word.
  const catName = CATS[cat - 1][0];
  const style = pick(r, STYLE);
  const name = real ? real.fund_name
    : /Fund$|FoF$/.test(catName) ? `${AMCS[amc - 1]} ${catName}`
      : `${AMCS[amc - 1]} ${catName} ${style}`;
  const useAmc = real ? (amcId.get(real.amc_name) ?? amc) : amc;
  const s: SchemeSeed = { id: i + 1, name, amc: useAmc, cat, bench: catBench[cat - 1], series, equity };
  schemes.push(s);
  const latest = series.navs[series.navs.length - 1];
  ins('scheme_master', { scheme_id: s.id, scheme_full_name: name, scheme_short_name: name, fk_amc_id: useAmc, fk_category_id: cat, fk_benchmark_id: s.bench, scheme_amfi_code: String(100000 + i), scheme_isin_code: `INF${200 + amc}K0${1000 + i}`, scheme_rta: chance(r, 0.55) ? 'C' : 'K', scheme_exit_load: equity ? 1 : 0, scheme_expense_ratio: round2(between(r, 0.4, 1.9)), scheme_day_end_nav: latest, scheme_day_end_nav_date: TODAY, risk_level: equity ? 'Very High' : 'Moderate', is_jhaveri_pick: chance(r, 0.18) ? 1 : 0 });
  ins('mf_latest_price_master', { fk_scheme_id: s.id, price: latest, price_date: TODAY });
  series.dates.forEach((d, j) => histStmt.run(s.id, d, series.navs[j]));
  if (real) {
    for (const h of real.holdings) {
      ins('mf_scheme_holdings', { fk_scheme_id: s.id, stock_id: h.stock_id, weight_pct: h.weight, as_of_date: atlas.as_of });
    }
  }
}
// Meera's story facts are pinned, not left to wherever the RNG lands: two real
// flexi-cap funds that genuinely overlap, plus a genuine laggard. The laggard is
// picked from the data — the equity scheme whose NAV has trailed its own
// benchmark hardest over two years — so it stays true if the series change.
const MEERA_FUNDS: SchemeSeed[] = [];
const benchSeries = new Map<number, NavSeries>();
const benchStmt = db.prepare('INSERT INTO benchmark_price_history (fk_benchmark_id, price_date, price) VALUES (?,?,?)');
for (let b = 1; b <= 8; b++) {
  const bs = makeNavSeries(r, 100, 44, [0.13, 0.12, 0.15, 0.16, 0.07, 0.065, 0.10, 0.09][b - 1], [0.14, 0.12, 0.18, 0.22, 0.02, 0.004, 0.09, 0.12][b - 1], TODAY);
  benchSeries.set(b, bs);
  bs.dates.forEach((d, j) => benchStmt.run(b, d, bs.navs[j]));
}
{
  const from = addDays(TODAY, -730);
  const growth = (s: NavSeries) => navAt(s, TODAY) / navAt(s, from) - 1;
  const ranked = schemes.filter(s => s.equity)
    .map(s => ({ s, gap: growth(s.series) - growth(benchSeries.get(s.bench)!) }))
    .sort((a, b) => a.gap - b.gap);
  // Two different real flexi-cap funds (so the stock overlap is genuine), then
  // the worst benchmark-laggard that is not already one of them.
  MEERA_FUNDS.push(schemes[0], schemes[10],
    ranked.find(x => x.s.id !== schemes[0].id && x.s.id !== schemes[10].id)!.s);
}
// Every AMC we distribute needs an agreed rate, including the real ones carried in
// from Atlas — a missing card means commission with nothing to check it against.
for (let a = 1; a <= AMCS.length; a++) {
  ins('amc_rate_card', { card_id: a * 2 - 1, amc_id: a, scheme_category: 'Equity', agreed_trail_bps: intBetween(r, 85, 110), effective_from: '2025-04-01', source_doc_ref: `empanelment/AMC-${a}-FY26.pdf`, entered_by: 'ops', approved_by: 'management' });
  ins('amc_rate_card', { card_id: a * 2, amc_id: a, scheme_category: 'Non-Equity', agreed_trail_bps: intBetween(r, 35, 60), effective_from: '2025-04-01', source_doc_ref: `empanelment/AMC-${a}-FY26.pdf`, entered_by: 'ops', approved_by: 'management' });
}

const BROKER_NAMES = ['Babulal Joshi', 'Swadesh Rao', 'Priya Trivedi', 'Ravi Shankar Vyas', 'Kalpesh Parikh', 'Hetal Gandhi', 'Mukund Dave', 'Sarla Bhatt', 'Jatin Rana', 'Bhavna Solanki', 'Omprakash Chauhan', 'Deven Pandya', 'Ila Raval', 'Chirag Thakkar', 'Naresh Modi', 'Vandana Mehta', 'Girish Desai', 'Rohan Kulkarni'];
interface BrokerSeed { id: number; name: string; code: string; euin: string; tier: number; tierPct: number; gst: boolean; active: boolean }
const brokers: BrokerSeed[] = [];
BROKER_NAMES.forEach((name, i) => {
  const id = i + 1;
  const tier = [6, 5, 4, 3, 3, 2, 2, 1, 1, 1, 8, 7, 9, 10, 4, 5, 1, 2][i];
  const active = id !== 17;
  const b: BrokerSeed = { id, name, code: String(1200 + id * 7), euin: `E${100000 + id * 13}`, tier, tierPct: TIERS[tier - 1][1], gst: chance(r, 0.45), active };
  brokers.push(b);
  ins('sub_broker_master', { sb_id: id, sb_holder_name: name, sb_sub_broker_code: b.code, sb_bos_code: `SB-${b.code}`, sb_arn_no: 'ARN-3524', sb_euin: b.euin, sb_holder_pan: pan(9000 + id), sb_gst_no: b.gst ? `24${pan(9000 + id)}1Z${id % 10}` : null, sb_tds_deduction: 5.0, fk_cat_id: tier, fk_territory_id: 2 + (i % 3), sb_doj: addDays(TODAY, -intBetween(r, 400, 3000)), sb_termination: active ? null : '2025-11-30', is_employee: id % 9 === 0 ? 1 : 0, is_active: active ? 1 : 0 });
  ins('sb_hierarchy', { sb_hierarchy_id: id, fk_sb_id: id, fk_reporting_to: id <= 3 ? null : ((id % 3) + 1), fk_territory_id: 2 + (i % 3), fk_role_id: 7 });
  ins('broker_links', { link_id: id, sb_id: id, slug: `join-${name.toLowerCase().split(' ')[0]}-${b.code}`, created_at: addDays(TODAY, -300), visits: intBetween(r, 30, 400), applications: intBetween(r, 2, 25) });
});

const STORY = { meera: 101, arjun: 102, desaiHead: 103, desaiSpouse: 104, kapoorHuf: 106 };
interface ClientSeed { id: number; name: string; family: number; broker: BrokerSeed; risk: string }
const clients: ClientSeed[] = [];
let familyId = 0;
const brokerWeights = brokers.filter(b => b.active).flatMap(b => Array(b.tier >= 5 ? 4 : 2).fill(b));
for (let i = 1; i <= 1200; i++) {
  const fname = FIRST[(i * 7) % FIRST.length], lname = LAST[(i * 13) % LAST.length];
  let name = `${fname} ${lname}`;
  if (i === STORY.meera) name = 'Meera Shah';
  if (i === STORY.arjun) name = 'Arjun Patel';
  if (i === STORY.desaiHead) name = 'Mahendra Desai';
  if (i === STORY.desaiSpouse) name = 'Kokila Desai';
  if (i === STORY.kapoorHuf) name = 'Kapoor Family HUF';
  const isStory = Object.values(STORY).includes(i);
  const joinsFamily = i > 1 && chance(r, 0.12) && !isStory;
  if (i === STORY.desaiSpouse) {
    // joins Desai head's family
  } else if (!joinsFamily) {
    familyId++;
    ins('family_master', { family_id: familyId, family_name: `${lname} Family`, family_head_name: name, group_code: `P${String(familyId).padStart(5, '0')}`, total_members: 1 });
  }
  const fam = i === STORY.desaiSpouse ? clients[STORY.desaiHead - 1].family : familyId;
  const broker = i === STORY.meera || i === STORY.arjun ? brokers[3]
    : i === STORY.kapoorHuf || i === STORY.desaiHead || i === STORY.desaiSpouse ? brokers[0]
    : pick(r, brokerWeights);
  const unowned = i > 1100 && i <= 1118;
  const c: ClientSeed = { id: i, name, family: fam, broker, risk: pick(r, ['Moderate', 'Moderate', 'Aggressive', 'Aggressive', 'Very Aggressive']) };
  clients.push(c);
  ins('client_master', { cm_user_id: i, cm_full_name: name, cm_first_name: name.split(' ')[0], cm_last_name: name.split(' ').slice(-1)[0], cm_pan_no: pan(i), cm_date_of_birth: addDays('1985-01-01', (i * 11) % 7300), cm_gender: chance(r, 0.6) ? 'M' : 'F', cm_mobile_number: `98${String(10000000 + i * 731).slice(0, 8)}`, cm_email_id: `client${i}@example.in`, cm_bos_code: `CM-${100000 + i}`, cm_tax_status_id: i === STORY.kapoorHuf ? 3 : 1, fk_family_id: fam, is_family_head: i === STORY.desaiSpouse || joinsFamily ? 0 : 1, fk_primary_sub_broker_id: unowned ? null : broker.id, is_active: 1, is_kyc_done: 1, is_client_app: i <= 40 ? 1 : 0, created_date: addDays(TODAY, -intBetween(r, 100, 1100)) });
  ins('client_master_mf_related', { id: i, fk_cm_user_id: i, tax_status: i === STORY.kapoorHuf ? 'HUF' : 'Individual', risk_profile: c.risk, risk_prof_date: addDays(TODAY, -intBetween(r, 30, 600)), politically_exposed: 'No' });
  ins('accounts_master', { acc_id: i, fk_cm_user_id: i, acc_name: name, acc_bos_code: `ACC-${100000 + i}`, acc_bse_code: i <= 800 ? `MKYC${String(i).padStart(4, '0')}` : null, acc_activation_date: addDays(TODAY, -intBetween(r, 90, 1050)) });
  if (!unowned) {
    ins('client_sub_broker_mapping', { id: i, cm_user_id: i, sb_id: broker.id, is_primary: 1, created_by: 1, created_date: addDays(TODAY, -intBetween(r, 100, 1000)) });
    if (chance(r, 0.03)) {
      const sec = pick(r, brokers.filter(b => b.active && b.id !== broker.id));
      ins('client_sub_broker_mapping', { id: 10000 + i, cm_user_id: i, sb_id: sec.id, is_primary: 0, created_by: 1, created_date: addDays(TODAY, -intBetween(r, 30, 400)) });
    }
  }
  if (i <= 800) ins('bse_client_master', { id: i, bse_client_id: `MKYC${String(i).padStart(4, '0')}`, ucc_status: 'ACTIVE', holding_pattern: 'SI', first_applicant: name, pan_no: pan(i), kyc_type: 'K' });
  if (i <= 40) ins('client_login_master', { clm_id: i, fk_cm_user_id: i, clm_email: `${i}@app.example.in`, clm_pan_no: pan(i), is_kyc: 1, fk_sb_id: broker.id, last_login_at: addDays(TODAY, -intBetween(r, 0, 60)) });
  // DPDP consent is per channel AND per purpose — a client who agreed to statements
  // on WhatsApp has not agreed to marketing on it, and agreeing on one channel says
  // nothing about another. Grant rates differ by channel because they do in life.
  ins('consents', { consent_id: i, client_id: i, channel: 'whatsapp', purpose: 'transactional', state: 'granted', captured_via: 'onboarding', ts: addDays(TODAY, -intBetween(r, 100, 900)) });
  let cid = 2000 + i * 3;
  ([['whatsapp', 0.77, 0.94], ['email', 0.62, 0.97], ['sms', 0.34, 0.88]] as [string, number, number][])
    .forEach(([channel, asked, kept]) => {
      if (!chance(r, asked)) return;
      cid++;
      ins('consents', {
        consent_id: cid, client_id: i, channel, purpose: 'marketing',
        state: chance(r, kept) ? 'granted' : 'withdrawn',
        captured_via: pick(r, ['onboarding', 'onboarding', 'review meeting', 'app preference']),
        ts: addDays(TODAY, -intBetween(r, 100, 900)),
      });
    });
}

let trId = 0, folioId = 0, sipId = 0, sxpId = 0, mandateId = 0;
interface FolioSeed { id: number; folioNo: string; scheme: SchemeSeed; client: ClientSeed; txns: Txn[]; sbId: number }
const folios: FolioSeed[] = [];
interface TxnIn {
  date: string; typeId: number; buySell: 1 | -1 | 0; amount: number; price: number;
  sbId?: number; sipReg?: string; noEuin?: boolean;
}
function addTxn(f: FolioSeed, t: TxnIn) {
  // The ledger records what has happened. A future-dated row makes FIFO and any
  // date-bounded view of the same book disagree, silently.
  if (t.date > TODAY) throw new Error(`transaction dated ${t.date} is in the future (today is ${TODAY})`);
  trId++;
  const units = t.buySell === 0 ? 0 : round4(t.amount / t.price);
  const bos = `TR-${String(trId).padStart(7, '0')}`;
  const sb = brokers.find(b => b.id === (t.sbId ?? f.sbId))!;
  ins('transaction_master', {
    tr_id: trId, tr_bos_code: bos, fk_acc_id: f.client.id, fk_scheme_id: f.scheme.id, tr_folio_no: f.folioNo,
    fk_tran_type_id: t.typeId, fk_txn_status_id: 2, fk_sb_id: sb.id, tr_date: t.date,
    tr_amount: round2(t.amount), tr_units: units, tr_price: t.price,
    tr_stamp_duty: t.buySell === 1 ? round2(t.amount * 0.00005) : 0,
    tr_benchmark_price: round4(navAt(benchSeries.get(f.scheme.bench)!, t.date)),
    tr_sip_reg_number: t.sipReg ?? null,
    tr_file_euin: t.noEuin ? null : sb.euin,
    tr_file_sub_broker_code: sb.code,
    is_active: 1,
  });
  if (t.buySell !== 0) f.txns.push({ trId, date: t.date, units, price: t.price, amount: t.amount, buySell: t.buySell, bosCode: bos });
  return trId;
}

for (const c of clients) {
  const isDesai = c.id === STORY.desaiHead || c.id === STORY.desaiSpouse;
  // The Desai household's four lump sums are fixed: three on the head, one on the
  // spouse. Letting the spouse draw a random folio count ran off the end of that
  // array and wrote two folios with NULL amounts — invisible until commission
  // started reading folios.
  const n = c.id === STORY.desaiHead ? 3 : c.id === STORY.desaiSpouse ? 1
    : c.id === STORY.kapoorHuf ? 2 : c.id === STORY.meera ? MEERA_FUNDS.length
      : intBetween(r, 1, 3);
  const chosen = new Set<number>();
  for (let k = 0; k < n; k++) {
    let s = pick(r, schemes);
    if (c.id === STORY.meera) s = MEERA_FUNDS[k];
    if (c.id === STORY.kapoorHuf && k === 0) s = schemes[0];
    if (isDesai) s = schemes[(c.id * 3 + k * 7) % 60];
    if (chosen.has(s.id)) continue;
    chosen.add(s.id);
    folioId++;
    const f: FolioSeed = { id: folioId, folioNo: String(5000000 + folioId), scheme: s, client: c, txns: [], sbId: c.broker.id };
    folios.push(f);
    // Meera's folios are aged past a year on purpose: the house rule refuses to
    // annualise anything younger, so a sub-year holding has no XIRR to compare
    // against its benchmark — and her whole story is a fund lagging its benchmark.
    const start = isDesai ? addDays(TODAY, -820)
      : c.id === STORY.kapoorHuf && k === 0 ? addDays(TODAY, -700)
        : c.id === STORY.meera ? addDays(TODAY, -[900, 730, 560][k])
          : addDays(TODAY, -intBetween(r, 200, 1000));
    ins('folio_master', { folio_id: folioId, fm_folio_no: f.folioNo, fk_scheme_id: s.id, fk_acc_id: c.id, fm_pan_no: pan(c.id), fm_sub_broker_code: c.broker.code, fm_arn_no: 'ARN-3524', fm_euin: c.broker.euin, fm_holding: 'Single', fm_nominee1_name: chance(r, 0.7) ? pick(r, FIRST) + ' ' + c.name.split(' ').slice(-1)[0] : null, folio_start_date: start, is_active: 1 });
    const lump = isDesai ? [1500000, 1200000, 900000, 600000][k + (c.id === STORY.desaiSpouse ? 3 : 0)]
      : c.id === STORY.kapoorHuf && k === 0 ? 400000
      : intBetween(r, 1, 12) * 25000;
    addTxn(f, { date: start, typeId: 1, buySell: 1, amount: lump, price: navAt(s.series, start) });
    if (!isDesai && chance(r, 0.5)) {
      const d = addDays(start, intBetween(r, 60, 300));
      const amount = intBetween(r, 1, 6) * 25000;
      // A top-up can only have happened if the date has been. Letting this run
      // past today put transactions in the ledger that had not occurred — FIFO
      // counted them into current holdings while a day-by-day walk did not.
      if (d <= TODAY) addTxn(f, { date: d, typeId: 20, buySell: 1, amount, price: navAt(s.series, d) });
    }
    const hasSip = c.id === STORY.meera ? k === 0 : !isDesai && s.equity && chance(r, 0.42);
    if (hasSip) {
      sipId++;
      const sipAmt = c.id === STORY.meera ? 25000 : intBetween(r, 2, 20) * 1000;
      const sipStart = addDays(start, 30);
      const reg = `SIP-${String(sipId).padStart(5, '0')}`;
      const bounced = c.id === STORY.meera || chance(r, 0.035);
      let instalments = 0;
      for (let d = sipStart; d <= TODAY; d = addDays(d, 30)) {
        instalments++;
        const isBounce = bounced && daysBetween(d, TODAY) < 62;
        addTxn(f, { date: d, typeId: isBounce ? 33 : 3, buySell: isBounce ? 0 : 1, amount: sipAmt, price: navAt(s.series, d), sipReg: reg });
      }
      ins('sip_master', { sip_id: sipId, fk_acc_id: c.id, fk_from_scheme_id: s.id, fk_sb_id: c.broker.id, fk_freq_id: 1, tr_folio_no: f.folioNo, sip_type: 'SIP', tr_amount: sipAmt, day_of_sip: intBetween(r, 1, 28), start_date: sipStart, is_live_sip: 1, sxp_bos_code: reg });
      mandateId++;
      ins('bse_mandate_list', { id: mandateId, exch_mandate_id: 80000 + mandateId, ucc: c.id <= 800 ? `MKYC${String(c.id).padStart(4, '0')}` : null, amount: sipAmt * 2, type: 'E-MANDATE', status: 'APPROVED', umrn: `UMRN${900000 + mandateId}`, bank_name: pick(r, ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank']), start_date: sipStart, end_date: c.id === STORY.meera ? '2026-08-12' : addDays(TODAY, intBetween(r, 60, 900)), audit_trail: 'registered→approved' });
      sxpId++;
      ins('bse_sxp_list', { id: sxpId, reg_no: reg, sxp_type: 'SIP', ucc: c.id <= 800 ? `MKYC${String(c.id).padStart(4, '0')}` : null, amount: sipAmt, start_date: sipStart, status: 'ACTIVE', exch_mandate_id: 80000 + mandateId, next_due_date: addDays(TODAY, intBetween(r, 1, 28)), npayments_missed: bounced ? 2 : 0, n_installment_paid: instalments - (bounced ? 2 : 0), previous_paid_date: addDays(TODAY, -intBetween(r, 30, 62)), sub_broker_code: c.broker.code, euin: c.broker.euin });
    }
    if (!isDesai && c.id !== STORY.kapoorHuf && chance(r, 0.25)) {
      const redDate = addDays(TODAY, -intBetween(r, 10, 400));
      const fraction = between(r, 0.1, 0.45);
      // Sell a fraction of what was actually held THAT DAY. Sizing it off every
      // purchase ever made — including SIP instalments still in the future —
      // redeems units the folio did not yet own. FIFO quietly floors that at the
      // available lots, so it never surfaced until AUM was walked day by day.
      const heldUnits = f.txns.filter(t => t.date <= redDate)
        .reduce((s2, t) => s2 + t.units * t.buySell, 0);
      if (heldUnits > 1e-6) {
        const price = navAt(s.series, redDate);
        addTxn(f, { date: redDate, typeId: 2, buySell: -1, amount: round2(heldUnits * fraction * price), price });
      }
    }
  }
}

{
  const f = folios.find(x => x.client.id === STORY.kapoorHuf)!;
  const d = addDays(TODAY, -120);
  addTxn(f, { date: d, typeId: 20, buySell: 1, amount: 200000, price: navAt(f.scheme.series, d), sbId: 2 });
}
folios.filter(f => f.sbId === 5).slice(0, 24).forEach(f => {
  const d = addDays(TODAY, -intBetween(r, 5, 25));
  addTxn(f, { date: d, typeId: 20, buySell: 1, amount: 50000, price: navAt(f.scheme.series, d), noEuin: true });
});

// ── Clients who left ─────────────────────────────────────────────────────────
// A book that only ever grows is a lie, and "wins and losses" needs named rows,
// not a count. Founder's definition (07-Aug-2026): a client is lost when they
// transfer out to another distributor, OR when they redeem everything and hold
// nothing. Both are seeded here, BEFORE the FIFO run, so holdings, AUM and
// commission all stop on the same day without any of them being special-cased.
const rx = rng(20260807 + 77);
const exitPool = [...new Set(folios.map(f => f.client.id))]
  .filter(id => !Object.values(STORY).includes(id));
const exits: { clientId: number; date: string; kind: 'transferred' | 'redeemed' }[] = [];
// Weighted so the demo broker owns a few of each — a page about wins and losses
// with nothing in either column teaches the founder nothing.
for (const sbTarget of [4, 4, 4, null, null, null, null, null, null, null, null, null, null, null, null, null]) {
  const candidates = exitPool.filter(id => {
    const owned = folios.filter(f => f.client.id === id);
    return owned.length > 0 && (sbTarget == null || owned[0].sbId === sbTarget);
  });
  if (!candidates.length) continue;
  const clientId = pick(rx, candidates);
  exitPool.splice(exitPool.indexOf(clientId), 1);
  exits.push({
    clientId,
    date: addDays(TODAY, -intBetween(rx, 20, 400)),
    kind: chance(rx, 0.55) ? 'transferred' : 'redeemed',
  });
}
const delTxn = db.prepare('DELETE FROM transaction_master WHERE tr_id = ?');
const markCob = db.prepare('UPDATE transaction_master SET is_cob = 1 WHERE tr_id = ?');
for (const e of exits) {
  for (const f of folios.filter(x => x.client.id === e.clientId)) {
    // Anything dated after the exit would resurrect a client who has gone. Those
    // rows are already in transaction_master, so remove them there too — an
    // in-memory-only filter would leave the ledger and the FIFO disagreeing.
    for (const t of f.txns.filter(t2 => t2.date > e.date)) delTxn.run(t.trId);
    f.txns = f.txns.filter(t => t.date <= e.date);

    const units = f.txns.reduce((s, t) => s + t.units * t.buySell, 0);
    if (units <= 1e-6) continue;
    const price = navAt(f.scheme.series, e.date);
    // Unrounded on purpose: addTxn re-derives units as round4(amount / price), so
    // rounding the amount first leaves a fraction of a unit behind and the client
    // reads as still holding something. Leaving is leaving.
    const trId = addTxn(f, { date: e.date, typeId: 2, buySell: -1, amount: units * price, price });
    // A transfer-out is a change of broker on the books; a full redemption is not.
    if (e.kind === 'transferred') markCob.run(trId);
  }
  if (e.kind === 'transferred') {
    db.prepare(`UPDATE folio_master SET is_transferred_out = 1, transfer_out_date = ?, is_active = 0
      WHERE fk_acc_id = ?`).run(e.date, e.clientId);
  }
  // Their SIPs stopped when they left; leaving them live would inflate the book.
  db.prepare('UPDATE sip_master SET is_live_sip = 0, cease_date = ? WHERE fk_acc_id = ?').run(e.date, e.clientId);
  db.prepare(`UPDATE bse_sxp_list SET status = 'CEASED' WHERE reg_no IN
    (SELECT sxp_bos_code FROM sip_master WHERE fk_acc_id = ?)`).run(e.clientId);
  emit({ at: e.date, subjectType: 'client', subjectId: e.clientId, type: 'client_exited', payload: { reason: e.kind }, source: 'import' });
}

let fplId = 0, fpslId = 0, shId = 0, dhlId = 0, fshaId = 0;
const clientValue = new Map<number, number>();
const folioAgg: { f: FolioSeed; res: ReturnType<typeof runFifo>; value: number; invested: number; xirrV: number | null; bmx: number | null; unreal: { unrealizedST: number; unrealizedLT: number }; latestNav: number }[] = [];
for (const f of folios) {
  if (!f.txns.length) continue;
  const lt = f.scheme.equity ? 365 : 1095;
  const res = runFifo(f.txns, lt);
  const latestNav = f.scheme.series.navs[f.scheme.series.navs.length - 1];
  const value = round2(res.balanceUnits * latestNav);
  const firstBuyDate = f.txns.filter(t => t.buySell === 1).map(t => t.date).sort()[0];
  const annualizable = firstBuyDate != null && daysBetween(firstBuyDate, TODAY) >= 365; // house rule: never annualize <1y
  const flows = f.txns.map(t => ({ date: t.date, amount: t.buySell === 1 ? -t.amount : t.amount }));
  if (value > 0) flows.push({ date: TODAY, amount: value });
  const xirrV = annualizable ? xirr(flows) : null;
  const bs = benchSeries.get(f.scheme.bench)!;
  let bmUnits = 0;
  for (const t of f.txns) bmUnits += (t.buySell === 1 ? 1 : -1) * t.amount / navAt(bs, t.date);
  const bmValue = round2(bmUnits * bs.navs[bs.navs.length - 1]);
  const bmFlows = f.txns.map(t => ({ date: t.date, amount: t.buySell === 1 ? -t.amount : t.amount }));
  if (bmValue > 0) bmFlows.push({ date: TODAY, amount: bmValue });
  const bmx = annualizable ? xirr(bmFlows) : null;
  folioAgg.push({ f, res, value, invested: res.investedRemaining, xirrV, bmx, unreal: unrealizedSplit(res.lots, TODAY, latestNav, lt), latestNav });
  clientValue.set(f.client.id, round2((clientValue.get(f.client.id) ?? 0) + value));
}
for (const a of folioAgg) {
  const { f, res } = a;
  const ltDays = f.scheme.equity ? 365 : 1095;
  for (const lot of res.lots) {
    fplId++;
    ins('fifo_purchase_log', { id: fplId, purchase_id: lot.purchaseTrId, acc_id: f.client.id, scheme_id: f.scheme.id, folio_no: f.folioNo, tr_date: lot.date, purchase_unit: lot.units, balance_unit: lot.balance, purchase_price: lot.price, tr_bos_code: lot.bosCode });
    if (lot.balance > 1e-6) {
      dhlId++;
      const bs = benchSeries.get(f.scheme.bench)!;
      const bmU = round4((lot.balance * lot.price) / navAt(bs, lot.date));
      const isLT = daysBetween(lot.date, TODAY) >= ltDays;
      const gain = round2(lot.balance * (a.latestNav - lot.price));
      ins('fifo_detail_holding_latest', { dhl_id: dhlId, fk_acc_id: f.client.id, fk_scheme_id: f.scheme.id, dhl_folio_no: f.folioNo, fk_sb_id: f.sbId, fk_benchmark_id: f.scheme.bench, dhl_purchase_date: lot.date, dhl_purchase_units: lot.balance, dhl_purchase_price: lot.price, dhl_purchase_amount: round2(lot.balance * lot.price), dhl_current_price: a.latestNav, dhl_current_value: round2(lot.balance * a.latestNav), dhl_invested_value: round2(lot.balance * lot.price), dhl_holding_days: daysBetween(lot.date, TODAY), dhl_holding_date: TODAY, dhl_valuation_date: TODAY, dhl_unrealized_ltcg: isLT ? gain : 0, dhl_unrealized_stcg: isLT ? 0 : gain, dhl_benchmark_units: bmU, dhl_benchmark_price: round4(bs.navs[bs.navs.length - 1]), dhl_benchmark_market_value: round2(bmU * bs.navs[bs.navs.length - 1]), dhl_benchmark_date: TODAY });
    }
  }
  for (const s of res.sales) {
    fpslId++;
    ins('fifo_purchase_sales_log', { id: fpslId, sell_id: s.sellTrId, acc_id: f.client.id, scheme_id: f.scheme.id, folio_no: f.folioNo, tr_date: s.date, sell_unit: s.units, sell_price: s.sellPrice, holding_days: s.holdingDays, tr_bos_code: s.bosCode });
  }
  shId++;
  const firstBuy = f.txns.filter(t => t.buySell === 1).sort((x, y) => x.date.localeCompare(y.date))[0];
  ins('fifo_summary_holding', { sh_id: shId, fk_acc_id: f.client.id, fk_scheme_id: f.scheme.id, sh_folio_no: f.folioNo, fk_sb_id: f.sbId, fk_benchmark_id: f.scheme.bench, sh_holding_date: TODAY, sh_units: res.balanceUnits, sh_price: a.latestNav, sh_current_value: a.value, sh_invested_value: a.invested, sh_realized_ltcg: res.realizedLT, sh_realized_stcg: res.realizedST, sh_unrealized_ltcg: a.unreal.unrealizedLT, sh_unrealized_stcg: a.unreal.unrealizedST, sh_xirr: a.xirrV != null ? round2(a.xirrV * 100) : null, sh_bmxirr: a.bmx != null ? round2(a.bmx * 100) : null, absolute_return: a.invested > 0 ? round2(((a.value - a.invested) / a.invested) * 100) : null, sh_first_purchase_date: firstBuy?.date ?? null });
  if (a.value > 0) {
    fshaId++;
    const c = f.client;
    const totalV = clientValue.get(c.id)!;
    const sb = brokers.find(b => b.id === f.sbId)!;
    ins('fifo_summary_holding_active', { id: fshaId, acc_id: c.id, scheme_id: f.scheme.id, folio_no: f.folioNo, client_id: c.id, client_name: c.name, family_id: c.family, family_name: `${c.name.split(' ').slice(-1)[0]} Family`, pan_no: pan(c.id), advisor_code: sb.code, advisor_name: sb.name, fund_name: f.scheme.name, fund_category: CATS[f.scheme.cat - 1][0], asset_name: ASSETS[[1, 1, 1, 1, 1, 2, 2, 3, 3, 4][f.scheme.cat - 1] - 1], tax_status: c.id === STORY.kapoorHuf ? 'HUF' : 'Individual', holding_date: TODAY, inv_since_date: firstBuy?.date ?? null, balance_units: res.balanceUnits, avg_cost: res.balanceUnits > 0 ? round4(a.invested / res.balanceUnits) : null, cost_amount: a.invested, nav: a.latestNav, present_market_value: a.value, portfolio_weight: totalV > 0 ? round2((a.value / totalV) * 100) : null, abs_ret: a.invested > 0 ? round2(((a.value - a.invested) / a.invested) * 100) : null, xirr: a.xirrV != null ? round2(a.xirrV * 100) : null });
  }
}

// Calendar months, walked properly. (An earlier version stepped back 31 days at a
// time from a month start, which silently skipped June 2026.)
const months: string[] = [];
for (let back = 13; back >= 0; back--) {
  const d = new Date(Date.UTC(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)) - 1 - back, 1));
  months.push(d.toISOString().slice(0, 10));
}
const monthEndOf = (m: string) => addDays(monthStart(addDays(m, 40)), -1);

// ── The AUM spine: mv_aum_daily and mv_monthly_aum ───────────────────────────
// Walked from the same folios and NAVs that produce commission, so the trend on
// My business and the money on My earnings can never be two different books.
// Every folio's units change only on transaction dates, so we carry a running
// balance forward day by day and value it against a pre-built NAV lookup.
const AUM_DAYS = 425;                                   // ~14 months of daily points
const aumDates: string[] = [];
for (let d = AUM_DAYS; d >= 0; d--) aumDates.push(addDays(TODAY, -d));
const dayIndex = new Map(aumDates.map((d, i) => [d, i]));

const navByScheme = new Map<number, number[]>();
for (const s of schemes) navByScheme.set(s.id, aumDates.map(d => navAt(s.series, d)));

// [dayIndex][sbId] → value, and the distinct clients holding on that day
const aumByDay: Map<number, number>[] = aumDates.map(() => new Map());
const clientsByDay: Map<number, Set<number>>[] = aumDates.map(() => new Map());
for (const f of folios) {
  if (!f.txns.length) continue;
  const navs = navByScheme.get(f.scheme.id)!;
  const sorted = [...f.txns].sort((x, y) => x.date.localeCompare(y.date));
  let ti = 0, units = 0;
  for (let i = 0; i < aumDates.length; i++) {
    while (ti < sorted.length && sorted[ti].date <= aumDates[i]) {
      units = round4(units + sorted[ti].units * sorted[ti].buySell);
      ti++;
    }
    // Nobody can hold meaningfully negative units. If this trips, some transaction
    // sold more than the folio owned on that date — FIFO would floor it and the two
    // views of the same book would silently disagree. The 0.01 floor is rounding
    // dust: units are stored to 4dp, so selling "everything" can overshoot by ~1e-4.
    if (units < -0.01) throw new Error(`folio ${f.folioNo} holds ${units} units on ${aumDates[i]}`);
    if (units <= 1e-6) continue;
    const v = units * navs[i];
    aumByDay[i].set(f.sbId, (aumByDay[i].get(f.sbId) ?? 0) + v);
    if (!clientsByDay[i].has(f.sbId)) clientsByDay[i].set(f.sbId, new Set());
    clientsByDay[i].get(f.sbId)!.add(f.client.id);
  }
}
aumDates.forEach((d, i) => {
  for (const [sbId, v] of aumByDay[i]) {
    ins('mv_aum_daily', {
      aum_date: d, sb_id: sbId, aum: round2(v),
      client_count: clientsByDay[i].get(sbId)!.size,
      folio_count: folios.filter(f => f.sbId === sbId).length,
    });
  }
});

// Monthly rollup. peak_day_aum is the firm's reported definition (ruling 7);
// month_end_aum sits beside it because only month-end makes the growth identity
// hold exactly — opening + net flows + market movement = closing, to the rupee.
const flowByMonth = db.prepare(`SELECT t.fk_sb_id sb, substr(t.tr_date,1,7) || '-01' m,
    SUM(t.tr_amount * tt.tr_type_buy_sell_flag) v
  FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
  WHERE tt.tr_type_buy_sell_flag != 0 GROUP BY 1, 2`).all() as { sb: number; m: string; v: number }[];
const flowLookup = new Map(flowByMonth.map(f => [`${f.sb}|${f.m}`, f.v]));
const aumOn = (sbId: number, date: string) => {
  const i = dayIndex.get(date);
  return i == null ? null : aumByDay[i].get(sbId) ?? 0;
};
for (const m of months) {
  const monthEnd = monthEndOf(m);
  const daysIn = aumDates.filter(d => d >= m && d <= monthEnd);
  // The opening balance is the previous day's close, read directly rather than
  // carried in a variable — so a missing month can never shift the attribution.
  const opening = aumOn(0, addDays(m, -1)) === null ? null : addDays(m, -1);
  if (!daysIn.length || opening === null) continue;
  for (const b of brokers) {
    let peak = -1, peakDate = '';
    for (const d of daysIn) {
      const v = aumByDay[dayIndex.get(d)!].get(b.id) ?? 0;
      if (v > peak) { peak = v; peakDate = d; }
    }
    const lastDay = daysIn[daysIn.length - 1];
    const close = aumByDay[dayIndex.get(lastDay)!].get(b.id) ?? 0;
    const open = aumOn(b.id, opening)!;
    if (peak <= 0 && close <= 0 && open <= 0) continue;
    const flows = flowLookup.get(`${b.id}|${m}`) ?? 0;
    ins('mv_monthly_aum', {
      month: m, sb_id: b.id, peak_day_aum: round2(peak), peak_date: peakDate,
      month_end_aum: round2(close), opening_aum: round2(open), net_flows: round2(flows),
      // Whatever the book did that the broker did not do: the residual, by definition.
      market_movement: round2(close - open - flows),
      client_count: clientsByDay[dayIndex.get(lastDay)!].get(b.id)?.size ?? 0,
    });
  }
}

// ── Monthly targets ──────────────────────────────────────────────────────────
// Targets are set ahead of the month, not back-fitted, so they must sometimes be
// missed. Each broker's target is sized off their own median activity and then
// nudged by a per-month factor — which makes attainment real rather than uniform.
const rt = rng(20260807 + 91);
const medianOf = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
let targetId = 0;
for (const b of brokers) {
  const inflow = months.map(m => (db.prepare(`SELECT COALESCE(SUM(t.tr_amount),0) v
    FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
    WHERE t.fk_sb_id=? AND tt.tr_type_buy_sell_flag=1 AND substr(t.tr_date,1,7)=?`)
    .get(b.id, m.slice(0, 7)) as { v: number }).v);
  const newClients = months.map(m => (db.prepare(`SELECT COUNT(DISTINCT fk_acc_id) n FROM folio_master
    WHERE fm_sub_broker_code=? AND substr(folio_start_date,1,7)=?`).get(b.code, m.slice(0, 7)) as { n: number }).n);
  const sipCount = (db.prepare('SELECT COUNT(*) n FROM sip_master WHERE fk_sb_id=?').get(b.id) as { n: number }).n;
  const baseLump = medianOf(inflow.filter(v => v > 0)) || 200000;
  const baseClients = Math.max(1, Math.round(medianOf(newClients)));
  months.forEach(m => {
    targetId++;
    const stretch = between(rt, 0.8, 1.35);          // some months set high, some low
    ins('sb_monthly_target', {
      id: targetId, fk_sb_id: b.id, target_month: m,
      target_lumpsum_amount: round2(baseLump * stretch),
      target_sip_count: Math.max(1, Math.round((sipCount / months.length) * stretch * 1.4)),
      target_sip_amount: round2((baseLump * 0.18) * stretch),
      target_client_count: Math.max(1, Math.round(baseClients * stretch)),
    });
  });
}

// ── Brokerage: one trail line per folio per month, off the real book ──────────
// Trail is what the AMC pays on money that actually sat in a folio, so every row
// here is generated from that folio's own units × NAV at month end × the agreed
// rate for that AMC and asset class. That is what lets a broker click a rupee and
// land on the client and scheme that produced it — the whole point of this page.
// Post-2018 SEBI rules make regular-plan MF distribution trail-only: the Upfront
// and Incentive buckets exist in the backend and stay empty here rather than
// being invented.
['Trail', 'Upfront', 'Incentive', 'Clawback'].forEach((t, i) => ins('brokerage_type_master', { brk_type_id: i + 1, brk_type_name: t }));
let bkrId = 0, invId = 0, invDataId = 0;

const cardBps = new Map<string, number>();
for (const c of db.prepare('SELECT amc_id, scheme_category, agreed_trail_bps FROM amc_rate_card').all() as
  { amc_id: number; scheme_category: string; agreed_trail_bps: number }[]) {
  cardBps.set(`${c.amc_id}:${c.scheme_category}`, c.agreed_trail_bps);
}
// One AMC has been under-paying equity trail since May — the case the
// commercial-terms validator (amc_rate_card) exists to catch. Pick the AMC with
// the most equity money in the demo broker's book, so the story is visible to him
// and not buried in someone else's clients.
const eqAumByAmc = new Map<number, number>();
for (const a of folioAgg) {
  if (!a.f.scheme.equity || a.f.sbId !== 4) continue;
  eqAumByAmc.set(a.f.scheme.amc, (eqAumByAmc.get(a.f.scheme.amc) ?? 0) + a.value);
}
const SHORT_PAY = {
  amc: [...eqAumByAmc.entries()].sort((x, y) => y[1] - x[1])[0][0],
  cls: 'Equity', from: '2026-05-01', bps: 12,
};

interface BkrRow { bkr_id: number; sb: number; month: string; payout: number; gst: number; tds: number }
const bkrRows: BkrRow[] = [];
const varianceRows: number[] = [];

for (const a of folioAgg) {
  const f = a.f;
  const b = brokers.find(x => x.id === f.sbId)!;
  const cls = f.scheme.equity ? 'Equity' : 'Non-Equity';
  const agreed = cardBps.get(`${f.scheme.amc}:${cls}`);
  // Money must never be computed from a missing rate. Fail the seed loudly rather
  // than writing a NULL that SUM() would quietly skip.
  if (agreed == null) throw new Error(`no rate card for AMC ${f.scheme.amc} (${cls}) — folio ${f.folioNo}`);
  const txns = [...f.txns].sort((x, y) => x.date.localeCompare(y.date));
  let ti = 0, units = 0;
  for (const m of months) {
    const monthEnd = monthEndOf(m);
    while (ti < txns.length && txns[ti].date <= monthEnd) { units = round4(units + txns[ti].units * txns[ti].buySell); ti++; }
    if (units <= 1e-6) continue;
    const base = round2(units * navAt(f.scheme.series, monthEnd));
    // A folio we cannot value is a bug in the book, not a row to skip quietly.
    if (!Number.isFinite(base)) throw new Error(`folio ${f.folioNo} has no valuation at ${monthEnd} — units ${units}`);
    if (base < 1) continue;

    const short = f.scheme.amc === SHORT_PAY.amc && cls === SHORT_PAY.cls && m >= SHORT_PAY.from;
    const paidBps = short ? agreed - SHORT_PAY.bps : agreed;
    const received = round2((base * (paidBps / 10000)) / 12);
    if (received <= 0) continue;
    const expected = round2((base * (agreed / 10000)) / 12);
    const payout = round2(received * (b.tierPct / 100));
    const gst = b.gst ? round2(payout * 0.18) : 0;
    const tds = round2(payout * 0.05);
    bkrId++;
    if (short) varianceRows.push(bkrId);
    ins('brokerage_master', {
      bkr_id: bkrId, bkr_folio_no: f.folioNo, fk_scheme_id: f.scheme.id, fk_folio_id: f.id, fk_sb_id: b.id,
      fk_bkr_type_id: 1, bkr_from_date: m, bkr_to_date: monthEnd, bkr_units: units, tr_amount: base,
      bkr_percentage: round4(paidBps / 100), bkr_amount: received,
      bkr_payout_rate_precentage: b.tierPct, bkr_payout_amount: payout,
      payout_gst_amount: gst, payout_tds: tds, has_gst: b.gst ? 1 : 0,
      calc_units: units, calc_tr_amount: base, calc_rate: round4(agreed / 100), calc_brok_amount: expected,
      reco_status: short ? 2 : 1, reco_difference: short ? round2(received - expected) : 0,
      reco_remarks: short ? `paid ${round2(paidBps)}bps vs ${agreed}bps agreed in the rate card` : null,
    });
    bkrRows.push({ bkr_id: bkrId, sb: b.id, month: m, payout, gst, tds });
  }
}

// Clawback: trail already paid comes back when a client exits inside a year.
// Each row names the redemption that caused it, so no clawback is unexplained.
const early = db.prepare(`SELECT t.tr_id, t.fk_sb_id, t.tr_amount, t.tr_folio_no, f.folio_id, t.fk_scheme_id, t.tr_date
  FROM transaction_master t
  JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
  JOIN folio_master f ON f.fm_folio_no = t.tr_folio_no
  WHERE tt.tr_type_buy_sell_flag = -1 AND t.tr_date >= date('${TODAY}', '-6 months')
    AND julianday(t.tr_date) - julianday(f.folio_start_date) < 365
  ORDER BY t.fk_sb_id = 4 DESC, t.tr_amount DESC LIMIT 14`)
  .all() as { tr_id: number; fk_sb_id: number; tr_amount: number; tr_folio_no: string; folio_id: number; fk_scheme_id: number; tr_date: string }[];
for (const e of early) {
  const b = brokers.find(x => x.id === e.fk_sb_id)!;
  const amt = -round2(e.tr_amount * 0.009);
  const m = monthStart(e.tr_date);
  const payout = round2(amt * (b.tierPct / 100));
  bkrId++;
  ins('brokerage_master', {
    bkr_id: bkrId, bkr_folio_no: e.tr_folio_no, fk_scheme_id: e.fk_scheme_id, fk_folio_id: e.folio_id,
    fk_sb_id: b.id, fk_bkr_type_id: 4, bkr_from_date: m, bkr_to_date: monthEndOf(m), tr_amount: e.tr_amount,
    bkr_amount: amt, bkr_payout_rate_precentage: b.tierPct, bkr_payout_amount: payout,
    payout_gst_amount: 0, payout_tds: 0, has_gst: 0, reco_status: 1, reco_difference: 0,
    clawback_source_txn: e.tr_id,
  });
  bkrRows.push({ bkr_id: bkrId, sb: b.id, month: m, payout, gst: 0, tds: 0 });
}

// One invoice per broker per month, summing exactly the rows it covers.
const byInvoice = new Map<string, BkrRow[]>();
for (const row of bkrRows) {
  const key = `${row.sb}|${row.month}`;
  if (!byInvoice.has(key)) byInvoice.set(key, []);
  byInvoice.get(key)!.push(row);
}
const fyCumBySb = new Map<number, number>();
for (const b of brokers) {
  for (const m of months) {
    const rows = byInvoice.get(`${b.id}|${m}`);
    if (!rows?.length) continue;
    const sub = round2(rows.reduce((s, x) => s + x.payout, 0));
    const gst = round2(rows.reduce((s, x) => s + x.gst, 0));
    const tds = round2(rows.reduce((s, x) => s + x.tds, 0));
    const monthEnd = monthEndOf(m);
    const fy = m >= '2026-04-01' ? '26-27' : '25-26';
    invId++;
    ins('invoice_master', {
      invoice_id: invId, invoice_no: `MF/${fy}/${String(invId).padStart(4, '0')}`, fk_sb_id: b.id,
      invoice_date: monthEnd, period_start_date: m, period_end_date: monthEnd,
      sub_total: sub, cgst: round2(gst / 2), sgst: round2(gst / 2), tds,
      total_amount: round2(sub + gst - tds),
      // The current month is still open — it has not been invoiced or paid yet.
      payment_date: m < monthStart(TODAY) ? addDays(monthEnd, 5) : null,
    });
    const upd = db.prepare('UPDATE brokerage_master SET fk_invoice_id=? WHERE bkr_id=?');
    for (const row of rows) upd.run(invId, row.bkr_id);
    invDataId++;
    ins('invoice_data', { invoice_data_id: invDataId, fk_invoice_id: invId, brk_type_id: 1, payout_amount: sub, gst_amount: gst, net_amount: round2(sub + gst - tds) });
    if (fy === '26-27') fyCumBySb.set(b.id, round2((fyCumBySb.get(b.id) ?? 0) + sub));
  }
  const fyCum = fyCumBySb.get(b.id) ?? 0;
  ins('sb_fy_brokerage_tracker', { id: b.id, fk_sb_id: b.id, financial_year: '26-27', cumulative_payout: fyCum, threshold_crossed: fyCum > 2000000 ? 1 : 0, crossing_month: fyCum > 2000000 ? '2026-07-01' : null });
}
months.forEach((m, i) => ins('brokerage_payout_queue', { id: i + 1, from_date: m, to_date: addDays(monthStart(addDays(m, 40)), -1), requested_by: 1, status: 2, approved_by: 2, approved_at: addDays(m, 36) }));
ins('brokerage_payout_queue', { id: 99, from_date: monthStart(TODAY), to_date: TODAY, requested_by: 1, status: 0 });

// ── Onboarding: leads → applications, with the whole stage trail in `events` ──
// Five stages: lead → KYC → e-log → UCC → live. Each stage entry is one event, so
// the funnel and the median days per stage are read off the ledger, never stored.
// Offline (paper) applications have no BSE e-log step — they clear that stage the
// moment KRA verifies. That is what makes the 80%-offline base visible.
// Its own RNG stream, so tuning onboarding never reshuffles the rest of the seed.
const ro = rng(20260807 + 41);
const LEAD_SOURCES = ['link', 'referral', 'campaign', 'walk_in', 'manual'];
const KRA_REJECTS = ['ERR-00009', 'ERR-00004', 'ERR-00017', 'ERR-00010', 'ERR-00031'];
const activeBrokers = brokers.filter(b => b.active);
const obWeights = activeBrokers.flatMap(b => Array(b.tier >= 5 ? 4 : 2).fill(b) as BrokerSeed[]);

type ObStage = 'rejected' | 'kyc' | 'elog_sent' | 'elog_stalled' | 'ucc' | 'live';
const OB_MIX: [ObStage, number][] = [['rejected', 10], ['kyc', 16], ['elog_sent', 4], ['elog_stalled', 6], ['ucc', 8], ['live', 36]];
const obPlan = OB_MIX.flatMap(([s, n]) => Array<ObStage>(n).fill(s));
for (let i = obPlan.length - 1; i > 0; i--) {
  const j = intBetween(ro, 0, i);
  [obPlan[i], obPlan[j]] = [obPlan[j], obPlan[i]];
}
// Application 1 is Arjun Patel, stalled 11 days at the BSE e-log — the seeded story.
obPlan.splice(obPlan.indexOf('elog_stalled'), 1);
obPlan.unshift('elog_stalled');

const clientsByBroker = new Map<number, number[]>();
for (const c of clients) {
  if (!clientsByBroker.has(c.broker.id)) clientsByBroker.set(c.broker.id, []);
  clientsByBroker.get(c.broker.id)!.push(c.id);
}
const usedClients = new Set<number>(Object.values(STORY));
let leadId = 0;

for (let i = 1; i <= obPlan.length; i++) {
  const isArjun = i === 1;
  const stage = obPlan[i - 1];
  const sb = isArjun ? brokers[3] : pick(ro, obWeights);
  // The BSE e-log is a digital-path step only. Paper applications clear it the
  // moment KRA verifies — when they stall, they stall on documents, at KYC.
  const digital = isArjun || stage === 'elog_sent' || stage === 'elog_stalled' || chance(ro, 0.1);
  const reached = { kyc: true, elogSent: stage !== 'rejected' && stage !== 'kyc', elogDone: stage === 'ucc' || stage === 'live', ucc: stage === 'live' };

  // Gaps between stages, then days sitting in the current one — start date follows.
  const g1 = intBetween(ro, 0, 3);                        // lead → application opened
  const g2 = intBetween(ro, 1, 4);                        // opened → KRA verdict
  const g3 = digital ? intBetween(ro, 1, 2) : 0;          // verdict → e-log sent
  const g4 = digital ? intBetween(ro, 1, 6) : 0;          // e-log sent → e-log cleared
  const g5 = intBetween(ro, 1, 3);                        // e-log cleared → UCC allotted
  const waiting = isArjun ? 11
    : stage === 'rejected' ? intBetween(ro, 1, 25)
      : stage === 'kyc' ? intBetween(ro, 1, 9)
        : stage === 'elog_sent' ? intBetween(ro, 1, 6)
          : stage === 'elog_stalled' ? intBetween(ro, 8, 22)
            : stage === 'ucc' ? intBetween(ro, 1, 9)
              // Live: skewed towards recent, so completions land every week rather
              // than spreading flat over four months and leaving this month empty.
              : 1 + Math.floor(ro() ** 2 * 119);
  const dVerdict = waiting + (stage === 'rejected' || stage === 'kyc' ? 0 : g3 + (reached.elogDone ? g4 : 0) + (reached.ucc ? g5 : 0));
  const dStarted = dVerdict + (stage === 'kyc' ? 0 : g2);
  const dLead = dStarted + g1;
  const on = (daysAgo: number) => addDays(TODAY, -Math.max(daysAgo, 0));
  const at = { lead: on(dLead), started: on(dStarted), verdict: on(dVerdict), elogSent: on(dVerdict - g3), elogDone: on(dVerdict - g3 - g4), ucc: on(dVerdict - g3 - g4 - g5) };

  const clientPool = (clientsByBroker.get(sb.id) ?? []).filter(id => !usedClients.has(id));
  const clientId = isArjun ? STORY.arjun : stage === 'live' && clientPool.length ? pick(ro, clientPool) : null;
  if (clientId) usedClients.add(clientId);
  const name = clientId ? clients[clientId - 1].name : `${pick(ro, FIRST)} ${pick(ro, LAST)}`;

  // The lead exists unless this walked in as paper across the counter.
  const hasLead = digital || chance(ro, 0.55);
  const myLead = hasLead ? ++leadId : null;
  if (myLead) {
    ins('leads', { lead_id: myLead, source: digital ? pick(ro, ['link', 'campaign', 'referral']) : pick(ro, LEAD_SOURCES), sb_id: sb.id, name, mobile: `97${String(20000000 + i * 517).slice(0, 8)}`, email: `${name.toLowerCase().replace(/[^a-z]/g, '.')}@example.in`, consent_state: 'granted', stage: stage === 'live' ? 'converted' : 'onboarding', created_at: at.lead, converted_client_id: clientId });
    emit({ at: at.lead, subjectType: 'application', subjectId: i, type: 'lead_created', payload: { source: digital ? 'link' : 'walk_in', sb_id: sb.id }, source: 'ui' });
  }

  const reject = stage === 'rejected' ? pick(ro, KRA_REJECTS) : null;
  ins('client_kyc_logs', {
    id: i, fk_clm_id: clientId, name, mobile_no: `97${String(20000000 + i * 517).slice(0, 8)}`, pan_no: pan(4000 + i), dob: addDays(TODAY, -intBetween(ro, 8000, 22000)),
    request_id: digital ? `DGO-${7000 + i}` : `KRA-${7000 + i}`,
    status: reject ? 'REJECTED' : stage === 'kyc' ? 'PENDING' : 'VERIFIED',
    kra_status: reject ? 'KRA Rejected' : stage === 'kyc' ? 'Under Process' : 'KRA Verified',
    kra_status_code: reject ?? 'ERR-00000',
    bse_status: reject || stage === 'kyc' ? null : 'Registered',
    rejection_level: reject ? 'KRA' : null,
    kyc_type: digital ? 'Aadhaar eKYC' : 'Physical KRA',
    is_digio: digital ? 1 : 0, kyc_linked: clientId ? 1 : 0,
    entry_date: at.started, modification_date: stage === 'kyc' ? at.started : at.verdict,
  });

  ins('onboarding_applications', {
    application_id: i, lead_id: myLead, client_id: clientId, sb_id: sb.id,
    channel: digital ? 'digital' : 'offline', holding_type: chance(ro, 0.18) ? 'Joint' : 'Single',
    digio_request_id: digital ? `DGO-${7000 + i}` : null, kyc_log_id: i,
    kyc_status: reject ? 'REJECTED' : stage === 'kyc' ? 'PENDING' : 'VERIFIED',
    kra_status: reject ? 'KRA Rejected' : stage === 'kyc' ? 'Under Process' : 'KRA Verified',
    bse_status: reject || stage === 'kyc' ? null : 'Registered',
    elog_status: !reached.elogSent ? null : stage === 'elog_stalled' ? 'stalled' : reached.elogDone ? 'completed' : 'sent',
    ucc_status: stage === 'live' ? 'ACTIVE' : reached.elogDone ? 'PENDING_UCC' : reached.elogSent ? 'PENDING_ELOG' : null,
    // When this application entered the e-log stage — the clock the stall rule reads.
    stall_since: reached.elogSent && !reached.elogDone ? at.elogSent : null,
    started_at: at.started, completed_at: stage === 'live' ? at.ucc : null,
  });

  emit({ at: at.started, actorType: 'user', actorId: sb.id, subjectType: 'application', subjectId: i, type: 'application_started', payload: { channel: digital ? 'digital' : 'offline', sb_id: sb.id }, source: 'ui' });
  if (reject) {
    emit({ at: at.verdict, subjectType: 'application', subjectId: i, type: 'kyc_rejected', payload: { error_code: reject, level: 'KRA' }, source: 'api' });
  } else if (stage !== 'kyc') {
    emit({ at: at.verdict, subjectType: 'application', subjectId: i, type: 'kyc_verified', payload: { kyc_type: digital ? 'Aadhaar eKYC' : 'Physical KRA' }, source: 'api' });
    if (digital) emit({ at: at.elogSent, subjectType: 'application', subjectId: i, type: 'elog_sent', payload: { digio_request_id: `DGO-${7000 + i}` }, source: 'api' });
    if (stage === 'elog_stalled') emit({ at: at.elogSent, subjectType: 'application', subjectId: i, type: 'elog_stalled', payload: { since: at.elogSent }, source: 'system' });
    if (reached.elogDone) emit({ at: at.elogDone, subjectType: 'application', subjectId: i, type: 'elog_completed', payload: digital ? {} : { note: 'paper mandate — no BSE e-log step' }, source: 'api' });
    if (reached.ucc) emit({ at: at.ucc, subjectType: 'application', subjectId: i, type: 'ucc_allotted', payload: { client_id: clientId }, source: 'api' });
  }
}

// Leads that never became an application — the top of the funnel.
for (let i = 0; i < 62; i++) {
  const stage = pick(ro, ['new', 'new', 'new', 'contacted', 'contacted', 'lost']);
  ins('leads', { lead_id: ++leadId, source: pick(ro, LEAD_SOURCES), sb_id: pick(ro, obWeights).id, name: `${pick(ro, FIRST)} ${pick(ro, LAST)}`, mobile: `97${String(31000000 + i * 733).slice(0, 8)}`, consent_state: chance(ro, 0.85) ? 'granted' : 'unknown', stage, created_at: addDays(TODAY, -intBetween(ro, 1, 75)) });
}

// The link counter is the ledger's count, not a stored guess. Visits stay stored —
// they come from web analytics, which this database genuinely does not hold.
db.exec(`UPDATE broker_links SET applications =
  (SELECT COUNT(*) FROM onboarding_applications oa WHERE oa.sb_id = broker_links.sb_id)`);

// files, import runs, quarantine, AUM recon
let fhId = 0;
for (let d = 20; d >= 1; d--) {
  for (const src of ['CAMS', 'KARVY']) {
    fhId++;
    ins('file_history', { id: fhId, name: `${src}_TXN_${addDays(TODAY, -d)}.dbf`, file_source: src, file_type: 'TRANSACTION', upload_date: addDays(TODAY, -d), is_imported: 1, is_processed: 1, total_transactions: intBetween(r, 200, 1500), uploaded_by: 1 });
  }
}
(['cams', 'kfin', 'r2a'] as const).forEach((src, i) => {
  ins('import_runs', { run_id: i + 1, source: src, window_from: addDays(TODAY, -15), window_to: TODAY, state: 'promoted', started_at: TODAY + 'T08:05:00', finished_at: TODAY + 'T08:2' + i + ':00', row_counts: JSON.stringify({ landed: 1240 - i * 300, enriched: 1238 - i * 300, promoted: 1233 - i * 300, quarantined: i === 0 ? 5 : 0 }) });
  emit({ at: TODAY + 'T08:2' + i + ':00', subjectType: 'workflow', subjectId: 'file_ops', type: 'import_run_completed', payload: { source: src }, source: 'import' });
});
const Q_ROWS = [['RMF03GP', 'unknown_scheme'], ['117CARG', 'unknown_scheme'], ['NIP-ELSS-DIR', 'unknown_scheme'], ['PAN AAXPZ9999Z', 'unknown_client'], ['IDCW Sweep Reinvest', 'unknown_type']];
Q_ROWS.forEach(([raw, reason], i) => ins('quarantine_rows', { q_id: i + 1, run_id: 1, raw_row: JSON.stringify({ text: raw, file: `CAMS_TXN_${TODAY}.dbf`, row: 400 + i }), reason, state: 'open', created_at: TODAY + 'T08:25:00' }));
ins('quarantine_rows', { q_id: 6, run_id: 1, raw_row: JSON.stringify({ text: 'SBI-CB-2026' }), reason: 'unknown_scheme', state: 'mapped', resolved_by: 'ops-1', created_at: addDays(TODAY, -1) });
[0, 1, 2].forEach(d => ins('aum_import_status', { id: d + 1, aum_date: addDays(TODAY, -d), expected_file_count: 3, current_file_count: d === 2 ? 2 : 3, status: d === 2 ? 'LATE_FILE' : 'COMPLETED' }));
let aumId = 0;
for (const a of folioAgg.slice(0, 300)) {
  aumId++;
  const mismatch = aumId % 8 === 0 && aumId <= 304 && a.res.balanceUnits > 0;
  const missing = aumId % 47 === 0;
  const rtaUnits = missing ? null : mismatch ? round4(a.res.balanceUnits + between(r, 0.5, 45)) : a.res.balanceUnits;
  ins('aum_master', { id: aumId, am_asset_date: addDays(TODAY, -1), am_folio_no: a.f.folioNo, fk_scheme_id: a.f.scheme.id, am_units: rtaUnits, calculated_units: a.res.balanceUnits, am_difference: rtaUnits == null ? null : round4(rtaUnits - a.res.balanceUnits), am_status: missing ? 3 : mismatch ? 2 : 1, aum_rta: a.f.scheme.id % 2 === 0 ? 1 : 2 });
}
for (let i = 1; i <= 12; i++) ins('aum_reco_ignore_list', { id: i, folio_no: folios[i * 30].folioNo, scheme_id: folios[i * 30].scheme.id, created_at: addDays(TODAY, -intBetween(r, 10, 200)) });
ins('redemption_limit_alert', { id: 1, type: 'AMOUNT', amount: 500000, alert_for: 'NORMAL', status: 1 });
ins('redemption_limit_alert', { id: 2, type: 'AMOUNT', amount: 2500000, alert_for: 'PORTFOLIO', status: 1 });

// orders sample
const ORDER_STATES = ['ALLOTTED', 'ALLOTTED', 'ALLOTTED', 'ALLOTTED', 'ALLOTTED', 'PENDING', 'PENDING', 'PENDING', 'REJECTED', 'REJECTED', 'PLACED', 'PLACED'];
ORDER_STATES.forEach((st, i) => {
  const f = folios[(i + 1) * 40];
  const d = addDays(TODAY, -(i % 5));
  ins('bse_order_list', { id: i + 1, order_id: 66000 + i, mem_ord_ref_id: `JSL-${9000 + i}`, ucc: `MKYC${String(f.client.id).padStart(4, '0')}`, order_type: 'PURCHASE', scheme: f.scheme.name, amount: intBetween(r, 1, 8) * 25000, status: st, placed_at: d + 'T10:15:00', allotment_date: st === 'ALLOTTED' ? addDays(d, 1) : null, allotment_nav: st === 'ALLOTTED' ? f.scheme.series.navs[f.scheme.series.navs.length - 1] : null, arn: 'ARN-3524', sub_broker_code: brokers.find(b => b.id === f.sbId)!.code, euin: brokers.find(b => b.id === f.sbId)!.euin, rejection_reason: st === 'REJECTED' ? pick(r, ['Payment not received within cut-off', 'UCC KYC flag invalid']) : null, is_reject_send: st === 'REJECTED' && i % 2 === 0 ? 1 : 0, source: pick(r, ['client_app', 'broker_app', 'service_ticket']) });
  ['RECEIVED', 'SENT_TO_EXCHANGE', st].forEach((ev, j) => ins('bse_order_history', { id: i * 3 + j + 1, order_id: 66000 + i, event_status: ev, event_time: d + 'T10:1' + (5 + j) + ':00', sort_order: j + 1 }));
});
ins('pending_order_item', { id: 1, batch_id: 'b-2026-08-07-01', clm_id: 5, order_type: 'PURCHASE', transaction_type: 'Additional Purchase', request_json: JSON.stringify({ scheme_id: 3, amount: 750000, note: 'Zoho ticket #4821 — client called' }), amount: 750000, folio_no: folios[10].folioNo, status: 'PENDING', created_by: 3, created_at: TODAY + 'T09:40:00', euin_no: brokers[2].euin, sub_broker_code: brokers[2].code, source: 'service_ticket' });

// actions + events (the organism, day one)
let actionId = 0;
interface ActionIn {
  subjectType: string; subjectId: string | number; type: string; evidence: unknown;
  impact: number; lens: string; sbId?: number; step: string; slaDays: number;
  state?: string; outcomeType?: string; ruleKey?: string;
}
function mint(a: ActionIn) {
  actionId++;
  const created = addDays(TODAY, -intBetween(r, 0, 4));
  ins('actions', { action_id: actionId, subject_type: a.subjectType, subject_id: String(a.subjectId), action_type: a.type, trigger_evidence: JSON.stringify(a.evidence), impact_score: round2(a.impact), owner_lens: a.lens, assignee_sb_id: a.sbId ?? null, suggested_step: a.step, sla_due: addDays(TODAY, a.slaDays), state: a.state ?? 'assigned', outcome_type: a.outcomeType ?? null, created_from: a.ruleKey ? `rule:${a.ruleKey}` : 'manual', created_at: created, closed_at: a.state === 'done' ? TODAY : null, dismiss_reason: a.state === 'dismissed' ? 'client informed us directly — already resolved' : null });
  emit({ at: created, actorType: 'agent', actorId: 'signal-engine', subjectType: 'action', subjectId: actionId, type: 'action_minted', payload: { action_type: a.type, rule: a.ruleKey } });
  if (a.state === 'done') emit({ at: TODAY, actorType: 'user', actorId: a.sbId ?? 'ops', subjectType: 'action', subjectId: actionId, type: 'outcome_recorded', payload: { outcome: a.outcomeType } });
  return actionId;
}
const bouncedSips = db.prepare("SELECT s.sip_id, s.fk_acc_id, s.fk_sb_id, s.tr_amount, s.tr_folio_no, x.npayments_missed FROM sip_master s JOIN bse_sxp_list x ON x.reg_no = s.sxp_bos_code WHERE x.npayments_missed >= 2").all() as { sip_id: number; fk_acc_id: number; fk_sb_id: number; tr_amount: number; tr_folio_no: string; npayments_missed: number }[];
for (const s of bouncedSips) {
  const isMeera = s.fk_acc_id === STORY.meera;
  mint({ subjectType: 'sip', subjectId: s.sip_id, type: 'sip_bounce_save', evidence: { folio: s.tr_folio_no, missed: s.npayments_missed, monthly: s.tr_amount, mandate_expires: isMeera ? '2026-08-12' : undefined }, impact: s.tr_amount * 12, lens: 'broker', sbId: s.fk_sb_id, step: 'Call client · WhatsApp draft ready', slaDays: isMeera ? 0 : 2, ruleKey: 'sip_bounce_x2', state: isMeera ? 'assigned' : pick(r, ['assigned', 'assigned', 'in_progress', 'done']), outcomeType: chance(r, 0.5) ? 'saved' : 'no_response' });
}
// Every stalled application owns an action, whichever way it is stuck. The three
// kinds need three different conversations, so they carry three different steps.
(db.prepare(`SELECT oa.application_id, oa.sb_id, oa.elog_status, oa.kyc_status, oa.stall_since, oa.started_at, k.kra_status_code
  FROM onboarding_applications oa JOIN client_kyc_logs k ON k.id = oa.kyc_log_id
  WHERE oa.ucc_status IS NOT 'ACTIVE' AND (oa.kyc_status='REJECTED'
     OR (oa.elog_status IN ('sent','stalled') AND julianday('${TODAY}') - julianday(oa.stall_since) > 7)
     OR (oa.kyc_status='PENDING' AND julianday('${TODAY}') - julianday(oa.started_at) > 7))`)
  .all() as { application_id: number; sb_id: number; elog_status: string | null; kyc_status: string; stall_since: string | null; started_at: string; kra_status_code: string }[]).forEach(row => {
    const elog = row.elog_status === 'stalled';
    const rejected = row.kyc_status === 'REJECTED';
    mint({
      subjectType: 'application', subjectId: row.application_id, type: 'kyc_unstick',
      evidence: elog ? { stalled_at: 'BSE e-log authentication', since: row.stall_since }
        : rejected ? { rejected_by: 'KRA', error_code: row.kra_status_code, since: row.started_at }
          : { stalled_at: 'documents not filed with the KRA', since: row.started_at },
      impact: 120000, lens: 'broker', sbId: row.sb_id,
      step: elog ? 'Send e-log nudge · Call' : rejected ? 'Collect the corrected document · Refile' : 'Chase the missing documents',
      slaDays: 1, ruleKey: 'kyc_stall_days',
    });
  });
const dormant = db.prepare(`
  SELECT v.client_id, v.value_now, m.fk_primary_sub_broker_id sb, (SELECT MAX(tr_date) FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id WHERE t.fk_acc_id=v.client_id AND tt.tr_type_add_in_fifo=1) last_txn
  FROM v_client_value v JOIN client_master m ON m.cm_user_id=v.client_id
  WHERE v.value_now > 500000 AND last_txn < date('${TODAY}', '-14 months')
  ORDER BY v.value_now DESC LIMIT 40`).all() as { client_id: number; value_now: number; sb: number | null; last_txn: string }[];
for (const d of dormant) {
  mint({ subjectType: 'client', subjectId: d.client_id, type: 'dormant_review', evidence: { value: d.value_now, last_transaction: d.last_txn }, impact: round2(d.value_now * 0.05), lens: 'broker', sbId: d.sb ?? undefined, step: 'Book review · Open review pack', slaDays: 14, ruleKey: 'dormant_client' });
}
const taxWin = db.prepare("SELECT fk_acc_id, SUM(sh_unrealized_ltcg) g, MIN(fk_sb_id) sb FROM fifo_summary_holding GROUP BY fk_acc_id HAVING g BETWEEN 40000 AND 120000 ORDER BY g DESC LIMIT 6").all() as { fk_acc_id: number; g: number; sb: number }[];
for (const t of taxWin) {
  mint({ subjectType: 'client', subjectId: t.fk_acc_id, type: 'tax_window', evidence: { unrealized_ltcg: round2(t.g), fy_exemption: 125000 }, impact: round2(t.g * 0.125), lens: 'broker', sbId: t.sb, step: 'Open harvest proposal', slaDays: 55, ruleKey: 'tax_window_headroom' });
}
const conc = db.prepare('SELECT client_id, folio_no, portfolio_weight w, present_market_value v, advisor_code FROM fifo_summary_holding_active f WHERE portfolio_weight > 45 AND present_market_value > 500000 AND (SELECT COUNT(DISTINCT scheme_id) FROM fifo_summary_holding_active x WHERE x.client_id = f.client_id) >= 3 ORDER BY w DESC LIMIT 4').all() as { client_id: number; folio_no: string; w: number; v: number; advisor_code: string }[];
for (const c of conc) {
  const sb = brokers.find(b => b.code === c.advisor_code)!;
  mint({ subjectType: 'client', subjectId: c.client_id, type: 'concentration_review', evidence: { folio: c.folio_no, weight_pct: c.w, value: c.v }, impact: round2(c.v * 0.1), lens: 'broker', sbId: sb.id, step: 'Propose rebalance', slaDays: 21, ruleKey: 'concentration_pct' });
}
(db.prepare('SELECT id, am_folio_no, am_difference FROM aum_master WHERE am_status=2 ORDER BY ABS(am_difference) DESC LIMIT 8').all() as { id: number; am_folio_no: string; am_difference: number }[]).forEach(m => {
  mint({ subjectType: 'folio', subjectId: m.am_folio_no, type: 'recon_break', evidence: { units_difference: m.am_difference, aum_row: m.id }, impact: 0, lens: 'ops', step: 'Investigate units mismatch', slaDays: 3, ruleKey: 'large_redemption' });
});
(db.prepare("SELECT q_id, reason FROM quarantine_rows WHERE state='open'").all() as { q_id: number; reason: string }[]).forEach(q => {
  mint({ subjectType: 'quarantine', subjectId: q.q_id, type: 'quarantine_fix', evidence: { reason: q.reason }, impact: 0, lens: 'ops', step: 'Map and reprocess', slaDays: 1 });
});
mint({ subjectType: 'broker', subjectId: 5, type: 'euin_remediation', evidence: { transactions_missing_euin: 24, statutory_window_days: 30 }, impact: 0, lens: 'ops', step: 'Collect EUIN declarations', slaDays: 22 });
mint({ subjectType: 'folio', subjectId: folios.find(x => x.client.id === STORY.kapoorHuf)!.folioNo, type: 'dual_broker_review', evidence: { brokers: ['Babulal Joshi', 'Swadesh Rao'], rule: 'one folio, one broker' }, impact: 0, lens: 'ops', step: 'Resolve broker attribution', slaDays: 7 });
varianceRows.slice(0, 3).forEach(id => {
  mint({ subjectType: 'brokerage_row', subjectId: id, type: 'terms_variance', evidence: { paid_vs_agreed_bps: -12, amc: 'per rate card' }, impact: 18000, lens: 'management', step: 'Raise with AMC', slaDays: 10 });
});
mint({ subjectType: 'client', subjectId: 220, type: 'large_redemption_review', evidence: { amount: 750000, threshold: 500000 }, impact: 750000, lens: 'ops', step: 'Confirm with broker before T+1', slaDays: 0, state: 'done', outcomeType: 'confirmed_genuine', ruleKey: 'large_redemption' });
mint({ subjectType: 'client', subjectId: 445, type: 'dormant_review', evidence: { value: 620000 }, impact: 31000, lens: 'broker', sbId: 6, step: 'Book review', slaDays: 10, state: 'dismissed', ruleKey: 'dormant_client' });

// policies, experiments, learning evidence
ins('policies', { policy_id: 1, workflow: 'sip_save', policy_key: 'nudge_framing', belief: JSON.stringify({ urgency: 0.52, loss: 0.31, info: 0.17 }), evidence_n: 142, target_n: 200, version: 3, changed_at: '2026-07-28', changed_by: 'nightly-eval', approved_by: 'ops-head' });
ins('policies', { policy_id: 2, workflow: 'sip_save', policy_key: 'escalation_day', belief: JSON.stringify({ day: 7 }), evidence_n: 89, target_n: 150, version: 2, changed_at: '2026-08-04', changed_by: 'nightly-eval', approved_by: 'ops-head' });
ins('policies', { policy_id: 3, workflow: 'kyc_unblock', policy_key: 'nudge_framing', belief: JSON.stringify({ loss: 0.4, opportunity: 0.35, plain: 0.25 }), evidence_n: 34, target_n: 200, version: 1, changed_at: '2026-07-15', changed_by: 'preset', approved_by: 'ops-head' });
ins('policies', { policy_id: 4, workflow: 'dormant_reactivation', policy_key: 'contact_channel', belief: JSON.stringify({ preset: 'call_first' }), evidence_n: 0, target_n: 100, version: 1, changed_at: '2026-08-01', changed_by: 'preset', approved_by: 'ops-head' });
ins('experiments', { experiment_id: 1, workflow: 'kyc_unblock', variants: JSON.stringify(['loss', 'opportunity', 'plain']), allocation: 'equal', status: 'running', approved_by: 'compliance', started_at: '2026-07-15' });
for (let i = 0; i < 142; i++) emit({ at: addDays(TODAY, -intBetween(r, 1, 60)), actorType: 'user', actorId: pick(r, brokers).id, subjectType: 'workflow', subjectId: 'sip_save', type: 'outcome_recorded', payload: { framing: pick(r, ['urgency', 'loss', 'info']), saved: chance(r, 0.62) }, source: 'ui' });
for (let i = 0; i < 34; i++) emit({ at: addDays(TODAY, -intBetween(r, 1, 22)), actorType: 'user', actorId: 4, subjectType: 'workflow', subjectId: 'kyc_unblock', type: 'outcome_recorded', payload: { framing: pick(r, ['loss', 'opportunity', 'plain']), completed: chance(r, 0.5) }, source: 'ui' });
emit({ at: '2026-07-28', actorType: 'agent', actorId: 'nightly-eval', subjectType: 'workflow', subjectId: 'sip_save', type: 'policy_changed', payload: { policy: 'nudge_framing', version: 3, evidence_n: 142 } });
emit({ at: '2026-08-04', actorType: 'agent', actorId: 'nightly-eval', subjectType: 'workflow', subjectId: 'sip_save', type: 'policy_changed', payload: { policy: 'escalation_day', version: 2, evidence_n: 89 } });

// campaign + segments
ins('segments', { segment_id: 1, name: 'Equity holders > ₹1L, marketing consent', owner: 'studio', definition: JSON.stringify({ asset: 'Equity', min_value: 100000, consent: 'marketing' }), is_shared: 1, created_at: '2026-07-20' });
ins('segments', { segment_id: 2, name: 'Dormant > 14 months', owner: 'studio', definition: JSON.stringify({ rule: 'dormant_client' }), is_shared: 1, created_at: '2026-07-20' });
ins('segments', { segment_id: 3, name: 'SIP-active, no ELSS', owner: 'studio', definition: JSON.stringify({ has_sip: true, missing_category: 'ELSS (Tax Savings)' }), is_shared: 0, created_at: '2026-08-01' });
// ── The campaign shelf ───────────────────────────────────────────────────────
// Head office writes them, compliance approves them, brokers run them. A template
// without an approval artefact is not runnable — that gate is data, not policy,
// so one template deliberately sits unapproved to prove the gate does something.
const rm = rng(20260807 + 55);
const TEMPLATES: [number, string, string, string | null, string | null][] = [
  [1, 'ELSS tax-season drive', 'creatives/elss-fy27.html', 'approvals/AMFI-ELSS-2026-07.pdf', '2026-07-21'],
  [2, 'SIP top-up on a raise', 'creatives/sip-topup.html', 'approvals/AMFI-SIPTOPUP-2026-05.pdf', '2026-05-14'],
  [3, 'Idle money into liquid funds', 'creatives/liquid-parking.html', 'approvals/AMFI-LIQUID-2026-06.pdf', '2026-06-02'],
  [4, 'Annual portfolio review invite', 'creatives/review-invite.html', 'approvals/AMFI-REVIEW-2026-04.pdf', '2026-04-11'],
  [5, 'Nominee update reminder', 'creatives/nominee-nudge.html', 'approvals/AMFI-NOMINEE-2026-07.pdf', '2026-07-03'],
  [6, 'New smallcap fund launch', 'creatives/smallcap-nfo.html', null, null],
];
for (const [id, name, creative, artefact, at] of TEMPLATES) {
  ins('campaign_templates', {
    template_id: id, name, creative_ref: creative, disclaimers_injected: 1,
    approval_artefact_ref: artefact, approved_by: artefact ? 'compliance' : null, approved_at: at,
  });
}

const CAMPAIGNS: [number, number, string, number, string, number][] = [
  // id, template, name, segment, state, days ago launched
  [1, 1, 'ELSS drive · Aug', 1, 'live', 6],
  [2, 2, 'SIP top-up · Jul', 3, 'closed', 48],
  [3, 3, 'Idle money · Jun', 1, 'closed', 76],
  [4, 4, 'Review season invite', 2, 'live', 21],
  // Drafted on an unapproved template. It appears on the shelf and cannot be sent —
  // a gate nobody can see is a gate nobody trusts.
  [5, 6, 'Smallcap NFO · draft', 1, 'draft', 2],
];
for (const [id, tpl, name, seg, state, ago] of CAMPAIGNS) {
  ins('campaigns', { campaign_id: id, template_id: tpl, name, segment_id: seg, mode: 'through_broker', state, launched_at: addDays(TODAY, -ago) });
  emit({ at: addDays(TODAY, -ago), actorType: 'user', actorId: 'studio', subjectType: 'campaign', subjectId: id, type: 'campaign_launched', payload: { template: tpl, segment: seg } });
}

// The send set is the segment intersected with consent for THAT channel and
// purpose. The query is the enforcement — there is no policy layer to forget.
const sendSet = db.prepare(`SELECT DISTINCT c.client_id, f.advisor_code, co.channel
  FROM (SELECT client_id, SUM(present_market_value) v FROM fifo_summary_holding_active
        GROUP BY client_id HAVING v > 100000) c
  JOIN fifo_summary_holding_active f ON f.client_id = c.client_id
  JOIN consents co ON co.client_id = c.client_id AND co.purpose='marketing' AND co.state='granted'
  ORDER BY c.client_id`).all() as { client_id: number; advisor_code: string; channel: string }[];

const RESPONSES: [string, number][] = [
  ['replied_interested', 0.40], ['clicked', 0.34], ['declined', 0.18], ['unsubscribed', 0.08],
];
const pickResponse = () => {
  let x = rm();
  for (const [type, w] of RESPONSES) { if ((x -= w) <= 0) return type; }
  return RESPONSES[0][0];
};

// The date of each client's most recent purchase, used only to decide who is
// likely to have replied. The transactions themselves are untouched.
const investedAfter = new Map<string, string>();
for (const row of db.prepare(`SELECT t.fk_acc_id id, MAX(t.tr_date) d FROM transaction_master t
  JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
  WHERE tt.tr_type_buy_sell_flag = 1 GROUP BY 1`).all() as { id: number; d: string }[]) {
  investedAfter.set(String(row.id), row.d);
}

let sendId = 0, respId = 0;
const responderActions: { actionId: number; clientId: number; at: string }[] = [];
// Withdrawals must bite on every send that comes after them, so campaigns are
// walked oldest-first and each send re-checks consent as of its own date. Walking
// them in id order let a client who unsubscribed on an old campaign still receive
// a newer one — lawful-looking in the row, unlawful on the timeline.
const withdrawnAt = new Map<string, string>();
const approvedTemplates = new Set(TEMPLATES.filter(t => t[3] !== null).map(t => t[0]));
for (const [cid, tpl, cname, , state, ago] of [...CAMPAIGNS].sort((a, b) => b[5] - a[5])) {
  // The seed obeys the same gate the page does: nothing goes out on an unapproved
  // template, and a draft has not gone out at all.
  if (!approvedTemplates.has(tpl) || state === 'draft') continue;
  const sentAt = addDays(TODAY, -ago + 1);
  for (const m of sendSet) {
    // Not every campaign goes to everyone: each targets a slice of the consented set.
    if (!chance(rm, cid === 1 ? 0.5 : 0.3)) continue;
    const gone = withdrawnAt.get(`${m.client_id}|${m.channel}`);
    if (gone && sentAt >= gone) continue;
    sendId++;
    const sb = brokers.find(b => b.code === m.advisor_code)!;
    // Delivery is not guaranteed. A number that assumes it would be a lie.
    const delivery = chance(rm, 0.94) ? 'delivered' : chance(rm, 0.5) ? 'failed' : 'pending';
    ins('campaign_sends', { send_id: sendId, campaign_id: cid, client_id: m.client_id, sb_id: sb.id, channel: m.channel, sent_at: sentAt, delivery_state: delivery });
    // Clients who went on to invest are likelier to have replied — that is the
    // direction of causation, and selecting responders this way keeps every row
    // truthful: the linked transaction genuinely exists and genuinely post-dates
    // the reply. Without it the demo shows real data and an empty ROI column.
    const invested = investedAfter.get(`${m.client_id}`);
    if (delivery !== 'delivered' || !chance(rm, invested && invested > sentAt ? 0.42 : 0.08)) continue;

    respId++;
    const type = pickResponse();
    // A reply cannot arrive tomorrow. The most recent campaign went out five days
    // ago, so an unclamped 1–6 day lag ran past today.
    const lagged = addDays(sentAt, intBetween(rm, 1, 6));
    const respondedAt = lagged > TODAY ? TODAY : lagged;
    // Only an interested reply is worth someone's time; the rest are recorded but
    // do not manufacture work for the broker.
    const act = type === 'replied_interested'
      ? mint({ subjectType: 'client', subjectId: m.client_id, type: 'campaign_responder', evidence: { campaign: cname, response: type, channel: m.channel }, impact: 46800, lens: 'broker', sbId: sb.id, step: 'Call within 24h', slaDays: 1 })
      : null;
    if (act) responderActions.push({ actionId: act, clientId: m.client_id, at: respondedAt });
    ins('campaign_responses', { response_id: respId, send_id: sendId, response_type: type, responded_at: respondedAt, minted_action_id: act });
    // A withdrawal recorded as a response must also stop future sends.
    if (type === 'unsubscribed') {
      db.prepare("UPDATE consents SET state='withdrawn', ts=?, captured_via='campaign opt-out' WHERE client_id=? AND channel=? AND purpose='marketing'")
        .run(respondedAt, m.client_id, m.channel);
      withdrawnAt.set(`${m.client_id}|${m.channel}`, respondedAt);
    }
  }
}

// ROI, the conservative way (founder's ruling): money counts only when a human
// closed the action and named the transaction it produced. Everything else stays
// unattributed rather than being claimed by a 30-day coincidence window.
const linkTxn = db.prepare(`SELECT t.tr_id, t.tr_amount FROM transaction_master t
  JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
  WHERE t.fk_acc_id = ? AND tt.tr_type_buy_sell_flag = 1 AND t.tr_date >= ? AND t.tr_date <= ?
  ORDER BY t.tr_amount DESC LIMIT 1`);
const closeAction = db.prepare(`UPDATE actions SET state='done', outcome_type=?, outcome_value=?,
  linked_txn_ids=?, closed_at=? WHERE action_id=?`);
for (const ra of responderActions) {
  if (!chance(rm, 0.7)) continue;                        // the rest are still open
  const txn = linkTxn.get(ra.clientId, ra.at, TODAY) as { tr_id: number; tr_amount: number } | undefined;
  const closedAt = addDays(ra.at, intBetween(rm, 1, 9));
  if (txn) {
    closeAction.run('invested', JSON.stringify({ amount: txn.tr_amount }), JSON.stringify([txn.tr_id]), closedAt, ra.actionId);
    emit({ at: closedAt, actorType: 'user', subjectType: 'action', subjectId: ra.actionId, type: 'outcome_recorded', payload: { outcome: 'invested', linked_txn_ids: [txn.tr_id], amount: txn.tr_amount }, source: 'ui' });
  } else {
    closeAction.run('no_investment', JSON.stringify({ note: 'spoke to client, no action taken' }), null, closedAt, ra.actionId);
    emit({ at: closedAt, actorType: 'user', subjectType: 'action', subjectId: ra.actionId, type: 'outcome_recorded', payload: { outcome: 'no_investment' }, source: 'ui' });
  }
}

// Demo-broker (sb 4) queue enrichment. The UPDATEs below are seed authorship
// like Meera's pinned 12-Aug mandate — pages still compute from the columns.
// Story clients get families matching their surnames (name overrides happen
// after family generation, which otherwise leaves e.g. Meera Shah in "Solanki Family").
for (const sid of Object.values(STORY)) {
  const c2 = clients[sid - 1];
  const fam = `${c2.name.split(' ').slice(-1)[0]} Family`;
  db.prepare('UPDATE family_master SET family_name=? WHERE family_id=?').run(fam, c2.family);
  db.prepare('UPDATE fifo_summary_holding_active SET family_name=? WHERE family_id=?').run(fam, c2.family);
}
const DEMO_SB = 4;
const storyIds = Object.values(STORY);

const bdayRows = db.prepare(`
  SELECT c.cm_user_id id, c.cm_full_name name, c.cm_date_of_birth dob
  FROM client_master c JOIN client_sub_broker_mapping m ON m.cm_user_id=c.cm_user_id AND m.sb_id=?
  WHERE c.cm_user_id NOT IN (${storyIds.join(',')})
  ORDER BY c.cm_user_id LIMIT 3`).all(DEMO_SB) as { id: number; name: string; dob: string }[];
bdayRows.forEach((c, i) => {
  const inDays = [1, 3, 5][i];
  const md = addDays(TODAY, inDays).slice(5);
  db.prepare("UPDATE client_master SET cm_date_of_birth = substr(cm_date_of_birth,1,4) || '-' || ? WHERE cm_user_id=?").run(md, c.id);
  mint({ subjectType: 'client', subjectId: c.id, type: 'birthday_week', evidence: { birthday: c.dob.slice(0, 4) + '-' + md, in_days: inDays }, impact: 0, lens: 'broker', sbId: DEMO_SB, step: 'Send wishes · WhatsApp draft ready', slaDays: inDays, ruleKey: 'birthday_week' });
});

const expiring = db.prepare(`
  SELECT s.sip_id, s.fk_acc_id cid, s.tr_amount amt, m.id mid, s.tr_folio_no folio
  FROM sip_master s
  JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
  JOIN bse_mandate_list m ON m.exch_mandate_id=x.exch_mandate_id
  JOIN client_sub_broker_mapping map ON map.cm_user_id=s.fk_acc_id AND map.sb_id=?
  WHERE s.is_live_sip=1 AND s.fk_acc_id != ${STORY.meera}
  ORDER BY s.tr_amount DESC LIMIT 2`).all(DEMO_SB) as { sip_id: number; cid: number; amt: number; mid: number; folio: string }[];
expiring.forEach((row, i) => {
  const end = addDays(TODAY, [21, 38][i]);
  db.prepare('UPDATE bse_mandate_list SET end_date=? WHERE id=?').run(end, row.mid);
  mint({ subjectType: 'sip', subjectId: row.sip_id, type: 'mandate_expiring', evidence: { folio: row.folio, monthly: row.amt, mandate_ends: end }, impact: row.amt * 12, lens: 'broker', sbId: DEMO_SB, step: 'Send re-authorisation link', slaDays: [14, 30][i], ruleKey: 'mandate_expiring_45d' });
});

const idle = db.prepare(`
  SELECT f.client_id cid, ROUND(SUM(f.present_market_value),2) v, COUNT(*) holdings
  FROM fifo_summary_holding_active f
  JOIN client_sub_broker_mapping m ON m.cm_user_id=f.client_id AND m.sb_id=?
  WHERE f.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip=1)
  GROUP BY f.client_id ORDER BY v DESC LIMIT 4`).all(DEMO_SB) as { cid: number; v: number; holdings: number }[];
for (const c of idle) {
  mint({ subjectType: 'client', subjectId: c.cid, type: 'idle_no_sip', evidence: { value: c.v, holdings: c.holdings, suggested_monthly: Math.round(c.v * 0.01) }, impact: round2(c.v * 0.12), lens: 'broker', sbId: DEMO_SB, step: 'Propose SIP · 1% of book monthly', slaDays: 14, ruleKey: 'idle_no_sip' });
}

const conc4 = db.prepare(`
  SELECT f.client_id cid, f.folio_no folio, f.portfolio_weight w, f.present_market_value v
  FROM fifo_summary_holding_active f
  JOIN client_sub_broker_mapping m ON m.cm_user_id=f.client_id AND m.sb_id=?
  WHERE f.portfolio_weight > 45 AND f.present_market_value > 500000
    AND (SELECT COUNT(DISTINCT scheme_id) FROM fifo_summary_holding_active x WHERE x.client_id=f.client_id) >= 3
    AND NOT EXISTS (SELECT 1 FROM actions a WHERE a.action_type='concentration_review' AND a.subject_id=CAST(f.client_id AS TEXT))
  ORDER BY w DESC LIMIT 3`).all(DEMO_SB) as { cid: number; folio: string; w: number; v: number }[];
for (const c of conc4) {
  mint({ subjectType: 'client', subjectId: c.cid, type: 'concentration_review', evidence: { folio: c.folio, weight_pct: c.w, value: c.v }, impact: round2(c.v * 0.1), lens: 'broker', sbId: DEMO_SB, step: 'Propose rebalance', slaDays: 21, ruleKey: 'concentration_pct' });
}

// One bounce that recovered on its own — the auto-closed chip (Gainsight rule).
const recovered = db.prepare(`
  SELECT s.sip_id, s.tr_amount amt, s.tr_folio_no folio, x.id xid
  FROM sip_master s
  JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code
  JOIN client_sub_broker_mapping m ON m.cm_user_id=s.fk_acc_id AND m.sb_id=?
  WHERE s.is_live_sip=1 AND s.fk_acc_id != ${STORY.meera} AND x.npayments_missed=0
  ORDER BY s.sip_id LIMIT 1`).get(DEMO_SB) as { sip_id: number; amt: number; folio: string; xid: number } | undefined;
if (recovered) {
  db.prepare('UPDATE bse_sxp_list SET npayments_missed=1 WHERE id=?').run(recovered.xid);
  mint({ subjectType: 'sip', subjectId: recovered.sip_id, type: 'sip_bounce_save', evidence: { folio: recovered.folio, missed: 1, monthly: recovered.amt, resolved_by: `instalment of ${recovered.amt} succeeded ${addDays(TODAY, -2)}` }, impact: recovered.amt * 12, lens: 'broker', sbId: DEMO_SB, step: '—', slaDays: 2, ruleKey: 'sip_bounce_x2', state: 'done', outcomeType: 'auto_resolved' });
}

// serving matview-tables
db.exec(`
INSERT INTO mv_portfolio_attention (client_id, flag_type, severity, evidence, rule_version, as_of)
SELECT h.fk_acc_id, 'laggard', 'medium',
       json_object('folio', h.sh_folio_no, 'xirr', h.sh_xirr, 'benchmark_xirr', h.sh_bmxirr, 'value', h.sh_current_value),
       1, '${TODAY}'
FROM fifo_summary_holding h
WHERE h.sh_current_value > 500000 AND h.sh_xirr IS NOT NULL AND h.sh_bmxirr IS NOT NULL
  AND h.sh_xirr < h.sh_bmxirr - 10;
INSERT INTO mv_portfolio_attention (client_id, flag_type, severity, evidence, rule_version, as_of)
SELECT f.client_id, 'concentration', 'high',
       json_object('folio', f.folio_no, 'weight_pct', f.portfolio_weight, 'value', f.present_market_value),
       1, '${TODAY}'
FROM fifo_summary_holding_active f
WHERE f.portfolio_weight > 45 AND f.present_market_value > 500000
  AND (SELECT COUNT(DISTINCT scheme_id) FROM fifo_summary_holding_active x WHERE x.client_id = f.client_id) >= 3;
`);
const staleStmt = db.prepare(`INSERT INTO mv_portfolio_attention (client_id, flag_type, severity, evidence, rule_version, as_of) VALUES (?, 'stale', 'medium', ?, 1, '${TODAY}')`);
dormant.forEach(d => staleStmt.run(d.client_id, JSON.stringify({ value: d.value_now, last_transaction: d.last_txn })));

const wfRows: [string, string, number, number][] = [
  ['sip_save', '% saved within 7 days', 64, 6],
  ['kyc_unblock', 'median days stuck', 9.4, -2.1],
  ['onboarding', 'median lead→live days', 6.2, -1.1],
  ['dormant_reactivation', '₹ reactivated (Q)', 21000000, -3000000],
  ['payout_run', 'invoices by day-N', 4, -1],
];
for (const [wf, metric, val, trend] of wfRows) {
  const stats = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN state IN ('proposed','assigned','in_progress') THEN 1 ELSE 0 END) open FROM actions WHERE action_type LIKE ?").get(wf === 'sip_save' ? 'sip_bounce%' : wf === 'kyc_unblock' ? 'kyc%' : wf === 'dormant_reactivation' ? 'dormant%' : '%') as { n: number; open: number };
  const pol = db.prepare('SELECT evidence_n, target_n, changed_at FROM policies WHERE workflow=? ORDER BY version DESC LIMIT 1').get(wf) as { evidence_n: number; target_n: number; changed_at: string } | undefined;
  ins('mv_workflow_health', { workflow: wf, goal_metric_name: metric, goal_metric_value: val, trend_30d: trend, in_flight: stats.open ?? 0, sla_pct: intBetween(r, 74, 95), brain_status: !pol || pol.evidence_n === 0 ? 'preset' : pol.evidence_n >= pol.target_n ? 'learned' : 'learning', evidence_n: pol?.evidence_n ?? 0, last_policy_change: pol?.changed_at ?? null, as_of: TODAY });
}
for (const b of brokers.filter(x => x.active)) {
  const flows = db.prepare(`SELECT COALESCE(SUM(CASE WHEN tt.tr_type_buy_sell_flag=1 THEN t.tr_amount WHEN tt.tr_type_buy_sell_flag=-1 THEN -t.tr_amount ELSE 0 END),0) f FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id WHERE t.fk_sb_id=? AND t.tr_date >= ?`).get(b.id, monthStart(TODAY)) as { f: number };
  const sips = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(tr_amount),0) v FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1').get(b.id) as { n: number; v: number };
  const sla = db.prepare("SELECT COUNT(*) n, SUM(CASE WHEN state='done' THEN 1 ELSE 0 END) done FROM actions WHERE assignee_sb_id=?").get(b.id) as { n: number; done: number };
  ins('mv_broker_scorecard', { sb_id: b.id, month: monthStart(TODAY), net_flows: round2(flows.f), sip_live_count: sips.n, sip_live_value: sips.v, bounce_rate: round2(between(r, 0.5, 4)), clients_gained: intBetween(r, 0, 3), clients_lost: intBetween(r, 0, 1), action_sla_pct: sla.n ? round2((sla.done / sla.n) * 100) : null });
}
([['bse', 0.5, 0], ['cams', 2, 0], ['kfin', 2, 0], ['digio', 1, 0], ['morningstar', 6, 1]] as [string, number, number][]).forEach(([name, lag, streak]) =>
  ins('mv_integration_health', { integration: name, last_success_at: TODAY + 'T08:30:00', lag_hours: lag, error_streak: streak, as_of: TODAY }));
{
  const paid = db.prepare("SELECT COUNT(*) months, COALESCE(SUM(total_amount),0) total FROM invoice_master WHERE fk_sb_id=17 AND period_start_date >= '2025-12-01'").get() as { months: number; total: number };
  ins('mv_nominee_payouts', { sb_id: 17, terminated_on: '2025-11-30', nominee: 'Nominee of Girish Desai', months_paid: paid.months, total_paid: round2(paid.total), as_of: TODAY });
}
ins('saved_queries', { query_id: 1, name: 'Clients with money but no broker', question_text: 'How many clients hold value today with no broker mapped?', sql: "SELECT COUNT(*) FROM v_client_value v JOIN client_master c ON c.cm_user_id=v.client_id WHERE c.fk_primary_sub_broker_id IS NULL AND NOT EXISTS (SELECT 1 FROM client_sub_broker_mapping m WHERE m.cm_user_id=c.cm_user_id)", verified_by: 'claude', visibility: 'mgmt' });
ins('saved_queries', { query_id: 2, name: 'Dormant clients over floor', question_text: 'Who has been idle 14+ months with over ₹5L?', sql: "SELECT client_id, value_now FROM v_client_value WHERE value_now > 500000", verified_by: 'claude', visibility: 'mgmt' });
ins('saved_queries', { query_id: 3, name: 'EUIN gaps this month', question_text: 'Which transactions this month are missing EUIN?', sql: "SELECT COUNT(*) FROM transaction_master WHERE tr_file_euin IS NULL AND tr_date >= date('now','start of month')", verified_by: 'claude', visibility: 'ops' });
// ── Review packs: a year of history, so "overdue" means something ────────────
// A pack is generated, sent, and then either lands or does not. All three states
// are seeded — a history where every client replied would make the follow-up
// column decorative.
const rp = rng(20260807 + 33);
ins('review_packs', { pack_id: 1, client_id: STORY.desaiHead, sb_id: 1, generated_at: addDays(TODAY, -2), content_ref: 'packs/desai-2026-08.pdf', sent_via: 'whatsapp', client_response: null, action_ids: '[]' });
let packId = 1, dlId = 1;
const packCandidates = db.prepare(`SELECT h.client_id, h.client_name, h.advisor_code,
    SUM(h.present_market_value) v
  FROM fifo_summary_holding_active h WHERE h.balance_units > 0.0001
  GROUP BY h.client_id HAVING v > 300000 ORDER BY v DESC LIMIT 140`)
  .all() as { client_id: number; client_name: string; advisor_code: string; v: number }[];
for (const c of packCandidates) {
  // Not everyone has ever been reviewed — that gap is the point of the page.
  if (!chance(rp, 0.55)) continue;
  const sb = brokers.find(b => b.code === c.advisor_code);
  if (!sb) continue;
  const ago = intBetween(rp, 20, 460);
  const generatedAt = addDays(TODAY, -ago);
  const via = pick(rp, ['whatsapp', 'email', 'in_person']);
  // Recent packs may genuinely not have been answered yet.
  const response = ago < 10 ? null
    : pick(rp, ['opened', 'opened', 'opened', 'replied', 'meeting_booked', null, null]);
  packId++;
  ins('review_packs', {
    pack_id: packId, client_id: c.client_id, sb_id: sb.id, generated_at: generatedAt,
    content_ref: `packs/${c.client_name.toLowerCase().replace(/[^a-z]/g, '-')}-${generatedAt.slice(0, 7)}.pdf`,
    sent_via: via, client_response: response, action_ids: '[]',
  });
  dlId++;
  // The async PDF queue that production already runs. A couple are still working.
  const stillRunning = ago <= 1 && chance(rp, 0.5);
  ins('download_history_logs', {
    id: dlId, user_id: sb.id, pdf_type: 'REVIEW_PACK',
    status: stillRunning ? 'RUNNING' : 'COMPLETED',
    file_url: stillRunning ? null : `reports/pack-${packId}.pdf`,
    report_for: `client:${c.client_id}`, is_broker: 1,
    requested_at: generatedAt, completed_at: stillRunning ? null : generatedAt,
  });
  emit({ at: generatedAt, actorType: 'user', actorId: sb.id, subjectType: 'client', subjectId: c.client_id, type: 'review_pack_sent', payload: { pack_id: packId, via }, source: 'ui' });
  if (response) {
    emit({ at: addDays(generatedAt, intBetween(rp, 1, 8)), actorType: 'client', actorId: c.client_id, subjectType: 'client', subjectId: c.client_id, type: 'review_pack_response', payload: { pack_id: packId, response }, source: 'ui' });
  }
}

// Report history, so the download queue is not an empty promise. Some have aged
// past the seven-day expiry — a file that still worked forever would be the bug.
const REPORT_RUNS: [string, string, number, number][] = [
  ['portfolio_valuation', 'pdf', 2, 96], ['capital_gain', 'xlsx', 5, 41],
  ['taxation', 'pdf', 9, 53], ['active_sip', 'xlsx', 12, 24],
  ['commission_statement', 'xlsx', 3, 1199], ['transaction', 'xlsx', 19, 2140],
  ['rejection', 'pdf', 26, 3], ['redemption', 'xlsx', 33, 88],
];
for (const [rid, fmt, ago, rows] of REPORT_RUNS) {
  dlId++;
  const at = addDays(TODAY, -ago);
  ins('download_history_logs', {
    id: dlId, user_id: 4, pdf_type: rid, format: fmt,
    params: JSON.stringify({ scope: 'my book', as_at: at }), row_count: rows,
    status: 'COMPLETED', file_url: `reports/${rid}-${at}.${fmt}`, report_for: 'my book',
    is_broker: 1, requested_at: at, completed_at: at, expires_at: addDays(at, 7),
  });
}

// A pack should be able to reference the last conversation, so conversations exist.
let interactionId = 0;
const KINDS: [string, string][] = [
  ['call', 'Discussed the ELSS allocation and the lock-in. Client asked to revisit after the appraisal.'],
  ['meeting', 'Annual review. Walked through fund performance against the benchmark; agreed to hold.'],
  ['note', 'Client mentioned a property purchase in the next 18 months — keep liquidity in mind.'],
  ['call', 'Explained the SIP bounce and re-registered the mandate over the phone.'],
];
for (const c of packCandidates.slice(0, 90)) {
  if (!chance(rp, 0.6)) continue;
  const sb = brokers.find(b => b.code === c.advisor_code);
  if (!sb) continue;
  const [kind, transcript] = pick(rp, KINDS);
  interactionId++;
  ins('interactions', {
    interaction_id: interactionId, client_id: c.client_id, sb_id: sb.id, kind,
    transcript, structured: JSON.stringify({ source: 'seed' }), minted_action_id: null,
    occurred_at: addDays(TODAY, -intBetween(rp, 3, 300)),
  });
}
ins('payout_disputes', { dispute_id: 1, sb_id: 8, brokerage_row_refs: JSON.stringify([varianceRows[0] ?? 1]), reason: 'July trail lower than expected on equity book', state: 'open', raised_at: addDays(TODAY, -3), action_id: null });
ins('download_history_logs', { id: 1, user_id: 1, pdf_type: 'PORTFOLIO_VALUATION', status: 'COMPLETED', file_url: 'reports/pv-desai.pdf', report_for: 'client:103', is_broker: 1, requested_at: addDays(TODAY, -2), completed_at: addDays(TODAY, -2) });

const counts = ['client_master', 'sub_broker_master', 'folio_master', 'transaction_master', 'sip_master', 'fifo_summary_holding', 'fifo_summary_holding_active', 'brokerage_master', 'invoice_master', 'actions', 'events', 'mv_portfolio_attention', 'campaign_sends', 'consents']
  .map(t => `${t}=${(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n}`).join(' · ');
console.log('SEEDED:', counts);
console.log('DB:', DB_PATH);
