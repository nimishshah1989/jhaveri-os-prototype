'use client';

import {
  ResponsiveContainer, ComposedChart, Area, Line, BarChart, Bar, Cell,
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, LabelList,
} from 'recharts';

/* ── Charts, in the Folio's own voice ────────────────────────────────────────
   The broker lens got a plotting kit; this lens had bars made of divs and
   nothing else, which is why it read as text with numbers in it. Same library —
   already installed, so no new dependency — different palette, different
   density, and phone-first sizes.

   Three rules this file keeps, from DESIGN.md and frontend-viz.md:

   1. **Tokens only.** Every colour is `var(--f-…)`, so a chart inverts with the
      lamp instead of needing a dark-mode copy. A hex literal here is a colour
      nobody agreed to.
   2. **Never colour alone.** Every series is named in a legend beside the plot,
      and every signed figure keeps its sign in the tooltip.
   3. **The exact value is always reachable.** The axis is rounded for reading;
      the hover is not rounded at all.

   Motion: series animate in once on mount and are instant under
   `prefers-reduced-motion`, which the media query at the foot of folio.css
   already enforces for everything inside `.folio`.                            */

const AXIS = { fill: 'var(--f-faint)', fontSize: 10.5 };
const GRID = 'var(--f-line)';

const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(Math.round(n))}`;

/** One unit for a whole axis, chosen from its largest value — never per tick. */
function money(values: number[]): (n: number) => string {
  const max = Math.max(0, ...values.map(v => Math.abs(v)));
  const [div, suffix] = max >= 1e7 ? [1e7, ' Cr'] : max >= 1e5 ? [1e5, ' L'] : [1, ''];
  return (n: number) => `${n < 0 ? '−' : ''}₹${(Math.abs(n) / div).toFixed(div === 1 ? 0 : 1)}${suffix}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthTick = (iso: string) => {
  const [y, m] = iso.slice(0, 7).split('-');
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

interface TipRow { name: string; value: number | string; color?: string }

/** The house tooltip. Exact values, never the axis's rounding. */
function Tip({ active, label, rows }: { active?: boolean; label?: string; rows: TipRow[] }) {
  if (!active || !rows.length) return null;
  return (
    <div style={{
      background: 'var(--f-card)', border: '1px solid var(--f-line)', borderRadius: 6,
      padding: '8px 10px', boxShadow: 'var(--f-lift)', fontSize: 11.5, lineHeight: 1.5,
    }}>
      {label && <div style={{ color: 'var(--f-faint)', marginBottom: 4 }}>{label}</div>}
      {rows.map(r => (
        <div key={r.name} style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--f-muted)' }}>
            <i style={{
              display: 'inline-block', width: 7, height: 7, borderRadius: 2, marginRight: 5,
              background: r.color ?? 'var(--f-ink)',
            }} />
            {r.name}
          </span>
          <b className="num" style={{ color: 'var(--f-ink)', fontWeight: 650 }}>{r.value}</b>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="f-legend" style={{ marginTop: 8 }}>
      {items.map(i => (
        <span key={i.name}>
          <b style={{ color: i.color }}>■</b>{i.name}
        </span>
      ))}
    </div>
  );
}

/* ── the arc: what it is worth, what went in, and the index on the same dates ── */

export interface ArcPoint { d: string; value: number; invested: number; benchmark: number }

export function FolioArc({ data, height = 168 }: { data: ArcPoint[]; height?: number }) {
  if (data.length < 2) return null;
  const fmt = money(data.flatMap(p => [p.value, p.invested, p.benchmark]));
  return (
    <>
      <div style={{ height, margin: '10px -6px 0' }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 380, height }}>
          <ComposedChart data={data} margin={{ top: 4, right: 6, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="folioArc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--f-gold)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--f-gold)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="d" tick={AXIS} stroke={GRID} tickFormatter={monthTick}
              minTickGap={28} tickLine={false} />
            <YAxis tick={AXIS} stroke={GRID} tickFormatter={fmt} width={48}
              tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: GRID }} content={({ active, label, payload }) => (
              <Tip active={active} label={label ? monthTick(String(label)) : ''} rows={(payload ?? []).map(p => ({
                name: String(p.name), value: inr(Number(p.value)), color: String(p.color),
              }))} />
            )} />
            <Area type="monotone" dataKey="value" name="Worth" stroke="var(--f-gold)"
              strokeWidth={2} fill="url(#folioArc)" dot={false} />
            <Line type="monotone" dataKey="invested" name="You put in" stroke="var(--f-ink)"
              strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="benchmark" name="The index, on your dates"
              stroke="var(--f-muted)" strokeWidth={1.25} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[
        { name: 'Worth', color: 'var(--f-gold)' },
        { name: 'You put in', color: 'var(--f-ink)' },
        { name: 'The index', color: 'var(--f-muted)' },
      ]} />
    </>
  );
}

/* ── a ranked bar: who holds what, which fund is which ─────────────────────── */

export interface BarRow { name: string; value: number | null; tone?: 'gold' | 'muted' | 'pos' | 'neg' }

const TONE: Record<string, string> = {
  gold: 'var(--f-gold)', muted: 'var(--f-track)', pos: 'var(--f-pos)', neg: 'var(--f-neg)',
};

/**
 * Horizontal because the labels are names, and a name rotated 45° is a name
 * nobody reads. A row whose value is null is drawn as a gap with its label
 * intact — the household's whole point is that a withheld figure is visible
 * as withheld, never as zero.
 */
export function FolioBars({ rows, height, unit = 'inr' }: {
  rows: BarRow[]; height?: number; unit?: 'inr' | 'pct';
}) {
  if (!rows.length) return null;
  const known = rows.filter(r => r.value != null) as { name: string; value: number; tone?: string }[];
  const fmt = unit === 'pct' ? (n: number) => `${n}%` : money(known.map(r => r.value));
  const h = height ?? Math.max(90, rows.length * 34 + 16);
  return (
    <div style={{ height: h, margin: '10px -6px 2px' }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 380, height: h }}>
        <BarChart data={rows.map(r => ({ ...r, value: r.value ?? 0, unknown: r.value == null }))}
          layout="vertical" margin={{ top: 0, right: 46, bottom: 0, left: 0 }} barCategoryGap="26%">
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tick={AXIS} stroke={GRID} tickFormatter={fmt} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={86}
            tickLine={false} axisLine={false} />
          <Tooltip cursor={{ fill: 'var(--f-gold-soft)' }} content={({ active, payload }) => {
            const p = payload?.[0]?.payload as { name: string; value: number; unknown: boolean } | undefined;
            return <Tip active={active} rows={p ? [{
              name: p.name, value: p.unknown ? 'not shared' : unit === 'pct' ? `${p.value}%` : inr(p.value),
              color: 'var(--f-gold)',
            }] : []} />;
          }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive>
            {rows.map((r, i) => (
              <Cell key={i} fill={r.value == null ? 'var(--f-track)' : TONE[r.tone ?? 'gold']} />
            ))}
            <LabelList dataKey="value" position="right"
              formatter={(v: React.ReactNode) => (Number(v) ? (unit === 'pct' ? `${Number(v)}%` : fmt(Number(v))) : '—')}
              style={{ fill: 'var(--f-muted)', fontSize: 10.5 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ── the style box: two axes, and the path the fund took across them ───────── */

export interface StylePoint { as_of: string; size_score: number; value_score: number; box: string; source: string }

/**
 * The one genuinely two-dimensional thing in the app, so it gets the one
 * genuinely two-dimensional chart. Size on the vertical, value-to-growth on the
 * horizontal, and the fund plotted at each quarter so drift is a path rather
 * than a word. Today's point is filled; the seeded history behind it is hollow,
 * because a stand-in should not look like a measurement.
 */
export function FolioStyleBox({ points, height = 190 }: { points: StylePoint[]; height?: number }) {
  if (points.length < 2) return null;
  const last = points.length - 1;
  const data = points.map((p, i) => ({ ...p, x: p.value_score, y: p.size_score, now: i === last }));
  return (
    <>
      <div style={{ height, margin: '10px -6px 0' }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 380, height }}>
          <ScatterChart margin={{ top: 6, right: 10, bottom: 2, left: 0 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis type="number" dataKey="x" domain={[1, 3]} ticks={[1, 2, 3]} tick={AXIS} stroke={GRID}
              tickFormatter={(v: number) => (v === 1 ? 'Value' : v === 2 ? 'Blend' : 'Growth')} tickLine={false} />
            <YAxis type="number" dataKey="y" domain={[1, 3]} ticks={[1, 2, 3]} tick={AXIS} stroke={GRID}
              tickFormatter={(v: number) => (v === 1 ? 'Small' : v === 2 ? 'Mid' : 'Large')}
              width={44} tickLine={false} axisLine={false} />
            <ReferenceLine x={2} stroke={GRID} />
            <ReferenceLine y={2} stroke={GRID} />
            <Tooltip cursor={false} content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              return <Tip active={active} label={p ? monthTick(p.as_of) : ''} rows={p ? [
                { name: p.box, value: p.now ? 'today' : 'stand-in', color: 'var(--f-gold)' },
              ] : []} />;
            }} />
            <Scatter data={data} line={{ stroke: 'var(--f-line)', strokeWidth: 1.5 }} isAnimationActive>
              {data.map((p, i) => (
                <Cell key={i} fill={p.now ? 'var(--f-gold)' : 'var(--f-card)'} stroke="var(--f-gold)" strokeWidth={1.5} />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <Legend items={[
        { name: 'Today, from what it holds', color: 'var(--f-gold)' },
        { name: 'Earlier quarters, seeded', color: 'var(--f-line)' },
      ]} />
    </>
  );
}

/* ── two ratios facing each other ──────────────────────────────────────────── */

/**
 * Upside and downside capture read as a pair or not at all: 110% of the rises
 * is a different fund depending on whether it also took 90% or 130% of the
 * falls. Drawn against a 100% reference so "more than the index" is a position
 * on the chart rather than a number to compare in your head.
 */
export function FolioCapture({ up, down, height = 96 }: { up: number; down: number; height?: number }) {
  const rows = [
    { name: 'Of the rises', value: up, tone: 'pos' as const },
    { name: 'Of the falls', value: down, tone: 'neg' as const },
  ];
  return (
    <div style={{ height, margin: '10px -6px 2px' }}>
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 380, height }}>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 44, bottom: 0, left: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" domain={[0, (d: number) => Math.max(140, Math.ceil(d / 20) * 20)]}
            tick={AXIS} stroke={GRID} tickFormatter={(v: number) => `${v}%`} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" tick={AXIS} stroke={GRID} width={82} tickLine={false} axisLine={false} />
          {/* The index itself. Everything is read against this line. */}
          <ReferenceLine x={100} stroke="var(--f-ink)" strokeDasharray="3 3"
            label={{ value: 'the index', position: 'top', fill: 'var(--f-faint)', fontSize: 10 }} />
          <Tooltip cursor={{ fill: 'var(--f-gold-soft)' }} content={({ active, payload }) => {
            const p = payload?.[0]?.payload as { name: string; value: number } | undefined;
            return <Tip active={active} rows={p ? [{ name: p.name, value: `${p.value}%`, color: 'var(--f-gold)' }] : []} />;
          }} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive>
            {rows.map((r, i) => <Cell key={i} fill={TONE[r.tone]} />)}
            <LabelList dataKey="value" position="right" formatter={(v: React.ReactNode) => `${Number(v)}%`}
              style={{ fill: 'var(--f-muted)', fontSize: 10.5 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
