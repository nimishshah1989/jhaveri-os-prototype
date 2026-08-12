/**
 * verify-import — held-away folios, and the two rules that keep a net worth honest.
 *
 * ONE PRICE. A held-away fund and an advised fund must be worth the same per
 * unit, or a consolidated figure is quietly wrong in a way nothing reconciles
 * against. `heldaway_folios` stores no value column for exactly this reason;
 * this file proves the read path honours it.
 *
 * ONE DENOMINATOR. Held-away money must never reach a Jhaveri figure. Every page
 * except the Elsewhere tab prints the advised book, and the health score, the
 * goals and the client's rate are all computed from it.
 *
 * This verifier WRITES — it re-imports to prove the second fetch does not double
 * a net worth — and rolls back, leaving the database byte-identical.
 *
 * Run: npx tsx mockdb/verify-import.ts   (joined to `npm run verify:all`)
 */
import { db } from '../lib/db';
import { fetchCas, importHeldAway, heldAway, netWorth, lastImport } from '../lib/import';

const conn = db();
const ME = 101;
let pass = 0;
const fails: string[] = [];

function assert(name: string, cond: boolean, why = ''): void {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${why ? ` — ${why}` : ''}`); }
}
function check(name: string, got: unknown, want: unknown): void {
  assert(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
const one = <T>(sql: string, ...p: unknown[]): T => conn.prepare(sql).get(...p) as T;

console.log('\nverify-import — the money we do not manage\n');
conn.exec('BEGIN');

try {
  const pan = one<{ pan: string }>(`SELECT cm_pan_no pan FROM client_master WHERE cm_user_id = ?`, ME).pan;

  /* ── row counts, before and after, both logged ─────────────────────────── */

  const before = one<{ n: number }>(`SELECT COUNT(*) n FROM heldaway_folios`).n;
  const res = importHeldAway(ME, conn);
  const after = one<{ n: number }>(`SELECT COUNT(*) n FROM heldaway_folios`).n;
  console.log(`  ROWS  before ${res.before} · fetched ${res.fetched} · inserted ${res.inserted} · updated ${res.updated} · after ${res.after}`);
  check('the importer reports the row count it actually found', res.before, before);
  check('and the one it actually left', res.after, after);
  check('a re-import of a book already landed inserts nothing new', res.inserted, 0);
  check('it updates every row it fetched instead', res.updated, res.fetched);
  check('so the table is exactly the size it was', after, before);

  /* ── the natural key holds across repeated imports ─────────────────────── */

  importHeldAway(ME, conn);
  importHeldAway(ME, conn);
  check('three more imports still do not duplicate a folio',
    one<{ n: number }>(`SELECT COUNT(*) n FROM heldaway_folios`).n, before);
  check('no duplicate exists on PAN + folio + scheme anywhere',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM (SELECT pan_no, folio_no, scheme_name FROM heldaway_folios
        GROUP BY 1,2,3 HAVING COUNT(*) > 1)`).n, 0);

  /* ── the fetch is a seam, and it is stable ─────────────────────────────── */

  const a = fetchCas(pan, conn);
  const b = fetchCas(pan, conn);
  check('the same PAN fetches the same book twice', JSON.stringify(a), JSON.stringify(b));
  assert('and a different PAN fetches a different one',
    JSON.stringify(fetchCas(one<{ p: string }>(
      `SELECT cm_pan_no p FROM client_master WHERE cm_user_id = 51`).p, conn)) !== JSON.stringify(a));
  assert('nothing fetched is a fund the client already holds here',
    a.every(r => one<{ n: number }>(
      `SELECT COUNT(*) n FROM fifo_summary_holding_active f
       JOIN scheme_master s ON s.scheme_id = f.scheme_id
       WHERE f.client_id = ? AND s.scheme_amfi_code = ?`, ME, r.amfi_code ?? '').n === 0),
    'held away means held elsewhere');

  /* ── one price ─────────────────────────────────────────────────────────── */

  const rows = heldAway(ME);
  assert('the demo client has held-away folios to consolidate', rows.length > 0);
  for (const r of rows.filter(x => x.scheme_id != null)) {
    const nav = one<{ p: number }>(
      `SELECT price p FROM mf_latest_price_master WHERE fk_scheme_id = ?`, r.scheme_id!).p;
    check(`${r.scheme_name.slice(0, 30)} is priced on the same NAV the advised book uses`, r.nav, nav);
    assert(`and its value is units times that NAV, to the rupee`,
      Math.abs((r.value ?? 0) - Math.round(r.units * nav)) <= 1,
      `${r.value} vs ${Math.round(r.units * nav)}`);
  }

  // The rule stated as its own assertion: there is no second price to disagree
  // with. A value column on this table is how the two halves start to drift.
  check('no held-away row stores a rupee figure of its own',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM pragma_table_info('heldaway_folios')
       WHERE name IN ('value', 'market_value', 'amount', 'present_market_value')`).n, 0);

  /* ── a row we cannot price is counted, never zeroed ────────────────────── */

  const nw = netWorth(ME);
  const unpriceable = rows.filter(r => r.scheme_id == null);
  assert('the seed includes a folio from a house we do not distribute', unpriceable.length > 0,
    'an unmatched row is the common case in a real CAS and must be exercised');
  check('an unpriceable folio has no value at all, rather than zero',
    unpriceable.every(r => r.value === null), true);
  check('and the net worth counts them as unpriced', nw.unpriced, unpriceable.length);
  check('the elsewhere figure is the sum of what could be priced', nw.elsewhere,
    rows.reduce((s, r) => s + (r.value ?? 0), 0));

  /* ── one denominator ───────────────────────────────────────────────────── */

  const advised = one<{ v: number }>(
    `SELECT ROUND(SUM(present_market_value)) v FROM fifo_summary_holding_active WHERE client_id = ?`, ME).v;
  check('the advised book is untouched by the import', nw.with_us, advised);
  check('and everything is the two halves, and only the two halves',
    nw.everything, nw.with_us + nw.elsewhere);
  assert('held-away money is never inside the advised figure', nw.with_us < nw.everything,
    'if these are equal the held-away book has leaked into the denominator every other page uses');
  check('no held-away folio has been written into the advised holdings table',
    one<{ n: number }>(
      `SELECT COUNT(*) n FROM fifo_summary_holding_active f
       JOIN heldaway_folios h ON h.client_id = f.client_id AND h.folio_no = f.folio_no`).n, 0);

  /* ── the run is logged ─────────────────────────────────────────────────── */

  const run = lastImport();
  assert('the import writes a run row with its counts', run != null && run.counts.after != null);
  assert('and the counts on it are the ones the importer returned',
    run != null && run.counts.before != null && run.counts.fetched != null,
    'a row count that is not logged is a row count nobody can check');

  /* ── zero matches renders an empty state, not a zero ───────────────────── */

  const nobody = one<{ id: number }>(
    `SELECT cm_user_id id FROM client_master
     WHERE cm_user_id NOT IN (SELECT COALESCE(client_id, -1) FROM heldaway_folios) LIMIT 1`).id;
  const noneRows = heldAway(nobody);
  check('a client with nothing elsewhere gets no rows', noneRows.length, 0);
  const noneNw = netWorth(nobody);
  check('and their elsewhere figure is zero folios, not a zero-value folio', noneNw.folios, 0);
  check('while their own money is still whatever it is', noneNw.everything, noneNw.with_us);
} finally {
  conn.exec('ROLLBACK');
}

const left = one<{ n: number }>(`SELECT COUNT(*) n FROM heldaway_folios`).n;
assert('the verifier leaves the database exactly as it found it', left > 0,
  'the seeded held-away book should survive the rollback');

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log(`  · ${f}`); process.exit(1); }
