import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { clientHeader, clientTxns } from '../../../lib/client360';
import { manager } from '../../../lib/me';
import { taxAhead, feeOnMe, consents } from '../../../lib/desk';
import { household } from '../../../lib/household';
import { tickets, clockSummary } from '../../../lib/clock';
import { ME } from '../layout';
import { raise } from '../acts';
import { Prefs } from '../prefs';
import { Nothing } from '../empty';

export const dynamic = 'force-dynamic';

const STATE_TONE: Record<string, string> = {
  assigned: 'var(--f-gold)', in_progress: 'var(--f-gold)', proposed: 'var(--f-gold)',
  done: 'var(--f-pos)', closed: 'var(--f-pos)', dismissed: 'var(--f-faint)',
};

const PAPERS: [string, string, string][] = [
  ['valuation', 'Valuation statement', 'Every holding priced at the latest NAV, with units, cost and your rate. What a bank or a visa office asks for.'],
  ['gains', 'Capital gains, FY by FY', 'Realised and notional kept apart, lot by lot. For your accountant.'],
  ['ledger', 'Folio ledger', 'Every entry on every folio since the beginning, including the instalments the bank refused.'],
];

export default async function Desk() {
  const me = clientHeader(ME);
  const rm = manager(ME);
  if (!me) {
    return (<><div className="f-sect" style={{ margin: '4px 2px 8px' }}>Your desk</div><Nothing clientId={ME} page="desk" /></>);
  }
  const all = tickets(ME);
  const open = all.filter(x => !x.closed);
  const done = all.filter(x => x.closed);
  const clock = clockSummary(ME);
  const tax = taxAhead(ME);
  const fee = feeOnMe(ME);
  const perms = consents(ME);
  const home = household(ME);
  const txns = clientTxns(ME);

  return (
    <>
      <div className="f-sect" style={{ margin: '4px 2px 8px' }}>Your desk</div>

      {/* ── the named human, first, not buried three taps down (research/14 §12.3) ── */}
      <div className="f-card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{
          width: 38, height: 38, borderRadius: '50%', display: 'grid', placeItems: 'center',
          background: 'var(--f-gold)', color: 'var(--f-onGold)', fontSize: 13, fontWeight: 700, flexShrink: 0,
        }}>{rm?.initials ?? 'RM'}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 14, fontWeight: 650, display: 'block' }}>{rm?.name ?? 'Your manager'}</b>
          <span style={{ fontSize: 11.5, color: 'var(--f-faint)' }}>
            Your manager{rm?.since ? ` · with Jhaveri since ${dmy(rm.since).slice(-4)}` : ''} · reads the same pages you do
          </span>
        </span>
        <form action={raise}>
          <input type="hidden" name="kind" value="call_rm" />
          <input type="hidden" name="label" value="Client asked for a call from the Desk" />
          <input type="hidden" name="evidence" value="Desk" />
          <button className="f-btn" type="submit" style={{ margin: 0, padding: '9px 14px', width: 'auto' }}>
            <Icon name="chat" /> Ask
          </button>
        </form>
      </div>

      {/* ── what you have asked for, on a clock ──────────────────────────────
          research/22 ranks support at 24% of what makes a house trustworthy —
          35% among the youngest investors, ahead of brand familiarity — and
          research/15 records that our predecessor app died of unanswered
          support. So this is a clock, not a status list: raised, who holds it,
          promised by, and how far past that it has gone. */}
      <div className="f-sect">
        What you have asked for
        {clock.open > 0 && <span className="rt" style={{ color: clock.overdue > 0 ? 'var(--f-neg)' : 'var(--f-gold-ink)' }}>
          {clock.open} open{clock.overdue > 0 ? ` · ${clock.overdue} late` : ''}
        </span>}
      </div>
      {open.length === 0 && done.length === 0 ? (
        <p className="f-note">
          Nothing open. Anything you press anywhere in this app arrives here with the date you asked and the date
          it is due — nothing you ask for disappears into a queue you cannot see.
        </p>
      ) : (
        <>
          <div className="f-card">
            {open.length === 0 ? (
              <p className="f-note" style={{ margin: 0 }}>Nothing outstanding. Everything you asked for has been closed.</p>
            ) : open.map(t2 => (
              <div key={t2.action_id} className="f-lever" style={{ borderColor: t2.overdue ? 'var(--f-neg)' : 'var(--f-line)' }}>
                <div className="lh">
                  <b>{t2.label.replace(/_/g, ' ')}</b>
                  <span className="pts" style={{
                    color: t2.overdue ? 'var(--f-neg)' : 'var(--f-gold)',
                    background: t2.overdue ? 'transparent' : 'var(--f-gold-soft)',
                  }}>
                    {t2.overdue ? `${Math.abs(t2.days_left)}d late` : t2.days_left === 0 ? 'due today' : `${t2.days_left}d left`}
                  </span>
                </div>
                {/* raised → who holds it → promised by. Three dates, no jargon. */}
                <div className="f-step"><span>You asked</span><b>{dmy(t2.raised)}</b></div>
                <div className="f-step"><span>Held by</span><b>{t2.with_whom}</b></div>
                <div className="f-step"><span>Promised by</span>
                  <b className={t2.overdue ? 'neg' : ''}>{dmy(t2.promised)}</b></div>
                <div className="ld">
                  {t2.overdue
                    ? `This is past what we promised. It is ours to explain, not yours to chase — and it is printed here rather than left for you to notice.`
                    : `Open ${t2.days_open} day${t2.days_open === 1 ? '' : 's'}. ${t2.with_whom} sees the same clock you do.`}
                </div>
              </div>
            ))}
            <p className="f-note" style={{ marginBottom: 0 }}>
              {clock.median_days != null
                ? `Of the ${clock.closed} things you have asked for and had closed, the middle one took ${clock.median_days} day${clock.median_days === 1 ? '' : 's'}. That is our record, not a target.`
                : 'Nothing has been closed yet, so there is no record to quote you.'}
            </p>
          </div>

          {done.length > 0 && (
            <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {done.slice(0, 4).map(t2 => (
                <div key={t2.action_id} className="f-row" style={{ cursor: 'default' }}>
                  <span className="nm">
                    <b>{t2.label.replace(/_/g, ' ')}</b>
                    <span>asked {dmy(t2.raised)} · closed {t2.closed ? dmy(t2.closed) : '—'} · {t2.with_whom}</span>
                  </span>
                  <span className="f-stamp" style={{ color: STATE_TONE[t2.state] ?? 'var(--f-pos)' }}>
                    {(t2.outcome ?? t2.state).replace(/_/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── tax, forward-looking (research/14 §12.7) ── */}
      <div className="f-sect">The calendar ahead</div>
      <div className="f-card">
        <div className="f-k"><Icon name="calendar" /> FY {tax.fy}</div>
        <div className="f-step" style={{ marginTop: 8 }}>
          <span>Gain sitting in units older than a year</span><b>{inr(tax.unrealLt)}</b>
        </div>
        <div className="f-step"><span>Tax-free allowance this year</span><b>{inr(tax.exempt)}</b></div>
        <div className="f-step"><span>Already used</span><b>{inr(tax.realLt)}</b></div>
        <div className="f-step"><span><b>Free to take, tax-free, before 31 March</b></span><b className="pos">{inr(tax.headroom)}</b></div>
        <div className="f-step"><span>Taxable if you sold every eligible unit today</span><b className="neg">{inr(tax.taxableIfAllSold)}</b></div>
        <div className="f-step"><span>Gain in units younger than a year</span><b>{inr(tax.unrealSt)}</b></div>
        <p className="f-note" style={{ marginBottom: 0 }}>
          Notional until you actually sell. {tax.headroom > 0 && (
            <>There is <b>{inr(tax.headroom)}</b> of gain you could bank this year without paying tax on it —
            the allowance does not carry over, and resets 31 March.</>
          )}
        </p>
        {tax.headroom > 0 && (
          <form action={raise}>
            <input type="hidden" name="kind" value="harvest" />
            <input type="hidden" name="label" value={`Use the ${inr(tax.headroom)} tax-free allowance before 31 March`} />
            <input type="hidden" name="evidence" value={`unrealised long-term ${tax.unrealLt}, already used ${tax.realLt}`} />
            <button className="f-btn" type="submit">Prepare this for me</button>
          </form>
        )}
      </div>

      {tax.unlocks.length > 0 && (
        <div className="f-card">
          <div className="f-k"><Icon name="clock" /> When money unlocks</div>
          {tax.unlocks.map(u => (
            <div className="f-step" key={u.d + u.fund}>
              <span>{u.fund.replace(/ (Dir|Reg) ?Gr$/, '')} — {Math.round(u.days / 30)} months away</span>
              <b>{dmy(u.d)} · {inrCompact(u.value)}</b>
            </div>
          ))}
          <p className="f-note" style={{ marginBottom: 0 }}>
            Every tax-saving rupee is locked three years from the day it was bought, not from when the folio opened.
            The Folio prints each unlock as it approaches; nothing to diarise.
          </p>
        </div>
      )}

      {tax.exit.some(e => e.lockedValue > 0) && (
        <div className="f-card">
          <div className="f-k"><Icon name="alert" /> When the exit fee stops</div>
          {tax.exit.filter(e => e.lockedValue > 0).map(e => (
            <div className="f-step" key={e.scheme_id}>
              <span>{e.fund.replace(/ (Dir|Reg) ?Gr$/, '')} — {inrCompact(e.lockedValue)} still inside its first year</span>
              <b>{e.nextFree ? dmy(e.nextFree) : '—'}</b>
            </div>
          ))}
          <p className="f-note" style={{ marginBottom: 0 }}>
            A {tax.exit[0]?.load ?? 1}% fee applies to units sold inside 365 days of the day they were bought, oldest sold first.
          </p>
        </div>
      )}

      {/* ── papers ── */}
      <div className="f-sect">Papers, on request</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {PAPERS.map(([kind, title, line]) => (
          <form action={raise} key={kind}>
            <input type="hidden" name="kind" value={`paper_${kind}`} />
            <input type="hidden" name="label" value={title} />
            <input type="hidden" name="evidence" value={`${txns.rows.length} entries from ${dmy(txns.from)} to ${dmy(txns.to)}`} />
            <button className="f-row" type="submit" style={{ cursor: 'pointer' }}>
              <span className="mk"><Icon name="file" /></span>
              <span className="nm"><b>{title}</b><span>{line}</span></span>
              <span className="f-stamp">Prepare</span>
            </button>
          </form>
        ))}
      </div>
      <p className="f-note">
        Free, in-app, and yours on demand — {txns.rows.length} entries on record from {dmy(txns.from)}.
        The Folio never charges you for your own records.
      </p>

      {/* ── the household is its own surface now; the Desk keeps the landmark ──
          It used to reprint the member list here, which made two pages say the
          same thing. A directory names the room and opens the door. */}
      <div className="f-sect">The household</div>
      {home && (
      <Link href="/me/household" className="f-card tap">
        <div className="f-k"><Icon name="users" /> {home.family_name}</div>
        <div className="f-big num" style={{ fontSize: 26 }}>{inrCompact(home.combined)}</div>
        <div className="f-trio">
          <div>
            <div className="l">Members</div>
            <div className="v num">{home.members.filter(m => m.client_id != null).length}</div>
          </div>
          <div>
            <div className="l">Shared with you</div>
            <div className="v num">{home.members.filter(m => m.total === 'granted').length}</div>
          </div>
          <div>
            <div className="l">Not started</div>
            <div className="v num">{home.prospects.length}</div>
          </div>
        </div>
        <span className="f-cardlink">Open the household <Icon name="chev" /></span>
      </Link>
      )}

      {/* ── consent, visible and reversible ── */}
      <div className="f-sect">What you have agreed to</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {perms.map(c => (
          <div key={`${c.channel}-${c.purpose}`} className="f-row" style={{ cursor: 'default' }}>
            <span className="nm">
              <b>{c.channel} · {c.purpose}</b>
              <span>agreed at {c.via}, {dmy(c.ts)}</span>
            </span>
            <span className="f-stamp" style={{ color: c.state === 'granted' ? 'var(--f-pos)' : 'var(--f-faint)' }}>
              {c.state}
            </span>
          </div>
        ))}
      </div>
      <p className="f-note">
        Per channel and per purpose, each with the date you agreed. Withdrawing one never touches another, and your
        transactional messages keep arriving either way — those are your records, not our marketing.
      </p>
      <form action={raise}>
        <input type="hidden" name="kind" value="change_consent" />
        <input type="hidden" name="label" value="Change a marketing consent" />
        <input type="hidden" name="evidence" value={perms.map(c => `${c.channel}/${c.purpose}=${c.state}`).join(', ')} />
        <button className="f-btn ghost" type="submit">Change one of these</button>
      </form>

      {/* ── what Jhaveri earns, in rupees ── */}
      <div className="f-sect">What Jhaveri earns from you</div>
      <div className="f-card">
        <div className="f-big num" style={{ fontSize: 26, marginTop: 0 }}>{inr(fee.runRate)}<span style={{ fontSize: 13, color: 'var(--f-faint)', fontFamily: 'inherit' }}> a year</span></div>
        <p style={{ fontSize: 12.5, color: 'var(--f-muted)', lineHeight: 1.55, marginTop: 6 }}>
          Paid by the fund house out of its own expense ratio at {(fee.bps / 100).toFixed(2)}% a year on regular plans.
          Never billed to you, never deducted from your units.
        </p>
        {fee.rows.map(r => (
          <div className="f-step" key={r.folio}>
            <span>{r.fund.replace(/ (Dir|Reg) ?Gr$/, '')} · {r.plan} plan</span>
            <b>{r.plan === 'Direct' ? '₹0' : inr(r.total)}</b>
          </div>
        ))}
        <div className="f-step"><span>This app, the reviews, {rm?.first ?? 'your manager'}&apos;s time</span><b>₹0 to you</b></div>
        <p className="f-note" style={{ marginBottom: 0 }}>
          A Direct plan pays a distributor nothing — that is what Direct means — so those lines read ₹0.
          {fee.directBooked > 0 && (
            <> Our own ledger currently books {inr(fee.directBooked)} against your Direct folios, which is a fault
            on our side and is flagged for correction. It is not a charge to you, and this page will keep saying ₹0
            until the ledger agrees.</>
          )} Rate from our {fee.source} empanelment. Commissions are also in your CAS; we would rather you read them
          here first, in rupees.
        </p>
      </div>

      {/* ── settings ── */}
      <div className="f-sect">This device</div>
      <Prefs />

      {/* ── the oath ── */}
      <div className="f-card" style={{ marginTop: 4 }}>
        <div className="f-k"><Icon name="shield" /> About this app</div>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--f-muted)', marginTop: 8 }}>
          Every figure here is computed from your own folios and the day&apos;s official prices. Where one cannot be
          computed honestly, the page prints a dash and says why. Nothing on any page is a recommendation to buy —
          your manager indicates, and decisions are conversations.
        </p>
        <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--f-muted)' }}>
          Your records come from the registrars and the exchange, the same source your CAS is built from. They are read
          to write these pages and for nothing else. We do not sell them and we do not profile you for an advertiser.
        </p>
        <p style={{ fontSize: 11, letterSpacing: '.18em', color: 'var(--f-gold)', fontWeight: 700, marginTop: 12 }}>
          JHAVERI PRIVATE · EST. 1992
        </p>
      </div>

      <p className="f-note">
        <Link href="/me" style={{ color: 'var(--f-gold)', fontWeight: 650 }}>Back to today</Link> · PAN ····{me.pan.slice(-4)} · KYC {me.kyc ? 'current' : 'pending'}
        {me.since ? ` · investing since ${dmy(me.since)}` : ''}
      </p>
    </>
  );
}
