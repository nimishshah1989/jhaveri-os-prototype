// Scoring engine checks: bounds, the score↔lever invariant, band sanity,
// scheme-grade distribution. Exits 1 on any failure.
// Usage: npx tsx mockdb/verify-scoring.ts

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clientHealth, schemeGrades, bookHealth, SCORING_RULES } from '../lib/scoring';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..'));

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const book = bookHealth('1228');
const all = [...book.values()];

check('every client scored, none out of bounds',
  all.length === 51 && all.every(r => r.score >= 0 && r.score <= 100 && r.reachable >= r.score && r.reachable <= 100),
  `${all.length} clients, score range ${Math.min(...all.map(r => r.score))}–${Math.max(...all.map(r => r.score))}`);

check('scores discriminate (not everyone identical)', new Set(all.map(r => r.score)).size >= 8,
  `${new Set(all.map(r => r.score)).size} distinct scores`);

const meera = clientHealth(101);
check('Meera: components sum to total',
  meera.components.reduce((s, c) => s + c.score, 0) === meera.total, `total ${meera.total}`);
check('Meera: in the middle band with real gain available',
  meera.total >= 30 && meera.total <= 69 && meera.gain >= 15,
  `score ${meera.total}, reachable ${meera.reachable} (+${meera.gain})`);

// THE invariant: every sub-20 component either offers levers or says why not.
let orphans = 0;
for (const r of all) {
  for (const c of clientHealth(r.client_id).components) {
    if (c.score < 20 && c.levers.length === 0 && c.key !== 'performance' && c.key !== 'risk_fit' && c.key !== 'tax') orphans++;
  }
}
check('score↔suggestion invariant: no lost points without a lever (div/discipline)', orphans === 0, `${orphans} orphans`);

// Lever deltas must be honest: applying all non-ghosted levers == reachable.
const meeraGain = meera.components.reduce((s, c) => s + c.levers.filter(l => !l.ghosted).reduce((a, l) => a + l.delta, 0), 0);
check('Meera: Σ lever deltas == advertised gain', meeraGain === meera.gain, `${meeraGain} vs ${meera.gain}`);
check('Meera: fix-SIP is her biggest lever',
  meera.components.find(c => c.key === 'discipline')!.levers.some(l => l.key === 'fix_sip' && l.delta >= 8));

const grades = schemeGrades();
const dist: Record<string, number> = {};
for (const g of grades.values()) dist[g.grade] = (dist[g.grade] ?? 0) + 1;
check('scheme grades: all 60 graded across full A–E range',
  grades.size === 60 && ['A', 'B', 'C', 'D', 'E'].every(g => (dist[g] ?? 0) > 0),
  Object.entries(dist).sort().map(([g, n]) => `${g}:${n}`).join(' '));

const avgByGrade = ['A', 'E'].map(g =>
  [...grades.values()].filter(x => x.grade === g).reduce((s, x) => s + x.ret1y, 0) / (dist[g] ?? 1));
check('scheme grades ordered: A-grade avg 1y return beats E-grade', avgByGrade[0] > avgByGrade[1],
  `A avg ${avgByGrade[0].toFixed(1)}% vs E avg ${avgByGrade[1].toFixed(1)}%`);

const quickWins = all.filter(r => r.maxLever >= SCORING_RULES.quick_win_single_lever);
check('quick-wins segment (one call, one big fix) is a minority worth calling',
  quickWins.length >= 2 && quickWins.length <= 15, `${quickWins.length} of ${all.length}`);

// Cross-page lens: the same client must score identically wherever they appear.
const drift = all.filter(r => clientHealth(r.client_id).total !== r.score).length;
check('cross-page: book rollup score == 360 score for every client', drift === 0, `${drift} disagreements`);

const bandOk = all.every(r => {
  const b = SCORING_RULES.bands.find(x => r.score >= x.min);
  return b != null && b.label === r.band;
});
check('band labels match the registered thresholds', bandOk);

// Every quick-win client must actually show that lever on their 360.
const qwOk = quickWins.every(r => clientHealth(r.client_id).components
  .some(c => c.levers.some(l => !l.ghosted && l.kind !== 'hygiene' && l.delta >= SCORING_RULES.quick_win_single_lever)));
check('every quick-win client shows a matching lever on their Health tab', qwOk);

console.log(`\nMeera: ${meera.total} → ${meera.reachable} (+${meera.gain}) · band "${meera.band.label}"`);
meera.components.forEach(c => console.log(`  ${c.label}: ${c.score}/20 — ${c.why}${c.levers.length ? ' · levers: ' + c.levers.map(l => `${l.label} (+${l.delta}${l.ghosted ? ', ghosted' : ''})`).join('; ') : ''}`));
console.log(failures === 0 ? '\nSCORING ENGINE: ALL CHECKS PASSED' : `\nSCORING ENGINE: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
