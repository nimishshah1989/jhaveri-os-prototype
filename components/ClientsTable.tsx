'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ClientRow } from '../lib/queries';
import { inr, dmy } from '../lib/format';
import { mintForClients } from '../app/clients/actions';

const FLAG_LABEL: Record<string, [string, string]> = {
  stale: ['stale', 'stale'],
  concentration: ['concentrated', 'conc'],
  laggard: ['laggard', 'conc'],
};

function exportCsv(rows: ClientRow[]): void {
  const head = 'client_id,name,value,invested,pnl,xirr_blended,last_activity,live_sips,open_actions,flags';
  const body = rows.map(r =>
    [r.client_id, `"${r.name}"`, r.v, r.invested, r.pnl, r.wx ?? '', r.last_activity ?? '', r.sips, r.open_actions, `"${r.flags}"`].join(','));
  const blob = new Blob([[head, ...body].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-clients.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function ClientsTable({ rows, totals }: { rows: ClientRow[]; totals: { v: number; invested: number; sips: number; actions: number } }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const pnlTotal = totals.v - totals.invested;

  return (
    <>
      {selected.size > 0 && (
        <div className="bulk">
          <b>{selected.size} selected</b>
          <form action={mintForClients} style={{ display: 'inline' }}>
            <input type="hidden" name="client_ids" value={[...selected].join(',')} />
            <input type="hidden" name="note" value="Follow up — picked from My clients" />
            <button type="submit">Mint action for each</button>
          </form>
          <button disabled title="Ships with the Marketing page">Add to campaign</button>
          <button type="button" onClick={() => exportCsv(rows.filter(r => selected.has(r.client_id)))}>Export CSV</button>
          <span className="hint">campaign sends respect each client&apos;s consent — enforced in the query</span>
        </div>
      )}
      <div className="tblwrap">
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Client</th>
              <th className="r">Value</th>
              <th className="r">Invested</th>
              <th className="r">P&amp;L</th>
              <th className="r">XIRR (blended)</th>
              <th>Last activity</th>
              <th className="r">SIPs</th>
              <th className="r">Actions</th>
              <th>Flags</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client_id}>
                <td><input type="checkbox" checked={selected.has(r.client_id)} onChange={() => toggle(r.client_id)} /></td>
                <td>
                  {r.name}
                  {r.dup > 1 && <span className="sub">#{r.client_id}</span>}
                </td>
                <td className="r num">{inr(r.v)}</td>
                <td className="r num">{inr(r.invested)}</td>
                <td className={`r num ${r.pnl >= 0 ? 'up' : 'down'}`}>{r.pnl >= 0 ? '+' : '−'}{inr(Math.abs(r.pnl))}</td>
                <td className={`r num ${r.wx != null && r.wx < 0 ? 'down' : 'up'}`}>{r.wx != null ? `${r.wx >= 0 ? '+' : ''}${r.wx}%` : '—'}</td>
                <td>{r.last_activity ? dmy(r.last_activity) : '—'}</td>
                <td className="r num">{r.sips}</td>
                <td className="r num">{r.open_actions}</td>
                <td>
                  {r.flags.split(',').filter(Boolean).map(f => {
                    const [label, cls] = FLAG_LABEL[f] ?? [f, 'stale'];
                    return <span key={f} className={`fchip ${cls}`}>{label}</span>;
                  })}
                </td>
                <td className="rowacts">
                  <Link href={`/clients/${r.client_id}`}>Open 360</Link>
                  <form action={mintForClients} style={{ display: 'inline' }}>
                    <input type="hidden" name="client_ids" value={r.client_id} />
                    <input type="hidden" name="note" value={`Follow up — ${r.name}`} />
                    <button type="submit">Mint action</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td></td>
              <td>{rows.length} clients shown</td>
              <td className="r num">{inr(totals.v)}</td>
              <td className="r num">{inr(totals.invested)}</td>
              <td className={`r num ${pnlTotal >= 0 ? 'up' : 'down'}`}>{pnlTotal >= 0 ? '+' : '−'}{inr(Math.abs(pnlTotal))}</td>
              <td className="r"></td>
              <td></td>
              <td className="r num">{totals.sips}</td>
              <td className="r num">{totals.actions}</td>
              <td></td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
