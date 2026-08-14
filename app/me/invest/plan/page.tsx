import Link from 'next/link';
import { Icon } from '../../../../components/Icon';
import { inr, inrCompact } from '../../../../lib/format';
import { clientHoldings } from '../../../../lib/client360';
import { db } from '../../../../lib/db';
import { EXEC_RULES } from '../../../../lib/exec';
import { manager } from '../../../../lib/me';
import { ME } from '../../layout';
import { startTransferPlan } from '../actions';

export const dynamic = 'force-dynamic';

/* ── Setting up a monthly transfer or withdrawal ──────────────────────────────
   Founder, 14-Aug-2026: "the STP, SWP, etc., we need to have that onboarding
   flow." They were two buttons at a fixed ₹5,000 inside an accordion — which
   assumes the client already knows what an STP is, and nobody does. Almost
   nobody who would benefit from one has ever been offered one in words.

   So it is a journey, like joining: one question a screen, each answer visible
   in the rail above, and the arithmetic shown before the button rather than
   after it. The steps are derived from what has been answered, not stored — the
   same shape `lib/join.ts` uses, for the same reason.                        */

type Step = 'what' | 'from' | 'to' | 'how' | 'when' | 'check';

const STEPS: { key: Step; label: string }[] = [
  { key: 'what', label: 'What' },
  { key: 'from', label: 'From' },
  { key: 'to', label: 'Into' },
  { key: 'how', label: 'How much' },
  { key: 'when', label: 'When' },
  { key: 'check', label: 'Check' },
];

/** Written policy, not generated. What each instrument is, in a client's words. */
const WHAT: Record<'STP' | 'SWP', { title: string; is: string; who: string; costs: string }> = {
  STP: {
    title: 'Move it across, monthly',
    is: 'A fixed sum leaves one of your funds every month and buys another. Nothing reaches your bank — it stays invested the whole time, just somewhere else.',
    who: 'Used when a lump sum has landed somewhere safe and you would rather it entered the market a bit at a time than all on one morning.',
    costs: 'Each month counts as a sale out of the first fund, so each month is taxed on whatever gain it carries.',
  },
  SWP: {
    title: 'Take it out, monthly',
    is: 'A fixed sum is sold from one of your funds every month and paid to your bank. It is a standing instruction, not a loan against the holding.',
    who: 'Used when this money has become income — a salary you have stopped drawing, a parent to support, a school fee that arrives every term.',
    costs: 'Each month is a sale. The tax is on the gain inside the units sold, and the units sold are the oldest ones you own.',
  },
};

const AMOUNTS = [2500, 5000, 10000, 25000];
const DAYS = [1, 5, 10, 15, 25];

export default async function PlanSetup({ searchParams }: PageProps<'/me/invest/plan'>) {
  const q = await searchParams;
  const kind = q.kind === 'STP' || q.kind === 'SWP' ? q.kind : null;
  const from = Number(q.from) || 0;
  const to = Number(q.to) || 0;
  const amount = Number(q.amount) || 0;
  const day = Number(q.day) || 0;

  const held = clientHoldings(ME).rows;
  const rm = manager(ME);
  const picks = db().prepare(
    `SELECT sm.scheme_id, sm.scheme_short_name name, cm.category_name category
     FROM scheme_master sm JOIN category_master cm ON cm.category_id = sm.fk_category_id
     WHERE sm.is_active = 1 AND sm.is_jhaveri_pick = 1 ORDER BY sm.scheme_short_name LIMIT 8`,
  ).all() as { scheme_id: number; name: string; category: string }[];

  // The step is derived from what has been answered, never stored. An SWP has no
  // destination fund, so its journey is genuinely one screen shorter.
  const order: Step[] = kind === 'SWP'
    ? ['what', 'from', 'how', 'when', 'check']
    : ['what', 'from', 'to', 'how', 'when', 'check'];
  const answered: Record<Step, boolean> = {
    what: !!kind, from: !!from, to: !!to, how: !!amount, when: !!day, check: false,
  };
  const step: Step = order.find(s => !answered[s]) ?? 'check';
  const at = order.indexOf(step);

  const href = (over: Record<string, string | number>) => {
    const p = new URLSearchParams({
      ...(kind && { kind }), ...(from && { from: String(from) }), ...(to && { to: String(to) }),
      ...(amount && { amount: String(amount) }), ...(day && { day: String(day) }),
    });
    for (const [k, v] of Object.entries(over)) p.set(k, String(v));
    return `/me/invest/plan?${p.toString()}`;
  };

  const source = held.find(h => h.scheme_id === from);
  const dest = picks.find(p => p.scheme_id === to) ?? held.find(h => h.scheme_id === to);
  const months = source && amount ? Math.floor(source.value / amount) : 0;
  const floor = kind === 'SWP' ? EXEC_RULES.min_swp : EXEC_RULES.min_stp;

  return (
    <>
      <Link href="/me/invest" className="f-note" style={{ display: 'inline-block', margin: '0 2px 8px' }}>
        <Icon name="back" /> Putting money in
      </Link>

      <div className="f-rail" aria-hidden="true">
        {order.map((s, i) => <i key={s} className={i < at ? 'done' : i === at ? 'now' : ''} />)}
      </div>
      <div className="f-railtext">
        <span>{STEPS.find(s => s.key === step)?.label}</span>
        <span>{at + 1} of {order.length}</span>
      </div>

      {/* ── what it is, before anything is asked of them ──────────────────── */}
      {step === 'what' && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>What would you like to set up?</p>
          {(['STP', 'SWP'] as const).map(k => (
            <Link key={k} href={href({ kind: k })} className="f-card tap">
              <div className="f-k"><Icon name={k === 'SWP' ? 'down' : 'arrow'} /> {k}</div>
              <div className="t" style={{ fontSize: 16, fontWeight: 650, marginTop: 8 }}>{WHAT[k].title}</div>
              <div className="s" style={{ fontSize: 13, color: 'var(--f-muted)', marginTop: 6, lineHeight: 1.55 }}>
                {WHAT[k].is}
              </div>
              <span className="f-cardlink">Set this up <Icon name="chev" /></span>
            </Link>
          ))}
          <p className="f-note">
            Both move money you already hold. Neither puts anything new in — that is the page you came from.
          </p>
        </>
      )}

      {kind && step !== 'what' && (
        <div className="f-card" style={{ background: 'var(--f-gold-soft)', borderColor: 'transparent' }}>
          <div className="f-k">{kind} · {WHAT[kind].title}</div>
          <div className="s" style={{ fontSize: 12.5, color: 'var(--f-muted)', marginTop: 6 }}>{WHAT[kind].who}</div>
          <details className="f-why">
            <summary><Icon name="chev" /> What it costs you</summary>
            <div><p>{WHAT[kind].costs}</p></div>
          </details>
        </div>
      )}

      {/* ── which fund it comes out of ────────────────────────────────────── */}
      {step === 'from' && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>Out of which fund?</p>
          <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {held.map(h => (
              <Link key={h.scheme_id} href={href({ from: h.scheme_id })} className="f-row">
                <span className="mk">{h.fund_name.slice(0, 2).toUpperCase()}</span>
                <span className="nm">
                  <b>{h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
                  <span>{h.fund_category}</span>
                </span>
                <span className="fg"><b className="num">{inrCompact(h.value)}</b></span>
              </Link>
            ))}
          </div>
          <p className="f-note">
            It has to be a fund you already hold, and it has to hold enough to run for a while — we
            refuse anything that would not last three months.
          </p>
        </>
      )}

      {/* ── and into which ────────────────────────────────────────────────── */}
      {step === 'to' && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>And into which?</p>
          <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {picks.filter(p => p.scheme_id !== from).map(p => (
              <Link key={p.scheme_id} href={href({ to: p.scheme_id })} className="f-row">
                <span className="mk">{p.name.slice(0, 2).toUpperCase()}</span>
                <span className="nm"><b>{p.name}</b><span>{p.category}</span></span>
                <Icon name="chev" />
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ── how much, priced against what it is coming out of ─────────────── */}
      {step === 'how' && source && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>How much each month?</p>
          <div className="f-card">
            <div className="f-k"><Icon name="money" /> From {source.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</div>
            <div className="f-big num" style={{ fontSize: 24 }}>{inr(source.value)}</div>
            <div className="f-pick" style={{ marginTop: 14 }}>
              {AMOUNTS.filter(a => a >= floor).map(a => (
                <Link key={a} href={href({ amount: a })}
                  style={{ flex: '1 1 auto', minHeight: 44, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: '8px 14px', fontSize: 13,
                    border: '1px solid var(--f-line)', borderRadius: 6 }}>
                  {inr(a)}
                  <span style={{ color: 'var(--f-faint)', marginLeft: 6, fontSize: 11 }}>
                    {Math.floor(source.value / a)}m
                  </span>
                </Link>
              ))}
            </div>
            <p className="f-note" style={{ marginBottom: 0 }}>
              The small figure is how many months that holding would last at that rate, with nothing
              further going in. The exchange floor for a {kind} is {inr(floor)}.
            </p>
          </div>
        </>
      )}

      {/* ── which day ─────────────────────────────────────────────────────── */}
      {step === 'when' && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>Which day of the month?</p>
          <div className="f-card">
            <div className="f-pick">
              {DAYS.map(d => (
                <Link key={d} href={href({ day: d })}
                  style={{ flex: '1 1 auto', minHeight: 44, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', padding: '8px 14px', fontSize: 13,
                    border: '1px solid var(--f-line)', borderRadius: 6 }}>
                  {d}{d === 1 ? 'st' : d === 5 || d === 10 || d === 15 || d === 25 ? 'th' : ''}
                </Link>
              ))}
            </div>
            <p className="f-note" style={{ marginBottom: 0 }}>
              Nothing later than the 28th — a date that does not exist in February is a month the
              instruction silently skips.
            </p>
          </div>
        </>
      )}

      {/* ── everything, before the button ─────────────────────────────────── */}
      {step === 'check' && source && (
        <>
          <p className="f-hello" style={{ fontSize: 21 }}>Does this look right?</p>
          <div className="f-card">
            <div className="f-step"><span>What</span><b>{kind} · {kind && WHAT[kind].title}</b></div>
            <div className="f-step"><span>Out of</span>
              <b>{source.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b></div>
            {kind === 'STP' && dest && (
              <div className="f-step"><span>Into</span>
                <b>{('fund_name' in dest ? dest.fund_name : dest.name).replace(/ (Dir|Reg) ?Gr$/, '')}</b></div>
            )}
            {kind === 'SWP' && <div className="f-step"><span>Into</span><b>Your bank</b></div>}
            <div className="f-step"><span>Every month</span><b className="num">{inr(amount)}</b></div>
            <div className="f-step"><span>On the</span><b className="num">{day}</b></div>
            <div className="f-step"><span>Lasts about</span>
              <b className="num">{months} month{months === 1 ? '' : 's'}</b></div>

            <span className={`f-verdict ${months >= 12 ? 'good' : months >= 3 ? 'wait' : 'bad'}`}>
              <Icon name={months >= 12 ? 'check' : months >= 3 ? 'clock' : 'alert'} />
              {months >= 12 ? 'That holding covers a year or more'
                : months >= 3 ? `That holding covers ${months} months`
                  : 'That holding runs out too fast'}
            </span>

            <details className="f-why">
              <summary><Icon name="chev" /> What happens next, and what it costs</summary>
              <div>
                <p>{kind && WHAT[kind].costs}</p>
                <p>Nothing moves today. The first one runs on the {day}
                  {kind === 'SWP' ? ', and the money reaches your bank two working days later.' : '.'}</p>
                <p>You can stop it on your orders page at any time, without asking anyone. Stopping
                  does not sell anything you already hold.</p>
              </div>
            </details>

            <form action={startTransferPlan}>
              <input type="hidden" name="kind" value={kind ?? ''} />
              <input type="hidden" name="from" value={from} />
              <input type="hidden" name="to" value={to || ''} />
              <input type="hidden" name="amount" value={amount} />
              <input type="hidden" name="day" value={day} />
              <button className="f-btn" type="submit">Set it up</button>
            </form>
          </div>
          <p className="f-note">
            {rm?.first ?? 'Your manager'} sees this the moment it registers, and will say if it looks
            wrong for you.
          </p>
        </>
      )}
    </>
  );
}
