import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HoldingsTable } from '../../../components/HoldingsTable';
import { Provenance } from '../../../components/Provenance';
import { inr, inrCompact, dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import {
  clientHeader, clientKpis, clientMix, clientHoldings, taxPosition,
  clientTxns, clientSips, familyMembers, clientActions, clientInteractions,
} from '../../../lib/client360';
import { captureNote } from './actions';

export const dynamic = 'force-dynamic';

const MIX_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)'];
const FY_LTCG_EXEMPTION = 125000;

const ACTION_LABEL: Record<string, string> = {
  sip_bounce_save: 'SIP bounce — save the plan',
  mandate_expiring: 'Mandate expiring',
  idle_no_sip: 'Invested, no SIP',
  concentration_review: 'Concentration risk',
  dormant_review: 'Dormant client',
  tax_window: 'Tax-harvest window',
  birthday_week: 'Birthday',
  campaign_responder: 'Campaign response',
  kyc_unstick: 'Onboarding stuck',
  manual: 'My task',
};

function sipStatus(s: { is_live_sip: number; missed: number | null; mandate_end: string | null }): { label: string; cls: string } {
  if (!s.is_live_sip) return { label: 'ceased', cls: 'stale' };
  if ((s.missed ?? 0) >= 2) return { label: `bounced ×${s.missed}`, cls: 'conc' };
  if (s.mandate_end && s.mandate_end <= '2026-09-21') return { label: `mandate ends ${dmy(s.mandate_end)}`, cls: 'conc' };
  return { label: 'live', cls: 'lt' };
}

export default async function Client360({ params }: PageProps<'/clients/[clientId]'>) {
  const { clientId } = await params;
  const id = Number(clientId);
  const head = clientHeader(id);
  if (!head) notFound();

  const kpis = clientKpis(id);
  const mix = clientMix(id);
  const mixTotal = mix.value.reduce((s, r) => s + r.v, 0);
  const holdings = clientHoldings(id);
  const tax = taxPosition(id);
  const txns = clientTxns(id);
  const sips = clientSips(id);
  const family = familyMembers(head.family_id);
  const acts = clientActions(id);
  const notes = clientInteractions(id);
  const pnl = kpis.value.v - kpis.value.invested;
  const liveSip = sips.rows.filter(s => s.is_live_sip);
  const monthlySip = liveSip.reduce((s, r) => s + r.tr_amount, 0);
  // Exemption headroom: booked losses don't consume the ₹1.25L LTCG exemption.
  const headroom = Math.max(0, FY_LTCG_EXEMPTION - Math.max(0, tax.value.real_lt));

  return (
    <>
      <div className="crumb"><Link href="/clients">My clients</Link> → Client 360</div>
      <div className="chead">
        <h1>{head.name}</h1>
        <span className="hchip">{head.family_name}</span>
        <span className="hchip">{head.risk}</span>
        <span className={`hchip ${head.kyc ? 'ok' : ''}`}>KYC {head.kyc ? '✓' : 'pending'}</span>
        <span className="hchip num">PAN ····{head.pan.slice(-4)}</span>
        {head.since && <span className="hchip">Investing since {dmy(head.since)}</span>}
      </div>
      <p className="denom">All figures as of {dmy(TODAY)} · every number opens to its source rows</p>

      <div className="cols">
        <div>
          <div className="cards six" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="card"><div className="body">
              <div className="k">Value <Provenance figure={kpis} /></div>
              <div className="v num">{inr(kpis.value.v)}</div>
              <div className="s">{holdings.rows.length} holdings</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Invested</div>
              <div className="v num">{inr(kpis.value.invested)}</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">P&amp;L</div>
              <div className={`v num ${pnl >= 0 ? 'good' : 'warn'}`}>{pnl >= 0 ? '+' : '−'}{inr(Math.abs(pnl))}</div>
              <div className="s num">{((pnl / kpis.value.invested) * 100).toFixed(1)}% absolute</div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">XIRR (blended) <Provenance figure={kpis} /></div>
              <div className={`v num ${(kpis.value.wx ?? 0) >= 0 ? 'good' : 'warn'}`}>{kpis.value.wx != null ? `${kpis.value.wx >= 0 ? '+' : ''}${kpis.value.wx}%` : '—'}</div>
              <div className="s num">
                benchmark: {kpis.value.bmx != null ? `+${kpis.value.bmx}%` : '—'}
                {kpis.value.wx != null && kpis.value.bmx != null && kpis.value.wx < kpis.value.bmx && ' — trailing it'}
              </div>
            </div></div>
            <div className="card"><div className="body">
              <div className="k">Monthly SIP</div>
              <div className={`v num ${liveSip.some(s => (s.missed ?? 0) >= 2) ? 'warn' : ''}`}>{monthlySip > 0 ? inr(monthlySip) : '—'}</div>
              <div className="s">
                {liveSip.length === 0 ? 'no live SIP — an opportunity' :
                  liveSip.some(s => (s.missed ?? 0) >= 2) ? `bounced — see SIPs below` : `${liveSip.length} live`}
              </div>
            </div></div>
          </div>

          <div className="vizrow" style={{ gridTemplateColumns: '1fr 1.2fr' }}>
            <div className="viz">
              <h4>Where the money sits <Provenance figure={mix} /></h4>
              <div className="stack">
                {mix.value.map((r, i) => (
                  <div key={r.label} style={{ flex: r.v, background: MIX_COLORS[i] ?? 'var(--grey)' }} title={`${r.label} ${inrCompact(r.v)}`} />
                ))}
              </div>
              <div className="lg">
                {mix.value.map((r, i) => (
                  <span key={r.label} style={{ ['--c' as string]: MIX_COLORS[i] ?? 'var(--grey)' }}>
                    <b>{r.label} {((r.v / mixTotal) * 100).toFixed(1)}%</b> {inrCompact(r.v)}
                  </span>
                ))}
              </div>
              {holdings.rows[0]?.weight != null && holdings.rows[0].weight > 45 && (
                <div className="mark">{head.risk} profile · <b>{holdings.rows[0].weight.toFixed(1)}%</b> sits in one fund — concentration worth a conversation</div>
              )}
            </div>
            <div className="viz">
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
              <div className="mark">
                <b>{inr(headroom)}</b> of tax-free LTCG headroom this FY — the proposal builder will consume lots against exactly this
              </div>
            </div>
          </div>

          <h2 className="sec">Holdings — every row opens into its purchase lots</h2>
          <HoldingsTable rows={holdings.rows} />

          <h2 className="sec">Transactions — {dmy(txns.from)} → {dmy(txns.to)} ({txns.rows.length})</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th>Date</th><th>Type</th><th>Fund</th><th>Folio</th><th className="r">Amount</th><th className="r">Units</th><th className="r">Price</th></tr></thead>
              <tbody>
                {txns.rows.map(t => (
                  <tr key={t.tr_id}>
                    <td className="num">{dmy(t.tr_date)}</td>
                    <td>{t.type_name}</td>
                    <td>{t.fund_name}</td>
                    <td className="num">{t.tr_folio_no}</td>
                    <td className={`r num ${t.flag === -1 ? 'down' : t.flag === 1 ? 'up' : ''}`}>
                      {t.flag === -1 ? '−' : t.flag === 1 ? '+' : ''}{inr(t.tr_amount)}
                    </td>
                    <td className="r num">{t.tr_units != null ? t.tr_units.toFixed(2) : '—'}</td>
                    <td className="r num">{t.tr_price != null ? t.tr_price.toFixed(2) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="sec">SIPs</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th>Fund</th><th className="r">₹/month</th><th className="r">Day</th><th>Started</th><th>Mandate</th><th>Status</th></tr></thead>
              <tbody>
                {sips.rows.length === 0 && <tr><td colSpan={6} className="d">No SIPs — propose one</td></tr>}
                {sips.rows.map(s => {
                  const st = sipStatus(s);
                  return (
                    <tr key={s.sip_id}>
                      <td>{s.fund_name ?? '—'}</td>
                      <td className="r num">{inr(s.tr_amount)}</td>
                      <td className="r num">{s.day_of_sip}</td>
                      <td className="num">{dmy(s.start_date)}</td>
                      <td className="num">{s.umrn ?? '—'}{s.mandate_end ? ` · ends ${dmy(s.mandate_end)}` : ''}</td>
                      <td><span className={`fchip ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 className="sec">Family — {head.family_name}</h2>
          <div className="tblwrap">
            <table>
              <thead><tr><th>Member</th><th className="r">Value</th><th className="r">XIRR (blended)</th><th className="r">Open actions</th></tr></thead>
              <tbody>
                {family.rows.map(m => (
                  <tr key={m.client_id}>
                    <td>{m.client_id === id ? m.name : <Link href={`/clients/${m.client_id}`}>{m.name}</Link>}{m.is_head === 1 && <span className="sub">head</span>}</td>
                    <td className="r num">{inr(m.v)}</td>
                    <td className="r num">{m.wx != null ? `${m.wx >= 0 ? '+' : ''}${m.wx}%` : '—'}</td>
                    <td className="r num">{m.open_actions}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td>Household total</td><td className="r num">{inr(family.rows.reduce((s, m) => s + m.v, 0))}</td><td></td><td className="r num">{family.rows.reduce((s, m) => s + m.open_actions, 0)}</td></tr>
              </tfoot>
            </table>
          </div>

          <h2 className="sec">Actions — this client</h2>
          {acts.open.length === 0 && <div className="empty">No open actions — the engine watches this client daily.</div>}
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
            <div className="d" style={{ marginTop: 8 }}>
              Closed: {acts.closed.map(a => `${ACTION_LABEL[a.action_type] ?? a.action_type} (${a.outcome_type ?? a.state}${a.closed_at ? `, ${dmy(a.closed_at)}` : ''})`).join(' · ')}
            </div>
          )}
        </div>

        <aside className="side">
          <div className="panel">
            <h3>Capture a conversation</h3>
            <form action={captureNote}>
              <input type="hidden" name="client_id" value={id} />
              <textarea name="note" rows={3} required placeholder={`Spoke to ${head.name.split(' ')[0]} — …`}
                style={{ width: '100%', border: '1px solid var(--line)', borderRadius: 4, padding: '6px 8px', fontSize: 12, fontFamily: 'inherit' }} />
              <label className="d" style={{ display: 'block', margin: '6px 0' }}>
                <input type="checkbox" name="mint" defaultChecked /> also mint a follow-up into Today
              </label>
              <button type="submit" style={{ background: 'var(--accent)', color: '#fff', border: 0, borderRadius: 4, padding: '5px 14px', fontSize: 12.5, cursor: 'pointer' }}>Save note</button>
            </form>
            {notes.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {notes.map(n => (
                  <div key={n.interaction_id} className="d" style={{ borderTop: '1px solid var(--line)', paddingTop: 6, marginTop: 6 }}>
                    <span className="outchip">{n.kind}</span> {n.transcript}
                    <br /><span className="num">{dmy(n.occurred_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="panel">
            <h3>Goals</h3>
            <div className="d ghosttxt">Goals module revived from the old backend — none recorded for this client yet. Slot stays honest, never invented.</div>
          </div>
        </aside>
      </div>
    </>
  );
}
