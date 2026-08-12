import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { outlooks, untagged, GOAL_RULES } from '../../../lib/goals';
import { clientKpis } from '../../../lib/client360';
import { ME } from '../layout';
import { Nothing } from '../empty';

export const dynamic = 'force-dynamic';

/** The month a date falls in, which is the only precision a projection has earned. */
const month = (d: string) => dmy(d).slice(3);

export default async function Goals() {
  const list = outlooks(ME);
  if (!list.length) {
    return (
      <>
        <p className="f-sect" style={{ margin: '4px 2px 8px' }}>What it is all for</p>
        <Nothing clientId={ME} page="portfolio" />
      </>
    );
  }
  const loose = untagged(ME);
  const total = clientKpis(ME).value.v;

  return (
    <>
      <p className="f-hello" style={{ fontSize: 22 }}>What it is all for.</p>
      <p className="f-note" style={{ margin: '0 2px 14px' }}>
        Rupees are hard to feel. Months are not. Each of these says when you actually
        arrive, not how much you have.
      </p>

      {list.map(o => (
        <Link key={o.goal_id} href={`/me/goals/${o.goal_id}`} className="f-card tap">
          <div className="f-k">
            <Icon name={o.kind === 'retirement' ? 'clock' : o.kind === 'education' ? 'users' : 'bank'} />
            {o.name}
            <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>
              by {month(o.on)}
            </span>
          </div>

          <div className="f-big num" style={{ fontSize: 26, marginTop: 6 }}>
            {o.met ? 'Reached' : o.monthsOff == null ? <span className="f-dash">—</span> : (
              <>
                {Math.abs(o.monthsOff)}<em style={{ fontSize: 15 }}> month{Math.abs(o.monthsOff) === 1 ? '' : 's'} {o.monthsOff < 0 ? 'early' : 'late'}</em>
              </>
            )}
          </div>

          <div className="f-bar" style={{ marginTop: 8 }}>
            <div className="bl">
              <span>{inrCompact(o.now)} of {inrCompact(o.target)}</span>
              <b className="num">{Math.min(100, Math.round((o.now / o.target) * 100))}%</b>
            </div>
            <div className="bt">
              <i style={{
                width: `${Math.min(100, (o.now / o.target) * 100)}%`,
                background: o.monthsOff != null && o.monthsOff <= 0 ? 'var(--f-pos)' : 'var(--f-gold)',
              }} />
            </div>
          </div>

          <span className="f-cardlink">
            {o.reachedOn ? `Arrives ${month(o.reachedOn)}` : 'Not on this path'} <Icon name="chev" />
          </span>
        </Link>
      ))}

      {loose.schemes > 0 && (
        <div className="f-card">
          <div className="f-k"><Icon name="info" /> Not yet spoken for</div>
          <div className="t">{inr(loose.value)} across {loose.schemes} fund{loose.schemes === 1 ? '' : 's'}</div>
          <div className="s">
            Money without a purpose is the hardest to hold on to in a bad month. Say what it is
            for and it starts counting towards something.
          </div>
        </div>
      )}

      <p className="f-note">
        Every arrival date above is projected at the published rate for what the money is
        actually in — {Object.entries(GOAL_RULES.rates).map(([k, v]) => `${k} ${v}%`).join(' · ')} —
        blended by holding. <b>We never project your own past return forward.</b> One of these
        has earned 26% and another has lost money; compounding either for twenty years would be
        arithmetically perfect and completely false. Your record is on the fund pages, where it
        belongs. Of {inrCompact(total)} in total, {inrCompact(total - loose.value)} is working
        towards something named.
      </p>
    </>
  );
}
