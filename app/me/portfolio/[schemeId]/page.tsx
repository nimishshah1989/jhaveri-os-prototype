import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../components/Icon';
import { inr, inrCompact, signedInrCompact, dmy } from '../../../../lib/format';
import { clientHoldings, fundVerdict } from '../../../../lib/client360';
import { fundHoldingRows, categoryPerformance } from '../../../../lib/portfolio';
import { schemeGrades } from '../../../../lib/scoring';
import { fundMeta } from '../../../../lib/me';
import { ME } from '../../layout';
import { raise } from '../../acts';

export const dynamic = 'force-dynamic';

const LT_DAYS = 365;

export default async function Fund({ params }: PageProps<'/me/portfolio/[schemeId]'>) {
  const { schemeId } = await params;
  const sid = Number(schemeId);
  const meta = fundMeta(sid);
  if (!meta) notFound();

  const held = clientHoldings(ME).rows.find(h => h.scheme_id === sid) ?? null;
  const grade = schemeGrades().get(sid);
  const cat = categoryPerformance(ME).value.find(c => c.category === meta.category);
  const holdings = fundHoldingRows(sid);
  const gain = held ? held.value - held.invested : 0;

  // Tax and exit fee, computed lot by lot — printed before any button, never after.
  const lots = held?.lots ?? [];
  const lt = lots.filter(l => l.holding_days >= LT_DAYS);
  const st = lots.filter(l => l.holding_days < LT_DAYS);
  const ltGain = lt.reduce((s, l) => s + l.unreal_lt, 0);
  const stGain = st.reduce((s, l) => s + l.unreal_st, 0);
  const loadRs = st.reduce((s, l) => s + l.current_value, 0) * (meta.exit_load / 100);
  const nextFree = st.length
    ? st.map(l => new Date(Date.parse(l.purchase_date) + LT_DAYS * 864e5).toISOString().slice(0, 10)).sort()[0]
    : null;

  const leans = Object.entries(
    holdings.reduce<Record<string, number>>((a, h) => { a[h.sector] = (a[h.sector] ?? 0) + h.weight_pct; return a; }, {}),
  ).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <>
      <Link href="/me/portfolio" className="f-sect" style={{ margin: '4px 2px 10px' }}>
        <Icon name="back" /> Portfolio
      </Link>

      <div className="f-card">
        <div className="f-k">
          <span className="mk" style={{
            width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center',
            background: 'var(--f-gold-soft)', color: 'var(--f-gold)', fontSize: 9, fontWeight: 700,
          }}>{meta.short.slice(0, 2).toUpperCase()}</span>
          {meta.category} · {meta.asset}
          {meta.pick ? <span className="f-stamp rt">House pick</span> : null}
        </div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 21, fontWeight: 600, margin: '9px 0 0', lineHeight: 1.3 }}>
          {meta.name}
        </h1>
        <div style={{ fontSize: 11.5, color: 'var(--f-faint)', marginTop: 5 }}>
          {meta.amc} · NAV ₹{meta.nav} on {dmy(meta.nav_date)} · costs {meta.expense}% a year
          {grade ? ` · graded ${grade.grade}` : ''}
        </div>
      </div>

      {held ? (
        <>
          <div className="f-card">
            <div className="f-k"><Icon name="bank" /> Your position</div>
            <div className="f-big num" style={{ fontSize: 30 }}>{inr(held.value)}</div>
            <div className="f-trio">
              <div><div className="l">Put in</div><div className="v num">{inr(held.invested)}</div></div>
              <div><div className="l">Gain</div><div className={`v num ${gain >= 0 ? 'pos' : 'neg'}`}>{signedInrCompact(gain)}</div></div>
              <div><div className="l">Units</div><div className="v num">{held.units.toFixed(3)}</div></div>
            </div>
            <div style={{ marginTop: 14 }}>
              {([['You', held.xirr, true], ['This fund’s index', held.bmxirr, false]] as const).map(([label, v, mine]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6, fontSize: 11.5 }}>
                  <span style={{ width: 110, flexShrink: 0, color: 'var(--f-muted)' }}>{label}</span>
                  <span style={{ flex: 1, height: 9, background: 'var(--f-track)', position: 'relative' }}>
                    <i style={{
                      position: 'absolute', top: 0, bottom: 0, left: 0, display: 'block',
                      width: `${Math.min(100, (Math.abs(v ?? 0) / Math.max(1, Math.abs(held.xirr ?? 0), Math.abs(held.bmxirr ?? 0))) * 100)}%`,
                      background: mine ? 'var(--f-ink)' : 'var(--f-line)',
                    }} />
                  </span>
                  <b className={`num ${(v ?? 0) >= 0 ? 'pos' : 'neg'}`} style={{ width: 54, textAlign: 'right', fontWeight: 650 }}>
                    {v != null ? `${v}%` : '—'}
                  </b>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: 'var(--f-faint)', marginTop: 2 }}>
                Yearly, on your own dates and amounts. {fundVerdict(held).verdict === 'watch'
                  ? 'Held under six months — too young to judge, and we will not pretend otherwise.'
                  : fundVerdict(held).gap != null
                    ? `You are ${Math.abs(fundVerdict(held).gap!)} points ${fundVerdict(held).gap! >= 0 ? 'ahead of' : 'behind'} the index on the same dates.`
                    : ''}
              </div>
            </div>
          </div>

          <div className="f-card">
            <div className="f-k"><Icon name="file" /> If you sold today</div>
            <div className="f-step"><span>Long-term gain ({lt.length} lot{lt.length === 1 ? '' : 's'}, held over a year)</span><b>{inr(ltGain)}</b></div>
            <div className="f-step"><span>Short-term gain ({st.length} lot{st.length === 1 ? '' : 's'}, under a year)</span><b>{inr(stGain)}</b></div>
            <div className="f-step">
              <span>Exit fee at {meta.exit_load}% on units under a year</span>
              <b className={loadRs > 0 ? 'neg' : ''}>{loadRs > 0 ? inr(loadRs) : 'nil'}</b>
            </div>
            {nextFree && (
              <div className="f-step"><span>First of those units turns a year old</span><b>{dmy(nextFree)}</b></div>
            )}
            <p className="f-note" style={{ marginBottom: 0 }}>
              Computed from your {lots.length} purchase lots, oldest sold first. Notional until you actually sell —
              and the Folio prints this before the button, never after it.
            </p>
          </div>
        </>
      ) : (
        <div className="f-card">
          <div className="f-k"><Icon name="info" /> You do not hold this</div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 8 }}>
            Nothing of yours is in this fund, so there is no position to show. What follows is the fund itself.
          </p>
        </div>
      )}

      <div className="f-sect">Against its category</div>
      <div className="f-card">
        {cat ? (
          <>
            <div className="f-step"><span>This category, average over a year</span><b>{cat.cat_avg_1y}%</b></div>
            <div className="f-step"><span>Best in the category</span><b className="pos">{cat.best_1y}%</b></div>
            <div className="f-step"><span>Worst in the category</span><b className="neg">{cat.worst_1y}%</b></div>
            {cat.client_1y != null && (
              <div className="f-step"><span>Your money in it, over a year</span><b>{cat.client_1y}%</b></div>
            )}
            <div className="f-step"><span>Funds we track here</span><b>{cat.funds}</b></div>
          </>
        ) : (
          <p className="f-note" style={{ margin: 0 }}>No category comparison on record for this fund yet.</p>
        )}
      </div>

      <div className="f-sect">
        What it holds
        <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{holdings.length} positions</span>
      </div>
      {holdings.length === 0 ? (
        <p className="f-note">
          A lending or bullion book — company holdings do not apply here. Its record and its risk lines tell its story instead.
        </p>
      ) : (
        <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {holdings.slice(0, 6).map(r => (
            <Link key={r.stock_name} href={`/me/portfolio/company/${encodeURIComponent(r.stock_name)}`} className="f-row">
              <span className="nm">
                <b>{r.stock_name.replace(/ Limited$/, '')}</b>
                <span>{r.sector}{r.cap_band ? ` · ${r.cap_band}` : ''}</span>
              </span>
              <span className="fg">
                <b className="num">{r.weight_pct}%</b>
                {held && <span className="num" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>
                  {inrCompact(held.value * r.weight_pct / 100)} of you
                </span>}
              </span>
              <Icon name="chev" />
            </Link>
          ))}
          <div className="f-note" style={{ margin: '8px 2px 10px' }}>
            Leans {leans.map(([s, w]) => `${s} ${w.toFixed(1)}%`).join(' · ')} — from the fund&apos;s own disclosure,
            covering {holdings.reduce((s, h) => s + h.weight_pct, 0).toFixed(1)}% of it.
          </div>
        </div>
      )}

      <div className="f-sect">What you can do</div>
      <div className="f-card">
        <div className="f-btnrow" style={{ marginTop: 0 }}>
          <form action={raise} style={{ flex: 1 }}>
            <input type="hidden" name="kind" value="invest" />
            <input type="hidden" name="label" value={`Add to ${meta.short}`} />
            <input type="hidden" name="evidence" value={`fund page · ${meta.name}`} />
            <button className="f-btn" type="submit" style={{ marginTop: 0 }}>Add to this</button>
          </form>
          {held && (
            <form action={raise} style={{ flex: 1 }}>
              <input type="hidden" name="kind" value="redeem" />
              <input type="hidden" name="label" value={`Redeem from ${meta.short}`} />
              <input type="hidden" name="evidence" value={`long-term gain ${Math.round(ltGain)}, short-term ${Math.round(stGain)}, exit fee ${Math.round(loadRs)}`} />
              <button className="f-btn ghost" type="submit" style={{ marginTop: 0 }}>Take money out</button>
            </form>
          )}
        </div>
        <form action={raise}>
          <input type="hidden" name="kind" value="call_rm" />
          <input type="hidden" name="label" value={`Talk through ${meta.short}`} />
          <input type="hidden" name="evidence" value="fund page" />
          <button className="f-btn ghost" type="submit"><Icon name="chat" /> Talk it through first</button>
        </form>
        <p className="f-note" style={{ marginBottom: 0 }}>
          Risk label: <b>{meta.risk}</b>. Nothing here is advice — what fits you depends on your year, your taxes and
          your nerve, and that is a conversation with a person.
        </p>
      </div>
    </>
  );
}
