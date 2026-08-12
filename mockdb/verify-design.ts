// The design budget, as a test. Every other verifier here re-derives a number the
// screen claims; this one checks the screen is readable at all. Nine measures, each
// with a source, so a layout argument is settled the way a money argument is.
//
// It reads the stylesheet, the tokens and the page source — NOT a rendered browser.
// That keeps it dependency-free and instant, at the cost of measuring declarations
// rather than pixels: it proves the cap is set, not that a specific paragraph obeyed
// it. Anything needing real layout is called out as such rather than faked.
//
// Usage: npx tsx mockdb/verify-design.ts

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const css = readFileSync('app/globals.css', 'utf8');
const read = (p: string) => readFileSync(p, 'utf8');

// ── 1. Measure ──────────────────────────────────────────────────────────────
// 45–75 characters a line (Bringhurst; Dyson & Haselgrove on line length and
// comprehension). Set in ch units so it tracks the font, not a pixel guess.
const MEASURE_MIN = 45;
const MEASURE_MAX = 75;

const measure = /--measure:\s*(\d+)ch/.exec(css);
check('a single measure token defines the line length',
  !!measure, measure ? `--measure: ${measure[1]}ch` : 'no --measure token in globals.css');
if (measure) {
  const ch = Number(measure[1]);
  check('the measure sits inside the readable range',
    ch >= MEASURE_MIN && ch <= MEASURE_MAX, `${ch}ch, range ${MEASURE_MIN}–${MEASURE_MAX}`);
}

// Every class that carries running prose has to be capped by that token. `.d` is the
// workhorse — 100+ uses — so if it is uncapped the cap effectively does not exist.
for (const sel of ['.denom', '.d', '.prosecap']) {
  const rule = new RegExp(`\\${sel}[^{]*\\{[^}]*max-width:\\s*var\\(--measure\\)`, 's');
  check(`${sel} is capped at the measure`, rule.test(css));
}

// ── 2. Contrast ─────────────────────────────────────────────────────────────
// WCAG 2.2: 4.5:1 for body text (1.4.3), 3:1 for UI and graphical objects (1.4.11).
// Computed exactly from the tokens, so this one is a real measurement, not a proxy.
function token(name: string, scope = ':root {'): string | null {
  const start = css.indexOf(scope);
  if (start < 0) return null;
  const block = css.slice(start, css.indexOf('}', start));
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})`).exec(block);
  return m ? m[1] : null;
}
function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}

// Every pair the product actually paints text in. Chip text is small, so it is held
// to the 4.5 body-text bar rather than the 3.0 large-text one.
const PAIRS: [string, string, string, number][] = [
  ['body text', 'ink', 'ground', 4.5],
  ['muted text on the page', 'muted', 'ground', 4.5],
  ['muted text on a panel', 'muted', 'panel', 4.5],
  ['links and accents', 'accent', 'ground', 4.5],
  ['red chip', 'neg', 'red-soft', 4.5],
  ['amber chip', 'amber', 'amber-soft', 4.5],
  ['green chip', 'pos', 'pos-soft', 4.5],
  ['blue chip', 'accent', 'accent-soft', 4.5],
  ['grey chip', 'muted', 'grey-soft', 4.5],
];
for (const [label, fg, bg, min] of PAIRS) {
  const f = token(fg), b = token(bg);
  if (!f || !b) { check(`${label} — tokens resolve`, false, `--${fg} / --${bg} missing`); continue; }
  const r = ratio(f, b);
  check(`${label} clears WCAG ${min}:1`, r >= min, `${r}:1 (${f} on ${b})`);
}

// ── 3. One vocabulary ───────────────────────────────────────────────────────
// Cowan (2001): working memory holds about four chunks. A tag set only becomes free
// to read once it is small AND identical on every page.
const MEANINGS = ['red', 'amber', 'green', 'blue', 'grey'] as const;
const taxonomy = read('lib/queue-display.ts');
const tones = [...taxonomy.matchAll(/tone:\s*'([a-z]+)'/g)].map(m => m[1]);
const distinct = [...new Set(tones)];
// Five meanings, fixed: at risk · needs a decision · good · informational · inert.
// Chips and due-pills are different controls but they may not invent new colours.
const stray = distinct.filter(t => !MEANINGS.includes(t as typeof MEANINGS[number]));
check(`every tag colour is one of the ${MEANINGS.length} meanings`,
  stray.length === 0, stray.length ? `stray: ${stray.join(', ')}` : distinct.join(', '));

// A second label map anywhere is how the vocabulary drifted apart the first time.
const pageFiles = [
  ...readdirSync('app', { recursive: true, encoding: 'utf8' })
    .filter(f => f.endsWith('.tsx')).map(f => join('app', f)),
  ...readdirSync('components').filter(f => f.endsWith('.tsx')).map(f => join('components', f)),
];
const rogueMaps = pageFiles.filter(f => /ACTION_LABEL\s*(:|=)\s*(Record|\{)/.test(read(f)));
check('no page keeps its own copy of the action vocabulary',
  rogueMaps.length === 0, rogueMaps.join(', ') || 'single source in lib/queue-display.ts');

// Colour is never the only carrier (WCAG 1.4.1; ~8% of men have red–green CVD).
// Structural proof: the chip always renders a text label beside its tone class.
check('every tag carries a word, not just a colour',
  /className=\{`tchip \$\{[^`]*`\}[^>]*>[\s\S]{0,80}\{t\.label\}/.test(read('components/QueueTable.tsx')));

// ── 4. Standing prose ───────────────────────────────────────────────────────
// Words a broker must scroll past before reaching anything he can act on. Derived,
// not looked up: NN/g finds 20–28% of words get read, so this is what survives.
// Approximated from JSX text nodes, with anything inside the disclosure components
// excluded — moving prose into <Explain> or the page guide is the point, not a dodge.
// Back to the researched target now that the counter reads only text a broker sees.
// NN/g: 20–28% of words on a page get read, so 50 standing words is what survives.
const PROSE_BUDGET = 50;

// A JSX expression container holds code, not copy, so it has to come out before
// the words are counted. The previous version stripped `{...}` innermost-first
// with a regex until none were left — and on a real page that cascade does not
// stop at the expression. Measured when this was rewritten: it destroyed 98% of
// Today, 98% of Business, 97% of Marketing and 95% of Earnings, then reported the
// surviving 2% as the page's standing prose. Today scored 0 words. Today is not
// a wordless page. A budget nobody is actually held to is worse than no budget.
//
// Scanned rather than pattern-matched: walk the source, and on `{` skip to its
// matching `}`, tracking depth and stepping over quoted strings so a brace inside
// a string cannot throw the count off.
function stripExpressions(src: string): string {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '{') { out += src[i]; continue; }
    let depth = 0;
    let quote = '';
    for (; i < src.length; i++) {
      const c = src[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
      if (c === '{') depth++;
      else if (c === '}' && --depth === 0) break;
    }
    out += ' ';
  }
  return out;
}

// An element and everything inside it, matched by counting its own nested opens
// rather than by a non-greedy regex — `<Explain>…<Explain/>…</Explain>` closed at
// the wrong place and took the rest of the page with it.
function stripElement(src: string, name: string): string {
  const open = new RegExp(`<${name}\\b`, 'g');
  // `<th` must not match `<thead`, in the depth counter as well as in the search —
  // one off-by-a-tag there and the strip runs to the end of the file.
  const at = (s: string, i: number, tag: string) =>
    s.startsWith(tag, i) && !/[A-Za-z0-9]/.test(s[i + tag.length] ?? '');
  let s = src;
  for (;;) {
    open.lastIndex = 0;
    const m = open.exec(s);
    if (!m) return s;
    let i = m.index;
    let depth = 0;
    let selfClosed = false;
    for (; i < s.length; i++) {
      if (at(s, i, `<${name}`)) { depth++; continue; }
      if (at(s, i, `</${name}`)) {
        i = s.indexOf('>', i) + 1;
        if (--depth === 0) break;
        i--;
        continue;
      }
      if (s[i] === '/' && s[i + 1] === '>' && depth === 1) { i += 2; selfClosed = true; break; }
    }
    if (!selfClosed && depth > 0 && i >= s.length) return s;   // unclosed — leave it
    s = s.slice(0, m.index) + ' ' + s.slice(i);
  }
}

// Not every word on a screen is prose to scroll past.
//
// A control — button, option, select, disclosure summary — IS the thing he acts on.
// A heading is how he skips to it. A column header is how he reads the row under
// it. Counting those made Earnings score 69 on a page whose entire "prose" was
// `Client · Their money · Lines · Your commission` and `Invoice · Period · CGST ·
// SGST · TDS`, which is a table, not an essay. What is left after this is
// sentences, which is what the budget was always about.
const FURNITURE = [
  'option', 'button', 'select', 'summary',   // controls — the thing he acts on
  'h1', 'h2', 'h3', 'h4',                    // headings — how he skips
  'th',                                      // column headers — how he reads a row
];

function standingProse(src: string): { words: number; survived: number } {
  let s = src;
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // Only what the page renders. The query and layout code above `return (` is not
  // prose, and leaving it in was the other half of the old counter's problem: the
  // component body is itself one big `{…}`, so a brace scan over the whole file
  // swallows the page and reports what is left as the reading load.
  const jsx = s.indexOf('return (');
  s = jsx >= 0 ? s.slice(jsx) : s;

  s = stripElement(s, 'Explain');     // detail behind the ⓘ
  s = stripElement(s, 'PageGuide');   // detail behind the guide
  for (const tag of FURNITURE) s = stripElement(s, tag);

  // The guard is on the expression strip specifically, because that is the step
  // that failed silently — removing disclosures and furniture is meant to take a
  // lot, and on a table-heavy page it legitimately takes most of the file.
  const before = s.length;
  s = stripExpressions(s);

  const text: string[] = [];
  for (const m of s.matchAll(/>([^<>]+)</g)) text.push(m[1]);
  const words = text
    .join(' ')
    .replace(/&[a-z]+;/g, ' ')
    .split(/\s+/)
    .filter(w => /^[A-Za-z][A-Za-z'’.,;:!?—-]*$/.test(w))
    .length;
  return { words, survived: s.length / before };
}

const PAGES = ['today', 'clients', 'onboarding', 'earnings', 'marketing', 'business', 'review-packs', 'reports'];

// What each page actually measured the first time it was measured honestly
// (12-Aug-2026), which is NOT the same thing as what it should be. 50 words is
// still the target; these are the debt, frozen so it cannot grow while the pages
// are worked through. Lower a number when a page improves; never raise one.
const PROSE_BASELINE: Record<string, number> = {
  today: 14, clients: 115, onboarding: 87, earnings: 13,
  marketing: 129, business: 107, 'review-packs': 32, reports: 157,
};

const prose: Record<string, number> = {};
for (const p of PAGES) {
  const file = join('app', p, 'page.tsx');
  const { words, survived } = standingProse(read(file));
  prose[p] = words;
  // The guard that would have caught the old counter on the day it broke: if the
  // stripping ate the page, the number underneath it is not a measurement.
  check(`${p}'s prose counter still sees the page`, survived > 0.25,
    `${(survived * 100).toFixed(0)}% of the rendered source survived stripping`);
  const ceiling = Math.max(PROSE_BUDGET, PROSE_BASELINE[p] ?? PROSE_BUDGET);
  check(`${p} adds no standing prose`, words <= ceiling,
    words <= PROSE_BUDGET
      ? `${words} words — inside the ${PROSE_BUDGET}-word budget`
      : `${words} words · frozen at ${ceiling} · ${words - PROSE_BUDGET} over the ${PROSE_BUDGET}-word budget`);
}

// ── 5. Groups per screen ────────────────────────────────────────────────────
// Cowan again: at most five things to hold at once. Counted as the top-level blocks
// a page renders in its main column.
const GROUP_CAP = 5;
for (const p of PAGES) {
  const src = read(join('app', p, 'page.tsx'));
  const groups = (src.match(/<section\b/g) ?? []).length
    + (src.match(/className="cards\b/g) ?? []).length
    + (src.match(/className="panel\b/g) ?? []).length;
  check(`${p} shows at most ${GROUP_CAP} top-level groups`, groups <= GROUP_CAP, `${groups} groups`);
}

// ── 6. Density ──────────────────────────────────────────────────────────────
// The prose budget does not catch a long list: Pipeline passes it at 46 words and
// still renders nineteen hundred, because 31 application cards are real data, not
// copy. Data cannot be moved behind a click the way prose can — so the rule is that
// any long list must be RANKED and COLLAPSED, and its ranking variable drawn as
// well as written. Length and position are preattentive (Treisman): the eye
// resolves them across the whole column at once, however many items there are.
const LIST_CAP = 6;

// ClientsTable is deliberately absent. It carries bulk-select checkboxes and a CSV
// export of the ticked rows, and you cannot tick a row you have collapsed — hiding
// rows there would cost functionality to buy tidiness. Comparison across the whole
// book IS that page's job; it gets a filter and a column picker instead.
const boards = ['components/PipelineBoard.tsx', 'components/QueueTable.tsx'];
for (const f of boards) {
  const src = read(f);
  const collapses = /<Collapse/.test(src);
  const shown = /shown=\{?(\d+)/.exec(src);
  check(`${f.split('/')[1]} collapses its list`, collapses);
  if (shown) {
    check(`${f.split('/')[1]} shows at most ${LIST_CAP} before collapsing`,
      Number(shown[1]) <= LIST_CAP, `shows ${shown[1]}`);
  }
}

// A list you must read to rank is a list you read entirely. The worst item has to
// be findable without reading — sorted, and drawn as a length.
check('the pipeline board ranks worst-first rather than by arrival',
  /\.sort\(\(a, b\) => b\.days - a\.days\)/.test(read('components/PipelineBoard.tsx')));
check('the pipeline draws the wait as a length, not only as digits',
  /className=\{`wait /.test(read('components/PipelineBoard.tsx')));
// Preattentive encoding still may not be the ONLY carrier (WCAG 1.4.1).
check('the wait keeps its number beside the bar',
  /className="age num"/.test(read('components/PipelineBoard.tsx')));

// ── 7. Consistency and visual encoding ──────────────────────────────────────
// Management read the product before this section existed and found both of these
// by eye, which is the strongest argument for asserting them.

// Repeating a table component per section gives each <table> its own auto-layout,
// so the columns step sideways down the page. One table with section rows, or a
// fixed template — either way, a component used more than once on a page may not
// render more than one <table>.
const queueSrc = read('components/QueueTable.tsx');
check('the queue renders one table, not one per stream',
  /table-layout:\s*fixed/.test(css) || /sections/.test(queueSrc),
  'three <table> elements auto-size independently: 125/140/127px on the same column');

// A finance product that draws no picture makes the reader do the arithmetic.
// Every page owes a visual encoding of its main story.
//
// This check used to pass all eight pages by matching class names — but `.valbar`
// is a bar inside a table cell and `.wait` is a bar inside a row, and a page can
// hold both while drawing nothing. Counted in a browser on the deployed build,
// plotted figures per page were: today 0, earnings 9, business 29, clients 57.
// Today is the home screen and it had none. A check that calls that page charted
// is worse than no check, so this one now names what a chart is.
//
// A chart is a component exported from components/charts.tsx — the single place
// Recharts may be imported and the single place a chart colour may be chosen.
const CHART_KIT = 'components/charts.tsx';
const kit = existsSync(CHART_KIT) ? read(CHART_KIT) : '';

const plotted = /from 'recharts'/.test(kit);
check('charts are plotted by a library, not assembled out of divs',
  plotted, plotted ? 'recharts' : `${CHART_KIT} does not import recharts`);

// The four things every chart owes its reader (founder rule, frontend-viz.md):
// an axis to read the value off, a legend once there is more than one series, the
// exact number on hover, and the table the figure came from.
for (const [what, needle] of [
  ['a labelled x axis', '<XAxis'], ['a labelled y axis', '<YAxis'],
  ['a hover tooltip carrying the exact value', '<Tooltip'],
  ['a legend for multi-series charts', '<Legend'],
  ['a source line under every figure', '<figcaption'],
] as const) {
  check(`every chart carries ${what}`, kit.includes(needle), kit.includes(needle) ? '' : `no ${needle} in ${CHART_KIT}`);
}

// Attribution is not optional, so it is not an optional prop — `source?: string`
// would let a chart ship unsourced and still typecheck.
const sourceRequired = /\n\s*source:\s*string;/.test(kit);
check('a chart cannot be drawn without naming its source',
  sourceRequired, sourceRequired ? 'required prop' : 'source is optional or absent in the kit props');

// Five meanings plus four fixed categorical slots, every one of them a token. A
// hex literal in the kit is a tenth colour nobody agreed to.
const kitHex = [...new Set([...kit.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]))];
check('the chart kit invents no colour of its own',
  kitHex.length === 0, kitHex.length ? `hex literals: ${kitHex.join(', ')}` : 'tokens only');

// Recharts anywhere but the kit is how the vocabulary drifts apart — the same way
// a second ACTION_LABEL map did, two checks up.
const rogueRecharts = pageFiles.filter(f => f !== CHART_KIT && /from 'recharts'/.test(read(f)));
check('no page imports the plotting library directly',
  rogueRecharts.length === 0, rogueRecharts.join(', ') || `only ${CHART_KIT}`);

// Two per page: one for the headline story, one for its shape. One chart on a page
// this dense is an ornament; two make an argument.
const CHARTS_PER_PAGE = 2;
const kitCharts = [...kit.matchAll(/export function (\w+)\(/g)].map(m => m[1]);
for (const pg of PAGES) {
  const src = read(join('app', pg, 'page.tsx'));
  // Counted per rendering, not per distinct component — two bar charts answering
  // two different questions is two charts, and forcing a page to vary the FORM to
  // satisfy a counter is how a chart stops matching its data.
  const drawn = kitCharts.flatMap(c => [...src.matchAll(new RegExp(`<${c}[\\s/>]`, 'g'))].map(() => c));
  check(`${pg} plots at least ${CHARTS_PER_PAGE} of its story`,
    drawn.length >= CHARTS_PER_PAGE,
    drawn.length ? drawn.join(' · ') : 'nothing plotted — an inline bar in a table cell is not a chart');
}

// ── 8. Prose inside a loop ──────────────────────────────────────────────────
// A sentence written inside a `.map()` is printed once per row. The clawback cards
// carried "No clawback on this page is unexplained — each one names the redemption
// that triggered it" on every card: true once, noise seven times, and a reader who
// has read it once now has to check whether the eighth copy says something new.
//
// The standing-prose counter cannot see this — the source holds one copy — which
// is why it needs its own check. The rule is not "no words in a list": it is that
// a sentence which does not change per row belongs above the list, and what stays
// in the row is what differs. Ten words is the line; a per-row phrase is shorter.
const LOOP_PROSE = 10;

function closingIndex(src: string, from: number, open: string, close: string): number {
  let depth = 0;
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = '';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === open) depth++;
    else if (c === close && --depth === 0) return i;
  }
  return src.length;
}

for (const pg of PAGES) {
  let src = read(join('app', pg, 'page.tsx'));
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const jsx = src.indexOf('return (');
  src = jsx >= 0 ? src.slice(jsx) : src;

  const preached: string[] = [];
  for (const m of src.matchAll(/\.map\(/g)) {
    let body = src.slice(m.index, closingIndex(src, m.index + 4, '(', ')'));
    body = stripElement(body, 'Explain');
    body = stripExpressions(body);
    for (const t of body.matchAll(/>([^<>]+)</g)) {
      const words = t[1].trim().split(/\s+/).filter(w => /^[A-Za-z]/.test(w));
      if (words.length >= LOOP_PROSE) preached.push(`"${words.slice(0, 6).join(' ')}…" ×${words.length}w`);
    }
  }
  check(`${pg} says it once above the list, not once per row`,
    preached.length === 0, preached.join(' · ') || 'no sentence repeated per row');
}

// Explanation must advertise itself. A bare ⓘ is hidden; a teaser is explorable.
check('moved prose shows a teaser rather than only an icon',
  /teaser/.test(read('components/Explain.tsx')), 'Explain renders an icon with no preview of what is behind it');

// Family is how the money is actually held in India; the product may not be blind
// to it. The two names below were the broker-lens guesses when this check was
// written; `household()` is the surface that actually shipped, in the client lens.
check('a family lens exists',
  pageFiles.some(f => /Family360|familyRollup|household\(/.test(read(f))), 'no family entity anywhere');

// ── Summary ─────────────────────────────────────────────────────────────────
const worst = Object.entries(prose).sort((a, b) => b[1] - a[1])[0];
const overBudget = Object.entries(prose).filter(([, w]) => w > PROSE_BUDGET);
console.log(`\nMeasure ${measure ? measure[1] + 'ch' : 'UNSET'} · vocabulary ${distinct.length} tones · worst page ${worst[0]} at ${worst[1]} standing words`);
if (overBudget.length) {
  console.log(`PROSE DEBT: ${overBudget.length} of ${PAGES.length} pages over the ${PROSE_BUDGET}-word budget — ${overBudget.map(([p, w]) => `${p} ${w}`).join(', ')}`);
}
console.log(failures === 0 ? '\nDESIGN BUDGET: ALL CHECKS PASSED' : `\nDESIGN BUDGET: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
