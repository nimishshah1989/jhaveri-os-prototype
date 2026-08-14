'use client';

import {
  ResponsiveContainer, ComposedChart, ScatterChart, Bar, Line, Area, Scatter,
  XAxis, YAxis, ZAxis, CartesianGrid, Tooltip, Legend, Cell, LabelList,
  ReferenceLine, ReferenceArea,
} from 'recharts';
import { useRouter } from 'next/navigation';
import { inrCompact, inrExact } from '../lib/format';

// The only file in the product allowed to import a plotting library, and the only
// file allowed to choose a chart colour. Both are enforced in verify-design.ts —
// the same rule that keeps one action vocabulary in lib/queue-display.ts, applied
// to pictures. A second place either of those decisions can be made is how the
// tables drifted apart the first time.
//
// Every chart here owes its reader four things, so they are structural rather than
// optional: an axis with a unit on it, a legend once there is more than one series,
// the exact number on hover, and the name of the table the figure came from.

// ── Colour ──────────────────────────────────────────────────────────────────
// Nothing new: the five meanings lib/queue-display.ts already assigns to queue
// work, plus the s1–s4 categorical slots globals.css already declares and the
// funnel, tax gauge and asset mix already use. A hex here is a tenth colour.
export const TONE = {
  red: 'var(--neg)',      // at risk
  amber: 'var(--amber)',  // needs a decision
  green: 'var(--pos)',    // good
  blue: 'var(--accent)',  // informational
  grey: 'var(--grey)',    // inert
  s1: 'var(--s1)', s2: 'var(--s2)', s3: 'var(--s3)', s4: 'var(--s4)',
} as const;

export type Tone = keyof typeof TONE;

// A chart row is a plain bag of labels and numbers, built at the call site out of
// whatever the page already queried. Deliberately not generic over the query
// types: a chart is a view of a few columns, and threading the whole row type
// through it buys nothing but a wall of inference errors.
export type Row = Record<string, string | number>;

// ── Units ───────────────────────────────────────────────────────────────────
// The axis is rounded so it can be read at a glance; the hover is exact, because
// commission is argued over in paise. Money is lakh/crore throughout — never
// million/billion (founder rule).
export type Unit = 'inr' | 'count' | 'pct' | 'days' | 'bps';

const UNIT: Record<Unit, { axis: (n: number) => string; exact: (n: number) => string }> = {
  inr: { axis: inrCompact, exact: inrExact },
  count: { axis: n => String(n), exact: n => String(n) },
  pct: { axis: n => `${Math.round(n)}%`, exact: n => `${n.toFixed(1)}%` },
  days: { axis: n => `${Math.round(n)}d`, exact: n => `${n} day${n === 1 ? '' : 's'}` },
  bps: { axis: n => `${Math.round(n)}`, exact: n => `${n} bps` },
};

// ── Frame ───────────────────────────────────────────────────────────────────
// `source` is required, not optional: a chart that cannot say where its numbers
// came from does not belong on a page whose whole argument is provenance.
interface Frame {
  title: string;
  source: string;
  /** Axis titles. A bare tick strip makes the reader guess the unit. */
  xLabel: string;
  yLabel: string;
  height?: number;
  /** The one sentence the chart is making, under the plot. */
  mark?: React.ReactNode;
  /** The ⓘ, when the figure has a glossary entry behind it. */
  aside?: React.ReactNode;
  /**
   * One sentence describing what the chart shows and what it says, for a reader
   * who cannot see it. The hand-rolled SVG this kit replaced carried a real
   * aria-label; a plotting library does not give you one, so it stays a required
   * habit rather than something the library was trusted to do.
   */
  alt?: string;
  /** What the colours mean, when a single series is coloured per row. Without it
   *  the legend shows the series swatch — one colour that no mark on the plot is
   *  actually painted in, which is worse than no legend. */
  keyItems?: { name: string; tone: Tone }[];
}

const AXIS = { fill: 'var(--muted)', fontSize: 10.5 };
const GRID = 'var(--line)';
const AXIS_TITLE = { fill: 'var(--muted)', fontSize: 10.5 };

// Rupee ticks read "₹15,000"; at the default axis width the rotated axis title
// lands on top of them. Width follows the unit rather than a single guess.
const yWidth = (u: Unit) => (u === 'inr' ? 78 : 58);

// inrCompact switches unit per value, which is right in a sentence and wrong on an
// axis: a scale running ₹0 · ₹80.00 L · ₹1.60 Cr asks the reader to convert between
// ticks to see that they are evenly spaced. One unit for the whole axis, chosen
// from the largest value on it. The hover stays exact and unrounded.
function moneyAxis(data: Row[], keys: string[]): (n: number) => string {
  const max = Math.max(0, ...data.flatMap(r => keys.map(k => Math.abs(Number(r[k]) || 0))));
  const [div, suffix] = max >= 1e7 ? [1e7, ' Cr'] : max >= 1e5 ? [1e5, ' L'] : [1, ''];
  const dp = div === 1 ? 0 : 2;
  return (n: number) => `${n < 0 ? '−' : ''}₹${(Math.abs(n) / div).toFixed(dp)}${suffix}`;
}

const axisFormat = (unit: Unit, data: Row[], keys: string[]) =>
  unit === 'inr' ? moneyAxis(data, keys) : UNIT[unit].axis;

// The legend sits above the plot. At the bottom it lands on the x-axis title,
// and one of the two always loses.
const LEGEND = {
  verticalAlign: 'top' as const, align: 'right' as const, height: 22,
  iconSize: 9, iconType: 'square' as const,
  wrapperStyle: { fontSize: 11.5, color: 'var(--muted)' },
};

// Recharts measures its container on the client, so a server render would ship an
// empty box and pop the chart in on hydration. An initial dimension makes the SSR
// pass draw at a sensible size and the resize observer correct it — a placeholder
// of the right shape rather than a spinner, and no layout jump.
const INITIAL = { width: 640, height: 200 };

function Figure({ title, source, mark, aside, keyItems, alt, height = 200, children }: Frame & { children: React.ReactElement }) {
  return (
    <figure className="chartfig">
      <h4>{title}{aside}</h4>
      {alt && <p className="vh">{alt}</p>}
      <div className="chartbody" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ ...INITIAL, height }}>
          {children}
        </ResponsiveContainer>
      </div>
      {/* Colours-per-row get the product's own legend rather than the library's:
          Recharts paints one swatch for the whole series, and on a per-row chart
          that swatch is a colour nothing on the plot is drawn in. `.lg` is the
          legend the asset mix and health split already use. */}
      {keyItems && (
        <div className="lg">
          {keyItems.map(i => <span key={i.name} style={{ ['--c' as string]: TONE[i.tone] }}><b>{i.name}</b></span>)}
        </div>
      )}
      {mark && <div className="mark">{mark}</div>}
      <figcaption>Source: {source}</figcaption>
    </figure>
  );
}

/**
 * Events on a line, not a series of their own: a purchase is a thing that happened
 * on a date, and its magnitude is not on the axis the line uses. So the mark sits
 * ON the curve at the month it landed, and the tooltip reads the amount out of a
 * different field — `amountKey` — rather than reporting the curve's own value back.
 * Shape carries the direction as well as colour, because colour never carries a
 * meaning alone (WCAG 1.4.1).
 */
export interface Marker {
  /** The field holding the y position — normally the line the event moved. */
  key: string;
  /** The field holding what actually happened, in rupees. */
  amountKey: string;
  name: string;
  tone: Tone;
  shape: 'triangle' | 'diamond';
}

const tip = (unit: Unit, markers: Marker[] = []) => ({
  cursor: { fill: 'var(--panel)' },
  contentStyle: {
    border: '1px solid var(--line)', borderRadius: 'var(--radius)', background: 'var(--ground)',
    fontSize: 12, boxShadow: 'var(--lift)', padding: '6px 10px',
  },
  labelStyle: { color: 'var(--ink)', fontWeight: 650, marginBottom: 2 },
  itemStyle: { color: 'var(--muted)', padding: 0 },
  formatter: (v: unknown, name: unknown, item?: { payload?: Row }) => {
    const m = markers.find(x => x.name === name);
    const shown = m ? Number(item?.payload?.[m.amountKey] ?? 0) : Number(v);
    return [UNIT[unit].exact(shown), String(name)] as [string, string];
  },
  // A month with no money movement has no marker, so its zero must not print a row.
  itemSorter: (i: { value?: unknown }) => -Number(i?.value ?? 0),
});

// ── Bars ────────────────────────────────────────────────────────────────────
// Magnitude, and comparison across a handful of categories or months. Series are
// named so the legend can carry identity; a single series needs no legend box
// because the title already names it.
export interface Series {
  key: string;
  name: string;
  tone: Tone;
  /** Stack id — segments of one whole share it. */
  stack?: string;
}

export function ChartBars({
  data, xKey, series, unit = 'count', horizontal, toneKey, hrefKey, ...frame
}: Frame & {
  data: Row[];
  xKey: string;
  series: Series[];
  unit?: Unit;
  /** Categories read down the page rather than across — long names, few rows. */
  horizontal?: boolean;
  /** Field on each row holding that row's tone, when one series means several
   *  different things. A field rather than a callback: this is a client
   *  component and a server page cannot hand it a function. */
  toneKey?: string;
  /** Field on each row holding where that bar navigates to. A bar that replaced a
   *  clickable strip has to stay clickable; pages that use it keep the same links
   *  in text beneath the plot, because an SVG rect takes no keyboard focus. */
  hrefKey?: string;
}) {
  const router = useRouter();
  const go = hrefKey
    ? (d: { payload?: Row }) => {
        const href = d?.payload?.[hrefKey];
        if (typeof href === 'string') router.push(href);
      }
    : undefined;
  // A horizontal chart puts the category names down the left, where a fund called
  // "Parag Parikh Large Cap Reg Gr" needs real room. Sized to the longest label
  // rather than a fixed guess, and interval 0 so Recharts renders every one
  // instead of quietly dropping the ones that do not fit.
  const longest = Math.max(0, ...data.map(r => String(r[xKey] ?? '').length));
  const catWidth = Math.min(190, Math.max(112, Math.round(longest * 5.4) + 12));
  const cat = {
    dataKey: xKey, tick: AXIS, stroke: GRID, type: 'category' as const,
    interval: 0 as const,
  };
  const val = { tick: AXIS, stroke: GRID, type: 'number' as const,
    tickFormatter: axisFormat(unit, data, series.map(x => x.key)) };
  return (
    <Figure {...frame}>
      <ComposedChart accessibilityLayer data={data} layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 6, right: 12, bottom: 18, left: 6 }}>
        <CartesianGrid stroke={GRID} vertical={!!horizontal} horizontal={!horizontal} />
        {horizontal
          ? <XAxis {...val} label={{ value: frame.xLabel, position: 'insideBottom', offset: -12, ...AXIS_TITLE }} />
          : <XAxis {...cat} label={{ value: frame.xLabel, position: 'insideBottom', offset: -12, ...AXIS_TITLE }} />}
        {horizontal
          ? <YAxis {...cat} width={catWidth} label={{ value: frame.yLabel, angle: -90, position: 'insideLeft', offset: 12, ...AXIS_TITLE }} />
          : <YAxis {...val} width={yWidth(unit)} label={{ value: frame.yLabel, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />}
        <Tooltip {...tip(unit)} />
        {series.length > 1 && <Legend {...LEGEND} />}
        {series.map(s => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stack} fill={TONE[s.tone]}
            radius={s.stack ? 0 : 3} maxBarSize={34} isAnimationActive={false}
            onClick={go} cursor={go ? 'pointer' : undefined}>
            {toneKey && data.map((row, i) => <Cell key={i} fill={TONE[row[toneKey] as Tone]} />)}
          </Bar>
        ))}
        <ReferenceLine {...(horizontal ? { x: 0 } : { y: 0 })} stroke={GRID} />
      </ComposedChart>
    </Figure>
  );
}

// ── Lines ───────────────────────────────────────────────────────────────────
// Change over time. One value axis only — two scales on one plot invent a
// correlation that is not in the data, so a second measure gets its own chart.
export function ChartLines({
  data, xKey, series, unit = 'inr', filled, bars, markers, endLabels, baseline = 'zero', ...frame
}: Frame & {
  data: Row[];
  xKey: string;
  series: Series[];
  unit?: Unit;
  /** Area under the line, for a running total rather than a rate. */
  filled?: boolean;
  /** Series drawn as columns beneath the lines — same axis, same unit. */
  bars?: Series[];
  /** Events drawn on the lines — money in, money out. */
  markers?: Marker[];
  /** Print the last value of each line beside it, so the figures are on the plot
   *  and not only in the hover. */
  endLabels?: boolean;
  /**
   * Where the value axis starts. 'zero' is the default and the honest one for
   * anything read as a magnitude. 'data' is for two series that sit within a
   * percent of each other: on a zero baseline they overplot into a single line
   * and the chart claims one measure where there are two. Legitimate only for
   * lines, which encode position — never for bars, which encode length.
   */
  baseline?: 'zero' | 'data';
}) {
  // Recharts' label formatter is handed the value and nothing else — no index — so
  // "label only the last point" cannot be a formatter decision. The field itself
  // only exists on the last row, and a row without it renders no label.
  const plotted = endLabels
    ? data.map((r, i) => (i === data.length - 1
      ? { ...r, ...Object.fromEntries(series.map(x => [`end_${x.key}`, r[x.key]])) }
      : r))
    : data;
  return (
    <Figure {...frame}>
      <ComposedChart accessibilityLayer data={plotted} margin={{ top: 6, right: endLabels ? 64 : 12, bottom: 18, left: 6 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} stroke={GRID} interval="preserveStartEnd"
          label={{ value: frame.xLabel, position: 'insideBottom', offset: -12, ...AXIS_TITLE }} />
        <YAxis tick={AXIS} stroke={GRID} width={yWidth(unit)}
          tickFormatter={axisFormat(unit, data, [...series, ...(bars ?? [])].map(x => x.key))}
          domain={baseline === 'data' ? ['dataMin', 'dataMax'] : [0, 'auto']}
          label={{ value: frame.yLabel, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
        <Tooltip {...tip(unit, markers)} />
        {series.length + (bars?.length ?? 0) + (markers?.length ?? 0) > 1 && <Legend {...LEGEND} />}
        {bars?.map(s => (
          <Bar key={s.key} dataKey={s.key} name={s.name} stackId={s.stack} fill={TONE[s.tone]}
            radius={s.stack ? 0 : 3} maxBarSize={22} isAnimationActive={false} />
        ))}
        {series.map(s => (filled
          ? <Area key={s.key} dataKey={s.key} name={s.name} stroke={TONE[s.tone]} strokeWidth={2}
              fill={TONE[s.tone]} fillOpacity={0.1} isAnimationActive={false} dot={false} />
          : <Line key={s.key} dataKey={s.key} name={s.name} stroke={TONE[s.tone]} strokeWidth={2}
              isAnimationActive={false} dot={{ r: 2.5, strokeWidth: 0, fill: TONE[s.tone] }} activeDot={{ r: 5 }}>
              {endLabels && (
                <LabelList dataKey={`end_${s.key}`} position="right" fontSize={10.5}
                  fill={TONE[s.tone]} formatter={(v: unknown) => UNIT[unit].axis(Number(v))} />
              )}
            </Line>
        ))}
        {markers?.map(m => (
          <Scatter key={m.key} dataKey={m.key} name={m.name} fill={TONE[m.tone]} shape={m.shape}
            isAnimationActive={false} />
        ))}
        <ReferenceLine y={0} stroke={GRID} />
      </ComposedChart>
    </Figure>
  );
}

// ── Scatter ─────────────────────────────────────────────────────────────────
// Two measures at once, for finding the client who is off the pattern — the one
// question a ranked table cannot answer, because it can only rank on one column.
export function ChartScatter({
  data, xKey, yKey, nameKey, xUnit = 'count', yUnit = 'inr', tone = 'blue', toneKey, quadrant, ...frame
}: Frame & {
  data: Row[];
  xKey: string;
  yKey: string;
  /** Field naming the dot. A dot with no identity is a shape, not a client. */
  nameKey: string;
  xUnit?: Unit;
  yUnit?: Unit;
  tone?: Tone;
  /** Field on each row holding that dot's tone — see ChartBars.toneKey. */
  toneKey?: string;
  /** The corner worth looking at, shaded and named. */
  quadrant?: { x1: number; x2: number; label: string };
}) {
  return (
    <Figure {...frame}>
      <ScatterChart accessibilityLayer margin={{ top: 6, right: 14, bottom: 18, left: 6 }}>
        <CartesianGrid stroke={GRID} />
        <XAxis type="number" dataKey={xKey} tick={AXIS} stroke={GRID} tickFormatter={axisFormat(xUnit, data, [xKey])}
          label={{ value: frame.xLabel, position: 'insideBottom', offset: -12, ...AXIS_TITLE }} />
        <YAxis type="number" dataKey={yKey} tick={AXIS} stroke={GRID} width={yWidth(yUnit)}
          tickFormatter={axisFormat(yUnit, data, [yKey])}
          label={{ value: frame.yLabel, angle: -90, position: 'insideLeft', ...AXIS_TITLE }} />
        <ZAxis range={[26, 26]} />
        <Tooltip
          {...tip(yUnit)}
          cursor={{ strokeDasharray: '0', stroke: 'var(--line)' }}
          formatter={(v: unknown, name: unknown) => [
            String(name) === String(xKey) ? UNIT[xUnit].exact(Number(v)) : UNIT[yUnit].exact(Number(v)),
            String(name) === String(xKey) ? frame.xLabel : frame.yLabel,
          ] as [string, string]}
          // The dot is 8px across; the row behind it is a person. Name them.
          labelFormatter={(_: unknown, payload: readonly { payload?: Row }[]) =>
            String(payload?.[0]?.payload?.[nameKey] ?? '')}
        />
        {quadrant && (
          <ReferenceArea x1={quadrant.x1} x2={quadrant.x2} fill={TONE.amber} fillOpacity={0.07}
            label={{ value: quadrant.label, position: 'insideTopLeft', fill: 'var(--muted)', fontSize: 10.5 }} />
        )}
        <Scatter data={data} name={frame.title} fill={TONE[tone]} isAnimationActive={false}
          stroke="var(--ground)" strokeWidth={2}>
          {toneKey && data.map((row, i) => <Cell key={i} fill={TONE[row[toneKey] as Tone]} />)}
        </Scatter>
      </ScatterChart>
    </Figure>
  );
}
