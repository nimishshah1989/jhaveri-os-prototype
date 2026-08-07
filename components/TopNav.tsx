'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const PAGES: [string, string][] = [
  ['/today', 'Today'],
  ['/clients', 'My clients'],
  ['/onboarding', 'Onboarding'],
  ['/earnings', 'My earnings'],
  ['/business', 'My business'],
  ['/marketing', 'Marketing'],
  ['/review-packs', 'Review pack'],
  ['/admin', 'Admin'],
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
