import Link from 'next/link';
import type { QueueItem } from '../lib/queries';
import { typeOf } from '../lib/queue-display';
import { Icon } from './Icon';

// The tags that label a row are also the controls that slice the list. Learning the
// colours becomes learning the navigation, so the vocabulary pays for itself instead
// of being one more thing to memorise.
//
// URL-driven like the drawer (?type=…), so a filtered queue survives a refresh and
// can be sent to someone. Only kinds that are actually present are offered — an
// option that returns nothing is a dead end, and Hick's law says every extra choice
// costs time even when it is never taken.

export function QueueFilter({ items, active }: { items: QueueItem[]; active?: string }) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.action_type, (counts.get(i.action_type) ?? 0) + 1);
  if (counts.size < 2) return null;              // one kind is not a choice

  const kinds = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div className="qfilter" role="group" aria-label="Filter the queue by kind">
      <Link href="/today" className={`fpill${active ? '' : ' on'}`} scroll={false}>
        All <span className="n">{items.length}</span>
      </Link>
      {kinds.map(([type, n]) => {
        const t = typeOf(type);
        const on = active === type;
        return (
          <Link key={type} scroll={false}
            href={on ? '/today' : `/today?type=${type}`}
            className={`fpill ${t.tone}${on ? ' on' : ''}`}
            aria-pressed={on}>
            <Icon name={t.icon} /> {t.label} <span className="n">{n}</span>
          </Link>
        );
      })}
    </div>
  );
}
