import Link from 'next/link';
import { Icon, Trend } from '../../../components/Icon';
import { inr, inrCompact, signedInrCompact, dmy } from '../../../lib/format';
import { clientHoldings, clientSips, fundVerdict } from '../../../lib/client360';
import { lookThrough, fundOverlap } from '../../../lib/portfolio';
import { mirror, type MirrorEntry } from '../../../lib/mirror';
import { ME } from '../layout';
import { raise } from '../acts';

const SHADE = ['var(--f-ink)', 'var(--f-gold)', 'var(--f-muted)', 'var(--f-pos)', 'var(--f-neg)', 'var(--f-line)'];

/* ═══ what you own ═══ */
export function HoldingsTab() {
  const rows = clientHoldings(ME).rows;
  const sips = clientSips(ME).rows;
  const total = rows.reduce((s, h) => s + h.value, 0);

  return (
    <>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {rows.map(h => {
          const gain = h.value - h.invested;
          const v = fundVerdict(h);
          return (
            <Link key={h.scheme_id} href={`/me/portfolio/${h.scheme_id}`} className="f-row" style={{ alignItems: 'flex-start' }}>
              <span className="mk" style={{ marginTop: 2 }}>{h.fund_name.slice(0, 2).toUpperCase()}</span>
              <span className="nm">
                <b>{h.fund_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
                <span>
                  {h.fund_category} · {Math.round((h.value / total) * 100)}% of you
                  {v.verdict === 'lagging' && <> · <b style={{ color: 'var(--f-neg)', fontWeight: 700 }}>behind its index</b></>}
                  {v.verdict === 'watch' && <> · too young to judge</>}
                </span>
                <span style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                  <span>Put in <b style={{ color: 'var(--f-ink)', fontWeight: 650 }} className="num">{inrCompact(h.invested)}</b></span>
                  <span>Gain <b className={`num ${gain >= 0 ? 'pos' : 'neg'}`} style={{ fontWeight: 650 }}>{signedInrCompact(gain)}</b></span>
                </span>
              </span>
              <span className="fg">
                <b className="num">{inrCompact(h.value)}</b>
                <span className={`num ${(h.xirr ?? 0) >= 0 ? 'pos' : 'neg'}`}>
                  <Trend n={h.xirr ?? 0} /> {h.xirr != null ? `${h.xirr}%` : '—'}
                </span>
                <span style={{ color: 'var(--f-faint)', fontWeight: 400 }}>
                  {h.bmxirr != null ? `index ${h.bmxirr}%` : ''}
                </span>
              </span>
            </Link>
          );
        })}
      </div>

      <div className="f-sect">Standing instructions</div>
      {sips.length === 0 ? (
        <p className="f-note">Nothing runs automatically today. Any fund page can start a monthly instalment,
          a transfer or a withdrawal, and each one prints its own dated confirmation.</p>
      ) : (
        <div className="f-card">
          {sips.map(sip => {
            const missed = sip.missed ?? 0;
            return (
              <div key={sip.sip_id} style={{ paddingBottom: 4 }}>
                <div className="f-k" style={{ color: missed > 0 ? 'var(--f-neg)' : 'var(--f-pos)' }}>
                  <Icon name={missed > 0 ? 'alert' : 'check'} /> {missed > 0 ? 'At risk' : sip.is_live_sip ? 'Running' : 'Stopped'}
                </div>
                <div style={{ fontSize: 14, fontWeight: 650, marginTop: 7 }}>
                  {inr(sip.tr_amount)} monthly · {sip.fund_name?.replace(/ (Direct|Regular).*$/, '') ?? 'your fund'}
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--f-faint)', marginTop: 4, lineHeight: 1.5 }}>
                  Started {dmy(sip.start_date)} · the {sip.day_of_sip}th of each month
                  {sip.umrn && <> · mandate {sip.umrn}{sip.mandate_end ? ` ends ${dmy(sip.mandate_end)}` : ''}</>}
                  {missed > 0 && <><br /><b style={{ color: 'var(--f-neg)' }}>{missed} collection{missed > 1 ? 's' : ''} the bank refused</b></>}
                </div>
                {missed > 0 && (
                  <form action={raise}>
                    <input type="hidden" name="kind" value="fix_mandate" />
                    <input type="hidden" name="label" value="Re-authorise the bank mandate" />
                    <input type="hidden" name="evidence" value={`${missed} refused collections on ${sip.fund_name}`} />
                    <button className="f-btn" type="submit">Re-authorise it</button>
                  </form>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ═══ what it holds — every aggregate drills, and every row names its funds ═══ */
export function CompositionTab() {
  const lt = lookThrough(ME).value;
  const pairs = fundOverlap(ME);
  const bar = (rows: { label: string; pct: number }[]) => (
    <>
      <div className="f-seg">
        {rows.slice(0, 5).map((r, i) => <i key={r.label} style={{ width: `${r.pct}%`, background: SHADE[i] }} />)}
        <i style={{ flex: 1, background: 'var(--f-track)' }} />
      </div>
      <div className="f-legend">
        {rows.slice(0, 5).map((r, i) => (
          <span key={r.label}><b style={{ color: SHADE[i] }}>■</b>{r.label} {r.pct.toFixed(1)}%</span>
        ))}
      </div>
    </>
  );

  return (
    <>
      <div className="f-card">
        <div className="f-k"><Icon name="pie" /> Look-through</div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 8 }}>
          You own <b style={{ color: 'var(--f-ink)' }}>{lt.stocks.length} companies</b> and{' '}
          <b style={{ color: 'var(--f-ink)' }}>{lt.sectors.length} sectors</b> through your funds — you never bought
          one of them directly. {lt.coverage_pct.toFixed(1)}% of your money is disclosed this way
          {lt.as_of ? `, as at ${dmy(lt.as_of)}` : ''}.
        </p>
      </div>

      <details className="f-acc" open>
        <summary><Icon name="chev" /> Sectors <span className="rt">{lt.sectors.length}</span></summary>
        <div className="body">
          {bar(lt.sectors.map(s => ({ label: s.sector, pct: s.pct })))}
          {lt.sectors.slice(0, 6).map(s => (
            <Link key={s.sector} href={`/me/portfolio/sector/${encodeURIComponent(s.sector)}`} className="f-row">
              <span className="nm"><b>{s.sector}</b>
                <span>{lt.stocks.filter(x => x.sector === s.sector).length} companies</span></span>
              <span className="fg"><b className="num">{inrCompact(s.rupees)}</b><span className="num" style={{ color: 'var(--f-faint)' }}>{s.pct.toFixed(1)}%</span></span>
              <Icon name="chev" />
            </Link>
          ))}
        </div>
      </details>

      <details className="f-acc">
        <summary><Icon name="chev" /> Company size <span className="rt">{lt.caps.length} bands</span></summary>
        <div className="body">
          {bar(lt.caps.map(c => ({ label: c.band || 'Unclassified', pct: c.pct })))}
          {lt.caps.map(c => (
            <div key={c.band} className="f-row" style={{ cursor: 'default' }}>
              <span className="nm"><b>{c.band || 'Unclassified in the disclosure'}</b>
                <span>{lt.stocks.filter(x => (x.cap_band ?? '') === c.band).length} companies</span></span>
              <span className="fg"><b className="num">{inrCompact(c.rupees)}</b><span className="num" style={{ color: 'var(--f-faint)' }}>{c.pct.toFixed(1)}%</span></span>
            </div>
          ))}
        </div>
      </details>

      <details className="f-acc">
        <summary><Icon name="chev" /> Companies <span className="rt">{lt.stocks.length}</span></summary>
        <div className="body">
          {lt.stocks.slice(0, 8).map(s => (
            <Link key={s.stock} href={`/me/portfolio/company/${encodeURIComponent(s.stock)}`} className="f-row">
              <span className="nm"><b>{s.stock.replace(/ Limited$/, '')}</b>
                <span>{s.sector} · through {s.funds} of your fund{s.funds > 1 ? 's' : ''}</span></span>
              <span className="fg"><b className="num">{inrCompact(s.rupees)}</b><span className="num" style={{ color: 'var(--f-faint)' }}>{s.pct.toFixed(1)}%</span></span>
              <Icon name="chev" />
            </Link>
          ))}
          <Link href="/me/portfolio/register" className="f-btn ghost" style={{ display: 'block', textAlign: 'center', marginTop: 10 }}>
            All {lt.stocks.length} companies
          </Link>
        </div>
      </details>

      {pairs.length > 0 && (
        <details className="f-acc">
          <summary><Icon name="chev" /> Where your funds repeat <span className="rt">{lt.overlap_pct.toFixed(0)}%</span></summary>
          <div className="body">
            {pairs.map(p => (
              <div key={`${p.a}-${p.b}`} className="f-row" style={{ cursor: 'default' }}>
                <span className="nm"><b style={{ fontSize: 12 }}>{p.a.replace(/ (Direct|Regular).*$/, '')} × {p.b.replace(/ (Direct|Regular).*$/, '')}</b>
                  <span>{p.shared} companies in common</span></span>
                <span className="fg"><b className="num neg">{p.shared_pct}%</b></span>
              </div>
            ))}
            <p className="f-note">
              {lt.overlap_stocks} companies sit in two or more of your funds, carrying {lt.overlap_pct.toFixed(0)}% of the
              money we can see through. Three funds have not given you three engines.
            </p>
            <form action={raise}>
              <input type="hidden" name="kind" value="reduce_overlap" />
              <input type="hidden" name="label" value="Point new investing at a genuinely different book" />
              <input type="hidden" name="evidence" value={`${lt.overlap_pct.toFixed(0)}% overlap across ${lt.overlap_stocks} shared companies`} />
              <button className="f-btn" type="submit">Fix this without selling anything</button>
            </form>
          </div>
        </details>
      )}

      <div className="f-sect">What changed underneath</div>
      <div className="f-card">
        {[
          ['pie', 'Concentration', `Your largest sector is ${lt.sectors[0]?.sector ?? '—'} at ${lt.top_sector_pct.toFixed(1)}% — the ten biggest companies carry ${lt.top10_pct.toFixed(1)}% between them.`],
          ['link', 'Repetition', `${lt.overlap_stocks} companies are held by more than one of your funds, which is ${lt.overlap_pct.toFixed(1)}% of the money we can see through.`],
          ['info', 'Coverage', `${lt.coverage_pct.toFixed(1)}% of your portfolio discloses its holdings${lt.as_of ? ` as at ${dmy(lt.as_of)}` : ''}. The rest is cash and positions below the disclosure line, and is not guessed at.`],
        ].map(([g, t, tx]) => (
          <div className="f-ins" key={t}>
            <span className="g"><Icon name={g} /></span>
            <span className="tx"><span className="d">{t}</span>{tx}</span>
          </div>
        ))}
      </div>
      <p className="f-note">
        These are written by the composition itself, not typed. What each company did this quarter, and its strength
        against its peers, arrives with the market feed — until then those columns stay empty rather than estimated.
      </p>
    </>
  );
}

/* ═══ your decisions ═══ */
export function MirrorTab() {
  const entries = mirror(ME);
  if (!entries.length) {
    return <p className="f-note">Your first instalment writes the first entry here. Nothing is invented to fill the space.</p>;
  }
  return (
    <>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', margin: '0 2px 12px' }}>
        On the left, what you did. On the right, what it did to you. Every entry is computed from your own
        transactions — open one for its verdict.
      </p>
      {entries.map((e: MirrorEntry) => (
        <details className="f-card" key={e.key} style={{ padding: 0 }}>
          <summary style={{ listStyle: 'none', cursor: 'pointer', padding: '14px 16px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 9.5, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--f-faint)' }}>{e.when}</span>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 650, lineHeight: 1.4, marginTop: 4 }}>{e.deed}</span>
            </span>
            <span style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <span className={`num ${e.good ? 'pos' : 'neg'}`} style={{ fontSize: 16, fontWeight: 700, display: 'block' }}>{e.figure}</span>
              <span style={{ fontSize: 10, color: 'var(--f-faint)' }}>{e.caption}</span>
            </span>
          </summary>
          <div style={{ padding: '0 16px 15px' }}>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--f-muted)', margin: 0 }}>{e.verdict}</p>
            {(e.act || e.strikeable) && (
              <div className="f-btnrow">
                {e.act && (
                  <form action={raise} style={{ flex: 1 }}>
                    <input type="hidden" name="kind" value={e.act.kind} />
                    <input type="hidden" name="label" value={e.act.label} />
                    <input type="hidden" name="evidence" value={`Mirror · ${e.key}`} />
                    <button className="f-btn" type="submit" style={{ marginTop: 0 }}>{e.act.label}</button>
                  </form>
                )}
                {e.strikeable && (
                  <form action={raise} style={{ flex: 1 }}>
                    <input type="hidden" name="kind" value="strike_entry" />
                    <input type="hidden" name="label" value="Client says this exit was planned — retire the entry" />
                    <input type="hidden" name="evidence" value={`Mirror · ${e.key}`} />
                    <button className="f-btn ghost" type="submit" style={{ marginTop: 0 }}>It was planned — strike it</button>
                  </form>
                )}
              </div>
            )}
          </div>
        </details>
      ))}
      <p className="f-note">
        Nothing here is a judgement of you. It is arithmetic on dates you chose, priced this morning — and where an
        exit was planned all along, say so once and it leaves the ledger.
      </p>
    </>
  );
}
