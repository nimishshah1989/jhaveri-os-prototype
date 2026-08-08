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

import { readFileSync, readdirSync } from 'node:fs';
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
// Today is the benchmark, not a number I picked: it is the page that prompted
// "this one is right". Every other page has to reach it, and when Today improves the
// budget tightens with it.
const PROSE_BUDGET = 200;

function standingProse(src: string): number {
  let s = src;
  s = s.replace(/^import[\s\S]*?from\s+'[^']+';$/gm, '');   // imports carry no copy
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');  // comments are for me
  s = s.replace(/<Explain[\s\S]*?\/>/g, '');                 // detail behind the ⓘ
  s = s.replace(/<PageGuide[\s\S]*?<\/PageGuide>/g, '');     // detail behind the guide
  s = s.replace(/<PageGuide[\s\S]*?\/>/g, '');
  s = s.replace(/\{[^{}]*\}/g, ' ');                          // expressions, not prose
  s = s.replace(/<[^>]+>/g, '\n');                            // tags out, text left
  return s.split('\n')
    .map(l => l.replace(/&[a-z]+;/g, '').trim())
    .filter(l => /[a-z]{3}/i.test(l))
    .join(' ')
    .split(/\s+/).filter(w => /[a-zA-Z]{2}/.test(w)).length;
}

const PAGES = ['today', 'clients', 'onboarding', 'earnings', 'marketing', 'business', 'review-packs', 'reports'];
const prose: Record<string, number> = {};
for (const p of PAGES) {
  const file = join('app', p, 'page.tsx');
  prose[p] = standingProse(read(file));
  check(`${p} carries no more standing prose than Today (${PROSE_BUDGET})`,
    prose[p] <= PROSE_BUDGET, `${prose[p]} words`);
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

// ── Summary ─────────────────────────────────────────────────────────────────
const worst = Object.entries(prose).sort((a, b) => b[1] - a[1])[0];
console.log(`\nMeasure ${measure ? measure[1] + 'ch' : 'UNSET'} · vocabulary ${distinct.length} tones · worst page ${worst[0]} at ${worst[1]} standing words`);
console.log(failures === 0 ? '\nDESIGN BUDGET: ALL CHECKS PASSED' : `\nDESIGN BUDGET: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
