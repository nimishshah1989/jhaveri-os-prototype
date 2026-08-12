import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon, Trend } from '../../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../../lib/format';
import { TODAY } from '../../../../mockdb/engines';
import { household, memberHoldings, accessLabel, whyHidden, STARTING_FLOOR } from '../../../../lib/household';
import { manager } from '../../../../lib/me';
import { ME } from '../../layout';
import { askToShare, startMember } from '../acts';

export const dynamic = 'force-dynamic';

/**
 * One member of the household, opened.
 *
 * Three different pages live here on purpose, because there are three different
 * honest answers: this is what they hold · they would rather you did not see it ·
 * they have nothing yet. The refusal is a page in its own right rather than a
 * blank column, since the reason is the only useful thing on it.
 */
export default async function Member({ params }: PageProps<'/me/household/[memberId]'>) {
  const { memberId } = await params;
  const h = household(ME);
  const found = h?.members.find(m => m.member_id === Number(memberId));
  if (!h || !found) notFound();

  const rm = manager(ME);
  const first = found.name.split(' ')[0];
  const drill = memberHoldings(ME, found.member_id);
  const share = h.combined > 0 && found.value != null ? Math.round((found.value / h.combined) * 100) : null;

  return (
    <>
      <Link href="/me/household" className="f-note" style={{ display: 'inline-block', margin: '0 2px 8px' }}>
        <Icon name="back" /> The household
      </Link>

      <p className="f-hello" style={{ fontSize: 22 }}>{found.name}</p>

      <div className="f-card">
        <div className="f-k">
          <Icon name="users" /> {found.relation === 'self' ? 'You' : found.relation[0].toUpperCase() + found.relation.slice(1)}
          <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>
            {found.age != null ? `${found.age} years old` : ''}
          </span>
        </div>
        <div className="f-big num">
          {found.value != null ? inr(found.value) : <span className="f-dash" style={{ fontSize: 26 }}>Not shared</span>}
        </div>
        <div className="f-trio">
          <div>
            <div className="l">Their rate</div>
            <div className={`v num ${found.rate != null && found.rate >= 0 ? 'pos' : found.rate != null ? 'neg' : ''}`}>
              {found.rate != null ? <><Trend n={found.rate} /> {found.rate}%</> : <span className="f-dash">—</span>}
            </div>
          </div>
          <div>
            <div className="l">Of the household</div>
            <div className="v num">{share != null ? `${share}%` : <span className="f-dash">—</span>}</div>
          </div>
          <div>
            <div className="l">You may see</div>
            <div className="v" style={{ fontSize: 13 }}>{accessLabel(found.detail)}</div>
          </div>
        </div>
      </div>

      {/* ── they said yes: their funds, and where each one goes next ────────── */}
      {drill.ok && drill.rows.length > 0 && (
        <>
          <div className="f-sect">
            What {found.relation === 'self' ? 'you hold' : `${first} holds`}
            <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{drill.rows.length} funds</span>
          </div>
          <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {drill.rows.map(r => (
              <Link key={r.scheme_id} href={`/me/portfolio/${r.scheme_id}`} className="f-row">
                <span className="mk">{r.fund_name.slice(0, 2).toUpperCase()}</span>
                <span className="nm">
                  <b>{r.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
                  <span>{r.fund_category}</span>
                </span>
                <span className="fg">
                  <b className="num">{inrCompact(r.value)}</b>
                  <span className={`num ${(r.xirr ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                    <Trend n={r.xirr ?? 0} /> {r.xirr != null ? `${r.xirr}%` : '—'}
                  </span>
                </span>
              </Link>
            ))}
          </div>
          <p className="f-note">
            {found.relation === 'self'
              ? 'The same holdings your Portfolio prices, read from the household side.'
              : `Opening a fund shows the fund — its category, what it owns and how it has run. It does not show ${first}'s cost, lots or tax, which are ${first}'s alone.`}
            {found.minor && found.guardian_id === ME
              && ` This folio is operated by you as guardian until ${first} turns 18, when it transfers automatically and these figures stop being yours to see.`}
          </p>
        </>
      )}

      {/* ── they said no, or have not answered ──────────────────────────────── */}
      {!drill.ok && found.client_id != null && (
        <div className="f-card f-act">
          <div className="f-k"><Icon name="shield" /> {accessLabel(found.detail)}</div>
          <div className="t">{drill.why}</div>
          <div className="s">
            {found.total === 'granted'
              ? `${first} agreed to be counted in the household total, and that is where it stops. Being in a family is not consent to be read.`
              : `Nothing of ${first}'s is shown here, and nothing of ${first}'s is inside the combined figure either.`}
          </div>
          {found.detail === 'asked'
            ? (
              <p className="f-note" style={{ marginBottom: 0 }}>
                The question is with {first}. It stays unanswered until {first} answers it — there is no
                way to press harder from this page, and that is the design.
              </p>
            )
            : (
              <form action={askToShare}>
                <input type="hidden" name="member_id" value={found.member_id} />
                <input type="hidden" name="scope" value="holdings" />
                <button className="f-btn ghost" type="submit">Ask {first} to share the funds behind it</button>
              </form>
            )}
        </div>
      )}

      {/* ── nothing yet: the acquisition surface, one member at a time ──────── */}
      {found.client_id == null && (
        <div className="f-card f-act">
          <div className="f-k"><Icon name="spark" /> No account yet</div>
          <div className="t">Start {first} at ₹{STARTING_FLOOR} a month</div>
          <div className="s">
            {first} is {found.age}. An account in {first}&rsquo;s own name needs {first}&rsquo;s birth
            certificate and a guardian — you — and nothing else. It takes about ten minutes.
          </div>
          <form action={startMember}>
            <input type="hidden" name="member_id" value={found.member_id} />
            <div className="f-btnrow">
              <button className="f-btn" type="submit">Ask {rm?.first ?? 'my manager'} to open it</button>
              <Link href="/join" className="f-btn ghost" style={{ textAlign: 'center', lineHeight: '22px' }}>
                Open it yourself
              </Link>
            </div>
          </form>
        </div>
      )}

      {found.open_actions > 0 && (
        <p className="f-note">
          {found.open_actions} request{found.open_actions > 1 ? 's are' : ' is'} open with {rm?.name ?? 'the desk'} on
          this account.
        </p>
      )}

      <p className="f-note">
        Priced {dmy(TODAY)} from {found.relation === 'self' ? 'your' : `${first}'s`} own folios.
        {whyHidden(found, 'total') && ` ${whyHidden(found, 'total')}`}
      </p>
    </>
  );
}
