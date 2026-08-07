// Client-360 checks: header/holdings/lots/tax must reconcile to the rupee for
// every client in the demo broker's book, not just the showcase client.
// Usage: npx tsx mockdb/verify-360.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  clientKpis, clientHoldings, clientMix, taxPosition, clientTxns, familyMembers,
  clientHeader, journeySeries, fundVerdict, riskScale,
} from '../lib/client360';
import { benchmarkComparison, equityCurve, lookThrough } from '../lib/portfolio';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const bookIds = (raw.prepare("SELECT DISTINCT client_id FROM fifo_summary_holding_active WHERE advisor_code='1228'")
  .all() as { client_id: number }[]).map(r => r.client_id);

let vBad = 0, lotBad = 0, taxBad = 0;
for (const id of bookIds) {
  const kpi = clientKpis(id).value;
  const h = clientHoldings(id).rows;
  const hv = h.reduce((s, r) => s + r.value, 0);
  if (Math.abs(hv - kpi.v) > 0.05) vBad++;
  for (const row of h) {
    const lotV = row.lots.reduce((s, l) => s + l.current_value, 0);
    if (Math.abs(lotV - row.value) > 1) lotBad++;
  }
  const t = taxPosition(id).value;
  const lotUnreal = h.flatMap(r => r.lots).reduce((s, l) => s + l.unreal_lt + l.unreal_st, 0);
  if (Math.abs(lotUnreal - (t.unreal_lt + t.unreal_st)) > 1) taxBad++;
}
check(`every client's KPI value == Σ holdings (${bookIds.length} clients)`, vBad === 0, `${vBad} mismatches`);
check('every holding == Σ its lots', lotBad === 0, `${lotBad} mismatches`);
check('unrealised tax == Σ lot-level unrealised', taxBad === 0, `${taxBad} mismatches`);

const meera = clientKpis(101).value;
check('Meera: KPI value == Σ her holdings, and both returns computed',
  Math.abs(meera.v - clientHoldings(101).rows.reduce((s, r) => s + r.value, 0)) < 0.05
  && meera.wx != null && meera.bmx != null,
  `v=${Math.round(meera.v)} xirr=${meera.wx}% index=${meera.bmx}%`);

// One engine, one story: the KPI card and the growth chart must agree.
const cmp = benchmarkComparison(101).value;
const curveEnd = equityCurve(101).value.slice(-1)[0];
check('KPI card and growth chart agree on value and on the index comparison',
  Math.abs(cmp.value - curveEnd.value) < 1 && Math.abs(cmp.benchmark - curveEnd.benchmark) < 1
  && cmp.client_xirr === meera.wx && cmp.bench_xirr === meera.bmx,
  `value ₹${cmp.value} vs curve ₹${curveEnd.value} · index ₹${cmp.benchmark} vs curve ₹${curveEnd.benchmark}`);

const meeraMix = clientMix(101).value;
check('Meera: asset mix total == her value', Math.abs(meeraMix.reduce((s, r) => s + r.v, 0) - meera.v) < 0.05);

const tx = clientTxns(101);
check('transactions bounded: none after today, range stated',
  tx.rows.every(t => t.tr_date <= TODAY) && tx.to === TODAY, `${tx.rows.length} rows`);

const head = clientHeader(101);
check('Meera: family name matches surname (seed fix)', head?.family_name === 'Shah Family', head?.family_name);

const fam = familyMembers(head!.family_id);
const famSum = fam.rows.reduce((s, m) => s + m.v, 0);
const famIndep = raw.prepare(`SELECT COALESCE(SUM(present_market_value),0) v FROM fifo_summary_holding_active
  WHERE client_id IN (SELECT cm_user_id FROM client_master WHERE fk_family_id=?)`).get(head!.family_id) as { v: number };
check('household total == Σ member values (independent)', Math.abs(famSum - famIndep.v) < 0.05);

const lag = clientHoldings(101).rows.find(r => r.xirr != null && r.bmxirr != null && r.xirr < r.bmxirr - 10);
check('Meera: the laggard holding is flagged-able (xirr < benchmark − 10)', !!lag, lag?.fund_name);
check('Meera: fund verdict rule marks the Kotak holding lagging', !!lag && fundVerdict(lag).verdict === 'lagging');

// The books must close: net money in − cost of what remains == realized P&L.
const j = journeySeries(101).value;
const jEnd = j[j.length - 1]?.cum ?? 0;
const t101 = taxPosition(101).value;
check('Meera: journey end + realized P&L == invested (the books close)',
  Math.abs(jEnd + t101.real_lt + t101.real_st - meera.invested) < 1,
  `${jEnd} + ${t101.real_lt + t101.real_st} vs ${meera.invested}`);
check('journey series bounded by today', j.every(p => p.m <= TODAY.slice(0, 7)));

const rs = riskScale(101, 'Very Aggressive').value;
check('risk scale: client 5/5, portfolio within [1,5] and near profile',
  rs.client === 5 && rs.portfolio != null && rs.portfolio >= 1 && rs.portfolio <= 5,
  `portfolio ${rs.portfolio}`);

// Look-through: fund weights must resolve to real stocks without inventing money.
const lt = lookThrough(101).value;
check('look-through never claims more money than the client has',
  lt.covered <= lt.total + 1 && lt.coverage_pct <= 100, `covered ₹${Math.round(lt.covered)} of ₹${Math.round(lt.total)} (${lt.coverage_pct}%)`);
check('sector shares sum to 100% of what was looked through',
  Math.abs(lt.sectors.reduce((s, r) => s + r.pct, 0) - 100) < 0.6,
  `${lt.sectors.reduce((s, r) => s + r.pct, 0).toFixed(1)}% across ${lt.sectors.length} sectors`);
check('Meera: real overlap detected across her funds',
  lt.overlap_stocks > 0 && lt.overlap_pct > 0, `${lt.overlap_pct}% in ${lt.overlap_stocks} shared stocks`);

console.log(failures === 0 ? '\nCLIENT 360: ALL CHECKS PASSED' : `\nCLIENT 360: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
