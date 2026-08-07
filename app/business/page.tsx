import Link from 'next/link';
import { Provenance } from '../../components/Provenance';
import { StatCard } from '../../components/StatCard';
import { inr, inrCompact, signedInrCompact, dmy, dmy2 } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB, netFlowsMtd } from '../../lib/queries';
import {
  BUSINESS_RULES, bookNow, aumSeries, growth, sipBook, targets, targetHistory,
  wins, losses, monthPace,
} from '../../lib/business';

export const dynamic = 'force-dynamic';

const MONTH_LABEL = (m: string) =>
  new Date(m + 'T00:00:00Z').toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

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
  const maxAum = Math.max(...rows.map(m => m.peak_day_aum), 1);
  const maxFlow = Math.max(...rows.map(m => Math.abs(m.net_flows)), 1);
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const mom = prev ? last.month_end_aum - prev.month_end_aum : 0;
  const wonThisFy = won.value.filter(w => w.on >= '2026-04-01');
  const lostThisFy = lost.value.filter(w => w.on >= '2026-04-01');
  const attainment = tgt.value.length
    ? Math.round(tgt.value.reduce((s, t) => s + t.pct, 0) / tgt.value.length) : 0;

  return (
    <>
      <div className="pagehead">
        <h1>My business</h1>
        <span className="fresh">{me.name} · {dmy(TODAY)}</span>
      </div>
      <div className="denom">
        Your book grew <b>{signedInrCompact(g.value.closing - g.value.opening)}</b> over these{' '}
        {rows.length} months. <b className={g.value.flowsPct >= 50 ? 'up' : ''}>{g.value.flowsPct}%</b> of
        that came from money you brought in and <b>{g.value.marketPct}%</b> from the market moving.
        That split is the only honest way to read a growing book. <Provenance figure={g} />
      </div>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard
              label="Book today" value={inrCompact(book.value.aum)}
              sub={`${book.value.clients} clients · as of ${dmy2(book.value.as_of)}`}
              figure={book}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'month-end', amount: m.month_end_aum })), total: rows.length }}
            />
            <StatCard
              label="Month on month" value={signedInrCompact(mom)} tone={mom >= 0 ? 'pos' : 'warn'}
              sub={prev ? `vs ${inrCompact(prev.month_end_aum)} at end of ${MONTH_LABEL(prev.month)}` : '—'}
              figure={aum}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'net flows', amount: m.net_flows })), total: rows.length }}
            />
            <StatCard
              label="Net flows · Aug" value={signedInrCompact(flows.value.v)}
              tone={flows.value.v >= 0 ? 'pos' : 'warn'} sub={`${flows.value.n} transactions this month`}
              figure={flows}
              list={{ rows: rows.slice(-6).reverse().map(m => ({ label: MONTH_LABEL(m.month), detail: 'market movement', amount: m.market_movement })), total: rows.length }}
            />
            <StatCard
              label="Live SIP book" value={inrCompact(sip.value.monthly)}
              sub={`${sip.value.live} plans · ${inrCompact(sip.value.annual)} a year`}
              figure={sip}
              list={{ rows: [{ label: 'Committed monthly', detail: `${sip.value.live} live plans`, amount: sip.value.monthly }, { label: 'At risk — bounced ×2', detail: 'annualised', amount: sip.value.valueAtRisk }], total: 2 }}
            />
            <StatCard
              label="Bounce rate" value={`${sip.value.bounceRate}%`}
              tone={sip.value.bounceRate > 5 ? 'warn' : 'pos'}
              sub={`${sip.value.bounced} of ${sip.value.bounced + sip.value.instalments} instalments, ${BUSINESS_RULES.bounce_window_months}m`}
              figure={sip}
              list={{ rows: [{ label: 'Instalments collected', detail: 'last 6 months', amount: sip.value.instalments }, { label: 'Bounced', detail: 'type-33 rejections', amount: sip.value.bounced }, { label: 'Mandates expiring', detail: `within ${BUSINESS_RULES.mandate_expiry_days} days`, amount: sip.value.mandatesExpiring }], total: 3 }}
              listAmountKind="days"
            />
            <StatCard
              label="Won / lost · FY" value={`${wonThisFy.length} / ${lostThisFy.length}`}
              tone={wonThisFy.length >= lostThisFy.length ? 'pos' : 'warn'}
              sub={`${won.value.length} won, ${lost.value.length} lost in 14 months`}
              figure={lost}
              list={{ rows: lost.value.map(l => ({ label: l.name, detail: l.reason, amount: l.value })), total: lost.value.length }}
            />
          </div>

          <h2 className="sec">
            Where the book came from <Provenance figure={aum} />
          </h2>
          <div className="viz">
            <div className="axis">
              <span>{inrCompact(rows[0].peak_day_aum)} in {MONTH_LABEL(rows[0].month)}</span>
              <span>{inrCompact(last.peak_day_aum)} in {MONTH_LABEL(last.month)}</span>
            </div>
            <div className="aumchart">
              {rows.map(m => (
                <div key={m.month} className="acol" title={`${MONTH_LABEL(m.month)} · peak ${inrCompact(m.peak_day_aum)} on ${dmy2(m.peak_date)}`}>
                  <span className="abar" style={{ height: `${(m.peak_day_aum / maxAum) * 100}%` }} />
                </div>
              ))}
            </div>
            <div className="flowrow">
              {rows.map(m => (
                <div key={m.month} className="fcol" title={`${MONTH_LABEL(m.month)} · flows ${signedInrCompact(m.net_flows)} · market ${signedInrCompact(m.market_movement)}`}>
                  <span className={`fbar2 ${m.net_flows >= 0 ? 'pos' : 'neg'}`}
                    style={{ height: `${(Math.abs(m.net_flows) / maxFlow) * 100}%` }} />
                  <span className="fl">{MONTH_LABEL(m.month)}</span>
                </div>
              ))}
            </div>
            <div className="mark">
              Tall bars are <b>AUM</b>, on the {BUSINESS_RULES.aum_definition} definition the firm
              reports. Short bars underneath are <b>net flows</b> — money you actually moved that
              month. A rising line with flat flows means the market did the work.
            </div>
          </div>

          <h2 className="sec">The last {rows.length} months, split honestly <Provenance figure={g} /></h2>
          <div className="waterfall">
            <div className="wf"><span className="wl">Book at {MONTH_LABEL(g.value.from)}</span><span className="wa num">{inr(g.value.opening)}</span></div>
            <div className="wf"><span className="wl">Money you brought in<span className="wn">purchases and SIPs, less redemptions</span></span><span className="wa num up">{signedInrCompact(g.value.flows)}</span></div>
            <div className="wf"><span className="wl">Market movement<span className="wn">what the same money did on its own</span></span><span className={`wa num ${g.value.market >= 0 ? 'up' : 'down'}`}>{signedInrCompact(g.value.market)}</span></div>
            <div className="wf total"><span className="wl">Book today</span><span className="wa num">{inr(g.value.closing)}</span></div>
          </div>
          <div className="d">
            Opening + flows + market movement equals closing, to the rupee — the check runs on every
            month, so this split can never be a rounding story.
          </div>

          <h2 className="sec">
            Targets for {MONTH_LABEL(month)} <Provenance figure={tgt} />
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

          <div className="viz" style={{ marginTop: 14 }}>
            <h4>Lump-sum attainment, month by month <Provenance figure={hist} /></h4>
            <div className="hist wide">
              {hist.value.map(h => (
                <div key={h.month} className={`col${h.pct >= 100 ? '' : ' neg'}`} title={`${MONTH_LABEL(h.month)} · ${h.pct}%`}>
                  <span className="n num">{h.pct}%</span>
                  <span className="bar" style={{ height: `${Math.min(100, (h.pct / 150) * 100)}%` }} />
                  <span className="b">{MONTH_LABEL(h.month)}</span>
                </div>
              ))}
            </div>
            <div className="mark">
              Bars cap at 150%. The current month is still running, so its bar is partial by
              definition, not a miss.
            </div>
          </div>

          <h2 className="sec">Clients won and lost — every one named</h2>
          <div className="winlose">
            <div>
              <h4 className="wlh up">Won · {won.value.length} <Provenance figure={won} /></h4>
              <div className="tblwrap">
                <table>
                  <thead><tr><th style={{ textAlign: 'left' }}>Client</th><th>First invested</th><th className="r">Worth today</th></tr></thead>
                  <tbody>
                    {won.value.map(w => (
                      <tr key={w.client_id}>
                        <td><Link href={`/clients/${w.client_id}`}>{w.name}</Link></td>
                        <td style={{ textAlign: 'center' }}>{dmy2(w.on)}</td>
                        <td className="r num">{inrCompact(w.value)}</td>
                      </tr>
                    ))}
                    {won.value.length === 0 && <tr><td colSpan={3} className="empty">No new clients in the window.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <h4 className="wlh down">Lost · {lost.value.length} <Provenance figure={lost} /></h4>
              <div className="tblwrap">
                <table>
                  <thead><tr><th style={{ textAlign: 'left' }}>Client</th><th>Left</th><th style={{ textAlign: 'left' }}>Why</th><th className="r">Took out</th></tr></thead>
                  <tbody>
                    {lost.value.map(l => (
                      <tr key={l.client_id}>
                        <td><Link href={`/clients/${l.client_id}`}>{l.name}</Link></td>
                        <td style={{ textAlign: 'center' }}>{dmy2(l.on)}</td>
                        <td>{l.reason}</td>
                        <td className="r num down">{inrCompact(l.value)}</td>
                      </tr>
                    ))}
                    {lost.value.length === 0 && <tr><td colSpan={4} className="empty">Nobody has left.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="d">
            Lost means they transferred to another distributor or redeemed everything. A client who
            has gone quiet is <b>not</b> counted here — they are still yours to save, and they are on{' '}
            <Link href="/today">Today</Link> as an action.
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Which AUM number is this?</h3>
            <div className="d">
              The headline monthly figure is <b>{BUSINESS_RULES.aum_definition}</b> — the definition
              the firm reports on. Month-end sits beside it in the data because only month-end makes
              opening + flows + market add up exactly.
              <br /><br />
              Peak {MONTH_LABEL(last.month)}: <b>{inrCompact(last.peak_day_aum)}</b> on{' '}
              {dmy2(last.peak_date)} · month-end <b>{inrCompact(last.month_end_aum)}</b>.
            </div>
          </div>

          <div className="panel">
            <h3>SIP book <Provenance figure={sip} /></h3>
            <div className="d">
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
            </div>
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
