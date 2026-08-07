// Marketing checks. Two invariants carry this page: no send without compliance
// approval, and no send without consent for that channel on that day. Both are
// asserted against the ledger, not against the UI. Exits 1 on any drift.
// Usage: npx tsx mockdb/verify-marketing.ts

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TODAY } from './engines';
import {
  MARKETING_RULES, shelf, awaitingApproval, sendSet, unreachable, delivery,
  responses, roi, consentRegister, sentThisMonth,
} from '../lib/marketing';
import { DEMO_SB } from '../lib/queries';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));
const raw = new Database(join(process.cwd(), 'mockdb', 'jhaveri.db'), { readonly: true });
const num = (sql: string, ...p: unknown[]) => (raw.prepare(sql).get(...p) as { n: number }).n;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

// 1 — THE compliance gate. Nothing goes out on an unapproved template.
check('no send exists on a template compliance has not approved',
  num(`SELECT COUNT(*) n FROM campaign_sends s
       JOIN campaigns c ON c.campaign_id = s.campaign_id
       JOIN campaign_templates t ON t.template_id = c.template_id
       WHERE t.approval_artefact_ref IS NULL`) === 0);
check('an unapproved template genuinely exists, so the gate is doing work',
  awaitingApproval().length > 0, `${awaitingApproval().length} awaiting approval`);
check('every approved template names who approved it and when',
  num(`SELECT COUNT(*) n FROM campaign_templates
       WHERE approval_artefact_ref IS NOT NULL AND (approved_by IS NULL OR approved_at IS NULL)`) === 0);
check('the shelf marks exactly the approved campaigns as runnable',
  shelf().value.every(c => (c.runnable === 1) === (c.approval_artefact_ref !== null)));

// 2 — THE consent gate, on the timeline and on the right channel.
check('every send had consent for THAT channel, in force on the day it went out',
  num(`SELECT COUNT(*) n FROM campaign_sends s
       WHERE NOT EXISTS (SELECT 1 FROM consents c
         WHERE c.client_id = s.client_id AND c.channel = s.channel AND c.purpose = 'marketing'
           AND (c.state = 'granted' OR (c.state = 'withdrawn' AND s.sent_at < c.ts)))`) === 0);
check('no send is dated after the client withdrew consent on that channel',
  num(`SELECT COUNT(*) n FROM campaign_sends s
       JOIN consents c ON c.client_id = s.client_id AND c.channel = s.channel
         AND c.purpose = 'marketing' AND c.state = 'withdrawn'
       WHERE s.sent_at >= c.ts`) === 0);
check('withdrawals actually exist, so the timeline rule is doing work',
  num("SELECT COUNT(*) n FROM consents WHERE purpose='marketing' AND state='withdrawn'") > 0,
  `${num("SELECT COUNT(*) n FROM consents WHERE purpose='marketing' AND state='withdrawn'")} withdrawals`);
check('transactional consent never authorises a marketing send',
  num(`SELECT COUNT(*) n FROM campaign_sends s WHERE NOT EXISTS
       (SELECT 1 FROM consents c WHERE c.client_id=s.client_id AND c.channel=s.channel
        AND c.purpose='marketing')`) === 0);
check('consent is recorded per channel, not once per client',
  num("SELECT COUNT(DISTINCT channel) n FROM consents WHERE purpose='marketing'") === MARKETING_RULES.channels.length,
  `${num("SELECT COUNT(DISTINCT channel) n FROM consents WHERE purpose='marketing'")} channels`);

// 3 — the send-set arithmetic on screen is the arithmetic a send would use.
for (const ch of MARKETING_RULES.channels) {
  const s = sendSet(DEMO_SB, ch).value;
  check(`send set adds up on ${ch}`,
    s.noConsent + s.withdrawn + s.reachable === s.inSegment,
    `${s.noConsent} + ${s.withdrawn} + ${s.reachable} = ${s.inSegment}`);
  const listed = unreachable(DEMO_SB, ch).value.length;
  check(`the unreachable list names exactly the clients the subtraction removed on ${ch}`,
    listed === s.noConsent + s.withdrawn, `${listed} named vs ${s.noConsent + s.withdrawn} removed`);
}
const wa = sendSet(DEMO_SB, 'whatsapp').value;
check('reachable is never more than the segment', wa.reachable <= wa.inSegment);
check('the unreachable list contains nobody who is reachable',
  unreachable(DEMO_SB, 'whatsapp').value.every(u =>
    num(`SELECT COUNT(*) n FROM consents WHERE client_id=? AND channel='whatsapp'
         AND purpose='marketing' AND state='granted'`, u.client_id) === 0));

// 4 — responses: only a real lead becomes work.
const resp = responses(DEMO_SB).value;
check('every "interested" reply minted an action',
  resp.filter(r => r.response_type === 'replied_interested').every(r => r.action_id != null),
  `${resp.filter(r => r.response_type === 'replied_interested').length} interested`);
check('a decline or an unsubscribe never manufactures work',
  resp.filter(r => r.response_type === 'declined' || r.response_type === 'unsubscribed')
    .every(r => r.action_id == null));
check('an unsubscribe always withdrew the matching consent',
  num(`SELECT COUNT(*) n FROM campaign_responses r
       JOIN campaign_sends s ON s.send_id = r.send_id
       WHERE r.response_type='unsubscribed' AND NOT EXISTS
         (SELECT 1 FROM consents c WHERE c.client_id=s.client_id AND c.channel=s.channel
          AND c.purpose='marketing' AND c.state='withdrawn')`) === 0);
check('no response predates the send that caused it',
  num(`SELECT COUNT(*) n FROM campaign_responses r JOIN campaign_sends s ON s.send_id=r.send_id
       WHERE r.responded_at < s.sent_at`) === 0);
check('nothing is dated in the future',
  num(`SELECT COUNT(*) n FROM campaign_sends WHERE sent_at > '${TODAY}'`) === 0
  && num(`SELECT COUNT(*) n FROM campaign_responses WHERE responded_at > '${TODAY}'`) === 0);
check('a failed or pending send never produced a response',
  num(`SELECT COUNT(*) n FROM campaign_responses r JOIN campaign_sends s ON s.send_id=r.send_id
       WHERE s.delivery_state != 'delivered'`) === 0);

// 5 — ROI is conservative by construction.
const money = roi(DEMO_SB).value;
check('attributed money only ever comes from a closed, linked action',
  num(`SELECT COUNT(*) n FROM actions WHERE linked_txn_ids IS NOT NULL AND state != 'done'`) === 0);
check('every linked transaction id resolves to a real transaction',
  num(`SELECT COUNT(*) n FROM actions a JOIN json_each(a.linked_txn_ids) j
       LEFT JOIN transaction_master t ON t.tr_id = j.value
       WHERE a.linked_txn_ids IS NOT NULL AND t.tr_id IS NULL`) === 0);
check('every linked transaction is a purchase, not a redemption',
  num(`SELECT COUNT(*) n FROM actions a JOIN json_each(a.linked_txn_ids) j
       JOIN transaction_master t ON t.tr_id = j.value
       JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
       WHERE tt.tr_type_buy_sell_flag != 1`) === 0);
check('every linked transaction post-dates the response that claimed it',
  num(`SELECT COUNT(*) n FROM campaign_responses r
       JOIN actions a ON a.action_id = r.minted_action_id
       JOIN json_each(a.linked_txn_ids) j
       JOIN transaction_master t ON t.tr_id = j.value
       WHERE t.tr_date < r.responded_at`) === 0);
check('the funnel narrows at every step, per campaign',
  money.every(m => m.delivered <= m.sends && m.responses <= m.delivered
    && m.interested <= m.responses && m.closed <= m.interested && m.invested <= m.closed),
  money.map(m => `${m.sends}>${m.delivered}>${m.responses}>${m.interested}>${m.closed}>${m.invested}`).join(' | '));
check('attributed rupees are zero wherever nothing was linked',
  money.every(m => m.invested > 0 || m.attributed === 0));

// 6 — page totals match independent SQL.
const del = delivery(DEMO_SB).value;
check('delivery counts match the ledger',
  del.reduce((s, d) => s + d.sent, 0) === num('SELECT COUNT(*) n FROM campaign_sends WHERE sb_id=?', DEMO_SB)
  && del.every(d => d.delivered + d.failed + d.pending === d.sent),
  del.map(d => `${d.channel}:${d.sent}`).join(' '));
check('this month\'s send count is bounded by today',
  sentThisMonth(DEMO_SB) === num(`SELECT COUNT(*) n FROM campaign_sends
    WHERE sb_id=? AND sent_at >= ? AND sent_at <= ?`, DEMO_SB, TODAY.slice(0, 8) + '01', TODAY),
  `${sentThisMonth(DEMO_SB)} in Aug`);
check('the consent register only shows this broker\'s clients',
  consentRegister(DEMO_SB).value.every(c =>
    num(`SELECT COUNT(*) n FROM fifo_summary_holding_active WHERE client_id=? AND advisor_code='1228'`, c.client_id) > 0));

console.log(`\nShelf ${shelf().value.length} campaigns (${awaitingApproval().length} awaiting approval) · reachable on whatsapp ${wa.reachable} of ${wa.inSegment}`);
console.log(`${resp.length} responses · ${money.reduce((s, m) => s + m.invested, 0)} invested · ${money.reduce((s, m) => s + m.attributed, 0)} attributed`);
console.log(failures === 0 ? '\nMARKETING: ALL CHECKS PASSED' : `\nMARKETING: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
