# Build log — Jhaveri OS prototype (guidebook track)

Dated evidence of pace. Every entry: what shipped, how it was verified.

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
