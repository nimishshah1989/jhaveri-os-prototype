'use client';

import { Fragment, useState } from 'react';
import type { Holding } from '../lib/client360';
import { inr } from '../lib/format';

const LT_DAYS = 365;

function bucketChip(days: number) {
  if (days > LT_DAYS) return <span className="fchip lt">LTCG</span>;
  const toLt = LT_DAYS - days;
  return (
    <span className="fchip conc" title={toLt <= 45 ? `becomes LTCG in ${toLt} days` : undefined}>
      STCG{toLt <= 45 ? ` · LT in ${toLt}d` : ''}
    </span>
  );
}

export function HoldingsTable({ rows }: { rows: Holding[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  return (
    <div className="tblwrap">
      <table>
        <thead>
          <tr>
            <th>Fund</th><th>Folio</th><th className="r">Units</th><th className="r">NAV</th>
            <th className="r">Value</th><th className="r">P&amp;L</th><th className="r">Weight</th>
            <th className="r">XIRR</th><th className="r">Benchmark</th><th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(h => {
            const pnl = h.value - h.invested;
            const lagging = h.xirr != null && h.bmxirr != null && h.xirr < h.bmxirr - 10;
            return (
              <Fragment key={`${h.scheme_id}-${h.folio_no}`}>
                <tr style={lagging ? { background: 'var(--amber-soft)' } : undefined}>
                  <td>{h.fund_name} <span className="sub">{h.fund_category}</span></td>
                  <td className="num">{h.folio_no}</td>
                  <td className="r num">{h.units.toFixed(2)}</td>
                  <td className="r num">{h.nav.toFixed(2)}</td>
                  <td className="r num">{inr(h.value)}</td>
                  <td className={`r num ${pnl >= 0 ? 'up' : 'down'}`}>{pnl >= 0 ? '+' : '−'}{inr(Math.abs(pnl))}</td>
                  <td className="r num">{h.weight != null ? `${h.weight.toFixed(1)}%` : '—'}</td>
                  <td className={`r num ${h.xirr != null && h.xirr < 0 ? 'down' : 'up'}`}>{h.xirr != null ? `${h.xirr >= 0 ? '+' : ''}${h.xirr.toFixed(1)}%` : '—'}</td>
                  <td className="r num">
                    {h.bmxirr != null ? `${h.bmxirr >= 0 ? '+' : ''}${h.bmxirr.toFixed(1)}%` : '—'}
                    {lagging && <span className="fchip conc" style={{ marginLeft: 4 }}>lagging</span>}
                  </td>
                  <td>
                    <button type="button" className="expand" onClick={() => toggle(h.scheme_id)}>
                      {open.has(h.scheme_id) ? '▴' : '▾'} {h.lots.length} lots
                    </button>
                  </td>
                </tr>
                {open.has(h.scheme_id) && h.lots.map((l, i) => {
                  const g = l.unreal_lt + l.unreal_st;
                  return (
                    <tr key={i} className="lotrow">
                      <td style={{ paddingLeft: 28 }} className="num">{l.purchase_date}</td>
                      <td></td>
                      <td className="r num">{l.units.toFixed(2)}</td>
                      <td className="r num">@{l.price.toFixed(2)}</td>
                      <td className="r num">{inr(l.current_value)}</td>
                      <td className={`r num ${g >= 0 ? 'up' : 'down'}`}>{g >= 0 ? '+' : '−'}{inr(Math.abs(g))}</td>
                      <td className="r num" colSpan={2}>{l.holding_days} days held</td>
                      <td className="r">{bucketChip(l.holding_days)}</td>
                      <td>{h.exit_load === 1 && l.holding_days < LT_DAYS && <span className="sub">exit load</span>}</td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
