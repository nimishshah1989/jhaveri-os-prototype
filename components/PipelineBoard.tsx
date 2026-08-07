import Link from 'next/link';
import { dmy2 } from '../lib/format';
import type { PipelineColumn } from '../lib/onboarding';

// The board. A card sits in the column its evidence puts it in — never dragged
// there by hand — and shows how long it has been sitting, because that is the
// only number on this page that costs anyone money.
export function PipelineBoard({ columns }: { columns: PipelineColumn[] }) {
  return (
    <div className="board">
      {columns.map(col => {
        const n = col.key === 'lead' ? (col.leads?.length ?? 0) : col.cards.length;
        return (
          <section key={col.key} className="bcol">
            <h4>
              {col.label} <span className="n num">{n}</span>
              <span className="blurb">{col.blurb}</span>
            </h4>
            <div className="list">
              {n === 0 && <div className="none">Nothing here.</div>}

              {col.leads?.map(l => (
                <article key={`l${l.lead_id}`} className="bcard">
                  <div className="nm">{l.name}</div>
                  <div className="meta">
                    {l.source.replace('_', ' ')} · {l.broker.split(' ')[0]}
                    {l.consent_state !== 'granted' && <span className="fchip stale">no consent</span>}
                  </div>
                  <div className="age num">{l.days}d</div>
                </article>
              ))}

              {col.cards.map(c => (
                <article key={c.application_id} className={`bcard${c.blocked ? ' blocked' : ''}`}>
                  <div className="nm">
                    {c.client_id ? <Link href={`/clients/${c.client_id}`}>{c.name}</Link> : c.name}
                  </div>
                  <div className="meta">
                    <span className={`fchip ${c.channel === 'digital' ? 'lt' : 'stale'}`}>{c.channel}</span>
                    {c.holding_type === 'Joint' && <span className="fchip conc">joint</span>}
                    {c.broker.split(' ')[0]}
                  </div>
                  {c.blocked && <div className="blk">{c.blocked}</div>}
                  <div className="age num" title={`since ${dmy2(c.since)}`}>{c.days}d</div>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
