import Link from 'next/link';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { Explain } from '../../components/Explain';
import { StatCard } from '../../components/StatCard';
import { inr, inrCompact, dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB } from '../../lib/queries';
import {
  MARKETING_RULES, shelf, awaitingApproval, sendSet, unreachable, delivery,
  responses, roi, consentRegister, sentThisMonth,
} from '../../lib/marketing';
import { launchCampaign, requestConsent } from './actions';

export const dynamic = 'force-dynamic';

const RESPONSE_TONE: Record<string, string> = {
  replied_interested: 'lt', clicked: 'conc', declined: 'stale', unsubscribed: 'atrisk',
};

export default async function MarketingPage({ searchParams }: PageProps<'/marketing'>) {
  const sp = await searchParams;
  const channel = typeof sp.ch === 'string' && (MARKETING_RULES.channels as readonly string[]).includes(sp.ch)
    ? sp.ch : 'whatsapp';

  const me = broker();
  const rack = shelf();
  const pending = awaitingApproval();
  const set = sendSet(DEMO_SB, channel);
  const cant = unreachable(DEMO_SB, channel);
  const del = delivery(DEMO_SB);
  const resp = responses(DEMO_SB);
  const money = roi(DEMO_SB);
  const consents = consentRegister(DEMO_SB);
  const sentAug = sentThisMonth(DEMO_SB);

  const attributed = money.value.reduce((s, m) => s + m.attributed, 0);
  const openResponders = resp.value.filter(r => r.action_id && r.action_state !== 'done' && r.action_state !== 'dismissed');
  const runnable = rack.value.filter(c => c.runnable && c.state === 'live');
  const totalSent = del.value.reduce((s, d) => s + d.sent, 0);
  const withdrawnCount = consents.value.filter(c => c.state === 'withdrawn').length;

  return (
    <>
      <PageHead title="Campaigns" icon="mail"
        question="Who may I contact, and what did reaching out actually earn?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <div className="denom">
        Marketing has put <b>{inr(attributed)}</b> into your book that can be proved — money a
        client invested after replying, where you closed the action and named the transaction.
        Anything that arrived without that link stays out of this number on purpose.
        <Explain figure={money} />
      </div>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard id="send_set" icon="mail"
              label="Ready to run" value={`${runnable.length}`}
              sub={pending.length ? `${pending.length} awaiting compliance` : 'all approved'}
              figure={rack}
              list={{ rows: runnable.map(c => ({ label: c.name, detail: c.segment, amount: c.sends })), total: runnable.length }}
              listAmountKind="days"
            />
            <StatCard id="send_set" icon="arrow"
              label="Sent · Aug" value={`${sentAug}`} sub={`${totalSent} across all campaigns`}
              figure={del}
              list={{ rows: del.value.map(d => ({ label: d.channel, detail: `${d.failed} failed · ${d.pending} pending`, amount: d.delivered })), total: del.value.length }}
              listAmountKind="days"
            />
            <StatCard id="attributed_rupees" icon="users"
              label="Responses" value={`${resp.value.length}`}
              sub={`${resp.value.filter(r => r.response_type === 'replied_interested').length} said they are interested`}
              figure={resp}
              list={{ rows: resp.value.slice(0, 10).map(r => ({ label: r.name, detail: r.response_type.replace('_', ' '), amount: r.linked_amount ?? 0 })), total: resp.value.length }}
            />
            <StatCard id="attributed_rupees" icon="clock"
              label="Still to call" value={`${openResponders.length}`} tone={openResponders.length ? 'warn' : 'plain'}
              sub="responders with an open action"
              figure={resp}
              list={{ rows: openResponders.map(r => ({ label: r.name, detail: r.campaign, amount: 0 })), total: openResponders.length }}
            />
            <StatCard id="attributed_rupees" icon="money"
              label="Attributed" value={inr(attributed)} tone="pos"
              sub={`${money.value.reduce((s, m) => s + m.invested, 0)} clients invested after replying`}
              figure={money}
              list={{ rows: money.value.map(m => ({ label: m.campaign, detail: `${m.invested} invested`, amount: m.attributed })), total: money.value.length }}
            />
            <StatCard id="send_set" icon="shield"
              label={`Reachable · ${channel}`} value={`${set.value.reachable} of ${set.value.inSegment}`}
              tone={set.value.reachable < set.value.inSegment / 2 ? 'warn' : 'plain'}
              sub={`${set.value.noConsent} never asked · ${set.value.withdrawn} withdrew`}
              figure={set}
              list={{ rows: set.value.byChannel.map(c => ({ label: c.channel, detail: 'consented', amount: c.n })), total: 3 }}
              listAmountKind="days"
            />
          </div>

          <h2 className="sec">The shelf <Explain figure={rack} /></h2>
          <div className="d" style={{ marginBottom: 10 }}>
            Head office writes these and compliance approves them. You choose who to send to —
            authoring your own creative is phase 2, deliberately.
          </div>
          <div className="hcards">
            {rack.value.map(c => (
              <div key={c.campaign_id} className={`camp${c.runnable ? '' : ' blocked'}`}>
                <div className="cn">{c.name}</div>
                <div className="cm">
                  <span className={`fchip ${c.state === 'live' ? 'lt' : 'stale'}`}>{c.state}</span>
                  {c.segment} · launched {dmy2(c.launched_at)}
                </div>
                <div className="cs num">
                  <b>{c.sends}</b> sent firm-wide · <b>{c.responses}</b> replies
                </div>
                {c.approval_artefact_ref ? (
                  <div className="appr">
                    ✓ approved by {c.approved_by} on {dmy2(c.approved_at!)}
                    <code>{c.approval_artefact_ref}</code>
                  </div>
                ) : (
                  <div className="appr no">✗ no compliance approval on file — cannot be sent</div>
                )}
                {c.runnable && c.state === 'live' && (
                  <form action={launchCampaign} className="campgo">
                    <input type="hidden" name="campaign_id" value={c.campaign_id} />
                    <select name="channel" defaultValue={channel}>
                      {set.value.byChannel.map(ch => (
                        <option key={ch.channel} value={ch.channel}>{ch.channel} · {ch.n} reachable</option>
                      ))}
                    </select>
                    <button type="submit">Send to my segment</button>
                  </form>
                )}
              </div>
            ))}
          </div>
          {pending.length > 0 && (
            <div className="d" style={{ marginTop: 8 }}>
              Waiting on compliance: {pending.map(p => <b key={p.template_id}>{p.name}</b>)}. The
              approval artefact is a column, not a convention — with it empty, the send is refused
              by the server even if the button were somehow clicked.
            </div>
          )}

          <h2 className="sec">Who actually gets it <Explain figure={set} /></h2>
          <div className="chips">
            {set.value.byChannel.map(c => (
              <Link key={c.channel} href={`/marketing?ch=${c.channel}`}
                className={`chip${c.channel === channel ? ' on' : ''}`}>
                {c.channel} <b>{c.n}</b>
              </Link>
            ))}
          </div>
          <div className="subtract">
            <div className="sr"><span>In the segment — your clients over ₹1L</span><span className="num">{set.value.inSegment}</span></div>
            <div className="sr minus"><span>Never asked for {channel} marketing consent</span><span className="num">−{set.value.noConsent}</span></div>
            <div className="sr minus"><span>Asked, then withdrew it</span><span className="num">−{set.value.withdrawn}</span></div>
            <div className="sr total"><span>Will receive this campaign</span><span className="num">{set.value.reachable}</span></div>
          </div>
          <div className="d">
            This subtraction <i>is</i> the send list — the recipients are produced by the consent
            query itself, so there is no separate list that could drift out of step with it. Consent
            is per channel: agreeing on WhatsApp is not agreeing on SMS.
          </div>

          <h2 className="sec">
            Your clients you may not contact on {channel} · {cant.value.length}
            <Explain figure={cant} />
          </h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th><th className="r">Worth</th>
                  <th style={{ textAlign: 'left' }}>Why</th><th>Since</th><th />
                </tr>
              </thead>
              <tbody>
                <Collapse shown={5} noun="clients" as="rows" span={5} items={cant.value.map(u => (
                  <tr key={u.client_id} className="greyed">
                    <td><ClientLink id={u.client_id} name={u.name} /></td>
                    <td className="r num">{inrCompact(u.value)}</td>
                    <td>{u.reason}</td>
                    <td style={{ textAlign: 'center' }}>{u.since ? dmy2(u.since) : '—'}</td>
                    <td className="rowacts always">
                      {u.reason === 'never asked' ? (
                        <form action={requestConsent} style={{ display: 'inline' }}>
                          <input type="hidden" name="client_id" value={u.client_id} />
                          <input type="hidden" name="channel" value={channel} />
                          <button type="submit">Ask at next meeting</button>
                        </form>
                      ) : <span className="d">withdrawn — do not re-ask</span>}
                    </td>
                  </tr>
                ))} />
                {cant.value.length === 0 && <tr><td colSpan={5} className="empty">Everyone in the segment has consented on this channel.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="d">
            Named so you can see the gap, greyed so you cannot act on it. Asking becomes a task on{' '}
            <Link href="/today">Today</Link>; a client who withdrew is not re-asked, which is the
            whole point of recording a withdrawal.
          </div>

          <h2 className="sec">What came back <Explain figure={resp} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th><th style={{ textAlign: 'left' }}>Campaign</th>
                  <th>Channel</th><th>Replied</th><th>When</th><th>Your action</th><th className="r">Invested</th>
                </tr>
              </thead>
              <tbody>
                <Collapse shown={6} noun="responses" as="rows" span={7} items={resp.value.map(r => (
                  <tr key={r.response_id}>
                    <td><ClientLink id={r.client_id} name={r.name} /></td>
                    <td>{r.campaign}</td>
                    <td style={{ textAlign: 'center' }}>{r.channel}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`fchip ${RESPONSE_TONE[r.response_type] ?? 'stale'}`}>
                        {r.response_type.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{dmy2(r.responded_at)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {r.action_id
                        ? <Link href={`/today?action=${r.action_id}`} className="hchip">#{r.action_id} · {r.outcome_type ?? r.action_state}</Link>
                        : <span className="d">no action — not a lead</span>}
                    </td>
                    <td className="r num">{r.linked_amount ? inr(r.linked_amount) : '—'}</td>
                  </tr>
                ))} />
                {resp.value.length === 0 && <tr><td colSpan={7} className="empty">No responses yet.</td></tr>}
              </tbody>
            </table>
          </div>

          <h2 className="sec">What each campaign was worth <Explain figure={money} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Campaign</th>
                  <th className="r">Sent</th><th className="r">Delivered</th><th className="r">Replied</th>
                  <th className="r">Interested</th><th className="r">Closed</th>
                  <th className="r">Invested</th><th className="r">Attributed ₹</th>
                </tr>
              </thead>
              <tbody>
                {money.value.map(m => (
                  <tr key={m.campaign_id}>
                    <td>{m.campaign}</td>
                    <td className="r num">{m.sends}</td>
                    <td className="r num">{m.delivered}</td>
                    <td className="r num">{m.responses}</td>
                    <td className="r num">{m.interested}</td>
                    <td className="r num">{m.closed}</td>
                    <td className="r num">{m.invested}</td>
                    <td className="r num">{m.attributed ? inr(m.attributed) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{money.value.length} campaigns</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.sends, 0)}</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.delivered, 0)}</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.responses, 0)}</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.interested, 0)}</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.closed, 0)}</td>
                  <td className="r num">{money.value.reduce((s, m) => s + m.invested, 0)}</td>
                  <td className="r num">{inr(attributed)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="d">
            Every column narrows on the one before it. <b>Attributed ₹</b> counts only transactions
            a human named when closing the action — money that came in without being linked is not
            claimed here, and that is the difference between a marketing report and a marketing
            number you can defend.
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Consent register <Explain figure={consents} /></h3>
            <div className="d">
              <b>{consents.value.length}</b> consent records across your book —{' '}
              <b>{consents.value.length - withdrawnCount}</b> in force, <b>{withdrawnCount}</b>{' '}
              withdrawn. Each carries how it was captured and when.
            </div>
            {consents.value.slice(0, 6).map(c => (
              <div key={`${c.client_id}-${c.channel}`} className="lrow">
                <span>{c.name.split(' ')[0]} · {c.channel}</span>
                <span className={`fchip ${c.state === 'granted' ? 'lt' : 'atrisk'}`}>{c.state}</span>
                <span className="num">{dmy2(c.ts)}</span>
              </div>
            ))}
            <div className="d ghost" style={{ marginTop: 6 }}>via {consents.value[0]?.captured_via ?? '—'} and others</div>
          </div>

          <div className="panel">
            <h3>The two gates</h3>
            <div className="d">
              <b>Compliance:</b> a template without an approval artefact cannot be sent. The server
              refuses the write; the disabled button is only a courtesy.
              <br /><br />
              <b>DPDP:</b> the recipient list is the consent query. Per channel, per purpose, and
              respecting the date a consent was withdrawn — a send that was lawful in June is not
              re-judged by a July withdrawal, and a July send after it would be refused.
            </div>
          </div>

          <div className="panel learn">
            <h3>What this page cannot see</h3>
            <div className="d ghosttxt">
              Whether the campaign caused the investment. It records that a client replied, that you
              closed the action, and that you named the transaction — a human judgement, logged. No
              model here claims causation from a time window, because it could not defend it.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
