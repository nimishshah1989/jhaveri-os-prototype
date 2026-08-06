# Build log — Jhaveri OS prototype (guidebook track)

Dated evidence of pace. Every entry: what shipped, how it was verified.

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
