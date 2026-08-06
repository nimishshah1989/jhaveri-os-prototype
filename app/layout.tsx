import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jhaveri OS',
  description: 'Broker operating system — prototype',
};

const BROKER_PAGES: [string, string][] = [
  ['/today', 'Today'],
  ['/clients', 'My clients'],
  ['/onboarding', 'Onboarding'],
  ['/earnings', 'My earnings'],
  ['/business', 'My business'],
  ['/marketing', 'Marketing'],
  ['/review-packs', 'Review pack'],
];

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <nav className="rail">
            <div className="brand">
              Jhaveri OS
              <small>Broker · Ravi Shankar Vyas</small>
            </div>
            <div className="section">Workspace</div>
            {BROKER_PAGES.map(([href, label]) => (
              <Link key={href} href={href} className={href === '/today' ? 'active' : ''}>
                {label}
              </Link>
            ))}
          </nav>
          <main className="main">{children}</main>
        </div>
      </body>
    </html>
  );
}
