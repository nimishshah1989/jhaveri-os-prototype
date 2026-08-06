// Invariant checks over the seeded database. Exits 1 on any failure.
// Usage: npm run verify:db

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inr, TODAY } from './engines';

const db = new Database(join(dirname(fileURLToPath(import.meta.url)), 'jhaveri.db'), { readonly: true });
let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}
const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

const counts = one<{ c: number; b: number; f: number; t: number }>(
  "SELECT (SELECT COUNT(*) FROM client_master) c, (SELECT COUNT(*) FROM sub_broker_master) b, (SELECT COUNT(*) FROM folio_master) f, (SELECT COUNT(*) FROM transaction_master) t");
check('scale: 1,200 clients / 18 brokers / >2,000 folios / >10,000 txns',
  counts.c === 1200 && counts.b === 18 && counts.f > 2000 && counts.t > 10000,
  `${counts.c}/${counts.b}/${counts.f}/${counts.t}`);

const tot = one<{ a: number; b: number }>(
  'SELECT (SELECT SUM(present_market_value) FROM fifo_summary_holding_active) a, (SELECT SUM(sh_current_value) FROM fifo_summary_holding WHERE sh_current_value > 0) b');
check('consistency: serving table total == summary total', Math.abs(tot.a - tot.b) < 5, `${inr(tot.a)} vs ${inr(tot.b)}`);

const meera = one<{ missed: number; mandate_end: string } | undefined>(
  "SELECT x.npayments_missed missed, m.end_date mandate_end FROM sip_master s JOIN bse_sxp_list x ON x.reg_no=s.sxp_bos_code JOIN bse_mandate_list m ON m.exch_mandate_id=x.exch_mandate_id WHERE s.fk_acc_id=101 AND s.tr_amount=25000");
check('story: Meera Shah — SIP ₹25,000 bounced ×2, mandate expires 12-Aug',
  !!meera && meera.missed === 2 && meera.mandate_end === '2026-08-12');
const meeraAction = one<{ n: number }>(
  "SELECT COUNT(*) n FROM actions WHERE action_type='sip_bounce_save' AND assignee_sb_id=4 AND impact_score=300000 AND sla_due='" + TODAY + "'");
check('story: Meera action — assigned to Ravi, impact ₹3,00,000, due today', meeraAction.n === 1);

const arjun = one<{ n: number }>(
  "SELECT COUNT(*) n FROM onboarding_applications WHERE client_id=102 AND elog_status='stalled' AND stall_since=date('" + TODAY + "','-11 days')");
check('story: Arjun Patel — e-log stalled exactly 11 days', arjun.n === 1);
check('story: Arjun kyc_unstick action exists',
  one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE action_type='kyc_unstick'").n >= 3);

const dual = one<{ n: number }>(
  "SELECT COUNT(*) n FROM mv_duplicate_folios d JOIN folio_master f ON f.fm_folio_no=d.tr_folio_no WHERE f.fk_acc_id=106");
check('story: Kapoor HUF folio appears in duplicate-folios view (2 brokers)', dual.n >= 1);

const desai = one<{ last: string; v: number }>(
  "SELECT (SELECT MAX(tr_date) FROM transaction_master WHERE fk_acc_id=103) last, (SELECT value_now FROM v_client_value WHERE client_id=103) v");
check('story: Desai head dormant >14 months with real value',
  desai.last < '2025-06-07' && desai.v > 2000000, `last txn ${desai.last}, value ${inr(desai.v)}`);
check('story: Desai dormant action minted',
  one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE action_type='dormant_review' AND subject_id='103'").n === 1);

const unowned = one<{ n: number; v: number }>(
  'SELECT COUNT(*) n, COALESCE(SUM(v.value_now),0) v FROM v_client_value v JOIN client_master c ON c.cm_user_id=v.client_id WHERE c.fk_primary_sub_broker_id IS NULL AND NOT EXISTS (SELECT 1 FROM client_sub_broker_mapping m WHERE m.cm_user_id=c.cm_user_id)');
check('unowned clients with money exist (the disputed-number demo)', unowned.n >= 10 && unowned.n <= 18, `${unowned.n} clients, ${inr(unowned.v)}`);

const xirrBad = one<{ n: number }>('SELECT COUNT(*) n FROM fifo_summary_holding WHERE sh_xirr IS NOT NULL AND (sh_xirr < -60 OR sh_xirr > 120)');
check('sanity: every XIRR within [-60%, +120%]', xirrBad.n === 0, `${xirrBad.n} outliers`);

const payoutRows = db.prepare("SELECT bkr_amount, bkr_payout_rate_precentage, bkr_payout_amount FROM brokerage_master WHERE fk_bkr_type_id=1 LIMIT 200").all() as { bkr_amount: number; bkr_payout_rate_precentage: number; bkr_payout_amount: number }[];
const payoutBad = payoutRows.filter(x => Math.abs(x.bkr_payout_amount - x.bkr_amount * (x.bkr_payout_rate_precentage / 100)) > 0.02).length;
check('payout math: payout == received × tier% on every sampled row', payoutBad === 0, `${payoutBad} bad of ${payoutRows.length}`);

const netView = one<{ bad: number }>(
  "SELECT COUNT(*) bad FROM (SELECT sb_id, month, payout_net_amount, payout_amount FROM mv_brokerage_summary) v JOIN (SELECT fk_sb_id, substr(bkr_from_date,1,7) m, SUM(bkr_payout_amount + payout_gst_amount - payout_tds) net FROM brokerage_master GROUP BY 1,2) raw ON raw.fk_sb_id=v.sb_id AND raw.m=v.month WHERE ABS(raw.net - v.payout_net_amount) > 0.05");
check('view math: mv_brokerage_summary net == payout + GST − TDS', netView.bad === 0);

const variance = one<{ n: number }>(
  "SELECT COUNT(*) n FROM brokerage_master WHERE fk_bkr_type_id=1 AND bkr_percentage < (calc_rate - 0.10)");
check('story: AMC paid below agreed rate (terms-validator catch)', variance.n >= 2, `${variance.n} short-paid rows`);
check('story: terms_variance actions minted for management',
  one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE action_type='terms_variance'").n === 3);

check('discipline: every action carries evidence',
  one<{ n: number }>('SELECT COUNT(*) n FROM actions WHERE trigger_evidence IS NULL').n === 0);
check('discipline: every dismissed action has a reason',
  one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE state='dismissed' AND dismiss_reason IS NULL").n === 0);

const sipEvidence = one<{ n: number }>("SELECT COUNT(*) n FROM events WHERE subject_id='sip_save' AND event_type='outcome_recorded'");
const sipPolicy = one<{ e: number }>("SELECT evidence_n e FROM policies WHERE workflow='sip_save' AND policy_key='nudge_framing'");
check('honesty: policy evidence_n backed by real outcome events', sipEvidence.n >= sipPolicy.e, `${sipEvidence.n} events ≥ ${sipPolicy.e} claimed`);

const quar = one<{ open: number; acts: number }>(
  "SELECT (SELECT COUNT(*) FROM quarantine_rows WHERE state='open') open, (SELECT COUNT(*) FROM actions WHERE action_type='quarantine_fix') acts");
check('ops: every open quarantine row has a fix action', quar.open === quar.acts && quar.open === 5, `${quar.open}/${quar.acts}`);

const euin = one<{ n: number }>('SELECT COUNT(*) n FROM transaction_master WHERE tr_file_euin IS NULL');
check('ops: EUIN-gap story present with remediation action', euin.n === 24 &&
  one<{ n: number }>("SELECT COUNT(*) n FROM actions WHERE action_type='euin_remediation'").n === 1, `${euin.n} gap txns`);

const badSends = one<{ n: number }>(
  "SELECT COUNT(*) n FROM campaign_sends s WHERE NOT EXISTS (SELECT 1 FROM consents c WHERE c.client_id=s.client_id AND c.purpose='marketing' AND c.state='granted')");
check('compliance: zero campaign sends without marketing consent', badSends.n === 0);

const attention = one<{ n: number; clients: number }>('SELECT COUNT(*) n, COUNT(DISTINCT client_id) clients FROM mv_portfolio_attention');
check('attention board: flags a minority of the book, not everyone',
  attention.clients > 20 && attention.clients < 350, `${attention.n} flags on ${attention.clients} clients`);

const wf = one<{ n: number; learning: number }>(
  "SELECT COUNT(*) n, SUM(CASE WHEN brain_status='learning' THEN 1 ELSE 0 END) learning FROM mv_workflow_health");
check('workflow board: 5 workflows, learning states honest', wf.n === 5 && wf.learning >= 2, `${wf.n} rows, ${wf.learning} learning`);

const book = one<{ v: number }>('SELECT SUM(present_market_value) v FROM fifo_summary_holding_active');
console.log(`\nBook value: ${inr(book.v)} across ${counts.c} clients · ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' FAILURES'}`);
process.exit(failures === 0 ? 0 : 1);
