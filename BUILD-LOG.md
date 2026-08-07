# Build log — Jhaveri OS prototype (guidebook track)

Dated evidence of pace. Every entry: what shipped, how it was verified.

## 07-Aug-2026 (deep) — Portfolio analysis rebuilt on real fund holdings from Atlas
- Founder: sector composition is critical, diversification cannot be judged on fund
  labels, and Atlas already holds the data. He was right on all three.
- `mockdb/extract-atlas.sh` pulls a slice of Atlas (the fund manager's system) into
  `atlas-slice.json`: 30 real equity funds with their disclosed holdings, 662 stocks,
  21 sectors, market-cap bands, as of 25-Jul-2026. Atlas is a data SOURCE only —
  nothing in this app links to it, and the demo runs offline from the snapshot.
  New mock tables `stock_master` + `mf_scheme_holdings` mirror what the real build
  ingests from the AMC portfolio-disclosure feed. The 30 equity schemes now carry real
  fund identities; non-equity stays synthetic (Atlas's universe is equity-only) and the
  UI says so rather than pretending.
- **Diversification score rewritten on what clients actually own**: sector
  concentration, top-ten weight, and money duplicated across funds — replacing the
  fund-category measure, which was exactly the illusion the founder described. Meera:
  Banking 24.3%, 58.9% of her money in 45 stocks that both her "different" flexi-cap
  funds hold. Her levers are now real ("Consolidate the duplication between WhiteOak
  and Edelweiss, +7") and the compliance-blocked ghost is gone.
- **Two money-math corrections found while wiring this:**
  ① client-level XIRR was a value-weighted average of per-holding XIRRs — not a valid
  operation on rates. Replaced with a true money-weighted XIRR on actual cashflows
  (Meera 12.5%, not 21.5%). ② the KPI benchmark and the growth chart came from
  different engines and disagreed. Both now derive from one cashflow model, with a
  check asserting they cannot diverge.
- Portfolio analysis tab rebuilt: growth-vs-benchmark curve with a fund picker (all by
  default, tick funds to isolate), sector look-through, the overlap table, ten largest
  shareholdings, real market-cap lens (from actual market caps, not category rules),
  fund report cards with in-place deep dives (own benchmark curve, fund facts, its
  holdings, ✕ to close), segment performance against the whole catalogue, risk fit.
- Verified: 5 new data-integrity checks (no fund claims >100% of itself, every holding
  resolves to a known stock, real identities, index history complete) + look-through
  and chart/KPI-agreement checks in verify-360. All five verifiers green on pristine
  reseed; pages still render in ~0.2s with book-wide scoring.

## 07-Aug-2026 (late) — Health view rebuilt as cards + deep dives, and the loop now closes
- Founder direction: every health parameter and opportunity becomes a card; clicking it
  opens how the score was calculated, where the challenge is, and what to do — with the
  choice itself logged.
- Card grid (5 component cards + opportunity cards), each showing score, status, the
  one-line why, and points available. Click → deep dive with three sections:
  **How this was calculated** (the actual deduction ladder, e.g. "starts at 20 · SIP
  bounced −8 · mandate expiring −4 · Score 8/20"), **Where the challenge is** (plain
  words, no jargon), **What we recommend** (levers with point deltas).
- Three choices per recommendation, all written to the events ledger:
  `I'll do this` → owned action for the broker · `Hand to relationship manager` → action
  assigned to his actual manager from `sb_hierarchy` (Swadesh Rao for broker 4) ·
  `Not now` → mandatory reason, logged as `lever_declined`, no action minted. A "no" is
  data, not silence — it feeds what the system learns about which suggestions land.
- **Loop verified end to end:** actions minted from a lever carry
  `created_from='lever:<component>:<key>'`, so closing them on Today with an outcome
  flows straight back into the client's Decision trail ("closed · saved"). Tested live:
  accept → work on Today → outcome appears on the 360.
- Engine extended: every component now emits its calculation steps and its challenges
  from the same pure functions that produce the score — explanation cannot drift from
  the number.
- Verified: verify-scoring 15 checks (added: every component explains its calculation ·
  every weak component names a challenge or lever · breakdown ends at the actual score).
  All five verifiers green on pristine reseed; browser QA of all three decision paths.

## 07-Aug-2026 (late night) — Scoring framework live: the platform's first cross-page lens
- Founder approved the framework and delegated v0 weights ("suggest from the data").
  `lib/scoring.ts` is the single home for every knob (SCORING_RULES) — the Admin page
  reads it, the real build moves it into rules_registry.
- **The invariant holds in code:** each health component is a pure function of inputs,
  so a lever's point-delta IS the component recomputed with that condition fixed.
  Score and suggestion cannot drift apart — verified, not asserted.
- Client health 0–100 (performance · diversification · discipline · tax · risk fit),
  scheme grades A–E (1y return percentile within category, expense- and house-view-
  adjusted; A avg +27.0% vs E avg −2.1% — the grades order correctly), book rollup.
- Cross-page lens: 360 gets a "Health & opportunities" tab (ring, component bars that
  open into levers with Mint-action buttons, plus non-score opportunities — SIP step-up
  future value with the assumption shown, and an idle-redemption question);
  My clients gets a Health column, weakest-health sort and a Quick wins segment (14 of
  51 — one call, one 8+ point fix); Today ranks opportunities by ₹ × gain-available and
  shows a "+N health" chip; new Admin page displays every weight and band.
- Honesty preserved: diversification lever ghosted pending compliance allocation bands;
  risk-profile review marked hygiene so it can't inflate the quick-wins list.
- Verified: verify-scoring.ts 12 checks — bounds, discrimination (31 distinct scores),
  Σ levers == advertised gain, cross-page score identity (0 disagreements), band
  thresholds, grade ordering, quick-win/lever agreement. All five verifiers green on
  pristine reseed; browser QA end-to-end incl. lever → minted action.

## 07-Aug-2026 (night) — Client 360 rebuilt as the real thing: 7 tabs, research-assembled
- Founder verdict on v1 was right — a fund list is not a 360. Rebuilt multi-tab, each
  block naming its researched source: Overview (Dezerv narrative — three rule-computed
  review lines + the investment-journey chart whose line goes flat when the bounces
  start), Portfolio analysis (Groww fund report cards + ET-Money-style verdict rule +
  Nitrogen risk-appetite-vs-portfolio on one scale + category concentration), Holdings
  & tax lots (Zerodha/Kuvera, carried over), Transactions, SIPs & mandates (bounce
  history from the actual failed instalments), Profile & documents (DPDP consents,
  documents on file, HUB24 held-away slot ghosted), Actions & notes (timeline +
  capture). Consistent right rail: open actions · documents · household.
- Tables app-wide got the founder's craft rules: spacious, centered headers,
  colour-without-plus P&L, useful columns (SIP ₹/month, Next-step chip), column
  picker, DD-MMM-YY, value-rank bars, №-notation explained on hover.
- New cross-check that closes the books: net money in + realized P&L == cost of
  current holdings, to the rupee. Honesty catch fixed live: the concentration panel
  was showing asset split labelled as category — now truly fund_category, with the
  sector-level boundary named (needs the fund-portfolio feed, real build).
- Verified: verify-360 now 15 checks incl. verdict rule, risk scale, journey bounds,
  books-close identity; all four verifiers green on pristine reseed; all 7 tabs
  browser-clicked, zero console errors.

## 07-Aug-2026 (evening) — Client 360 live: page 3 of 23, the lot-level differentiator
- `app/clients/[clientId]` — full 360 on founder pre-approval ("build both, see
  together"): header chips (family · risk · KYC · PAN · since), 5 KPI cards with XIRR
  vs benchmark side by side ("trailing it" called out), asset-mix bar, tax panel
  showing lot-level truth (unrealised LT/ST vs the ₹1.25L exemption, booked losses,
  headroom line), holdings table where every row expands into dated purchase lots with
  LTCG/STCG bucket chips and "LT in Nd" countdowns (Kuvera-pattern foundation for the
  proposal builder), 12-month transaction ledger (range stated, bounded), SIP cards
  with bounce/mandate status, household roll-up, this client's open+closed actions,
  and note capture → interaction timeline + optional follow-up minted into Today.
  Goals slot ghosted honestly. Design record artifact:
  https://claude.ai/code/artifact/f6d9685a-18c4-41e0-b816-a3d8094492ce
- Seed: story-client families renamed to match surnames (Meera Shah was in "Solanki
  Family" — name-gen collision); seed now removes WAL sidecars (reseeding under a
  running server hit disk I/O error — root-caused: fresh db + orphan -wal/-shm).
- Caught by build discipline: interactions column is `sb_id` not `broker_id` (schema
  sketch vs actual DDL); verify-360 rounding tolerance on Meera's value.
- Verified: `verify-360.ts` — reconciliation to the rupee for ALL 51 book clients
  (KPI == Σ holdings == Σ lots; unrealised tax == Σ lot tax), household == member sum,
  bounded transactions, laggard flag, family-name fix — ALL PASS. All four verifiers
  green on pristine reseed; browser QA incl. live note-capture write.

## 07-Aug-2026 (later) — My clients live: page 2 of 23, new shell across the app
- Founder-directed layout system shipped: navigation moved to a top bar (path-aware),
  full-width content, consistent right insight rail; mocks and app locked light-only.
  Today refitted onto the same shell.
- `app/clients` — 6 provenance-backed cards (book · blended return · SIP participation ·
  attention · dormant · idle money), 3 visuals (asset-mix stacked bar on the validated
  chart palette · client-health bar with click-through segments · returns-spread
  histogram), segment chips + risk/sort/search filters (all URL-driven), dense table
  (value/invested/P&L/XIRR/activity/SIPs/actions/flags, hover row actions, sticky
  totals), bulk select → mint-action-for-each (writes actions + events) + CSV export.
- One-denominator rule enforced: every figure on any page derives from the same
  advisor-attribution book (Today's churn/idle/SIP-risk cards migrated too — churn 4→3,
  idle 39→38 were mapping-join artifacts, now consistent).
- Honest catch: NULL-XIRR holdings were silently blending as 0% — real blended return
  is +14.3%, not +12.1% (mock corrected; NULL-aware blend everywhere per the
  NULL-stays-NULL rule).
- Verified: `verify-clients.ts` 15 checks (independent SQL: card↔chip↔row-count
  consistency, mix total == book, bands sum == clients, no future-dated activity) ALL
  PASS; verify-today 12/12; seed 28/28; browser QA of chips/search/sort/bulk-mint/360
  stub; pristine reseed after. Build clean, zero type errors.

## 07-Aug-2026 — Today page live: page 1 of 23, plus the foundation all pages reuse
- Design first: mock published as an artifact with the real seeded numbers
  (https://claude.ai/code/artifact/a0a093e4-a1e2-4321-880b-c4a2a0953460), founder saw it
  before code. Design grounded in the research corpus: Morgan Stanley NBA three-stream
  queue, Prudent Edge+ segment cards, Envestnet signal families, Gainsight auto-close.
- `app/today` — market/news strip (the page's only labelled placeholders), 6 click-through
  stat cards (book · net flows · churn risk · idle-no-SIP · SIPs at risk · onboarding
  stuck), three-stream queue (act-now / opportunities ranked by ₹ / relationship+FYI with
  the auto-closed chip), broker's own task capture into the same queue, self-scoreboard
  (the number management sees), learning strip ghosted until evidence.
- Foundation reused by the next 22 pages: `lib/db.ts` + `lib/queries.ts` (every figure
  carries provenance: SQL + source columns + computed/rule/learned tag), `components/`
  (Provenance popover, StatCard, QueueCard), clean-flat tokens in `globals.css`, nav shell.
- Seed enriched for the demo broker (sb 4): birthdays pinned into the coming week,
  2 mandate expiries, idle-no-SIP + concentration mints, one auto-resolved bounce —
  every mint reads real rows; 5 new invariant checks added (28 total, ALL PASS).
- Verified: `mockdb/verify-today.ts` recomputes all 6 card figures + stream membership
  with independent SQL — 12/12 PASS. Browser QA: card expand, provenance popover,
  outcome capture (writes action + events ledger), task add, auto-closed chip — all
  exercised live; DB reseeded to pristine after. `next build` clean, zero type errors.
- Honest catch: first mock showed net flows +₹2.31L; the bounded MTD query exposed two
  future-dated seed transactions — real figure is +₹6,000 and the mock was corrected.

## 07-Aug-2026 — Seed engine live: the mock backend exists
- `mockdb/schema.sql` — 70 objects: ~45 carried production tables (exact prod names/columns,
  verified against the schema capture) + 22 new objects (events ledger, actions, rules
  registry, policies/experiments, consents, quarantine, amc_rate_card, …) + serving views.
  Doubles as migration-zero of the real build.
- `mockdb/engines.ts` — deterministic RNG, XIRR (Newton+bisection), FIFO lot engine,
  NAV series. House rule encoded: sub-1-year holdings never annualize.
- `mockdb/seed.ts` — generates 1,200 clients · 18 brokers (real tiers Silver 60→Platinum 90)
  · 2,403 folios · 14,238 transactions · 501 SIPs · 484 brokerage rows · 238 invoices ·
  125 owned actions · 314 ledger events, with story seeds baked in: Meera's double bounce
  (mandate dies 12-Aug), Arjun's 11-day e-log stall, the dormant Desai family (₹44.35L),
  Kapoor HUF's dual-broker folio, 24 EUIN-gap transactions, 3 short-paid AMC commission
  rows, 5 quarantined import rows, 18 unowned clients holding ₹1.02Cr.
- `mockdb/verify.ts` — 23 invariant checks: **ALL PASS** (totals reconcile to the rupee
  across tables; payout = received × tier% on every sampled row; view math = GST/TDS
  formula; every action carries evidence; policy claims backed 1:1 by outcome events;
  zero campaign sends without consent; attention board flags 168 clients, not the book).
- Book value: ₹68,50,06,239 across 1,200 clients — every figure computed, none typed.
