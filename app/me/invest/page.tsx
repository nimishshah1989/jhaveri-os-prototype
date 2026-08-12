import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { db } from '../../../lib/db';
import { taxOnRedeem, ORDER_RULES, exemptionIsAssumed } from '../../../lib/invest';
import { outlooks } from '../../../lib/goals';
import { clientHoldings } from '../../../lib/client360';
import { manager } from '../../../lib/me';
import { ME } from '../layout';
import { invest, redeem } from './actions';

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
    </>
  );
}
