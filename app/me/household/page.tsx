import Link from 'next/link';
import { Icon, Trend } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { household, familyGoals, startable, accessLabel, whyHidden, STARTING_FLOOR } from '../../../lib/household';
import { verdict, GOAL_RULES } from '../../../lib/goals';
import { manager } from '../../../lib/me';
import { FolioBars } from '../folio-charts';
import { ME } from '../layout';
import { startMember } from './acts';

export const dynamic = 'force-dynamic';

const RELATION_ICON: Record<string, string> = {
  self: 'today', spouse: 'users', son: 'users', daughter: 'users',
  mother: 'users', father: 'users', huf: 'bank',
};

const initials = (n: string) => n.split(' ').map(w => w[0]).slice(0, 2).join('');

export default async function Household() {
  const h = household(ME);
  if (!h) return <p className="f-note">No household is on file against this account.</p>;

  const rm = manager(ME);
  const goals = familyGoals(ME);
  const offers = startable(ME);
  const me = h.members.find(m => m.total === 'self');
  const others = h.combined - (me?.value ?? 0);
  const shared = h.members.filter(m => m.total === 'granted').length;

  return (
    <>
      <p className="f-hello">The {h.family_name.replace(/ Family$/, '')} household.</p>

      {/* ── the combined figure, and the honest arithmetic under it ─────────── */}
      <div className="f-card">
        <div className="f-k"><Icon name="users" /> Together</div>
        <div className="f-big num">{inr(h.combined)}</div>
        <div className="f-trio">
          <div><div className="l">Yours</div><div className="v num">{inrCompact(me?.value ?? 0)}</div></div>
          <div><div className="l">Everyone else</div><div className="v num">{inrCompact(others)}</div></div>
          <div>
            <div className="l">Counted</div>
            <div className="v num">{h.counted} of {h.members.filter(m => m.client_id != null).length}</div>
          </div>
        </div>
        {/* The split, drawn. A member who has not shared reads as an empty
            track with their name still on it — withheld, never zero. */}
        <FolioBars rows={h.members.filter(m => m.client_id != null).map(m => ({
          name: m.name.split(' ')[0],
          value: m.value,
          tone: m.total === 'self' ? 'gold' : 'muted',
        }))} />
        <p className="f-note" style={{ marginBottom: 0 }}>
          {h.withheld.length === 0
            ? `All ${h.counted} accounts counted, each with permission.`
            : `${h.withheld.map(m => m.name.split(' ')[0]).join(' and ')} chose not to be counted here.`}
        </p>
      </div>

      {/* ── each member, drillable, with the reason beside the figure ───────── */}
      <div className="f-sect">Who is here</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {h.members.filter(m => m.client_id != null).map(m => (
          <Link key={m.member_id} href={`/me/household/${m.member_id}`} className="f-row">
            <span className="mk"><Icon name={RELATION_ICON[m.relation] ?? 'users'} /></span>
            <span className="nm">
              <b>{m.name}{m.total === 'self' ? ' ' : ''}{m.total === 'self' ? <span className="f-stamp">YOU</span> : null}</b>
              <span>
                {m.relation === 'self' ? 'Head of the household' : m.relation[0].toUpperCase() + m.relation.slice(1)}
                {m.minor ? `, ${m.age} — held by a guardian` : m.age != null ? `, ${m.age}` : ''}
                {' · '}{accessLabel(m.total)}
              </span>
            </span>
            <span className="fg">
              <b className="num">{m.value != null ? inrCompact(m.value) : <span className="f-dash">—</span>}</b>
              <span className={`num ${m.rate != null && m.rate >= 0 ? 'pos' : m.rate != null ? 'neg' : ''}`}
                style={m.rate == null ? { color: 'var(--f-faint)', fontWeight: 400 } : undefined}>
                {m.rate != null ? <><Trend n={m.rate} /> {m.rate}%</> : `${m.funds ?? 0} funds`}
              </span>
            </span>
          </Link>
        ))}
      </div>

      {/* ── consent, stated as sentences rather than switches ───────────────── */}
      <div className="f-sect">Who sees what</div>
      <div className="f-card">
        {h.members.filter(m => m.client_id != null && m.total !== 'self').map(m => {
          const why = whyHidden(m, 'holdings') ?? whyHidden(m, 'total');
          return (
            <div key={m.member_id} className="f-ins">
              <span className="g"><Icon name={m.detail === 'granted' || m.detail === 'guardian' ? 'check' : 'shield'} /></span>
              <span className="tx">
                <span className="d">{m.name} · {accessLabel(m.detail)}</span>
                {why ?? `You can see what ${m.name.split(' ')[0]} is worth and every fund behind it.`}
                {m.minor && m.guardian_id === ME && ' You operate this folio until the eighteenth birthday, so there was never a question to ask.'}
                {m.decided_at && <> <span style={{ color: 'var(--f-faint)' }}>Decided {dmy(m.decided_at)}.</span></>}
              </span>
            </div>
          );
        })}
        <details className="f-acc">
          <summary><Icon name="chev" /> How a household works here</summary>
          <div className="body" style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--f-muted)' }}>
            A set of permissions with names on it, never a shared login. Each member keeps their own
            PAN, their own KYC and their own tax position, and can withdraw what they shared without
            asking anyone here.
          </div>
        </details>
      </div>

      {/* ── goals the family owns, funded across more than one account ──────── */}
      {goals.length > 0 && (
        <>
          <div className="f-sect">What the family is saving for</div>
          {goals.map(g => (
            <div key={g.goal_id} className="f-card">
              <div className="f-k">
                <Icon name={g.kind === 'home' ? 'bank' : 'target'} /> {g.name}
                <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>
                  wanted {dmy(g.on).slice(3)}
                </span>
              </div>
              <div className="f-score" style={{ marginTop: 10 }}>
                <div className="n num" style={{ fontSize: 22 }}>{inrCompact(g.now)}</div>
                <div className="f-bars">
                  <div className="f-bar">
                    <div className="bl">
                      <span>of {inrCompact(g.target)}</span>
                      <b className="num">{Math.min(100, Math.round((g.now / g.target) * 100))}%</b>
                    </div>
                    <div className="bt">
                      <i style={{
                        width: `${Math.min(100, (g.now / g.target) * 100)}%`,
                        background: g.monthsOff != null && g.monthsOff <= 0 ? 'var(--f-pos)' : 'var(--f-gold)',
                      }} />
                    </div>
                  </div>
                </div>
              </div>
              <div className="s" style={{ fontSize: 12.5, color: 'var(--f-muted)', marginTop: 9 }}>{verdict(g)}</div>
              {g.from.map(f => (
                <div className="f-step" key={f.client_id}>
                  <span>Standing behind it — {f.name}</span>
                  <b className="num">{inrCompact(f.value)}</b>
                </div>
              ))}
              <p className="f-note" style={{ marginBottom: 0 }}>
                At {g.rate}% a year — the published rate, never anyone&rsquo;s own past return.
              </p>
            </div>
          ))}
        </>
      )}

      {/* ── the next client is already in this list ─────────────────────────── */}
      {offers.map(({ member, goal, years }) => (
        <div key={member.member_id} className="f-card f-act">
          <div className="f-k"><Icon name="spark" /> Not started yet</div>
          <div className="t">Start {member.name.split(' ')[0]} at ₹{STARTING_FLOOR} a month</div>
          <div className="s">
            {member.name} is {member.age}, and is the only person in this household with nothing of their own.
            {goal && years != null && ` You have been saving for “${goal.name}” since 2025 — ${years} years from now — in your own name. Opened in ${member.name.split(' ')[0]}'s, the same money is ${member.name.split(' ')[0]}'s.`}
          </div>
          <p className="f-note">
            The regulated floor is ₹100 a month. Believing it is higher is the commonest reason an
            account never gets opened.
          </p>
          <form action={startMember}>
            <input type="hidden" name="member_id" value={member.member_id} />
            <div className="f-btnrow">
              <button className="f-btn" type="submit">
                Ask {rm?.first ?? 'my manager'} to open it
              </button>
              <Link href="/join" className="f-btn ghost" style={{ textAlign: 'center', lineHeight: '22px' }}>
                Open it yourself
              </Link>
            </div>
          </form>
        </div>
      ))}

      {offers.length === 0 && (
        <p className="f-note">
          Everyone on this list has an account. Adding a spouse, a parent or a child means their own PAN
          and their own KYC — {rm?.first ?? 'your manager'} can start that from here.
        </p>
      )}

      <p className="f-note">
        Priced {dmy(TODAY)} from each member&rsquo;s own folios, shown only where they agreed.
      </p>
    </>
  );
}
