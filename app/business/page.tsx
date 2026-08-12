import Link from 'next/link';
import { Explain } from '../../components/Explain';
import { PageGuide } from '../../components/PageGuide';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';

import { StatCard } from '../../components/StatCard';
import { ChartBars, ChartLines } from '../../components/charts';
import { inr, inrCompact, signedInrCompact, dmy, dmy2, monthLabel as MONTH_LABEL } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB, netFlowsMtd } from '../../lib/queries';
import {
  BUSINESS_RULES, bookNow, aumSeries, growth, sipBook, targets, targetHistory,
  wins, losses, monthPace,
} from '../../lib/business';

export const dynamic = 'force-dynamic';

export default function BusinessPage() {
  const me = broker();
  const month = TODAY.slice(0, 7) + '-01';
  const book = bookNow(DEMO_SB);
  const aum = aumSeries(DEMO_SB);
  const g = growth(DEMO_SB);
  const sip = sipBook(DEMO_SB);
  const tgt = targets(DEMO_SB, month);
  const hist = targetHistory(DEMO_SB);
  const won = wins(DEMO_SB);
  const lost = losses(DEMO_SB);
  const flows = netFlowsMtd();
  const pace = monthPace(month);

  const rows = aum.value;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const mom = prev ? last.month_end_aum - prev.month_end_aum : 0;
  const wonThisFy = won.value.filter(w => w.on >= '2026-04-01');
  const lostThisFy = lost.value.filter(w => w.on >= '2026-04-01');
  const attainment = tgt.value.length
    ? Math.round(tgt.value.reduce((s, t) => s + t.pct, 0) / tgt.value.length) : 0;

  // Shaped for the plots. Both AUM measures ride one axis because they are the
  // same unit answering the same question; flows and market get their own chart
  // because they are two orders of magnitude smaller than the book they moved.
  const series = rows.map(m => ({
    m: MONTH_LABEL(m.month), peak: m.peak_day_aum, close: m.month_end_aum,
    flows: m.net_flows, market: m.market_movement,
  }));
  // How far apart the two AUM definitions actually run, measured rather than
  // asserted — it is the reason the page carries both.
  const peakPremium = (
    (rows.reduce((s2, m) => s2 + (m.peak_day_aum / m.month_end_aum - 1), 0) / rows.length) * 100
  ).toFixed(1);
  const attain = hist.value.map(h => ({
    m: MONTH_LABEL(h.month), pct: h.pct, tone: h.pct >= 100 ? 'green' : 'amber',
  }));

  return (
    <>
      <PageHead
        title="Growth" icon="up"
        question="Is my book growing because of me, or because the market went up?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <PageGuide lines={`Book grew ${signedInrCompact(g.value.closing - g.value.opening)} over ${rows.length} months · ${g.value.flowsPct}% you brought in, ${g.value.marketPct}% the market`}>
        <p>
          That split is the only honest way to read a growing book: money you raised is work you
          did, money the market added is not. A book can grow while the broker does nothing.
        </p>
      </PageGuide>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard hero id="book_today" icon="money"
              label="Book today" value={inrCompact(book.value.aum)}
              sub={`${book.value.clients} clients · as of ${dmy2(book.value.as_of)}`}
              figure={book}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'month-end', amount: m.month_end_aum })), total: rows.length }}
            />
            <StatCard id="aum_peak_day" icon="up"
              label="Month on month" value={signedInrCompact(mom)} tone={mom >= 0 ? 'pos' : 'warn'}
              sub={prev ? `vs ${inrCompact(prev.month_end_aum)} at end of ${MONTH_LABEL(prev.month)}` : '—'}
              figure={aum}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'net flows', amount: m.net_flows })), total: rows.length }}
            />
            <StatCard id="net_flows_mtd" icon="arrow"
              label="Net flows · Aug" value={signedInrCompact(flows.value.v)}
              tone={flows.value.v >= 0 ? 'pos' : 'warn'} sub={`${flows.value.n} transactions this month`}
              figure={flows}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'market movement', amount: m.market_movement })), total: rows.length }}
            />
            <StatCard id="sips_at_risk" icon="calendar"
              label="Live SIP book" value={inrCompact(sip.value.monthly)}
              sub={`${sip.value.live} plans · ${inrCompact(sip.value.annual)} a year`}
              figure={sip}
              list={{ rows: [{ label: 'Committed monthly', detail: `${sip.value.live} live plans`, amount: sip.value.monthly }, { label: 'At risk — bounced ×2', detail: 'annualised', amount: sip.value.valueAtRisk }], total: 2 }}
            />
            <StatCard id="sip_bounce_rate" icon="alert"
              label="Bounce rate" value={`${sip.value.bounceRate}%`}
              tone={sip.value.bounceRate > 5 ? 'warn' : 'pos'}
              sub={`${sip.value.bounced} of ${sip.value.bounced + sip.value.instalments} instalments, ${BUSINESS_RULES.bounce_window_months}m`}
              figure={sip}
              list={{ rows: [{ label: 'Instalments collected', detail: 'last 6 months', amount: sip.value.instalments }, { label: 'Bounced', detail: 'type-33 rejections', amount: sip.value.bounced }, { label: 'Mandates expiring', detail: `within ${BUSINESS_RULES.mandate_expiry_days} days`, amount: sip.value.mandatesExpiring }], total: 3 }}
              listAmountKind="days"
            />
            <StatCard id="clients_won_lost" icon="users"
              label="Won / lost · FY" value={`${wonThisFy.length} / ${lostThisFy.length}`}
              tone={wonThisFy.length >= lostThisFy.length ? 'pos' : 'warn'}
              sub={`${won.value.length} won, ${lost.value.length} lost in 14 months`}
              figure={lost}
              list={{ rows: lost.value.map(l => ({ label: l.name, client_id: l.client_id, detail: l.reason, amount: l.value })), total: lost.value.length }}
            />
          </div>

          <h2 className="sec">
            Where the book came from <Explain id="aum_peak_day" figure={aum} />
          </h2>
          {/* Two plots, not one with two scales. AUM is in crores and a month's
              flows are in lakhs; on a shared axis the flows flatten to nothing and
              the chart quietly argues that the broker did no work at all. */}
          <div className="charts">
            <ChartLines
              title="What the book was worth" height={230} unit="inr" baseline="data"
              xLabel="month" yLabel="AUM"
              source={`aum_snapshot — peak-day and month-end, ${BUSINESS_RULES.aum_definition} definition`}
              data={series} xKey="m"
              series={[
                { key: 'peak', name: 'Peak day in the month', tone: 's1' },
                { key: 'close', name: 'Month end', tone: 'blue' },
              ]}
              mark={<>{inrCompact(rows[0].peak_day_aum)} in {MONTH_LABEL(rows[0].month)} to {inrCompact(last.peak_day_aum)} in {MONTH_LABEL(last.month)}. The two definitions run <b>{peakPremium}%</b> apart.</>}
              aside={<Explain id="aum_peak_day" figure={aum} teaser="Two lines, and a non-zero axis">
                The firm reports peak-day AUM; the growth split below is computed on month-end.
                Both are drawn so the gap between them is visible rather than argued about. The
                axis starts at the data rather than at zero for the same reason — on a zero
                baseline a {peakPremium}% gap collapses and the chart claims one measure where
                there are two. Lines may do that because they encode position; the bars beside
                them may not, because a bar encodes length from zero.
              </Explain>}
            />
            <ChartBars
              title="What moved it: your money against the market" height={230} unit="inr"
              xLabel="month" yLabel="₹ change"
              source="transaction_master net flows vs derived market movement, by month"
              data={series} xKey="m"
              series={[
                { key: 'flows', name: 'Money you brought in', tone: 'green', stack: 'chg' },
                { key: 'market', name: 'What the market added', tone: 's4', stack: 'chg' },
              ]}
              mark={<>The two stack to the month&apos;s whole change, so a tall bar made only of the second colour is a month the market carried. Over {rows.length} months it was <b>{g.value.flowsPct}%</b> you and <b>{g.value.marketPct}%</b> the market.</>}
              aside={<Explain>
                Net flows are purchases and SIPs less redemptions — money that actually moved.
                Market movement is what the same money did on its own, derived as the residual, so
                opening + flows + market equals closing to the rupee on every month.
              </Explain>}
            />
          </div>

          <h2 className="sec">The last {rows.length} months, split honestly <Explain id="growth_split" figure={g} /></h2>
          <div className="waterfall">
            <div className="wf"><span className="wl">Book at {MONTH_LABEL(g.value.from)}</span><span className="wa num">{inr(g.value.opening)}</span></div>
            <div className="wf"><span className="wl">Money you brought in<span className="wn">purchases and SIPs, less redemptions</span></span><span className="wa num up">{signedInrCompact(g.value.flows)}</span></div>
            <div className="wf"><span className="wl">Market movement<span className="wn">what the same money did on its own</span></span><span className={`wa num ${g.value.market >= 0 ? 'up' : 'down'}`}>{signedInrCompact(g.value.market)}</span></div>
            <div className="wf total"><span className="wl">Book today</span><span className="wa num">{inr(g.value.closing)}</span></div>
          </div>
          <Explain>
            Opening + flows + market movement equals closing, to the rupee — the check runs on every
            month, so this split can never be a rounding story.
          </Explain>

          <h2 className="sec">
            Targets for {MONTH_LABEL(month)} <Explain id="target_attainment" figure={tgt} />
          </h2>
          <div className="d" style={{ marginBottom: 10 }}>
            Day {pace.elapsed} of {pace.days}. The faint mark on each bar is where you would be if
            the month landed evenly — a target is not missed on the {pace.elapsed}th.
          </div>
          {tgt.value.length === 0 && <div className="empty">No target set for this month.</div>}
          {tgt.value.map(t => {
            const onPace = t.actual >= t.target * pace.fraction;
            return (
              <div key={t.key} className="tgt">
                <span className="tl">{t.label}</span>
                <span className="tb">
                  <i style={{ width: `${Math.min(100, t.pct)}%` }} className={onPace ? 'ok' : 'behind'} />
                  <b style={{ left: `${Math.min(100, pace.fraction * 100)}%` }} />
                </span>
                <span className="tv num">
                  {t.kind === 'money' ? inrCompact(t.actual) : t.actual} of{' '}
                  {t.kind === 'money' ? inrCompact(t.target) : t.target}
                </span>
                <span className={`tp num ${onPace ? 'up' : 'down'}`}>{t.pct}%</span>
              </div>
            );
          })}

          <ChartBars
            title="Lump-sum attainment, month by month" height={215} unit="pct"
            xLabel="month" yLabel="% of target"
            source="sb_target_master vs achieved, by month"
            data={attain} xKey="m"
            series={[{ key: 'pct', name: 'Attainment', tone: 'green' }]}
            toneKey="tone"
            keyItems={[{ name: 'target met', tone: 'green' }, { name: 'short', tone: 'amber' }]}
            mark={<><b>{hist.value.filter(h => h.pct >= 100).length}</b> of {hist.value.length} months hit the number. The last bar is the month still running, so it is partial by definition rather than a miss.</>}
            aside={<Explain id="target_attainment" figure={hist} />}
          />

          <h2 className="sec">Clients won and lost — every one named</h2>
          <div className="winlose">
            <div>
              <h4 className="wlh up">Won · {won.value.length} <Explain id="clients_won_lost" figure={won} /></h4>
              <div className="tblwrap">
                <table>
                  <thead><tr><th style={{ textAlign: 'left' }}>Client</th><th>First invested</th><th className="r">Worth today</th></tr></thead>
                  <tbody>
                    <Collapse span={3} noun="clients" as="rows" items={won.value.map(w => (
                      <tr key={w.client_id}>
                        <td><ClientLink id={w.client_id} name={w.name} /></td>
                        <td style={{ textAlign: 'center' }}>{dmy2(w.on)}</td>
                        <td className="r num">{inrCompact(w.value)}</td>
                      </tr>
                    ))} />
                    {won.value.length === 0 && <tr><td colSpan={3} className="empty">No new clients in the window.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="wlh down">Lost · {lost.value.length} <Explain id="clients_won_lost" figure={lost} /></h4>
              <div className="tblwrap">
                <table>
                  <thead><tr><th style={{ textAlign: 'left' }}>Client</th><th>Left</th><th style={{ textAlign: 'left' }}>Why</th><th className="r">Took out</th></tr></thead>
                  <tbody>
                    <Collapse span={4} noun="clients" as="rows" items={lost.value.map(l => (
                      <tr key={l.client_id}>
                        <td><ClientLink id={l.client_id} name={l.name} /></td>
                        <td style={{ textAlign: 'center' }}>{dmy2(l.on)}</td>
                        <td>{l.reason}</td>
                        <td className="r num down">{inrCompact(l.value)}</td>
                      </tr>
                    ))} />
                    {lost.value.length === 0 && <tr><td colSpan={4} className="empty">Nobody has left.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <Explain>
            Lost means they transferred to another distributor or redeemed everything. A client who
            has gone quiet is <b>not</b> counted here — they are still yours to save, and they are on{' '}
            <Link href="/today">Today</Link> as an action.
          </Explain>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Which AUM number is this?</h3>
            <Explain>
              The headline monthly figure is <b>{BUSINESS_RULES.aum_definition}</b> — the definition
              the firm reports on. Month-end sits beside it in the data because only month-end makes
              opening + flows + market add up exactly.
              <br /><br />
              Peak {MONTH_LABEL(last.month)}: <b>{inrCompact(last.peak_day_aum)}</b> on{' '}
              {dmy2(last.peak_date)} · month-end <b>{inrCompact(last.month_end_aum)}</b>.
            </Explain>
          </div>

          <div className="panel">
            <h3>SIP book <Explain id="sip_bounce_rate" figure={sip} /></h3>
            <Explain>
              <b>{sip.value.live}</b> live plans committing <b>{inrCompact(sip.value.monthly)}</b> a
              month. Bounce rate <b>{sip.value.bounceRate}%</b> over{' '}
              {BUSINESS_RULES.bounce_window_months} months.
              {sip.value.mandatesExpiring > 0 && (
                <>
                  <br /><br />
                  <b>{sip.value.mandatesExpiring}</b> mandate{sip.value.mandatesExpiring === 1 ? '' : 's'}{' '}
                  expire within {BUSINESS_RULES.mandate_expiry_days} days — those are already actions
                  on <Link href="/today">Today</Link>, not a number to admire here.
                </>
              )}
            </Explain>
          </div>

          <div className="panel learn">
            <h3>What this page cannot see</h3>
            <div className="d ghosttxt">
              Why a client left. The ledger records the transfer-out and the redemption; it does not
              record the conversation. Until an exit reason is captured at the point of leaving, the
              &ldquo;why&rdquo; column says what happened, not why it happened.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
