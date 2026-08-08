import Link from 'next/link';
import { PageGuide } from '../../components/PageGuide';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { Explain } from '../../components/Explain';
import { StatCard } from '../../components/StatCard';
import { inr, inrCompact, dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB } from '../../lib/queries';
import { REVIEW_RULES, due, pack, history, queue, coverage } from '../../lib/reviewpack';
import { generatePack, recordResponse } from './actions';

export const dynamic = 'force-dynamic';

const RESPONSE_TONE: Record<string, string> = {
  meeting_booked: 'lt', replied: 'lt', opened: 'conc',
};

export default async function ReviewPacksPage({ searchParams }: PageProps<'/review-packs'>) {
  const sp = await searchParams;
  const me = broker();
  const dueList = due(DEMO_SB);
  const cov = coverage(DEMO_SB);
  const past = history(DEMO_SB);
  const running = queue(DEMO_SB);

  const picked = typeof sp.c === 'string' ? Number(sp.c) : dueList.value[0]?.client_id;
  const preview = picked ? pack(picked) : null;

  return (
    <>
      <PageHead title="Reviews" icon="file"
        question="Which clients are overdue a conversation, and what do I take to it?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <PageGuide lines={`${cov.value.reviewed} of ${cov.value.book} clients reviewed`}>
        <p>
          The pack is built from the same numbers as Client 360 — nothing is retyped, so what the
          client reads and what you see cannot disagree.
        </p>
      </PageGuide>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard id="review_due" icon="file"
              label="Need a review" value={`${dueList.value.length}`} tone="warn"
              sub={`of ${cov.value.book} clients in your book`}
              figure={dueList}
              list={{ rows: dueList.value.slice(0, 10).map(d => ({ label: d.name, detail: d.why, amount: d.value })), total: dueList.value.length }}
            />
            <StatCard id="review_due" icon="alert"
              label="Never reviewed" value={`${cov.value.never}`} tone={cov.value.never > 10 ? 'warn' : 'plain'}
              sub="no pack has ever been sent"
              figure={dueList}
              list={{ rows: dueList.value.filter(d => d.last_pack === null).slice(0, 10).map(d => ({ label: d.name, detail: 'never reviewed', amount: d.value })), total: cov.value.never }}
            />
            <StatCard id="review_due" icon="clock"
              label="Overdue" value={`${cov.value.overdue}`}
              sub={`past the ${REVIEW_RULES.review_months}-month mark or flagged`}
              figure={dueList}
              list={{ rows: dueList.value.filter(d => d.last_pack !== null).map(d => ({ label: d.name, detail: d.why, amount: d.value })), total: cov.value.overdue }}
            />
            <StatCard id="review_due" icon="check"
              label="Packs sent" value={`${past.value.length}`} sub="all time"
              figure={past}
              list={{ rows: past.value.slice(0, 10).map(p => ({ label: p.name, detail: `${p.sent_via} · ${dmy2(p.generated_at)}`, amount: 0 })), total: past.value.length }}
            />
            <StatCard id="review_due" icon="mail"
              label="Came back" value={`${cov.value.responded}`} tone="pos"
              sub={past.value.length ? `${Math.round((cov.value.responded / past.value.length) * 100)}% of packs got a reply` : 'none sent yet'}
              figure={past}
              list={{ rows: past.value.filter(p => p.client_response).map(p => ({ label: p.name, detail: p.client_response!.replace('_', ' '), amount: 0 })), total: cov.value.responded }}
            />
            <StatCard id="review_due" icon="money"
              label="Money unreviewed" value={inrCompact(dueList.value.reduce((s, d) => s + d.value, 0))}
              tone="warn" sub="held by clients who need a review"
              figure={dueList}
              list={{ rows: dueList.value.slice(0, 10).map(d => ({ label: d.name, detail: d.why, amount: d.value })), total: dueList.value.length }}
            />
          </div>

          {running.length > 0 && (
            <div className="bulk">
              <b>{running.length}</b> pack{running.length === 1 ? '' : 's'} still rendering —
              production queues these through <code>download_history_logs</code>, the same table
              the existing portfolio PDFs use.
            </div>
          )}

          <h2 className="sec">Who needs one, and why <Explain figure={dueList} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th><th className="r">Worth</th>
                  <th>Last pack</th><th style={{ textAlign: 'left' }}>Why now</th>
                  <th className="r">Health</th><th />
                </tr>
              </thead>
              <tbody>
                {dueList.value.slice(0, 25).map(d => (
                  <tr key={d.client_id} className={d.client_id === picked ? 'openrow' : undefined}>
                    <td><ClientLink id={d.client_id} name={d.name} /></td>
                    <td className="r num valbar" style={{ '--w': (d.value / (dueList.value[0]?.value || 1)) * 100 } as React.CSSProperties}>
                      {inrCompact(d.value)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {d.last_pack ? dmy2(d.last_pack) : <span className="fchip atrisk">never</span>}
                    </td>
                    <td>{d.why}</td>
                    <td className="r num">
                      {d.health}{d.gain > 0 && <span className="gainchip">+{d.gain}</span>}
                    </td>
                    <td className="rowacts always">
                      <Link href={`/review-packs?c=${d.client_id}`}>Preview pack</Link>
                    </td>
                  </tr>
                ))}
                {dueList.value.length === 0 && (
                  <tr><td colSpan={6} className="empty">Every client is inside their review window.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {dueList.value.length > 25 && (
            <Explain>Showing the top 25 of {dueList.value.length}, ranked by money at stake × how overdue.</Explain>
          )}

          {preview && (
            <>
              <h2 className="sec">The pack for {preview.name}</h2>
              <div className="packdoc">
                <div className="pkhead">
                  <div>
                    <div className="pkbrand">Jhaveri Securities <span>· prepared by {me.name}</span></div>
                    <div className="pktitle">Portfolio review — {preview.name}</div>
                  </div>
                  <div className="pkdate">as at {dmy(preview.as_of)}</div>
                </div>

                <div className="pkkpi">
                  <div><span>Value</span><b>{inr(preview.value)}</b></div>
                  <div><span>Invested</span><b>{inr(preview.invested)}</b></div>
                  <div><span>Your return</span><b className={preview.xirr != null && preview.benchmark != null && preview.xirr >= preview.benchmark ? 'up' : 'down'}>
                    {preview.xirr != null ? `${preview.xirr.toFixed(1)}%` : '—'}
                  </b></div>
                  <div><span>Benchmark</span><b>{preview.benchmark != null ? `${preview.benchmark.toFixed(1)}%` : '—'}</b></div>
                </div>

                {preview.sections.map(s => (
                  <div key={s.key} className="pksec">
                    <h4>{s.title} <code>{s.source}</code></h4>
                    {s.lines.map((l, i) => <p key={i}>{l}</p>)}
                  </div>
                ))}

                {preview.proposals.length > 0 && (
                  <div className="pksec proposals">
                    <h4>What we suggest <code>lib/scoring.ts — the same levers as Client 360</code></h4>
                    {preview.proposals.map((p, i) => (
                      <p key={i}><b>{p.label}</b> — {p.why}</p>
                    ))}
                  </div>
                )}

                {preview.lastConversation && (
                  <div className="pksec">
                    <h4>Since we last spoke <code>interactions</code></h4>
                    <p>
                      {preview.lastConversation.kind} on {dmy2(preview.lastConversation.on)} —{' '}
                      {preview.lastConversation.note}
                    </p>
                  </div>
                )}

                <div className="pkdisc">{REVIEW_RULES.disclaimer}</div>
              </div>

              <form action={generatePack} className="disputeform">
                <input type="hidden" name="client_id" value={preview.client_id} />
                <select name="via" defaultValue="whatsapp">
                  <option value="whatsapp">Send on WhatsApp</option>
                  <option value="email">Send by email</option>
                  <option value="in_person">Take to the meeting</option>
                </select>
                <button type="submit" className="primary">Generate and send</button>
                <span className="d">
                  Writes the pack, queues the render, and logs it against {preview.name} — the same
                  three rows production writes.
                </span>
              </form>
            </>
          )}

          <h2 className="sec">Packs you have sent <Explain figure={past} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th><th>Sent</th><th>Via</th>
                  <th style={{ textAlign: 'left' }}>File</th><th>Render</th><th>What came back</th>
                </tr>
              </thead>
              <tbody>
                <Collapse shown={5} noun="packs" as="rows" span={6} items={past.value.map(p => (
                  <tr key={p.pack_id}>
                    <td><ClientLink id={p.client_id} name={p.name} /></td>
                    <td style={{ textAlign: 'center' }}>{dmy2(p.generated_at)}</td>
                    <td style={{ textAlign: 'center' }}>{p.sent_via.replace('_', ' ')}</td>
                    <td><code>{p.content_ref}</code></td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`fchip ${p.status === 'COMPLETED' ? 'lt' : 'conc'}`}>{p.status.toLowerCase()}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {p.client_response
                        ? <span className={`fchip ${RESPONSE_TONE[p.client_response] ?? 'stale'}`}>{p.client_response.replace('_', ' ')}</span>
                        : (
                          <form action={recordResponse} style={{ display: 'inline-flex', gap: 4 }}>
                            <input type="hidden" name="pack_id" value={p.pack_id} />
                            <select name="response" defaultValue="opened">
                              <option value="opened">opened</option>
                              <option value="replied">replied</option>
                              <option value="meeting_booked">meeting booked</option>
                            </select>
                            <button type="submit">log</button>
                          </form>
                        )}
                    </td>
                  </tr>
                ))} />
                {past.value.length === 0 && <tr><td colSpan={6} className="empty">No packs sent yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <Explain>
            Logging &ldquo;meeting booked&rdquo; mints an action on <Link href="/today">Today</Link>,
            because a booked meeting is work, not a note.
          </Explain>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>When a review is due</h3>
            <Explain>
              <b>{REVIEW_RULES.review_months} months</b> since the last pack, <b>or</b> an attention
              flag appearing sooner — whichever comes first. The annual obligation is the floor; a
              portfolio that goes wrong in month three should not wait nine more.
            </Explain>
          </div>

          <div className="panel">
            <h3>Whose document is this?</h3>
            <Explain>
              Co-branded: Jhaveri&apos;s compliance footing, your name as the client&apos;s adviser.
              The firm owns the record, you own the relationship.
              <br /><br />
              Because the pack carries <b>suggestions</b>, it is advice in writing — so the
              disclaimer rides on every copy and the pack is registered in{' '}
              <code>review_packs</code> with its version and what the client did next.
            </Explain>
          </div>

          <div className="panel learn">
            <h3>What this page cannot see</h3>
            <div className="d ghosttxt">
              Whether the client read it. &ldquo;Opened&rdquo; here is what you logged, not a
              tracking pixel — this platform does not put one in a client document. Until a portal
              exists where the client opens the pack themselves, the response column is a human
              record, and it says so.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
