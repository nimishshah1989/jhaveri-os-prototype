import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, dmy } from '../../../lib/format';
import { myOrders, liveSips } from '../../../lib/invest';
import { ME } from '../layout';
import { stopSip } from '../invest/actions';

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

  const orders = myOrders(ME);
  const sips = liveSips(ME);

  return (
    <>
      <p className="f-hello" style={{ fontSize: 22 }}>What you have set in motion.</p>

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
              <p className="f-note" style={{ marginTop: 8 }}>
                Pausing stops the debit. It does not sell anything you already hold, and you can
                start it again whenever you like — nobody has to approve it.
              </p>
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
