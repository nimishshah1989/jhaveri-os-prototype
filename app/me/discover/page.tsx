import Link from 'next/link';
import { Icon } from '../../../components/Icon';

import { search, shapeFor, screens, picks, fundCount, type Traits } from '../../../lib/discover';
import { manager } from '../../../lib/me';
import { ME } from '../layout';
import { raise } from '../acts';

export const dynamic = 'force-dynamic';

const ASKS: { key: keyof Traits; q: string; opts: [string, string][] }[] = [
  { key: 'horizon', q: 'When might you need this money?', opts: [['short', 'Within 3 years'], ['medium', '3 to 7 years'], ['long', 'Longer than 7']] },
  { key: 'fall', q: 'It falls 20% in a month. You —', opts: [['sell', 'Want out'], ['wait', 'Sit still'], ['buy', 'Buy more']] },
  { key: 'purpose', q: 'What is it for?', opts: [['park', 'Parking it'], ['income', 'An income'], ['grow', 'Growing it']] },
];

const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | null =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;

export default async function Discover({ searchParams }: PageProps<'/me/discover'>) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const t: Partial<Traits> = {
    horizon: pick(sp.h, ['short', 'medium', 'long'] as const) ?? undefined,
    fall: pick(sp.f, ['sell', 'wait', 'buy'] as const) ?? undefined,
    purpose: pick(sp.p, ['park', 'income', 'grow'] as const) ?? undefined,
  };
  const answered = t.horizon && t.fall && t.purpose;
  const shape = answered ? shapeFor(t as Traits) : null;
  const found = q ? search(q) : null;
  const board = picks();
  const rm = manager(ME);
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams({ ...(t.horizon && { h: t.horizon }), ...(t.fall && { f: t.fall }), ...(t.purpose && { p: t.purpose }), ...over });
    return `/me/discover?${p.toString()}`;
  };

  return (
    <>
      <div className="f-sect" style={{ margin: '4px 2px 8px' }}>Discover · {fundCount()} funds on our list</div>

      <form className="f-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 13px' }}>
        <Icon name="search" />
        <input name="q" defaultValue={q} type="search" autoComplete="off" placeholder="the SBI one my brother mentioned…"
          style={{ flex: 1, border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 13.5, color: 'var(--f-ink)', minWidth: 0 }} />
        <button type="submit" className="f-btn" style={{ margin: 0, width: 'auto', padding: '8px 14px' }}>Find</button>
      </form>

      {found && (
        <>
          <div className="f-sect">
            {found.hits.length} match{found.hits.length === 1 ? '' : 'es'}
            <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              read “{found.terms.join('”, “')}”{found.ignored.length ? ` · ignored ${found.ignored.join(', ')}` : ''}
            </span>
          </div>
          {found.hits.length === 0 ? (
            <p className="f-note">Nothing on our list carries those words. Try a fund house — SBI, ICICI, Nippon — or what it does: tax saver, small cap, gold.</p>
          ) : (
            <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {found.hits.map(f => (
                <Link key={f.scheme_id} href={`/me/portfolio/${f.scheme_id}`} className="f-row">
                  <span className="mk">{f.name.slice(0, 2).toUpperCase()}</span>
                  <span className="nm"><b>{f.name}</b>
                    <span>{f.category} · {f.risk} · costs {f.expense}%{f.pick ? ' · house pick' : ''}</span></span>
                  <span className="fg"><b className={`num ${(f.ret1y ?? 0) >= 0 ? 'pos' : 'neg'}`}>{f.ret1y != null ? `${f.ret1y}%` : '—'}</b>
                    <span style={{ color: 'var(--f-faint)', fontWeight: 400 }}>a year</span></span>
                  <Icon name="chev" />
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      <div className="f-sect">A shape, from three answers</div>
      <div className="f-card">
        {ASKS.map(a => (
          <div key={a.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, fontWeight: 650, marginBottom: 7 }}>{a.q}</div>
            <div className="f-chips">
              {a.opts.map(([v, label]) => (
                <Link key={v} href={href({ [a.key === 'horizon' ? 'h' : a.key === 'fall' ? 'f' : 'p']: v })}
                  className={`f-chip${t[a.key] === v ? ' on' : ''}`}>{label}</Link>
              ))}
            </div>
          </div>
        ))}
        {!answered && (
          <p className="f-note" style={{ margin: 0 }}>
            Answer all three and the shape below is built from them — not chosen from a menu of three, and not a
            recommendation. What actually fits you is a conversation with {rm?.first ?? 'your manager'}.
          </p>
        )}
      </div>

      {shape && (
        <>
          <div className="f-card">
            <div className="f-k"><Icon name="pie" /> {shape.equityPct}% in equity</div>
            <h2 style={{ fontFamily: 'var(--display)', fontSize: 20, fontWeight: 600, margin: '8px 0 0' }}>{shape.name}</h2>
            <p style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--f-muted)', marginTop: 6 }}>{shape.line}</p>
            <div className="f-seg">
              {shape.mix.map((s, i) => (
                <i key={s.category} style={{ width: `${s.pct}%`, background: ['var(--f-ink)', 'var(--f-gold)', 'var(--f-muted)', 'var(--f-pos)', 'var(--f-line)', 'var(--f-track)'][i % 6] }} />
              ))}
            </div>
            <div className="f-legend">
              {shape.mix.map((s, i) => (
                <span key={s.category}><b style={{ color: ['var(--f-ink)', 'var(--f-gold)', 'var(--f-muted)', 'var(--f-pos)', 'var(--f-line)', 'var(--f-track)'][i % 6] }}>■</b>{s.category} {s.pct}%</span>
              ))}
            </div>
          </div>

          {shape.mix.map(s => (
            <details className="f-acc" key={s.category}>
              <summary>
                <Icon name="chev" />
                <span style={{ flex: 1 }}>{s.category}</span>
                <span className="rt">{s.pct}%</span>
              </summary>
              <div className="body">
                {s.funds.length === 0 ? (
                  <p className="f-note" style={{ margin: 0 }}>Nothing on our list in this class yet.</p>
                ) : s.funds.map(f => (
                  <Link key={f.scheme_id} href={`/me/portfolio/${f.scheme_id}`} className="f-row">
                    <span className="nm"><b>{f.name}</b><span>{f.amc.replace(/ (Mutual Fund|Asset Management.*)$/, '')} · costs {f.expense}%{f.pick ? ' · house pick' : ''}</span></span>
                    <span className="fg"><b className="num">{f.ret1y != null ? `${f.ret1y}%` : '—'}</b>
                      <span style={{ color: 'var(--f-faint)', fontWeight: 400 }}>{f.grade ? `grade ${f.grade}` : ''}</span></span>
                    <Icon name="chev" />
                  </Link>
                ))}
              </div>
            </details>
          ))}

          <div className="f-card">
            <form action={raise}>
              <input type="hidden" name="kind" value="discuss_shape" />
              <input type="hidden" name="label" value={`Discuss the “${shape.name}” shape (${shape.equityPct}% equity)`} />
              <input type="hidden" name="evidence" value={`horizon ${t.horizon}, fall ${t.fall}, purpose ${t.purpose}`} />
              <button className="f-btn" type="submit" style={{ marginTop: 0 }}>
                Put this in front of {rm?.first ?? 'my manager'}
              </button>
            </form>
            <p className="f-note" style={{ marginBottom: 0 }}>
              This shape is arithmetic on your three answers, and the funds inside it are the best-graded we track —
              it is <b>not</b> approved allocation guidance and it is not advice. It is a starting point for a
              conversation, and it changes the moment you change an answer.
            </p>
          </div>
        </>
      )}

      <div className="f-sect">Lists, each carrying its rule</div>
      {screens().map(s => (
        <details className="f-acc" key={s.key}>
          <summary><Icon name="chev" /><span style={{ flex: 1 }}>{s.title}</span><span className="rt">{s.funds.length}</span></summary>
          <div className="body">
            <p className="f-note" style={{ marginTop: 0 }}>{s.rule}</p>
            {s.funds.map(f => (
              <Link key={f.scheme_id} href={`/me/portfolio/${f.scheme_id}`} className="f-row">
                <span className="nm"><b>{f.name}</b><span>{f.category} · costs {f.expense}%</span></span>
                <span className="fg"><b className="num">{f.ret1y != null ? `${f.ret1y}%` : '—'}</b></span>
                <Icon name="chev" />
              </Link>
            ))}
          </div>
        </details>
      ))}

      <div className="f-sect">
        The house list, and how it has fared
        <span className="rt" style={{ color: 'var(--f-faint)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {board.beat} of {board.rows.length} ahead
        </span>
      </div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {board.rows.slice(0, 3).concat(board.rows.slice(-2)).map(r => (
          <Link key={r.scheme_id} href={`/me/portfolio/${r.scheme_id}`} className="f-row">
            <span className="nm"><b>{r.name}</b><span>{r.category} · costs {r.expense}%</span></span>
            <span className="fg">
              <b className={`num ${r.beat ? 'pos' : 'neg'}`}>{r.ret1y != null ? `${r.ret1y}%` : '—'}</b>
              <span style={{ color: 'var(--f-faint)', fontWeight: 400 }}>
                {r.catAvg != null ? `category ${r.catAvg.toFixed(1)}%` : ''}
              </span>
            </span>
            <Icon name="chev" />
          </Link>
        ))}
      </div>
      <details className="f-acc">
        <summary><Icon name="chev" /><span style={{ flex: 1 }}>The {board.rows.length - 5} in the middle</span></summary>
        <div className="body">
          {board.rows.slice(3, -2).map(r => (
            <Link key={r.scheme_id} href={`/me/portfolio/${r.scheme_id}`} className="f-row">
              <span className="nm"><b>{r.name}</b><span>{r.category} · costs {r.expense}%</span></span>
              <span className="fg">
                <b className={`num ${r.beat ? 'pos' : 'neg'}`}>{r.ret1y != null ? `${r.ret1y}%` : '—'}</b>
                <span style={{ color: 'var(--f-faint)', fontWeight: 400 }}>
                  {r.catAvg != null ? `category ${r.catAvg.toFixed(1)}%` : ''}
                </span>
              </span>
              <Icon name="chev" />
            </Link>
          ))}
        </div>
      </details>
      <p className="f-note">
        The three best and the two worst are above, the rest one tap down — {board.beat} of our {board.rows.length} picks are ahead of their own category and {board.rows.length - board.beat} are
        behind, all printed the same size. {board.rule} A list that publishes only its winners is an advertisement.
      </p>
      <p className="f-note">
        Every page in this section is free and always will be — the fund houses pay a trail on what you already hold,
        and that pays for all of it. Nothing here is a recommendation to buy.
      </p>
    </>
  );
}
