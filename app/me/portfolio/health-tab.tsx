import { Icon } from '../../../components/Icon';
import { clientHealth } from '../../../lib/scoring';
import { plan, manager } from '../../../lib/me';
import { ME } from '../layout';
import { raise } from '../acts';

// Each health component is scored out of 20 and the five sum to 100 (lib/scoring),
// so a bar divides by that, never by 100.
const PER_COMPONENT = 20;
const TONE = (s: number) => (s / PER_COMPONENT >= 0.7 ? 'var(--f-pos)' : s / PER_COMPONENT >= 0.45 ? 'var(--f-gold)' : 'var(--f-neg)');
const GLYPH: Record<string, string> = {
  performance: 'up', diversification: 'pie', discipline: 'calendar', tax: 'file', risk_fit: 'shield',
};

export function HealthTab() {
  const h = clientHealth(ME);
  const p = plan(h.components);
  const rm = manager(ME);

  return (
    <>
      <div className="f-card">
        <div className="f-k"><Icon name="shield" /> Where you stand</div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
          <span className="f-big num" style={{ marginTop: 0 }}>{h.total}</span>
          <span style={{ fontSize: 13, color: 'var(--f-faint)' }}>/ 100 · {h.band.label}</span>
        </div>
        <div className="f-bar" style={{ marginTop: 10 }}>
          <div className="bt" style={{ height: 6 }}>
            <i style={{ width: `${h.total}%`, background: TONE((h.total / 100) * PER_COMPONENT) }} />
          </div>
        </div>
        {p.acts.length > 0 && (
          <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 10 }}>
            <b style={{ color: 'var(--f-ink)' }}>{h.reachable}</b> is reachable — {p.acts.length} things
            to authorise, and no portfolio should do them all in one afternoon. Two a review, so about{' '}
            <b style={{ color: 'var(--f-ink)' }}>{p.cycles} review{p.cycles > 1 ? 's' : ''}</b> with {rm?.first ?? 'your manager'}.
          </p>
        )}
      </div>

      <div className="f-sect">What you can authorise</div>
      {p.acts.length === 0 ? (
        <p className="f-note">Nothing needs your signature today. That is a good place to be.</p>
      ) : p.acts.slice(0, 2).map((a, i) => (
        <div className="f-card" key={a.key}>
          <div className="f-k">
            <Icon name={GLYPH[a.area.toLowerCase().replace(' ', '_')] ?? 'spark'} />
            {i < 2 ? 'This review' : 'A later review'}
            <span className="pts rt" style={{
              background: 'var(--f-gold-soft)', color: 'var(--f-gold)', borderRadius: 999,
              padding: '3px 8px', fontWeight: 700, fontSize: 11,
            }}>+{a.delta} pts</span>
          </div>
          <div style={{ fontSize: 14.5, fontWeight: 650, lineHeight: 1.35, marginTop: 8 }}>{a.act.verb}</div>
          <div style={{ fontSize: 12, color: 'var(--f-muted)', lineHeight: 1.5, marginTop: 5 }}>{a.detail}</div>
          {a.act.sells && (
            <div style={{ fontSize: 11.5, color: 'var(--f-faint)', lineHeight: 1.5, marginTop: 6 }}>
              Sells units — you approve the tax and the exit fee, computed from your own lots, before anything moves.
            </div>
          )}
          <div className="f-btnrow">
            <form action={raise} style={{ flex: 1 }}>
              <input type="hidden" name="kind" value={`lever_${a.key}`} />
              <input type="hidden" name="label" value={a.act.verb} />
              <input type="hidden" name="evidence" value={`${a.area} · +${a.delta} pts · ${a.label}`} />
              <button className="f-btn" type="submit" style={{ marginTop: 0 }}>Prepare it for me</button>
            </form>
            <form action={raise} style={{ flex: 1 }}>
              <input type="hidden" name="kind" value="call_rm" />
              <input type="hidden" name="label" value={`Talk through: ${a.act.verb}`} />
              <input type="hidden" name="evidence" value={`${a.area} · +${a.delta} pts`} />
              <button className="f-btn ghost" type="submit" style={{ marginTop: 0 }}>Talk it through</button>
            </form>
          </div>
        </div>
      ))}

      {p.acts.length > 2 && (
        <details className="f-acc">
          <summary>
            <Icon name="chev" />
            <span style={{ flex: 1 }}>{p.acts.length - 2} more, for a later review</span>
            <span className="rt">+{p.acts.slice(2).reduce((s2, a) => s2 + a.delta, 0)} pts</span>
          </summary>
          <div className="body">
            {p.acts.slice(2).map(a => (
              <div className="f-lever" key={a.key}>
                <div className="lh"><b>{a.act.verb}</b><span className="pts">+{a.delta} pts</span></div>
                <div className="ld">{a.detail}</div>
                <form action={raise}>
                  <input type="hidden" name="kind" value={`lever_${a.key}`} />
                  <input type="hidden" name="label" value={a.act.verb} />
                  <input type="hidden" name="evidence" value={`${a.area} · +${a.delta} pts`} />
                  <button className="f-btn ghost" type="submit">Prepare it for me</button>
                </form>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="f-note">
        {rm?.first ?? 'Your manager'} prepares each of these and you approve in one tap. Nothing moves until you say so.
      </p>

      <div className="f-sect">Why the score is what it is</div>
      {h.components.map(c => {
        const fix = p.acts.find(a => a.area === c.label);
        return (
        <details className="f-acc" key={c.key}>
          <summary>
            <Icon name="chev" />
            <span style={{ flex: 1 }}>{c.label}</span>
            <span className="num" style={{ fontWeight: 700, color: TONE(c.score) }}>
              {c.score}<span style={{ color: 'var(--f-faint)', fontWeight: 400 }}> / {PER_COMPONENT}</span>
            </span>
          </summary>
          <div className="body">
            <p style={{ fontSize: 12.5, color: 'var(--f-muted)', margin: '0 0 8px' }}>{c.why}</p>
            {c.challenges.map(ch => (
              <div className="f-ins" key={ch}>
                <span className="g"><Icon name="info" /></span>
                <span className="tx">{ch}</span>
              </div>
            ))}
            {c.breakdown.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--f-gold-ink)', fontWeight: 650, minHeight: 44, display: 'flex', alignItems: 'center' }}>
                  How this {c.score} was reached
                </summary>
                <div style={{ paddingTop: 6 }}>
                  {c.breakdown.map(st => (
                    <div className="f-step" key={st.label}><span>{st.label}</span><b>{st.effect}</b></div>
                  ))}
                </div>
              </details>
            )}

            {fix ? (
              <form action={raise} style={{ marginTop: 12 }}>
                <input type="hidden" name="kind" value={`lever_${fix.key}`} />
                <input type="hidden" name="label" value={fix.act.verb} />
                <input type="hidden" name="evidence" value={`${c.label} · +${fix.delta} pts · from the why panel`} />
                <button className="f-btn ghost" type="submit">
                  {fix.act.verb} · +{fix.delta} pts
                </button>
              </form>
            ) : (
              <p className="f-note" style={{ marginBottom: 0 }}>
                Nothing here is yours to act on — this is what your funds happen to hold, not something you can
                trade. It moves when the funds change.
              </p>
            )}
          </div>
        </details>
      );})}

      <p className="f-note">
        Five areas, {PER_COMPONENT} points each. These are the same pages {rm?.first ?? 'your manager'} reads — the
        rules are published rather than hidden, and every point is arithmetic on your own folios, not an opinion
        about you. They are still under review by our compliance team before they carry weight in a conversation.
      </p>
    </>
  );
}
