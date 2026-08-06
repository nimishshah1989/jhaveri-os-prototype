import type { Figure } from '../lib/queries';

// Click-to-source: the ⓘ beside every figure. Native <details> — no JS.
export function Provenance({ figure }: { figure: Pick<Figure<unknown>, 'tag' | 'sql' | 'sources'> }) {
  return (
    <details className="prov">
      <summary title="Where does this number come from?">i</summary>
      <div className="pop">
        <span className={`tag ${figure.tag}`}>{figure.tag}</span>
        <pre>{figure.sql.trim()}</pre>
        <span className="src">{figure.sources.join(' · ')}</span>
      </div>
    </details>
  );
}
