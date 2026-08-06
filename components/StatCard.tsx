import type { Figure, StatList } from '../lib/queries';
import { inrCompact } from '../lib/format';
import { Provenance } from './Provenance';

interface Props {
  label: string;
  value: string;
  sub: string;
  tone?: 'plain' | 'pos' | 'warn' | 'opp';
  figure: Pick<Figure<unknown>, 'tag' | 'sql' | 'sources'>;
  list: StatList;
  listAmountKind?: 'inr' | 'days';
}

const TONE_CLASS: Record<string, string> = { plain: '', pos: '', warn: 'warn', opp: 'opp' };

export function StatCard(props: Props) {
  const { label, value, sub, tone = 'plain', figure, list, listAmountKind = 'inr' } = props;
  return (
    <details className="card">
      <summary>
        <div className="k">
          {label} <Provenance figure={figure} />
        </div>
        <div className={`v num ${TONE_CLASS[tone]}`} style={tone === 'pos' ? { color: 'var(--pos)' } : undefined}>
          {value}
        </div>
        <div className="s num">{sub}</div>
      </summary>
      <div className="list">
        <table>
          <tbody>
            {list.rows.map((r, i) => (
              <tr key={i}>
                <td>
                  {r.label} <span className="d">{r.detail}</span>
                </td>
                <td className="num">{listAmountKind === 'inr' ? inrCompact(r.amount) : `${r.amount} days`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.total > list.rows.length && (
          <div className="more">
            … {list.total - list.rows.length} more — full list on My clients (next page to build)
          </div>
        )}
      </div>
    </details>
  );
}
