# Build log — Jhaveri OS prototype (guidebook track)

Dated evidence of pace. Every entry: what shipped, how it was verified.

## 07-Aug-2026 (final) — Review pack (broker page 8): the broker lens is complete
- **Mostly assembly, and deliberately so.** The pack is built by calling the same
  functions Client 360 renders — `clientKpis`, `taxPosition`, `clientHoldings`,
  `fundVerdict`, `clientHealth`. Nothing is recomputed and nothing is retyped, so the
  document a client reads and the screen a broker sees cannot disagree. The verifier
  asserts that identity field by field rather than trusting it.
- Seeded a year of pack history (81 packs, 16 brokers, varied client responses including
  20 that were never answered), the async render queue rows production already uses
  (`download_history_logs`), and 45 `interactions` so a pack can reference the last real
  conversation instead of a placeholder.
- **Founder rulings applied:** due = 12 months **or** an attention flag, whichever comes
  first, and the row says which one fired; packs carry **proposals**, drawn from the same
  health levers as Client 360 — which makes them advice, so the disclaimer rides on every
  copy and the pack is registered with its version and the client's response; **co-branded**,
  Jhaveri's compliance footing with the broker named as the adviser.
- aislop caught a check I had written with `as unknown as string || true` — a double type
  assertion that made the assertion always pass. A fake check is worse than no check;
  rewritten to actually compare against the ledger.
- The page surfaces the finding that matters most: **Ravi has reviewed 3 of 53 clients**,
  and 50 have never had a pack at all — ₹2.4 Cr of client money that has never been
  formally reviewed.
- Verified: `verify-reviewpack.ts`, 23 independent-SQL checks ALL PASS — pack figures
  matching Client 360 exactly, every proposal traced to a real health lever, every section
  naming its source, the due rule justified per row, and no response predating its pack.
  **All nine prior verifiers PASS on a pristine reseed.** `next build` clean, zero console
  errors across all eight broker pages. Both actions exercised live: generation wrote the
  pack, the queue row and the event; logging "meeting booked" minted an owned action
  traced to `pack:82`.
- **Broker lens complete: 8 of 8.** Today · My clients · Client 360 · Onboarding ·
  My earnings · My business · Marketing · Review pack. Ten verifiers, ~250 independent
  checks. Next: the Ops lens (6 pages).

## 07-Aug-2026 (latest) — Marketing (broker page 7): two gates, enforced in SQL
- **The consent work was already the strongest data in the seed** (2,141 records with real
  withdrawals) — but it was single-channel, and the money chain was broken:
  `actions.linked_txn_ids` is in the schema map's DDL and was **absent from the mock
  schema**, so campaign → response → action → transaction could not be closed at all.
- Consent is now **per channel and per purpose**: WhatsApp, email and SMS with different
  grant rates (3,300+ records, 159 withdrawals). Agreeing on WhatsApp is not agreeing on
  SMS, and the page proves it — the same broker reaches 35 clients on WhatsApp, 28 on
  email, 16 on SMS, out of the same 52-client segment.
- **Two invariants carry the page, both enforced in the query rather than in policy:**
  1. *Compliance.* A template without an approval artefact cannot be sent. The server
     action refuses the write; the disabled button is only a courtesy. A draft campaign
     on an unapproved template sits on the shelf saying so — a gate nobody can see is a
     gate nobody trusts.
  2. *DPDP.* The recipient list **is** the consent query, so no second list can drift out
     of step with it. Consent is a timeline: a send lawful in June is not re-judged by a
     July withdrawal, and a July send after one is refused.
- **Three bugs of my own making, caught by the verifier:**
  1. I walked campaigns in id order while their dates ran the other way, so 8 sends went
     out *after* the client had unsubscribed. Campaigns are now walked oldest-first and
     each send re-checks consent as of its own date.
  2. The seed generated sends for the draft campaign on the unapproved template —
     violating the very gate it exists to demonstrate. The seed now obeys it too.
  3. 14 responses were dated tomorrow (an unclamped 1–6 day reply lag on a campaign sent
     five days ago). Same class as the future-dated transaction fixed on page 6.
- Also corrected a **pre-existing hole in the compliance check** in `verify.ts`: it tested
  today's consent state (condemning sends that were lawful when made) and **never checked
  the channel at all**, so WhatsApp consent justified an SMS. Now time-aware and
  channel-aware.
- ROI follows the founder's ruling — money counts **only** when a human closed the action
  and named the transaction. Every column of the funnel narrows on the one before it, and
  unattributed money stays unattributed. Ravi: 18 responses, 1 client invested, ₹9,000
  provable. Small and defensible beats large and hand-waved.
- Clients who cannot be contacted are **named but greyed**, with "ask at next meeting"
  minting a task — and asking grants nothing, because only the client can. A client who
  withdrew is never re-asked.
- Verified: `verify-marketing.ts`, 30 independent-SQL checks ALL PASS — including both
  gates, the send-set subtraction adding up on every channel, unsubscribes always
  withdrawing the matching consent, no response predating its send, and every linked
  transaction being a purchase that post-dates the reply that claimed it. All eight prior
  verifiers PASS on a pristine reseed. Both server actions exercised live: launch created
  exactly the 35 reachable recipients with zero unlawful sends and logged which approval
  artefact authorised it.

## 07-Aug-2026 (late) — My business (broker page 6): growth split into flows vs market
- **The AUM matviews did not exist.** `mv_aum_daily` and `mv_monthly_aum` were absent
  and `aum_master` held 300 rows for a single date, so the page's headline block had no
  data at all. Both are now real objects, walked from the same folios and NAVs that
  produce commission — so the trend on this page and the money on My earnings are the
  same book by construction. 7,242 daily rows across 426 consecutive days.
- **The growth identity is the page.** Every broker-month carries opening, net flows and
  market movement, and `opening + flows + market == closing` to the rupee on every row.
  Ravi's book grew ₹79L over 14 months: 54% money he brought in, 46% the market. A
  rising line with flat flows now reads as "the market did the work", which is what a
  productivity platform should be honest about.
- Peak-day is the reported monthly figure (ruling 7) and is labelled as such; month-end
  sits beside it because only month-end makes the identity hold exactly. Verified that
  peak-day is genuinely the maximum of that month's daily rows and its date falls inside
  its own month.
- **Three more data-integrity bugs found and fixed**, each caught by walking AUM day by
  day — something no previous page did:
  1. The partial-redemption seeder sized a sale off *every* purchase ever made,
     including SIP instalments dated after the redemption, so it sold units the folio did
     not yet own. FIFO silently floored it at the available lots while a date-walk did
     not — two views of one book, quietly disagreeing by ₹3.2L.
  2. A top-up transaction was dated **2026-10-15, two months in the future**. FIFO
     counted it into current holdings. `addTxn` now throws on any future-dated row, which
     also clears the future-dated-transaction gap flagged in STATE since the first build.
  3. Exit sales rounded the amount before units were re-derived, leaving 0.0001 units
     behind so a departed client still read as holding something.
- Clients who left now exist at all: 16 exits (10 redeemed everything, 6 transferred to
  another distributor), seeded before the FIFO run so holdings, AUM and commission all
  stop on the same day. Founder's definition applied — dormant is **not** lost, because a
  dormant client is still saveable and already sits on Today as an action.
- 14 months of `sb_monthly_target` sized off each broker's own median activity, so
  attainment genuinely varies (47%–266%) instead of being uniform. The current month
  carries a pace marker: a target is not missed on the 7th.
- Meera's story is now **pinned rather than lucky** — two real overlapping flexi-cap
  funds and a laggard chosen from the data (worst NAV-vs-benchmark over two years),
  with folio ages past a year so the house rule will annualise them. Her laggard runs
  −11.4% against a +12.5% benchmark.
- Verified: `verify-business.ts`, 27 independent-SQL checks ALL PASS, including the
  growth identity on every broker-month, no gaps in the daily spine, cross-page identity
  with both My clients and My earnings, and the bounce rate using bounced ÷ due rather
  than ÷ collected. All seven prior verifiers PASS on a pristine reseed. `next build`
  clean, zero type errors, zero console errors across six pages.

## 07-Aug-2026 (late night) — My earnings (broker page 5): commission off the real book
- **The commission data had to be rebuilt from nothing usable.** `brokerage_master`
  held 484 aggregate rows — two per broker per month — with `fk_folio_id`,
  `fk_scheme_id` and `bkr_folio_no` **NULL on every one**. "Which client earned me this
  rupee", the trust mechanic this page exists for, was not buildable. Also: broker 4 had
  Trail only (no clawbacks), June 2026 was missing for every broker, and one −₹113
  mismatch firm-wide was the entire variance story.
- Trail is now generated **per folio per month from the actual book**: each folio's own
  units walked forward through its transactions, valued at month-end NAV, times the
  agreed rate for that AMC and asset class. 31,871 commission lines. Every one names a
  folio, a scheme, a client and a month, so the drill-down is real rather than an
  allocation of a monthly lump sum.
- **Three data-integrity bugs found and fixed on the way**, all of which would have
  shipped silently:
  1. `amc_rate_card` covered only AMCs 1–12, but the equity schemes carried in from
     Atlas are AMCs 13–21. Those rows computed against `undefined`, wrote NULL money,
     and `SUM()` skipped them — the totals looked plausible and were 7× too low. The
     rate card now covers every AMC, and a missing card throws instead of writing NULL.
  2. The Desai family's fixed lump-sum array was indexed out of bounds for the spouse's
     second and third folios, producing **two folios with NULL transaction amounts**.
     Pre-existing; invisible until commission started reading folios. The spouse now
     gets the one folio the array was designed for.
  3. `churnList()` capped at 10 rows but reported the total as 10, so the Today card
     could never say "… N more". Silent truncation; exposed when churn crossed 11.
- Clawbacks now name their cause: each links to the redemption transaction that
  triggered it, with the holding period, so no clawback is unexplained.
- Variance is the `amc_rate_card` validator earning its keep — one AMC has paid 74 bps
  against 86 bps agreed since May; the page prices that at what it cost the broker
  (₹1,661.72 over 48 lines), not what it cost the firm.
- **Founder ruling applied**: show the broker their own chain and their tier position,
  never the firm's rupee margin. So the ladder starts at their trail, and the tier strip
  says "Gold 70% → Gold Plus 75% = +₹1,236.86 a month" without stating what Jhaveri
  keeps. Upfront and Incentive stay empty with the reason on screen (SEBI ended upfront
  on regular MF plans in 2018) rather than being invented.
- Verified: `verify-earnings.ts`, 37 independent-SQL checks ALL PASS — money reconciles
  line → client → month → invoice → financial year; GST and TDS checked per row not on
  average; payout == receipt × tier rate on every row; no month gaps; every clawback
  inside its window; the folio on a commission row proven to belong to the broker being
  paid. All six prior verifiers PASS on a pristine reseed. `next build` clean, zero type
  errors, zero console errors on five pages. Month switching, per-client line drill-down
  and the dispute action exercised live (48 rows cited, ops action with a 5-day SLA),
  then reseeded to pristine.

## 07-Aug-2026 (night) — Onboarding (broker page 4): the pipeline, measured not stored
- **Seed had to be rebuilt before the page could be honest.** The old onboarding seed
  gave broker 4 two applications, put no stage timestamps anywhere, left the 8 KYC
  rejections attached to nobody, and stored a `broker_links.applications` counter that
  contradicted the application rows (8 vs 2). All four were fixed, not worked around.
- Seed now walks each of 80 applications through a real journey and **emits one event
  per stage entry** (`lead_created` → `application_started` → `kyc_verified` →
  `elog_completed` → `ucc_allotted`), plus `kyc_rejected` / `elog_sent` / `elog_stalled`
  off-path. Every funnel count and every "days at this stage" is read off that ledger;
  nothing is stored as a duration. 118 leads, one `client_kyc_logs` row per application
  joined via the new `onboarding_applications.kyc_log_id`.
- **Domain bug I introduced and caught in QA:** offline applications were landing in a
  "stalled at the BSE e-log" state. Paper has no e-log step. The seed now forces the
  e-log stages onto the digital path, and offline applications stall where they really
  stall — on documents, at KYC. Channel split came out 78% offline / 23% digital,
  which is the 80%-offline truth Jeet named, now visible on screen.
- `lib/onboarding.ts` — pipeline / funnel / daysToLive / stalls / stallAging /
  rejections / linkStats / monthCounts, plus `ONBOARDING_RULES` as the single home for
  the thresholds. **One time-based knob** (`stall_days: 7`) governs both an unsigned
  e-log and a KYC still sitting with the KRA; a rejection blocks from day one and is
  deliberately not on that clock. An earlier draft had two knobs where only one
  governed — dead config, removed.
- `app/onboarding` — goal metric against the AssetPlus 180-second bar, 6 cards, funnel
  + stall-aging charts, the 5-column board, the stall table with both fixes on every
  row (broker nudges; ops takes the backend failures), rejections in plain words, and
  a start form that writes a real lead + KYC record + application.
- **The phrasebook is written policy, not generation.** Each KRA code carries the
  sentence to say and the document to ask for. Codes without a written sentence show
  the official wording and say so — a wrong sentence here sends a client for the wrong
  document, so nothing is guessed.
- Verified: `verify-onboarding.ts`, 29 independent-SQL checks ALL PASS, including the
  cross-page identity (Today's "onboarding stuck" == this page's stalls for the same
  broker, 3 and 3, same oldest), funnel monotonicity, an independently computed median,
  every stall owning an action, and Arjun still stalled at 11 days. All five prior
  verifiers PASS on a pristine reseed. `next build` clean, zero type errors, zero
  console errors on all four pages. All four server actions exercised live in the
  browser (start writes lead+app+2 events; nudge moves the action to in_progress;
  escalate reassigns to the ops lens; refile closes the action with outcome `refiled`
  and returns the application to PENDING), then the DB reseeded to pristine.
- Two fixes from visual QA: a `<div>` nested inside a `<p>` (React DOM nesting error),
  and row actions half-hidden — "Hand to ops" showed while "Nudge client" waited for
  hover.

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
