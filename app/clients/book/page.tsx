import Link from 'next/link';
import { PageHead } from '../../../components/PageHead';
import { Explain } from '../../../components/Explain';
import { dmy, inrCompact } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { broker } from '../../../lib/queries';
import { bookHeader } from '../../../lib/book';
import { OverviewTab, AllocationTab, LookThroughTab, FundsTab } from './tabs';

export const dynamic = 'force-dynamic';

// Client 360, with the client filter taken off. Same shell, same tab bar, same
// rule that every figure opens to its source — because a broker who has learned
// to read one client should not have to learn a second grammar to read all of
// them at once.
const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['allocation', 'Allocation'],
  ['lookthrough', 'Look-through'],
  ['funds', 'Funds & performance'],
];

export default async function MyBookPage({ searchParams }: PageProps<'/clients/book'>) {
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && TABS.some(([k]) => k === sp.tab) ? sp.tab : 'overview';
  const sector = typeof sp.sector === 'string' ? sp.sector : undefined;
  const me = broker();
  const head = bookHeader(me.code);
  const h = head.value;

  return (
    <>
      <div className="crumb"><Link href="/clients">My clients</Link> → My book</div>
      <PageHead
        title="My book" icon="money"
        question="What is my whole book actually invested in, underneath the fund names?"
        meta={`${me.name} · ${h.clients} clients · as of ${dmy(h.as_of ?? TODAY)}`}
      />
      <div className="denom">
        {inrCompact(h.aum)} across {h.schemes} funds and {h.folios} folios — the same rows the
        client pages read, with nobody&apos;s name attached
        <Explain teaser="Why this is not the Growth page">
          Growth answers whether the book grew and who moved it. This answers what the money is
          in. They share a total and nothing else: a book can be perfectly allocated and shrinking,
          or growing fast into one sector. Clients answers the third question — who needs a call.
        </Explain>
      </div>

      <div className="tabbar">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/clients/book?tab=${key}`} className={tab === key ? 'on' : ''}>
            {label}
          </Link>
        ))}
      </div>

      <div className="wide">
        <div>
          {tab === 'overview' && <OverviewTab code={me.code} head={h} />}
          {tab === 'allocation' && <AllocationTab code={me.code} head={h} />}
          {tab === 'lookthrough' && <LookThroughTab code={me.code} sector={sector} />}
          {tab === 'funds' && <FundsTab code={me.code} head={h} />}
        </div>
      </div>
    </>
  );
}
