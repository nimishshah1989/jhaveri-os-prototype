import { PageHead } from '../../components/PageHead';
import { ClientLink } from '../../components/ClientLink';
import { Collapse } from '../../components/Collapse';
import { Icon } from '../../components/Icon';
import { SCORING_RULES, schemeGrades } from '../../lib/scoring';
import { RULE_SETS, RULES_INDEX, undescribed } from '../../lib/rules';

export const dynamic = 'force-dynamic';

const NOTES: Record<string, string> = {
  performance: 'Full marks when the client matches or beats their blended benchmark; zero once they trail it by this many points.',
  diversification: 'Penalty starts above the caps — how much sits in one category, and how much in one fund.',
  discipline: 'Points deducted per unfixed hygiene problem. Each deduction is exactly the lever that restores it.',
  tax: 'Deducted while a tax-free harvest window sits unused, or when short-term gains dominate.',
  risk_fit: 'Points off per grade of gap between the client’s stated appetite and what the portfolio actually holds.',
};

const AUDIENCE: Record<string, string> = {
  client: 'What a client sees', broker: "What a broker is paid or shown",
  ops: 'How work is routed', management: 'Firm-level',
};

export default function AdminRulesPage() {
  const grades = schemeGrades();
  const gaps = undescribed();
  const dist: Record<string, number> = {};
  for (const g of grades.values()) dist[g.grade] = (dist[g.grade] ?? 0) + 1;

  return (
    <>
      <PageHead title="Rules" icon="shield"
        question="Every threshold the platform applies, and what changing one would do."
      />
      <p className="denom">
        Version <b>{SCORING_RULES.version}</b> · every score on every page reads these numbers.
        In the real build they live in <code>rules_registry</code> — versioned, approved, changeable without a deploy.
        Here they are read-only, so what you see is exactly what scored the clients.
      </p>

      <h2 className="sec">Client health — five components, 20 points each</h2>
      <div className="tblwrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Component</th><th>Knobs</th><th>What it means</th></tr></thead>
          <tbody>
            {SCORING_RULES.components.map(c => (
              <tr key={c}>
                <td style={{ textTransform: 'capitalize' }}>{c.replace('_', ' ')}</td>
                <td className="num" style={{ whiteSpace: 'normal' }}>
                  {Object.entries(SCORING_RULES[c] as Record<string, number>)
                    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ')}
                </td>
                <td style={{ whiteSpace: 'normal' }} className="d">{NOTES[c]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="sec">Bands — the words clients and brokers see</h2>
      <div className="tblwrap" style={{ marginBottom: 20 }}>
        <table>
          <thead><tr><th>Score</th><th>Label</th></tr></thead>
          <tbody>
            {SCORING_RULES.bands.map(b => (
              <tr key={b.label}>
                <td className="num">{b.min}+</td>
                <td><span className={`fchip ${b.cls}`}>{b.label}</span></td>
              </tr>
            ))}
            <tr>
              <td className="num">{SCORING_RULES.quick_win_single_lever}+</td>
              <td>a single lever this big makes a client a <b>quick win</b> — one call, one fix</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="sec">Scheme grades A–E</h2>
      <div className="tblwrap">
        <table>
          <thead><tr><th>Rule</th><th>Value</th></tr></thead>
          <tbody>
            <tr><td>Base</td><td className="d">percentile of 1-year return within the scheme’s own category</td></tr>
            <tr><td>House pick bonus</td><td className="num">+{SCORING_RULES.scheme_grade.pick_bonus_pctile} percentile points</td></tr>
            <tr><td>Above-average expense</td><td className="num">−{SCORING_RULES.scheme_grade.expense_penalty_pctile} percentile points</td></tr>
            <tr><td>Cutoffs</td><td className="num">A ≥ 80 · B ≥ 60 · C ≥ 40 · D ≥ 20 · E below</td></tr>
            <tr><td>Current distribution</td><td className="num">{['A', 'B', 'C', 'D', 'E'].map(g => `${g}: ${dist[g] ?? 0}`).join(' · ')} across {grades.size} schemes</td></tr>
          </tbody>
        </table>
      </div>

      <p className="d" style={{ marginTop: 16, maxWidth: '75ch' }}>
        These v0 numbers were proposed from the data and are yours to change. Editing them here (rather than
        reading only) arrives with the real build&apos;s rules registry, where every change is versioned and
        attributed. The learned layer may <i>propose</i> new values from captured outcomes — a human always approves.
      </p>

      {/* ── every knob in the product, not just this page's ──────────────────
          Founder, 14-Aug-2026: "Anything that needs to be defined, any rules,
          any scoring, all of this is shown and can be edited or customized in
          terms of the thresholds and values." Eleven constants had grown up
          across eleven files and this page showed one of them. The register in
          lib/rules.ts names all eleven and points at the constants the product
          actually reads, so a number here and a number in a calculation cannot
          drift apart. */}
      <h2 className="secthead" style={{ marginTop: 32 }}>
        Every threshold in the platform
      </h2>
      <p className="denom">
        <b>{RULES_INDEX.knobs}</b> values across <b>{RULES_INDEX.sets}</b> sets, each pointing at the
        constant the product actually reads. In the production build these are rows in{' '}
        <code>{RULES_INDEX.store}</code> — versioned, owned, approved, and editable here without a
        deploy. The constants stay as the fallback when a row is missing, because a threshold that
        silently becomes zero is worse than one that is stale.
        {gaps.length > 0 && <> {gaps.length} value{gaps.length === 1 ? ' has' : 's have'} no
          plain-English description yet, and {gaps.length === 1 ? 'it is' : 'they are'} listed as
          such rather than hidden.</>}
      </p>

      {RULE_SETS.map(s => (
        <section key={s.id} className="panel" style={{ marginBottom: 14 }}>
          <div className="panelhead">
            <span>
              <b>{s.title}</b>
              <span className="denom" style={{ marginLeft: 8 }}>{AUDIENCE[s.audience]}</span>
            </span>
            <code className="denom">{s.source}</code>
          </div>
          <p className="denom" style={{ padding: '0 14px' }}>{s.about}</p>
          {s.needs_signoff && (
            <p className="denom" style={{ padding: '0 14px', color: 'var(--neg)' }}>
              <Icon name="alert" /> <b>Needs sign-off.</b> {s.needs_signoff}
            </p>
          )}
          <table>
            <thead>
              <tr><th>Value</th><th>What moving it does</th><th className="num">Now</th></tr>
            </thead>
            <tbody>
              <Collapse as="rows" span={3} shown={6} noun="values" items={s.knobs.map(k => (
                <tr key={k.key}>
                  <td><code>{k.key}</code></td>
                  <td>{k.does || <span className="denom">Not yet described in plain English.</span>}</td>
                  <td className="num">{String(k.value)}</td>
                </tr>
              ))} />
            </tbody>
          </table>
          <p className="denom" style={{ padding: '8px 14px' }}>Version <b>{s.version}</b></p>
        </section>
      ))}
    </>
  );
}
