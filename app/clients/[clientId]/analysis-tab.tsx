import Link from 'next/link';
import { Explain } from '../../../components/Explain';
import { inr, inrCompact, dmy, dmy2 } from '../../../lib/format';
import { clientHoldings, riskScale, type ClientHeader } from '../../../lib/client360';
import { schemeGrades } from '../../../lib/scoring';
import {
  equityCurveFor, lookThrough, fundOverlap, fundDetails, fundVsBenchmark,
  categoryPerformance, benchmarkComparison, fundHoldingRows, LOOKTHROUGH_RULES,
  type CurvePoint,
} from '../../../lib/portfolio';
import { ChartLines } from '../../../components/charts';

const SECTOR_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#8e6bc9', '#d95981', '#4aa8a0', '#a08a5b'];
const CAP_COLORS: Record<string, string> = { Large: 'var(--s1)', Mid: 'var(--s3)', Small: 'var(--s2)', Unclassified: '#c3c8cc' };

// The equity curve. It used to be a hand-rolled SVG with no value axis at all —
// three polylines, two date labels, and every figure only in the legend beneath.
// You could see that the money had grown and not read a single number off the
// plot, and nothing showed WHEN money went in, so a line that rose because the
// client paid in looked identical to one that rose because the market did.
function Curve({ pts, height = 260 }: { pts: CurvePoint[]; height?: number }) {
  if (pts.length < 2) return <div className="d">Not enough history yet to draw a curve.</div>;
  const last = pts[pts.length - 1];
  const gap = last.value - last.benchmark;

  // A marker sits on the invested line, because that is the line a cashflow moves.
  // Months with no movement carry no field and so draw no mark.
  const rows = pts.map(p => ({
    m: dmy2(p.d),
    value: p.value,
    invested: p.invested,
    benchmark: p.benchmark,
    inflow: p.inflow,
    outflow: p.outflow,
    ...(p.inflow > 0 ? { inAt: p.invested } : {}),
    ...(p.outflow > 0 ? { outAt: p.invested } : {}),
  }));
  const inMonths = pts.filter(p => p.inflow > 0);
  const outMonths = pts.filter(p => p.outflow > 0);
  const totalIn = pts.reduce((s, p) => s + p.inflow, 0);
  const totalOut = pts.reduce((s, p) => s + p.outflow, 0);
  const biggest = [...inMonths].sort((a, b) => b.inflow - a.inflow)[0];

  return (
    <>
      <ChartLines
        height={height} unit="inr" baseline="data" endLabels
        title="What the money did, and when it went in"
        xLabel="month end" yLabel="value"
        source="units held at each month-end × NAV then · cumulative net cashflow · the same cashflows in each fund's own benchmark"
        data={rows} xKey="m"
        alt={`Growth from ${dmy2(pts[0].d)} to ${dmy2(last.d)}: put in ${inr(last.invested)}, worth ${inr(last.value)}, the same money in the index ${inr(last.benchmark)}. ${inMonths.length} months took money in and ${outMonths.length} took money out.`}
        series={[
          { key: 'value', name: 'Worth', tone: 's1' },
          { key: 'benchmark', name: 'Same money in the index', tone: 's2' },
          { key: 'invested', name: 'Put in', tone: 'grey' },
        ]}
        markers={[
          { key: 'inAt', amountKey: 'inflow', name: 'Money in', tone: 'green', shape: 'triangle' },
          { key: 'outAt', amountKey: 'outflow', name: 'Money out', tone: 'red', shape: 'diamond' },
        ]}
        mark={<>
          {gap >= 0
            ? <>Ahead of the index by <b style={{ color: 'var(--pos)' }}>{inr(gap)}</b>. </>
            : <>Behind the index by <b style={{ color: 'var(--neg)' }}>{inr(Math.abs(gap))}</b>. </>}
          {inMonths.length} month{inMonths.length === 1 ? '' : 's'} took money in ({inr(totalIn)})
          {outMonths.length > 0
            ? <> and {outMonths.length} took money out ({inr(totalOut)})</>
            : <> and nothing has ever been taken out</>}
          {biggest && <> — the largest single month was {dmy2(biggest.d)} at {inr(biggest.inflow)}</>}.
        </>}
      />
      <div className="lg">
        <span style={{ ['--c' as string]: 'var(--s1)' }}><b>Worth today {inr(last.value)}</b></span>
        <span style={{ ['--c' as string]: 'var(--s2)' }}><b>Same money in the index {inr(last.benchmark)}</b></span>
        <span style={{ ['--c' as string]: 'var(--grey)' }}><b>Put in {inr(last.invested)}</b></span>
      </div>
      <div className="mark">
        The index line is the same rupees on the same dates, bought into these funds&apos; own
        benchmarks — not an index return pasted over a different set of cashflows.
      </div>
    </>
  );
}

export function AnalysisTab({ id, head, funds, fundFocus }: { id: number; head: ClientHeader; funds?: string; fundFocus?: string }) {
  const holdings = clientHoldings(id).rows;
  const details = fundDetails(id);
  const grades = schemeGrades();
  const chosen = (funds ?? '').split(',').map(Number).filter(n => n > 0);
  const curve = equityCurveFor(id, chosen);
  const cmp = benchmarkComparison(id);
  const lt = lookThrough(id);
  const overlap = fundOverlap(id);
  const cats = categoryPerformance(id);
  const scale = riskScale(id, head.risk);
  const focus = details.find(f => String(f.scheme_id) === fundFocus);
  const href = (next: number[]) => `/clients/${id}?tab=analysis${next.length ? `&funds=${next.join(',')}` : ''}`;

  return (
    <>
      {/* A · growth against the benchmark */}
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Growth against the benchmark <Explain figure={curve} /></h4>
        <div className="chips" style={{ marginBottom: 10 }}>
          <Link href={href([])} className={`chip ${chosen.length === 0 ? 'on' : ''}`}>All funds</Link>
          {details.map(f => {
            const on = chosen.includes(f.scheme_id);
            const next = on ? chosen.filter(x => x !== f.scheme_id) : [...chosen, f.scheme_id];
            return (
              <Link key={f.scheme_id} href={href(next)} className={`chip ${on ? 'on' : ''}`} title={f.name}>
                {f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}
              </Link>
            );
          })}
        </div>
        <Curve pts={curve.value} />
        <div className="d" style={{ marginTop: 8 }}>
          Her money-weighted return <b className="num">{cmp.value.client_xirr}%</b> · the same cashflows in the index <b className="num">{cmp.value.bench_xirr}%</b>.
          One engine feeds this line and the headline figures, so they cannot disagree.
        </div>
      </div>

      {/* B · what she actually owns */}
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>What she actually owns — through the funds <Explain figure={lt} /></h4>
        {lt.value.stocks.length === 0
          ? <div className="d">None of these funds publish stock-level holdings, so there is nothing to look through.</div>
          : <>
            <div className="stack">
              {lt.value.sectors.slice(0, 8).map((s, i) => (
                <div key={s.sector} style={{ flex: s.rupees, background: SECTOR_COLORS[i % SECTOR_COLORS.length] }} title={`${s.sector} ${s.pct}% · ${inr(s.rupees)}`} />
              ))}
              {lt.value.sectors.length > 8 && (
                <div style={{ flex: lt.value.sectors.slice(8).reduce((a, s) => a + s.rupees, 0), background: '#c3c8cc' }} title="Other sectors" />
              )}
            </div>
            <div className="lg">
              {lt.value.sectors.slice(0, 6).map((s, i) => (
                <span key={s.sector} style={{ ['--c' as string]: SECTOR_COLORS[i % SECTOR_COLORS.length] }}>
                  <b>{s.sector} {s.pct}%</b> {inrCompact(s.rupees)}
                </span>
              ))}
            </div>
            <div className="mark">
              Sector weights come from what each fund discloses it holds, sized by her rupees in that fund —
              covering <b>{lt.value.coverage_pct}%</b> of the portfolio, as of {lt.value.as_of ? dmy(lt.value.as_of) : '—'}.
              {lt.value.coverage_pct < 100 && ' The rest is debt, gold or hybrid, which has no stock look-through.'}
            </div>
          </>}
      </div>

      {/* C · the overlap nobody sees at fund level */}
      {overlap.length > 0 && (
        <div className="viz" style={{ marginBottom: 18 }}>
          <h4>The same shares, bought twice <Explain figure={lt} /></h4>
          <div className="tblwrap" style={{ marginBottom: 10 }}>
            <table>
              <thead><tr><th>Fund</th><th>Fund</th><th>Shared stocks</th><th>Common weight</th></tr></thead>
              <tbody>
                {overlap.map((p, i) => (
                  <tr key={i}>
                    <td>{p.a}</td><td>{p.b}</td>
                    <td className="num" style={{ textAlign: 'center' }}>{p.shared}</td>
                    <td className="r num">{p.shared_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mark">
            <b>{lt.value.overlap_pct}%</b> of her money sits in <b>{lt.value.overlap_stocks}</b> stocks that more than one of these funds holds.
            Different funds, largely the same book — this is what the diversification score now measures.
          </div>
        </div>
      )}

      {/* D · largest positions and market-cap lens */}
      <div className="vizrow" style={{ gridTemplateColumns: '1.4fr 1fr', marginBottom: 18 }}>
        <div className="viz">
          <h4>Her ten largest shareholdings <Explain figure={lt} /></h4>
          <div className="tblwrap">
            <table>
              <thead><tr><th>Company</th><th>Sector</th><th>Cap</th><th>Held via</th><th>Value</th><th>% of portfolio</th></tr></thead>
              <tbody>
                {lt.value.stocks.slice(0, 10).map(s => (
                  <tr key={s.stock}>
                    <td>{s.stock}</td>
                    <td>{s.sector}</td>
                    <td style={{ textAlign: 'center' }}>{s.cap_band ?? '—'}</td>
                    <td className="num" style={{ textAlign: 'center' }}>
                      {s.funds > 1 ? <span className="fchip conc">{s.funds} funds</span> : '1 fund'}
                    </td>
                    <td className="r num">{inr(s.rupees)}</td>
                    <td className="r num">{s.pct}%</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={4}>Top ten together</td><td className="r num">{inr(lt.value.stocks.slice(0, 10).reduce((a, s) => a + s.rupees, 0))}</td><td className="r num">{lt.value.top10_pct}%</td></tr></tfoot>
            </table>
          </div>
        </div>
        <div className="viz">
          <h4>Large, mid or small <Explain figure={lt} /></h4>
          <div className="stack">
            {lt.value.caps.map(c => (
              <div key={c.band} style={{ flex: c.rupees, background: CAP_COLORS[c.band] ?? '#c3c8cc' }} title={`${c.band} ${c.pct}%`} />
            ))}
          </div>
          <div className="lg">
            {lt.value.caps.map(c => (
              <span key={c.band} style={{ ['--c' as string]: CAP_COLORS[c.band] ?? '#c3c8cc' }}>
                <b>{c.band} {c.pct}%</b>
              </span>
            ))}
          </div>
          <div className="mark">
            Classified by each company&apos;s actual market capitalisation (top 100 large, next 150 mid, rest small) — not
            inferred from the fund&apos;s label. {LOOKTHROUGH_RULES.version.split('—')[0].trim()} governs the fallback where a
            company is unclassified.
          </div>
        </div>
      </div>

      {/* E · fund report cards, deep dive opens in place */}
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Her funds <Explain figure={cats} /></h4>
        {details.map(f => {
          const g = grades.get(f.scheme_id);
          const h = holdings.find(x => x.scheme_id === f.scheme_id);
          const open = String(f.scheme_id) === fundFocus;
          const beat = f.ret1y != null && f.cat_avg_1y != null && f.ret1y >= f.cat_avg_1y;
          return (
            <div key={f.scheme_id} className={`fundcard ${beat ? 'good' : 'bad'}`} style={{ gridTemplateColumns: 'minmax(0,2fr) repeat(4, minmax(0,1fr)) auto' }}>
              <span className="fn">
                {g && <span className={`gradechip g${g.grade}`} title={`Grade ${g.grade} — ${g.ret1y}% over a year against a category average of ${g.cat_avg}%`} style={{ marginRight: 8 }}>{g.grade}</span>}
                {f.name}
                <span className="d">{f.amc} · {f.category}{f.pick === 1 && ' · Jhaveri pick ★'}</span>
              </span>
              <span><span className="m">Value</span><br /><span className="val num">{inr(f.value)}</span></span>
              <span><span className="m">1-year</span><br /><span className={`val num ${beat ? 'up' : 'down'}`}>{f.ret1y ?? '—'}%</span>
                <span className="d"> vs {f.cat_avg_1y ?? '—'}%</span></span>
              <span><span className="m">Rank in category</span><br /><span className="val num">{f.rank_in_cat ?? '—'} of {f.cat_size ?? '—'}</span></span>
              <span><span className="m">Expense</span><br /><span className="val num">{f.expense}%</span>
                <span className="d"> vs {f.cat_expense}%</span></span>
              <Link className="chip" href={open ? `/clients/${id}?tab=analysis` : `/clients/${id}?tab=analysis&fund=${f.scheme_id}`}>
                {open ? '✕ Close' : 'Open'}
              </Link>
            </div>
          );
        })}
      </div>

      {focus && <FundPanel id={id} focus={focus} />}

      {/* F · how her categories are doing */}
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>How her segments are performing <Explain figure={cats} /></h4>
        <div className="tblwrap">
          <table>
            <thead><tr><th>Segment</th><th>Her money</th><th>Category average (1y)</th><th>Her fund</th><th>Rank</th><th>Best / worst in category</th></tr></thead>
            <tbody>
              {cats.value.map(c => (
                <tr key={c.category}>
                  <td>{c.category} <span className="sub">{c.asset}</span></td>
                  <td className="r num">{inr(c.client_value)}</td>
                  <td className="r num">{c.cat_avg_1y}%</td>
                  <td className={`r num ${c.client_1y != null && c.cat_avg_1y != null && c.client_1y >= c.cat_avg_1y ? 'up' : 'down'}`}>{c.client_1y ?? '—'}%</td>
                  <td className="num" style={{ textAlign: 'center' }}>{c.client_rank ?? '—'} of {c.funds}</td>
                  <td className="r num">{c.best_1y}% / {c.worst_1y}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mark">Category averages computed across every fund in the catalogue, not a marketing figure.</div>
      </div>

      {/* G · risk fit */}
      <div className="viz">
        <h4>Risk appetite against what the portfolio actually holds <Explain figure={scale} /></h4>
        <div className="riskscale">
          <div className="track" />
          <div className="pin client" style={{ left: `${(scale.value.client / 5) * 96}%` }}>Profile · {head.risk}<i /></div>
          {scale.value.portfolio != null && (
            <div className="pin port" style={{ left: `${(scale.value.portfolio / 5) * 96}%`, top: 26 }}>Portfolio {scale.value.portfolio} / 5<i /></div>
          )}
        </div>
        <div className="scale-ends"><span>Conservative 1</span><span>Very Aggressive 5</span></div>
        <div className="d" style={{ marginTop: 10 }}>
          {scale.value.portfolio != null && Math.abs(scale.value.portfolio - scale.value.client) <= 0.5
            ? 'Profile and portfolio agree — suitability evidence on file for every proposal.'
            : 'Profile and portfolio diverge — worth settling at the next review.'}
        </div>
      </div>
    </>
  );
}

function FundCurve({ clientId, schemeId, benchmark }: { clientId: number; schemeId: number; benchmark: string }) {
  const pts = fundVsBenchmark(clientId, schemeId);
  if (pts.length < 2) return <div className="d">Not enough price history since purchase.</div>;
  const W = 720, H = 150, PAD = 30;
  const all = pts.flatMap(p => [p.fund, p.bench]);
  const lo = Math.min(...all) * 0.97, hi = Math.max(...all) * 1.03;
  const X = (i: number) => PAD + (i * (W - PAD - 8)) / (pts.length - 1);
  const Y = (v: number) => H - 20 - ((v - lo) / (hi - lo)) * (H - 40);
  const last = pts[pts.length - 1];
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img"
        aria-label={`Fund ${last.fund.toFixed(0)} against benchmark ${last.bench.toFixed(0)}, both starting at 100`}>
        <line x1={PAD} y1={Y(100)} x2={W - 8} y2={Y(100)} stroke="var(--line)" strokeDasharray="3 3" />
        <polyline fill="none" stroke="var(--s2)" strokeWidth="2" points={pts.map((p, i) => `${X(i)},${Y(p.bench)}`).join(' ')} />
        <polyline fill="none" stroke="var(--s1)" strokeWidth="2.5" points={pts.map((p, i) => `${X(i)},${Y(p.fund)}`).join(' ')} />
        <text x={PAD} y={H - 4} fontSize="10" fill="var(--muted)">{dmy2(pts[0].d)} · both start at 100</text>
      </svg>
      <div className="lg">
        <span style={{ ['--c' as string]: 'var(--s1)' }}><b>This fund {last.fund.toFixed(1)}</b></span>
        <span style={{ ['--c' as string]: 'var(--s2)' }}><b>{benchmark} {last.bench.toFixed(1)}</b></span>
      </div>
    </>
  );
}

function FundHoldings({ schemeId }: { schemeId: number }) {
  const rows = fundHoldingRows(schemeId);
  if (rows.length === 0) return <div className="d">This fund does not publish stock-level holdings (debt, gold or hybrid).</div>;
  const bySector = new Map<string, number>();
  for (const r of rows) bySector.set(r.sector, (bySector.get(r.sector) ?? 0) + r.weight_pct);
  const sectors = [...bySector.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <>
      <div className="lg" style={{ marginBottom: 10 }}>
        {sectors.map(([s, w], i) => (
          <span key={s} style={{ ['--c' as string]: SECTOR_COLORS[i % SECTOR_COLORS.length] }}><b>{s} {w.toFixed(1)}%</b></span>
        ))}
      </div>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Company</th><th>Sector</th><th>Cap</th><th>Weight in fund</th></tr></thead>
          <tbody>
            {rows.slice(0, 12).map(r => (
              <tr key={r.stock_name}>
                <td>{r.stock_name}</td><td>{r.sector}</td>
                <td style={{ textAlign: 'center' }}>{r.cap_band ?? '—'}</td>
                <td className="r num">{r.weight_pct.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan={3}>{rows.length} holdings disclosed</td><td className="r num">{rows.reduce((a, r) => a + r.weight_pct, 0).toFixed(1)}%</td></tr></tfoot>
        </table>
      </div>
    </>
  );
}

function FundPanel({ id, focus }: { id: number; focus: ReturnType<typeof fundDetails>[number] }) {
  const f = focus;
  return (
        <div className="dive" style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <h3 style={{ flex: 1 }}>{f.name}</h3>
            <Link className="chip" href={`/clients/${id}?tab=analysis`}>✕ Close</Link>
          </div>
          <p className="lead">{f.amc} · {f.category} · benchmark {f.benchmark} · ISIN {f.isin}</p>

          <h5>Against its own benchmark, since she bought it</h5>
          <FundCurve clientId={id} schemeId={f.scheme_id} benchmark={f.benchmark} />

          <h5 style={{ marginTop: 16 }}>The fund</h5>
          <div className="calc" style={{ marginBottom: 16 }}>
            <span className="lbl">Her holding</span><span className="eff">{inr(f.value)} · {f.units.toFixed(2)} units · {f.weight?.toFixed(1)}% of portfolio</span>
            <span className="lbl">She invested</span><span className="eff">{inr(f.invested)} since {f.first_bought ? dmy(f.first_bought) : '—'}</span>
            <span className="lbl">One-year return</span><span className="eff">{f.ret1y}% · category average {f.cat_avg_1y}% · rank {f.rank_in_cat} of {f.cat_size}</span>
            <span className="lbl">Expense ratio</span><span className="eff">{f.expense}% · category average {f.cat_expense}%</span>
            <span className="lbl">Risk grade / exit load</span><span className="eff">{f.risk} · {f.exit_load === 1 ? '1% within a year' : 'none'}</span>
            <span className="lbl tot">Current NAV</span><span className="eff tot">{f.nav.toFixed(2)}</span>
          </div>

          <h5>What this fund holds</h5>
          <FundHoldings schemeId={f.scheme_id} />
        </div>
  );
}
