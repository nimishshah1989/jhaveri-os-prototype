// Inline SVG only — no icon dependency, nothing to load, and every glyph inherits
// currentColor so it takes the tone of whatever it sits in.
// Icons here carry meaning (state, direction, kind). Decoration is not a reason to
// add one: if removing it loses nothing, it should not be here.

const PATHS: Record<string, string> = {
  up: 'M8 3.5 13 9H9.8v4.5H6.2V9H3z',
  down: 'M8 13.5 3 8h3.2V3.5h3.6V8H13z',
  flat: 'M3 7.2h10v1.6H3z',
  alert: 'M8 1.6 15 14H1zM7.2 6h1.6v4H7.2zm0 5h1.6v1.6H7.2z',
  clock: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13m0 1.6a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8m-.8 1.4v3.8l3 1.8.8-1.3-2.2-1.3V4.5z',
  money: 'M2 3.5h12v9H2zm1.6 1.6v5.8h8.8V5.1zM8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4',
  users: 'M5.6 7.5a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4m5 .4a1.9 1.9 0 1 0 0-3.8 1.9 1.9 0 0 0 0 3.8M1.5 13c0-2.2 1.8-3.7 4.1-3.7s4.1 1.5 4.1 3.7zm9.4-3.4c1.9 0 3.6 1 3.6 3.4h-2.7c0-1.3-.4-2.4-1.2-3.2z',
  target: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13m0 1.7a4.8 4.8 0 1 1 0 9.6 4.8 4.8 0 0 1 0-9.6m0 1.8a3 3 0 1 0 0 6 3 3 0 0 0 0-6m0 1.7a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6',
  mail: 'M1.5 3.5h13v9h-13zm1.8 1.6L8 8.4l4.7-3.3zm-.2 1.9v4h9.8v-4L8 10.3z',
  check: 'M6.2 12.4 1.8 8l1.5-1.5 2.9 2.9 6-6L13.7 5z',
  cross: 'M12.6 4.5 9.1 8l3.5 3.5-1.1 1.1L8 9.1l-3.5 3.5-1.1-1.1L6.9 8 3.4 4.5l1.1-1.1L8 6.9l3.5-3.5z',
  info: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13m-.9 3h1.8v1.8H7.1zm0 3h1.8v4.5H7.1z',
  bulb: 'M8 1.4a4.4 4.4 0 0 0-2.6 7.9c.5.4.8 1 .8 1.6h3.6c0-.6.3-1.2.8-1.6A4.4 4.4 0 0 0 8 1.4M6.2 12h3.6v1.2H6.2zm.6 2h2.4l-.6.8H7.4z',
  arrow: 'M8.8 3.2 13.6 8l-4.8 4.8-1.2-1.2 2.8-2.8H2.4V7.2h8L7.6 4.4z',
  calendar: 'M4 1.5h1.6v1.3H4zm6.4 0H12v1.3h-1.6zM1.8 3.4h12.4v11H1.8zm1.6 3v6.4h9.2V6.4z',
  file: 'M3 1.5h6.5L13 5v9.5H3zm1.7 1.7v9.6h6.6V6H8.6V3.2z',
  shield: 'M8 1.4 13.5 3v4.6c0 3.2-2.2 5.9-5.5 7-3.3-1.1-5.5-3.8-5.5-7V3zm0 1.8L4.2 4.3v3.3c0 2.3 1.5 4.2 3.8 5.1 2.3-.9 3.8-2.8 3.8-5.1V4.3z',
  spark: 'M8 1.3 9.6 6l4.7 1.6L9.6 9.2 8 13.9 6.4 9.2 1.7 7.6 6.4 6z',
  link: 'M6.6 9.4a2.6 2.6 0 0 1 0-3.7l2.3-2.3a2.6 2.6 0 1 1 3.7 3.7l-1 1-1.2-1.2 1-1a.9.9 0 1 0-1.3-1.3L7.8 6.9a.9.9 0 0 0 0 1.3zM9.4 6.6a2.6 2.6 0 0 1 0 3.7l-2.3 2.3a2.6 2.6 0 1 1-3.7-3.7l1-1 1.2 1.2-1 1a.9.9 0 1 0 1.3 1.3l2.3-2.3a.9.9 0 0 0 0-1.3z',
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: string; className?: string }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg className={`ic ${className ?? ''}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={d} fill="currentColor" />
    </svg>
  );
}

/** Direction glyph for a signed number. Never colour alone — the arrow carries it too. */
export function Trend({ n, className }: { n: number; className?: string }) {
  return <Icon name={n > 0 ? 'up' : n < 0 ? 'down' : 'flat'} className={className} />;
}
