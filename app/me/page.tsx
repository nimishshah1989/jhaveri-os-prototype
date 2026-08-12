import Link from 'next/link';
import { Icon, Trend } from '../../components/Icon';
import { inr, inrCompact, signedInrCompact, dmy } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { clientHeader, clientKpis, clientHoldings, clientActions } from '../../lib/client360';
import { clientHealth } from '../../lib/scoring';
import { manager, plan } from '../../lib/me';
import { outlooks } from '../../lib/goals';
import { ME } from './layout';
import { raise } from './acts';
import { Nothing } from './empty';

export const dynamic = 'force-dynamic';

const BAND_TONE: Record<string, string> = { lt: 'pos', conc: '', atrisk: 'neg' };

// Every health component is scored out of 20 and the five sum to 100 (lib/scoring).
// The bar has to divide by that, not by 100, or a 19/20 reads as almost empty.
const PER_COMPONENT = 20;
const barTone = (score: number) => {
  const share = score / PER_COMPONENT;
  return share >= 0.7 ? 'var(--f-pos)' : share >= 0.45 ? 'var(--f-gold)' : 'var(--f-neg)';
};

export default async function Today() {
  const me = clientHeader(ME);
  if (!me || clientHoldings(ME).rows.length === 0) {
    return (
      <>
        <p className="f-sect" style={{ margin: '4px 2px 8px' }}>
          Good morning{me ? `, ${me.name.split(' ')[0]}` : ''} · {dmy(TODAY)}
        </p>
        <Nothing clientId={ME} page="today" />
      </>
    );
  }
  const k = clientKpis(ME).value;
  const health = clientHealth(ME);
  const holdings = clientHoldings(ME).rows;
  const open = clientActions(ME).open;
  const rm = manager(ME);
  const earned = k.v - k.invested;

  // What needs her: only things she can actually authorise on a fund, biggest
  // gain first. The audit's stock-level findings stay on the health page as the
  // reason behind the score — a client cannot trade a share out of a fund.
  const p = plan(health.components);
  const needs = p.acts.slice(0, 2);
  const plans = outlooks(ME);

  return (
    <>
      <p className="f-hello">Good morning, {me.name.split(' ')[0]}.</p>

      <div className="f-card">
        <div className="f-k"><Icon name="bank" /> Your wealth</div>
        <div className="f-big num">{inr(k.v)}</div>
        <div className="f-trio">
          <div><div className="l">Put in</div><div className="v num">{inr(k.invested)}</div></div>
          <div>
            <div className="l">Earned</div>
            <div className={`v num ${earned >= 0 ? 'pos' : 'neg'}`}>
              <Trend n={earned} /> {signedInrCompact(earned)}
            </div>
          </div>
          <div>
            <div className="l">Your rate</div>
            <div className="v num">{k.wx != null ? `${k.wx}%` : <span className="f-dash">—</span>}</div>
          </div>
        </div>
        <Link href="/me/portfolio" className="f-cardlink">
          All {holdings.length} holdings, priced {dmy(TODAY)} <Icon name="chev" />
        </Link>
        <div className="f-btnrow" style={{ marginTop: 10 }}>
          <Link href="/me/invest" className="f-btn" style={{ textAlign: 'center' }}>Put money in</Link>
          <Link href="/me/orders" className="f-btn ghost" style={{ textAlign: 'center' }}>Your orders</Link>
        </div>
      </div>

      {/* The same money, read as time. A rupee figure tells you nothing about whether
          you are all right; an arrival month tells you everything. */}
      {plans.length > 0 && (
        <>
          <div className="f-sect">
            What it is for
            <Link href="/me/goals" className="rt">All {plans.length} <Icon name="chev" /></Link>
          </div>
          <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
            {plans.map(g => (
              <Link key={g.goal_id} href={`/me/goals/${g.goal_id}`} className="f-row">
                <span className="mk">
                  <Icon name={g.kind === 'retirement' ? 'clock' : g.kind === 'education' ? 'users' : 'bank'} />
                </span>
                <span className="nm">
                  <b>{g.name}</b>
                  <span>{inrCompact(g.now)} of {inrCompact(g.target)} · wanted {dmy(g.on).slice(3)}</span>
                </span>
                <span className="fg">
                  <b className={`num ${g.monthsOff != null && g.monthsOff <= 0 ? 'pos' : 'neg'}`}>
                    {g.met ? 'There' : g.monthsOff == null ? <span className="f-dash">—</span>
                      : `${Math.abs(g.monthsOff)}m ${g.monthsOff < 0 ? 'early' : 'late'}`}
                  </b>
                  <span>{g.reachedOn ? dmy(g.reachedOn).slice(3) : 'not on this path'}</span>
                </span>
              </Link>
            ))}
          </div>
        </>
      )}

      {needs.length > 0 && (
        <>
          <div className="f-sect">What needs you</div>
          {needs.map((l, i) => (
            <div key={l.key} className={`f-card f-act${i === 0 ? ' urgent' : ''}`}>
              <div className="f-k" style={{ color: i === 0 ? 'var(--f-neg)' : 'var(--f-faint)' }}>
                <Icon name={i === 0 ? 'alert' : 'clock'} /> {i === 0 ? 'Act today' : 'This week'}
                <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>+{l.delta} pts</span>
              </div>
              <div className="t">{l.act.verb}</div>
              <div className="s">{l.detail}</div>
              <form action={raise}>
                <input type="hidden" name="kind" value={`lever_${l.key}`} />
                <input type="hidden" name="label" value={l.act.verb} />
                <input type="hidden" name="evidence" value={`${l.area} · worth ${l.delta} points`} />
                <div className="f-btnrow">
                  <button className={`f-btn${i === 0 ? '' : ' ghost'}`} type="submit">Prepare it for me</button>
                  <button className="f-btn ghost" type="submit" name="kind" value="call_rm">
                    Ask {rm?.first ?? 'my manager'}
                  </button>
                </div>
              </form>
            </div>
          ))}
          <p className="f-note">
            {needs.some(n => n.act.sells)
              ? `${rm?.first ?? 'Your manager'} prepares each of these — with the tax computed from your own lots where anything is sold — and you approve before it moves.`
              : `Nothing here sells anything. ${rm?.first ?? 'Your manager'} prepares it, you approve in one tap.`}
            {open.length > 0 && ` ${open.length} request${open.length > 1 ? 's are' : ' is'} already with ${rm?.first ?? 'them'}.`}
          </p>
        </>
      )}

      <Link href="/me/portfolio?tab=health" className="f-card tap">
        <div className="f-k"><Icon name="shield" /> How your portfolio is doing</div>
        <div className="f-score">
          <div className={`n num ${BAND_TONE[health.band.cls]}`}>{health.total}<em> / 100</em></div>
          <div className="f-bars">
            {health.components.map(c => (
              <div className="f-bar" key={c.key}>
                <div className="bl">
                  <span>{c.label}</span>
                  <b className="num">{c.score}<span style={{ color: 'var(--f-faint)', fontWeight: 400 }}> / {PER_COMPONENT}</span></b>
                </div>
                <div className="bt">
                  <i style={{ width: `${(c.score / PER_COMPONENT) * 100}%`, background: barTone(c.score) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <span className="f-cardlink">
          {health.band.label} · {health.gain > 0 ? `${health.reachable} within reach` : 'nothing worth points today'} <Icon name="chev" />
        </span>
      </Link>

      <div className="f-sect">
        What you own
        <Link href="/me/portfolio" className="rt">All {holdings.length} <Icon name="chev" /></Link>
      </div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {holdings.slice(0, 3).map(h => (
          <Link key={h.scheme_id} href={`/me/portfolio/${h.scheme_id}`} className="f-row">
            <span className="mk">{h.fund_name.slice(0, 2).toUpperCase()}</span>
            <span className="nm">
              <b>{h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
              <span>{h.fund_category} · folio {h.folio_no}</span>
            </span>
            <span className="fg">
              <b className="num">{inrCompact(h.value)}</b>
              <span className={`num ${(h.xirr ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                <Trend n={h.xirr ?? 0} /> {h.xirr != null ? `${h.xirr}%` : '—'}
              </span>
            </span>
          </Link>
        ))}
      </div>

      <div className="f-card tap" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="mk" style={{
          width: 34, height: 34, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--f-gold)', color: 'var(--f-onGold)', fontSize: 11, fontWeight: 700, flexShrink: 0,
        }}>
          {rm?.initials ?? 'RM'}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 13, fontWeight: 650, display: 'block' }}>{rm?.name ?? 'Your manager'}</b>
          <span style={{ fontSize: 11.5, color: 'var(--f-faint)' }}>Your manager · reads the same pages you do</span>
        </span>
        <form action={raise}>
          <input type="hidden" name="kind" value="call_rm" />
          <input type="hidden" name="label" value="Client asked for a call from the app" />
          <input type="hidden" name="evidence" value="Today page" />
          <button className="f-btn ghost" type="submit" style={{ margin: 0, padding: '9px 14px', width: 'auto' }}>
            <Icon name="chat" /> Ask
          </button>
        </form>
      </div>

      <p className="f-note">
        Every figure here is computed from your own folios, priced {dmy(TODAY)}. Where one cannot be computed
        honestly the page prints a dash and says why.
      </p>
    </>
  );
}
