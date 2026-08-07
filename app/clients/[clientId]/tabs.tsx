import Link from 'next/link';
import { HoldingsTable } from '../../../components/HoldingsTable';
import { Provenance } from '../../../components/Provenance';
import { inr, inrCompact, dmy, dmy2 } from '../../../lib/format';
import {
  clientKpis, clientCategoryMix, clientHoldings, taxPosition, clientTxns, clientSips,
  familyMembers, clientActions, clientInteractions, journeySeries, fundVerdict,
  schemeInfo, riskScale, profileInfo, sipBounceTxns,
  type ClientHeader, type Verdict,
} from '../../../lib/client360';
import { captureNote } from './actions';
import { mintForClients } from '../../clients/actions';

const MIX_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const FY_LTCG_EXEMPTION = 125000;

export const ACTION_LABEL: Record<string, string> = {
  sip_bounce_save: 'SIP bounce — save the plan',
  kyc_unstick: 'Onboarding stuck',
  mandate_expiring: 'Mandate expiring',
  idle_no_sip: 'Invested, no SIP',
  concentration_review: 'Concentration risk',
  dormant_review: 'Dormant client',
  tax_window: 'Tax-harvest window',
  birthday_week: 'Birthday',
  campaign_responder: 'Campaign response',
  manual: 'Follow up',
};

const VERDICT_UI: Record<Verdict, { label: string; cls: string; card: string }> = {
  on_track: { label: 'On track', cls: 'ok', card: 'good' },
  lagging: { label: 'Lagging', cls: 'lag', card: 'bad' },
  watch: { label: 'Watch — young holding', cls: 'watch', card: '' },
};

export function OverviewTab({ id, head }: { id: number; head: ClientHeader }) {
  const kpis = clientKpis(id);
  const holdings = clientHoldings(id);
  const tax = taxPosition(id);
  const journey = journeySeries(id);
  const acts = clientActions(id);
  const bounces = sipBounceTxns(id);
  const sips = clientSips(id).rows.filter(s => s.is_live_sip);
  const pnl = kpis.value.v - kpis.value.invested;
  const monthlySip = sips.reduce((s, r) => s + r.tr_amount, 0);

  // Journey chart geometry — real points, value endpoint dotted in.
  const pts = journey.value;
  const ys = [...pts.map(p => p.cum), kpis.value.v];
  const yMin = Math.min(...ys) * 0.9, yMax = Math.max(...ys) * 1.05;
  const X = (i: number) => 10 + (i * 520) / Math.max(pts.length - 1, 1);
  const Y = (v: number) => 118 - ((v - yMin) / (yMax - yMin)) * 100;
  const poly = pts.map((p, i) => `${X(i)},${Y(p.cum)}`).join(' ');

  const gap = kpis.value.wx != null && kpis.value.bmx != null ? Math.round((kpis.value.bmx - kpis.value.wx) * 10) / 10 : null;
  const worst = [...holdings.rows].sort((a, b) => (a.xirr ?? 99) - (b.xirr ?? 99))[0];
  const mix = clientCategoryMix(id);
  const topCat = mix.value[0];
  const topHolding = holdings.rows[0];
  const topAction = acts.open[0];
  const headroom = Math.max(0, FY_LTCG_EXEMPTION - Math.max(0, tax.value.real_lt));

  return (
    <>
      <div className="cards six" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <div className="card"><div className="body">
          <div className="k">Value <Provenance figure={kpis} /></div>
          <div className="v num">{inr(kpis.value.v)}</div>
          <div className="s">{holdings.rows.length} funds</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Invested</div>
          <div className="v num">{inr(kpis.value.invested)}</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">P&amp;L</div>
          <div className={`v num ${pnl >= 0 ? 'good' : 'warn'}`}>{pnl >= 0 ? '' : '−'}{inr(Math.abs(pnl))}</div>
          <div className="s num">{((pnl / kpis.value.invested) * 100).toFixed(1)}% absolute</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">XIRR vs benchmark <Provenance figure={kpis} /></div>
          <div className={`v num ${(kpis.value.wx ?? 0) >= 0 ? 'good' : 'warn'}`}>{kpis.value.wx != null ? `${kpis.value.wx}%` : '—'}</div>
          <div className="s num">benchmark {kpis.value.bmx != null ? `${kpis.value.bmx}%` : '—'}{gap != null && gap > 0 ? ` — trailing by ${gap} pts` : ''}</div>
        </div></div>
        <div className="card"><div className="body">
          <div className="k">Monthly SIP</div>
          <div className={`v num ${bounces.length > 0 ? 'warn' : ''}`}>{monthlySip > 0 ? inr(monthlySip) : '—'}</div>
          <div className="s">{monthlySip === 0 ? 'no live SIP — an opportunity' : bounces.length > 0 ? `bounced ×${bounces.length}` : `${sips.length} live`}</div>
        </div></div>
      </div>

      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Investment journey <Provenance figure={journey} /></h4>
        <svg viewBox="0 0 600 140" style={{ width: '100%', height: 'auto' }} role="img"
          aria-label={`Cumulative investment from ${pts[0]?.m} to ${pts[pts.length - 1]?.m}, value today ${inr(kpis.value.v)}`}>
          <polyline fill="none" stroke="var(--s1)" strokeWidth="2" points={poly} />
          <line x1={X(pts.length - 1)} y1={Y(pts[pts.length - 1]?.cum ?? 0)} x2="575" y2={Y(kpis.value.v)} stroke="var(--s1)" strokeWidth="2" strokeDasharray="4 4" />
          <circle cx="575" cy={Y(kpis.value.v)} r="5" fill="var(--pos)" />
          <text x="10" y="134" fontSize="10" fill="var(--muted)">{pts[0]?.m} · {inrCompact(pts[0]?.cum ?? 0)} in</text>
          <text x="440" y={Y(kpis.value.v) - 9} fontSize="10" fill="var(--pos)">value today {inrCompact(kpis.value.v)}</text>
          {bounces.length > 0 && (
            <text x={X(pts.length - 1) - 150} y={Y(pts[pts.length - 1]?.cum ?? 0) - 8} fontSize="10" fill="var(--neg)">
              flat since {pts[pts.length - 1]?.m} — the bounces
            </text>
          )}
        </svg>
      </div>

      <div className="viz">
        <h4>The review, in three lines <span className="prov"><Provenance figure={{ tag: 'rule', sql: 'performance: blended XIRR vs benchmark blend, worst-gap fund named\ndiversification: top category share + top holding weight vs the 45% concentration rule\nact-now: highest-impact open action + FY harvest headroom', sources: ['fifo_summary_holding_active', 'actions', 'fifo_summary_holding'] }} /></span></h4>
        <ol className="narrative">
          <li>
            <b className={gap != null && gap > 2 ? 'down' : 'up'}>Performance:</b>{' '}
            {gap == null ? 'benchmark comparison pending.' : gap > 2
              ? `trailing the benchmark by ${gap} points — mainly ${worst?.fund_name} (${worst?.xirr}% against ${worst?.bmxirr}%).`
              : `tracking the benchmark (${kpis.value.wx}% vs ${kpis.value.bmx}%).`}
          </li>
          <li>
            <b className="opp" style={{ color: 'var(--amber)' }}>Diversification:</b>{' '}
            {topCat && `${((topCat.v / kpis.value.v) * 100).toFixed(1)}% sits in one category (${topCat.label})`}
            {topHolding?.weight != null && topHolding.weight > 45 && `, ${topHolding.weight.toFixed(1)}% in a single fund — heavy even for a ${head.risk} profile`}.
          </li>
          <li>
            <b className="down">Act now:</b>{' '}
            {topAction ? `${ACTION_LABEL[topAction.action_type] ?? topAction.action_type} (${inrCompact(topAction.impact_score)} at stake, due ${dmy(topAction.sla_due)})` : 'nothing urgent'}
            {headroom > 0 && `; separately, ${inrCompact(headroom)} of tax-free harvest headroom is open this FY`}.
          </li>
        </ol>
        <div className="d" style={{ marginTop: 8 }}>Every sentence computes from rules over this client&apos;s rows — never generated prose over money numbers.</div>
      </div>
    </>
  );
}

export function HoldingsTab({ id }: { id: number }) {
  const holdings = clientHoldings(id);
  const tax = taxPosition(id);
  const headroom = Math.max(0, FY_LTCG_EXEMPTION - Math.max(0, tax.value.real_lt));
  return (
    <>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Tax position — the lot-level truth <Provenance figure={tax} /></h4>
        <div className="taxg">
          <span className="lab">Unrealised LTCG</span>
          <span className="tb"><i style={{ width: `${Math.min(100, (Math.max(0, tax.value.unreal_lt) / FY_LTCG_EXEMPTION) * 100)}%` }} /></span>
          <span className="num">{inr(tax.value.unreal_lt)} of {inrCompact(FY_LTCG_EXEMPTION)} exemption</span>
          <span className="lab">Unrealised STCG</span>
          <span className="tb st"><i style={{ width: `${Math.min(100, (Math.max(0, tax.value.unreal_st) / FY_LTCG_EXEMPTION) * 100)}%` }} /></span>
          <span className="num">{inr(tax.value.unreal_st)} — taxed 20% if sold now</span>
          <span className="lab">Realised LTCG</span>
          <span className="tb"><i style={{ width: `${Math.min(100, (Math.abs(tax.value.real_lt) / FY_LTCG_EXEMPTION) * 100)}%` }} /></span>
          <span className="num">{tax.value.real_lt < 0 ? `−${inr(Math.abs(tax.value.real_lt))} (booked loss)` : inr(tax.value.real_lt)}</span>
        </div>
        <div className="mark"><b>{inr(headroom)}</b> of tax-free LTCG headroom this FY — the proposal builder will consume lots against exactly this.</div>
      </div>
      <HoldingsTable rows={holdings.rows} />
    </>
  );
}

export function TransactionsTab({ id }: { id: number }) {
  const txns = clientTxns(id);
  return (
    <>
      <div className="d" style={{ marginBottom: 10 }}>Showing {dmy(txns.from)} → {dmy(txns.to)} · {txns.rows.length} transactions — the actual range, not the requested one.</div>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Date</th><th>Type</th><th>Fund</th><th>Folio</th><th className="r">Amount</th><th className="r">Units</th><th className="r">Price</th></tr></thead>
          <tbody>
            {txns.rows.map(t => (
              <tr key={t.tr_id}>
                <td className="num" style={{ textAlign: 'center' }}>{dmy2(t.tr_date)}</td>
                <td>{t.type_name}</td>
                <td>{t.fund_name}</td>
                <td className="num">{t.tr_folio_no}</td>
                <td className={`r num ${t.flag === -1 ? 'down' : t.flag === 1 ? 'up' : ''}`}>{t.flag === -1 ? '−' : ''}{inr(t.tr_amount)}</td>
                <td className="r num">{t.tr_units != null ? t.tr_units.toFixed(2) : '—'}</td>
                <td className="r num">{t.tr_price != null ? t.tr_price.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function SipsTab({ id }: { id: number }) {
  const sips = clientSips(id);
  const bounces = sipBounceTxns(id);
  return (
    <>
      <div className="tblwrap" style={{ marginBottom: 18 }}>
        <table>
          <thead><tr><th>Fund</th><th className="r">₹/month</th><th>SIP day</th><th>Started</th><th>Mandate</th><th>Status</th></tr></thead>
          <tbody>
            {sips.rows.length === 0 && <tr><td colSpan={6} className="d">No SIPs — propose one</td></tr>}
            {sips.rows.map(s => {
              const bounced = (s.missed ?? 0) >= 2;
              const expiring = s.mandate_end != null && s.mandate_end <= '2026-09-21';
              return (
                <tr key={s.sip_id}>
                  <td>{s.fund_name ?? '—'}</td>
                  <td className="r num">{inr(s.tr_amount)}</td>
                  <td className="num" style={{ textAlign: 'center' }}>{s.day_of_sip}</td>
                  <td className="num" style={{ textAlign: 'center' }}>{dmy2(s.start_date)}</td>
                  <td className="num">{s.umrn ?? '—'}{s.mandate_end ? ` · ends ${dmy2(s.mandate_end)}` : ''}</td>
                  <td>
                    {!s.is_live_sip ? <span className="fchip stale">ceased</span>
                      : bounced ? <span className="fchip conc">bounced ×{s.missed}</span>
                        : expiring ? <span className="fchip conc">mandate expiring</span>
                          : <span className="fchip lt">live</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {bounces.length > 0 && (
        <div className="viz">
          <h4>Bounce history — the actual failed instalments</h4>
          {bounces.map((b, i) => (
            <div key={i} className="d" style={{ padding: '4px 0' }}>
              <b style={{ color: 'var(--neg)' }}>{dmy(b.tr_date)}</b> · {b.type_name} · {inr(b.tr_amount)} — insufficient balance
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function ProfileTab({ id, head }: { id: number; head: ClientHeader }) {
  const p = profileInfo(id);
  const family = familyMembers(head.family_id);
  return (
    <>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Profile</h4>
        <div className="taxg" style={{ gridTemplateColumns: 'auto 1fr' }}>
          <span className="lab">Mobile</span><span className="num">{p.mobile}</span>
          <span className="lab">Email</span><span>{p.email}</span>
          <span className="lab">Date of birth</span><span className="num">{dmy(p.dob)}</span>
          <span className="lab">Tax status</span><span>{p.tax_status}</span>
          <span className="lab">Risk profile</span><span>{head.risk}{p.risk_prof_date ? ` · assessed ${dmy(p.risk_prof_date)}` : ''}</span>
        </div>
      </div>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Consents — DPDP registry, enforced in every send query</h4>
        {p.consents.length === 0 && <div className="d">No consents recorded — nothing can be sent to this client.</div>}
        {p.consents.map((c, i) => (
          <div key={i} className="doc">{c.channel} · {c.purpose}<span className={`st fchip ${c.state === 'granted' ? 'lt' : 'conc'}`}>{c.state}</span></div>
        ))}
      </div>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Held-away money</h4>
        <div className="d ghosttxt">Upload this client&apos;s CAS to see holdings outside Jhaveri (HUB24 whole-of-wealth pattern) — real-build item, shown ghosted, never faked.</div>
      </div>
      <h2 className="sec" style={{ marginTop: 0 }}>Household — {head.family_name}</h2>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Member</th><th className="r">Value</th><th className="r">XIRR</th><th>Open actions</th></tr></thead>
          <tbody>
            {family.rows.map(m => (
              <tr key={m.client_id}>
                <td>{m.client_id === id ? m.name : <Link href={`/clients/${m.client_id}`}>{m.name}</Link>}{m.is_head === 1 && <span className="sub">head</span>}</td>
                <td className="r num">{inr(m.v)}</td>
                <td className="r num">{m.wx != null ? `${m.wx}%` : '—'}</td>
                <td className="num" style={{ textAlign: 'center' }}>{m.open_actions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function ActionsTab({ id }: { id: number }) {
  const acts = clientActions(id);
  const notes = clientInteractions(id);
  return (
    <>
      {acts.open.length === 0 && <div className="empty" style={{ marginBottom: 14 }}>No open actions — the engine watches this client daily.</div>}
      {acts.open.map(a => (
        <div key={a.action_id} className="qcard" style={{ borderLeftColor: 'var(--amber)' }}>
          <div className="top">
            <span className="type">{ACTION_LABEL[a.action_type] ?? a.action_type}</span>
            <span className="sla">due {dmy(a.sla_due)}</span>
            {a.impact_score > 0 && <span className="impact num">{inrCompact(a.impact_score)}</span>}
          </div>
          <div className="evidence">{Object.entries(JSON.parse(a.trigger_evidence) as Record<string, unknown>).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}</div>
        </div>
      ))}
      {acts.closed.length > 0 && (
        <div className="d" style={{ margin: '10px 0 18px' }}>
          Closed: {acts.closed.map(a => `${ACTION_LABEL[a.action_type] ?? a.action_type} (${a.outcome_type ?? a.state}${a.closed_at ? `, ${dmy2(a.closed_at)}` : ''})`).join(' · ')}
        </div>
      )}
      <div className="viz">
        <h4>Conversation timeline</h4>
        <form action={captureNote} style={{ marginBottom: 10 }}>
          <input type="hidden" name="client_id" value={id} />
          <textarea name="note" rows={3} required placeholder="What did the call cover?"
            style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 4, padding: '8px 10px', fontSize: 12.5, fontFamily: 'inherit' }} />
          <label className="d" style={{ display: 'block', margin: '8px 0' }}>
            <input type="checkbox" name="mint" defaultChecked /> also mint a follow-up into Today
          </label>
          <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 4, padding: '6px 16px', fontSize: 12.5, cursor: 'pointer' }}>Save note</button>
        </form>
        {notes.length === 0 && <div className="d ghosttxt">No conversations captured yet — the first note starts the timeline.</div>}
        {notes.map(n => (
          <div key={n.interaction_id} className="d" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
            <span className="outchip">{n.kind}</span> {n.transcript}
            <br /><span className="num">{dmy(n.occurred_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
