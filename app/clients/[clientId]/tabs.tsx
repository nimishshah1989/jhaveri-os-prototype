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
import { clientHealth, schemeGrades, SCORING_RULES } from '../../../lib/scoring';
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

const BAND_COLOR: Record<string, string> = { healthy: 'var(--pos)', 'needs work': 'var(--amber)', 'at risk': 'var(--neg)' };

export function HealthTab({ id, head }: { id: number; head: ClientHeader }) {
  const h = clientHealth(id);
  const sips = clientSips(id).rows.filter(s => s.is_live_sip);
  const monthly = sips.reduce((s, r) => s + r.tr_amount, 0);
  // Deterministic future value of a 10% SIP step-up over 5 years at an assumed 12%/yr.
  const stepUp = monthly > 0 ? Math.round((monthly * 0.1) * ((Math.pow(1.01, 60) - 1) / 0.01)) : 0;
  const txns = clientTxns(id);
  const lastSell = txns.rows.find(t => t.flag === -1);
  const boughtAfterSell = lastSell && txns.rows.some(t => t.flag === 1 && t.tr_date > lastSell.tr_date);

  return (
    <>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Portfolio health <Provenance figure={{ tag: 'rule', sql: `five components × 20 points, ${SCORING_RULES.version}\nweights live in lib/scoring.ts SCORING_RULES — the Admin rules page surfaces them; real build moves them to rules_registry`, sources: ['fifo_summary_holding_active', 'fifo_summary_holding', 'sip_master', 'bse_mandate_list', 'scheme_master.risk_level'] }} /></h4>
        <div className="scorehead">
          <div className="ring" style={{ ['--pct' as string]: h.total, ['--ringc' as string]: BAND_COLOR[h.band.label] }}>
            <i>{h.total}<small>of 100<br />{h.band.label}</small></i>
          </div>
          {h.gain > 0 && <span className="pill pot num">Reachable: {h.reachable} (+{h.gain})</span>}
          <span className="d" style={{ maxWidth: '46ch' }}>
            {h.gain > 0
              ? `The reachable score counts only levers available today — each one below is a concrete move with its points attached.`
              : 'No open levers — this portfolio is working as configured.'}
          </span>
        </div>
        {h.components.map(c => (
          <details key={c.key} className="comp-block" open={c.levers.length > 0}>
            <summary>
              <b>{c.label}</b>
              <span className="cbar"><i style={{ width: `${(c.score / 20) * 100}%`, background: c.score >= 14 ? 'var(--pos)' : c.score >= 8 ? 'var(--amber)' : 'var(--neg)' }} /></span>
              <span className="num" style={{ textAlign: 'right', fontWeight: 650 }}>{c.score}/20</span>
              <span className="why">{c.why}</span>
            </summary>
            <div className="levers">
              {c.levers.length === 0 && <div className="d">Nothing to fix here{c.score === 20 ? ' — full marks' : ''}.</div>}
              {c.levers.map(l => (
                <div key={l.key} className={`lever ${l.ghosted ? 'ghost' : ''}`}>
                  <b>{l.label}</b>
                  {l.detail && <span className="d">{l.detail}</span>}
                  {l.ghosted
                    ? <span className="d" style={{ fontStyle: 'italic' }}>{l.ghosted}</span>
                    : <>
                      <span className="delta num">+{l.delta} pts</span>
                      <form action={mintForClients}>
                        <input type="hidden" name="client_ids" value={id} />
                        <input type="hidden" name="note" value={`${l.label} — health lever (+${l.delta} pts) for ${head.name}`} />
                        <button type="submit">Mint action</button>
                      </form>
                    </>}
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>

      <div className="viz">
        <h4>More opportunities — not score-linked, still worth the call</h4>
        {monthly > 0 && (
          <div className="lever">
            <b>Step up the SIP by 10%</b>
            <span className="d">₹{Math.round(monthly * 0.1).toLocaleString('en-IN')}/month more ≈ ₹{stepUp.toLocaleString('en-IN')} extra in 5 years at an assumed 12%/yr — assumption shown, never hidden</span>
            <form action={mintForClients}>
              <input type="hidden" name="client_ids" value={id} />
              <input type="hidden" name="note" value={`Propose 10% SIP step-up for ${head.name}`} />
              <button type="submit">Mint action</button>
            </form>
          </div>
        )}
        {lastSell && !boughtAfterSell && (
          <div className="lever">
            <b>{inr(lastSell.tr_amount)} left the portfolio on {dmy(lastSell.tr_date)} — where did it land?</b>
            <span className="d">nothing has come back in since; if it sits in savings, that is idle money</span>
            <form action={mintForClients}>
              <input type="hidden" name="client_ids" value={id} />
              <input type="hidden" name="note" value={`Ask about the ${inr(lastSell.tr_amount)} redeemed ${dmy(lastSell.tr_date)} — redeploy?`} />
              <button type="submit">Mint action</button>
            </form>
          </div>
        )}
        {monthly === 0 && !lastSell && <div className="d">Nothing further right now.</div>}
      </div>
    </>
  );
}

export function AnalysisTab({ id, head }: { id: number; head: ClientHeader }) {
  const holdings = clientHoldings(id);
  const info = schemeInfo(id);
  const grades = schemeGrades();
  const mix = clientCategoryMix(id);
  const mixTotal = mix.value.reduce((s, r) => s + r.v, 0);
  const scale = riskScale(id, head.risk);

  return (
    <>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Fund report cards <Provenance figure={{ tag: 'rule', sql: 'verdict rule v1: holding age ≤ 180 days → watch; XIRR below benchmark by >10 pts → lagging; else on track', sources: ['fifo_summary_holding.sh_xirr', '.sh_bmxirr', 'scheme_master.scheme_expense_ratio', '.risk_level', '.is_jhaveri_pick'] }} /></h4>
        {holdings.rows.map(h => {
          const v = fundVerdict(h);
          const ui = VERDICT_UI[v.verdict];
          const si = info.get(h.scheme_id);
          const g = grades.get(h.scheme_id);
          return (
            <div key={h.scheme_id} className={`fundcard ${ui.card}`}>
              <span className="fn">
                {g && <span className={`gradechip g${g.grade}`} title={`Scheme grade ${g.grade} — 1y return ${g.ret1y}% vs category average ${g.cat_avg}% (percentile ${g.pctile}, expense- and house-view-adjusted)`} style={{ marginRight: 8 }}>{g.grade}</span>}
                {h.fund_name} <span className="d">{h.fund_category}{si?.pick === 1 && ' · Jhaveri pick ★'}</span>
              </span>
              <span><span className="m">Value</span><br /><span className="val num">{inr(h.value)}</span></span>
              <span><span className="m">XIRR / bench</span><br />
                <span className={`val num ${h.xirr != null && h.xirr < 0 ? 'down' : 'up'}`}>{h.xirr ?? '—'}%</span>
                <span className="val num"> / {h.bmxirr ?? '—'}%</span></span>
              <span><span className="m">Expense</span><br /><span className="val num">{si ? `${si.expense}%` : '—'}</span></span>
              <span><span className="m">Risk</span><br /><span className="val">{si?.risk_level ?? '—'}</span></span>
              <span className={`verdict ${ui.cls}`}>{ui.label}{v.verdict === 'lagging' && v.gap != null ? ` ${Math.abs(v.gap)} pts` : ''}</span>
            </div>
          );
        })}
        <div className="d">The verdict formula is a registered rule (gap vs benchmark × holding age), versioned, changeable without code — never a black box.</div>
      </div>

      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Category concentration <Provenance figure={mix} /></h4>
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
        <div className="mark">Category-level today, honestly labelled — true sector split (Banking/IT/Pharma) arrives with the fund-portfolio feed in the real build.</div>
      </div>

      <div className="viz">
        <h4>Risk appetite vs what the portfolio actually holds <Provenance figure={scale} /></h4>
        <div className="riskscale">
          <div className="track" />
          <div className="pin client" style={{ left: `${(scale.value.client / 5) * 96}%` }}>Profile · {head.risk}<i /></div>
          {scale.value.portfolio != null && (
            <div className="pin port" style={{ left: `${(scale.value.portfolio / 5) * 96}%`, top: 26 }}>Portfolio {scale.value.portfolio} / 5<i /></div>
          )}
        </div>
        <div className="scale-ends"><span>Conservative 1</span><span>Very Aggressive 5</span></div>
        <div className="d" style={{ marginTop: 10 }}>
          {scale.value.portfolio != null && Math.abs(scale.value.portfolio - scale.value.client) <= 0.5
            ? 'Profile and portfolio agree — suitability evidence on file for every proposal.'
            : 'Profile and portfolio diverge — flag for the next review.'}
        </div>
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
