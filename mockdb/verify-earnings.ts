// My earnings checks. Money is re-derived with independent SQL and must reconcile
// to the rupee at every level: line → client → month → invoice → financial year.
// Exits 1 on any drift. Usage: npx tsx mockdb/verify-earnings.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  EARNINGS_RULES, THIS_MONTH, months, ladder, tierStep, series, byClient, clientLines,
  byScheme, clawbacks, variance, invoices, fyTracker, emptyBuckets, shortPaidRowIds,
} from '../lib/earnings';
import { DEMO_SB } from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const one = <T>(sql: string, ...p: unknown[]): T => raw.prepare(sql).get(...p) as T;
const num = (sql: string, ...p: unknown[]) => one<{ n: number }>(sql, ...p).n;
const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const M = THIS_MONTH;
const l = ladder(DEMO_SB, M).value;

// 1 — no commission row exists without the folio that earned it. The whole page
// rests on this: aggregate rows would make the drill-down a lie.
check('every commission row names a folio, a scheme and a month',
  num('SELECT COUNT(*) n FROM brokerage_master WHERE fk_folio_id IS NULL OR fk_scheme_id IS NULL OR bkr_from_date IS NULL') === 0);
check('every folio referenced actually exists',
  num('SELECT COUNT(*) n FROM brokerage_master b LEFT JOIN folio_master f ON f.folio_id=b.fk_folio_id WHERE f.folio_id IS NULL') === 0);
check('the folio on a commission row belongs to the broker being paid',
  num(`SELECT COUNT(*) n FROM brokerage_master b
       JOIN folio_master f ON f.folio_id=b.fk_folio_id
       JOIN client_master c ON c.cm_user_id=f.fk_acc_id
       JOIN sub_broker_master s ON s.sb_id=b.fk_sb_id
       WHERE f.fm_sub_broker_code != s.sb_sub_broker_code`) === 0);

// 2 — no NULL money anywhere. A NULL that SUM() skips is a silently wrong total.
check('no NULL in any money column',
  num(`SELECT COUNT(*) n FROM brokerage_master WHERE bkr_amount IS NULL OR bkr_payout_amount IS NULL
       OR tr_amount IS NULL OR payout_gst_amount IS NULL OR payout_tds IS NULL`) === 0);

// 3 — the ladder is arithmetic, re-done independently.
const rawLad = one<{ trail: number; claw: number; gross: number; gst: number; tds: number }>(
  `SELECT COALESCE(SUM(CASE WHEN fk_bkr_type_id=1 THEN bkr_payout_amount END),0) trail,
          COALESCE(SUM(CASE WHEN fk_bkr_type_id=4 THEN bkr_payout_amount END),0) claw,
          COALESCE(SUM(bkr_payout_amount),0) gross, COALESCE(SUM(payout_gst_amount),0) gst,
          COALESCE(SUM(payout_tds),0) tds
   FROM brokerage_master WHERE fk_sb_id=? AND bkr_from_date=?`, DEMO_SB, M);
check('ladder rungs match independent SQL',
  near(l.trail, rawLad.trail) && near(l.clawback, rawLad.claw) && near(l.gst, rawLad.gst) && near(l.tds, rawLad.tds),
  `trail ${l.trail} gst ${l.gst} tds ${l.tds}`);
check('net == gross + GST − TDS, to the paisa',
  near(l.net, rawLad.gross + rawLad.gst - rawLad.tds), `${l.net}`);
check('trail + clawback == gross', near(l.trail + l.clawback, rawLad.gross));

// 4 — GST and TDS follow the stated rates, per row, not on average.
check(`GST is ${EARNINGS_RULES.gst_pct}% of payout on every GST-registered row`,
  num(`SELECT COUNT(*) n FROM brokerage_master
       WHERE has_gst=1 AND ABS(payout_gst_amount - ROUND(bkr_payout_amount * 0.18, 2)) > 0.02`) === 0);
check('no GST is charged on rows for brokers who are not registered',
  num('SELECT COUNT(*) n FROM brokerage_master WHERE has_gst=0 AND payout_gst_amount != 0') === 0);
check(`TDS is ${EARNINGS_RULES.tds_pct}% of payout on every trail row`,
  num(`SELECT COUNT(*) n FROM brokerage_master WHERE fk_bkr_type_id=1
       AND ABS(payout_tds - ROUND(bkr_payout_amount * 0.05, 2)) > 0.02`) === 0);

// 5 — payout is the tier rate applied to what the AMC paid, on every single row.
check('payout == AMC receipt × the tier rate on that row',
  num(`SELECT COUNT(*) n FROM brokerage_master
       WHERE ABS(bkr_payout_amount - ROUND(bkr_amount * bkr_payout_rate_precentage / 100.0, 2)) > 0.02`) === 0);
check('the tier rate on the rows is the broker\'s registered tier',
  num(`SELECT COUNT(*) n FROM brokerage_master b
       JOIN sub_broker_master s ON s.sb_id = b.fk_sb_id
       JOIN broker_category_payout_pct_master p ON p.fk_sb_category_id = s.fk_cat_id
       WHERE b.fk_bkr_type_id = 1 AND b.bkr_payout_rate_precentage != p.trail_1st_yr_pct`) === 0);

// 6 — the drill-downs sum back to the headline. No row hidden by a LIMIT.
const cl = byClient(DEMO_SB, M).value;
check('client breakdown sums to the month\'s trail',
  near(cl.reduce((s, c) => s + c.payout, 0), l.trail, 0.05),
  `${cl.length} clients, Σ ${cl.reduce((s, c) => s + c.payout, 0).toFixed(2)} vs ${l.trail}`);
check('client breakdown line count sums to the month\'s line count',
  cl.reduce((s, c) => s + c.lines, 0) === l.lines, `${cl.reduce((s, c) => s + c.lines, 0)} vs ${l.lines}`);
check('scheme breakdown sums to the same trail',
  near(byScheme(DEMO_SB, M).value.reduce((s, x) => s + x.payout, 0), l.trail, 0.05));
const topLines = clientLines(DEMO_SB, M, cl[0].client_id);
check('a client\'s own lines sum to that client\'s row',
  near(topLines.filter(x => x.type === 'Trail').reduce((s, x) => s + x.payout, 0), cl[0].payout, 0.02),
  `${cl[0].name}: ${topLines.length} lines`);

// 7 — the invoice covers exactly the rows it claims, and nothing is unbilled.
check('every invoice sub-total equals the rows attached to it',
  num(`SELECT COUNT(*) n FROM invoice_master i
       WHERE ABS(i.sub_total - (SELECT COALESCE(SUM(b.bkr_payout_amount),0)
                                FROM brokerage_master b WHERE b.fk_invoice_id=i.invoice_id)) > 0.05`) === 0);
check('no commission row is left off an invoice',
  num('SELECT COUNT(*) n FROM brokerage_master WHERE fk_invoice_id IS NULL') === 0);
check('invoice total == sub-total + CGST + SGST − TDS',
  num('SELECT COUNT(*) n FROM invoice_master WHERE ABS(total_amount - (sub_total + cgst + sgst - tds)) > 0.05') === 0);
const inv = invoices(DEMO_SB).value.find(i => i.period_start_date === M)!;
check('this month\'s invoice total == the ladder\'s net', near(inv.total_amount, l.net, 0.05),
  `${inv.total_amount} vs ${l.net}`);
check('the open month is not marked paid', inv.payment_date === null);
check('no invoice is dated in the future',
  num(`SELECT COUNT(*) n FROM invoice_master WHERE payment_date IS NOT NULL AND payment_date > '${TODAY}'`) === 0);

// 8 — the financial-year tracker is the sum of its own months.
const fy = fyTracker(DEMO_SB).value;
const fySum = num(`SELECT COALESCE(SUM(sub_total),0) n FROM invoice_master
  WHERE fk_sb_id=? AND period_start_date >= '2026-04-01'`, DEMO_SB);
check('FY cumulative == the sum of that year\'s invoices', near(fy.cumulative_payout, fySum, 0.05),
  `${fy.cumulative_payout} vs ${fySum}`);
check('the threshold flag matches the amount',
  (fy.cumulative_payout > EARNINGS_RULES.fy_threshold) === (fy.threshold_crossed === 1));

// 9 — the series has no month gaps, which a trail book cannot have.
const ms = series(DEMO_SB).value.map(p => p.month);
const gaps = ms.filter((m, i) => {
  if (i === 0) return false;
  const prev = new Date(ms[i - 1] + 'T00:00:00Z');
  prev.setUTCMonth(prev.getUTCMonth() + 1);
  return prev.toISOString().slice(0, 10) !== m;
});
check('the earnings series has no missing months', gaps.length === 0,
  gaps.length ? `gap before ${gaps.join(', ')}` : `${ms.length} consecutive months`);
check('the page offers exactly the months that have commission',
  months(DEMO_SB).length === ms.length);

// 10 — every clawback names the redemption that caused it, inside the window.
const cb = clawbacks(DEMO_SB).value;
check('clawbacks all carry a real source transaction',
  num(`SELECT COUNT(*) n FROM brokerage_master b WHERE b.fk_bkr_type_id=4
       AND (b.clawback_source_txn IS NULL
            OR NOT EXISTS (SELECT 1 FROM transaction_master t WHERE t.tr_id=b.clawback_source_txn))`) === 0);
check('every clawback is negative money', cb.every(c => c.amount < 0), `${cb.length} rows`);
check(`every clawback's exit is inside the ${EARNINGS_RULES.clawback_window_days}-day window`,
  cb.every(c => c.held_days < EARNINGS_RULES.clawback_window_days),
  cb.length ? `max held ${Math.max(...cb.map(c => c.held_days))} days` : 'none');

// 11 — the variance check is real: paid under the card, priced at the broker's rate.
const v = variance(DEMO_SB).value;
check('flagged rows are exactly those paid under the agreed card',
  num('SELECT COUNT(*) n FROM brokerage_master WHERE fk_sb_id=? AND reco_status=2', DEMO_SB) === shortPaidRowIds(DEMO_SB).length,
  `${shortPaidRowIds(DEMO_SB).length} rows`);
check('every flagged row was genuinely paid less than the card says',
  num(`SELECT COUNT(*) n FROM brokerage_master WHERE reco_status=2 AND bkr_percentage >= calc_rate`) === 0);
check('no unflagged row is silently short-paid',
  num(`SELECT COUNT(*) n FROM brokerage_master WHERE reco_status=1 AND bkr_percentage < calc_rate - 0.0001`) === 0);
check('the shortfall shown is what it cost the broker, not the firm',
  v.every(x => near(x.shortfall,
    num(`SELECT COALESCE(SUM(reco_difference * bkr_payout_rate_precentage / 100.0),0) n
         FROM brokerage_master b JOIN scheme_master s ON s.scheme_id=b.fk_scheme_id
         JOIN amc_master a ON a.amc_id=s.fk_amc_id
         WHERE b.fk_sb_id=? AND b.reco_status=2 AND a.amc_name=?`, DEMO_SB, x.amc), 0.05)),
  v.map(x => `${x.amc}: ${x.shortfall}`).join(' | ') || 'none');

// 12 — the tier step is the broker's uplift, and never states the firm's margin.
const t = tierStep(DEMO_SB, M).value;
check('the next tier is genuinely the next rung up',
  t.next === null || t.next.pct > t.current.pct, `${t.current.name} ${t.current.pct}% → ${t.next?.pct ?? '—'}%`);
check('the uplift is positive and smaller than the current payout',
  t.next === null || (t.upliftPerMonth > 0 && t.upliftPerMonth < l.trail), `+${t.upliftPerMonth}`);

// 13 — the empty buckets are honestly empty, not quietly filled.
check('Upfront and Incentive carry no invented rows',
  emptyBuckets(DEMO_SB).includes('Upfront') && emptyBuckets(DEMO_SB).includes('Incentive'),
  emptyBuckets(DEMO_SB).join(', ') || 'none empty');

// 14 — cross-page: the book this page bills on is the book My clients shows.
const pageAum = l.aum;
const bookAum = num("SELECT COALESCE(SUM(present_market_value),0) n FROM fifo_summary_holding_active WHERE advisor_code=?", '1228');
check('the AUM commission was charged on is within a month\'s drift of the live book',
  Math.abs(pageAum - bookAum) / bookAum < 0.25,
  `billed ${Math.round(pageAum / 100000)}L vs book ${Math.round(bookAum / 100000)}L`);

console.log(`\n${M.slice(0, 7)}: trail ${l.trail} + GST ${l.gst} − TDS ${l.tds} = net ${l.net} over ${l.lines} lines / ${cl.length} clients`);
console.log(`Tier ${t.current.name} ${t.current.pct}% → ${t.next?.name ?? '—'} (+${t.upliftPerMonth}/mo) · ${cb.length} clawbacks · ${v.length} AMC variance`);
console.log(failures === 0 ? '\nMY EARNINGS: ALL CHECKS PASSED' : `\nMY EARNINGS: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
