# Design System — The Folio (Jhaveri client lens)

Approved 12-Aug-2026 by the founder, from three rendered directions. Read this
before any visual decision in `prototype/app/me/**`.

## Product context
- **What this is:** the client-facing app for Jhaveri Private wealth clients — their
  own money, explained and acted on. Built as routes inside the existing JHAVERI-OS
  prototype, on the same database and the same query layer as the broker lens.
- **Who it's for:** Indian mutual-fund investors with a named relationship manager.
  Hero client: Meera Shah, ₹15.74L across three funds.
- **Quality bar:** ET Money (`research/20`, and the founder's own 229-second screen
  recording, which is the primary source). Their completeness, our form — never
  their format.
- **The memorable thing:** *"It showed me what my own decisions cost me, and then
  fixed one."* Every design decision serves that sentence.

## Aesthetic direction
**Editorial-Instrument.** The precision of a private-bank statement, built as
something you operate. Not a magazine — that was the retired Daily Folio, and it
failed for reading like a newspaper. Not a retail fintech dashboard — that is theirs.

**Decoration: intentional.** Cards on a tinted ground carry the structure; gold marks
the one thing worth pressing. Nothing decorative earns a place.

**Two grounds, one language.** Light and dark are the same system with the ground
inverted, switched by a sun/moon toggle in the top bar. Not two designs — one, with
a lamp. Dark is a *setting*, not a mode reserved for insight (that was their trick).

## Color

One token set, redefined per theme. Every component reads tokens, never literals.

| Token | Light | Dark | Job |
|---|---|---|---|
| `--f-ground` | `#F7F5F0` | `#14161A` | the page under everything |
| `--f-card` | `#FFFFFF` | `#1E2126` | every object |
| `--f-ink` | `#1A1B1E` | `#ECE7DC` | primary text and figures |
| `--f-muted` | `#6B6862` | `#9A958A` | labels, secondary lines |
| `--f-faint` | `#747066` | `#8B877C` | captions, as-of stamps — 4.5:1 on both surfaces |
| `--f-line` | `#E6E2D8` | `#2A2E35` | hairlines and card borders |
| `--f-gold` | `#B08D3E` | `#C39B45` | the brand as a **fill or border** — primary button, stripe, mark |
| `--f-gold-ink` | `#886D30` | `#C39B45` | the same gold as **text**. The brand gold is only 2.67:1 on its own tint, so text never uses it |
| `--f-gold-soft` | `#F1EDE3` | `#23272E` | gold-tinted surfaces (fund marks, chips) |
| `--f-pos` | `#2C6B41` | `#4E9468` | gains |
| `--f-neg` | `#AB4425` | `#C4674A` | losses |
| `--f-track` | `#EDEAE1` | `#2A2E35` | the unfilled part of any bar |

`--f-pos` / `--f-neg` in light are the **exact values the broker lens already uses**,
so the two lenses stay semantically identical while looking different. Dark lifts
both for contrast and nothing else.

**Colour is never the only carrier.** Every signed figure takes a sign and a
direction glyph as well.

**Every text style clears 4.5:1 on the surface behind it, in both grounds** —
measured in the browser, not assumed. Type floor 11px, touch floor 44px.

**Elevation differs by theme, on purpose.** Light cards sit on one soft shadow
(`0 1px 2px`, `0 4px 14px`, both at 5% ink). Dark cards take a 1px `--f-line`
border and no shadow, because shadow does not read on a dark ground. Same object,
correct rendering.

## Typography
- **Display:** `'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif` —
  page titles and the headline rupee figure only, never inside a table. Same stack
  the broker lens uses, so the house voice carries across both.
- **Everything else:** the system sans stack, `font-variant-numeric: tabular-nums`
  on every figure.
- **Scale:** inherited from `app/globals.css` unchanged — `--t-hero` 1.9rem,
  `--t-xl` 1.35, `--t-lg` 1.05, `--t-md` 0.95, `--t-sm` 0.8, `--t-xs` 0.71. Six
  steps, nothing between them.
- **Open question, deliberately deferred:** a self-hosted display face (Fraunces was
  the candidate) judged against a proper specimen. Not blocking the build.

## Spacing & layout
- **Base unit 4px**, inherited: `--sp-1` 4 … `--sp-6` 32.
- **Density: comfortable** — the client lens breathes where the broker lens is dense.
  Card padding 18/19px, gap between cards 16px, page gutter 18px, 26px above a
  section label. Raised a step on 12-Aug-2026 at the founder's request; the
  earlier 16/12/16 read as cramped on a phone.
- **Radius:** cards 10px, buttons and chips 6px, fund marks and avatars full. One
  step, applied consistently — no bubble-radius-everything.
- **Frame:** phone-first, 390–430px. The page is a stack of cards; nothing is a table
  until it earns being one.

## The four rules that stop it becoming a newspaper again

1. **≤600 characters visible per screen.** Anything more goes behind a tap.
   Measured as **≤110 standing words per screen** — the words a client scrolls
   past, excluding anything behind a tap and excluding the text on a control,
   because a button is the thing you act on rather than something you read.
   This is the binding rule, and it is the one that was actually being broken:
   on 12-Aug-2026 the Events page measured 159 words a screen and the household
   124, while both passed the scroll cap comfortably. Reading load is the cost;
   scroll depth was only ever a proxy for it.

   Scroll depth is capped by what a surface is *for*, and there are only two kinds:
   - **Reading surfaces** — Today, the Portfolio tabs, Discover, a fund page —
     **≤2.5 screens**, or **≤2.75 where the surface carries a chart**. The
     allowance exists because a chart costs height and *saves* reading: holding a
     charted page to the same depth as a prose one forces the chart back out.
   - **Directory surfaces** — the Desk — may run longer, because they are a list of
     unrelated concerns you arrive at knowing which one you want. ET Money's Profile
     is long for the same reason. The obligation there is not brevity, it is that
     every section is a labelled landmark you can scan past.
   Measured in the browser, not estimated — both numbers, at 412×900.
   Current (12-Aug-2026), as *screens · standing words per screen*:
   Today 2.57 · 39 · Household 2.62 · 75 · Events 2.31 · 79 ·
   Held elsewhere 2.35 · 67 · Fund 2.10 · 31 · Fund research 1.52 · 106 ·
   Goals 1.13 · 89 · Ask 1.72 · 78 · Discover 1.82 · 73 · Desk 4.30 · 83
   (a directory surface, capped on words but not on depth).
2. **No screen without objects.** Cards, icons, marks, chips — and on any screen
   whose subject is a quantity over time, a comparison, or a split, **a chart**.
   Founder, 12-Aug-2026: the lens read as text-heavy and short of visual
   elements, and the measurement agreed — there were zero charts in the whole
   client lens while the broker lens had a plotting kit. `app/me/folio-charts.tsx`
   is that kit in this lens's tokens: the arc, ranked bars, the style box, and
   capture against its index. A zero-card page is a bug; so is a page that states
   a shape in a sentence it could have drawn.
3. **Every aggregate drills to its constituents, and every constituent drills back to
   the funds behind it.** No dead ends, both directions.
4. **Every insight ends in an act** — something that happens here, or one named human.
   A verdict with no button is a diagnosis with no prescription.

## Depth lives in exactly three places
- **A card expands** (`Collapse`) — for more of the same kind of row.
- **A sheet rises** — for a conversation about one figure, with its act at the bottom.
- **A full-screen story** — for a score or a narrative: one idea per screen, big type,
  a progress rail, and a card at the foot that drills to the funds responsible.

## Motion
**Intentional, never decorative.** Bars and rings fill on mount. Headline figures count
up once on first paint. Skeletons while server components stream. Sheets rise, stories
advance along a rail. Everything collapses to instant under `prefers-reduced-motion`.

## Icons
Extend `components/Icon.tsx` — inline SVG, 16×16 viewBox, `currentColor`, no
dependency. **An icon must carry meaning** (state, direction, kind). If removing it
loses nothing, it does not belong. New glyphs for the client lens are added to the
same `PATHS` map, never to a second system.

## What we take from ET Money, and what we refuse
**Take:** cards on a tinted ground · icons on every asset row · counts framing a
verdict ("2 of 13 funds", "7 going well") · exposure rows that name how many funds
cause them · dated insight cards about the thing you are looking at · a score narrated
as a story deck · contextual search placeholders · an always-reachable help affordance.

**Refuse:** the medal-and-laurel fund rank · star ratings · promo cards inside a
portfolio · a paywalled intelligence tier · engagement notifications · dark as the
signature of "insight".

## Decisions log
| Date | Decision | Rationale |
|---|---|---|
| 12-Aug-2026 | Editorial-Instrument, light + dark as one system with a toggle | Founder chose from three rendered directions; A and B read to him as one language in two grounds |
| 12-Aug-2026 | Gold is the action colour, not green | Every Indian investing app is green; gold reads private bank. Cost accepted: button shape works harder |
| 12-Aug-2026 | Bright/saffron direction rejected | Read retail rather than private wealth |
| 12-Aug-2026 | Display typeface deferred | Judged against a specimen after the build proves the layout; system serif ships meanwhile |
| 12-Aug-2026 | Client lens reuses `lib/portfolio`, `lib/client360`, `lib/scoring`, `components/*` | A standalone HTML file duplicated all of it once; never again |
| 12-Aug-2026 | `--f-gold-ink` split from `--f-gold` | The brand gold is 2.67:1 as text on its own tint — unreadable. Fills keep `--f-gold`, text takes the darker `--f-gold-ink` at 4.9:1 |
| 12-Aug-2026 | Neutrals darkened: light faint `#8A857A → #747066`, dark faint `#77736A → #8B877C` | Five of seven text styles failed 4.5:1, including the bottom tabs. All seven pass now |
| 12-Aug-2026 | 11px type floor, 44px touch floor | Labels were at 9–10px and tabs at 34px tall; both below the readable/tappable minimum |
| 12-Aug-2026 | Scroll rule split by surface kind | A Desk is a directory, not a reading surface. Holding it to 2 screens would have meant inventing tabs over unrelated concerns |
| 12-Aug-2026 | Reading load measured in words per screen, not scroll depth | Four screens broke the 600-character rule while passing the scroll cap. Depth was a proxy; words are the thing |
| 12-Aug-2026 | Charts enter the client lens, in its own tokens | Founder: the lens is text-heavy and short of visual elements. Recharts was already installed for the broker lens; `folio-charts.tsx` wraps it in `--f-*` tokens so a chart inverts with the lamp |
| 12-Aug-2026 | Reading surfaces with a chart may run to 2.75 screens | A chart costs height and saves reading. The old cap would have priced charts back off the page |
| 12-Aug-2026 | Density raised a step (16/12/16 → 18/16/18) | Founder: "be a lil more spacious". A phone read outside work is not a broker's grid |
| 14-Aug-2026 | Prose baselines raised on Today, Invest, Orders and the Desk | Phases 5, 6 and 7 landed on those four surfaces — switch, transfer, withdrawal, step-up, mandate, offer, four downloadable papers, nominee status, milestones and the per-figure sheet. Measured in the browser after the cuts: Today 39 words a screen, Invest 73, Orders 84, Desk 88 — every one inside the 110-word rule. The frozen source counts move because the pages gained function, not prose |
| 14-Aug-2026 | The Desk may run to 6.4 screens | It is a directory, and DESIGN.md already exempts one from the depth cap provided every section is a labelled landmark. It now has fourteen, each with its own heading |
