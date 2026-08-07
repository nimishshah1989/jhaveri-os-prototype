import type { Figure, StatList } from '../lib/queries';
import { inrCompact } from '../lib/format';
import { Explain } from './Explain';
import { ClientLink } from './ClientLink';
import { Collapse } from './Collapse';
import { Icon, Trend } from './Icon';

// Every headline number on the product renders through here, which is what keeps
// the cards identical across eight pages. A card carries four things and no more:
// what it is, the number, one line of context, and the rows behind it.

interface Props {
  label: string;
  value: string;
  sub: string;
  tone?: 'plain' | 'pos' | 'warn' | 'opp';
  /** Glossary key — drives the ⓘ. */
  id?: string;
  /** Meaning-carrying glyph beside the label. */
  icon?: string;
  /** Signed period-on-period change, shown beside the value with a direction arrow. */
  delta?: { n: number; label: string };
  figure: Pick<Figure<unknown>, 'tag' | 'sql' | 'sources'>;
  list: StatList;
  listAmountKind?: 'inr' | 'days' | 'count';
  /** The one figure on the page that should carry the weight. */
  hero?: boolean;
}

const VALUE_TONE: Record<string, string> = { plain: '', pos: 'good', warn: 'warn', opp: 'opp' };

export function StatCard(props: Props) {
  const { label, value, sub, tone = 'plain', id, icon, delta, figure, list, listAmountKind = 'inr', hero } = props;
  const amount = (n: number) =>
    listAmountKind === 'inr' ? inrCompact(n) : listAmountKind === 'days' ? `${n} days` : `${n}`;

  const rows = list.rows.map((r, i) => (
    <tr key={i}>
      <td>
        {/* Only a person gets a face — these rows are also months, channels and funds. */}
        <ClientLink id={r.client_id} name={r.label} avatar={!!r.client_id} /> <span className="d">{r.detail}</span>
      </td>
      <td className="num">{amount(r.amount)}</td>
    </tr>
  ));

  return (
    <details className={`card tone-${tone}${hero ? ' hero' : ''}`}>
      <summary>
        <div className="k">
          {icon && <Icon name={icon} />}
          {label}
          <Explain id={id} figure={figure} />
        </div>
        <div className={`v num ${VALUE_TONE[tone]}`}>
          {value}
          {delta && (
            <span className={`delta ${delta.n > 0 ? 'up' : delta.n < 0 ? 'down' : ''}`}>
              <Trend n={delta.n} /> {delta.label}
            </span>
          )}
        </div>
        <div className="s num">{sub}</div>
      </summary>
      <div className="list">
        <table>
          <tbody>
            <Collapse items={rows} shown={3} noun="rows" as="rows" span={2} />
          </tbody>
        </table>
        {list.total > list.rows.length && (
          <div className="more">
            … {list.total - list.rows.length} more not shown here — the full list lives on the page this
            card belongs to.
          </div>
        )}
      </div>
    </details>
  );
}
