import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { heldAway, netWorth, lastImport } from '../../../lib/import';
import { manager } from '../../../lib/me';
import { FolioBars } from '../folio-charts';
import { ME } from '../layout';
import { raise } from '../acts';

/* ═══ held elsewhere ═══
   The half of a client's money we do not manage. Shown at the same weight as
   the half we do, and never added into a Jhaveri figure without the label that
   makes the sum honest. A folio we cannot price is counted and named rather
   than valued at zero — a zero would understate a net worth while every total
   still balanced, which is the worst kind of wrong. */

export function ElsewhereTab() {
  const rows = heldAway(ME);
  const nw = netWorth(ME);
  const rm = manager(ME);
  const run = lastImport();
  const both = rows.filter(r => r.also_with_us);

  if (rows.length === 0) {
    return (
      <>
        <div className="f-card">
          <div className="f-k"><Icon name="search" /> Nothing found elsewhere</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--f-muted)', marginTop: 9 }}>
            We asked MF Central for every mutual fund folio held against your PAN and it returned
            none beyond the ones you hold here. That is an answer, not an empty screen — if you know
            of a folio somewhere else, it is worth telling {rm?.first ?? 'your manager'}, because the
            registrars only see what was filed under this exact PAN.
          </p>
          <form action={raise}>
            <input type="hidden" name="kind" value="find_folios" />
            <input type="hidden" name="label" value="Look for folios MF Central did not return" />
            <input type="hidden" name="evidence" value="held-away tab · zero rows returned" />
            <button className="f-btn ghost" type="submit">I think something is missing</button>
          </form>
        </div>
        <p className="f-note">
          Checked {run ? dmy(run.at) : dmy(nw.as_of ?? '')} against MF Central, which covers both registrars.
        </p>
      </>
    );
  }

  return (
    <>
      {/* ── three figures, never one ─────────────────────────────────────── */}
      <div className="f-card">
        <div className="f-k"><Icon name="bank" /> Everything, wherever it is</div>
        <div className="f-big num">{inr(nw.everything)}</div>
        <div className="f-trio">
          <div><div className="l">With Jhaveri</div><div className="v num">{inrCompact(nw.with_us)}</div></div>
          <div><div className="l">Elsewhere</div><div className="v num">{inrCompact(nw.elsewhere)}</div></div>
          <div><div className="l">Folios found</div><div className="v num">{nw.folios}</div></div>
        </div>
        <div className="f-seg" style={{ marginTop: 14 }}>
          <i style={{ width: `${(nw.with_us / Math.max(1, nw.everything)) * 100}%`, background: 'var(--f-gold)' }} />
          <i style={{ width: `${(nw.elsewhere / Math.max(1, nw.everything)) * 100}%`, background: 'var(--f-muted)' }} />
        </div>
        <div className="f-legend">
          <span><b style={{ color: 'var(--f-gold-ink)' }}>■</b>
            {Math.round((nw.with_us / Math.max(1, nw.everything)) * 100)}% advised here</span>
          <span><b style={{ color: 'var(--f-muted)' }}>■</b>
            {Math.round((nw.elsewhere / Math.max(1, nw.everything)) * 100)}% not advised by us</span>
        </div>
        <p className="f-note" style={{ marginBottom: 0 }}>
          The only figure in this app that adds the two together. Nothing held elsewhere reaches your
          health score, your goals or your rate.
        </p>
      </div>

      {/* ── the folios themselves, priced on the same NAVs ────────────────── */}
      <div className="f-sect">
        What is sitting elsewhere
        <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{rows.length} folios</span>
      </div>
      <div className="f-card">
        <FolioBars rows={rows.map(r => ({
          name: r.amc_name.replace(/ (Asset Management|Mutual Fund|Asset Management Co Ltd).*$/, '').slice(0, 14),
          value: r.value,
          tone: r.also_with_us ? 'gold' : 'muted',
        }))} />
        <p className="f-note" style={{ marginBottom: 0 }}>
          A bar with no length is a folio we hold no NAV for.
        </p>
      </div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {rows.map(r => {
          const row = (
            <>
              <span className="mk" style={{ background: 'var(--f-track)', color: 'var(--f-muted)' }}>
                {r.amc_name.slice(0, 2).toUpperCase()}
              </span>
              <span className="nm">
                <b>{r.scheme_name.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
                <span>
                  {r.amc_name} · folio {r.folio_no} · {r.rta}
                  {r.also_with_us && <> · <b style={{ color: 'var(--f-gold-ink)', fontWeight: 700 }}>you hold this here too</b></>}
                </span>
              </span>
              <span className="fg">
                <b className="num">{r.value != null ? inrCompact(r.value) : <span className="f-dash">—</span>}</b>
                <span className="num" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>
                  {r.units.toLocaleString('en-IN')} units
                </span>
              </span>
            </>
          );
          // A row we can price drills to the fund; one we cannot has nowhere
          // honest to go, so it stays a row and the note below says why.
          return r.scheme_id != null
            ? <Link key={r.ha_id} href={`/me/portfolio/${r.scheme_id}`} className="f-row">{row}</Link>
            : <div key={r.ha_id} className="f-row" style={{ cursor: 'default' }}>{row}</div>;
        })}
      </div>

      {nw.unpriced > 0 && (
        <p className="f-note">
          {nw.unpriced} of these {nw.unpriced === 1 ? 'is' : 'are'} from a house Jhaveri does not
          distribute, so we have no NAV for {nw.unpriced === 1 ? 'it' : 'them'} and print a dash rather
          than a zero. {inrCompact(nw.everything)} is therefore the floor of what you own, not the
          whole of it — and that is the honest way round.
        </p>
      )}

      {/* ── the act ──────────────────────────────────────────────────────── */}
      <div className="f-card f-act">
        <div className="f-k"><Icon name="link" /> Bring them across</div>
        <div className="t">
          Move {rows.length} folio{rows.length === 1 ? '' : 's'} onto one statement
        </div>
        <div className="s">
          A change of distributor code. Nothing is sold; units, cost and the tax clock all stay put.
          Your overlap, tax and goals would then be computed on all of your money rather than
          {' '}{Math.round((nw.with_us / Math.max(1, nw.everything)) * 100)}% of it.
        </div>
        <form action={raise}>
          <input type="hidden" name="kind" value="consolidate" />
          <input type="hidden" name="label" value={`Bring ${rows.length} held-away folios across`} />
          <input type="hidden" name="evidence"
            value={`${inrCompact(nw.elsewhere)} across ${rows.length} folios, ${nw.unpriced} unpriceable, found via MF Central`} />
          <button className="f-btn" type="submit">Ask {rm?.first ?? 'my manager'} to start this</button>
        </form>
        <p className="f-note" style={{ marginBottom: 0 }}>No cost, no exit load. Paperwork, and ours to do.</p>
      </div>

      <p className="f-note">
        From MF Central against your PAN, {run ? dmy(run.at) : dmy(nw.as_of ?? '')}. Priced on the same
        NAVs as everything else you hold.
      </p>
    </>
  );
}
