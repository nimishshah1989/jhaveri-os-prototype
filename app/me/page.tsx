import Link from 'next/link';
import { Icon, Trend } from '../../components/Icon';
import { inr, inrCompact, signedInrCompact, dmy } from '../../lib/format';
import { TODAY } from '../../mockdb/engines';
import { clientHeader, clientKpis, clientHoldings, clientActions } from '../../lib/client360';
import { clientHealth } from '../../lib/scoring';
import { manager, plan } from '../../lib/me';
import { outlooks } from '../../lib/goals';
import { eventDesk } from '../../lib/eventdesk';
import { equityCurve } from '../../lib/portfolio';
import { FolioArc } from './folio-charts';
import { explain } from '../../lib/explain';
import { FigureSheet } from './sheet';
import { sinceLastLook } from '../../lib/explain';
import { lastSeen, markSeen } from './lastseen';
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
  // What has actually happened to this money, newest first. Every row is derived
  // from a record — a handover, a mandate date, a refused instalment — and each
  // carries the house's written view beside it. See lib/eventdesk.ts.
  // Two, not three: Today is a reading surface and DESIGN.md caps it at 2.5
  // screens. Measured at 2.61 with three. The rest live on /me/events.
  const feed = eventDesk(ME);
  const changed = feed.slice(0, 2);
  // The arc has existed in lib/portfolio since the broker lens was built and no
  // client-lens page had ever drawn it. It is the one picture that answers
  // "is this working" without a sentence: worth, against what went in, against
  // the index on the same dates.
  const arc = equityCurve(ME).value;
  // Phase 6: any figure, tapped, opens in three labelled voices. A figure whose
  // ledger voice cannot be computed gets no sheet rather than a dead tap.
  // What moved while they were away. Null on a first visit, and a first visit
  // gets no hero rather than an invented one.
  const seen = await lastSeen();
  const since = sinceLastLook(ME, seen);
  const sheets = {
    wealth: explain(ME, 'wealth'), earned: explain(ME, 'earned'), rate: explain(ME, 'rate'),
    invested: explain(ME, 'invested'),
  };

  return (
    <>
      <p className="f-hello">Good morning, {me.name.split(' ')[0]}.</p>

      {/* ── what changed while you were away ─────────────────────────────────
          The plan's Today hero. It needs a stored last-seen, and in a lens with
          no auth the browser is the only honest place for one. */}
      {since.since && (since.moved != null || since.events > 0) && (
        <form action={markSeen} className="f-card">
          <div className="f-k">
            <Icon name="clock" /> Since you last looked
            <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>
              {dmy(since.since)}
            </span>
          </div>
          {since.moved != null && (
            <div className="f-big num" style={{ fontSize: 26 }}>
              <span className={since.moved >= 0 ? 'pos' : 'neg'}>
                <Trend n={since.moved} /> {signedInrCompact(since.moved)}
              </span>
            </div>
          )}
          <div className="s" style={{ fontSize: 12.5, color: 'var(--f-muted)', marginTop: 6 }}>
            {since.moved != null
              ? `on the same holdings, priced then and now. `
              : 'Your holdings changed, so there is no like-for-like move to quote. '}
            {since.events > 0 && `${since.events} thing${since.events === 1 ? '' : 's'} happened to your funds. `}
            {since.orders > 0 && `${since.orders} entr${since.orders === 1 ? 'y' : 'ies'} on your ledger.`}
          </div>
          <button className="f-btn ghost" type="submit" style={{ width: 'auto' }}>Mark as read</button>
        </form>
      )}

      <form action="/me/ask" className="f-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 13px' }}>
        <Icon name="search" />
        <input name="q" type="search" autoComplete="off" placeholder="Ask about your money…"
          style={{ flex: 1, border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 13.5, color: 'var(--f-ink)', minWidth: 0 }} />
        <span className="f-stamp">BETA</span>
      </form>

      <div className="f-card">
        <div className="f-k"><Icon name="bank" /> Your wealth</div>
        <FigureSheet sheet={sheets.wealth}>
          <span className="f-big num">{inr(k.v)}</span>
        </FigureSheet>
        <div className="f-trio">
          <div>
            <div className="l">Put in</div>
            <FigureSheet sheet={sheets.invested}><span className="v num">{inr(k.invested)}</span></FigureSheet>
          </div>
          <div>
            <div className="l">Earned</div>
            <FigureSheet sheet={sheets.earned}>
              <span className={`v num ${earned >= 0 ? 'pos' : 'neg'}`}>
                <Trend n={earned} /> {signedInrCompact(earned)}
              </span>
            </FigureSheet>
          </div>
          <div>
            <div className="l">Your rate</div>
            <FigureSheet sheet={sheets.rate}>
              <span className="v num">{k.wx != null ? `${k.wx}%` : <span className="f-dash">—</span>}</span>
            </FigureSheet>
          </div>
        </div>
        <FolioArc data={arc} />
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

      {/* ── what changed, with the house view beside it and the cost in rupees ── */}
      {changed.length > 0 && (
        <>
          <div className="f-sect">
            What changed
            <Link href="/me/events" className="rt">All {feed.length} <Icon name="chev" /></Link>
          </div>
          <div className="f-card">
            {changed.map(e => (
              <div className="f-ins" key={e.key}>
                <span className="g">
                  <Icon name={e.kind === 'instalment_failed' || e.kind === 'mandate_ending' ? 'alert'
                    : e.kind === 'manager_wrote' ? 'chat' : 'spark'} />
                </span>
                <span className="tx">
                  <span className="d">
                    {e.days_ago === 0 ? 'Today' : `${e.days_ago} days ago`}
                    {e.fund ? ` · ${e.fund.replace(/ (Dir|Reg) ?Gr$/, '')}` : ''}
                  </span>
                  <b>{e.what}</b>
                  {e.consequence && <> {e.consequence}</>}
                </span>
              </div>
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
            {rm?.first ?? 'Your manager'} prepares it; you approve before anything moves.
            {open.length > 0 && ` ${open.length} already with ${rm?.first ?? 'them'}.`}
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

      {/* The top three holdings used to be reprinted here. That is Portfolio's
          first tab verbatim, and no page may repeat another page — the wealth
          card above already links straight to it. Removing it also bought back
          the room the arc needed. */}

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

      <p className="f-note">Computed from your own folios, priced {dmy(TODAY)}.</p>
    </>
  );
}
