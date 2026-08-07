'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Short labels in the bar so it stays scannable; the question each page answers
// lives on the page itself, where there is room to say it properly.
const PAGES: [string, string][] = [
  ['/today', 'Today'],
  ['/clients', 'Clients'],
  ['/onboarding', 'Pipeline'],
  ['/earnings', 'Earnings'],
  ['/business', 'Growth'],
  ['/marketing', 'Campaigns'],
  ['/review-packs', 'Reviews'],
  ['/backend', 'Backend'],
  ['/admin', 'Rules'],
];

export function TopNav() {
  const path = usePathname();
  return (
    <nav>
      {PAGES.map(([href, label]) => (
        <Link key={href} href={href} className={path.startsWith(href) ? 'active' : ''}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
