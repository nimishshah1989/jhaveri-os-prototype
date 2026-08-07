// My business checks. The growth identity is the one that matters: opening plus
// net flows plus market movement must equal closing, on every broker, every month.
// Exits 1 on any drift. Usage: npx tsx mockdb/verify-business.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  BUSINESS_RULES, bookNow, aumSeries, growth, sipBook, targets, targetHistory,
  wins, losses, monthPace,
} from '../lib/business';
import { DEMO_SB } from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const one = <T>(sql: string, ...p: unknown[]): T => raw.prepare(sql).get(...p) as T;
const num = (sql: string, ...p: unknown[]) => one<{ n: number }>(sql, ...p).n;
const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const MONTH = TODAY.slice(0, 7) + '-01';
const rows = aumSeries(DEMO_SB).value;
const g = growth(DEMO_SB).value;

// 1 — THE identity. If this ever fails, the flows-vs-market split is fiction.
check('every broker-month: opening + net flows + market movement == closing',
  num(`SELECT COUNT(*) n FROM mv_monthly_aum
       WHERE ABS(opening_aum + net_flows + market_movement - month_end_aum) > 0.05`) === 0);
check('the window waterfall closes too',
  near(g.opening + g.flows + g.market, g.closing, 0.5),
  `${Math.round(g.opening)} + ${Math.round(g.flows)} + ${Math.round(g.market)} = ${Math.round(g.closing)}`);
check('flows and market shares add to 100% of the growth',
  Math.abs(g.flowsPct + g.marketPct - 100) <= 1, `${g.flowsPct}% + ${g.marketPct}%`);

// 2 — peak-day is a real day inside its month, and never below month-end.
check('peak-day AUM is never below month-end AUM',
  num('SELECT COUNT(*) n FROM mv_monthly_aum WHERE peak_day_aum < month_end_aum - 0.05') === 0);
check('every peak_date falls inside its own month',
  num(`SELECT COUNT(*) n FROM mv_monthly_aum
       WHERE substr(peak_date,1,7) != substr(month,1,7)`) === 0);
check('the peak-day figure is genuinely the maximum of that month\'s daily rows',
  num(`SELECT COUNT(*) n FROM mv_monthly_aum m WHERE ABS(m.peak_day_aum -
        (SELECT MAX(d.aum) FROM mv_aum_daily d WHERE d.sb_id=m.sb_id
         AND substr(d.aum_date,1,7)=substr(m.month,1,7))) > 0.05`) === 0);

// 3 — the daily spine has no holes; a missing day would silently move a peak.
const days = (raw.prepare('SELECT DISTINCT aum_date d FROM mv_aum_daily ORDER BY d').all() as { d: string }[]).map(x => x.d);
const holes = days.filter((d, i) => {
  if (i === 0) return false;
  const prev = new Date(days[i - 1] + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() + 1);
  return prev.toISOString().slice(0, 10) !== d;
});
check('the daily AUM spine has no missing days', holes.length === 0,
  holes.length ? `first hole before ${holes[0]}` : `${days.length} consecutive days`);
check('the spine ends today', days[days.length - 1] === TODAY, days[days.length - 1]);

// 4 — net flows in the matview are the ledger's, re-summed independently.
const flowDrift = num(`SELECT COUNT(*) n FROM mv_monthly_aum m WHERE ABS(m.net_flows - COALESCE(
    (SELECT SUM(t.tr_amount * tt.tr_type_buy_sell_flag) FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
     WHERE t.fk_sb_id=m.sb_id AND tt.tr_type_buy_sell_flag != 0
       AND substr(t.tr_date,1,7)=substr(m.month,1,7)), 0)) > 0.05`);
check('monthly net flows match an independent signed sum of the ledger', flowDrift === 0, `${flowDrift} rows differ`);

// 5 — cross-page: this book is the book My clients and My earnings use.
const b = bookNow(DEMO_SB).value;
const liveBook = num("SELECT COALESCE(SUM(present_market_value),0) n FROM fifo_summary_holding_active WHERE advisor_code='1228'");
check('today\'s AUM equals the live holdings book (same denominator as My clients)',
  near(b.aum, liveBook, 1), `spine ${Math.round(b.aum)} vs holdings ${Math.round(liveBook)}`);
const billedAug = num("SELECT COALESCE(SUM(tr_amount),0) n FROM brokerage_master WHERE fk_sb_id=? AND fk_bkr_type_id=1 AND bkr_from_date=?", DEMO_SB, MONTH);
const monthEndAug = num('SELECT COALESCE(month_end_aum,0) n FROM mv_monthly_aum WHERE sb_id=? AND month=?', DEMO_SB, MONTH);
check('the AUM the trend plots is the AUM commission was billed on',
  near(billedAug, monthEndAug, 1), `billed ${Math.round(billedAug)} vs trend ${Math.round(monthEndAug)}`);
check('client counts on the spine match the live book',
  b.clients === num("SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active WHERE advisor_code='1228' AND balance_units > 0.0001"),
  `${b.clients}`);

// 6 — the SIP bounce rate counts bounces in its own denominator.
const s = sipBook(DEMO_SB).value;
const rawBounced = num(`SELECT COUNT(*) n FROM transaction_master WHERE fk_sb_id=? AND fk_tran_type_id=33
  AND tr_date >= date(?, '-${BUSINESS_RULES.bounce_window_months} months')`, DEMO_SB, TODAY);
check('bounce count matches independent SQL', s.bounced === rawBounced, `${s.bounced}`);
check('bounce rate = bounced ÷ (collected + bounced), not ÷ collected',
  near(s.bounceRate, Math.round((s.bounced / (s.bounced + s.instalments)) * 1000) / 10, 0.11),
  `${s.bounceRate}% of ${s.bounced + s.instalments} due`);
check('live SIP count and value match sip_master',
  s.live === num('SELECT COUNT(*) n FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1', DEMO_SB)
  && near(s.monthly, num('SELECT COALESCE(SUM(tr_amount),0) n FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1', DEMO_SB)),
  `${s.live} plans, ${s.monthly}/month`);
check('annual SIP value is 12× the monthly commitment', near(s.annual, s.monthly * 12, 0.5));
check('no exited client still has a live SIP',
  num(`SELECT COUNT(*) n FROM sip_master s WHERE s.is_live_sip=1 AND s.fk_acc_id NOT IN
       (SELECT client_id FROM fifo_summary_holding_active WHERE balance_units > 0.0001)`) === 0);

// 7 — targets exist for the whole window and the actuals are re-derivable.
check('targets cover every month of the window',
  num('SELECT COUNT(*) n FROM sb_monthly_target WHERE fk_sb_id=?', DEMO_SB) === rows.length,
  `${num('SELECT COUNT(*) n FROM sb_monthly_target WHERE fk_sb_id=?', DEMO_SB)} of ${rows.length}`);
check('no target is zero or negative',
  num(`SELECT COUNT(*) n FROM sb_monthly_target WHERE target_lumpsum_amount <= 0
       OR target_sip_count <= 0 OR target_sip_amount <= 0 OR target_client_count <= 0`) === 0);
const t = targets(DEMO_SB, MONTH).value;
const rawLump = num(`SELECT COALESCE(SUM(x.tr_amount),0) n FROM transaction_master x
  JOIN transaction_type_master tt ON tt.tr_type_id=x.fk_tran_type_id
  WHERE x.fk_sb_id=? AND tt.tr_type_buy_sell_flag=1 AND substr(x.tr_date,1,7)=?`, DEMO_SB, MONTH.slice(0, 7));
check('lump-sum actual matches an independent sum',
  near(t.find(x => x.key === 'lumpsum')!.actual, rawLump), `${rawLump}`);
check('attainment history covers the same months', targetHistory(DEMO_SB).value.length === rows.length);
const pace = monthPace(MONTH);
check('the current month is treated as partial, not failed',
  pace.elapsed < pace.days && pace.fraction < 1, `day ${pace.elapsed} of ${pace.days}`);

// 8 — wins and losses are named rows, and mean what the founder said they mean.
const w = wins(DEMO_SB).value;
const lo = losses(DEMO_SB).value;
check('every win is a real client with a first folio under this broker',
  w.every(x => num('SELECT COUNT(*) n FROM folio_master f JOIN sub_broker_master sb ON sb.sb_sub_broker_code=f.fm_sub_broker_code WHERE f.fk_acc_id=? AND sb.sb_id=?', x.client_id, DEMO_SB) > 0),
  `${w.length} won`);
check('every loss holds nothing today',
  lo.every(x => num('SELECT COUNT(*) n FROM fifo_summary_holding_active WHERE client_id=? AND balance_units > 0.0001', x.client_id) === 0),
  `${lo.length} lost`);
check('losses are transfers or full redemptions — never merely dormant',
  lo.every(x => x.reason.includes('transferred') || x.reason.includes('redeemed')),
  lo.map(x => x.reason.slice(0, 12)).join(', ') || 'none');
// Dormant is not lost — that distinction is the founder's, and it matters:
// a dormant client is still saveable and already sits on Today as an action.
const dormant = (raw.prepare(`SELECT DISTINCT a.client_id id FROM mv_portfolio_attention a
  WHERE a.flag_type='stale' AND a.client_id IN
    (SELECT client_id FROM fifo_summary_holding_active WHERE advisor_code='1228' AND balance_units > 0.0001)`)
  .all() as { id: number }[]).map(x => x.id);
check('dormant clients who still hold money are NOT counted as lost',
  dormant.every(id => !lo.some(x => x.client_id === id)),
  `${dormant.length} dormant-but-holding clients, none in the lost column`);
check('every loss names a date and a reason',
  lo.every(x => !!x.on && !!x.reason && x.on <= TODAY));
const ledgerExits = num(`SELECT COUNT(DISTINCT e.subject_id) n FROM events e
  JOIN folio_master f ON f.fk_acc_id = CAST(e.subject_id AS INTEGER)
  JOIN sub_broker_master sb ON sb.sb_sub_broker_code = f.fm_sub_broker_code
  WHERE e.event_type='client_exited' AND sb.sb_id=?`, DEMO_SB);
check('the exits on the ledger and the losses on the page agree',
  lo.length === ledgerExits, `page ${lo.length} vs ledger ${ledgerExits}`);

console.log(`\nBook ${Math.round(b.aum / 100000)}L across ${b.clients} clients · grew ${Math.round((g.closing - g.opening) / 100000)}L (${g.flowsPct}% flows, ${g.marketPct}% market)`);
console.log(`SIP ${s.live} live / ${Math.round(s.monthly / 1000)}k a month · bounce ${s.bounceRate}% · won ${w.length} / lost ${lo.length}`);
console.log(failures === 0 ? '\nMY BUSINESS: ALL CHECKS PASSED' : `\nMY BUSINESS: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
