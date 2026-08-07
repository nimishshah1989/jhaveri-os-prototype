'use client';

import { ReactNode, useState } from 'react';
import { Icon } from './Icon';

// Long lists cost more than screen space — they cost attention. Every list shows
// its first few rows and says exactly how many it is holding back, so a page stays
// short without hiding that there is more.
//
// One component covers both plain lists and table rows, because a table row cannot
// legally sit inside a <details>. Expanding is local state rather than a URL round
// trip, so opening a list never loses the rest of the page's state.

const DEFAULT_SHOWN = 3;

interface Props {
  items: ReactNode[];
  /** Rows to show before collapsing. */
  shown?: number;
  /** What is being hidden, e.g. "clients" → "Show 12 more clients". */
  noun?: string;
  /** "rows" emits <tr> toggles for use inside a <tbody>. */
  as?: 'rows' | 'block';
  /** Columns to span — required when as="rows". */
  span?: number;
}

export function Collapse({ items, shown = DEFAULT_SHOWN, noun = 'more', as = 'block', span = 1 }: Props) {
  const [open, setOpen] = useState(false);
  const hidden = items.length - shown;
  if (hidden <= 0) return <>{items}</>;

  const visible = open ? items : items.slice(0, shown);
  const label = open ? 'Show fewer' : `Show ${hidden} more ${noun}`;

  if (as === 'rows') {
    return (
      <>
        {visible}
        <tr className="expandrow">
          <td colSpan={span}>
            <button type="button" onClick={() => setOpen(!open)}>
              <Icon name={open ? 'up' : 'down'} /> {label}
            </button>
          </td>
        </tr>
      </>
    );
  }

  return (
    <div className="collapse">
      {visible}
      <button type="button" className="morebtn" onClick={() => setOpen(!open)}>
        <Icon name={open ? 'up' : 'down'} /> {label}
      </button>
    </div>
  );
}
