import Link from 'next/link';
import { clientHeader } from '../../../lib/client360';
import { clockSummary } from '../../../lib/clock';
import { nominees } from '../../../lib/desk';
import { ME } from '../layout';
import { Nothing } from '../empty';
import { AsksTab, DatesTab, PapersTab, FoliosTab, SettingsTab } from './tabs';

export const dynamic = 'force-dynamic';

/**
 * The Desk. A directory, and now a tabbed one — it had grown to 6.4 screens
 * across thirteen sections, which is past the point where scanning beats
 * searching. The tab strip is the Portfolio's, so both lenses split a long
 * surface the same way.
 *
 * The badge on a tab is not decoration: it is the only thing that tells a client
 * which room needs them without opening all five.
 */
const TABS: [string, string][] = [
  ['asks', 'Your asks'],
  ['dates', 'Dates ahead'],
  ['papers', 'Papers'],
  ['folios', 'Your folios'],
  ['settings', 'Settings'],
];

export default async function Desk({ searchParams }: PageProps<'/me/desk'>) {
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && TABS.some(([k]) => k === sp.tab) ? sp.tab : 'asks';
  const me = clientHeader(ME);
  if (!me) {
    return (<><div className="f-sect" style={{ margin: '4px 2px 8px' }}>Your desk</div><Nothing clientId={ME} page="desk" /></>);
  }
  const clock = clockSummary(ME);
  const nom = nominees(ME);
  // What each room is carrying, so a client can see where they are needed
  // without opening every one.
  const badge: Record<string, { n: number; bad: boolean } | null> = {
    asks: clock.open > 0 ? { n: clock.open, bad: clock.overdue > 0 } : null,
    folios: nom.missing > 0 ? { n: nom.missing, bad: true } : null,
  };

  return (
    <>
      <p className="f-hello" style={{ fontSize: 22 }}>Your desk.</p>

      <nav className="f-tabbar">
        {TABS.map(([key, label]) => {
          const b = badge[key];
          return (
            <Link key={key} href={`/me/desk?tab=${key}`} className={tab === key ? 'on' : ''}>
              {label}
              {b && (
                <i className={`f-pip${b.bad ? ' bad' : ''}`} aria-label={`${b.n} needing you`}>{b.n}</i>
              )}
            </Link>
          );
        })}
      </nav>

      {tab === 'asks' && <AsksTab />}
      {tab === 'dates' && <DatesTab />}
      {tab === 'papers' && <PapersTab />}
      {tab === 'folios' && <FoliosTab />}
      {tab === 'settings' && <SettingsTab />}
    </>
  );
}
