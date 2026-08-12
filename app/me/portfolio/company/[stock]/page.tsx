import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Icon } from '../../../../../components/Icon';
import { inr, inrCompact } from '../../../../../lib/format';
import { clientKpis } from '../../../../../lib/client360';
import { stockVia } from '../../../../../lib/me';
import { ME } from '../../../layout';
import { raise } from '../../../acts';

export const dynamic = 'force-dynamic';

// The drill back. An exposure that cannot name the funds behind it is a dead end,
// and this lens does not have those.
export default async function Company({ params }: PageProps<'/me/portfolio/company/[stock]'>) {
  const { stock } = await params;
  const name = decodeURIComponent(stock);
  const d = stockVia(ME, name);
  if (!d.via.length) notFound();
  const total = clientKpis(ME).value.v;

  return (
    <>
      <Link href="/me/portfolio?tab=composition" className="f-sect" style={{ margin: '4px 2px 10px' }}>
        <Icon name="back" /> Composition
      </Link>

      <div className="f-card">
        <div className="f-k"><Icon name="bank" /> {d.sector ?? 'Company'}{d.cap ? ` · ${d.cap}-sized` : ''}</div>
        <h1 style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 600, margin: '8px 0 0', lineHeight: 1.25 }}>
          {name.replace(/ Limited$/, '')}
        </h1>
        <div className="f-big num" style={{ fontSize: 28 }}>{inr(d.total)}</div>
        <div className="f-trio">
          <div><div className="l">Share of you</div><div className="v num">{((d.total / total) * 100).toFixed(2)}%</div></div>
          <div><div className="l">Held through</div><div className="v num">{d.via.length} fund{d.via.length > 1 ? 's' : ''}</div></div>
          <div><div className="l">Bought by you</div><div className="v"><span className="f-dash">never</span></div></div>
        </div>
      </div>

      <div className="f-sect">Which of your funds hold it</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {d.via.map(v => (
          <Link key={v.scheme_id} href={`/me/portfolio/${v.scheme_id}`} className="f-row">
            <span className="mk">{v.fund.slice(0, 2).toUpperCase()}</span>
            <span className="nm">
              <b>{v.fund.replace(/ (Dir|Reg) ?Gr$/, '')}</b>
              <span>{v.weight_pct}% of that fund</span>
            </span>
            <span className="fg"><b className="num">{inrCompact(v.rupees)}</b></span>
            <Icon name="chev" />
          </Link>
        ))}
      </div>

      {d.via.length > 1 && (
        <div className="f-card">
          <div className="f-k"><Icon name="link" /> This is the overlap, seen close up</div>
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 8 }}>
            {d.via.length} of your funds hold this company, so a bad day for it is a bad day {d.via.length} times over.
            You cannot sell a share out of a fund — the only thing that changes this is which <i>funds</i> you own, and
            where new money goes.
          </p>
          <form action={raise}>
            <input type="hidden" name="kind" value="call_rm" />
            <input type="hidden" name="label" value={`Talk through the overlap around ${name.replace(/ Limited$/, '')}`} />
            <input type="hidden" name="evidence" value={`held through ${d.via.length} funds, ${d.total} rupees`} />
            <button className="f-btn ghost" type="submit"><Icon name="chat" /> Talk this through</button>
          </form>
        </div>
      )}
      <p className="f-note">
        You own this through your funds&apos; own disclosures, not directly. What it did this quarter and how it stands
        against its peers arrives with the market feed — until then that column stays empty rather than estimated.
      </p>
    </>
  );
}
