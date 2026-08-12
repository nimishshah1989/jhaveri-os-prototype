import Link from 'next/link';
import { Icon } from '../../components/Icon';
import { clientHeader } from '../../lib/client360';
import { Lamp } from './lamp';
import './folio.css';

// The client lens. One demo client, the same way the broker lens fixes DEMO_SB.
// FOLIO_CLIENT is a server-side switch for walking the empty and unowned paths —
// it is an env var, never a query param, because this lens has no auth yet.
export const ME = Number(process.env.FOLIO_CLIENT ?? 101);

const TABS: [string, string, string][] = [
  ['/me', 'today', 'Today'],
  ['/me/portfolio', 'pie', 'Portfolio'],
  ['/me/discover', 'search', 'Discover'],
  ['/me/desk', 'desk', 'Desk'],
];

export default async function FolioLayout({ children }: LayoutProps<'/me'>) {
  const me = clientHeader(ME);
  const initials = (me?.name ?? 'You').split(' ').map(w => w[0]).slice(0, 2).join('');

  return (
    <div className="folio" data-theme="light">
      <div className="f-top">
        <span className="house">JHAVERI PRIVATE</span>
        <span className="rt">
          <Lamp />
          <Link href="/me/desk" className="f-av" aria-label="Your desk">{initials}</Link>
        </span>
      </div>
      <div className="f-scroll">{children}</div>
      <nav className="f-tabs">
        {TABS.map(([href, icon, label]) => (
          <Link key={href} href={href}>
            <Icon name={icon} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
