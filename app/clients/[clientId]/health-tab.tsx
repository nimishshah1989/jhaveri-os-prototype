import Link from 'next/link';
import { Provenance } from '../../../components/Provenance';
import { inr, dmy, dmy2 } from '../../../lib/format';
import { clientSips, clientTxns, type ClientHeader } from '../../../lib/client360';
import { clientHealth, SCORING_RULES, type Component, type Lever } from '../../../lib/scoring';
import { chooseLever, declineLever, leverTrail } from './lever-actions';

const BAND_COLOR: Record<string, string> = { healthy: 'var(--pos)', 'needs work': 'var(--amber)', 'at risk': 'var(--neg)' };
const barColor = (score: number) => (score >= 14 ? 'var(--pos)' : score >= 8 ? 'var(--amber)' : 'var(--neg)');
const statusOf = (score: number) => (score >= 14 ? ['strong', 'lt'] : score >= 8 ? ['attention', 'conc'] : ['weak', 'atrisk']);

const DECLINE_REASONS = [
  ['client_declined', 'Client said no'],
  ['not_relevant', 'Not relevant for this client'],
  ['already_handled', 'Already handled off-platform'],
  ['bad_timing', 'Wrong time — revisit later'],
  ['data_looks_wrong', 'The data behind this looks wrong'],
];

/** Opportunities that carry no health points but still deserve a card. */
function extraOpportunities(id: number): { key: string; title: string; why: string; detail: string }[] {
  const out: { key: string; title: string; why: string; detail: string }[] = [];
  const live = clientSips(id).rows.filter(s => s.is_live_sip);
  const monthly = live.reduce((s, r) => s + r.tr_amount, 0);
  if (monthly > 0) {
    const fv = Math.round(monthly * 0.1 * ((Math.pow(1.01, 60) - 1) / 0.01));
    out.push({
      key: 'step_up',
      title: 'Step up the SIP by 10%',
      why: `${inr(Math.round(monthly * 0.1))}/month more`,
      detail: `About ${inr(fv)} extra in five years, assuming 12% a year — the assumption is shown, never hidden. The SIP has not been raised since it started.`,
    });
  }
  const txns = clientTxns(id);
  const lastSell = txns.rows.find(t => t.flag === -1);
  if (lastSell && !txns.rows.some(t => t.flag === 1 && t.tr_date > lastSell.tr_date)) {
    out.push({
      key: 'idle_redemption',
      title: 'Money left and never came back',
      why: `${inr(lastSell.tr_amount)} on ${dmy(lastSell.tr_date)}`,
      detail: 'Nothing has been invested since that redemption. If it is sitting in a savings account it is losing to inflation — worth one question on the next call.',
    });
  }
  return out;
}

function RecommendedAction({ id, componentKey, lever }: { id: number; componentKey: string; lever: Lever }) {
  if (lever.ghosted) {
    return (
      <div className="rec ghost">
        <div className="rtop"><b>{lever.label}</b></div>
        <div className="d" style={{ marginTop: 6, fontStyle: 'italic' }}>{lever.ghosted}</div>
      </div>
    );
  }
  const hidden = (
    <>
      <input type="hidden" name="client_id" value={id} />
      <input type="hidden" name="component" value={componentKey} />
      <input type="hidden" name="lever_key" value={lever.key} />
      <input type="hidden" name="label" value={lever.label} />
      <input type="hidden" name="delta" value={lever.delta} />
    </>
  );
  return (
    <div className="rec">
      <div className="rtop">
        <b>{lever.label}</b>
        <span className="delta num">+{lever.delta} pts</span>
      </div>
      {lever.detail && <div className="d" style={{ marginTop: 4 }}>{lever.detail}</div>}
      <div className="choices">
        <form action={chooseLever}>
          {hidden}
          <input type="hidden" name="mode" value="self" />
          <button type="submit" className="primary">I&apos;ll do this</button>
        </form>
        <form action={chooseLever}>
          {hidden}
          <input type="hidden" name="mode" value="rm" />
          <button type="submit">Hand to relationship manager</button>
        </form>
        <details>
          <summary>Not now…</summary>
          <form className="pop" action={declineLever}>
            {hidden}
            <select name="reason" required defaultValue="">
              <option value="" disabled>Why not? (required)</option>
              {DECLINE_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="submit">Log the decision</button>
          </form>
        </details>
        <span className="d" style={{ marginLeft: 'auto' }}>every choice is logged, including a no</span>
      </div>
    </div>
  );
}

function DeepDive({ id, head, c }: { id: number; head: ClientHeader; c: Component }) {
  const [status, cls] = statusOf(c.score);
  return (
    <>
      <div className="dive">
        <h3>{c.label} — {c.score} of 20 <span className={`fchip ${cls}`} style={{ verticalAlign: 'middle' }}>{status}</span></h3>
        <p className="lead">One of five components of {head.name.split(' ')[0]}&apos;s health score. {SCORING_RULES.version}</p>

        <h5>How this was calculated</h5>
        <div className="calc" style={{ marginBottom: 18 }}>
          {c.breakdown.map((s, i) => (
            <div key={i} style={{ display: 'contents' }}>
              <span className={`lbl ${i === c.breakdown.length - 1 ? 'tot' : ''}`}>{s.label}</span>
              <span className={`eff ${i === c.breakdown.length - 1 ? 'tot' : ''}`}>{s.effect}</span>
            </div>
          ))}
        </div>

        <h5>Where the challenge is</h5>
        {c.challenges.length === 0
          ? <div className="d" style={{ marginBottom: 18 }}>Nothing weak here — this component is doing its job.</div>
          : <div style={{ marginBottom: 18 }}>{c.challenges.map((ch, i) => <div key={i} className="chal">{ch}</div>)}</div>}

        <h5>What we recommend</h5>
        {c.levers.length === 0
          ? <div className="d">No move needed right now. If that changes, it appears here and on the broker&apos;s queue the same day.</div>
          : c.levers.map(l => <RecommendedAction key={l.key} id={id} componentKey={c.key} lever={l} />)}
      </div>
    </>
  );
}

export async function HealthTab({ id, head, focus }: { id: number; head: ClientHeader; focus?: string }) {
  const h = clientHealth(id);
  const extras = extraOpportunities(id);
  const trail = await leverTrail(id);
  const focused = h.components.find(c => c.key === focus);
  const focusedExtra = extras.find(e => e.key === focus);

  return (
    <>
      <div className="viz" style={{ marginBottom: 18 }}>
        <h4>Portfolio health <Provenance figure={{ tag: 'rule', sql: `five components × 20 points, ${SCORING_RULES.version}\nweights live in lib/scoring.ts SCORING_RULES — the Admin page shows them; the real build moves them into rules_registry`, sources: ['fifo_summary_holding_active', 'fifo_summary_holding', 'sip_master', 'bse_mandate_list', 'scheme_master.risk_level'] }} /></h4>
        <div className="scorehead">
          <div className="ring" style={{ ['--pct' as string]: h.total, ['--ringc' as string]: BAND_COLOR[h.band.label] }}>
            <i>{h.total}<small>of 100<br />{h.band.label}</small></i>
          </div>
          {h.gain > 0 && <span className="pill pot num">Reachable: {h.reachable} (+{h.gain})</span>}
          <span className="d" style={{ maxWidth: '48ch' }}>
            {h.gain > 0
              ? 'Open any card to see how its score was worked out, what is actually wrong, and what to do about it.'
              : 'No open levers — this portfolio is working as configured.'}
          </span>
        </div>
      </div>

      <div className="hcards">
        {h.components.map(c => {
          const [status, cls] = statusOf(c.score);
          const open = c.levers.filter(l => !l.ghosted);
          const pts = open.reduce((s, l) => s + l.delta, 0);
          return (
            <Link key={c.key} href={`/clients/${id}?tab=health&c=${c.key}`} className="hcard">
              <div className="name">{c.label} <span className={`fchip ${cls}`}>{status}</span></div>
              <div className="val num">{c.score}<small> / 20</small></div>
              <div className="cbar2"><i style={{ width: `${(c.score / 20) * 100}%`, background: barColor(c.score) }} /></div>
              <div className="why2">{c.why}</div>
              <div className="foot">
                {open.length > 0
                  ? <><span className="gainchip">+{pts} pts available</span><span className="d">{open.length} move{open.length > 1 ? 's' : ''}</span></>
                  : <span className="d">{c.levers.length > 0 ? 'blocked — see inside' : 'nothing to fix'}</span>}
                <span className="go">Open →</span>
              </div>
            </Link>
          );
        })}
        {extras.map(e => (
          <Link key={e.key} href={`/clients/${id}?tab=health&c=${e.key}`} className="hcard opp-card">
            <div className="name">{e.title}</div>
            <div className="val num" style={{ fontSize: '1.15rem', marginTop: 12 }}>{e.why}</div>
            <div className="cbar2" style={{ background: 'transparent' }} />
            <div className="why2">Opportunity — carries no health points, still worth the call.</div>
            <div className="foot"><span className="d">no score impact</span><span className="go">Open →</span></div>
          </Link>
        ))}
      </div>

      {focused && <DeepDive id={id} head={head} c={focused} />}

      {focusedExtra && (
        <div className="dive">
          <h3>{focusedExtra.title}</h3>
          <p className="lead">{focusedExtra.why} · opportunity, not a scored component</p>
          <h5>Why it matters</h5>
          <div className="chal" style={{ marginBottom: 18 }}>{focusedExtra.detail}</div>
          <h5>What we recommend</h5>
          <RecommendedAction id={id} componentKey="opportunity"
            lever={{ key: focusedExtra.key, label: focusedExtra.title, delta: 0, detail: focusedExtra.why }} />
        </div>
      )}

      <div className="dive">
        <h5>Decision trail — what was suggested, chosen, and how it ended</h5>
        {trail.length === 0
          ? <div className="d">Nothing decided yet. Every choice made above — including a &quot;not now&quot; — is recorded here and feeds what the system learns about which suggestions actually land.</div>
          : <div className="trail">
            {trail.map((t, i) => (
              <div key={i} className="row2">
                <span className="when">{dmy2(t.occurred_at)}</span>
                <span>
                  <b>{t.label}</b>
                  {t.event_type === 'lever_referred' && <span className="d"> — handed to the relationship manager</span>}
                  {t.event_type === 'lever_declined' && <span className="d"> — not now: {DECLINE_REASONS.find(([v]) => v === t.reason)?.[1] ?? t.reason}</span>}
                </span>
                <span className="verdict2">
                  {t.event_type === 'lever_declined'
                    ? <span className="fchip stale">declined</span>
                    : t.outcome_type
                      ? <span className="fchip lt">closed · {t.outcome_type}</span>
                      : <span className="fchip conc">in progress</span>}
                </span>
              </div>
            ))}
          </div>}
        <div className="d" style={{ marginTop: 10 }}>
          Accepted moves become owned actions on <Link href="/today">Today</Link> with a deadline; their outcome comes back here,
          so the loop closes on the suggestion that started it.
        </div>
      </div>
    </>
  );
}
