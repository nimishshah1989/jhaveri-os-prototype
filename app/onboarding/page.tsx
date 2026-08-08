import Link from 'next/link';
import { PageGuide } from '../../components/PageGuide';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { PipelineBoard } from '../../components/PipelineBoard';
import { Explain } from '../../components/Explain';
import { StatCard } from '../../components/StatCard';
import { dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker } from '../../lib/queries';
import {
  ONBOARDING_RULES, pipeline, funnel, daysToLive, stalls, stallAging,
  rejections, unphrasedCodes, linkStats, monthCounts,
} from '../../lib/onboarding';
import { nudgeApplication, escalateToOps, refileRejection, startApplication } from './actions';

export const dynamic = 'force-dynamic';

export default function OnboardingPage() {
  const me = broker();
  const { columns, sql: boardSql } = pipeline();
  const fun = funnel();
  const speed = daysToLive();
  const stall = stalls();
  const aging = stallAging();
  const rej = rejections();
  const links = linkStats();
  const month = monthCounts();

  const inPipeline = columns.filter(c => c.key !== 'lead' && c.key !== 'live')
    .reduce((s, c) => s + c.cards.length, 0);
  const openLeads = columns[0].leads?.length ?? 0;
  const myLink = links.value.find(l => l.sb_id === me.sb_id);
  const funMax = Math.max(...fun.value.map(s => s.n));
  const agingMax = Math.max(1, ...aging.map(a => a.n));
  const oldest = stall.value[0];

  const list = <T,>(rows: T[], f: (r: T) => { label: string; detail: string; amount: number }) =>
    ({ rows: rows.slice(0, 10).map(f), total: rows.length });

  return (
    <>
      <PageHead title="Pipeline" icon="clock"
        question="Who is stuck getting in, and what is actually holding them up?"
        meta={`${dmy(TODAY)} · every application in the firm`}
      />
      <PageGuide lines={`Median ${speed.value.median ?? '—'} days to a client code, across ${speed.value.n} finished applications · fastest ${speed.value.best ?? '—'}`}>
        <p>
          The clock starts when a name is captured and stops when the exchange allots a client
          code. {ONBOARDING_RULES.benchmark.who} advertises a {ONBOARDING_RULES.benchmark.claim} —
          that is the bar, and the median above is the distance to it.
        </p>
      </PageGuide>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard id="stall_days" icon="users"
              label="In pipeline" value={`${inPipeline}`} sub={`${openLeads} leads not yet filed`}
              figure={{ tag: 'computed', sql: boardSql, sources: ['onboarding_applications.ucc_status', '.elog_status', '.kyc_status'] }}
              list={list(columns.filter(c => c.key !== 'lead' && c.key !== 'live').flatMap(c => c.cards).sort((a, b) => b.days - a.days),
                c => ({ label: c.name, detail: `at ${c.stage}`, amount: c.days }))}
              listAmountKind="days"
            />
            <StatCard id="stall_days" icon="alert"
              label="Stalled" value={`${stall.value.length}`} tone="warn"
              sub={oldest ? `oldest waiting ${oldest.days} days` : 'nothing overdue'}
              figure={stall}
              list={list(stall.value, c => ({ label: c.name, detail: c.blocked ?? '', amount: c.days }))}
              listAmountKind="days"
            />
            <StatCard id="stall_days" icon="cross"
              label="KYC rejected" value={`${rej.value.length}`} tone="warn"
              sub="waiting on a corrected document"
              figure={rej}
              list={list(rej.value, c => ({ label: c.name, detail: c.error_code ?? '', amount: c.days }))}
              listAmountKind="days"
            />
            <StatCard id="days_to_live" icon="file"
              label="Opened · Aug" value={`${month.value.opened}`} sub="new applications this month"
              figure={month}
              list={list(columns.flatMap(c => c.cards).filter(c => c.since >= TODAY.slice(0, 8) + '01'),
                c => ({ label: c.name, detail: dmy2(c.since), amount: c.days }))}
              listAmountKind="days"
            />
            <StatCard id="days_to_live" icon="check"
              label="Went live · Aug" value={`${month.value.live}`} tone="pos" sub="client codes allotted"
              figure={month}
              list={list(columns[4].cards.filter(c => c.since >= TODAY.slice(0, 8) + '01'),
                c => ({ label: c.name, detail: `live ${dmy2(c.since)}`, amount: c.days }))}
              listAmountKind="days"
            />
            <StatCard id="days_to_live" icon="link"
              label="My link" value={myLink ? `${myLink.applications}` : '—'}
              sub={myLink ? `from ${myLink.visits} visits · ${Math.round((myLink.applications / myLink.visits) * 100)}%` : 'no link yet'}
              figure={links}
              list={list(links.value, l => ({ label: l.broker, detail: `${l.visits} visits`, amount: l.applications }))}
              listAmountKind="days"
            />
          </div>

          <div className="vizrow two">
            <div className="viz">
              <h4>Where applications die <Explain figure={fun} /></h4>
              <div className="funnel">
                {fun.value.map((s, i) => (
                  <div key={s.label} className="frow">
                    <span className="lab">{s.label}</span>
                    <span className="fbar"><i style={{ width: `${(s.n / funMax) * 100}%` }} /></span>
                    <span className="n num">{s.n}</span>
                    <span className="gap num">
                      {i < fun.value.length - 1 && s.medianDays !== null ? `↓ ${s.medianDays}d` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <Explain>
                Bars are applications reaching each step; <b>↓ Nd</b> is the median wait to the next one.
                Paper applications clear the e-log step instantly — they have no BSE e-log.
              </Explain>
            </div>

            <div className="viz">
              <h4>How long the stuck ones have been stuck</h4>
              <div className="hist">
                {aging.map(a => (
                  <div key={a.band} className={`col${a.band === '0–7 days' ? '' : ' neg'}`}>
                    <span className="n num">{a.n}</span>
                    <span className="bar" style={{ height: `${(a.n / agingMax) * 100}%` }} />
                    <span className="b">{a.band}</span>
                  </div>
                ))}
              </div>
              <Explain>
                Waiting past <b>{ONBOARDING_RULES.stall_days} days</b> at the e-log or at KYC counts as
                stalled. A rejection blocks from the day it lands, not after seven — which is why the
                first band is not empty. One threshold, and it lives in <code>rules_registry</code>,
                not in this page.
              </Explain>
            </div>
          </div>

          <h2 className="sec">The pipeline</h2>
          <PipelineBoard columns={columns} stallDays={ONBOARDING_RULES.stall_days} />
          <Explain>
            A card&apos;s column is read from its own record, never set by hand. The number on each card is
            days in <i>that</i> stage, measured from the event that put it there.
          </Explain>

          <h2 className="sec">Stalled — worst first <Explain figure={stall} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Applicant</th>
                  <th>Stage</th><th>Channel</th><th>Broker</th>
                  <th className="r">Waiting</th>
                  <th style={{ textAlign: 'left' }}>What is holding it up</th>
                  <th>In the queue</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                <Collapse shown={6} noun="stalled" as="rows" span={8} items={stall.value.map(c => (
                  <tr key={c.application_id}>
                    <td>{c.client_id ? <ClientLink id={c.client_id} name={c.name} /> : c.name}</td>
                    <td style={{ textAlign: 'center' }}>{c.stage}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`fchip ${c.channel === 'digital' ? 'lt' : 'stale'}`}>{c.channel}</span>
                    </td>
                    <td style={{ textAlign: 'center' }}>{c.broker}</td>
                    <td className="r valbar num" style={{ '--w': Math.min(100, (c.days / Math.max(oldest?.days ?? 1, 1)) * 100) } as React.CSSProperties}>
                      {c.days} days
                    </td>
                    <td>{c.blocked}</td>
                    <td style={{ textAlign: 'center' }}>
                      {c.action_id
                        ? <Link href={`/today?action=${c.action_id}`} className="hchip">#{c.action_id} · {c.action_state}</Link>
                        : <span className="hchip">—</span>}
                    </td>
                    <td className="rowacts always">
                      <form action={nudgeApplication} style={{ display: 'inline' }}>
                        <input type="hidden" name="application_id" value={c.application_id} />
                        <input type="hidden" name="via" value="whatsapp" />
                        <button type="submit">Nudge client</button>
                      </form>
                      <details className="colpick" style={{ display: 'inline-block' }}>
                        <summary>Hand to ops</summary>
                        <div className="pop">
                          <form action={escalateToOps}>
                            <input type="hidden" name="application_id" value={c.application_id} />
                            <select name="reason" defaultValue="BSE e-log link not delivered">
                              <option>BSE e-log link not delivered</option>
                              <option>KRA record locked at another intermediary</option>
                              <option>Digio callback never arrived</option>
                              <option>PAN–Aadhaar seeding failure</option>
                            </select>
                            <button type="submit" style={{ marginTop: 8 }}>Escalate</button>
                          </form>
                        </div>
                      </details>
                    </td>
                  </tr>
                ))} />
                {stall.value.length === 0 && (
                  <tr><td colSpan={8} className="empty">Nothing stalled. Every application is inside its promised time.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <h2 className="sec">Rejections, in words a client understands <Explain figure={rej} /></h2>
          {rej.value.length === 0 && <div className="empty">No open rejections.</div>}
          {rej.value.map(c => (
            <div key={c.application_id} className="rec">
              <div className="rtop">
                <b>{c.name}</b>
                <span className="d">{c.broker} · {c.channel} · rejected {c.days} days ago</span>
                <span className="delta" style={{ color: 'var(--neg)' }}>{c.error_code}</span>
              </div>
              <p className="official">KRA says: “{c.official}”</p>
              {c.plain ? (
                <>
                  <p className="plain">{c.plain}</p>
                  <p className="askfor"><b>Ask them for:</b> {c.ask}</p>
                </>
              ) : (
                <p className="plain ghosttxt">
                  No plain-word version written for this code yet — the official wording is shown as-is
                  rather than guessed at.
                </p>
              )}
              <form action={refileRejection} className="choices">
                <input type="hidden" name="application_id" value={c.application_id} />
                <input type="text" name="note" placeholder="What was collected — goes on the record…" required />
                <button type="submit" className="primary">Document collected · refile</button>
              </form>
            </div>
          ))}

          <h2 className="sec">Start a new client</h2>
          <div className="startgrid">
            <form action={startApplication} className="startform">
              <Explain>
                Fills a lead, a KYC record and an application in one go — it appears on the board above
                immediately, in the KYC column, at zero days.
              </Explain>
              <div className="row2f">
                <input type="text" name="name" placeholder="Full name, as on the PAN card" required />
                <input type="text" name="mobile" placeholder="Mobile" required />
              </div>
              <div className="row2f">
                <select name="channel" defaultValue="digital">
                  <option value="digital">Digital — Aadhaar eKYC, e-log to sign</option>
                  <option value="offline">Offline — paper form at the branch</option>
                </select>
                <select name="source" defaultValue="referral">
                  <option value="referral">Referral</option>
                  <option value="link">My link</option>
                  <option value="walk_in">Walk-in</option>
                  <option value="campaign">Campaign</option>
                </select>
              </div>
              <label className="consent">
                <input type="checkbox" name="consent" required />
                They agreed we may hold this number and contact them about investments.
                <span className="d"> Recorded against the lead — DPDP needs a basis, not a tick box after the fact.</span>
              </label>
              <button type="submit">Start application</button>
            </form>

            <div className="viz">
              <h4>My referral link <Explain figure={links} /></h4>
              {myLink ? (
                <>
                  <div className="slug">jhaveri.in/join/{myLink.slug}</div>
                  <div className="linkflow">
                    <span><b className="num">{myLink.visits}</b> visits</span>
                    <span>→</span>
                    <span><b className="num">{myLink.applications}</b> applications</span>
                    <span>→</span>
                    <span><b className="num">{myLink.live}</b> live</span>
                  </div>
                  <Explain>
                    Applications and live counts are counted off the ledger. <b>Visits</b> is the one number
                    on this page this database does not hold — it comes from web analytics, and it is shown
                    as a stored figure rather than dressed up as computed.
                  </Explain>
                </>
              ) : <div className="empty">No link issued yet.</div>}
            </div>
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Every broker&apos;s links <Explain figure={links} /></h3>
            {links.value.slice(0, 8).map(l => (
              <div key={l.sb_id} className="lrow">
                <span>{l.broker}</span>
                <span className="bar2"><i style={{ width: `${(l.applications / Math.max(1, links.value[0].applications)) * 100}%` }} /></span>
                <span className="num">{l.applications}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>The thresholds on this page</h3>
            <Explain>
              Stalled after <b>{ONBOARDING_RULES.stall_days} days</b> waiting, at the e-log or at KYC ·
              a rejection blocks immediately · target lead to live{' '}
              <b>{ONBOARDING_RULES.target_days_to_live} days</b>.
              <br /><br />
              These live in one place (<code>ONBOARDING_RULES</code>) and move to{' '}
              <code>rules_registry</code> in the real build, where changing one is a versioned,
              audited edit — not a deploy. <Link href="/admin">See all rules</Link>.
            </Explain>
          </div>

          <div className="panel">
            <h3>Plain-word coverage</h3>
            <Explain>
              {unphrasedCodes().length === 0
                ? 'Every rejection code in the book has a client-facing sentence written for it.'
                : `${unphrasedCodes().length} rejection code(s) still show only the official wording: ${unphrasedCodes().join(', ')}. Written by a human, never generated — a wrong sentence here sends a client for the wrong document.`}
            </Explain>
          </div>

          <div className="panel learn">
            <h3>What this page cannot see yet</h3>
            <div className="d ghosttxt">
              Time inside the KRA itself — we hold the request and the verdict, not what happened between
              them. Until the RTA exposes it, &ldquo;KYC cleared&rdquo; is measured from our submission,
              which is honest but coarse.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
