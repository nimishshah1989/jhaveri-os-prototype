import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dmy, dmy2, inrCompact } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { clientHeader, clientActions, clientSips, familyMembers } from '../../../lib/client360';
import {
  OverviewTab, HoldingsTab, TransactionsTab, SipsTab, ProfileTab, ActionsTab,
} from './tabs';
import { typeOf } from '../../../lib/queue-display';
import { AnalysisTab } from './analysis-tab';
import { HealthTab } from './health-tab';
import { GoalsTab } from './goals-tab';

export const dynamic = 'force-dynamic';

/**
 * Five, down from nine. Nothing was removed — the nine panels are all still here,
 * stacked inside the tab they belong to, which is what the consolidation actually
 * was: a client is read in four or five passes, not nine, and a broker holding
 * forty of these should not have to remember which of nine places a number lives.
 *
 * Performance is the money: how it did, what it holds, what moved.
 * Actionables is the work: what is wrong, what is open, what is scheduled.
 */
const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['goals', 'Goals'],
  ['performance', 'Performance'],
  ['actionables', 'Actionables'],
  ['profile', 'Profile & documents'],
];

/**
 * Where the old nine went. Every link already written into this product — and any
 * a broker has bookmarked — still lands on the panel it was pointing at, because
 * a URL that quietly stops working is worse than a tab bar that is one item too
 * long. The anchor carries them the rest of the way.
 */
const MOVED: Record<string, string> = {
  health: 'actionables', actions: 'actionables', sips: 'actionables',
  analysis: 'performance', holdings: 'performance', transactions: 'performance',
};

export default async function Client360({ params, searchParams }: PageProps<'/clients/[clientId]'>) {
  const { clientId } = await params;
  const sp = await searchParams;
  const asked = typeof sp.tab === 'string' ? sp.tab : 'overview';
  const tab = TABS.some(([k]) => k === asked) ? asked : (MOVED[asked] ?? 'overview');
  const id = Number(clientId);
  const head = clientHeader(id);
  if (!head) notFound();

  const acts = clientActions(id);
  const sips = clientSips(id).rows;
  const mandate = sips.find(s => s.umrn != null);
  const family = familyMembers(head.family_id);

  return (
    <>
      <div className="crumb"><Link href="/clients">My clients</Link> → Client 360</div>
      <div className="chead">
        <h1>{head.name}</h1>
        <span className="hchip">{head.family_name}</span>
        <span className="hchip">{head.risk}</span>
        <span className={`hchip ${head.kyc ? 'ok' : ''}`}>KYC {head.kyc ? '✓' : 'pending'}</span>
        <span className="hchip num" title="Masked — full PAN stays server-side">PAN ····{head.pan.slice(-4)}</span>
        {head.since && <span className="hchip">Client since {dmy(head.since)}</span>}
      </div>
      <p className="denom">All figures as of {dmy(TODAY)} · every number opens to its source rows</p>

      <div className="tabbar">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/clients/${id}?tab=${key}`} className={tab === key ? 'on' : ''}>
            {label}
          </Link>
        ))}
      </div>

      <div className="cols">
        <div>
          {tab === 'overview' && <OverviewTab id={id} head={head} />}
          {tab === 'goals' && <GoalsTab id={id} head={head} focus={typeof sp.g === 'string' ? sp.g : undefined} />}

          {tab === 'performance' && (
            <>
              <AnalysisTab id={id} head={head} funds={typeof sp.funds === 'string' ? sp.funds : undefined} fundFocus={typeof sp.fund === 'string' ? sp.fund : undefined} />
              <h2 className="sec" id="holdings">Holdings &amp; tax lots</h2>
              <HoldingsTab id={id} />
              <h2 className="sec" id="transactions">Transactions</h2>
              <TransactionsTab id={id} />
            </>
          )}

          {tab === 'actionables' && (
            <>
              <HealthTab id={id} head={head} focus={typeof sp.c === 'string' ? sp.c : undefined} />
              <h2 className="sec" id="sips">SIPs &amp; mandates</h2>
              <SipsTab id={id} />
              <h2 className="sec" id="actions">Actions &amp; notes</h2>
              <ActionsTab id={id} />
            </>
          )}

          {tab === 'profile' && <ProfileTab id={id} head={head} />}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Open for {head.name.split(' ')[0]}</h3>
            {acts.open.length === 0 && <div className="d">Nothing open — the engine watches daily.</div>}
            {acts.open.map(a => (
              <Link key={a.action_id} href={`/today?action=${a.action_id}`} className="op red">
                <b>{typeOf(a.action_type).label}</b>
                <span className="m">
                  {a.impact_score > 0 ? `${inrCompact(a.impact_score)} at stake · ` : ''}due {dmy2(a.sla_due)}
                </span>
              </Link>
            ))}
          </div>
          <div className="panel">
            <h3>Documents on file</h3>
            {mandate?.umrn && (
              <div className="doc">e-Mandate · {mandate.umrn}
                <span className={`st fchip ${mandate.mandate_end != null && mandate.mandate_end <= '2026-09-21' ? 'conc' : 'lt'}`}>
                  {mandate.mandate_end ? `ends ${dmy2(mandate.mandate_end)}` : 'active'}
                </span>
              </div>
            )}
            <div className="doc">KYC verification (KRA)<span className={`st fchip ${head.kyc ? 'lt' : 'conc'}`}>{head.kyc ? 'verified' : 'pending'}</span></div>
            <div className="doc">PAN ····{head.pan.slice(-4)}<span className="st fchip lt">on record</span></div>
            <div className="doc">Account statements / CAS<span className="st fchip ghosted">vault — real build</span></div>
            <div className="doc">Agreements &amp; forms<span className="st fchip ghosted">vault — real build</span></div>
            <div className="d" style={{ marginTop: 6 }}>What the firm actually holds, honestly labelled — the scanned-document vault ships in the real build.</div>
          </div>
          <div className="panel">
            <h3>Household</h3>
            {family.rows.length === 1
              ? <div className="d">{head.name.split(' ')[0]} is a single-member household. Multi-member families render the one-page map: people → holdings → gaps.</div>
              : <div className="d">{family.rows.length} members · {inrCompact(family.rows.reduce((s, m) => s + m.v, 0))} — full roll-up under Profile &amp; documents.</div>}
          </div>
        </aside>
      </div>
    </>
  );
}
