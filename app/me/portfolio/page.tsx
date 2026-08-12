import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { inr, dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { clientKpis, clientHoldings } from '../../../lib/client360';
import { Nothing } from '../empty';
import { ME } from '../layout';
import { HoldingsTab, CompositionTab, MirrorTab } from './tabs';
import { HealthTab } from './health-tab';

export const dynamic = 'force-dynamic';

const TABS: [string, string][] = [
  ['holdings', 'What you own'],
  ['composition', 'What it holds'],
  ['health', 'How it is doing'],
  ['mirror', 'Your decisions'],
];

export default async function Portfolio({ searchParams }: PageProps<'/me/portfolio'>) {
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && TABS.some(([k]) => k === sp.tab) ? sp.tab : 'holdings';
  if (clientHoldings(ME).rows.length === 0) {
    return (
      <>
        <div className="f-sect" style={{ margin: '4px 2px 8px' }}>Your portfolio</div>
        <Nothing clientId={ME} page="portfolio" />
      </>
    );
  }
  const k = clientKpis(ME).value;
  const earned = k.v - k.invested;

  return (
    <>
      <div className="f-sect" style={{ margin: '4px 2px 8px' }}>
        Your portfolio · priced {dmy(TODAY)}
      </div>

      <div className="f-card" style={{ paddingBottom: 12 }}>
        <div className="f-big num" style={{ marginTop: 0 }}>{inr(k.v)}</div>
        <div className="f-trio">
          <div><div className="l">Put in</div><div className="v num">{inr(k.invested)}</div></div>
          <div>
            <div className="l">Earned</div>
            <div className={`v num ${earned >= 0 ? 'pos' : 'neg'}`}>{inr(earned)}</div>
          </div>
          <div>
            <div className="l">Your rate</div>
            <div className="v num">{k.wx != null ? `${k.wx}%` : <span className="f-dash">—</span>}</div>
          </div>
        </div>
      </div>

      <nav className="f-tabbar">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/me/portfolio?tab=${key}`} className={tab === key ? 'on' : ''}>
            {label}
          </Link>
        ))}
      </nav>

      {tab === 'holdings' && <HoldingsTab />}
      {tab === 'composition' && <CompositionTab />}
      {tab === 'health' && <HealthTab />}
      {tab === 'mirror' && <MirrorTab />}

      <p className="f-note">
        Every figure computed from your own folios. <Link href="/me/desk" style={{ color: 'var(--f-gold)', fontWeight: 650 }}>
          The Desk <Icon name="chev" /></Link> holds the papers behind them.
      </p>
    </>
  );
}
