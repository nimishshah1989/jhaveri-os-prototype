import { SCORING_RULES } from './scoring';
import { GOAL_RULES } from './goals';
import { ORDER_RULES } from './invest';
import { EXEC_RULES } from './exec';
import { MANDATE_RULES } from './mandate';
import { ONBOARDING_RULES } from './onboarding';
import { LOOKTHROUGH_RULES } from './portfolio';
import { EARNINGS_RULES } from './earnings';
import { BUSINESS_RULES } from './business';
import { MARKETING_RULES } from './marketing';
import { REVIEW_RULES } from './reviewpack';

/* ── Every knob in the product, in one register ──────────────────────────────
   Founder, 14-Aug-2026: "Anything that needs to be defined, any rules, any
   scoring, all of this is shown and can be edited or customized in terms of the
   thresholds and values… nothing needs to be hard-coded in the backend or code."

   Eleven constants had grown up across eleven files, each one a perfectly good
   single home for its own subject and collectively invisible: the Rules page
   showed one of them. This registry names all eleven, so the admin surface
   renders whatever exists rather than whatever somebody remembered to add.

   WHAT THIS FILE IS NOT. It is not a second copy of the values — every entry
   below points at the constant the product actually reads, so a number shown
   here and a number used in a calculation cannot drift apart. Nothing is
   restated; it is described.

   THE PRODUCTION SHAPE, and the one thing still to build: `rules_registry` in
   the schema already carries `params`, `version`, `owner`, `approved_by` and
   `valid_from`. The live build reads thresholds from that table, this registry
   becomes the seed of its first version, and the page below gains an editor
   with an approval trail. The constants stay as the fallback when a row is
   missing, because a threshold that silently becomes zero is worse than one
   that is stale.                                                             */

export type Audience = 'client' | 'broker' | 'ops' | 'management';

export interface Knob {
  key: string;
  /** What moving this actually changes, in a sentence a non-engineer can act on. */
  does: string;
  value: unknown;
  unit?: string;
}

export interface RuleSet {
  id: string;
  title: string;
  /** Which lens breaks if this is wrong. */
  audience: Audience;
  /** The file that owns it. Named so an engineer can find it in one jump. */
  source: string;
  /** What this set decides, and why it exists. */
  about: string;
  version: string;
  knobs: Knob[];
  /** Set where a value must not be changed without somebody signing it off. */
  needs_signoff?: string;
}

/** Flattens a nested constant into leaf knobs, so a set is described once. */
// Takes `object` rather than Record<string, unknown>: every RULES constant is
// declared `as const`, so widening one at each call site needed a double
// assertion eleven times over. Object.entries reads an `object` fine.
function knobs(obj: object, does: Record<string, string>, skip: string[] = []): Knob[] {
  const out: Knob[] = [];
  const walk = (o: object, prefix: string) => {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (skip.includes(k) || key === 'version') continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, key);
      } else {
        out.push({ key, does: does[key] ?? does[k] ?? '', value: v });
      }
    }
  };
  walk(obj, '');
  return out;
}

export const RULE_SETS: RuleSet[] = [
  {
    id: 'scoring',
    title: 'Portfolio health score',
    audience: 'client',
    source: 'lib/scoring.ts · SCORING_RULES',
    version: SCORING_RULES.version,
    about: 'The number out of 100 a client sees on Today and on the health tab, and the levers offered to raise it. Five components, each worth 20.',
    needs_signoff: 'A client acts on this number. Compliance has not signed the weights, and `risk_allocation_bands` is still an empty table.',
    knobs: knobs(SCORING_RULES, {
      quick_win_single_lever: 'How many points one action must be worth before it is called a quick win',
    }, ['components', 'bands']),
  },
  {
    id: 'goals',
    title: 'Goal projections',
    audience: 'client',
    source: 'lib/goals.ts · GOAL_RULES',
    version: GOAL_RULES.version,
    about: 'How far forward a goal is projected and at what rate. The single most load-bearing honesty rule in the product: a client\'s own past return is NEVER projected forward, only these published rates by asset class.',
    needs_signoff: 'Changing a rate changes every arrival month every client is planning against.',
    knobs: knobs(GOAL_RULES, {
      'rates.Equity': 'Assumed yearly return on equity money',
      'rates.Debt': 'Assumed yearly return on debt money',
      'rates.Hybrid': 'Assumed yearly return on hybrid money',
      'rates.Gold': 'Assumed yearly return on gold',
      'rates.Other': 'Assumed yearly return where the asset class is unknown',
      fallback_rate: 'Used when a goal holds nothing yet',
      horizon_years: 'Past this, the app says a goal cannot be reached rather than projecting further',
      reached_within: 'How close counts as reached — pennies are not a shortfall',
    }),
  },
  {
    id: 'orders',
    title: 'Orders and tax',
    audience: 'client',
    source: 'lib/invest.ts · ORDER_RULES',
    version: ORDER_RULES.version,
    about: 'What the app will accept as an order, and the tax it prints before any sale.',
    needs_signoff: 'The exemption and the rates are law, not preference. They change when the Finance Act changes.',
    knobs: knobs(ORDER_RULES, {
      min_sip: 'Smallest monthly instalment the exchange accepts',
      min_lumpsum: 'Smallest single investment',
      ltcg_exempt: 'Long-term gain exempt each financial year',
      ltcg_rate: 'Tax on long-term gain above the exemption',
      stcg_rate: 'Tax on short-term gain',
      ltcg_months: 'Months held before a gain is long-term',
    }, ['states']),
  },
  {
    id: 'exec',
    title: 'Transfers and withdrawals',
    audience: 'client',
    source: 'lib/exec.ts · EXEC_RULES',
    version: EXEC_RULES.version,
    about: 'Floors on a switch, a transfer and a withdrawal, and how far a step-up may rise.',
    knobs: knobs(EXEC_RULES, {
      min_stp: 'Smallest monthly transfer between funds',
      min_swp: 'Smallest monthly withdrawal to a bank',
      min_switch: 'Smallest one-off switch',
      default_ceiling_multiple: 'A step-up stops at this multiple of the starting instalment',
    }, ['txn']),
  },
  {
    id: 'mandate',
    title: 'Bank mandates',
    audience: 'client',
    source: 'lib/mandate.ts · MANDATE_RULES',
    version: MANDATE_RULES.version,
    about: 'The bank permission every instalment depends on, and when the client is warned it is ending.',
    knobs: knobs(MANDATE_RULES, {
      years: 'How long a new mandate is registered for',
      min_cap: 'Smallest per-debit cap the exchange accepts',
      warn_days: 'How far ahead of expiry the client is told',
    }),
  },
  {
    id: 'onboarding',
    title: 'Joining and the pipeline',
    audience: 'ops',
    source: 'lib/onboarding.ts · ONBOARDING_RULES',
    version: 'onboarding-v1' /* ONBOARDING_RULES has no version field yet */,
    about: 'When an application counts as stuck, and the stages it is measured through.',
    knobs: knobs(ONBOARDING_RULES, {
      stall_days: 'Days in one stage before an application is called stalled',
    }),
  },
  {
    id: 'lookthrough',
    title: 'Look-through and overlap',
    audience: 'client',
    source: 'lib/portfolio.ts · LOOKTHROUGH_RULES',
    version: 'lookthrough-v1' /* LOOKTHROUGH_RULES has no version field yet */,
    about: 'How far into a fund the app looks, and when two funds are called the same bet.',
    knobs: knobs(LOOKTHROUGH_RULES, {}),
  },
  {
    id: 'earnings',
    title: 'Commission',
    audience: 'broker',
    source: 'lib/earnings.ts · EARNINGS_RULES',
    version: 'earnings-v1' /* EARNINGS_RULES has no version field yet */,
    about: 'How trail is computed and checked against the rate card. Money, so every number here is argued over in paise.',
    needs_signoff: 'These decide what a broker is paid. Nothing here changes without management.',
    knobs: knobs(EARNINGS_RULES, {}),
  },
  {
    id: 'business',
    title: 'Book growth',
    audience: 'broker',
    source: 'lib/business.ts · BUSINESS_RULES',
    version: 'business-v1' /* BUSINESS_RULES has no version field yet */,
    about: 'How AUM movement is split between money the broker brought in and money the market made.',
    knobs: knobs(BUSINESS_RULES, {}),
  },
  {
    id: 'marketing',
    title: 'Campaigns and consent',
    audience: 'ops',
    source: 'lib/marketing.ts · MARKETING_RULES',
    version: 'marketing-v1' /* MARKETING_RULES has no version field yet */,
    about: 'Who may be sent what. The recipient list IS the consent query — per channel, per purpose, respecting the date a consent was withdrawn.',
    needs_signoff: 'DPDP. A send that ignores a withdrawal is a breach, not a bug.',
    knobs: knobs(MARKETING_RULES, {}),
  },
  {
    id: 'review',
    title: 'Review packs',
    audience: 'broker',
    source: 'lib/reviewpack.ts · REVIEW_RULES',
    version: 'review-v1' /* REVIEW_RULES has no version field yet */,
    about: 'When a client is due a review, and what a pack must contain before it can be sent.',
    knobs: knobs(REVIEW_RULES, {}),
  },
];

/** Knobs with no plain-English sentence yet. Surfaced, never hidden. */
export function undescribed(): { set: string; key: string }[] {
  return RULE_SETS.flatMap(s => s.knobs.filter(k => !k.does).map(k => ({ set: s.id, key: k.key })));
}

export const RULES_INDEX = {
  sets: RULE_SETS.length,
  knobs: RULE_SETS.reduce((n, s) => n + s.knobs.length, 0),
  /** The table the production build reads thresholds from. Already in the schema. */
  store: 'rules_registry',
} as const;
