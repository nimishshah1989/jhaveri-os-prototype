import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, dmy } from '../../../lib/format';
import { myOrders, liveSips } from '../../../lib/invest';
import { plans } from '../../../lib/exec';
import { mandates, MANDATE_RULES } from '../../../lib/mandate';
import { ME } from '../layout';
import { stopSip, setStepUp, endPlan, renewTheMandate } from '../invest/actions';

export const dynamic = 'force-dynamic';

/** What each state means to a person, rather than to the exchange. */
const PLAIN: Record<string, string> = {
  RECEIVED: 'We have it',
  SENT_TO_EXCHANGE: 'With the exchange',
  ALLOTTED: 'Units in your folio',
  PLACED: 'Placed',
  PENDING: 'Waiting on the exchange',
  REJECTED: 'Refused — nothing moved',
};

export default async function Orders({ searchParams }: PageProps<'/me/orders'>) {
  const q = await searchParams;
  const justPlaced = typeof q.placed === 'string' ? Number(q.placed) : null;
  const justStarted = q.started === '1';
  // One place that turns a redirect into a sentence, so a new instrument does
  // not arrive on this page as a bare query string nobody phrased.
  const said = typeof q.switched === 'string'
    ? { what: 'Your switch is done.', then: 'Both legs are in the ledger — the sale out of one fund and the purchase into the other, priced on today\u2019s NAVs. The tax you were shown is what applies.' }
    : typeof q.plan === 'string'
      ? { what: `Your ${q.plan} is registered.`, then: 'Nothing moves today. The first instalment runs on the date you chose, and you can stop it here whenever you like.' }
      : typeof q.stepped === 'string'
        ? { what: 'Your instalment will rise on its own.', then: `A year from now it will be \u20b9${Number(q.stepped).toLocaleString('en-IN')} a month. Nothing else about the plan changes, and you can stop the rise without stopping the instalment.` }
        : typeof q.nfo === 'string'
          ? { what: 'Your application is in.', then: `Units are allotted at face value when the offer shuts on ${dmy(String(q.nfo))}. Nothing appears in your portfolio until then \u2014 that is the offer working, not a failure.` }
          : typeof q.mandate === 'string'
            ? { what: 'The bank permission is registered.', then: `${q.mandate}. Your instalments have somewhere to draw from again.` }
            : null;
  const refusal = typeof q.e === 'string' ? q.e : null;

  const orders = myOrders(ME);
  const sips = liveSips(ME);
  // Every standing instruction, not just the instalments: an STP and an SWP are
  // the same kind of promise and belong beside them rather than on a page of
  // their own. Filtered to the ones actually running.
  const running = plans(ME).filter(p => p.live && p.kind !== 'SIP');
  const banks = mandates(ME);

  return (
    <>
      <p className="f-hello" style={{ fontSize: 22 }}>What you have set in motion.</p>

      {refusal && (
        <div className="f-card f-act urgent">
          <div className="f-k" style={{ color: 'var(--f-neg)' }}><Icon name="alert" /> Not done</div>
          <div className="t">{refusal}</div>
        </div>
      )}

      {said && (
        <div className="f-card" style={{ borderLeft: '3px solid var(--f-pos)' }}>
          <div className="f-k" style={{ color: 'var(--f-pos)' }}><Icon name="check" /> Done</div>
          <div className="t">{said.what}</div>
          <div className="s">{said.then}</div>
        </div>
      )}

      {(justPlaced || justStarted) && (
        <div className="f-card" style={{ borderLeft: '3px solid var(--f-pos)' }}>
          <div className="f-k" style={{ color: 'var(--f-pos)' }}><Icon name="check" /> Done</div>
          <div className="t">
            {justStarted ? 'Your monthly instalment is registered.' : `Order ${justPlaced} is placed.`}
          </div>
          <div className="s">
            {justStarted
              ? 'Nothing leaves your account today. The first debit follows your mandate on the date you chose.'
              : 'The trail below is the receipt. It is the same record your manager sees.'}
          </div>
        </div>
      )}

      {sips.length > 0 && (
        <>
          <div className="f-sect">Going in every month</div>
          {sips.map(s => (
            <div className="f-card" key={s.sip_id}>
              <div className="f-k"><Icon name="calendar" /> {s.fund.replace(/ (Dir|Reg) ?Gr$/, '')}</div>
              <div className="f-trio">
                <div><div className="l">Amount</div><div className="v num">{inr(s.amount)}</div></div>
                <div><div className="l">On the</div><div className="v num">{s.day}{s.day === 1 ? 'st' : s.day === 2 ? 'nd' : s.day === 3 ? 'rd' : 'th'}</div></div>
                <div><div className="l">Since</div><div className="v num">{dmy(s.since).slice(3)}</div></div>
              </div>
              <form action={stopSip}>
                <input type="hidden" name="sip" value={s.sip_id} />
                <input type="hidden" name="why" value="Client paused it from the app" />
                <button className="f-btn ghost" type="submit" style={{ width: 'auto', marginTop: 10 }}>
                  Pause this
                </button>
              </form>
              <details className="f-acc" style={{ marginTop: 8 }}>
                <summary><Icon name="chev" /> Make it rise on its own</summary>
                <div className="body">
                  <p className="f-note" style={{ margin: '0 0 10px' }}>
                    The one change that compounds and the one nobody makes, because it means
                    remembering. Set once, it happens without you.
                  </p>
                  <form action={setStepUp}>
                    <input type="hidden" name="sip" value={s.sip_id} />
                    <input type="hidden" name="every" value="6" />
                    <div className="f-btnrow" style={{ marginTop: 0 }}>
                      {[1000, 2500, 5000].map(by => (
                        <button key={by} className="f-btn ghost" type="submit" name="by" value={by}
                          style={{ marginTop: 0 }}>+{inr(by)}</button>
                      ))}
                    </div>
                  </form>
                  <p className="f-note" style={{ marginBottom: 0 }}>
                    Every six months, stopping at three times what you pay now.
                  </p>
                </div>
              </details>
              <p className="f-note" style={{ marginTop: 8 }}>
                Pausing stops the debit. It does not sell anything you hold, and nobody has to approve
                restarting it.
              </p>
            </div>
          ))}
        </>
      )}

      {/* ── standing instructions that are not instalments ─────────────────── */}
      {running.length > 0 && (
        <>
          <div className="f-sect">Moving on a schedule</div>
          {running.map(p => (
            <div className="f-card" key={p.sip_id}>
              <div className="f-k">
                <Icon name={p.kind === 'SWP' ? 'down' : 'arrow'} />
                {p.kind === 'SWP' ? 'Coming out every month' : 'Moving across every month'}
                <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>{p.kind}</span>
              </div>
              <div className="t" style={{ fontSize: 15, marginTop: 8 }}>
                {inr(p.amount)} from {(p.from ?? '').replace(/ (Dir|Reg) ?Gr$/, '')}
                {p.to ? ` into ${p.to.replace(/ (Dir|Reg) ?Gr$/, '')}` : ' to your bank'}
              </div>
              <div className="s">
                On the {p.day}{p.day === 1 ? 'st' : p.day === 2 ? 'nd' : p.day === 3 ? 'rd' : 'th'},
                since {dmy(p.started).slice(3)}.
                {p.kind === 'SWP' && ' Each one is a sale, so each one is taxed.'}
              </div>
              <form action={endPlan}>
                <input type="hidden" name="sip" value={p.sip_id} />
                <input type="hidden" name="why" value={`Client stopped the ${p.kind} from the app`} />
                <button className="f-btn ghost" type="submit" style={{ width: 'auto' }}>Stop this</button>
              </form>
            </div>
          ))}
        </>
      )}

      {/* ── the permission everything above depends on ─────────────────────── */}
      {banks.length > 0 && (
        <>
          <div className="f-sect">The bank permission</div>
          {banks.map(m => (
            <div className={`f-card${m.lapsed || m.expiring ? ' f-act urgent' : ''}`} key={m.id}>
              <div className="f-k">
                <Icon name={m.lapsed || m.expiring ? 'alert' : 'shield'} /> {m.bank ?? 'Your bank'}
                <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>{m.umrn}</span>
              </div>
              <div className="f-trio">
                <div><div className="l">Most per debit</div><div className="v num">{inr(m.cap)}</div></div>
                <div><div className="l">Riding on it</div><div className="v num">{inr(m.covers)}</div></div>
                <div>
                  <div className="l">{m.lapsed ? 'Expired' : 'Runs until'}</div>
                  <div className={`v num ${m.lapsed || m.expiring ? 'neg' : ''}`}>
                    {m.end ? dmy(m.end).slice(3) : <span className="f-dash">&mdash;</span>}
                  </div>
                </div>
              </div>
              {(m.lapsed || m.expiring) && (
                <>
                  <p className="f-note">
                    {m.lapsed
                      ? 'This has expired. Every instalment drawing on it will be refused until it is renewed, and the refusal will not say why.'
                      : `${m.days_left} days left. A mandate that lapses stops your instalments without telling you.`}
                  </p>
                  <form action={renewTheMandate}>
                    <input type="hidden" name="exch" value={m.exch_id} />
                    <button className="f-btn" type="submit">Renew it for {MANDATE_RULES.years} years</button>
                  </form>
                </>
              )}
              {m.under_capped && (
                <p className="f-note">
                  {inr(m.covers)} a month is riding on a permission capped at {inr(m.cap)}. The debit
                  above the cap is the one that fails.
                </p>
              )}
            </div>
          ))}
        </>
      )}

      <div className="f-sect">Every order, and where it got to</div>
      {orders.length === 0 ? (
        <div className="f-card">
          <div className="f-k"><Icon name="info" /> Nothing placed yet</div>
          <div className="s">
            When you put money in or take it out, the whole trail appears here — received, sent to
            the exchange, units allotted, each with its date.
          </div>
          <Link href="/me/invest" className="f-btn" style={{ display: 'block', textAlign: 'center' }}>
            Put money in
          </Link>
        </div>
      ) : orders.map(o => (
        <div className="f-card" key={o.order_id}>
          <div className="f-k">
            <Icon name={o.kind === 'REDEMPTION' ? 'down' : 'up'} />
            {o.kind === 'REDEMPTION' ? 'Taken out' : o.kind === 'SWITCH' ? 'Switched' : 'Put in'}
            <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>#{o.order_id}</span>
          </div>
          <div className="t">{o.scheme.replace(/ (Dir|Reg) ?Gr$/, '')}</div>
          <div className="f-big num" style={{ fontSize: 22, margin: '4px 0 10px' }}>{inr(o.amount)}</div>

          {o.trail.map((t, i) => (
            <div className="f-step" key={t.state}>
              <span style={{ color: 'var(--f-ink)' }}>
                <Icon name={i === o.trail.length - 1 ? 'check' : 'clock'} /> {PLAIN[t.state] ?? t.state}
              </span>
              <b className="num">{dmy(t.at)}</b>
            </div>
          ))}
        </div>
      ))}

      <p className="f-note">
        Every line above is a dated record, not a status message. The real exchange takes hours and
        has a daily cut-off; this prototype completes at once and would rather say so than stage a
        two-day wait it does not actually have.
      </p>
    </>
  );
}
