import Link from 'next/link';
import { notFound } from 'next/navigation';
import { dmy, dmy2, inrCompact } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { clientHeader, clientActions, clientSips, familyMembers } from '../../../lib/client360';
import {
  OverviewTab, HoldingsTab, TransactionsTab, SipsTab, ProfileTab, ActionsTab, ACTION_LABEL,
} from './tabs';
import { AnalysisTab } from './analysis-tab';
import { HealthTab } from './health-tab';

export const dynamic = 'force-dynamic';

const TABS: [string, string][] = [
  ['overview', 'Overview'],
  ['health', 'Health & opportunities'],
  ['analysis', 'Portfolio analysis'],
  ['holdings', 'Holdings & tax lots'],
  ['transactions', 'Transactions'],
  ['sips', 'SIPs & mandates'],
  ['profile', 'Profile & documents'],
  ['actions', 'Actions & notes'],
];

export default async function Client360({ params, searchParams }: PageProps<'/clients/[clientId]'>) {
  const { clientId } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === 'string' && TABS.some(([k]) => k === sp.tab) ? sp.tab : 'overview';
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
          {tab === 'health' && <HealthTab id={id} head={head} focus={typeof sp.c === 'string' ? sp.c : undefined} />}
          {tab === 'analysis' && <AnalysisTab id={id} head={head} funds={typeof sp.funds === 'string' ? sp.funds : undefined} fundFocus={typeof sp.fund === 'string' ? sp.fund : undefined} />}
          {tab === 'holdings' && <HoldingsTab id={id} />}
          {tab === 'transactions' && <TransactionsTab id={id} />}
          {tab === 'sips' && <SipsTab id={id} />}
          {tab === 'profile' && <ProfileTab id={id} head={head} />}
          {tab === 'actions' && <ActionsTab id={id} />}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Open for {head.name.split(' ')[0]}</h3>
            {acts.open.length === 0 && <div className="d">Nothing open — the engine watches daily.</div>}
            {acts.open.map(a => (
              <div key={a.action_id} className="op red">
                <b>{ACTION_LABEL[a.action_type] ?? a.action_type}</b>
                <span className="m">
                  {a.impact_score > 0 ? `${inrCompact(a.impact_score)} at stake · ` : ''}due {dmy2(a.sla_due)}
                </span>
              </div>
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
