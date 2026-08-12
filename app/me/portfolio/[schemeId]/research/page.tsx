import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../../components/Icon';
import { dmy } from '../../../../../lib/format';
import { fundHoldingRows, categoryPerformance } from '../../../../../lib/portfolio';
import { fundMeta } from '../../../../../lib/me';
import {
  manager as fundManager, handovers, commentary, riskStats, styleHistory, drift,
  peers, overlapWith, findings, SEEDED_NOTE, type Finding as FundFinding,
} from '../../../../../lib/funds';
import { FolioStyleBox, FolioCapture } from '../../../folio-charts';
import { ME } from '../../../layout';

export const dynamic = 'force-dynamic';

/**
 * The research behind one fund: who runs it, what its record says, and the
 * evidence under both.
 *
 * It is a page of its own rather than more of the fund page because DESIGN.md
 * caps a reading surface at 2.5 screens and the fund page was already at 2.0.
 * Measured at 3.34 when all of this sat on it. Two surfaces, each inside the
 * contract, beats one that breaks it.
 */

/** One five-part finding. Same block whether it is open or behind the tap. */
function Finding({ f }: { f: FundFinding }) {
  return (
    <div className="f-lever">
      <div className="lh">
        <b>{f.finding}</b>
        <span className="pts" style={{
          color: f.confidence === 'high' ? 'var(--f-pos)' : f.confidence === 'low' ? 'var(--f-faint)' : 'var(--f-gold)',
          background: 'var(--f-gold-soft)',
        }}>{f.confidence}</span>
      </div>
      <div className="ld"><b style={{ color: 'var(--f-ink)' }}>{f.number}</b></div>
      <div className="ld">Instead — {f.alternative}</div>
      <div className="ld">Doing nothing — {f.cost}</div>
      <div className="gh">{f.why_confidence}</div>
    </div>
  );
}

export default async function Research({ params }: PageProps<'/me/portfolio/[schemeId]/research'>) {
  const { schemeId } = await params;
  const sid = Number(schemeId);
  const meta = fundMeta(sid);
  if (!meta) notFound();

  const cat = categoryPerformance(ME).value.find(c => c.category === meta.category);
  const holdings = fundHoldingRows(sid);
  const mgr = fundManager(sid);
  const hands = handovers(sid);
  const note = commentary(sid);
  const risk = riskStats(sid);
  const style = styleHistory(sid);
  const sd = drift(sid);
  const nb = peers(sid);
  const laps = overlapWith(ME, sid);
  const says = findings(ME, sid);

  return (
    <>
      <Link href={`/me/portfolio/${sid}`} className="f-note" style={{ display: 'inline-block', margin: '0 2px 8px' }}>
        <Icon name="back" /> {meta.short.replace(/ (Dir|Reg) ?Gr$/, '')}
      </Link>

      <p className="f-hello" style={{ fontSize: 22 }}>What we know about this fund.</p>

      {/* ── the person running it, which research/22 ranks second only to returns ── */}
      <div className="f-sect">Who runs it</div>
      <div className="f-card">
        {mgr ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="mk" style={{
                width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center',
                background: 'var(--f-gold-soft)', color: 'var(--f-gold-ink)', fontSize: 12, fontWeight: 700, flexShrink: 0,
              }}>{mgr.name.split(' ').map(w => w[0]).slice(0, 2).join('')}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ fontSize: 14.5, fontWeight: 650, display: 'block' }}>{mgr.name}</b>
                <span style={{ fontSize: 11.5, color: 'var(--f-faint)' }}>
                  Running this fund {mgr.months >= 24 ? `${Math.floor(mgr.months / 12)} years` : `${mgr.months} months`}
                  {mgr.qualification ? ` · ${mgr.qualification}` : ''}
                  {mgr.managing_since ? ` · managing money since ${mgr.managing_since}` : ''}
                </span>
              </span>
            </div>

            {hands.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--f-line)' }}>
                {hands.map(hv => (
                  <div className="f-ins" key={hv.on} style={{ padding: '8px 0' }}>
                    <span className="g"><Icon name="alert" /></span>
                    <span className="tx">
                      <span className="d">Changed hands · {dmy(hv.on)}</span>
                      <b>{hv.to_name}</b> took this fund from <b>{hv.from_name}</b>
                      {hv.reason ? `, who ${hv.reason}` : ''} — {hv.months_ago} months ago
                      {hv.months_ago < 36 && `, so ${36 - hv.months_ago} of its three-year record is somebody else's work`}.
                    </span>
                  </div>
                ))}
              </div>
            )}

            {note && (
              <details className="f-acc" style={{ marginTop: 6 }}>
                <summary>
                  <Icon name="chev" /> {note.headline}
                  <span className="rt">{dmy(note.as_of).slice(3)}</span>
                </summary>
                <div className="body" style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--f-muted)' }}>
                  <b style={{ color: 'var(--f-ink)' }}>How {mgr.first} invests.</b> {mgr.philosophy}
                  <div style={{ marginTop: 10 }}>{note.body}</div>
                  <div style={{ marginTop: 8, fontSize: 11, color: 'var(--f-faint)' }}>
                    {note.manager}, {dmy(note.as_of)}.
                  </div>
                </div>
              </details>
            )}

            <p className="f-note" style={{ marginBottom: 0 }}>
              From the research feed. {SEEDED_NOTE}
            </p>
          </>
        ) : (
          <p className="f-note" style={{ margin: 0 }}>
            <span className="f-dash">—</span> Nobody is on file as running this fund. That is a gap in our data
            rather than a fund without a manager, and it is the kind of gap we would rather print than paper over.
          </p>
        )}
      </div>

      {/* ── what this fund's own data says: five parts each, or it is not said ── */}
      {says.length > 0 && (
        <>
          <div className="f-sect">What its record says</div>
          <div className="f-card">
            {/* The first finding stands open; the rest sit one tap down. A fund
                page is a reading surface, capped at 2.5 screens — measured at
                3.34 with every finding expanded. */}
            {says.slice(0, 1).map(f => <Finding key={f.key} f={f} />)}
            {says.length > 1 && (
              <details className="f-acc">
                <summary>
                  <Icon name="chev" /> {says.length - 1} more thing{says.length === 2 ? '' : 's'} its record says
                  <span className="rt">{says.slice(1).map(f => f.confidence).join(' · ')}</span>
                </summary>
                <div className="body">
                  {says.slice(1).map(f => <Finding key={f.key} f={f} />)}
                </div>
              </details>
            )}
            <p className="f-note" style={{ marginBottom: 0 }}>
              Each states the finding, its number, the alternative, the cost of doing nothing, and how
              sure we are. Missing any of the five and it is not printed.
            </p>
          </div>
        </>
      )}

      {/* ── the evidence, one tap down: DESIGN.md keeps this page under 2.5 screens ── */}
      <div className="f-sect">The evidence</div>
      <div className="f-card">
        {risk && (
          <details className="f-acc">
            <summary>
              <Icon name="chev" /> How it behaves when the market falls
              <span className="rt">{risk.downside_capture}% of the falls</span>
            </summary>
            <div className="body">
              <FolioCapture up={risk.upside_capture} down={risk.downside_capture} />
              <div className="f-step"><span>Worst peak-to-trough fall in {risk.period_months} months</span>
                <b className="neg">{risk.max_drawdown}%</b></div>
              <div className="f-step"><span>How much it moves, a year</span><b>{risk.std_dev}%</b></div>
              <div className="f-step"><span>Return per unit of that movement</span>
                <b>{risk.sharpe != null ? risk.sharpe : <span className="f-dash">—</span>}</b></div>
              <div className="f-step"><span>Months the index rose · fell</span>
                <b>{risk.months_up} · {risk.months_down}</b></div>
              <p className="f-note" style={{ marginBottom: 0 }}>
                Fall, movement and return-per-unit measured from {risk.period_months} months of this
                fund&rsquo;s own prices. {risk.capture_is_seeded && <>Capture is not: {SEEDED_NOTE}</>}
              </p>
            </div>
          </details>
        )}

        {style.length > 0 && (
          <details className="f-acc">
            <summary>
              <Icon name="chev" /> The kind of companies it buys
              <span className="rt">{style[style.length - 1].box}</span>
            </summary>
            <div className="body">
              <FolioStyleBox points={style} />
              {sd?.says && (
                <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--f-muted)', marginTop: 8 }}>{sd.says}</p>
              )}
              <p className="f-note" style={{ marginBottom: 0 }}>
                Today from the {holdings.length} companies it discloses; earlier quarters stand in
                for a history we do not have. {SEEDED_NOTE}
              </p>
            </div>
          </details>
        )}

        {laps.length > 0 && (
          <details className="f-acc">
            <summary>
              <Icon name="chev" /> Where it repeats your other funds
              <span className="rt">{laps[0].shared_pct}% at most</span>
            </summary>
            <div className="body">
              {laps.map(o => (
                <div className="f-step" key={o.scheme_id}>
                  <span>{o.name.replace(/ (Dir|Reg) ?Gr$/, '')} — {o.shared} companies in common</span>
                  <b>{o.shared_pct}%</b>
                </div>
              ))}
              <p className="f-note" style={{ marginBottom: 0 }}>
                Computed from both funds&rsquo; own disclosed holdings, taking the smaller weight in each shared
                company. Two funds that overlap this much are one bet wearing two names.
              </p>
            </div>
          </details>
        )}

        <details className="f-acc">
          <summary>
            <Icon name="chev" /> The funds doing the same job
            <span className="rt">{nb.rank != null ? `${nb.rank} of ${nb.rows.length}` : '—'}</span>
          </summary>
          <div className="body">
            {nb.rows.length === 0 ? (
              <p className="f-note" style={{ margin: 0 }}>No peer group on record for this category yet.</p>
            ) : nb.rows.map(p => (
              <div className="f-step" key={p.scheme_id}>
                <span style={{ fontWeight: p.is_this ? 650 : 400, color: p.is_this ? 'var(--f-ink)' : undefined }}>
                  {(p.short ?? p.name).replace(/ (Dir|Reg) ?Gr$/, '')}
                  {p.is_this ? ' — this one' : ''}{p.is_pick ? ' · house pick' : ''}
                </span>
                <b className={`num ${(p.ret_3y ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  {p.ret_3y != null ? `${p.ret_3y}%` : <span className="f-dash">—</span>}
                </b>
              </div>
            ))}
            {cat && (
              <div className="f-step" style={{ borderTop: '1px solid var(--f-line)', marginTop: 6, paddingTop: 8 }}>
                <span>This category, average over a year</span><b>{cat.cat_avg_1y}%</b>
              </div>
            )}
            <p className="f-note" style={{ marginBottom: 0 }}>
              Three years of each fund&rsquo;s own NAV history. No rating decides this order.
            </p>
          </div>
        </details>
      </div>

    </>
  );
}
