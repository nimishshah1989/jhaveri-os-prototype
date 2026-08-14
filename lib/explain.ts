import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { inr, inrCompact, dmy } from './format';
import { clientKpis, clientHoldings, taxPosition } from './client360';
import { mirror } from './mirror';
import { outlooks } from './goals';
import { ORDER_RULES } from './invest';
import { manager } from './me';

/* ── Any figure, opened ──────────────────────────────────────────────────────
   Phase 6, the half that was still missing. The Mirror answered "what did my own
   decisions do to this" on one tab about the whole portfolio. This answers it
   about the specific number a client is looking at, wherever they are looking.

   THREE VOICES, ALWAYS LABELLED, NEVER BLENDED:

     the ledger    a dry fact, derived. What the number is and where it came
                   from. If this cannot be computed, the figure has no sheet.
     your manager  a human sentence. SEEDED — Ravi's own workspace is a later
                   build, so nobody has written these yet, and every one of them
                   is marked on screen as a stand-in rather than passed off as
                   his. A page that renders RM content must degrade honestly.
     the market    what was happening around the money. Derived from the index
                   and the fund's own prices, never from a news feed.

   The rule that keeps this from becoming a chatbot: **a voice with nothing to
   say is absent, not filled.** A client with three months of history gets a
   shorter sheet than one with three years, and that is the honest outcome.    */

export type FigureKey =
  | 'wealth' | 'earned' | 'rate' | 'invested'
  | 'household' | 'tax_free' | 'goal' | 'elsewhere';

export type Voice = 'ledger' | 'manager' | 'market';

export interface Passage {
  voice: Voice;
  /** What this voice is, on screen. */
  label: string;
  text: string;
  /** True where the words are a stand-in for an RM who has not written yet. */
  seeded?: boolean;
}

export interface Sheet {
  key: FigureKey;
  title: string;
  /** The figure itself, already formatted. */
  figure: string;
  passages: Passage[];
  /** Mirror entries that bear on this figure. Every one traces to a named rule. */
  mirror: { key: string; deed: string; figure: string; caption: string; good: boolean }[];
  /** Where to go to see the constituents. */
  drill: { href: string; label: string } | null;
}

/** The slab that is exempt each year. One home for it, in lib/invest. */
const LTCG_EXEMPT = ORDER_RULES.ltcg_exempt;

const VOICE_LABEL: Record<Voice, string> = {
  ledger: 'The ledger',
  manager: 'Your manager',
  market: 'The market',
};

/**
 * Which Mirror rules bear on which figure. Named here rather than matched on
 * text, so a renamed rule breaks the build instead of silently emptying a sheet.
 */
const MIRROR_FOR: Record<FigureKey, string[]> = {
  wealth: ['patience', 'lump'],
  earned: ['patience', 'exit'],
  rate: ['instalments', 'patience'],
  invested: ['instalments', 'stepup', 'missed'],
  household: [],
  tax_free: ['exit'],
  goal: ['stepup', 'instalments'],
  elsewhere: [],
};

/**
 * What the market did over the window this figure covers. Computed from the
 * benchmark series the app already prices against — there is no news feed here,
 * and a sentence about "volatility" that is not measured is decoration.
 */
function marketVoice(clientId: number): Passage | null {
  const span = db().prepare(
    `SELECT MIN(inv_since_date) since FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).get(clientId) as { since: string | null } | undefined;
  if (!span?.since) return null;

  const b = db().prepare(
    `SELECT bh.fk_benchmark_id id, bm.benchmark_name name,
            MIN(CASE WHEN bh.price_date >= ? THEN bh.price END) start,
            MAX(CASE WHEN bh.price_date = (SELECT MAX(price_date) FROM benchmark_price_history
                WHERE fk_benchmark_id = bh.fk_benchmark_id) THEN bh.price END) now,
            MIN(bh.price) low, MAX(bh.price) high
     FROM benchmark_price_history bh
     JOIN benchmark_master bm ON bm.benchmark_id = bh.fk_benchmark_id
     WHERE bh.fk_benchmark_id = (
       SELECT s.fk_benchmark_id FROM fifo_summary_holding_active f
       JOIN scheme_master s ON s.scheme_id = f.scheme_id
       WHERE f.client_id = ? ORDER BY f.present_market_value DESC LIMIT 1)
       AND bh.price_date >= ?
     GROUP BY bh.fk_benchmark_id`,
  ).get(span.since, clientId, span.since) as
    { name: string; start: number; now: number; low: number; high: number } | undefined;
  if (!b?.start || !b.now) return null;

  const move = Math.round(((b.now / b.start) - 1) * 1000) / 10;
  const drop = Math.round(((b.low / b.high) - 1) * 1000) / 10;
  return {
    voice: 'market',
    label: VOICE_LABEL.market,
    text: `Since your first units in ${dmy(span.since).slice(3)}, ${b.name} has moved ${move >= 0 ? 'up' : 'down'} ${Math.abs(move)}%. Along the way it fell ${Math.abs(drop)}% from its own high — which is the part nobody remembers and everybody lived through.`,
  };
}

/**
 * The manager's voice. Seeded, and every sheet says so: Ravi's workspace is a
 * later build and nobody has written these. The alternative was to leave the
 * voice out entirely, which would have hidden the seam instead of naming it.
 */
function managerVoice(clientId: number, key: FigureKey): Passage | null {
  const rm = manager(clientId);
  if (!rm) return null;
  const lines: Partial<Record<FigureKey, string>> = {
    wealth: 'I do not judge this figure day to day, and nor should you. What I watch is whether the mix still matches what you told me the money is for — and it does. When it stops matching, I will say so before you have to ask.',
    earned: 'This is what has been earned, not what has been taken. Nothing here is yours until it is sold, and the tax on selling is the reason I will usually argue against it.',
    rate: 'One number over your own dates, which is the only fair way to read it. It is not what any fund advertises, because you did not buy on the day their chart starts.',
    invested: 'What went in is the only part of this you control. Everything else is the market, and the market is not something I will pretend to time for you.',
    tax_free: 'This is the one date in the year worth diarising. The allowance does not carry over, and taking it is not the same as selling out.',
    goal: 'The month on this is an assumption at a published rate. I would rather show you a date you can plan against than a promise I cannot keep.',
    household: 'A household is easier to plan for than a person, and harder to get permission for. Nothing moves between these accounts without the person whose money it is.',
    elsewhere: 'I cannot advise on what I cannot see. Bringing these across costs nothing and sells nothing, and it is the single thing that would most improve what I can tell you.',
  };
  const text = lines[key];
  if (!text) return null;
  return { voice: 'manager', label: `${rm.name}`, text, seeded: true };
}

/** The dry fact, per figure. Null where it cannot be computed — no sheet then. */
function ledgerVoice(clientId: number, key: FigureKey): { text: string; figure: string; title: string } | null {
  const k = clientKpis(clientId).value;
  const holds = clientHoldings(clientId).rows;
  const tax = taxPosition(clientId).value;

  switch (key) {
    case 'wealth': {
      if (!holds.length) return null;
      return {
        title: 'What you are worth',
        figure: inr(k.v),
        text: `${holds.length} holdings, each priced at the NAV its fund declared on ${dmy(TODAY)} and multiplied by the units on your folios. Nothing is estimated and nothing is smoothed. Money held anywhere else is not in this figure.`,
      };
    }
    case 'earned': {
      if (!holds.length) return null;
      const gain = k.v - k.invested;
      return {
        title: 'What it has earned',
        figure: inr(gain),
        text: `${inr(k.v)} today against ${inr(k.invested)} put in, across ${holds.length} holdings. Every rupee of this is on paper: it becomes real the day units are sold, and ${inr(tax.unreal_lt + tax.unreal_st)} of it would be taxable if that were today.`,
      };
    }
    case 'rate': {
      // A rate with nothing behind it is a number about money that is gone.
      if (k.wx == null || !holds.length) return null;
      return {
        title: 'Your rate',
        figure: `${k.wx}%`,
        text: `Annualised on your own dates and your own amounts — every purchase, every instalment, every sale, weighted by how long each rupee was actually invested. It is not the fund's published return, because you did not buy on the day their chart begins.`,
      };
    }
    case 'invested': {
      if (!holds.length) return null;
      // The oldest lot on any holding is the day the money started working.
      // Holding carries its lots rather than a since-date, so it comes from there.
      const first = holds.flatMap(h => h.lots.map(l => l.purchase_date)).sort()[0];
      return {
        title: 'What you put in',
        figure: inr(k.invested),
        text: `The sum of every purchase and instalment since ${first ? dmy(first) : 'you began'}, less anything taken out. This is the only figure on the page you decided; the rest is what the market did with it.`,
      };
    }
    case 'tax_free': {
      // An allowance is only worth showing to somebody with something to realise.
      if (!holds.length) return null;
      const free = Math.max(0, LTCG_EXEMPT - tax.real_lt);
      return {
        title: 'Free to take, tax-free',
        figure: inr(free),
        text: `Long-term gains on equity are exempt up to ${inr(LTCG_EXEMPT)} in a financial year. ${inr(tax.real_lt)} of that is already used, leaving ${inr(free)}. It does not carry over, and it resets on 31 March.`,
      };
    }
    case 'goal': {
      const gs = outlooks(clientId);
      if (!gs.length) return null;
      const g = gs[0];
      return {
        title: g.name,
        figure: inrCompact(g.now),
        text: `${inrCompact(g.now)} of ${inrCompact(g.target)}, from ${g.schemes} fund${g.schemes === 1 ? '' : 's'} you tagged to it. Projected at ${g.rate}% a year — the published rate for what this money is in, never your own past return.`,
      };
    }
    default:
      return null;
  }
}

/**
 * The sheet behind one figure. Returns null when the ledger cannot speak, which
 * is the whole gate: a figure we cannot explain does not get a tappable sheet
 * that opens onto an apology.
 */
export function explain(clientId: number, key: FigureKey): Sheet | null {
  const dry = ledgerVoice(clientId, key);
  if (!dry) return null;

  const passages: Passage[] = [{ voice: 'ledger', label: VOICE_LABEL.ledger, text: dry.text }];
  const rm = managerVoice(clientId, key);
  if (rm) passages.push(rm);
  const mk = marketVoice(clientId);
  if (mk) passages.push(mk);

  // Mirror entries are generated by rules in lib/mirror.ts; this only selects
  // among them. Nothing here writes a sentence about a client's own decisions.
  const wanted = MIRROR_FOR[key] ?? [];
  const entries = mirror(clientId)
    .filter(e => wanted.some(w => e.key === w || e.key.startsWith(`${w}-`)))
    .slice(0, 2)
    .map(e => ({ key: e.key, deed: e.deed, figure: e.figure, caption: e.caption, good: e.good }));

  const DRILL: Partial<Record<FigureKey, { href: string; label: string }>> = {
    wealth: { href: '/me/portfolio', label: 'Every holding behind it' },
    earned: { href: '/me/portfolio?tab=health', label: 'How it is doing' },
    rate: { href: '/me/portfolio?tab=mirror', label: 'What your decisions did' },
    invested: { href: '/me/orders', label: 'Every order and instalment' },
    tax_free: { href: '/me/desk', label: 'The calendar ahead' },
    goal: { href: '/me/goals', label: 'Everything you are saving for' },
    household: { href: '/me/household', label: 'The household' },
    elsewhere: { href: '/me/portfolio?tab=elsewhere', label: 'What sits elsewhere' },
  };

  return {
    key, title: dry.title, figure: dry.figure,
    passages, mirror: entries, drill: DRILL[key] ?? null,
  };
}

/** Every figure that has a sheet, for a verifier to walk. */
export const FIGURES: FigureKey[] = ['wealth', 'earned', 'rate', 'invested', 'tax_free', 'goal'];

/* ── what changed since you last looked ──────────────────────────────────────
   The Today hero the plan asked for. It needs a stored last-seen, and the only
   honest place for one in a lens with no auth is the browser: the server does
   not know who is looking, so it cannot know when they last did.

   ponytail: the page passes the timestamp its own cookie holds, and this
   function does the arithmetic. When a session exists it becomes a column and
   nothing above it changes.                                                   */

export interface SinceLast {
  /** Null the first time, when there is nothing to compare against. */
  since: string | null;
  /** Movement in the advised book since then. */
  moved: number | null;
  events: number;
  orders: number;
}

export function sinceLastLook(clientId: number, since: string | null): SinceLast {
  if (!since || !/^\d{4}-\d{2}-\d{2}$/.test(since) || since > TODAY) {
    return { since: null, moved: null, events: 0, orders: 0 };
  }
  const ev = db().prepare(
    `SELECT COUNT(*) n FROM events
     WHERE occurred_at > ? AND occurred_at <= ?
       AND (subject_id = ? OR subject_type = 'scheme')`,
  ).get(since, TODAY, String(clientId)) as { n: number };

  const orders = db().prepare(
    `SELECT COUNT(*) n FROM transaction_master WHERE fk_acc_id = ? AND tr_date > ? AND tr_date <= ?`,
  ).get(clientId, since, TODAY) as { n: number };

  // What the book moved by, priced then and now on the same holdings. Null when
  // the older price is missing — a movement computed off a half-priced book is
  // worse than no movement at all.
  const then = db().prepare(
    `SELECT SUM(f.balance_units * p.price) v, COUNT(*) n
     FROM fifo_summary_holding_active f
     JOIN mf_historical_price_master p ON p.fk_scheme_id = f.scheme_id
       AND p.price_date = (SELECT MAX(price_date) FROM mf_historical_price_master
                           WHERE fk_scheme_id = f.scheme_id AND price_date <= ?)
     WHERE f.client_id = ?`,
  ).get(since, clientId) as { v: number | null; n: number };
  const held = db().prepare(
    `SELECT COUNT(*) n, SUM(present_market_value) v FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).get(clientId) as { n: number; v: number | null };

  const moved = then.v != null && held.v != null && then.n === held.n
    ? Math.round(held.v - then.v) : null;

  return { since, moved, events: ev.n, orders: orders.n };
}
