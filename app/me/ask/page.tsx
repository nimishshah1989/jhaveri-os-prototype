import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { askClient, ASK_REFUSAL, EVALS } from '../../../lib/askme';
import { manager } from '../../../lib/me';
import { ME } from '../layout';
import { raise } from '../acts';

export const dynamic = 'force-dynamic';

/**
 * Ask — experimental, and labelled so on the screen rather than in a release note.
 *
 * It answers about the client's own money and refuses to recommend. The refusal
 * is not a limitation being apologised for; it is the product position, and the
 * eval set in `lib/askme.ts` fails the build if it ever stops holding.
 */
export default async function Ask({ searchParams }: PageProps<'/me/ask'>) {
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.trim() : '';
  const rm = manager(ME);
  const a = q ? askClient(ME, q, rm?.first ?? 'your manager') : null;

  return (
    <>
      <p className="f-hello">Ask about your money.</p>

      <form className="f-card" style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '10px 13px' }}>
        <Icon name="search" />
        <input name="q" defaultValue={q} type="search" autoComplete="off" autoFocus
          placeholder="how much tax if I sold everything?"
          style={{ flex: 1, border: 0, outline: 0, background: 'none', font: 'inherit', fontSize: 13.5, color: 'var(--f-ink)', minWidth: 0 }} />
        <button className="f-btn" type="submit" style={{ width: 'auto', margin: 0, padding: '9px 14px' }}>Ask</button>
      </form>

      <p className="f-note">
        <span className="f-stamp">EXPERIMENTAL</span> — this reads your own book and says what it finds.
        It will not tell you what to buy or sell. Every question it can answer is listed below, and a
        question outside them gets told so rather than guessed at.
      </p>

      {a && (
        <>
          <div className="f-card">
            <div className="f-k">
              <Icon name={a.intent === 'refused' ? 'shield' : a.intent === 'unknown' ? 'info' : 'bulb'} />
              {a.intent === 'refused' ? 'Not what this does'
                : a.intent === 'unknown' ? 'We do not know' : 'Read as'}
              <span className="rt" style={{ color: 'var(--f-faint)', padding: 0, margin: 0 }}>{a.confidence} confidence</span>
            </div>
            <div className="t" style={{ fontSize: 15, fontWeight: 650, marginTop: 8 }}>{a.read_as}</div>

            {a.facts.length > 0 && (
              <div style={{ marginTop: 10 }}>
                {a.facts.map(f => (
                  <div className="f-step" key={f.label}>
                    <span>{f.label}</span><b className="num">{f.value}</b>
                  </div>
                ))}
              </div>
            )}

            {a.facts.length === 0 && a.intent !== 'refused' && a.intent !== 'unknown' && (
              <p className="f-note" style={{ marginTop: 10 }}>
                Nothing on your book answers this yet. That is the answer, not a failure to find one.
              </p>
            )}

            <p className="f-note" style={{ marginTop: 10, marginBottom: 0 }}>
              <b>What this cannot tell you.</b> {a.risk}
            </p>
          </div>

          <div className="f-card f-act">
            <div className="f-k"><Icon name="chat" /> The person whose job this is</div>
            <div className="t">{rm?.name ?? 'Your manager'}</div>
            <div className="s">
              {a.intent === 'refused'
                ? ASK_REFUSAL
                : 'Every answer above is a fact about your own book. What to do about it is a conversation, and it is a short one.'}
            </div>
            <form action={raise}>
              <input type="hidden" name="kind" value="call_rm" />
              <input type="hidden" name="label" value={`Client asked: ${q.slice(0, 100)}`} />
              <input type="hidden" name="evidence" value={`ask bar · read as "${a.read_as}"`} />
              <button className="f-btn" type="submit">Send this question to {rm?.first ?? 'my manager'}</button>
            </form>
          </div>
        </>
      )}

      <div className="f-sect">What it can answer</div>
      <div className="f-card" style={{ paddingTop: 4, paddingBottom: 4 }}>
        {EVALS.filter(e => !['refused', 'unknown'].includes(e.expect)).map(e => (
          <Link key={e.ask} href={`/me/ask?q=${encodeURIComponent(e.ask)}`} className="f-row">
            <span className="mk"><Icon name="search" /></span>
            <span className="nm"><b>{e.ask}</b><span>{e.why}</span></span>
            <Icon name="chev" />
          </Link>
        ))}
      </div>
      <p className="f-note">
        These are not examples — they are the eval set. Every one of them runs on every build, along
        with the ones that must be refused, and a change that starts answering &ldquo;what should I
        buy&rdquo; fails there rather than here.
      </p>
    </>
  );
}
