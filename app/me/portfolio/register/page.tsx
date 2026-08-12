import Link from 'next/link';
import { Icon } from '../../../../components/Icon';
import { inrCompact, dmy } from '../../../../lib/format';
import { lookThrough } from '../../../../lib/portfolio';
import { ME } from '../../layout';

export const dynamic = 'force-dynamic';

// Server-side search on a query param: no hydration, no client bundle, and the
// result is linkable — which matters when a client wants to send their accountant
// "look at what I own in banking".
export default async function Register({ searchParams }: PageProps<'/me/portfolio/register'>) {
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').trim();
  const lt = lookThrough(ME).value;
  const needle = q.toLowerCase();
  const rows = needle
    ? lt.stocks.filter(s => s.stock.toLowerCase().includes(needle) || s.sector.toLowerCase().includes(needle))
    : lt.stocks;
  const sum = rows.reduce((s, r) => s + r.rupees, 0);

  return (
    <>
      <Link href="/me/portfolio?tab=composition" className="f-sect" style={{ margin: '4px 2px 10px' }}>
        <Icon name="back" /> Composition
      </Link>

      <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, margin: '0 2px 4px' }}>
        Every company your money touches
      </h1>
      <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', margin: '0 2px 12px' }}>
        All {lt.stocks.length} of them, in your own rupees, through fund disclosures
        {lt.as_of ? ` of ${dmy(lt.as_of)}` : ''}. You never bought one directly.
      </p>

      <form className="f-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 13px' }}>
        <Icon name="search" />
        <input
          name="q" defaultValue={q} type="search" autoComplete="off"
          placeholder="a company, or a sector…"
          style={{
            flex: 1, border: 0, outline: 0, background: 'none', font: 'inherit',
            fontSize: 13.5, color: 'var(--f-ink)', minWidth: 0,
          }}
        />
        <button type="submit" className="f-btn" style={{ margin: 0, width: 'auto', padding: '8px 14px' }}>Find</button>
      </form>

      <div className="f-sect">
        {rows.length} of {lt.stocks.length}
        <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{inrCompact(sum)}</span>
      </div>

      {rows.length === 0 ? (
        <p className="f-note">
          Nothing under “{q}”. The register holds only what your funds actually disclosed
          {lt.as_of ? ` on ${dmy(lt.as_of)}` : ''} — it is not a search of the whole market.
        </p>
      ) : (
        <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {rows.map(s => (
            <Link key={s.stock} href={`/me/portfolio/company/${encodeURIComponent(s.stock)}`} className="f-row">
              <span className="nm">
                <b>{s.stock.replace(/ Limited$/, '')}</b>
                <span>{s.sector}{s.cap_band ? ` · ${s.cap_band}` : ''}{s.funds > 1 ? ` · ${s.funds} funds` : ''}</span>
              </span>
              <span className="fg">
                <b className="num">{inrCompact(s.rupees)}</b>
                <span className="num" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{s.pct.toFixed(2)}%</span>
              </span>
              <Icon name="chev" />
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
