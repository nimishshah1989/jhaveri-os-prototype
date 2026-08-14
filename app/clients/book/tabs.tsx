import Link from 'next/link';
import { Explain } from '../../../components/Explain';
import { Collapse } from '../../../components/Collapse';
import { ClientLink } from '../../../components/ClientLink';
import { ChartBars } from '../../../components/charts';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { bookLookThrough, type LookThrough } from '../../../lib/portfolio';
import {
  bookAssetMix, bookCategoryMix, sectorClients, bookFunds, categoryStanding,
  bookGoals, goalCoverage, type BookHeader,
} from '../../../lib/book';
import { GOAL_RULES } from '../../../lib/goals';

// The four lenses. Each one is the Client 360 tab of the same name with the client
// filter taken off, so a figure here and the same figure on a client's page are
// the same query — verify-book.ts holds them to that to the rupee.

// Asset classes are ordered categories in every sense that matters to a broker,
// so they keep a fixed colour rather than being coloured by rank.
const ASSET_TONE: Record<string, string> = {
  Equity: 's1', Debt: 's3', Hybrid: 's4', Commodities: 's2',
};
const toneFor = (label: string): string => ASSET_TONE[label] ?? 'grey';

/** The sentence the whole page hangs off. Repeated nowhere — passed in. */
function Coverage({ lt }: { lt: LookThrough }) {
  return (
    <div className="d">
      Stock-level detail covers <b>{inrCompact(lt.covered)}</b> of {inrCompact(lt.total)} — {lt.coverage_pct}% of
      the book. Every sector and stock share below is a share of that {lt.coverage_pct}%, never of the whole book.
      <Explain teaser="Why not all of it">
        A fund can only disclose stocks if it holds stocks. Debt, Gold FoF and Liquid money is the
        rest, and no look-through exists for it — so it is left out of the denominator rather than
        counted as an unknown sector, which would make the equity concentration read smaller than
        it is. The Allocation tab shows that money by name.
      </Explain>
    </div>
  );
}

export function OverviewTab({ code, head }: { code: string; head: BookHeader }) {
  const asset = bookAssetMix(code);
  const lt = bookLookThrough(code);
  const l = lt.value;
  const equity = asset.value.find(a => a.label === 'Equity');

  return (
    <>
      <div className="cards six">
        <div className="card hero"><div className="body">
          <div className="k">Book <Explain teaser="What counts as the book">
            Every client holding units under this broker code, valued at the latest NAV on file.
            A client who has redeemed everything is not in it, which is why this count and the
            client count on Clients are the same number and both move together.
          </Explain></div>
          <div className="v num">{inrCompact(head.aum)}</div>
          <div className="s">{head.clients} clients · {head.folios} folios</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Funds held</div>
          <div className="v num">{head.schemes}</div>
          <div className="s">across {bookCategoryMix(code).value.length} categories</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Equity share</div>
          <div className="v num">{equity ? equity.pct : 0}%</div>
          <div className="s">{equity ? inrCompact(equity.v) : '—'} of the book</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Seen through to stocks</div>
          <div className="v num">{l.coverage_pct}%</div>
          <div className="s">{l.stocks.length} stocks · {l.sectors.length} sectors</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Biggest sector</div>
          <div className="v num warn">{l.top_sector_pct}%</div>
          <div className="s">{l.sectors[0]?.sector ?? '—'} · of what can be seen</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Top ten stocks</div>
          <div className="v num warn">{l.top10_pct}%</div>
          <div className="s">of the {inrCompact(l.covered)} looked through</div>
        </div></div>
      </div>

      <Coverage lt={l} />

      <div className="charts">
        <ChartBars
          title="What the book is in" height={220} unit="inr"
          xLabel="asset class" yLabel="₹ held"
          source="fifo_summary_holding_active.asset_name · every client at once"
          data={asset.value.map(a => ({ label: a.label, v: a.v, tone: toneFor(a.label) }))}
          xKey="label" toneKey="tone"
          series={[{ key: 'v', name: 'Held', tone: 's1' }]}
          mark={<>{asset.value.map(a => `${a.label} ${a.pct}%`).join(' · ')}. Hybrid and Commodities are named rather than folded into equity or debt, because they behave like neither.</>}
        />
        <ChartBars
          horizontal height={220} unit="inr"
          title="Where the equity really sits, by sector"
          xLabel="₹ looked through" yLabel="sector"
          source="mf_scheme_holdings.weight_pct × holding value, by stock_master.sector"
          data={l.sectors.slice(0, 8).reverse().map(s => ({ sector: s.sector, rupees: s.rupees }))}
          xKey="sector"
          series={[{ key: 'rupees', name: 'Looked through', tone: 's1' }]}
          mark={<>Top eight of {l.sectors.length}. <b>{l.sectors[0]?.sector}</b> at {l.top_sector_pct}% is the book&apos;s single largest bet, and no client chose it — it is what the funds add up to. The Look-through tab opens each one to the clients carrying it.</>}
        />
      </div>
    </>
  );
}

export function AllocationTab({ code, head }: { code: string; head: BookHeader }) {
  const asset = bookAssetMix(code);
  const cat = bookCategoryMix(code);
  const lt = bookLookThrough(code).value;

  return (
    <>
      <h2 className="sec">By asset class <Explain figure={asset} /></h2>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Asset class</th>
              <th className="r">Held</th><th className="r">Share</th>
              <th className="r">Funds</th><th className="r">Clients</th>
            </tr>
          </thead>
          <tbody>
            {asset.value.map(a => (
              <tr key={a.label}>
                <td>{a.label}</td>
                <td className="r num">{inr(a.v)}</td>
                <td className="r num valbar" style={{ '--w': a.pct } as React.CSSProperties}>{a.pct}%</td>
                <td className="r num">{a.funds}</td>
                <td className="r num">{a.clients}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{asset.value.length} classes</td>
              <td className="r num">{inr(head.aum)}</td>
              <td className="r num">100%</td>
              <td className="r num">{head.schemes}</td>
              <td className="r num">{head.clients}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <h2 className="sec">By SEBI category <Explain figure={cat} /></h2>
      <div className="charts">
        <ChartBars
          horizontal height={260} unit="inr"
          title="Every category the book holds"
          xLabel="₹ held" yLabel="category"
          source="fifo_summary_holding_active.fund_category"
          data={[...cat.value].reverse().map(c => ({ label: c.label, v: c.v, tone: toneFor(c.asset) }))}
          xKey="label" toneKey="tone"
          series={[{ key: 'v', name: 'Held', tone: 's1' }]}
          keyItems={[
            { name: 'Equity', tone: 's1' }, { name: 'Debt', tone: 's3' },
            { name: 'Hybrid', tone: 's4' }, { name: 'Commodities', tone: 's2' },
          ]}
          mark={<>The hybrids are here: {cat.value.filter(c => /hybrid|arbitrage/i.test(c.label)).map(c => `${c.label} ${inrCompact(c.v)}`).join(' · ') || 'none held'}. They sit between equity and debt by design, which is why the asset-class table above cannot answer this question on its own.</>}
        />
        <ChartBars
          height={260} unit="pct"
          title="Market cap, seen through to the shares"
          xLabel="band" yLabel="% of what can be seen"
          source="stock_master.cap_band on disclosed holdings — not the SEBI category floors"
          data={lt.caps.map(c => ({ band: c.band, pct: c.pct, tone: c.band === 'Unclassified' ? 'grey' : 's1' }))}
          xKey="band" toneKey="tone"
          series={[{ key: 'pct', name: 'Share', tone: 's1' }]}
          keyItems={[{ name: 'classified', tone: 's1' }, { name: 'no cap band on record', tone: 'grey' }]}
          mark={<>Computed from the shares the funds actually disclosed, not estimated from what a Large Cap fund is obliged to hold. The client pages carry that rule-based estimate too, and the two will not agree — this one is the disclosure.</>}
        />
      </div>
    </>
  );
}

export function LookThroughTab({ code, sector }: { code: string; sector?: string }) {
  const lt = bookLookThrough(code);
  const l = lt.value;
  const open = sector && l.sectors.some(s => s.sector === sector) ? sector : undefined;
  const holders = open ? sectorClients(code, open).value : [];
  // The bar is scaled to the most exposed client in this list, not to 100% — at
  // book level nobody is ever near 100% of one sector, so a full-scale bar would
  // make every row look identically flat and encode nothing.
  const worstShare = Math.max(1, ...holders.map(h => h.pct_of_theirs));
  const link = (s?: string) => `/clients/book?tab=lookthrough${s ? `&sector=${encodeURIComponent(s)}` : ''}`;

  return (
    <>
      <Coverage lt={l} />

      <h2 className="sec">Sectors, and who is carrying them <Explain figure={lt} /></h2>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Sector</th>
              <th className="r">Looked through</th><th className="r">Share</th><th />
            </tr>
          </thead>
          <tbody>
            <Collapse shown={8} noun="sectors" as="rows" span={4} items={l.sectors.map(s => (
              <tr key={s.sector} className={open === s.sector ? 'openrow' : undefined}>
                <td>{s.sector}</td>
                <td className="r num">{inr(s.rupees)}</td>
                <td className="r num valbar" style={{ '--w': (s.pct / (l.top_sector_pct || 1)) * 100 } as React.CSSProperties}>
                  {s.pct}%
                </td>
                <td className="rowacts always">
                  <Link href={open === s.sector ? link() : link(s.sector)}>
                    {open === s.sector ? 'hide clients' : 'who holds it'}
                  </Link>
                </td>
              </tr>
            ))} />
          </tbody>
        </table>
      </div>

      {open && (
        <>
          <h2 className="sec">{open} — {holders.length} clients hold it</h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th>
                  <th className="r">In {open}</th><th className="r">Their portfolio</th>
                  <th className="r">Share of theirs</th>
                </tr>
              </thead>
              <tbody>
                <Collapse shown={8} noun="clients" as="rows" span={4} items={holders.map(h => (
                  <tr key={h.client_id}>
                    <td><ClientLink id={h.client_id} name={h.name} /></td>
                    <td className="r num">{inr(h.rupees)}</td>
                    <td className="r num">{inrCompact(h.portfolio)}</td>
                    <td className="r num valbar" style={{ '--w': (h.pct_of_theirs / worstShare) * 100 } as React.CSSProperties}>
                      {h.pct_of_theirs}%
                    </td>
                  </tr>
                ))} />
              </tbody>
              <tfoot>
                <tr>
                  <td>{holders.length} clients</td>
                  <td className="r num">{inr(holders.reduce((s, h) => s + h.rupees, 0))}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="d">
            The share on the right is of that client&apos;s own portfolio, not of the sector — which
            is the number that decides whether a call is worth making.
          </p>
        </>
      )}

      <h2 className="sec">The shares the book actually owns</h2>
      <div className="charts">
        <ChartBars
          horizontal height={280} unit="inr"
          title="Top ten stocks across every client"
          xLabel="₹ looked through" yLabel="stock"
          source="mf_scheme_holdings.weight_pct × holding value, by stock"
          data={l.stocks.slice(0, 10).reverse().map(s => ({ stock: s.stock, rupees: s.rupees }))}
          xKey="stock"
          series={[{ key: 'rupees', name: 'Held through funds', tone: 's1' }]}
          mark={<>Ten of {l.stocks.length}, holding <b>{l.top10_pct}%</b> of everything that can be seen through. Nobody bought these directly.</>}
        />
        <ChartBars
          horizontal height={280} unit="count"
          title="How many funds hold the same share"
          xLabel="funds holding it" yLabel="stock"
          source="mf_scheme_holdings — distinct schemes per stock, across the book"
          data={l.stocks.slice(0, 10).reverse().map(s => ({ stock: s.stock, funds: s.funds }))}
          xKey="stock"
          series={[{ key: 'funds', name: 'Funds holding it', tone: 's2' }]}
          mark={<>Read beside the chart on the left, not on its own. At book level, overlap is not a fault — {l.overlap_stocks} of {l.stocks.length} stocks sit in two or more funds, which is what happens when 30 equity funds are held at once. It is a defect on a <i>client&apos;s</i> page, where three funds are supposed to be three bets.</>}
        />
      </div>
    </>
  );
}

export function FundsTab({ code, head }: { code: string; head: BookHeader }) {
  const funds = bookFunds(code);
  const standing = categoryStanding(code);
  const beating = funds.value.filter(f => f.ret1y !== null && f.cat_avg_1y !== null && f.ret1y >= f.cat_avg_1y);

  return (
    <>
      <div className="charts">
        <ChartBars
          horizontal height={300} unit="pct"
          title="How each category earned for the book"
          xLabel="1-year return" yLabel="category"
          source="mf_historical_price_master — value-weighted across the funds actually held"
          data={standing.value.filter(c => c.book_1y !== null).map(c => ({
            cat: c.category, book: c.book_1y as number, avg: c.cat_avg_1y ?? 0,
          }))}
          xKey="cat"
          series={[
            { key: 'book', name: 'Your book', tone: 's1' },
            { key: 'avg', name: 'Category average', tone: 'grey' },
          ]}
          mark={<>Value-weighted, so a ₹20,000 position cannot argue as loudly as a ₹20 lakh one. A fund with less than a year of history is left out of both sides rather than counted as zero.</>}
        />
        <ChartBars
          horizontal height={250} unit="inr"
          title="The ten biggest funds in the book"
          xLabel="₹ held" yLabel="fund"
          source="fifo_summary_holding_active, grouped by scheme"
          data={funds.value.slice(0, 10).reverse().map(f => ({ fund: f.fund, v: f.v }))}
          xKey="fund"
          series={[{ key: 'v', name: 'Held', tone: 's1' }]}
          mark={<><b>{funds.value.length}</b> funds across {head.clients} clients. The busiest is held by {Math.max(...funds.value.map(f => f.clients))} of them — concentration in the fund list is concentration in the book.</>}
        />
      </div>

      <h2 className="sec">Every fund, against its own category <Explain figure={funds} /></h2>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Fund</th>
              <th style={{ textAlign: 'left' }}>Category</th>
              <th className="r">Held</th><th className="r">Clients</th>
              <th className="r">1-year</th><th className="r">Category avg</th><th className="r">Gap</th>
            </tr>
          </thead>
          <tbody>
            <Collapse shown={8} noun="funds" as="rows" span={7} items={funds.value.map(f => {
              const gap = f.ret1y !== null && f.cat_avg_1y !== null ? f.ret1y - f.cat_avg_1y : null;
              return (
                <tr key={f.scheme_id}>
                  <td>{f.fund}</td>
                  <td>{f.category}</td>
                  <td className="r num">{inr(f.v)}</td>
                  <td className="r num">{f.clients}</td>
                  <td className="r num">{f.ret1y === null ? '—' : `${f.ret1y}%`}</td>
                  <td className="r num">{f.cat_avg_1y === null ? '—' : `${f.cat_avg_1y}%`}</td>
                  <td className={`r num ${gap === null ? '' : gap >= 0 ? 'up' : 'down'}`}>
                    {gap === null ? '—' : `${gap > 0 ? '+' : ''}${gap.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })} />
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>{funds.value.length} funds · {beating.length} ahead of their category</td>
              <td className="r num">{inr(head.aum)}</td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="d">
        A fund can be the largest line in the book and the worst thing in its category; only the
        last column says so.
        <Explain teaser="What the gap is not">
          It is one year, on NAV, against the average of every fund in that category — not a
          recommendation and not risk-adjusted. A Small Cap fund beating its category in a year
          the whole category fell is still a fund that lost your clients money.
        </Explain>
      </div>
    </>
  );
}

// ── Goals, across the book ──────────────────────────────────────────────────
// The aggregate the broker never had. `silent` leads it on purpose: a client who
// has never said what the money is for is not a hole in the data, it is the
// conversation that has not happened, and it is the only number here he can act
// on today. Everything else is the same projection the client sees on their own
// phone — one engine, held to it by verify-goals-book.

const GOAL_STATE: Record<string, { label: string; tone: string }> = {
  late: { label: 'Behind', tone: 'amber' },
  unreachable: { label: 'Not on this path', tone: 'red' },
  onTrack: { label: 'On track', tone: 'green' },
  reached: { label: 'Reached', tone: 'blue' },
};

export function GoalsTab({ code }: { code: string }) {
  const cov = goalCoverage(code);
  const c = cov.value;
  const all = bookGoals(code).value;

  const states = (['unreachable', 'late', 'onTrack', 'reached'] as const).map(k => ({
    state: GOAL_STATE[k].label, n: c[k], tone: GOAL_STATE[k].tone,
  }));
  const kinds = [...all.reduce((m, g) => m.set(g.kind, (m.get(g.kind) ?? 0) + g.now), new Map<string, number>())]
    .map(([kind, v]) => ({ kind, v }))
    .sort((a, b) => a.v - b.v);

  return (
    <>
      <div className="cards six">
        <div className="card hero"><div className="body">
          <div className="k">Never named a goal</div>
          <div className="v num warn">{c.silent}</div>
          <div className="s">of {c.clients} clients · {inrCompact(c.adrift)} with no stated purpose</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Working towards something</div>
          <div className="v num">{inrCompact(c.spokenFor)}</div>
          <div className="s">{all.length} goals across {c.named} clients</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Behind</div>
          <div className="v num warn">{c.late}</div>
          <div className="s">late on today&apos;s instalments</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Not on this path</div>
          <div className="v num warn">{c.unreachable}</div>
          <div className="s">will not arrive inside {GOAL_RULES.horizon_years} years</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">On track</div>
          <div className="v num good">{c.onTrack}</div>
          <div className="s">{c.reached} already reached</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Named but unfunded</div>
          <div className="v num">{c.unfunded}</div>
          <div className="s">no fund tagged to them yet</div>
        </div></div>
      </div>

      <div className="charts">
        <ChartBars
          height={215}
          title="Where the named goals stand"
          xLabel="state" yLabel="goals"
          source={`client_goals projected at the published rate — ${GOAL_RULES.version}`}
          data={states} xKey="state" toneKey="tone"
          series={[{ key: 'n', name: 'Goals', tone: 'blue' }]}
          keyItems={[
            { name: 'not on this path', tone: 'red' }, { name: 'behind', tone: 'amber' },
            { name: 'on track', tone: 'green' }, { name: 'reached', tone: 'blue' },
          ]}
          mark={<><b>{c.late + c.unreachable}</b> of {all.length} goals do not arrive on time on what is going in today. That is a monthly-instalment conversation, not a fund-selection one — the fix is on the client&apos;s Goals tab, priced in months.</>}
        />
        <ChartBars
          horizontal height={215} unit="inr"
          title="What the book is saving for"
          xLabel="₹ tagged to goals of this kind" yLabel="kind"
          source="client_goals.goal_kind × the money tagged to each goal"
          data={kinds} xKey="kind"
          series={[{ key: 'v', name: 'Working towards it', tone: 's1' }]}
          mark={<>Only <b>{inrCompact(c.spokenFor)}</b> of the book is behind a named goal — {Math.round((c.adrift / (c.spokenFor + c.adrift)) * 100)}% of the money has never been given a purpose.</>}
        />
      </div>

      <h2 className="sec">Every goal, worst first <Explain figure={cov} /></h2>
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Client</th>
              <th style={{ textAlign: 'left' }}>Goal</th>
              <th className="r">Target</th><th>By</th>
              <th className="r">Has now</th><th className="r">Monthly</th>
              <th>Arrives</th><th>State</th>
            </tr>
          </thead>
          <tbody>
            <Collapse shown={8} noun="goals" as="rows" span={8} items={all.map(g => {
              const st = g.met ? 'reached' : g.monthsOff == null ? 'unreachable' : g.monthsOff > 0 ? 'late' : 'onTrack';
              return (
                <tr key={`${g.client_id}-${g.goal_id}`}>
                  <td><ClientLink id={g.client_id} name={g.client} /></td>
                  <td>
                    <Link href={`/clients/${g.client_id}?tab=goals&g=${g.goal_id}`}>{g.name}</Link>
                  </td>
                  <td className="r num">{inrCompact(g.target)}</td>
                  <td style={{ textAlign: 'center' }}>{dmy(g.on).slice(3)}</td>
                  <td className="r num">{inrCompact(g.now)}</td>
                  <td className="r num">{g.monthly > 0 ? inrCompact(g.monthly) : '—'}</td>
                  <td style={{ textAlign: 'center' }}>
                    {g.met ? 'now' : g.reachedOn ? dmy(g.reachedOn).slice(3) : '—'}
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={`fchip ${st === 'reached' || st === 'onTrack' ? 'lt' : st === 'late' ? 'conc' : 'atrisk'}`}>
                      {g.met ? 'Reached'
                        : g.monthsOff == null ? 'Not on this path'
                          : `${Math.abs(g.monthsOff)}m ${g.monthsOff > 0 ? 'late' : 'early'}`}
                    </span>
                  </td>
                </tr>
              );
            })} />
            {all.length === 0 && (
              <tr><td colSpan={8} className="empty">Nobody in this book has named a goal yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="d">
        <Explain teaser="How to read a goal that misses">
          A goal that will not arrive is not a bad fund — it is a target, a date and an instalment
          that were never reconciled with each other. All three are editable, and the client&apos;s
          own Goals tab prices each one in months: what ₹2,000 or ₹5,000 more a month buys back,
          drawn as a second line against the first.
        </Explain>
      </div>
    </>
  );
}
