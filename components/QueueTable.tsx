import Link from 'next/link';
import type { QueueItem } from '../lib/queries';
import { inrCompact } from '../lib/format';
import { typeOf, evidence, sla } from '../lib/queue-display';
import { ClientLink } from './ClientLink';
import { Collapse } from './Collapse';
import { Icon } from './Icon';
import { QueueActions } from './QueueActions';

// The queue is a list of work, so it is a table. Six stacked boxes wasted the
// space between them and made every row look equally important.
//
// ONE hierarchy law, applied here and everywhere else:
//   1. the subject — who this is about — is the strongest thing in the row
//   2. the money is second, tabular, right-aligned
//   3. the category is an icon and a quiet chip; it is a filter, not a headline
//   4. everything else is muted, and only the numbers inside it get weight
// Nothing outside that list is bold. That rule is what makes a row scannable.
//
// Clicking the name opens the action drawer, NOT the client profile. On this page
// the broker is working a queue, not browsing people — the profile is one more
// click away inside the drawer, where he will already have the context to want it.

export function QueueTable({ items, readonly = false, shown = 5, openId }: {
  items: QueueItem[]; readonly?: boolean; shown?: number; openId?: number;
}) {
  if (items.length === 0) return <div className="empty">Nothing here today.</div>;

  const rows = items.map(item => {
    const t = typeOf(item.action_type);
    const auto = item.outcome_type === 'auto_resolved';
    const d = sla(item.sla_due);
    const name = item.client_name ?? '—';
    const open = `/today?action=${item.action_id}`;
    const facts = evidence(item.trigger_evidence).slice(0, 3);
    return (
      <tr key={item.action_id} className={item.action_id === openId ? 'openrow' : undefined}>
        <td className="qtype">
          <span className={`tchip ${t.tone}`} title={item.action_type}>
            <Icon name={t.icon} /> {t.label}
          </span>
        </td>
        <td className="qwho">
          {/* Read-only copies of the queue live on other pages; there a name still
              means the person, because there is no drawer to open. */}
          <ClientLink id={item.client_id} name={name} href={readonly ? undefined : open} />
        </td>
        <td className="qwhy">
          {facts.map((p, i) => (
            <span key={i}>
              {p.lead && <span className="lead">{p.lead} </span>}
              <b>{p.value}</b>
              {i < facts.length - 1 ? <span className="lead"> · </span> : null}
            </span>
          ))}
        </td>
        <td className="r num qmoney">{item.impact_score > 0 ? inrCompact(item.impact_score) : ''}</td>
        <td className="qgain">
          {(item.score_gain ?? 0) > 0 && <span className="gainchip">+{item.score_gain}</span>}
        </td>
        <td className="qdue">
          {auto
            ? <span className="tchip grey">auto-closed</span>
            : <span className={`due ${d.tone}`}>{d.text}</span>}
        </td>
        <td className="qact">
          {!auto && !readonly && <QueueActions actionId={item.action_id} step={item.suggested_step} />}
        </td>
        <td className="qopen">
          {!readonly && (
            <Link href={open} className="chev" scroll={false} aria-label={`Open ${t.label} for ${name}`}>›</Link>
          )}
        </td>
      </tr>
    );
  });

  return (
    <div className="tblwrap queue">
      <table>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Type</th>
            <th style={{ textAlign: 'left' }}>Client</th>
            <th style={{ textAlign: 'left' }}>Why</th>
            <th className="r">At stake</th>
            <th>Health</th>
            <th>Due</th>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          <Collapse items={rows} shown={shown} noun="in this queue" as="rows" span={8} />
        </tbody>
      </table>
    </div>
  );
}
