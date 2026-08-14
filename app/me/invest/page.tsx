import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { db } from '../../../lib/db';
import { taxOnRedeem, ORDER_RULES, exemptionIsAssumed } from '../../../lib/invest';
import { outlooks } from '../../../lib/goals';
import { clientHoldings } from '../../../lib/client360';
import { manager } from '../../../lib/me';
import { ME } from '../layout';
import { openNfos } from '../../../lib/mandate';
import { previewSwitch } from '../../../lib/exec';
import { invest, redeem, switchFunds, startTransferPlan, applyToNfo } from './actions';

export const dynamic = 'force-dynamic';

/** Amounts a person actually decides between, rather than a free-text box first. */
const MONTHLY = [1000, 2500, 5000, 10000];
const ONCE = [25000, 50000, 100000, 250000];

export default async function Invest({ searchParams }: PageProps<'/me/invest'>) {
  const q = await searchParams;
  const err = typeof q.e === 'string' ? q.e : null;
  const wantRedeem = q.kind === 'redeem';
  const schemeId = Number(q.scheme) || 0;

  const held = clientHoldings(ME).rows;
  // Phase 5: the instruments a client can use at any other distributor. A switch
  // and a transfer only make sense against something already held, so both are
  // hidden until there is something to move.
  const nfos = openNfos();
  const moving = q.kind === 'move';
  const switchFrom = Number(q.from) || held[0]?.scheme_id || 0;
  const switchTo = Number(q.to) || 0;
  const switchAmount = Number(q.amt) || 0;
  const preview = moving && switchFrom && switchTo && switchAmount
    ? previewSwitch(ME, switchFrom, switchTo, switchAmount) : null;
  const picks = db().prepare(
    `SELECT sm.scheme_id, sm.scheme_short_name name, cm.category_name category, sm.risk_level risk,
            sm.scheme_expense_ratio expense
     FROM scheme_master sm JOIN category_master cm ON cm.category_id = sm.fk_category_id
     WHERE sm.is_active = 1 AND sm.is_jhaveri_pick = 1 ORDER BY sm.scheme_short_name LIMIT 8`,
  ).all() as { scheme_id: number; name: string; category: string; risk: string; expense: number }[];

  const chosen = schemeId
    ? db().prepare(`SELECT scheme_id, scheme_short_name name, scheme_day_end_nav nav, scheme_exit_load load
                    FROM scheme_master WHERE scheme_id = ?`).get(schemeId) as
        { scheme_id: number; name: string; nav: number; load: number } | undefined
    : undefined;

  const goals = outlooks(ME);
  const rm = manager(ME);

  /* ── redeeming: the bill comes before the button ────────────────────────── */
  if (wantRedeem && chosen) {
    const holding = held.find(h => h.scheme_id === chosen.scheme_id);
    const preview = taxOnRedeem(ME, chosen.scheme_id, Math.min(200000, holding?.value ?? 0));
    return (
      <>
        <Link href={`/me/portfolio/${chosen.scheme_id}`} className="f-note" style={{ display: 'inline-block', margin: '0 2px 8px' }}>
          <Icon name="back" /> {chosen.name}
        </Link>
        <p className="f-hello" style={{ fontSize: 22 }}>Taking money out.</p>

        {err && <div className="f-card f-act urgent"><div className="s">{err}</div></div>}

        {preview ? (
          <>
            <div className="f-card">
              <div className="f-k"><Icon name="file" /> What ₹2,00,000 would cost you</div>
              <div className="f-step"><span>You would receive</span><b className="num">{inr(preview.gross)}</b></div>
              <div className="f-step"><span>Long-term gain inside it</span><b className="num">{inr(preview.ltcgGain)}</b></div>
              <div className="f-step"><span>Short-term gain inside it</span><b className="num">{inr(preview.stcgGain)}</b></div>
              <div className="f-step">
                <span>This year&rsquo;s exemption left</span>
                <b className="num" style={{ color: 'var(--f-pos)' }}>{inr(preview.exemptLeft)}</b>
              </div>
              <div className="f-step"><span>Tax</span><b className="num">{inr(preview.ltcgTax + preview.stcgTax)}</b></div>
              <div className="f-step"><span>Exit load</span><b className="num">{inr(preview.exitLoad)}</b></div>
              <div className="f-step" style={{ borderTop: '1px solid var(--f-line)', marginTop: 6, paddingTop: 10 }}>
                <span><b>In your bank</b></span><b className="num">{inr(preview.net)}</b>
              </div>
            </div>

            <div className="f-card">
              <div className="f-k"><Icon name="calendar" /> The exact units this would sell</div>
              <div className="s" style={{ marginBottom: 8 }}>
                Oldest first, the way the registrar does it — which is why some of this gain is
                taxed and some of it is not.
              </div>
              {preview.lots.map(l => (
                <div className="f-step" key={l.bought}>
                  <span>
                    {dmy(l.bought)} · {l.units.toFixed(2)} units
                    <span className={`f-chip ${l.long ? 'pos' : ''}`} style={{ marginLeft: 6 }}>
                      {l.long ? 'long-term' : `${l.months}m — short-term`}
                    </span>
                  </span>
                  <b className="num">{inr(l.value - l.cost)}</b>
                </div>
              ))}
            </div>

            <form action={redeem}>
              <input type="hidden" name="scheme" value={chosen.scheme_id} />
              <div className="f-card">
                <div className="f-field">
                  <label htmlFor="amount">How much do you want out</label>
                  <input id="amount" name="amount" type="text" inputMode="numeric" className="num"
                    defaultValue={preview.gross} required />
                  <span className="hint">
                    You hold {inrCompact(holding?.value ?? 0)} in this fund. The figures above are for {inr(preview.gross)};
                    change the amount and they are recomputed before anything moves.
                  </span>
                </div>
                <button className="f-btn" type="submit">Place the redemption</button>
              </div>
            </form>

            <p className="f-note">
              {exemptionIsAssumed && (
                <><b>This assumes you have realised no other long-term gains this year.</b> Our ledger
                stores the value of each sale rather than the gain inside it, so we cannot yet check
                that — and we would rather say so than quietly show you a bigger exemption than you
                have. {rm?.first ?? 'Your manager'} can confirm it against the registrar&rsquo;s statement. </>
              )}
              Tax at {ORDER_RULES.ltcg_rate}% on long-term gains above {inr(ORDER_RULES.ltcg_exempt)} a year,
              {ORDER_RULES.stcg_rate}% on short-term.
            </p>
          </>
        ) : (
          <div className="f-card"><div className="s">You do not hold this fund, so there is nothing to take out.</div></div>
        )}
      </>
    );
  }

  /* ── putting money in ───────────────────────────────────────────────────── */
  return (
    <>
      <p className="f-hello" style={{ fontSize: 22 }}>Put money in.</p>
      <p className="f-note" style={{ margin: '0 2px 14px' }}>
        A monthly instalment beats a lump sum for most people, for one unglamorous reason:
        it does not require you to be right about today.
      </p>

      {err && (
        <div className="f-card f-act urgent">
          <div className="f-k" style={{ color: 'var(--f-neg)' }}><Icon name="alert" /> That did not go through</div>
          <div className="s">{err}</div>
        </div>
      )}

      <form action={invest}>
        <div className="f-card">
          <div className="f-fields">
            <div className="f-field">
              <label htmlFor="scheme">Which fund</label>
              <select id="scheme" name="scheme" defaultValue={schemeId || ''} required>
                <option value="">Choose one</option>
                {held.length > 0 && (
                  <optgroup label="Funds you already hold">
                    {held.map(h => (
                      <option key={h.scheme_id} value={h.scheme_id}>
                        {h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="On the Jhaveri list">
                  {picks.map(p => (
                    <option key={p.scheme_id} value={p.scheme_id}>
                      {p.name} · {p.category} · {p.expense}% cost
                    </option>
                  ))}
                </optgroup>
              </select>
              <span className="hint">
                Every fund on the Jhaveri list publishes why it is there. The list is on Discover,
                with the ones we got wrong shown at the same size as the ones we got right.
              </span>
            </div>

            <div className="f-field">
              <label>Monthly, or once</label>
              <div className="f-pick">
                <label><input type="radio" name="monthly" value="1" defaultChecked /><span>Every month</span></label>
                <label><input type="radio" name="monthly" value="0" /><span>Just once</span></label>
              </div>
            </div>

            <div className="f-field">
              <label htmlFor="amount">How much</label>
              <input id="amount" name="amount" type="text" inputMode="numeric" className="num"
                defaultValue={Number(q.amount) || 5000} required />
              <span className="hint">
                Monthly: from {inr(ORDER_RULES.min_sip)}. Typical steps {MONTHLY.map(m => inr(m)).join(' · ')}.
                One-off: from {inr(ORDER_RULES.min_lumpsum)}, typically {ONCE.map(m => inrCompact(m)).join(' · ')}.
              </span>
            </div>

            {goals.length > 0 && (
              <div className="f-field">
                <label htmlFor="goal">What it is for</label>
                <select id="goal" name="goal" defaultValue={typeof q.goal === 'string' ? q.goal : ''}>
                  <option value="">Not tied to anything yet</option>
                  {goals.map(g => (
                    <option key={g.goal_id} value={g.goal_id}>
                      {g.name} — {g.monthsOff == null ? 'not on track' : `${Math.abs(g.monthsOff)}m ${g.monthsOff < 0 ? 'early' : 'late'}`}
                    </option>
                  ))}
                </select>
                <span className="hint">Money with a name on it is the money people keep.</span>
              </div>
            )}

            <div className="f-field">
              <label htmlFor="day">Which day of the month</label>
              <input id="day" name="day" type="text" inputMode="numeric" className="num" defaultValue={5} maxLength={2} />
              <span className="hint">The 1st to the 28th. Later dates fail in February, every year.</span>
            </div>
          </div>

          <button className="f-btn" type="submit">Set it up <Icon name="chev" /></button>
        </div>
      </form>

      <p className="f-note">
        A monthly instalment is debited by your bank mandate, not by us. Nothing leaves your
        account today. You can pause it from <Link href="/me/orders">your orders</Link> at any
        time, without asking anyone.
      </p>

      {/* ── moving money between funds, and out on a schedule ─────────────── */}
      {held.length > 1 && (
        <>
          <div className="f-sect">Move money you already hold</div>
          <div className="f-card">
            <p className="f-note" style={{ margin: '0 0 12px' }}>
              A switch is a sale and a purchase on the same day. The tax office treats the leaving leg
              exactly as it treats a redemption, so the bill is shown before the button.
            </p>
            <form>
              <input type="hidden" name="kind" value="move" />
              <div className="f-fields">
                <div className="f-field">
                  <label htmlFor="from">Out of</label>
                  <select id="from" name="from" defaultValue={switchFrom || ''}>
                    {held.map(h => (
                      <option key={h.scheme_id} value={h.scheme_id}>
                        {h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')} · {inrCompact(h.value)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="f-field">
                  <label htmlFor="to">Into</label>
                  <select id="to" name="to" defaultValue={switchTo || ''}>
                    <option value="">Choose one</option>
                    {picks.map(pk => (
                      <option key={pk.scheme_id} value={pk.scheme_id}>{pk.name} · {pk.category}</option>
                    ))}
                  </select>
                </div>
                <div className="f-field">
                  <label htmlFor="amt">How much</label>
                  <input id="amt" name="amt" type="text" inputMode="numeric" className="num"
                    defaultValue={switchAmount || ''} placeholder="50000" />
                </div>
              </div>
              <button className="f-btn ghost" type="submit">Show me the tax first</button>
            </form>

            {preview && !preview.ok && <p className="f-note" style={{ color: 'var(--f-neg)' }}>{preview.reason}</p>}

            {preview?.ok && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--f-line)' }}>
                <div className="f-step"><span>Leaving {preview.preview.from.replace(/ (Dir|Reg) ?Gr$/, '')}</span>
                  <b className="num">{inr(preview.preview.amount)}</b></div>
                <div className="f-step"><span>Tax on the way out</span>
                  <b className={`num ${preview.preview.tax.ltcgTax + preview.preview.tax.stcgTax > 0 ? 'neg' : ''}`}>
                    {inr(preview.preview.tax.ltcgTax + preview.preview.tax.stcgTax)}</b></div>
                <div className="f-step"><span>Exit fee</span>
                  <b className="num">{preview.preview.tax.exitLoad > 0 ? inr(preview.preview.tax.exitLoad) : 'nil'}</b></div>
                <div className="f-step"><span><b>Actually arriving</b></span>
                  <b className="num pos">{inr(preview.preview.lands)}</b></div>
                {preview.preview.sameCategory && (
                  <p className="f-note">
                    Both funds do the same job. Switching between them changes the name on the folio and
                    the tax you pay, and very little else.
                  </p>
                )}
                <form action={switchFunds}>
                  <input type="hidden" name="from" value={switchFrom} />
                  <input type="hidden" name="to" value={switchTo} />
                  <input type="hidden" name="amount" value={switchAmount} />
                  <button className="f-btn" type="submit">Switch it</button>
                </form>
              </div>
            )}

            <details className="f-acc" style={{ marginTop: 10 }}>
              <summary><Icon name="chev" /> Do it monthly instead</summary>
              <div className="body">
                <p className="f-note" style={{ margin: '0 0 10px' }}>
                  A transfer moves a fixed sum between two of your funds every month. Taking it out to
                  your bank instead is a withdrawal — each one is a sale, and each one is taxed.
                </p>
                <form action={startTransferPlan}>
                  <input type="hidden" name="from" value={switchFrom} />
                  <input type="hidden" name="to" value={switchTo || ''} />
                  <input type="hidden" name="day" value="10" />
                  <input type="hidden" name="amount" value="5000" />
                  <div className="f-btnrow" style={{ marginTop: 0 }}>
                    <button className="f-btn ghost" type="submit" name="kind" value="STP" style={{ marginTop: 0 }}>
                      ₹5,000 across, monthly
                    </button>
                    <button className="f-btn ghost" type="submit" name="kind" value="SWP" style={{ marginTop: 0 }}>
                      ₹5,000 out, monthly
                    </button>
                  </div>
                </form>
              </div>
            </details>
          </div>
        </>
      )}

      {/* ── a fund with no price yet ──────────────────────────────────────── */}
      {nfos.map(n => (
        <div className="f-card f-act" key={n.scheme_id}>
          <div className="f-k">
            <Icon name="spark" /> Open now
            <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>
              {n.days_left} days left
            </span>
          </div>
          <div className="t">{n.name}</div>
          <div className="s">{n.objective}</div>
          <div className="f-step" style={{ marginTop: 10 }}>
            <span>Units allotted at</span><b className="num">₹{n.face_value}</b>
          </div>
          <div className="f-step"><span>Offer shuts</span><b>{dmy(n.closes_on)}</b></div>
          <div className="f-step"><span>Smallest application</span><b className="num">{inr(n.min_amount)}</b></div>
          <p className="f-note">
            A new fund has no record, so nothing on this page can tell you how it has done. What you are
            buying is the manager and the mandate. Nothing appears in your portfolio until the offer
            shuts and units are allotted.
          </p>
          <form action={applyToNfo}>
            <input type="hidden" name="scheme" value={n.scheme_id} />
            <div className="f-btnrow" style={{ marginTop: 0 }}>
              {[n.min_amount, n.min_amount * 5, n.min_amount * 10].map(a => (
                <button key={a} className="f-btn ghost" type="submit" name="amount" value={a} style={{ marginTop: 0 }}>
                  {inrCompact(a)}
                </button>
              ))}
            </div>
          </form>
        </div>
      ))}
    </>
  );
}
