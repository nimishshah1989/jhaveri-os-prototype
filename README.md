# Jhaveri OS — broker lens prototype

A working prototype of the broker-facing half of Jhaveri OS. Eight pages, every
number computed from a mock database that carries **exact production table and
column names**, and ten verifier scripts that re-derive those numbers with
independent SQL.

It is a prototype in the sense that the data is synthetic. It is not a mock-up:
nothing on screen is typed in, every figure traces to a query, and the buttons
write to a real ledger.

## Run it

```bash
npm install
npm run seed        # deterministic — same seed, same database, every run
npm run dev         # http://localhost:3000
```

## Check it

```bash
npm run verify:all  # 238 assertions across 10 scripts
```

The verifiers are the point. They re-derive every figure with SQL written
independently of the query layer, so a screen that looks right but computes wrong
still fails. A change is finished when they all pass.

| Script | Asserts |
|---|---|
| `verify.ts` | Seed invariants — totals reconcile, payouts match tier rates, consent holds |
| `verify-today.ts` | The action queue and its six figures |
| `verify-clients.ts` | Book denominators and the client list |
| `verify-360.ts` | Per-client holdings, tax, look-through, books-close identity |
| `verify-scoring.ts` | Health scores and the score-to-suggestion invariant |
| `verify-onboarding.ts` | Pipeline stages measured off the event ledger |
| `verify-earnings.ts` | Money reconciles line → client → month → invoice → FY |
| `verify-business.ts` | `opening + net flows + market movement == closing`, every month |
| `verify-marketing.ts` | The compliance gate and the DPDP consent timeline |
| `verify-reviewpack.ts` | The pack repeats Client 360's numbers exactly |

## Vendor documentation

```bash
npm run vendor:pack   # → vendor-pack.html
```

Generated from the running product, never written alongside it: DDL parsed from
`schema.sql`, queries captured by calling the real query layer, thresholds read
from the live rules objects, and acceptance criteria taken from the verifier
assertions. Regenerating is the only way it is updated, so it cannot describe a
version of the system that no longer exists.

## Shape

```
app/          one route per page; server actions live beside their page
lib/          the query layer — every figure carries its SQL, sources and honesty tag
              glossary.ts is the single registry behind both the ⓘ and the vendor pack
components/   the shared shell: PageHead, StatCard, Explain, Collapse, ClientLink, Icon
mockdb/       schema.sql (87 tables), seed.ts, and the ten verifiers
```

## Rules this codebase holds to

- **One denominator.** Every money figure derives from the advisor-attribution
  book. Two pages may not answer the same question differently.
- **Never write NULL into a financial calculation.** `SUM()` skips NULLs, which
  produces plausible totals that are badly wrong. The seed throws instead.
- **No future-dated rows.** A ledger records what happened.
- **Provenance on every figure** — `computed`, `rule` or `learned`, with the
  arithmetic in plain words for the user and the SQL for the vendor.
- **Ghost, never fake.** A capability that is not built says so on screen rather
  than showing an invented number.

## Deployment

Built for Vercel. The build seeds the database first; because a serverless
filesystem is read-only apart from `/tmp`, the database is copied there per
instance so the write actions genuinely work. Those writes reset on a cold start,
which is the right behaviour for a review deployment.
