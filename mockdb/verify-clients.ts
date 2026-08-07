// My-clients page checks: recompute each rendered figure with independent SQL
// and compare against lib/queries.ts. Exits 1 on drift.
// Usage: npx tsx mockdb/verify-clients.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  broker, myBook, blendedReturn, sipParticipation, churnRisk, dormantClients,
  idleNoSip, taxWindowClients, assetMix, healthSplit, xirrBands, clientRows,
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
const all = clientRows(me.code, {}).rows;

// Denominator: every figure on the page shares the advisor-code book.
const bookClients = one<{ n: number }>(
  'SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active WHERE advisor_code=?', me.code);
check('row count == distinct book clients', all.length === bookClients.n, `${all.length} vs ${bookClients.n}`);

const tableV = all.reduce((s, r) => s + r.v, 0);
check('table value total == book card', Math.abs(tableV - myBook(me.code).value.v) < 0.05, `${tableV}`);

const mix = assetMix(me.code).value;
const mixTotal = mix.reduce((s, r) => s + r.v, 0);
check('asset-mix bar total == book card (one denominator)', Math.abs(mixTotal - myBook(me.code).value.v) < 0.05,
  `${mixTotal} vs ${myBook(me.code).value.v}`);

const bands = xirrBands(me.code).value;
check('returns-spread bands sum == client count', bands.reduce((s, b) => s + b.n, 0) === all.length);

const h = healthSplit(me.code).value;
check('health split sums to client count', h.healthy + h.dormant + h.concentrated === all.length,
  `${h.healthy}+${h.dormant}+${h.concentrated} vs ${all.length}`);
check('health dormant == dormant card', h.dormant === dormantClients(me.code).value.n);

// Independent blended return: recompute from per-holding rows in JS.
const holdings = raw.prepare('SELECT present_market_value v, xirr FROM fifo_summary_holding_active WHERE advisor_code=? AND xirr IS NOT NULL')
  .all(me.code) as { v: number; xirr: number }[];
const indepBlend = Math.round((holdings.reduce((s, r) => s + r.v * r.xirr, 0) / holdings.reduce((s, r) => s + r.v, 0)) * 10) / 10;
check('blended return matches independent recompute', Math.abs(blendedReturn(me.code).value.x - indepBlend) < 0.11,
  `${blendedReturn(me.code).value.x} vs ${indepBlend}`);

const sp = sipParticipation(me.code).value;
check('SIP participation denominator == book clients', sp.of === bookClients.n);
check('idle + participating == book clients', idleNoSip(me.code).value.n + sp.n === bookClients.n,
  `${idleNoSip(me.code).value.n}+${sp.n} vs ${bookClients.n}`);

// Segment chips: each chip count equals its filtered row count.
check('attention chip == filtered rows', churnRisk(me.code).value.n === clientRows(me.code, { seg: 'attention' }).rows.length);
check('nosip chip == filtered rows', idleNoSip(me.code).value.n === clientRows(me.code, { seg: 'nosip' }).rows.length);
check('dormant chip == filtered rows', dormantClients(me.code).value.n === clientRows(me.code, { seg: 'dormant' }).rows.length);
check('taxwindow chip == filtered rows', taxWindowClients(me.code).value.n === clientRows(me.code, { seg: 'taxwindow' }).rows.length);

check('no future-dated last-activity leaks', all.every(r => !r.last_activity || r.last_activity <= TODAY));
check('duplicate names carry disambiguation', all.filter(r => r.dup > 1).length >= 2,
  `${all.filter(r => r.dup > 1).length} dup-flagged rows`);

console.log(failures === 0 ? '\nMY CLIENTS PAGE: ALL CHECKS PASSED' : `\nMY CLIENTS PAGE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
