'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { ClientRow } from '../lib/queries';
import { inr, inrCompact, dmy2 } from '../lib/format';
import { typeOf } from '../lib/queue-display';
import { ClientLink } from './ClientLink';
import { mintForClients } from '../app/clients/actions';

const FLAG_LABEL: Record<string, [string, string]> = {
  stale: ['stale', 'stale'],
  concentration: ['concentrated', 'conc'],
  laggard: ['laggard', 'conc'],
};

// Optional columns behind the picker; the default set stays lean (founder rule).
const OPTIONAL_COLS = [
  ['invested', 'Invested'],
  ['pnl', 'P&L'],
  ['activity', 'Last activity'],
  ['txn', 'Last transaction'],
  ['sip', 'Last SIP'],
  ['spoke', 'Last spoken to'],
  ['parked', 'Parked cash'],
  ['flags', 'Flags'],
] as const;
type OptCol = (typeof OPTIONAL_COLS)[number][0];
// Last transaction is on by default and plain "last activity" is not: an
// instalment the client set up two years ago keeps the activity column looking
// fresh long after the person behind it went quiet.
const DEFAULT_COLS: OptCol[] = ['pnl', 'txn', 'spoke'];
const STORAGE_KEY = 'jhaveri.clients.cols';

function exportCsv(rows: ClientRow[]): void {
  const head = 'client_id,name,value,invested,pnl,xirr_blended,last_activity,last_transaction,last_sip,last_spoken_to,parked_cash,sip_monthly,next_step,flags';
  const body = rows.map(r =>
    [r.client_id, `"${r.name}"`, r.v, r.invested, r.pnl, r.wx ?? '', r.last_activity ?? '',
      r.last_txn ?? '', r.last_sip ?? '', r.last_spoke ?? '', r.parked, r.sip_monthly, r.top_action ?? '', `"${r.flags}"`].join(','));
  const blob = new Blob([[head, ...body].join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'my-clients.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

export interface HealthCell { score: number; gain: number; band: string; cls: string }

export function ClientsTable({ rows, totals, health }: { rows: ClientRow[]; totals: { v: number; invested: number }; health?: Record<number, HealthCell> }) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [cols, setCols] = useState<Set<OptCol>>(new Set(DEFAULT_COLS));
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) setCols(new Set(JSON.parse(saved) as OptCol[]));
  }, []);
  const toggleCol = (c: OptCol) => {
    const next = new Set(cols);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCols(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  };
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };
  const maxV = Math.max(...rows.map(r => r.v), 1);
  const pnlTotal = totals.v - totals.invested;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <details className="colpick">
          <summary>Columns ▾</summary>
          <div className="pop">
            {OPTIONAL_COLS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={cols.has(key)} onChange={() => toggleCol(key)} /> {label}
              </label>
            ))}
            <div className="d" style={{ marginTop: 4 }}>Client, value, XIRR, SIP and next step always show</div>
          </div>
        </details>
      </div>
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
              <th title="Bar shows size relative to the largest client">Value</th>
              {cols.has('invested') && <th>Invested</th>}
              {cols.has('pnl') && <th title="Green = gain, red = loss">P&amp;L</th>}
              <th title="Value-weighted across holdings, as of the latest feed">XIRR</th>
              <th title="Portfolio health 0–100 — five rule-scored components; +N is the jump available from open levers. Full breakdown on the client's Health tab.">Health</th>
              {cols.has('activity') && <th title="The most recent of anything — instalment or transaction">Last activity</th>}
              {cols.has('txn') && <th title="The last time they chose to do something, ignoring automated instalments">Last transaction</th>}
              {cols.has('sip') && <th title="The last instalment that ran on its own">Last SIP</th>}
              {cols.has('spoke') && <th title="The last logged conversation — call, meeting or note">Last spoken to</th>}
              {cols.has('parked') && <th title="Liquid and arbitrage money held longer than three months">Parked cash</th>}
              <th>SIP / month</th>
              <th title="The highest-value open action for this client">Next step</th>
              {cols.has('flags') && <th>Flags</th>}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.client_id}>
                <td><input type="checkbox" checked={selected.has(r.client_id)} onChange={() => toggle(r.client_id)} /></td>
                {/* The name is the way in, as it is on every other table here — this
                    was the one list where a client was plain text. */}
                <td>
                  <ClientLink id={r.client_id} name={r.name} />
                  {r.dup > 1 && (
                    <span className="sub" title={`Client number — ${r.dup} clients in this book share the name ${r.name}`}>№{r.client_id}</span>
                  )}
                </td>
                <td className="r num valbar" style={{ ['--w' as string]: (r.v / maxV) * 100 }}>{inr(r.v)}</td>
                {cols.has('invested') && <td className="r num">{inr(r.invested)}</td>}
                {cols.has('pnl') && (
                  <td className={`r num ${r.pnl >= 0 ? 'up' : 'down'}`}>{r.pnl >= 0 ? inr(r.pnl) : `−${inr(Math.abs(r.pnl))}`}</td>
                )}
                <td className={`r num ${r.wx != null && r.wx < 0 ? 'down' : 'up'}`}>{r.wx != null ? `${r.wx.toFixed(1)}%` : '—'}</td>
                <td style={{ textAlign: 'center' }}>
                  {health?.[r.client_id] ? (
                    <>
                      <span className={`fchip ${health[r.client_id].cls}`}>{health[r.client_id].score}</span>
                      {health[r.client_id].gain > 0 && <span className="gainchip" style={{ marginLeft: 4 }}>+{health[r.client_id].gain}</span>}
                    </>
                  ) : '—'}
                </td>
                {cols.has('activity') && <td className="num" style={{ textAlign: 'center' }}>{r.last_activity ? dmy2(r.last_activity) : '—'}</td>}
                {cols.has('txn') && <td className="num" style={{ textAlign: 'center' }}>{r.last_txn ? dmy2(r.last_txn) : '—'}</td>}
                {cols.has('sip') && <td className="num" style={{ textAlign: 'center' }}>{r.last_sip ? dmy2(r.last_sip) : '—'}</td>}
                {cols.has('spoke') && (
                  <td className="num" style={{ textAlign: 'center' }}>
                    {r.last_spoke
                      ? dmy2(r.last_spoke)
                      : <span className="fchip conc" title="No call, meeting or note has ever been logged">never</span>}
                  </td>
                )}
                {cols.has('parked') && (
                  <td className="r num">{r.parked > 0 ? inrCompact(r.parked) : '—'}</td>
                )}
                <td className="r num">{r.sip_monthly > 0 ? inrCompact(r.sip_monthly) : <span className="sub" title="No live SIP — an opportunity">none</span>}</td>
                <td style={{ textAlign: 'center' }}>
                  {r.top_action
                    ? <span className={`fchip ${['sip_bounce_save', 'kyc_unstick'].includes(r.top_action) ? 'conc' : 'stale'}`}>{typeOf(r.top_action).label}</span>
                    : <span className="sub">—</span>}
                </td>
                {cols.has('flags') && (
                  <td style={{ textAlign: 'center' }}>
                    {r.flags.split(',').filter(Boolean).map(f => {
                      const [label, cls] = FLAG_LABEL[f] ?? [f, 'stale'];
                      return <span key={f} className={`fchip ${cls}`}>{label}</span>;
                    })}
                  </td>
                )}
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
              {cols.has('invested') && <td className="r num">{inr(totals.invested)}</td>}
              {cols.has('pnl') && <td className={`r num ${pnlTotal >= 0 ? 'up' : 'down'}`}>{pnlTotal >= 0 ? inr(pnlTotal) : `−${inr(Math.abs(pnlTotal))}`}</td>}
              <td></td>
              <td></td>
              {cols.has('activity') && <td></td>}
              <td className="r num">{inrCompact(rows.reduce((s, r) => s + r.sip_monthly, 0))}</td>
              <td></td>
              {cols.has('flags') && <td></td>}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
