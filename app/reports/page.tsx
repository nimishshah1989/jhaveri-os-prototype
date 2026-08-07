import Link from 'next/link';
import { PageHead } from '../../components/PageHead';
import { Explain } from '../../components/Explain';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB } from '../../lib/queries';
import { REPORT_FORMAT, REPORTS, NOT_CARRIED, catalogue, queue } from '../../lib/reports';
import { requestReport } from './actions';

export const dynamic = 'force-dynamic';

const GROUP_ICON: Record<string, string> = {
  'Client-facing': 'users', Tax: 'file', 'Book & activity': 'calendar', Commission: 'money',
};

export default function ReportsPage() {
  const me = broker();
  const groups = catalogue(DEMO_SB);
  const q = queue(DEMO_SB);
  const live = q.filter(r => !r.expired);

  return (
    <>
      <PageHead
        title="Reports" icon="file"
        question="What do I need to send, and where do I get it?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <div className="denom">
        {REPORTS.length} reports, every one an export of something already on screen — the link beside
        each says where. Downloads stay available for {REPORT_FORMAT.expiry_days} days, then expire.
      </div>

      <div className="cols">
        <div>
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
          <div className="d">
            Heavy reports run asynchronously — the same queue production already uses for its PDFs.
            A download expires after {REPORT_FORMAT.expiry_days} days rather than sitting on a server
            forever with a client&apos;s holdings in it.
          </div>

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
            <div className="d">
              One component formats all {REPORTS.length}, so consistency is not something anyone has
              to remember.
            </div>
            {Object.entries(REPORT_FORMAT).filter(([k]) => k !== 'disclaimer' && k !== 'expiry_days').map(([k, v]) => (
              <div key={k} className="fmtrow">
                <b>{k.replace(/_/g, ' ')}</b>
                <span>{v}</span>
              </div>
            ))}
          </div>

          <div className="panel">
            <h3>Two formats, two jobs</h3>
            <div className="d">
              <b>PDF</b> is co-branded and formatted to send to a client.
              <br />
              <b>Excel</b> is the raw rows for you to slice.
              <br /><br />
              The current portal offers &ldquo;PDF&rdquo;, &ldquo;V2 PDF&rdquo; and Excel
              inconsistently across screens, and nobody can say what V2 changes. Two formats with a
              clear job each replaces that.
            </div>
          </div>

          <div className="panel">
            <h3>Downloads expire</h3>
            <div className="d">
              After <b>{REPORT_FORMAT.expiry_days} days</b> a generated file stops working. It holds a
              client&apos;s holdings and PAN — it should not outlive the reason it was made.
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
