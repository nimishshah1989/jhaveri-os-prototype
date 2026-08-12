import Link from 'next/link';
import { dmy } from '../lib/format';
import { TODAY } from '../mockdb/engines';
import { db } from '../lib/db';

export const dynamic = 'force-dynamic';

// The front door. A shared link used to land on /today, which hid the client lens
// entirely from anyone who did not already know it existed. Both lenses read the
// same database, so the lobby says that out loud rather than leaving it implied.

const LENSES: { href: string; name: string; who: string; line: string; pages: string[] }[] = [
  {
    href: '/today',
    name: 'The broker’s desk',
    who: 'Ravi Shankar Vyas · relationship manager',
    line: 'The book he is responsible for: who needs him today, what each client is worth, what he is owed, and the papers he owes them.',
    pages: ['Today', 'My clients', 'Client 360', 'Onboarding', 'My earnings', 'My business', 'Marketing', 'Review packs'],
  },
  {
    href: '/me',
    name: 'The client’s Folio',
    who: 'Meera Shah · ₹15.74L across three funds',
    line: 'The same money from her side: what needs authorising, what she owns and what it holds, what her decisions cost her, and one named human.',
    pages: ['Today', 'Portfolio', 'Discover', 'Desk'],
  },
];

export default function Lobby() {
  const n = db().prepare(
    `SELECT (SELECT COUNT(*) FROM client_master WHERE is_active=1) clients,
            (SELECT COUNT(*) FROM transaction_master WHERE is_active=1) txns,
            (SELECT COUNT(*) FROM scheme_master WHERE is_active=1) schemes`,
  ).get() as { clients: number; txns: number; schemes: number };

  return (
    <div className="lobby">
      <header>
        <span className="kick">Jhaveri OS · prototype</span>
        <h1>One book, read from two sides.</h1>
        <p>
          Every figure on either lens is computed from the same {n.txns.toLocaleString('en-IN')} transactions
          across {n.clients.toLocaleString('en-IN')} clients and {n.schemes} funds. Nothing is mocked up: an act
          taken in the client app appears on the broker&apos;s queue, because there is only one database underneath.
        </p>
      </header>

      <div className="lenses">
        {LENSES.map(l => (
          <Link key={l.href} href={l.href} className="lens">
            <span className="nm">{l.name}</span>
            <span className="who">{l.who}</span>
            <span className="line">{l.line}</span>
            <span className="pages">{l.pages.map(p => <i key={p}>{p}</i>)}</span>
            <span className="go">Open {l.href} →</span>
          </Link>
        ))}
      </div>

      <footer>
        <p>
          <b>The data is seeded, not real.</b> Meera Shah and every client in here are generated, and the
          figures are computed from that generated history — which is why every number reconciles and none of
          them belongs to a person.
        </p>
        <p>
          <b>Your clicks are real, and temporary.</b> Buttons genuinely write to the database. On a deployed
          copy those writes reset when the instance restarts, so nobody&apos;s exploring permanently changes
          what the next person sees.
        </p>
        <p>
          Priced to {dmy(TODAY)} · design contract in <code>prototype/DESIGN.md</code> ·
          {' '}<code>npm run verify:all</code> checks every figure against its own SQL.
        </p>
      </footer>
    </div>
  );
}
