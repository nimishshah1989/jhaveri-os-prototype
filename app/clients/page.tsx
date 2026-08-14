import Link from 'next/link';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { ClientsTable } from '../../components/ClientsTable';
import { Explain } from '../../components/Explain';
import { QueueTable } from '../../components/QueueTable';
import { inrCompact, dmy } from '../../lib/format';
import {
  broker, myBook, blendedReturn, sipParticipation, churnRisk, dormantClients,
  idleNoSip, taxWindowClients, assetMix, healthSplit, xirrBands, clientRows,
  worthActingOn, learning, type ClientFilters,
} from '../../lib/queries';
import { bookHealth, SCORING_RULES } from '../../lib/scoring';
import { ChartBars, ChartScatter } from '../../components/charts';

export const dynamic = 'force-dynamic';

const SEGMENTS: [string, string][] = [
  ['attention', 'Needs attention'],
  ['nosip', 'No SIP'],
  ['dormant', 'Dormant >14m'],
  ['taxwindow', 'Tax-harvest window'],
];

const MIX_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];

function seg(f: ClientFilters, key?: string): string {
  const p = new URLSearchParams();
  if (key) p.set('seg', key);
  if (f.q) p.set('q', f.q);
  if (f.risk) p.set('risk', f.risk);
  if (f.sort) p.set('sort', f.sort);
  const s = p.toString();
  return `/clients${s ? '?' + s : ''}`;
}

export default async function ClientsPage({ searchParams }: PageProps<'/clients'>) {
  const sp = await searchParams;
  const f: ClientFilters = {
    seg: typeof sp.seg === 'string' ? sp.seg : undefined,
    q: typeof sp.q === 'string' ? sp.q : undefined,
    risk: typeof sp.risk === 'string' ? sp.risk : undefined,
    sort: typeof sp.sort === 'string' ? sp.sort : undefined,
  };
  const me = broker();
  const book = myBook(me.code);
  const blended = blendedReturn(me.code);
  const sipPart = sipParticipation(me.code);
  const churn = churnRisk(me.code);
  const dormant = dormantClients(me.code);
  const idle = idleNoSip(me.code);
  const taxWin = taxWindowClients(me.code);
  const mix = assetMix(me.code);
  const mixTotal = mix.value.reduce((s, r) => s + r.v, 0);
  const health = healthSplit(me.code);
  const bands = xirrBands(me.code);
  const bandMax = Math.max(...bands.value.map(b => b.n), 1);
  const scores = bookHealth(me.code);
  let { rows } = clientRows(me.code, f);
  if (f.seg === 'quickwins') {
    rows = rows.filter(r => (scores.get(r.client_id)?.maxLever ?? 0) >= SCORING_RULES.quick_win_single_lever);
  }
  if (f.sort === 'health') {
    rows = [...rows].sort((a, b) => (scores.get(a.client_id)?.score ?? 0) - (scores.get(b.client_id)?.score ?? 0));
  }
  const quickWinCount = [...scores.values()].filter(r => r.maxLever >= SCORING_RULES.quick_win_single_lever).length;
  const healthObj = Object.fromEntries([...scores.entries()].map(([k, v]) => [k, { score: v.score, gain: v.gain, band: v.band, cls: v.cls }]));
  const totals = {
    v: rows.reduce((s, r) => s + r.v, 0),
    invested: rows.reduce((s, r) => s + r.invested, 0),
  };
  const acting = worthActingOn();
  const learn = learning();
  const allCount = clientRows(me.code, {}).rows.length;

  // Two questions a ranked table cannot answer, because a table can only rank on
  // one column at a time: how the book is distributed, and who is big AND unwell.
  // Both read the rows already on screen, so the filter above scopes them too.
  const SIZES: [string, number, number][] = [
    ['< ₹1 L', 0, 1e5], ['₹1–5 L', 1e5, 5e5], ['₹5–10 L', 5e5, 1e6],
    ['₹10–25 L', 1e6, 2.5e6], ['> ₹25 L', 2.5e6, Infinity],
  ];
  const sizes = SIZES.map(([label, lo, hi]) => {
    const inBand = rows.filter(r => r.v >= lo && r.v < hi);
    return { size: label, n: inBand.length, v: inBand.reduce((s, r) => s + r.v, 0) };
  });
  const topBand = [...sizes].reverse().find(b => b.n > 0);
  const bookTotal = rows.reduce((s, r) => s + r.v, 0);

  // cls is the health band's own class name — the same three the table paints its
  // score pills with, mapped onto the tone vocabulary rather than a fourth palette.
  const HEALTH_TONE: Record<string, string> = { lt: 'green', conc: 'amber', atrisk: 'red' };
  const scatter = rows.map(r => {
    const h = scores.get(r.client_id);
    return {
      name: r.name, score: h?.score ?? 0, v: r.v,
      tone: HEALTH_TONE[h?.cls ?? ''] ?? 'grey',
    };
  });
  // "Healthy" is the top band's floor, read off the rules rather than retyped.
  const healthyMin = SCORING_RULES.bands[0].min;
  const belowHealthy = scatter.filter(d => d.score < healthyMin);
  const belowHealthyValue = belowHealthy.reduce((s2, d) => s2 + d.v, 0);

  return (
    <>
      <PageHead title="Clients" icon="users"
        question="Who in my book needs me, and who is quietly worth more than I think?"
      />
      <p className="denom">&quot;Holds money today&quot; definition — {allCount} clients · as of {dmy(book.value.as_of)}</p>
      <nav className="crumb" aria-label="Book view">
        <Link href="/clients/book">My book — the whole thing as one portfolio →</Link>
      </nav>

      <div className="cols">
        <div>
          <div className="cards six">
            <div className="card"><div className="body">
              <div className="k">Book <Explain figure={book} /></div>
              <div className="v num">{inrCompact(book.value.v)}</div>
              <div className="s">{allCount} clients</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Blended return <Explain figure={blended} /></div>
              <div className="v num good">+{blended.value.x}%</div>
              <div className="s">value-weighted · as of {dmy(blended.value.as_of)}</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">SIP participation <Explain figure={sipPart} /></div>
              <div className="v num opp">{sipPart.value.n} of {sipPart.value.of}</div>
              <div className="s">{Math.round((sipPart.value.n / sipPart.value.of) * 100)}% of the book</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Needs attention <Explain figure={churn} /></div>
              <div className="v num warn">{churn.value.n}</div>
              <div className="s">flagged by rules</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Dormant &gt;14m <Explain figure={dormant} /></div>
              <div className="v num warn">{dormant.value.n}</div>
              <div className="s">no transaction in 14 months</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Idle money <Explain figure={idle} /></div>
              <div className="v num opp">{inrCompact(idle.value.v)}</div>
              <div className="s">{idle.value.n} clients, no SIP</div>
            </div></div>
          </div>

          <div className="vizrow">
            <div className="viz">
              <h4>Where the book sits <Explain figure={mix} /></h4>
              <div className="stack">
                {mix.value.map((r, i) => (
                  <div key={r.label} style={{ flex: r.v, background: MIX_COLORS[i] ?? 'var(--grey)' }} title={`${r.label} ${inrCompact(r.v)}`} />
                ))}
              </div>
              <div className="lg">
                {mix.value.map((r, i) => (
                  <span key={r.label} style={{ ['--c' as string]: MIX_COLORS[i] ?? 'var(--grey)' }}>
                    <b>{r.label} {((r.v / mixTotal) * 100).toFixed(1)}%</b> {inrCompact(r.v)}
                  </span>
                ))}
              </div>
            </div>
            <div className="viz">
              <h4>Client health <Explain figure={health} /></h4>
              <div className="stack">
                <a href={seg(f)} style={{ flex: health.value.healthy, background: 'var(--pos)', opacity: .85 }} title={`Active & clean ${health.value.healthy}`} />
                <a href={seg(f, 'dormant')} style={{ flex: health.value.dormant, background: '#9aa5ad' }} title={`Dormant ${health.value.dormant}`} />
                <a href={seg(f, 'attention')} style={{ flex: Math.max(health.value.concentrated, 1), background: 'var(--amber)' }} title={`Concentrated ${health.value.concentrated}`} />
              </div>
              <div className="lg">
                <span style={{ ['--c' as string]: 'var(--pos)' }}><b>Active &amp; clean {health.value.healthy}</b></span>
                <span style={{ ['--c' as string]: '#9aa5ad' }}><b>Dormant {health.value.dormant}</b></span>
                <span style={{ ['--c' as string]: 'var(--amber)' }}><b>Concentrated {health.value.concentrated}</b></span>
              </div>
              <div className="mark">Every segment clicks to its client list</div>
            </div>
            <div className="viz">
              <h4>Returns spread (blended XIRR) <Explain figure={bands} /></h4>
              <div className="hist">
                {bands.value.map(b => (
                  <div key={b.band} className={`col ${b.band === '< 0%' ? 'neg' : ''}`}>
                    <span className="n num">{b.n}</span>
                    <div className="bar" style={{ height: `${Math.max((b.n / bandMax) * 100, 3)}%` }} />
                    <span className="b">{b.band}</span>
                  </div>
                ))}
              </div>
              <div className="mark">
                Book blended: <b>+{blended.value.x}%</b>{bands.value[0].n > 0 && <> · {bands.value[0].n} clients in the red — talk to them first</>}
              </div>
            </div>
          </div>

          <div className="charts">
            <ChartBars
              title="How the book is distributed" height={215}
              xLabel="what a client holds" yLabel="clients"
              source="fifo_summary_holding_active.present_market_value, by client"
              data={sizes} xKey="size"
              series={[{ key: 'n', name: 'Clients', tone: 's1' }]}
              mark={topBand && bookTotal > 0
                ? <>The <b>{topBand.n}</b> client{topBand.n === 1 ? '' : 's'} in {topBand.size} hold {inrCompact(topBand.v)} — <b>{Math.round((topBand.v / bookTotal) * 100)}%</b> of everything on this screen. Count is drawn; the rupees are on hover.</>
                : <>No clients in the current filter.</>}
              aside={<Explain teaser="Why count, not rupees">
                Both are true and they say opposite things: the bands with the most
                clients are rarely the bands with the most money. The bars count
                people, and the hover gives the rupees in that band, so neither
                reading can quietly stand in for the other.
              </Explain>}
            />
            <ChartScatter
              title="Health against size" height={215}
              xLabel="health score" yLabel="what they hold"
              source="health_v0 score vs present_market_value · one dot per client"
              data={scatter} xKey="score" yKey="v" nameKey="name"
              xUnit="count" yUnit="inr" toneKey="tone"
              quadrant={{ x1: 0, x2: healthyMin, label: 'below healthy' }}
              keyItems={[{ name: 'healthy', tone: 'green' }, { name: 'needs work', tone: 'amber' }, { name: 'at risk', tone: 'red' }]}
              mark={<><b>{belowHealthy.length}</b> of {scatter.length} clients sit left of the {healthyMin} line, holding <b>{inrCompact(belowHealthyValue)}</b> between them. Height is what they are worth, so the dot to work is the highest one on the left.</>}
            />
          </div>

          <div className="chips">
            <Link className={`chip ${!f.seg ? 'on' : ''}`} href={seg(f)}>All <b>{allCount}</b></Link>
            <Link className={`chip warn ${f.seg === 'attention' ? 'on' : ''}`} href={seg(f, 'attention')}>Needs attention <b>{churn.value.n}</b></Link>
            <Link className={`chip opp ${f.seg === 'nosip' ? 'on' : ''}`} href={seg(f, 'nosip')}>No SIP <b>{idle.value.n}</b></Link>
            <Link className={`chip warn ${f.seg === 'dormant' ? 'on' : ''}`} href={seg(f, 'dormant')}>Dormant &gt;14m <b>{dormant.value.n}</b></Link>
            <Link className={`chip opp ${f.seg === 'taxwindow' ? 'on' : ''}`} href={seg(f, 'taxwindow')}>Tax-harvest window <b>{taxWin.value.n}</b></Link>
            <Link className={`chip ${f.seg === 'quickwins' ? 'on' : ''}`} href={seg(f, 'quickwins')} title="One call, one big health jump — a single fix worth 8+ points">Quick wins <b style={{ color: 'var(--pos)' }}>{quickWinCount}</b></Link>
            <span className="chip ghost">Likely to top up — needs 100 captured outcomes, has 0</span>
            <span className="chip ghost" title="Ships once segments get a save UI — the segments table already exists">+ Save current filter as segment</span>
          </div>

          <form className="filters" method="GET" action="/clients">
            {f.seg && <input type="hidden" name="seg" value={f.seg} />}
            <select name="risk" defaultValue={f.risk ?? ''}>
              <option value="">Risk: all</option>
              <option value="Moderate">Moderate</option>
              <option value="Aggressive">Aggressive</option>
              <option value="Very Aggressive">Very Aggressive</option>
            </select>
            <select name="sort" defaultValue={f.sort ?? 'value'}>
              <option value="value">Sort: value</option>
              <option value="pnl">Sort: P&amp;L</option>
              <option value="xirr">Sort: XIRR</option>
              <option value="activity">Sort: least recent activity</option>
              <option value="spoke">Sort: longest since we spoke</option>
              <option value="parked">Sort: most parked cash</option>
              <option value="health">Sort: weakest health first</option>
            </select>
            <input type="search" name="q" placeholder="Search name / folio / PAN" defaultValue={f.q ?? ''} />
            <button type="submit">Apply</button>
          </form>

          <ClientsTable rows={rows} totals={totals} health={healthObj} />

          <div className="below">
            <span>Tick clients for bulk actions · CSV export</span>
            <span>Click a name for the client&apos;s full profile</span>
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Worth acting on</h3>
            <QueueTable items={acting} readonly shown={4} />
            <div className="d">Full ranked queue on <Link href="/today">Today</Link></div>
          </div>
          <div className="panel">
            <h3>Book vs house</h3>
            <div className="lrow"><span>Equity share</span><span className="bar2"><i style={{ width: `${(mix.value.find(r => r.label === 'Equity')?.v ?? 0) / mixTotal * 100}%` }} /></span><span className="num">{(((mix.value.find(r => r.label === 'Equity')?.v ?? 0) / mixTotal) * 100).toFixed(1)}%</span></div>
            <div className="lrow"><span>SIP participation</span><span className="bar2"><i style={{ width: `${(sipPart.value.n / sipPart.value.of) * 100}%` }} /></span><span className="num">{Math.round((sipPart.value.n / sipPart.value.of) * 100)}%</span></div>
            <div className="lrow"><span>Dormancy</span><span className="bar2"><i style={{ width: `${(dormant.value.n / sipPart.value.of) * 100}%` }} /></span><span className="num">{Math.round((dormant.value.n / sipPart.value.of) * 100)}%</span></div>
            <div className="d">House medians land here once all-broker rollups ship (management lens)</div>
          </div>
          <div className="panel learn">
            <h3>What the system is learning <Explain figure={learn} /></h3>
            {learn.value.map(p => (
              <div key={`${p.workflow}-${p.policy_key}`} className="row">
                <span>{p.workflow.replace(/_/g, ' ')} · {p.policy_key.replace(/_/g, ' ')}</span>
                <span className="bar"><i style={{ width: `${Math.min(100, (p.evidence_n / p.target_n) * 100)}%` }} /></span>
                <span className="num">{p.evidence_n}/{p.target_n}</span>
              </div>
            ))}
            <div className="d ghost">Greyed until enough real outcomes exist — never a faked insight.</div>
          </div>
        </aside>
      </div>
    </>
  );
}
