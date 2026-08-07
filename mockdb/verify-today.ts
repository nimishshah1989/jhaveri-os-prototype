// Today-page checks: recompute each rendered figure with independent SQL and
// compare against lib/queries.ts (the page's own query layer). Exits 1 on drift.
// Usage: npx tsx mockdb/verify-today.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  broker, myBook, netFlowsMtd, churnRisk, idleNoSip, sipsAtRisk, onboardingStuck,
  bookList, churnList, idleList, sipRiskList, stuckList, streams, scoreboard,
} from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const one = <T>(sql: string, ...args: unknown[]) => raw.prepare(sql).get(...args) as T;

const me = broker();

// Independent recomputation: sum per-client values instead of one aggregate.
const perClient = raw.prepare(
  'SELECT SUM(present_market_value) v FROM fifo_summary_holding_active WHERE advisor_code=? GROUP BY client_id')
  .all(me.code) as { v: number }[];
const bookIndep = perClient.reduce((s, r) => s + r.v, 0);
check('My book == Σ per-client values', Math.abs(myBook(me.code).value.v - bookIndep) < 0.05,
  `${myBook(me.code).value.v} vs ${bookIndep}`);
check('My book card count == click-through client count', bookList(me.code).total === perClient.length);

const flowsIndep = one<{ v: number }>(
  `SELECT COALESCE(SUM(t.tr_amount * tt.tr_type_buy_sell_flag),0) v
   FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id
   WHERE t.fk_sb_id=? AND t.tr_date BETWEEN ? AND ?`, 4, TODAY.slice(0, 8) + '01', TODAY);
check('Net flows MTD matches independent signed sum', Math.abs(netFlowsMtd().value.v - flowsIndep.v) < 0.05,
  `${netFlowsMtd().value.v} vs ${flowsIndep.v}`);

check('Churn card count == churn click-through rows', churnRisk(me.code).value.n === churnList(me.code).rows.length);
check('Idle card count == idle list total', idleNoSip(me.code).value.n === idleList(me.code).total);
check('SIP-risk card count == its list rows', sipsAtRisk(me.code).value.n === sipRiskList(me.code).rows.length);
check('Stuck card count == its list rows', onboardingStuck().value.n === stuckList().rows.length);

const q = streams();
check('Red stream: Meera (SIP bounce) and Arjun (KYC) present, Meera first',
  q.red.length >= 2 && q.red[0].client_name === 'Meera Shah' && q.red.some(a => a.client_name === 'Arjun Patel'),
  q.red.map(a => a.client_name).join(', '));
check('Amber stream ranked by impact desc',
  q.amber.every((a, i) => i === 0 || q.amber[i - 1].impact_score >= a.impact_score));
check('Grey stream carries 3 birthdays + 1 auto-closed',
  q.grey.filter(a => a.action_type === 'birthday_week').length === 3 &&
  q.grey.filter(a => a.outcome_type === 'auto_resolved').length === 1);
const openIndep = one<{ n: number }>(
  "SELECT COUNT(*) n FROM actions WHERE assignee_sb_id=4 AND state IN ('proposed','assigned','in_progress')");
check('Streams cover every open action exactly once',
  q.red.length + q.amber.length + q.grey.filter(a => a.outcome_type !== 'auto_resolved').length === openIndep.n,
  `${q.red.length}+${q.amber.length}+grey-open vs ${openIndep.n}`);

const sb = scoreboard().value;
const sbIndep = one<{ closed: number }>(
  "SELECT COUNT(*) closed FROM actions WHERE assignee_sb_id=4 AND state IN ('done','dismissed')");
check('Scoreboard closed count matches', sb.closed === sbIndep.closed, `${sb.closed} vs ${sbIndep.closed}`);

console.log(failures === 0 ? '\nTODAY PAGE: ALL CHECKS PASSED' : `\nTODAY PAGE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
