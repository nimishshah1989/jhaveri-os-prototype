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
const AMCS = ['HDFC', 'ICICI Prudential', 'SBI', 'Axis', 'Kotak', 'Nippon India', 'Aditya Birla SL', 'UTI', 'Mirae Asset', 'DSP', 'Tata', 'Franklin India'];
AMCS.forEach((a, i) => ins('amc_master', { amc_id: i + 1, amc_name: a + ' Mutual Fund' }));

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
  const name = `${AMCS[amc - 1]} ${CATS[cat - 1][0]} ${pick(r, STYLE)}`;
  const equity = cat <= 5;
  const s: SchemeSeed = { id: i + 1, name, amc, cat, bench: catBench[cat - 1], series, equity };
  schemes.push(s);
  const latest = series.navs[series.navs.length - 1];
  ins('scheme_master', { scheme_id: s.id, scheme_full_name: name, scheme_short_name: name, fk_amc_id: amc, fk_category_id: cat, fk_benchmark_id: s.bench, scheme_amfi_code: String(100000 + i), scheme_isin_code: `INF${200 + amc}K0${1000 + i}`, scheme_rta: chance(r, 0.55) ? 'C' : 'K', scheme_exit_load: equity ? 1 : 0, scheme_expense_ratio: round2(between(r, 0.4, 1.9)), scheme_day_end_nav: latest, scheme_day_end_nav_date: TODAY, risk_level: equity ? 'Very High' : 'Moderate', is_jhaveri_pick: chance(r, 0.18) ? 1 : 0 });
  ins('mf_latest_price_master', { fk_scheme_id: s.id, price: latest, price_date: TODAY });
  series.dates.forEach((d, j) => histStmt.run(s.id, d, series.navs[j]));
}
const benchSeries = new Map<number, NavSeries>();
for (let b = 1; b <= 8; b++) benchSeries.set(b, makeNavSeries(r, 100, 44, [0.13, 0.12, 0.15, 0.16, 0.07, 0.065, 0.10, 0.09][b - 1], [0.14, 0.12, 0.18, 0.22, 0.02, 0.004, 0.09, 0.12][b - 1], TODAY));
for (let a = 1; a <= 12; a++) {
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
  ins('sb_monthly_target', { id, fk_sb_id: id, target_month: monthStart(TODAY), target_lumpsum_amount: intBetween(r, 10, 60) * 100000, target_sip_count: intBetween(r, 4, 20), target_sip_amount: intBetween(r, 1, 8) * 100000, target_client_count: intBetween(r, 2, 10) });
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
  ins('consents', { consent_id: i, client_id: i, channel: 'whatsapp', purpose: 'transactional', state: 'granted', captured_via: 'onboarding', ts: addDays(TODAY, -intBetween(r, 100, 900)) });
  if (chance(r, 0.77)) ins('consents', { consent_id: 2000 + i, client_id: i, channel: 'whatsapp', purpose: 'marketing', state: chance(r, 0.94) ? 'granted' : 'withdrawn', captured_via: 'onboarding', ts: addDays(TODAY, -intBetween(r, 100, 900)) });
}

let trId = 0, folioId = 0, sipId = 0, sxpId = 0, mandateId = 0;
interface FolioSeed { folioNo: string; scheme: SchemeSeed; client: ClientSeed; txns: Txn[]; sbId: number }
const folios: FolioSeed[] = [];
interface TxnIn {
  date: string; typeId: number; buySell: 1 | -1 | 0; amount: number; price: number;
  sbId?: number; sipReg?: string; noEuin?: boolean;
}
function addTxn(f: FolioSeed, t: TxnIn) {
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
  const n = c.id === STORY.desaiHead ? 3 : c.id === STORY.kapoorHuf ? 2 : intBetween(r, 1, 3);
  const chosen = new Set<number>();
  for (let k = 0; k < n; k++) {
    let s = pick(r, schemes);
    if (c.id === STORY.meera && k === 0) s = schemes[0];
    if (c.id === STORY.kapoorHuf && k === 0) s = schemes[0];
    if (isDesai) s = schemes[(c.id * 3 + k * 7) % 60];
    if (chosen.has(s.id)) continue;
    chosen.add(s.id);
    folioId++;
    const f: FolioSeed = { folioNo: String(5000000 + folioId), scheme: s, client: c, txns: [], sbId: c.broker.id };
    folios.push(f);
    const start = isDesai ? addDays(TODAY, -820)
      : c.id === STORY.kapoorHuf && k === 0 ? addDays(TODAY, -700)
      : addDays(TODAY, -intBetween(r, 200, 1000));
    ins('folio_master', { folio_id: folioId, fm_folio_no: f.folioNo, fk_scheme_id: s.id, fk_acc_id: c.id, fm_pan_no: pan(c.id), fm_sub_broker_code: c.broker.code, fm_arn_no: 'ARN-3524', fm_euin: c.broker.euin, fm_holding: 'Single', fm_nominee1_name: chance(r, 0.7) ? pick(r, FIRST) + ' ' + c.name.split(' ').slice(-1)[0] : null, folio_start_date: start, is_active: 1 });
    const lump = isDesai ? [1500000, 1200000, 900000, 600000][k + (c.id === STORY.desaiSpouse ? 3 : 0)]
      : c.id === STORY.kapoorHuf && k === 0 ? 400000
      : intBetween(r, 1, 12) * 25000;
    addTxn(f, { date: start, typeId: 1, buySell: 1, amount: lump, price: navAt(s.series, start) });
    if (!isDesai && chance(r, 0.5)) {
      const d = addDays(start, intBetween(r, 60, 300));
      addTxn(f, { date: d, typeId: 20, buySell: 1, amount: intBetween(r, 1, 6) * 25000, price: navAt(s.series, d) });
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
      const heldValue = f.txns.filter(t => t.buySell === 1).reduce((s2, t) => s2 + t.amount, 0);
      addTxn(f, { date: redDate, typeId: 2, buySell: -1, amount: round2(heldValue * between(r, 0.1, 0.45)), price: navAt(s.series, redDate) });
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

// brokerage: monthly trail per broker × asset-class, computed from tier % + rate card
['Trail', 'Upfront', 'Incentive', 'Clawback'].forEach((t, i) => ins('brokerage_type_master', { brk_type_id: i + 1, brk_type_name: t }));
let bkrId = 0, invId = 0, invDataId = 0;
const pendingInvoiceData: Record<string, unknown>[] = [];
const bookByBroker = new Map<number, number>();
for (const a of folioAgg) bookByBroker.set(a.f.sbId, round2((bookByBroker.get(a.f.sbId) ?? 0) + a.value));
const months: string[] = [];
for (let m = 13; m >= 0; m--) months.push(monthStart(addDays(monthStart(TODAY), -m * 31)));
const eqCard = db.prepare("SELECT AVG(agreed_trail_bps) t FROM amc_rate_card WHERE scheme_category='Equity'").get() as { t: number };
const neCard = db.prepare("SELECT AVG(agreed_trail_bps) t FROM amc_rate_card WHERE scheme_category='Non-Equity'").get() as { t: number };
const varianceRows: number[] = [];
for (const b of brokers) {
  const book = bookByBroker.get(b.id) ?? 0;
  if (book === 0) continue;
  let fyCum = 0;
  for (let mi = 0; mi < months.length; mi++) {
    const m = months[mi];
    if (!b.active && m >= '2025-12-01') {
      // terminated broker: payouts continue to nominee (story)
    }
    const aumMonth = round2(book * (1 - 0.011 * (months.length - 1 - mi)));
    const monthEnd = addDays(monthStart(addDays(m, 40)), -1);
    const rows: [string, number, number][] = [['Equity', round2(aumMonth * 0.7), eqCard.t], ['Non-Equity', round2(aumMonth * 0.3), neCard.t]];
    let invTotal = 0, invGst = 0, invTds = 0;
    invId++;
    const fy = m >= '2026-04-01' ? '26-27' : '25-26';
    const invoiceNo = `MF/${fy}/${String(invId).padStart(4, '0')}`;
    for (const [cls, base, agreed] of rows) {
      bkrId++;
      const shortpaid = b.id === 9 && mi >= 11 && cls === 'Equity';
      if (shortpaid) varianceRows.push(bkrId);
      const paidBps = shortpaid ? agreed - 12 : agreed + between(r, -1.5, 1.5);
      const received = round2((base * (paidBps / 10000)) / 12);
      const payout = round2(received * (b.tierPct / 100));
      const gst = b.gst ? round2(payout * 0.18) : 0;
      const tds = round2(payout * 0.05);
      const recoOff = b.id === 12 && mi === 12 && cls === 'Non-Equity';
      ins('brokerage_master', { bkr_id: bkrId, fk_sb_id: b.id, fk_bkr_type_id: 1, bkr_from_date: m, bkr_to_date: monthEnd, tr_amount: base, bkr_percentage: round4(paidBps / 100), bkr_amount: received, bkr_payout_rate_precentage: b.tierPct, bkr_payout_amount: payout, payout_gst_amount: gst, payout_tds: tds, has_gst: b.gst ? 1 : 0, fk_invoice_id: invId, calc_units: null, calc_tr_amount: base, calc_rate: round4(agreed / 100), calc_brok_amount: round2((base * (agreed / 10000)) / 12), reco_status: recoOff ? 2 : 1, reco_difference: recoOff ? round2(received - (base * (agreed / 10000)) / 12) : 0, reco_remarks: recoOff ? 'rate mismatch vs computed' : null });
      invTotal += payout; invGst += gst; invTds += tds;
      invDataId++;
      pendingInvoiceData.push({ invoice_data_id: invDataId, fk_invoice_id: invId, brk_type_id: 1, payout_amount: payout, gst_amount: gst, net_amount: round2(payout + gst - tds) });
    }
    ins('invoice_master', { invoice_id: invId, invoice_no: invoiceNo, fk_sb_id: b.id, invoice_date: monthEnd, period_start_date: m, period_end_date: monthEnd, sub_total: round2(invTotal), cgst: round2(invGst / 2), sgst: round2(invGst / 2), tds: round2(invTds), total_amount: round2(invTotal + invGst - invTds), payment_date: mi < months.length - 1 ? addDays(monthEnd, 5) : null });
    pendingInvoiceData.forEach(rowData => ins('invoice_data', rowData));
    pendingInvoiceData.length = 0;
    if (fy === '26-27') fyCum += invTotal;
  }
  ins('sb_fy_brokerage_tracker', { id: b.id, fk_sb_id: b.id, financial_year: '26-27', cumulative_payout: round2(fyCum), threshold_crossed: fyCum > 2000000 ? 1 : 0, crossing_month: fyCum > 2000000 ? '2026-07-01' : null });
}
// clawbacks: 8 rows tied to ceased SIPs
const ceased = db.prepare("SELECT sip_id, fk_sb_id, tr_amount FROM sip_master LIMIT 8").all() as { sip_id: number; fk_sb_id: number; tr_amount: number }[];
ceased.forEach((s, i) => {
  bkrId++;
  const amt = -round2(s.tr_amount * 0.012);
  ins('brokerage_master', { bkr_id: bkrId, fk_sb_id: s.fk_sb_id, fk_bkr_type_id: 4, bkr_from_date: monthStart(TODAY), bkr_to_date: TODAY, tr_amount: 0, bkr_amount: amt, bkr_payout_rate_precentage: 0, bkr_payout_amount: round2(amt * 0.7), payout_gst_amount: 0, payout_tds: 0, has_gst: 0, reco_status: 1, reco_difference: 0, clawback_source_txn: s.sip_id });
});
months.forEach((m, i) => ins('brokerage_payout_queue', { id: i + 1, from_date: m, to_date: addDays(monthStart(addDays(m, 40)), -1), requested_by: 1, status: 2, approved_by: 2, approved_at: addDays(m, 36) }));
ins('brokerage_payout_queue', { id: 99, from_date: monthStart(TODAY), to_date: TODAY, requested_by: 1, status: 0 });

// KYC, leads, onboarding applications
for (let i = 1; i <= 60; i++) {
  const rejected = i > 52;
  const pending = i > 40 && i <= 52;
  ins('client_kyc_logs', { id: i, fk_clm_id: i <= 40 ? i : null, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, pan_no: pan(3000 + i), status: rejected ? 'REJECTED' : pending ? 'PENDING' : 'VERIFIED', kra_status: rejected ? 'KRA Rejected' : pending ? 'Under Process' : 'KRA Verified', kra_status_code: rejected ? pick(r, ['ERR-00009', 'ERR-00004', 'ERR-00017']) : 'ERR-00000', bse_status: rejected ? null : 'Registered', rejection_level: rejected ? 'KRA' : null, kyc_type: 'Aadhaar eKYC', is_digio: i % 3 === 0 ? 1 : 0, kyc_linked: 1, entry_date: addDays(TODAY, -intBetween(r, 2, 90)) });
}
const LEAD_SOURCES = ['link', 'referral', 'campaign', 'walk_in', 'manual'];
for (let i = 1; i <= 24; i++) {
  const stage = pick(r, ['new', 'new', 'contacted', 'onboarding', 'converted', 'lost']);
  ins('leads', { lead_id: i, source: pick(r, LEAD_SOURCES), sb_id: pick(r, brokers.filter(b => b.active)).id, name: `${pick(r, FIRST)} ${pick(r, LAST)}`, mobile: `97${String(20000000 + i * 517).slice(0, 8)}`, consent_state: 'granted', stage, created_at: addDays(TODAY, -intBetween(r, 1, 60)), converted_client_id: stage === 'converted' ? 1118 + i : null });
}
for (let i = 1; i <= 30; i++) {
  const digital = i <= 12;
  const isArjun = i === 1;
  const stalled = isArjun || i === 2 || i === 3;
  ins('onboarding_applications', { application_id: i, lead_id: i <= 24 ? i : null, client_id: isArjun ? STORY.arjun : null, sb_id: isArjun ? 4 : pick(r, brokers.filter(b => b.active)).id, channel: digital ? 'digital' : 'offline', holding_type: 'Single', digio_request_id: digital ? `DGO-${7000 + i}` : null, kyc_status: stalled ? 'VERIFIED' : pick(r, ['VERIFIED', 'PENDING']), kra_status: 'KRA Verified', bse_status: stalled ? 'Registered' : null, elog_status: stalled ? 'stalled' : digital ? pick(r, ['completed', 'sent']) : null, ucc_status: stalled ? 'PENDING_ELOG' : null, stall_since: isArjun ? addDays(TODAY, -11) : stalled ? addDays(TODAY, -intBetween(r, 8, 15)) : null, started_at: addDays(TODAY, -intBetween(r, 5, 45)), completed_at: !stalled && chance(r, 0.6) ? addDays(TODAY, -intBetween(r, 1, 20)) : null });
}

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
(db.prepare("SELECT application_id, sb_id, stall_since FROM onboarding_applications WHERE elog_status='stalled'").all() as { application_id: number; sb_id: number; stall_since: string }[]).forEach(row => {
  mint({ subjectType: 'application', subjectId: row.application_id, type: 'kyc_unstick', evidence: { stalled_at: 'BSE e-log authentication', since: row.stall_since }, impact: 120000, lens: 'broker', sbId: row.sb_id, step: 'Send e-log nudge · Call', slaDays: 1, ruleKey: 'kyc_stall_days' });
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
ins('campaign_templates', { template_id: 1, name: 'ELSS tax-season drive', creative_ref: 'creatives/elss-fy27.html', disclaimers_injected: 1, approval_artefact_ref: 'approvals/AMFI-ELSS-2026-07.pdf', approved_by: 'compliance', approved_at: '2026-07-21' });
ins('campaigns', { campaign_id: 1, template_id: 1, name: 'ELSS drive · Aug', segment_id: 1, mode: 'through_broker', state: 'live', launched_at: addDays(TODAY, -14) });
emit({ at: addDays(TODAY, -14), actorType: 'user', actorId: 'studio', subjectType: 'campaign', subjectId: 1, type: 'campaign_launched' });
const marketable = db.prepare("SELECT c.client_id, f.advisor_code FROM (SELECT client_id, SUM(present_market_value) v FROM fifo_summary_holding_active GROUP BY client_id HAVING v > 100000) c JOIN fifo_summary_holding_active f ON f.client_id = c.client_id JOIN consents co ON co.client_id = c.client_id AND co.purpose='marketing' AND co.state='granted' GROUP BY c.client_id LIMIT 400").all() as { client_id: number; advisor_code: string }[];
let sendId = 0, respId = 0;
for (const m of marketable) {
  sendId++;
  const sb = brokers.find(b => b.code === m.advisor_code)!;
  ins('campaign_sends', { send_id: sendId, campaign_id: 1, client_id: m.client_id, sb_id: sb.id, channel: 'whatsapp', sent_at: addDays(TODAY, -13), delivery_state: 'delivered' });
  if (respId < 37 && chance(r, 0.1)) {
    respId++;
    const act = mint({ subjectType: 'client', subjectId: m.client_id, type: 'campaign_responder', evidence: { campaign: 'ELSS drive · Aug', response: 'replied_interested' }, impact: 46800, lens: 'broker', sbId: sb.id, step: 'Call within 24h', slaDays: 1 });
    ins('campaign_responses', { response_id: respId, send_id: sendId, response_type: 'replied_interested', responded_at: addDays(TODAY, -intBetween(r, 1, 12)), minted_action_id: act });
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
ins('review_packs', { pack_id: 1, client_id: STORY.desaiHead, sb_id: 1, generated_at: addDays(TODAY, -2), content_ref: 'packs/desai-2026-08.pdf', sent_via: 'whatsapp', client_response: null, action_ids: '[]' });
ins('payout_disputes', { dispute_id: 1, sb_id: 8, brokerage_row_refs: JSON.stringify([varianceRows[0] ?? 1]), reason: 'July trail lower than expected on equity book', state: 'open', raised_at: addDays(TODAY, -3), action_id: null });
ins('download_history_logs', { id: 1, user_id: 1, pdf_type: 'PORTFOLIO_VALUATION', status: 'COMPLETED', file_url: 'reports/pv-desai.pdf', report_for: 'client:103', is_broker: 1, requested_at: addDays(TODAY, -2), completed_at: addDays(TODAY, -2) });

const counts = ['client_master', 'sub_broker_master', 'folio_master', 'transaction_master', 'sip_master', 'fifo_summary_holding', 'fifo_summary_holding_active', 'brokerage_master', 'invoice_master', 'actions', 'events', 'mv_portfolio_attention', 'campaign_sends', 'consents']
  .map(t => `${t}=${(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n}`).join(' · ');
console.log('SEEDED:', counts);
console.log('DB:', DB_PATH);
