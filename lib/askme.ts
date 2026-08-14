import { db } from './db';
import { inr, inrCompact, dmy } from './format';

/* Ask, from the client's side. Free text routed onto a registry of questions
   this app can actually answer from the client's own book — never a model
   writing queries over client money. `EVALS` at the foot is the set that proves
   it, run by mockdb/verify-fabric.ts on every build. */

export interface AskFact { label: string; value: string; }

export interface AskAnswer {
  intent: string;
  /** What we understood the question to be. Shown back, so a wrong read is visible. */
  read_as: string;
  facts: AskFact[];
  /** What this answer cannot tell you. Always present — never an empty string. */
  risk: string;
  /** The named human it hands to. Never a fund, never an instruction. */
  handoff: string;
  confidence: 'high' | 'medium' | 'low';
}

interface Intent {
  id: string;
  read_as: string;
  /** Words that route to it. Matched, never guessed at by a model. */
  cues: string[][];
  risk: string;
  run: (clientId: number) => AskFact[];
}

const q1 = <T>(sql: string, ...p: unknown[]) => db().prepare(sql).get(...p) as T;

/**
 * The registry. Free text is matched against these, and anything that matches
 * nothing is refused rather than answered — see `askClient`. Every `run` reads
 * the client's own book with the same tables every page uses.
 */
const INTENTS: Intent[] = [
  {
    id: 'worth',
    read_as: 'What am I worth right now?',
    // No 'much' here on purpose: it is a question-form word, not a topic word,
    // and it appears in "how much tax" and "how much every month" too. The eval
    // set caught it routing both of those to this intent.
    cues: [['worth', 'value', 'total', 'holding', 'have i got'], []],
    risk: 'This is the money advised here. Anything held elsewhere is on the Held elsewhere tab and is not in this figure.',
    run: c => {
      const r = q1<{ v: number; put: number; n: number }>(
        `SELECT ROUND(SUM(present_market_value)) v, ROUND(SUM(cost_amount)) put, COUNT(*) n
         FROM fifo_summary_holding_active WHERE client_id = ?`, c);
      return [
        { label: 'Worth this morning', value: inr(r.v ?? 0) },
        { label: 'What you put in', value: inr(r.put ?? 0) },
        { label: 'Earned so far', value: inr((r.v ?? 0) - (r.put ?? 0)) },
        { label: 'Across', value: `${r.n} funds` },
      ];
    },
  },
  {
    id: 'tax',
    read_as: 'What would I pay in tax if I sold?',
    cues: [['tax', 'ltcg', 'stcg', 'capital', 'gains', 'exemption'], []],
    risk: 'Computed on today\'s prices and your own lots. It changes every day the market moves, and it is not tax advice.',
    run: c => {
      const r = q1<{ lt: number; st: number }>(
        `SELECT ROUND(SUM(sh_unrealized_ltcg)) lt, ROUND(SUM(sh_unrealized_stcg)) st
         FROM fifo_summary_holding WHERE fk_acc_id = ?`, c);
      const exempt = 125000;
      return [
        { label: 'Gain in units older than a year', value: inr(r.lt ?? 0) },
        { label: 'Tax-free allowance this year', value: inr(exempt) },
        { label: 'Free to take without tax', value: inr(Math.max(0, exempt - Math.max(0, r.lt ?? 0))) },
        { label: 'Gain in units under a year', value: inr(r.st ?? 0) },
      ];
    },
  },
  {
    id: 'laggard',
    read_as: 'Which of my funds is doing badly?',
    cues: [['bad', 'worst', 'lagging', 'behind', 'losing', 'poor', 'underperform'], []],
    risk: 'Behind an index over one window is not the same as a bad fund. Three years is a short time to judge a manager, and switching sells units and triggers tax.',
    run: c => db().prepare(
      `SELECT f.fund_name n, f.xirr, sh.sh_bmxirr bm, ROUND(f.present_market_value) v
       FROM fifo_summary_holding_active f
       LEFT JOIN fifo_summary_holding sh ON sh.fk_acc_id = f.client_id AND sh.fk_scheme_id = f.scheme_id
         AND sh.sh_folio_no = f.folio_no
       WHERE f.client_id = ? AND f.xirr IS NOT NULL AND sh.sh_bmxirr IS NOT NULL
       ORDER BY (f.xirr - sh.sh_bmxirr) LIMIT 3`,
    ).all(c).map((r: unknown) => {
      const x = r as { n: string; xirr: number; bm: number; v: number };
      return {
        label: x.n.replace(/ (Dir|Reg) ?Gr$/, ''),
        value: `${x.xirr}% against its index at ${x.bm}% · ${inrCompact(x.v)} of yours`,
      };
    }),
  },
  {
    id: 'sip',
    read_as: 'What am I putting in every month?',
    cues: [['sip', 'monthly', 'instalment', 'instalments', 'mandate', 'every month'], []],
    risk: 'A live SIP is only as live as the bank mandate behind it, and mandates expire without telling you.',
    run: c => {
      const r = q1<{ n: number; amt: number }>(
        `SELECT COUNT(*) n, ROUND(COALESCE(SUM(tr_amount), 0)) amt FROM sip_master
         WHERE fk_acc_id = ? AND is_live_sip = 1`, c);
      const missed = q1<{ n: number }>(
        `SELECT COUNT(*) n FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
         WHERE t.fk_acc_id = ? AND tt.tr_type_name = 'SIP Rejection'`, c);
      return [
        { label: 'Live instalments', value: `${r.n}` },
        { label: 'Going in every month', value: inr(r.amt) },
        { label: 'Refused by the bank so far', value: `${missed.n}` },
      ];
    },
  },
  {
    id: 'goal',
    read_as: 'Am I on track for what this money is for?',
    cues: [['goal', 'track', 'retire', 'retirement', 'university', 'college', 'house', 'target'], []],
    risk: 'Every arrival month here is an assumption at a published rate, never your own past return projected forward. It is not a promise.',
    run: c => db().prepare(
      `SELECT goal_name n, target_amount t, target_date d FROM client_goals
       WHERE fk_cm_user_id = ? AND is_active = 1 AND is_family = 0 ORDER BY target_date`,
    ).all(c).map((r: unknown) => {
      const g = r as { n: string; t: number; d: string };
      return { label: g.n, value: `${inrCompact(g.t)} wanted by ${dmy(g.d)}` };
    }),
  },
  {
    id: 'household',
    read_as: 'What is the family worth altogether?',
    cues: [['family', 'household', 'wife', 'husband', 'together', 'spouse', 'children'], []],
    risk: 'Only members who agreed to be counted are in this figure, and the page names anyone who is not.',
    run: c => {
      const r = q1<{ v: number; n: number }>(
        `SELECT ROUND(COALESCE(SUM(f.present_market_value), 0)) v, COUNT(DISTINCT f.client_id) n
         FROM fifo_summary_holding_active f
         WHERE f.client_id IN (SELECT client_id FROM household_members
           WHERE family_id = (SELECT fk_family_id FROM client_master WHERE cm_user_id = ?)
             AND client_id IS NOT NULL)`, c);
      return [
        { label: 'The household, where it is shared', value: inr(r.v ?? 0) },
        { label: 'Accounts counted', value: `${r.n}` },
      ];
    },
  },
];

/**
 * Words that turn an answer into a recommendation. If the question asks for one,
 * the answer says plainly that this is not what the bar does. The eval set at the
 * foot of this file asserts that behaviour on every build.
 */
const ADVICE_CUES = ['should i', 'shall i', 'recommend', 'best fund', 'which fund should',
  'what should i buy', 'buy', 'sell now', 'tip', 'suggest'];

export const ASK_REFUSAL =
  'This bar answers questions about your own money. It does not tell you what to buy or sell — no app should, and the person whose job that is has read the same pages you have.';

/**
 * Ask, from the client's side. EXPERIMENTAL, and labelled so on screen.
 *
 * ponytail: keyword routing over a fixed registry, not a model. A model that
 * writes queries over client money is the thing this product refuses everywhere
 * else; the semantic layer it would need is sketched in `lib/ask.ts`. When one
 * is built it replaces `route()` and nothing below it changes.
 */
function route(text: string): Intent | null {
  const t = text.toLowerCase();
  // Scored by the length of what matched, not the count. A two-word phrase like
  // "every month" is a far stronger signal than a three-letter word that happens
  // to appear, and counting hits alone let generic words win ties by declaration
  // order — which is not a rule, it is an accident of where the intent sits.
  let best: { intent: Intent; score: number } | null = null;
  for (const intent of INTENTS) {
    const score = intent.cues[0].filter(c => t.includes(c)).reduce((s, c) => s + c.length, 0);
    if (score > 0 && (!best || score > best.score)) best = { intent, score };
  }
  return best?.intent ?? null;
}

export function askClient(clientId: number, text: string, rmName = 'your manager'): AskAnswer {
  const t = text.trim().toLowerCase();
  if (ADVICE_CUES.some(c => t.includes(c))) {
    return {
      intent: 'refused', read_as: 'You asked for a recommendation.',
      facts: [], risk: ASK_REFUSAL, handoff: rmName, confidence: 'high',
    };
  }
  const intent = route(t);
  if (!intent) {
    return {
      intent: 'unknown',
      read_as: 'We could not tell what you were asking.',
      facts: [],
      risk: 'Rather than return a plausible wrong answer, this bar says it does not know. It can answer about what you are worth, your tax position, how your funds are doing, your instalments, your goals and your household.',
      handoff: rmName, confidence: 'high',
    };
  }
  const facts = intent.run(clientId);
  return {
    intent: intent.id,
    read_as: intent.read_as,
    facts,
    risk: intent.risk,
    handoff: rmName,
    // An intent that matched but found nothing is a real answer — "you have none" —
    // and it is stated at lower confidence rather than dressed up as a finding.
    confidence: facts.length === 0 ? 'low' : 'medium',
  };
}

/**
 * The eval set. House rule: any model-shaped output ships with one. Run by
 * `mockdb/verify-fabric.ts` on every build — a change to the routing that starts
 * answering "should I sell?" fails here rather than in front of a client.
 */
export const EVALS: { ask: string; expect: string; why: string }[] = [
  { ask: 'what am I worth', expect: 'worth', why: 'the commonest question, and the one every other answer hangs off' },
  { ask: 'how much tax if I sell everything', expect: 'tax', why: 'tax is asked in a dozen phrasings; this is the plainest' },
  { ask: 'which of my funds is doing badly', expect: 'laggard', why: 'the question the mirror exists to answer honestly' },
  { ask: 'how much am I putting in every month', expect: 'sip', why: 'instalments, phrased without the word SIP' },
  { ask: 'am I on track for retirement', expect: 'goal', why: 'goal language, not fund language' },
  { ask: 'what is the family worth together', expect: 'household', why: 'the household must be reachable by question, not only by tab' },
  { ask: 'should I sell my worst fund', expect: 'refused', why: 'advice-shaped, even though it contains a real intent cue' },
  { ask: 'what should I buy next', expect: 'refused', why: 'the answer this product may never give' },
  { ask: 'recommend a good fund for me', expect: 'refused', why: 'the same request in polite clothing' },
  { ask: 'what is the weather in Mumbai', expect: 'unknown', why: 'out of scope is an answer, not a guess' },
  { ask: 'qwerty', expect: 'unknown', why: 'noise must not route anywhere' },
];

