import Link from 'next/link';
import { PageGuide } from '../../components/PageGuide';
import { PageHead } from '../../components/PageHead';
import { Explain } from '../../components/Explain';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB } from '../../lib/queries';
import { REPORT_FORMAT, REPORTS, NOT_CARRIED, catalogue, queue } from '../../lib/reports';
import { QUESTIONS, SEMANTIC_SKETCH, ask } from '../../lib/ask';
import { requestReport } from './actions';
import { ChartBars } from '../../components/charts';

export const dynamic = 'force-dynamic';

const GROUP_ICON: Record<string, string> = {
  'Client-facing': 'users', Tax: 'file', 'Book & activity': 'calendar', Commission: 'money',
};

export default async function ReportsPage({ searchParams }: PageProps<'/reports'>) {
  const sp = await searchParams;
  const asked = typeof sp.q === 'string' ? ask(sp.q) : null;
  const me = broker();
  const groups = catalogue(DEMO_SB);
  const q = queue(DEMO_SB);
  const live = q.filter(r => !r.expired);

  // Both plots are folded out of the catalogue and the download log already on the
  // page. An empty report keeps its bar rather than being filtered out: a reader
  // who cannot see the zero assumes the report is missing.
  const sizes = groups.flatMap(g => g.reports)
    .map(r => ({ report: r.name, rows: r.count, tone: r.count > 0 ? 's1' : 'grey' }))
    .sort((a, b) => a.rows - b.rows);
  const emptyNames = sizes.filter(r => r.rows === 0).map(r => r.report);

  const daysLeft = (r: { expires_at: string | null }) => r.expires_at
    ? Math.round((Date.parse(r.expires_at) - Date.parse(TODAY)) / 86400000) : null;
  const EXPIRY_BANDS: [string, string, (d: number | null) => boolean][] = [
    ['Expired', 'grey', d => d !== null && d < 0],
    ['Under 2 days', 'amber', d => d !== null && d >= 0 && d < 2],
    ['2–4 days', 'blue', d => d !== null && d >= 2 && d < 5],
    ['5+ days', 'blue', d => d !== null && d >= 5],
    ['No expiry set', 'grey', d => d === null],
  ];
  const expiry = EXPIRY_BANDS
    .map(([band, tone, test]) => ({ band, tone, n: q.filter(r => test(daysLeft(r))).length }))
    .filter(b => b.n > 0);

  return (
    <>
      <PageHead
        title="Reports" icon="file"
        question="What do I need to send, and where do I get it?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <PageGuide lines={`${REPORTS.length} reports, every one an export of something already on screen`}>
        <p>
          The link beside each report says where on the product that number lives, so a figure in
          a download can always be traced back to the screen it came from. Downloads stay
          available for {REPORT_FORMAT.expiry_days} days, then expire.
        </p>
      </PageGuide>

      <div className="cols">
        <div>
          <h2 className="sec"><Icon name="bulb" /> Ask the book</h2>
          <div className="askbox">
            <input type="text" disabled
              placeholder="Ask anything about your book — “which clients bought gold last quarter?”" />
            <span className="soon">free text — next</span>
          </div>
          <div className="d" style={{ marginBottom: 10 }}>
            These questions are written and verified. Click one and it runs against your real book —
            the numbers are the same ones every other page uses. Typing your own is what the semantic
            layer below unlocks; it is deliberately not wired up yet.
          </div>
          <div className="chips">
            {QUESTIONS.map(q => (
              <Link key={q.id} href={`/reports?q=${q.id}`}
                className={`chip${asked?.q.id === q.id ? ' on' : ''}`}>
                {q.question}
              </Link>
            ))}
          </div>

          {asked && (
            <div className="answer">
              <div className="ahead">
                <div>
                  <b>{asked.q.question}</b>
                  <span className="d">reads {asked.q.reads} · {asked.answer.rows.length} rows</span>
                </div>
                <form action={requestReport}>
                  <input type="hidden" name="report_id" value="portfolio_valuation" />
                  <input type="hidden" name="format" value="xlsx" />
                  <input type="hidden" name="scope" value={asked.q.question} />
                  <button type="submit"><Icon name="money" /> Export</button>
                </form>
              </div>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>{asked.answer.columns.map(c => (
                      <th key={c.key} className={c.align === 'r' ? 'r' : undefined}
                        style={c.align ? undefined : { textAlign: 'left' }}>{c.label}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    <Collapse shown={6} noun="rows" as="rows" span={asked.answer.columns.length}
                      items={asked.answer.rows.map((row, i) => (
                        <tr key={i}>
                          {asked.answer.columns.map(c => (
                            <td key={c.key} className={c.align === 'r' ? 'r num' : undefined}>
                              {c.key === 'name' || c.key === 'fund' || c.key === 'amc'
                                ? <b>{row[c.key]}</b>
                                : typeof row[c.key] === 'number'
                                  ? (row[c.key] as number).toLocaleString('en-IN')
                                  : row[c.key]}
                            </td>
                          ))}
                        </tr>
                      ))} />
                  </tbody>
                </table>
              </div>
              {asked.answer.truncated && (
                <div className="d">Showing the first {asked.answer.rows.length}. The full answer exports in one click.</div>
              )}
            </div>
          )}

          <div className="charts">
            <ChartBars
              horizontal height={300}
              title="How big each report actually is"
              xLabel="rows in the export" yLabel="report"
              source="the same queries the screens run — each report counts its own rows"
              data={sizes} xKey="report"
              series={[{ key: 'rows', name: 'Rows', tone: 's1' }]}
              toneKey="tone"
              keyItems={[{ name: 'has rows', tone: 's1' }, { name: 'empty right now', tone: 'grey' }]}
              mark={<>A report at zero is not broken — {emptyNames.length ? <>{emptyNames.join(' and ')} {emptyNames.length === 1 ? 'has' : 'have'} nothing to carry today, which is a fact about the book rather than about the export.</> : <>every report has rows today.</>} The counts are live, so a report&apos;s size here is what you will actually download.</>}
            />
            <ChartBars
              height={300}
              title="What you have downloaded, and what is about to expire"
              xLabel="days left before it expires" yLabel="downloads"
              source={`download_history_logs.expires_at · ${REPORT_FORMAT.expiry_days}-day retention`}
              data={expiry} xKey="band"
              series={[{ key: 'n', name: 'Downloads', tone: 'blue' }]}
              toneKey="tone"
              keyItems={[{ name: 'still available', tone: 'blue' }, { name: 'going soon', tone: 'amber' }, { name: 'expired', tone: 'grey' }]}
              mark={<><b>{live.length}</b> of {q.length} downloads are still fetchable. Expiry is not a cleanup job — a valuation dated three months ago is a wrong answer, not an old one.</>}
            />
          </div>

          {groups.map(g => (
            <div key={g.group}>
              <h2 className="sec"><Icon name={GROUP_ICON[g.group]} /> {g.group}</h2>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Report</th>
                      <th style={{ textAlign: 'left' }}>Answers</th>
                      <th className="r">Rows</th>
                      <th style={{ textAlign: 'left' }}>On screen at</th>
                      <th>Get it</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.reports.map(r => (
                      <tr key={r.id}>
                        <td>
                          <b>{r.name}</b>
                          <span className="rgrain">{r.grain}</span>
                          {r.note && <span className="rgrain note">{r.note}</span>}
                        </td>
                        <td className="qwhy">{r.question}</td>
                        <td className="r num">{r.count.toLocaleString('en-IN')}</td>
                        <td>
                          {r.inContext
                            ? <Link href={r.inContext.split(' ')[0].replace('[id]', '101')} className="lnk">{r.inContext}</Link>
                            : <span className="d">catalogue only</span>}
                        </td>
                        <td className="rget">
                          {r.formats.map(f => (
                            <form key={f} action={requestReport}>
                              <input type="hidden" name="report_id" value={r.id} />
                              <input type="hidden" name="format" value={f} />
                              <input type="hidden" name="scope" value="my book" />
                              <button type="submit" title={f === 'pdf' ? 'Formatted to send to a client' : 'Raw rows to work on'}>
                                <Icon name={f === 'pdf' ? 'file' : 'money'} /> {f.toUpperCase()}
                              </button>
                            </form>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}

          <h2 className="sec"><Icon name="clock" /> Your downloads</h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Report</th><th>Format</th><th className="r">Rows</th>
                  <th>Requested</th><th>Status</th><th>Available until</th>
                </tr>
              </thead>
              <tbody>
                <Collapse shown={6} noun="downloads" as="rows" span={6} items={q.map(r => (
                  <tr key={r.id} className={r.expired ? 'greyed' : undefined}>
                    <td><b>{r.name}</b> <span className="d">{r.report_for}</span></td>
                    <td style={{ textAlign: 'center' }}>
                      <span className="tchip grey">{r.format.toUpperCase()}</span>
                    </td>
                    <td className="r num">{r.row_count?.toLocaleString('en-IN') ?? '—'}</td>
                    <td style={{ textAlign: 'center' }}>{dmy2(r.requested_at)}</td>
                    <td style={{ textAlign: 'center' }}>
                      <span className={`tchip ${r.status === 'COMPLETED' ? 'green' : 'amber'}`}>
                        {r.status.toLowerCase()}
                      </span>
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {r.expired
                        ? <span className="due now">expired</span>
                        : r.expires_at ? dmy2(r.expires_at) : <span className="d">—</span>}
                    </td>
                  </tr>
                ))} />
                {q.length === 0 && <tr><td colSpan={6} className="empty">Nothing requested yet.</td></tr>}
              </tbody>
            </table>
          </div>
          <Explain>
            Heavy reports run asynchronously — the same queue production already uses for its PDFs.
            A download expires after {REPORT_FORMAT.expiry_days} days rather than sitting on a server
            forever with a client&apos;s holdings in it.
          </Explain>

          <h2 className="sec"><Icon name="shield" /> Not carried forward</h2>
          {NOT_CARRIED.map(x => (
            <div key={x.name} className="bnote">
              <Icon name="alert" />
              <div><b>{x.name}</b> — {x.why}</div>
            </div>
          ))}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Every report looks the same <Explain id="report_format" /></h3>
            <Explain>
              One component formats all {REPORTS.length}, so consistency is not something anyone has
              to remember.
            </Explain>
            {Object.entries(REPORT_FORMAT).filter(([k]) => k !== 'disclaimer' && k !== 'expiry_days').map(([k, v]) => (
              <div key={k} className="fmtrow">
                <b>{k.replace(/_/g, ' ')}</b>
                <span>{v}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Two formats, two jobs</h3>
            <Explain>
              <b>PDF</b> is co-branded and formatted to send to a client.
              <br />
              <b>Excel</b> is the raw rows for you to slice.
              <br /><br />
              The current portal offers &ldquo;PDF&rdquo;, &ldquo;V2 PDF&rdquo; and Excel
              inconsistently across screens, and nobody can say what V2 changes. Two formats with a
              clear job each replaces that.
            </Explain>
          </div>

          <div className="panel">
            <h3>Downloads expire</h3>
            <Explain>
              After <b>{REPORT_FORMAT.expiry_days} days</b> a generated file stops working. It holds a
              client&apos;s holdings and PAN — it should not outlive the reason it was made.
            </Explain>
          </div>

          <div className="panel ghostpanel">
            <h3><Icon name="bulb" /> The layer behind free text</h3>
            <Explain>
              Not built yet, and shown so the shape is visible. A question has to land on named
              things and known measures — a model picks from these; it never writes SQL and never
              computes a number.
            </Explain>
            <div className="semrow"><b>Things</b><span>{SEMANTIC_SKETCH.entities.map(e => e.name).join(' · ')}</span></div>
            <div className="semrow"><b>Measures</b><span>{SEMANTIC_SKETCH.metrics.map(m => m.name).join(' · ')}</span></div>
            <div className="semrules">
              {SEMANTIC_SKETCH.guardrails.slice(0, 3).map((g, i) => (
                <div key={i}><Icon name="shield" /> {g}</div>
              ))}
            </div>
          </div>

          <div className="panel learn">
            <h3>What is different here</h3>
            <div className="d ghosttxt">
              In the current portal a report is somewhere you navigate to, and a number on a dashboard
              cannot be clicked into the report that explains it. Here the report is the export of
              what you are already looking at — this page exists to find one you have not reached yet,
              not as the only way in. {live.length} of your downloads are still live.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
