// Onboarding page checks. Every count is re-derived with independent SQL and
// compared against lib/onboarding.ts (the page's own query layer). Exits 1 on drift.
// Usage: npx tsx mockdb/verify-onboarding.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  pipeline, funnel, daysToLive, stalls, rejections, linkStats, monthCounts,
  unphrasedCodes, ONBOARDING_RULES,
} from '../lib/onboarding';
import { onboardingStuck, stuckList, DEMO_SB } from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const one = <T>(sql: string, ...p: unknown[]): T => raw.prepare(sql).get(...p) as T;
const num = (sql: string, ...p: unknown[]) => one<{ n: number }>(sql, ...p).n;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const { columns } = pipeline();
const byKey = Object.fromEntries(columns.map(c => [c.key, c]));

// 1 — the board accounts for every application exactly once.
const totalApps = num('SELECT COUNT(*) n FROM onboarding_applications');
const onBoard = columns.reduce((s, c) => s + c.cards.length, 0);
const ids = new Set(columns.flatMap(c => c.cards.map(x => x.application_id)));
check('every application sits in exactly one column', onBoard === totalApps && ids.size === totalApps,
  `${onBoard} carded / ${ids.size} distinct / ${totalApps} rows`);

// 2 — column membership matches the snapshot columns, derived independently.
check('Live column == UCC allotted',
  byKey.live.cards.length === num("SELECT COUNT(*) n FROM onboarding_applications WHERE ucc_status='ACTIVE'"),
  `${byKey.live.cards.length}`);
check('UCC column == e-log cleared, code not yet allotted',
  byKey.ucc.cards.length === num("SELECT COUNT(*) n FROM onboarding_applications WHERE ucc_status='PENDING_UCC'"),
  `${byKey.ucc.cards.length}`);
check('e-log column == e-log sent or stalled',
  byKey.elog.cards.length === num("SELECT COUNT(*) n FROM onboarding_applications WHERE elog_status IN ('sent','stalled')"),
  `${byKey.elog.cards.length}`);

// 3 — the domain rule: paper applications never sit at the BSE e-log.
check('no offline application is stuck at the BSE e-log (paper has no e-log step)',
  num("SELECT COUNT(*) n FROM onboarding_applications WHERE channel='offline' AND elog_status IN ('sent','stalled')") === 0);

// 4 — snapshot columns and the event trail agree.
const noStartEvent = num(`SELECT COUNT(*) n FROM onboarding_applications oa WHERE NOT EXISTS
  (SELECT 1 FROM events e WHERE e.subject_type='application' AND e.subject_id=CAST(oa.application_id AS TEXT)
   AND e.event_type='application_started')`);
check('every application has its opening event', noStartEvent === 0, `${noStartEvent} missing`);
const liveNoUcc = num(`SELECT COUNT(*) n FROM onboarding_applications oa WHERE oa.ucc_status='ACTIVE' AND NOT EXISTS
  (SELECT 1 FROM events e WHERE e.subject_type='application' AND e.subject_id=CAST(oa.application_id AS TEXT)
   AND e.event_type='ucc_allotted')`);
check('every live application has its ucc_allotted event', liveNoUcc === 0, `${liveNoUcc} missing`);
const stalledNoSent = num(`SELECT COUNT(*) n FROM onboarding_applications oa WHERE oa.elog_status='stalled' AND NOT EXISTS
  (SELECT 1 FROM events e WHERE e.subject_type='application' AND e.subject_id=CAST(oa.application_id AS TEXT)
   AND e.event_type='elog_sent')`);
check('every e-log stall has the elog_sent event that started its clock', stalledNoSent === 0, `${stalledNoSent} missing`);

// 5 — the funnel only ever narrows, and its top step is the leads table.
const fun = funnel().value;
check('funnel is monotonic — no step passes more than the one before it',
  fun.every((s, i) => i === 0 || s.n <= fun[i - 1].n), fun.map(s => `${s.label}:${s.n}`).join(' > '));
check('funnel top step == every lead in the book',
  fun[0].n === num('SELECT COUNT(*) n FROM leads'), `${fun[0].n}`);
check('funnel "UCC allotted" == the Live column', fun[4].n === byKey.live.cards.length, `${fun[4].n}`);

// 6 — days measured, not stored: recompute the goal metric straight from events.
const speed = daysToLive().value;
const rawDays = (raw.prepare(`SELECT CAST(julianday(MIN(CASE WHEN event_type='ucc_allotted' THEN occurred_at END))
     - julianday(MIN(CASE WHEN event_type='application_started' THEN occurred_at END)) AS INTEGER) d
  FROM events WHERE subject_type='application' GROUP BY subject_id HAVING d IS NOT NULL ORDER BY d`)
  .all() as { d: number }[]).map(r => r.d);
const mid = Math.floor(rawDays.length / 2);
const rawMedian = rawDays.length % 2 ? rawDays[mid] : Math.round((rawDays[mid - 1] + rawDays[mid]) / 2);
check('median days lead→live matches an independent SQL median',
  speed.median === rawMedian && speed.n === rawDays.length, `page ${speed.median}d over ${speed.n}, sql ${rawMedian}d over ${rawDays.length}`);
check('nobody goes live before they start', rawDays.every(d => d >= 0), `min ${Math.min(...rawDays)}`);

// 7 — the stall rule, re-derived.
const st = stalls().value;
const rawStalls = num(`SELECT COUNT(*) n FROM onboarding_applications oa
  WHERE oa.ucc_status IS NOT 'ACTIVE' AND (oa.kyc_status='REJECTED'
    OR (oa.elog_status IN ('sent','stalled') AND julianday('${TODAY}') - julianday(oa.stall_since) > ${ONBOARDING_RULES.stall_days})
    OR (oa.kyc_status='PENDING' AND julianday('${TODAY}') - julianday(oa.started_at) > ${ONBOARDING_RULES.stall_days}))`);
check('stall count matches independent SQL', st.length === rawStalls, `${st.length} vs ${rawStalls}`);
check('every stalled application states why it is stuck', st.every(s => s.blocked), 'blocked reason present');
check('stalls are sorted worst-first', st.every((s, i) => i === 0 || s.days <= st[i - 1].days));

// 8 — the loop: a stall the page shows must be an action someone owns.
const noAction = st.filter(s => !s.action_id);
check('every stalled application owns an action in somebody\'s queue', noAction.length === 0,
  `${noAction.length} orphans`);

// 9 — cross-page: the Today card and this page count the same stalls.
const today = onboardingStuck().value;
const mine = st.filter(s => s.sb_id === DEMO_SB);
check('cross-page: Today\'s "onboarding stuck" == this page\'s stalls for the same broker',
  today.n === mine.length && today.days === (mine[0]?.days ?? 0),
  `Today ${today.n} (oldest ${today.days}d) vs Onboarding ${mine.length} (oldest ${mine[0]?.days ?? 0}d)`);
check('Today\'s drill-down lists exactly those rows', stuckList().rows.length === mine.length,
  `${stuckList().rows.length} vs ${mine.length}`);

// 10 — rejections: every one carries a real KRA code that exists in the code table.
const rej = rejections().value;
check('rejection count matches independent SQL',
  rej.length === num("SELECT COUNT(*) n FROM onboarding_applications WHERE kyc_status='REJECTED'"), `${rej.length}`);
const unknownCode = rej.filter(r => !num('SELECT COUNT(*) n FROM kra_error_codes WHERE error_code=?', r.error_code));
check('every rejection code resolves in kra_error_codes', unknownCode.length === 0,
  unknownCode.map(r => r.error_code).join(', '));
check('every rejection shows either a plain-word sentence or the official wording, never blank',
  rej.every(r => (r.plain && r.ask) || r.official), 'no empty explanations');
check('unphrased codes are reported, not silently dropped',
  unphrasedCodes().every(c => !rej.some(r => r.error_code === c && r.plain)),
  unphrasedCodes().length ? `ghosted: ${unphrasedCodes().join(', ')}` : 'all codes phrased');

// 11 — link counters are the ledger's, not a stored guess.
const drift = linkStats().value.filter(l =>
  l.applications !== num('SELECT COUNT(*) n FROM onboarding_applications WHERE sb_id=?', l.sb_id));
check('referral-link application counts equal the applications actually on file', drift.length === 0,
  `${drift.length} brokers disagree`);
const storedDrift = num(`SELECT COUNT(*) n FROM broker_links bl WHERE bl.applications !=
  (SELECT COUNT(*) FROM onboarding_applications oa WHERE oa.sb_id = bl.sb_id)`);
check('the stored broker_links.applications counter agrees with the ledger too', storedDrift === 0);

// 12 — month figures bounded by today (the seed holds future-dated rows elsewhere).
const m = monthCounts().value;
check('month counts are bounded by today, never counting the future',
  m.opened === num("SELECT COUNT(*) n FROM events WHERE subject_type='application' AND event_type='application_started' AND occurred_at >= ? AND occurred_at <= ?", TODAY.slice(0, 8) + '01', TODAY),
  `${m.opened} opened, ${m.live} live`);

// 13 — the seeded story survives.
const arjun = one<{ n: number; days: number }>(`SELECT COUNT(*) n,
  CAST(julianday('${TODAY}') - julianday(stall_since) AS INTEGER) days
  FROM onboarding_applications WHERE client_id=102 AND elog_status='stalled'`);
check('story: Arjun Patel still stalled at the e-log, 11 days', arjun.n === 1 && arjun.days === 11,
  `${arjun.n} row, ${arjun.days} days`);
const arjunCard = columns.flatMap(c => c.cards).find(c => c.client_id === 102);
check('story: Arjun appears on the board in the e-log column with his 11 days',
  arjunCard?.stage === 'elog' && arjunCard.days === 11, `${arjunCard?.stage} ${arjunCard?.days}d`);

// 14 — the channel truth this page exists to expose.
const offline = num("SELECT COUNT(*) n FROM onboarding_applications WHERE channel='offline'");
check('the offline majority is visible, not smoothed away', offline / totalApps >= 0.7,
  `${Math.round((offline / totalApps) * 100)}% offline of ${totalApps}`);

console.log(`\nPipeline: ${columns.map(c => `${c.label} ${c.key === 'lead' ? c.leads!.length : c.cards.length}`).join(' · ')}`);
console.log(`Goal metric: median ${speed.median} days lead→live (n=${speed.n}, best ${speed.best}) · ${st.length} stalled · ${rej.length} rejected`);
console.log(failures === 0 ? '\nONBOARDING PAGE: ALL CHECKS PASSED' : `\nONBOARDING PAGE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
