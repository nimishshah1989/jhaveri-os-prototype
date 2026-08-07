import type { Figure } from '../lib/queries';
import { GLOSSARY, TAG_MEANING } from '../lib/glossary';
import { Icon } from './Icon';

// The ⓘ beside every number. It answers four questions in order:
//   what is this · how should I read it · how was it worked out · where did it come from
// Native <details> — no JavaScript, and it works on a printed page too.
//
// The written half comes from lib/glossary.ts; the SQL comes from the running
// query. If a figure has no glossary entry it still shows its SQL and sources,
// and says the plain-words version has not been written — which keeps the gap
// visible instead of quietly absent.

interface Props {
  /** Glossary key. */
  id?: string;
  figure?: Pick<Figure<unknown>, 'tag' | 'sql' | 'sources'>;
  /** Use the lamp when the point is interpretation rather than derivation. */
  as?: 'info' | 'bulb';
}

export function Explain({ id, figure, as = 'info' }: Props) {
  const t = id ? GLOSSARY[id] : undefined;
  const tag = figure?.tag ?? t?.tag;
  const sources = figure?.sources ?? t?.sources ?? [];

  return (
    <details className="prov">
      <summary title={t ? `${t.label} — what this means and where it comes from` : 'Where does this number come from?'}>
        <Icon name={as} />
      </summary>
      <div className="pop">
        {t && <div className="ptitle">{t.label}</div>}
        {tag && (
          <div className="ptag">
            <span className={`tag ${tag}`}>{tag}</span>
            <span className="tagwhy">{TAG_MEANING[tag]}</span>
          </div>
        )}

        {t ? (
          <>
            <p className="pmeans">{t.means}</p>
            <p className="pread"><b>How to read it:</b> {t.read}</p>
            {t.formula && <p className="pform"><b>Worked out as:</b> {t.formula}</p>}
            {t.caveat && <p className="pcav"><Icon name="alert" /> {t.caveat}</p>}
          </>
        ) : (
          <p className="pmeans ghosttxt">
            No plain-words explanation written for this figure yet. The query and its
            sources are shown below rather than a guess at what it means.
          </p>
        )}

        {figure?.sql && <pre>{figure.sql.trim()}</pre>}
        {sources.length > 0 && <span className="src">{sources.join(' · ')}</span>}
      </div>
    </details>
  );
}
