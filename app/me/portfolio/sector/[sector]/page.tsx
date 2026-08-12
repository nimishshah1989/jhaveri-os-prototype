import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../../components/Icon';
import { inr, inrCompact } from '../../../../../lib/format';
import { clientKpis } from '../../../../../lib/client360';
import { sectorStocks } from '../../../../../lib/me';
import { ME } from '../../../layout';
import { raise } from '../../../acts';

export const dynamic = 'force-dynamic';

export default async function Sector({ params }: PageProps<'/me/portfolio/sector/[sector]'>) {
  const { sector } = await params;
  const name = decodeURIComponent(sector);
  const rows = sectorStocks(ME, name);
  if (!rows.length) notFound();
  const total = clientKpis(ME).value.v;
  const sum = rows.reduce((s, r) => s + r.rupees, 0);
  const shared = rows.filter(r => r.funds > 1).length;

  return (
    <>
      <Link href="/me/portfolio?tab=composition" className="f-sect" style={{ margin: '4px 2px 10px' }}>
        <Icon name="back" /> Composition
      </Link>

      <div className="f-card">
        <div className="f-k"><Icon name="pie" /> Sector</div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, margin: '8px 0 0' }}>{name}</h1>
        <div className="f-big num" style={{ fontSize: 28 }}>{inr(sum)}</div>
        <div className="f-trio">
          <div><div className="l">Share of you</div><div className="v num">{((sum / total) * 100).toFixed(1)}%</div></div>
          <div><div className="l">Companies</div><div className="v num">{rows.length}</div></div>
          <div><div className="l">In 2+ funds</div><div className="v num">{shared}</div></div>
        </div>
      </div>

      <div className="f-sect">The companies inside it</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {rows.map(r => (
          <Link key={r.stock} href={`/me/portfolio/company/${encodeURIComponent(r.stock)}`} className="f-row">
            <span className="nm">
              <b>{r.stock.replace(/ Limited$/, '')}</b>
              <span>{r.cap ?? 'unclassified'}{r.funds > 1 ? ` · through ${r.funds} of your funds` : ''}</span>
            </span>
            <span className="fg">
              <b className="num">{inrCompact(r.rupees)}</b>
              <span className="num" style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{((r.rupees / sum) * 100).toFixed(1)}% of sector</span>
            </span>
            <Icon name="chev" />
          </Link>
        ))}
      </div>

      <p className="f-note">
        Every one of these reached you through a fund&apos;s own disclosure — tap any name to see which of your funds
        bought it. Sector strength and what moved it this quarter arrive with the market feed.
      </p>

      <div className="f-card">
        <div className="f-k"><Icon name="info" /> What you can actually do about this</div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 8 }}>
          Nothing here is a share you can trade — your funds chose these, not you. A sector leaning this way changes
          only when the <i>funds</i> change, or when new money goes somewhere with a genuinely different book.
        </p>
        <form action={raise}>
          <input type="hidden" name="kind" value="call_rm" />
          <input type="hidden" name="label" value={`Talk through the ${name} weighting`} />
          <input type="hidden" name="evidence" value={`${name} is ${((sum / total) * 100).toFixed(1)}% across ${rows.length} companies`} />
          <button className="f-btn ghost" type="submit"><Icon name="chat" /> Talk this through</button>
        </form>
      </div>
    </>
  );
}
