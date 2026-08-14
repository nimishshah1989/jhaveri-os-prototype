import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, Trend } from '../../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../../lib/format';
import { outlooks, verdict, monthsBoughtBy, rateGap, GOAL_RULES } from '../../../../lib/goals';
import { db } from '../../../../lib/db';
import { manager } from '../../../../lib/me';
import { ME } from '../../layout';
import { raise } from '../../acts';

export const dynamic = 'force-dynamic';

const month = (d: string) => dmy(d).slice(3);

/** The monthly amounts we offer. Round numbers a person can actually decide about. */
const STEPS = [2000, 5000, 10000];

export default async function GoalDetail({ params }: PageProps<'/me/goals/[goalId]'>) {
  const { goalId } = await params;
  const o = outlooks(ME).find(g => g.goal_id === Number(goalId));
  if (!o) notFound();

  const rm = manager(ME);
  const funds = db().prepare(
    `SELECT f.scheme_id, f.fund_name, f.fund_category, ROUND(f.present_market_value) value, f.xirr
     FROM fifo_summary_holding_active f
     WHERE f.client_id = ? AND f.scheme_id IN (
       SELECT DISTINCT fk_scheme_id FROM transaction_master
       WHERE fk_acc_id = ? AND is_active = 1 AND fk_goal_id = ?)
     ORDER BY f.present_market_value DESC`,
  ).all(ME, ME, o.goal_id) as {
    scheme_id: number; fund_name: string; fund_category: string; value: number; xirr: number | null;
  }[];

  const late = o.monthsOff != null && o.monthsOff > 0;
  // Two rates, side by side: what this money is assumed to earn, and what the
  // target actually demands by its date. The distance between them is the goal's
  // real problem, and it is a problem about the target, the date or the monthly
  // amount — never an instruction to go looking for a fund that returns the
  // second number.
  const gap = rateGap(o);
  const levers = STEPS.map(amount => ({ amount, months: monthsBoughtBy(o, amount) }))
    .filter(l => l.months != null && l.months > 0);

  return (
    <>
      <Link href="/me/goals" className="f-note" style={{ display: 'inline-block', margin: '0 2px 8px' }}>
        <Icon name="back" /> Everything you are saving for
      </Link>

      <p className="f-hello" style={{ fontSize: 22 }}>{o.name}</p>

      <div className="f-card">
        <div className="f-k"><Icon name="target" /> Where this lands</div>
        <div className="f-big num">
          {o.met ? 'Reached' : o.reachedOn ? month(o.reachedOn) : <span className="f-dash">—</span>}
        </div>
        <div className="f-trio">
          <div><div className="l">You wanted</div><div className="v num">{month(o.on)}</div></div>
          <div>
            <div className="l">Difference</div>
            <div className={`v num ${late ? 'neg' : 'pos'}`}>
              {o.monthsOff == null ? <span className="f-dash">—</span> : (
                <><Trend n={-o.monthsOff} /> {Math.abs(o.monthsOff)}m</>
              )}
            </div>
          </div>
          <div><div className="l">Target</div><div className="v num">{inrCompact(o.target)}</div></div>
        </div>
        <p className="f-note" style={{ marginTop: 10 }}>{verdict(o)}</p>
      </div>

      <div className="f-card">
        <div className="f-k"><Icon name="bank" /> What is behind it today</div>
        <div className="f-bar" style={{ marginTop: 8 }}>
          <div className="bl">
            <span>{inr(o.now)} of {inr(o.target)}</span>
            <b className="num">{Math.min(100, Math.round((o.now / o.target) * 100))}%</b>
          </div>
          <div className="bt">
            <i style={{
              width: `${Math.min(100, (o.now / o.target) * 100)}%`,
              background: late ? 'var(--f-gold)' : 'var(--f-pos)',
            }} />
          </div>
        </div>
        <div className="f-step"><span>Put in</span><b className="num">{inr(o.put)}</b></div>
        <div className="f-step"><span>Worth today</span><b className="num">{inr(o.now)}</b></div>
        <div className="f-step">
          <span>Going in every month</span>
          <b className="num">{o.monthly > 0 ? inr(o.monthly) : 'Nothing'}</b>
        </div>
        <div className="f-step">
          <span>Projected at</span>
          <b className="num">{o.rate}% · {o.mix.map(m => `${m.asset} ${m.pct}%`).join(' · ')}</b>
        </div>
      </div>

      {levers.length > 0 && (
        <>
          <div className="f-sect">What moves it</div>
          <div className={`f-card f-act${late ? ' urgent' : ''}`}>
            <div className="f-k" style={{ color: late ? 'var(--f-neg)' : 'var(--f-faint)' }}>
              <Icon name={late ? 'alert' : 'spark'} /> A monthly instalment, and what it buys
            </div>
            <div className="s" style={{ marginBottom: 10 }}>
              Every rupee a month is time bought back. These are computed on this goal&rsquo;s own
              money at the same {o.rate}% used above — not a sales figure.
            </div>
            {levers.map(l => (
              <Link key={l.amount}
                href={`/me/invest?goal=${o.goal_id}&scheme=${funds[0]?.scheme_id ?? ''}&amount=${l.amount}`}
                className="f-btn ghost"
                style={{ display: 'flex', justifyContent: 'space-between', width: '100%', marginBottom: 8 }}>
                <span>{inr(l.amount)} a month</span>
                <span className="num" style={{ color: 'var(--f-pos)', fontWeight: 650 }}>
                  {l.months} months sooner
                </span>
              </Link>
            ))}
            <form action={raise}>
              <input type="hidden" name="kind" value="call_rm" />
              <input type="hidden" name="label" value={`Wants to talk about ${o.name}`} />
              <input type="hidden" name="evidence" value={`Goal ${o.name} · ${verdict(o)}`} />
              <button className="f-btn ghost" type="submit" style={{ width: '100%' }}>
                <Icon name="chat" /> Talk to {rm?.first ?? 'my manager'} first
              </button>
            </form>
            <p className="f-note">
              You can set this up yourself — it takes one screen and nothing is debited today.
              {rm?.first ? ` ${rm.first} sees it either way.` : ''} Nothing here sells anything
              you already hold.
            </p>
          </div>
        </>
      )}

      <div className="f-sect">
        The funds doing the work
        <Link href="/me/portfolio" className="rt">All holdings <Icon name="chev" /></Link>
      </div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {funds.map(f => (
          <Link key={f.scheme_id} href={`/me/portfolio/${f.scheme_id}`} className="f-row">
            <span className="mk">{f.fund_name.slice(0, 2).toUpperCase()}</span>
            <span className="nm">
              <b>{f.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
              <span>{f.fund_category}</span>
            </span>
            <span className="fg">
              <b className="num">{inrCompact(f.value)}</b>
              <span className={`num ${(f.xirr ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                {f.xirr != null ? <><Trend n={f.xirr} /> {f.xirr}%</> : <span className="f-dash">—</span>}
              </span>
            </span>
          </Link>
        ))}
      </div>

      <p className="f-note">
        {gap.required !== null
          ? <>Needs <b>{gap.required}% a year</b> from today. Assumed: <b>{gap.assumed}%</b>.</>
          : <>Assumed <b>{gap.assumed}%</b> a year.</>}
      </p>
      <details className="f-acc">
        <summary><span className="ic">›</span> How that rate is arrived at</summary>
        <p className="f-note body">
          {gap.shortfall_pts !== null && gap.shortfall_pts > 0
            ? `The ${gap.shortfall_pts} points between those two numbers is this goal's real problem, and it is closed by the date, the amount, or what goes in monthly — never by looking for a fund that returns the second number.`
            : 'The assumption already clears what this goal needs, which is why it arrives on time.'}
          {' '}The arrival month is projected, not promised: {o.rate}% a year, blended from the published
          rate for each asset class ({Object.entries(GOAL_RULES.rates).map(([k, v]) => `${k} ${v}%`).join(' · ')}),
          with anything already going in monthly. <b>We never project your own past return forward</b> —
          this money has actually earned {o.ownRate != null ? `${o.ownRate}%` : 'a rate we cannot compute'} so
          far, and compounding that for {Math.max(1, Math.round((Date.parse(o.on) - Date.parse('2026-08-07')) / 3.156e10))} years
          would be arithmetically perfect and completely false. Markets do not deliver a steady rate, and
          a real year will land above or below it. What this page is for is the <b>direction and the
          size</b> of the gap, and what closes it.
        </p>
      </details>
    </>
  );
}
