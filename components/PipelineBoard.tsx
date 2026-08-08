import Link from 'next/link';
import { dmy2 } from '../lib/format';
import type { PipelineColumn } from '../lib/onboarding';
import { Collapse } from './Collapse';

// The board. A card sits in the column its evidence puts it in — never dragged
// there by hand — and shows how long it has been sitting, because that is the
// only number on this page that costs anyone money.
//
// That number used to be text on every card, which meant reading 31 cards to find
// the worst one. Length and position are preattentive — the eye resolves them across
// the whole field at once, however many there are (Treisman's feature-integration
// theory) — so the wait is now also a bar, and the column is sorted worst-first.
// Thirty-one cards then cost the same glance as five: you look at the top.
//
// Nothing is removed. The tail collapses behind a count and opens on click.

const SHOWN = 4;

export function PipelineBoard({ columns, stallDays }: {
  columns: PipelineColumn[];
  /** The threshold that makes a wait a problem, from the rules registry. */
  stallDays: number;
}) {
  return (
    <div className="board">
      {columns.map(col => {
        const leads = [...(col.leads ?? [])].sort((a, b) => b.days - a.days);
        const cards = [...col.cards].sort((a, b) => b.days - a.days);
        const n = col.key === 'lead' ? leads.length : cards.length;
        // Scale within the column: the bar answers "worst here", not "worst anywhere",
        // because that is the comparison a broker actually makes.
        const worst = Math.max(1, ...leads.map(l => l.days), ...cards.map(c => c.days));
        const bar = (days: number) => ({
          width: `${Math.max(4, Math.round((days / worst) * 100))}%`,
        });
        const tone = (days: number) => (days >= stallDays ? 'red' : days >= stallDays / 2 ? 'amber' : 'grey');

        const items = [
          ...leads.map(l => (
            <article key={`l${l.lead_id}`} className="bcard">
              <div className="nm">{l.name}</div>
              <div className="meta">
                {l.source.replace('_', ' ')} · {l.broker.split(' ')[0]}
                {l.consent_state !== 'granted' && <span className="fchip stale">no consent</span>}
              </div>
              <div className="age num">{l.days}d</div>
              <span className={`wait ${tone(l.days)}`} aria-hidden="true"><i style={bar(l.days)} /></span>
            </article>
          )),
          ...cards.map(c => (
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
              <span className={`wait ${tone(c.days)}`} aria-hidden="true"><i style={bar(c.days)} /></span>
            </article>
          )),
        ];

        return (
          <section key={col.key} className="bcol">
            <h4>
              {col.label} <span className="n num">{n}</span>
              {/* The column's own headline: the number that decides whether to look. */}
              {n > 0 && <span className={`oldest ${tone(worst)}`}>oldest {worst}d</span>}
              <span className="blurb">{col.blurb}</span>
            </h4>
            <div className="list">
              {n === 0
                ? <div className="none">Nothing here.</div>
                : <Collapse items={items} shown={SHOWN} noun="in this stage" />}
            </div>
          </section>
        );
      })}
    </div>
  );
}
