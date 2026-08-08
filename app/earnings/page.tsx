import Link from 'next/link';
import { PageGuide } from '../../components/PageGuide';
import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { Explain } from '../../components/Explain';
import { StatCard } from '../../components/StatCard';
import { inr, inrExact, inrCompact, dmy, dmy2, monthLabel as MONTH_LABEL } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { broker, DEMO_SB } from '../../lib/queries';
import {
  EARNINGS_RULES, THIS_MONTH, months, ladder, tierStep, series, byClient, clientLines,
  byScheme, clawbacks, variance, invoices, fyTracker, disputes, emptyBuckets, shortPaidRowIds,
} from '../../lib/earnings';
import { raiseDispute } from './actions';

export const dynamic = 'force-dynamic';

export default async function EarningsPage({ searchParams }: PageProps<'/earnings'>) {
  const sp = await searchParams;
  const all = months(DEMO_SB);
  const month = typeof sp.m === 'string' && all.includes(sp.m) ? sp.m : all[0] ?? THIS_MONTH;
  const openClient = typeof sp.c === 'string' ? Number(sp.c) : null;

  const me = broker();
  const lad = ladder(DEMO_SB, month);
  const tier = tierStep(DEMO_SB, month);
  const hist = series(DEMO_SB);
  const clients = byClient(DEMO_SB, month);
  const schemes = byScheme(DEMO_SB, month);
  const claw = clawbacks(DEMO_SB);
  const varr = variance(DEMO_SB);
  const invs = invoices(DEMO_SB);
  const fy = fyTracker(DEMO_SB);
  const disp = disputes(DEMO_SB);
  const empty = emptyBuckets(DEMO_SB);

  const l = lad.value;
  const isOpenMonth = month === THIS_MONTH;
  // The running month has an invoice row but has not been raised yet — counting it
  // as "unpaid" would contradict the ladder, which correctly calls it still open.
  const unpaid = invs.value.filter(i => !i.payment_date && i.period_start_date < THIS_MONTH);
  const shortfall = varr.value.reduce((s, v) => s + v.shortfall, 0);
  const maxNet = Math.max(...hist.value.map(p => p.net), 1);
  // Yield on the money he actually looks after — his economics, not the firm's.
  const yieldBps = l.aum > 0 ? (l.trail * 12 / l.aum) * 10000 : 0;
  const link = (m: string, c?: number | null) =>
    `/earnings?m=${m}${c ? `&c=${c}` : ''}`;

  const rungs: { label: string; note: string; amount: number; sign: '+' | '−' | '' }[] = [
    { label: 'Trail on your book', note: `${l.lines} commission lines across ${inrCompact(l.aum)} of client money`, amount: l.trail, sign: '' },
    ...(l.clawback !== 0 ? [{ label: 'Clawback', note: 'trail returned on clients who exited inside a year', amount: l.clawback, sign: '' as const }] : []),
    ...(l.hasGst
      ? [{ label: `GST @ ${EARNINGS_RULES.gst_pct}%`, note: 'you are GST-registered, so this is added and you remit it', amount: l.gst, sign: '+' as const }]
      : [{ label: 'GST', note: 'not registered, so no GST is added', amount: 0, sign: '' as const }]),
    { label: `TDS @ ${EARNINGS_RULES.tds_pct}%`, note: 'deducted at source and credited against your PAN', amount: -l.tds, sign: '−' },
  ];

  return (
    <>
      <PageHead title="Earnings" icon="money"
        question="What am I being paid, and can I prove every rupee of it?"
        meta={`${me.name} · ${dmy(TODAY)}`}
      />
      <PageGuide lines={`${l.lines} commission lines this month · click any client for the rows the RTA sent`}>
        <p>
          Every rupee here is traced to the folio and the month that produced it — separate
          commission lines, not one number split up afterwards.
        </p>
      </PageGuide>

      <div className="cols">
        <div>
          <div className="cards six">
            <StatCard id="payout_net" icon="money"
              label={`Net · ${MONTH_LABEL(month)}`} value={inr(l.net)} tone="pos"
              sub={isOpenMonth ? 'month still open — not yet invoiced' : 'invoiced'}
              figure={lad}
              list={{ rows: clients.value.slice(0, 10).map(c => ({ label: c.name, detail: `${c.lines} lines`, amount: c.payout })), total: clients.value.length }}
            />
            <StatCard id="payout_net" icon="calendar"
              label="FY 26-27 to date" value={inr(fy.value?.cumulative_payout ?? 0)}
              sub={fy.value?.threshold_crossed ? 'threshold crossed' : `threshold at ${inrCompact(EARNINGS_RULES.fy_threshold)}`}
              figure={fy}
              list={{ rows: hist.value.filter(p => p.month >= '2026-04-01').map(p => ({ label: MONTH_LABEL(p.month), detail: 'net paid out', amount: p.net })), total: hist.value.filter(p => p.month >= '2026-04-01').length }}
            />
            <StatCard id="payout_net" icon="clock"
              label="Awaiting payment" value={`${unpaid.length}`} tone={unpaid.length > 1 ? 'warn' : 'plain'}
              sub={unpaid.length ? `${inrCompact(unpaid.reduce((s, i) => s + i.total_amount, 0))} invoiced, unpaid` : 'all invoices settled'}
              figure={invs}
              list={{ rows: unpaid.map(i => ({ label: i.invoice_no, detail: MONTH_LABEL(i.period_start_date), amount: i.total_amount })), total: unpaid.length }}
            />
            <StatCard id="clawback" icon="down"
              label="Clawbacks" value={inr(Math.abs(claw.value.reduce((s, c) => s + c.amount, 0)))}
              tone={claw.value.length ? 'warn' : 'plain'} sub={`${claw.value.length} early exits, last 14 months`}
              figure={claw}
              list={{ rows: claw.value.map(c => ({ label: c.client, detail: `held ${c.held_days}d · ${MONTH_LABEL(c.month)}`, amount: c.amount })), total: claw.value.length }}
            />
            <StatCard id="tier_rate" icon="target"
              label="Yield on your book" value={`${yieldBps.toFixed(0)} bps`}
              sub={`${inrCompact(l.aum)} earning at your ${l.tierPct}% rate`}
              figure={lad}
              list={{ rows: schemes.value.slice(0, 10).map(s => ({ label: s.scheme, detail: s.amc, amount: s.payout })), total: schemes.value.length }}
            />
            <StatCard id="amc_variance" icon="alert"
              label="Short-paid by AMCs" value={inr(Math.abs(shortfall))} tone={shortfall < 0 ? 'warn' : 'plain'}
              sub={varr.value.length ? `${varr.value.length} rate mismatch vs agreement` : 'every rate matches the card'}
              figure={varr}
              list={{ rows: varr.value.map(v => ({ label: v.amc, detail: `${v.paid_bps} vs ${v.agreed_bps} bps`, amount: v.shortfall })), total: varr.value.length }}
            />
          </div>

          <h2 className="sec">How {MONTH_LABEL(month)} became {inr(l.net)}</h2>
          <div className="ladderrow">
            <div className="ladder">
              {rungs.map(rg => (
                <div key={rg.label} className={`rung${rg.amount < 0 ? ' neg' : ''}`}>
                  <span className="rl">{rg.label}<span className="rn">{rg.note}</span></span>
                  <span className="ra num">{rg.sign === '+' ? '+' : ''}{inrExact(rg.amount)}</span>
                </div>
              ))}
              <div className="rung total">
                <span className="rl">Net into your account<span className="rn">{isOpenMonth ? 'once this month is invoiced and paid' : `paid ${dmy2(invs.value.find(i => i.period_start_date === month)?.payment_date ?? month)}`}</span></span>
                <span className="ra num">{inrExact(l.net)}</span>
              </div>
            </div>

            <div className="viz">
              <h4>Your rate <Explain figure={tier} /></h4>
              <div className="tiernow">
                <b>{tier.value.current.name}</b> · you keep <b>{tier.value.current.pct}%</b> of the trail
                your book earns.
              </div>
              {tier.value.next ? (
                <div className="tiernext">
                  Next rung is <b>{tier.value.next.name}</b> at <b>{tier.value.next.pct}%</b>. On this
                  month&apos;s book that is <b className="up">{inrExact(tier.value.upliftPerMonth)}</b> more,
                  every month.
                </div>
              ) : <div className="tiernext">You are on the top rung.</div>}
              <Explain>
                Rates come from <code>broker_category_payout_pct_master</code> — the same table
                management edits, so what you see here is what the payout run uses.
              </Explain>
            </div>
          </div>

          <h2 className="sec">Fourteen months <Explain figure={hist} /></h2>
          <div className="viz">
            <div className="hist wide">
              {hist.value.map(p => (
                <Link key={p.month} href={link(p.month)} className={`col${p.month === month ? ' on' : ''}`} title={`${MONTH_LABEL(p.month)} · ${inrExact(p.net)}`}>
                  <span className="n num">{Math.round(p.net / 1000)}k</span>
                  <span className="bar" style={{ height: `${(p.net / maxNet) * 100}%` }} />
                  <span className="b">{MONTH_LABEL(p.month)}</span>
                </Link>
              ))}
            </div>
            <Explain>Net of GST and TDS. Click a month to re-read the whole page for it.</Explain>
          </div>

          <h2 className="sec">
            Where {MONTH_LABEL(month)} came from <Explain figure={clients} />
          </h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Client</th>
                  <th className="r">Their money</th><th className="r">Lines</th>
                  <th className="r">Your commission</th><th className="r">Clawback</th><th />
                </tr>
              </thead>
              <tbody>
                <Collapse shown={6} noun="clients" as="rows" span={6} items={clients.value.map(c => {
                  const open = openClient === c.client_id;
                  return (
                    <tr key={c.client_id} className={open ? 'openrow' : undefined}>
                      <td><ClientLink id={c.client_id} name={c.name} /></td>
                      <td className="r num">{inrCompact(c.aum)}</td>
                      <td className="r num">{c.lines}</td>
                      <td className="r num valbar" style={{ '--w': (c.payout / (clients.value[0]?.payout || 1)) * 100 } as React.CSSProperties}>
                        {inrExact(c.payout)}
                      </td>
                      <td className="r num">{c.clawback ? inrExact(c.clawback) : '—'}</td>
                      <td className="rowacts always">
                        <Link href={open ? link(month) : link(month, c.client_id)}>
                          {open ? 'hide lines' : 'show lines'}
                        </Link>
                      </td>
                    </tr>
                  );
                })} />
                {openClient != null && clientLines(DEMO_SB, month, openClient).map(fl => (
                  <tr key={fl.bkr_id} className="lotrow">
                    <td colSpan={2}>
                      ↳ {fl.scheme} <span className="sub">{fl.amc}</span>
                    </td>
                    <td className="r">folio {fl.folio_no}</td>
                    <td className="r num">
                      {inrCompact(fl.aum)} @ {fl.paid_pct}%
                      {fl.reco_status === 2 && <span className="fchip atrisk">under card</span>}
                    </td>
                    <td className="r num">{inrExact(fl.payout)}</td>
                    <td className="r">{fl.type}</td>
                  </tr>
                ))}
                {clients.value.length === 0 && (
                  <tr><td colSpan={6} className="empty">No commission recorded for this month.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td>{clients.value.length} clients</td>
                  <td className="r num">{inrCompact(l.aum)}</td>
                  <td className="r num">{l.lines}</td>
                  <td className="r num">{inrExact(l.trail)}</td>
                  <td className="r num">{l.clawback ? inrExact(l.clawback) : '—'}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <h2 className="sec">Clawbacks, and what caused each one <Explain figure={claw} /></h2>
          {claw.value.length === 0 && <div className="empty">No clawbacks in the last 14 months.</div>}
          {claw.value.map(c => (
            <div key={c.bkr_id} className="rec">
              <div className="rtop">
                <b>{inrExact(c.amount)}</b>
                <span className="d">{MONTH_LABEL(c.month)} · folio {c.folio_no}</span>
                <span className="delta" style={{ color: 'var(--neg)' }}>held {c.held_days} days</span>
              </div>
              <p className="plain">
                <ClientLink id={c.client_id} name={c.client} /> redeemed{' '}
                {inrCompact(c.redeemed_amount)} from {c.scheme} on {dmy2(c.redeemed_on)} —{' '}
                {c.held_days} days after the folio opened, inside the{' '}
                {EARNINGS_RULES.clawback_window_days}-day window. The trail already paid on that
                money came back.
              </p>
              <p className="askfor">
                <b>Traced to:</b> transaction on {dmy2(c.redeemed_on)}. No clawback on this page is
                unexplained — each one names the redemption that triggered it.
              </p>
            </div>
          ))}

          <h2 className="sec">What the AMC paid vs what was agreed <Explain figure={varr} /></h2>
          {varr.value.length === 0 ? (
            <div className="empty">Every rate paid matches the agreed rate card.</div>
          ) : (
            <>
              <div className="tblwrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>AMC</th><th>Class</th>
                      <th className="r">Agreed</th><th className="r">Paid</th><th className="r">Gap</th>
                      <th className="r">Months</th><th className="r">Cost to you</th>
                      <th style={{ textAlign: 'left' }}>Agreement</th>
                    </tr>
                  </thead>
                  <tbody>
                    {varr.value.map(v => (
                      <tr key={v.amc + v.scheme_category}>
                        <td>{v.amc}</td>
                        <td style={{ textAlign: 'center' }}>{v.scheme_category}</td>
                        <td className="r num">{v.agreed_bps} bps</td>
                        <td className="r num">{v.paid_bps} bps</td>
                        <td className="r num down">−{v.agreed_bps - v.paid_bps} bps</td>
                        <td className="r num">{v.months} · since {MONTH_LABEL(v.since)}</td>
                        <td className="r num down">{inrExact(v.shortfall)}</td>
                        <td><code>{v.doc}</code></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <form action={raiseDispute} className="disputeform">
                <input type="hidden" name="rows" value={shortPaidRowIds(DEMO_SB).join(',')} />
                <input type="text" name="reason" required
                  defaultValue={`${varr.value[0].amc} has paid ${varr.value[0].paid_bps} bps on ${varr.value[0].scheme_category.toLowerCase()} since ${MONTH_LABEL(varr.value[0].since)}, against ${varr.value[0].agreed_bps} bps in the empanelment letter.`} />
                <button type="submit" className="primary">Raise a dispute</button>
              </form>
              <Explain>
                The dispute carries the exact commission rows, not a description of them, and lands
                in the ops queue with a five-day deadline you can watch on Today.
              </Explain>
            </>
          )}

          {disp.length > 0 && (
            <div className="tblwrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Dispute</th><th>Raised</th><th>Rows</th>
                    <th>State</th><th style={{ textAlign: 'left' }}>Outcome</th><th>In the queue</th>
                  </tr>
                </thead>
                <tbody>
                  {disp.map(d => (
                    <tr key={d.dispute_id}>
                      <td>{d.reason}</td>
                      <td style={{ textAlign: 'center' }}>{dmy2(d.raised_at)}</td>
                      <td style={{ textAlign: 'center' }} className="num">{d.rows}</td>
                      <td style={{ textAlign: 'center' }}><span className={`fchip ${d.state === 'open' ? 'conc' : 'lt'}`}>{d.state}</span></td>
                      <td>{d.resolution_note ?? '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        {d.action_id ? <Link href={`/today?action=${d.action_id}`} className="hchip">#{d.action_id}</Link> : <span className="hchip">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 className="sec">Invoices <Explain figure={invs} /></h2>
          <div className="tblwrap">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Invoice</th><th>Period</th><th className="r">Lines</th>
                  <th className="r">Commission</th><th className="r">CGST</th><th className="r">SGST</th>
                  <th className="r">TDS</th><th className="r">Total</th><th>Paid</th>
                </tr>
              </thead>
              <tbody>
                <Collapse shown={6} noun="invoices" as="rows" span={9} items={invs.value.map(i => (
                  <tr key={i.invoice_id}>
                    <td><Link href={link(i.period_start_date)}>{i.invoice_no}</Link></td>
                    <td style={{ textAlign: 'center' }}>{MONTH_LABEL(i.period_start_date)}</td>
                    <td className="r num">{i.lines}</td>
                    <td className="r num">{inrExact(i.sub_total)}</td>
                    <td className="r num">{inrExact(i.cgst)}</td>
                    <td className="r num">{inrExact(i.sgst)}</td>
                    <td className="r num">{inrExact(i.tds)}</td>
                    <td className="r num">{inrExact(i.total_amount)}</td>
                    <td style={{ textAlign: 'center' }}>
                      {i.payment_date
                        ? <span className="hchip ok">{dmy2(i.payment_date)}</span>
                        : i.period_start_date >= THIS_MONTH
                          ? <span className="fchip stale">month still open</span>
                          : <span className="fchip conc">awaiting payment</span>}
                    </td>
                  </tr>
                ))} />
              </tbody>
            </table>
          </div>
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Financial year <Explain figure={fy} /></h3>
            <div className="big num">{inr(fy.value?.cumulative_payout ?? 0)}</div>
            <Explain>
              FY {fy.value?.financial_year ?? '26-27'} commission, before GST and TDS.
              <span className="bar2" style={{ display: 'block', margin: '8px 0' }}>
                <i style={{ width: `${Math.min(100, ((fy.value?.cumulative_payout ?? 0) / EARNINGS_RULES.fy_threshold) * 100)}%` }} />
              </span>
              {fy.value?.threshold_crossed
                ? `Crossed the ${inrCompact(EARNINGS_RULES.fy_threshold)} mark in ${fy.value.crossing_month ? MONTH_LABEL(fy.value.crossing_month) : 'this year'}.`
                : `${inrCompact(EARNINGS_RULES.fy_threshold - (fy.value?.cumulative_payout ?? 0))} below the ${inrCompact(EARNINGS_RULES.fy_threshold)} mark.`}
            </Explain>
          </div>

          <div className="panel">
            <h3>Why two buckets are empty</h3>
            <Explain>
              {empty.length === 0 ? 'Every commission type has rows.' : (
                <>
                  <b>{empty.join(' and ')}</b> carry no rows, and that is correct: SEBI ended
                  upfront commission on regular mutual-fund plans in 2018. Your earnings are trail
                  and clawback only. The buckets stay in the backend because the ledger they came
                  from still has them — they are not hidden, just empty.
                </>
              )}
            </Explain>
          </div>

          <div className="panel">
            <h3>What this page cannot see <Explain>The AMC&apos;s own working. We hold what they paid and what the empanelment letter
              agreed, so a gap is provable — but not <i>why</i> they paid less. That answer comes
              from the AMC, which is what a dispute is for.</Explain></h3>
          </div>
        </aside>
      </div>
    </>
  );
}
