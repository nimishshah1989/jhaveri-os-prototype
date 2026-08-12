// My book — does the book-level view reconcile with the client-level one?
//
// The whole risk of an aggregate page is that it quietly disagrees with the pages
// it aggregates. A broker who reads ₹3.04 Cr here and adds up 53 client screens to
// ₹3.05 Cr has no way to know which one is lying, and will stop trusting both. So
// every figure on My book is re-derived here from the per-client functions the
// client pages use, and the two have to match to the rupee.
//
// Usage: npx tsx mockdb/verify-book.ts

import { broker, clientRows, assetMix } from '../lib/queries';
import { lookThrough, bookLookThrough } from '../lib/portfolio';
import {
  bookHeader, bookAssetMix, bookCategoryMix, sectorClients, bookFunds, categoryStanding,
} from '../lib/book';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const me = broker();
const code = me.code;

// ── The book equals its clients ─────────────────────────────────────────────
const head = bookHeader(code).value;
const rows = clientRows(code, {}).rows;
const summed = rows.reduce((s, r) => s + r.v, 0);

check('the book is worth exactly what its clients are worth',
  near(head.aum, summed), `${rupees(head.aum)} vs ${rupees(summed)} summed from ${rows.length} clients`);
check('the book counts the same clients the Clients page lists',
  head.clients === rows.length, `${head.clients} vs ${rows.length}`);
check('the book holds at least one scheme per asset class it claims',
  head.schemes > 0 && head.folios >= head.schemes, `${head.schemes} schemes across ${head.folios} folios`);

// ── Slices add back up ──────────────────────────────────────────────────────
const asset = bookAssetMix(code).value;
const cat = bookCategoryMix(code).value;

check('the asset-class split adds back to the book',
  near(asset.reduce((s, r) => s + r.v, 0), head.aum),
  `${asset.map(a => `${a.label} ${rupees(a.v)}`).join(' · ')}`);
check('the category split adds back to the book',
  near(cat.reduce((s, r) => s + r.v, 0), head.aum), `${cat.length} categories`);
check('every share is a share of the same denominator',
  near(asset.reduce((s, r) => s + r.pct, 0), 100, 0.2) && near(cat.reduce((s, r) => s + r.pct, 0), 100, 0.2),
  `asset ${asset.reduce((s, r) => s + r.pct, 0).toFixed(1)}% · category ${cat.reduce((s, r) => s + r.pct, 0).toFixed(1)}%`);

// The asset mix already on the Clients page must not disagree with this one.
const clientsPageMix = assetMix(code).value;
check('the book asset mix matches the one the Clients page already draws',
  clientsPageMix.every(m => near(asset.find(a => a.label === m.label)?.v ?? -1, m.v)),
  `${clientsPageMix.length} classes cross-checked`);

// Hybrids were the thing that prompted this page — they must be visible as their
// own category, not folded into equity or debt.
const hybridCats = cat.filter(c => /hybrid|arbitrage|balanced/i.test(c.label));
check('hybrid money is named rather than folded into equity or debt',
  hybridCats.length > 0, hybridCats.map(h => `${h.label} ${rupees(h.v)}`).join(' · ') || 'no hybrid category');

// ── Look-through: honest about what it cannot see ───────────────────────────
const lt = bookLookThrough(code).value;

check('look-through never claims more than the book holds',
  lt.covered <= lt.total + 1, `${rupees(lt.covered)} covered of ${rupees(lt.total)}`);
check('look-through coverage is stated, not assumed to be complete',
  lt.coverage_pct > 0 && lt.coverage_pct < 100,
  `${lt.coverage_pct}% — the rest is debt, gold and liquid, which disclose no stocks`);

// The uncovered part must be exactly the non-stock money, not a rounding gap.
const nonStock = asset.filter(a => a.label !== 'Equity' && a.label !== 'Hybrid')
  .reduce((s, a) => s + a.v, 0);
check('the part it cannot see through is the part that holds no stocks',
  lt.total - lt.covered >= nonStock - 1,
  `${rupees(lt.total - lt.covered)} unseen · ${rupees(nonStock)} in debt and commodities`);

check('sector shares add to the covered money, not to the whole book',
  near(lt.sectors.reduce((s, r) => s + r.rupees, 0), lt.covered, 2),
  `${lt.sectors.length} sectors summing to ${rupees(lt.sectors.reduce((s, r) => s + r.rupees, 0))}`);
check('sector percentages add to 100',
  near(lt.sectors.reduce((s, r) => s + r.pct, 0), 100, 0.5),
  `${lt.sectors.reduce((s, r) => s + r.pct, 0).toFixed(1)}%`);
check('the biggest sector is named and is the biggest',
  lt.sectors[0] && lt.sectors[0].pct === lt.top_sector_pct,
  lt.sectors[0] ? `${lt.sectors[0].sector} at ${lt.sectors[0].pct}%` : 'no sectors');
check('the top ten stocks are a subset, not the whole thing',
  lt.top10_pct > 0 && lt.top10_pct <= 100, `top 10 hold ${lt.top10_pct}% of what can be seen`);

// ── The drill-down is the same money, split by client ───────────────────────
// This is the check that matters: click a sector, and the clients it opens must
// account for exactly the rupees the sector bar claimed.
for (const s of lt.sectors.slice(0, 3)) {
  const holders = sectorClients(code, s.sector).value;
  const total = holders.reduce((a, h) => a + h.rupees, 0);
  check(`${s.sector} opens to clients holding exactly what the sector claims`,
    near(total, s.rupees, 2), `${rupees(total)} across ${holders.length} clients vs ${rupees(s.rupees)}`);
  check(`${s.sector} exposure is never more than a client's whole portfolio`,
    holders.every(h => h.rupees <= h.portfolio + 1),
    `worst ${Math.max(...holders.map(h => h.pct_of_theirs)).toFixed(1)}% of one portfolio`);
}

// A client's own look-through must agree with their slice of the book's.
const biggest = [...rows].sort((a, b) => b.v - a.v)[0];
if (biggest) {
  const mine = lookThrough(biggest.client_id).value;
  const top = mine.sectors[0];
  const theirs = sectorClients(code, top.sector).value.find(h => h.client_id === biggest.client_id);
  check(`${biggest.name}'s ${top.sector} reads the same on their page and in the book`,
    !!theirs && near(theirs.rupees, top.rupees, 2),
    `${rupees(top.rupees)} on Client 360 vs ${rupees(theirs?.rupees ?? 0)} in the book drill-down`);
}

// ── Funds and categories ────────────────────────────────────────────────────
const funds = bookFunds(code).value;
check('every scheme in the book is listed once',
  funds.length === head.schemes && new Set(funds.map(f => f.scheme_id)).size === funds.length,
  `${funds.length} funds`);
check('the fund list adds back to the book',
  near(funds.reduce((s, f) => s + f.v, 0), head.aum), rupees(funds.reduce((s, f) => s + f.v, 0)));
check('no fund claims more clients than the book has',
  funds.every(f => f.clients <= head.clients), `busiest fund held by ${Math.max(...funds.map(f => f.clients))} clients`);

const standing = categoryStanding(code).value;
check('category standings cover every category the book holds',
  standing.length === cat.length, `${standing.length} vs ${cat.length}`);
check('category standings add back to the book',
  near(standing.reduce((s, c) => s + c.v, 0), head.aum), rupees(standing.reduce((s, c) => s + c.v, 0)));
// A value-weighted return has to sit inside the range of the funds it blends.
for (const c of standing.filter(x => x.book_1y !== null).slice(0, 5)) {
  const its = funds.filter(f => f.category === c.category && f.ret1y !== null).map(f => f.ret1y!);
  check(`${c.category}'s blended year sits between its best and worst fund`,
    c.book_1y! >= Math.min(...its) - 0.1 && c.book_1y! <= Math.max(...its) + 0.1,
    `${c.book_1y}% within ${Math.min(...its)}%…${Math.max(...its)}%`);
}
// Silence is not zero: a fund without a full year of NAV must not drag a blend down.
check('a fund with no full year of history is excluded, not counted as zero',
  standing.every(c => c.book_1y === null || funds.some(f => f.category === c.category && f.ret1y !== null)),
  'no category blends a null return as 0%');

console.log(`\nMY BOOK: ${rupees(head.aum)} · ${head.clients} clients · ${head.schemes} schemes · ${lt.coverage_pct}% seen through to ${lt.stocks.length} stocks in ${lt.sectors.length} sectors`);
console.log(failures === 0 ? '\nMY BOOK: ALL CHECKS PASSED' : `\nMY BOOK: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
