/**
 * verify-folio — the client lens as a reading surface, not just a correct one.
 *
 * Why this file exists. The broker lens has had a standing-prose budget that
 * fails the build since the day it was written. The client lens never had one,
 * and on 12-Aug-2026 the founder read it back as "text heavy, should have more
 * visual elements, be a lil more spacious". He was right, and nothing in the
 * suite had noticed: Events measured 159 standing words a screen against a
 * 110-word rule, the household 124, and there were **zero charts in the entire
 * lens** while the broker side had a whole plotting kit.
 *
 * Every other verifier here re-derives a number the screen claims. This one
 * checks the screen is worth reading. It reads source rather than pixels — the
 * same trade `verify-design.ts` makes — so it proves a page carries a chart and
 * roughly how much prose it stands up, not that a specific paragraph wrapped.
 * The pixel measurement is a browser pass, recorded in DESIGN.md.
 *
 * Run: npx tsx mockdb/verify-folio.ts   (joined to `npm run verify:all`)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const read = (p: string) => readFileSync(p, 'utf8');

console.log('\nverify-folio — the client lens as something a person reads\n');

/* ── the pages, and what each one is for ──────────────────────────────────── */

// Reading surfaces are read top to bottom, so length is a cost. A directory is
// arrived at knowing which section you want, so it is capped on words but not
// on depth. Same split DESIGN.md draws.
const DIRECTORY = new Set(['app/me/desk/page.tsx']);

const pages = readdirSync('app/me', { recursive: true, encoding: 'utf8' })
  .filter(f => f.endsWith('page.tsx'))
  .map(f => join('app/me', f))
  .sort();

check('the client lens has pages to measure', pages.length >= 8, `${pages.length} pages`);

/* ── standing prose, counted the way the broker lens counts it ────────────── */

/** Ceilings for a page with no frozen baseline yet — a new surface. */
const PROSE_BUDGET = 200;
const DIRECTORY_BUDGET = 380;

/** An element and everything inside it, matched by counting its own opens. */
function stripElement(src: string, name: string): string {
  let s = src;
  for (;;) {
    const m = new RegExp(`<${name}\\b`).exec(s);
    if (!m) return s;
    let i = m.index, depth = 0, selfClosed = false;
    for (; i < s.length; i++) {
      if (s.startsWith(`<${name}`, i)) { depth++; continue; }
      if (s.startsWith(`</${name}`, i)) {
        i = s.indexOf('>', i) + 1;
        if (--depth === 0) break;
        i--; continue;
      }
      if (s[i] === '/' && s[i + 1] === '>' && depth === 1) { i += 2; selfClosed = true; break; }
    }
    if (!selfClosed && depth > 0 && i >= s.length) return s;
    s = s.slice(0, m.index) + ' ' + s.slice(i);
  }
}

// Behind a tap is not standing prose — that is where DESIGN.md says depth goes.
// Nor is the text on a control: a button is the thing you act on.
const HIDDEN = ['details', 'button', 'summary', 'option', 'select'];

/**
 * Words a client scrolls past, counted from the source.
 *
 * DELIBERATELY does not strip `{…}` expressions, and that is the whole design of
 * this counter. Almost every card in this lens is rendered inside a
 * `{rows.map(e => …)}`, so a counter that removes expressions removes the page:
 * measured when this was written, Events kept 7 elements out of its whole render
 * and reported almost no prose, on a page the browser measured at 183 standing
 * words. A counter that cannot see the text is worse than no counter.
 *
 * The cost of leaving expressions in is that some identifiers get counted as
 * words. That is fine, because the number is never read as an absolute — it is
 * compared against this page's own frozen baseline below. Consistent
 * over-counting is a usable instrument; blindness is not.
 */
function standingProse(src: string): { words: number; tagsLeft: number } {
  const at = src.indexOf('return (');
  let s = at >= 0 ? src.slice(at) : src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const tag of HIDDEN) s = stripElement(s, tag);
  const text: string[] = [];
  for (const m of s.matchAll(/>([^<>]+)</g)) text.push(m[1]);
  const words = text.join(' ').replace(/&[a-z]+;/g, ' ').split(/\s+/)
    .filter(w => /^[A-Za-z][A-Za-z'\u2019.,;:!?\u2014-]*$/.test(w)).length;
  return { words, tagsLeft: [...s.matchAll(/<[a-zA-Z]/g)].length };
}

/**
 * What each page measured on 12-Aug-2026, after the founder's "text heavy" note
 * and the cuts that answered it. Frozen, not aspirational: the gate is that no
 * page GROWS. Lower a number when a page is trimmed; never raise one without
 * saying why in DESIGN.md's decisions log.
 *
 * The browser numbers these correspond to — standing words per rendered screen,
 * which is the rule DESIGN.md actually states — are recorded there too.
 */
const PROSE_BASELINE: Record<string, number> = {
  'ask': 149,
  'desk': 540,
  'discover': 235,
  'events': 110,
  'goals': 124,
  'goals/[goalId]': 178,
  'household': 227,
  'household/[memberId]': 183,
  'invest': 300,
  'orders': 156,
  'portfolio': 38,
  'portfolio/[schemeId]': 221,
  'portfolio/[schemeId]/research': 285,
  'portfolio/company/[stock]': 108,
  'portfolio/register': 44,
  'portfolio/sector/[sector]': 99,
  'today': 92,
};

for (const p of pages) {
  const { words, tagsLeft } = standingProse(read(p));
  const name = p === 'app/me/page.tsx' ? 'today' : p.replace('app/me/', '').replace('/page.tsx', '');
  // Catches a broken counter rather than a wordy page: a scan that ran off the
  // end of the file leaves no markup behind at all.
  check(`${name}: the prose counter still sees the page`, tagsLeft >= 8,
    `${tagsLeft} elements survived`);
  const ceiling = PROSE_BASELINE[name] ?? (DIRECTORY.has(p) ? DIRECTORY_BUDGET : PROSE_BUDGET);
  check(`${name}: adds no standing prose`, words <= ceiling, `${words} words, ceiling ${ceiling}`);
}

/* ── every lens needs pictures, and this one had none ─────────────────────── */

const KIT = 'app/me/folio-charts.tsx';
check('the client lens has a chart kit of its own', existsSync(KIT));

if (existsSync(KIT)) {
  const kit = read(KIT);
  check('it plots with the library already installed, not a second one',
    /from 'recharts'/.test(kit));
  // A hex literal is a colour that cannot invert with the lamp.
  const literals = [...kit.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
  check('every colour in it is a token, so a chart inverts with the theme',
    literals.length === 0, literals.join(', ') || 'tokens only');
  check('every chart is reachable by hover for its exact value', /<Tooltip/.test(kit));
  check('and names its series rather than relying on colour alone', /function Legend/.test(kit));
}

// The surfaces whose subject is a quantity over time, a comparison or a split.
// Each has to draw it. This is the check that would have caught a lens with a
// plotting kit on one side and none on the other.
const MUST_PLOT: [string, string][] = [
  ['app/me/page.tsx', 'what the money has done over time'],
  ['app/me/household/page.tsx', 'how the household divides between its members'],
  ['app/me/events/page.tsx', 'what each change puts at stake'],
  ['app/me/portfolio/elsewhere-tab.tsx', 'advised against held away'],
  ['app/me/portfolio/[schemeId]/research/page.tsx', 'style drift and capture'],
];
const CHARTS = ['FolioArc', 'FolioBars', 'FolioStyleBox', 'FolioCapture'];
for (const [file, subject] of MUST_PLOT) {
  const src = existsSync(file) ? read(file) : '';
  const drawn = CHARTS.filter(c => new RegExp(`<${c}[\\s/>]`).test(src));
  check(`${file.replace('app/me/', '')} draws ${subject}`,
    drawn.length > 0, drawn.join(' · ') || 'stated in a sentence it could have drawn');
}

/* ── air ──────────────────────────────────────────────────────────────────── */

const css = read('app/me/folio.css');
const px = (prop: string, sel: string): number | null => {
  const block = new RegExp(`\\${sel}\\s*\\{[^}]*\\}`).exec(css);
  if (!block) return null;
  const m = new RegExp(`${prop}:\\s*(\\d+)px`).exec(block[0]);
  return m ? Number(m[1]) : null;
};
// The founder asked for more room on 12-Aug-2026. These are the numbers that
// answered him, held so a later tidy-up cannot quietly take it back.
check('a card has room inside it', (px('padding', '.f-card') ?? 0) >= 18, `${px('padding', '.f-card')}px`);
check('and room between it and the next one', (px('margin-bottom', '.f-card') ?? 0) >= 16,
  `${px('margin-bottom', '.f-card')}px`);
check('a section label has room above it', /\.f-sect\s*\{[\s\S]*?margin:\s*2[4-9]px/.test(css));
check('and a row is tappable without being tight', (px('padding', '.f-row') ?? 0) >= 14, `${px('padding', '.f-row')}px`);

/* ── the two grounds, still one system ────────────────────────────────────── */

const dark = /\.folio\[data-theme='dark'\]\s*\{([^}]*)\}/.exec(css);
const light = /^\.folio\s*\{([^}]*)\}/m.exec(css);
if (dark && light) {
  const names = (s: string) => [...s.matchAll(/(--f-[a-z-]+):/g)].map(m => m[1]).sort();
  check('every token defined in light is redefined in dark',
    names(light[1]).every(n => names(dark[1]).includes(n)),
    names(light[1]).filter(n => !names(dark[1]).includes(n)).join(', ') || 'all covered');
}

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
