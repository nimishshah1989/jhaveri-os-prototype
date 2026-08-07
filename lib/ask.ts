import { db } from './db';
import { DEMO_SB } from './queries';

// "Ask the book a question" — shown here as a working half and a stated half.
//
// WORKING: the questions below are pre-written and verified. Clicking one runs
// real SQL against the real book and renders the answer as a table you can export.
// That is not a mock — the numbers are the same numbers every other page uses.
//
// NOT BUILT: turning a broker's own free text into one of these. That needs a
// semantic layer — a registry of the entities, fields and metrics a question may
// refer to, so a model maps language onto a validated query spec and never writes
// SQL itself. The sketch of that layer is below so the shape is visible, but it is
// deliberately not wired up. A model guessing at SQL over client money is exactly
// the thing this product has refused everywhere else.

export interface Answer {
  columns: { key: string; label: string; align?: 'r' }[];
  rows: Record<string, string | number | null>[];
  truncated: boolean;
}

export interface AskQuestion {
  id: string;
  question: string;
  /** Which part of the book it reads, in the user's language. */
  reads: string;
  sql: string;
  columns: Answer['columns'];
  params: (sbId: number) => unknown[];
}

const BOOK = `(SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)`;

export const QUESTIONS: AskQuestion[] = [
  {
    id: 'biggest_no_sip',
    question: 'Which of my biggest clients have no SIP running?',
    reads: 'holdings and live SIPs',
    columns: [{ key: 'name', label: 'Client' }, { key: 'value', label: 'Holds', align: 'r' },
      { key: 'funds', label: 'Funds', align: 'r' }],
    sql: `SELECT h.client_id, h.client_name name, ROUND(SUM(h.present_market_value)) value,
        COUNT(*) funds
      FROM fifo_summary_holding_active h
      WHERE h.advisor_code = ${BOOK} AND h.balance_units > 0.0001
        AND h.client_id NOT IN (SELECT fk_acc_id FROM sip_master WHERE is_live_sip = 1)
      GROUP BY h.client_id ORDER BY value DESC LIMIT 12`,
    params: sb => [sb],
  },
  {
    id: 'lagging_funds',
    question: 'Which funds in my book are behind their benchmark?',
    reads: 'holdings, returns and benchmarks',
    columns: [{ key: 'fund', label: 'Fund' }, { key: 'clients', label: 'Clients', align: 'r' },
      { key: 'value', label: 'Money in it', align: 'r' }, { key: 'gap', label: 'Behind by', align: 'r' }],
    sql: `SELECT s.scheme_full_name fund, COUNT(DISTINCT h.fk_acc_id) clients,
        ROUND(SUM(h.sh_current_value)) value,
        ROUND(AVG(h.sh_bmxirr - h.sh_xirr), 1) || ' pp' gap
      FROM fifo_summary_holding h
      JOIN scheme_master s ON s.scheme_id = h.fk_scheme_id
      WHERE h.fk_sb_id = ? AND h.sh_xirr IS NOT NULL AND h.sh_bmxirr IS NOT NULL
        AND h.sh_xirr < h.sh_bmxirr
      GROUP BY s.scheme_id ORDER BY value DESC LIMIT 12`,
    params: sb => [sb],
  },
  {
    id: 'harvest_headroom',
    question: 'Who can still use their tax exemption this year?',
    reads: 'unrealised long-term gains',
    columns: [{ key: 'name', label: 'Client' }, { key: 'ltcg', label: 'Unrealised LTCG', align: 'r' },
      { key: 'headroom', label: 'Exemption left', align: 'r' }],
    sql: `SELECT c.cm_full_name name, ROUND(SUM(h.sh_unrealized_ltcg)) ltcg,
        ROUND(125000 - SUM(h.sh_unrealized_ltcg)) headroom
      FROM fifo_summary_holding h
      JOIN client_master c ON c.cm_user_id = h.fk_acc_id
      WHERE h.fk_sb_id = ? GROUP BY h.fk_acc_id
      HAVING ltcg > 0 AND ltcg < 125000 ORDER BY ltcg DESC LIMIT 12`,
    params: sb => [sb],
  },
  {
    id: 'mandates_expiring',
    question: 'Whose mandate expires in the next three months?',
    reads: 'SIPs and bank mandates',
    columns: [{ key: 'name', label: 'Client' }, { key: 'monthly', label: 'Monthly SIP', align: 'r' },
      { key: 'ends', label: 'Mandate ends' }],
    sql: `SELECT c.cm_full_name name, ROUND(s.tr_amount) monthly, ml.end_date ends
      FROM sip_master s
      JOIN client_master c ON c.cm_user_id = s.fk_acc_id
      JOIN bse_sxp_list x ON x.reg_no = s.sxp_bos_code
      JOIN bse_mandate_list ml ON ml.exch_mandate_id = x.exch_mandate_id
      WHERE s.fk_sb_id = ? AND s.is_live_sip = 1
        AND ml.end_date IS NOT NULL AND ml.end_date <= date(?, '+90 days')
      ORDER BY ml.end_date LIMIT 12`,
    params: sb => [sb, '2026-08-07'],
  },
  {
    id: 'never_reviewed',
    question: 'Which clients have I never sent a review to?',
    reads: 'holdings and review packs',
    columns: [{ key: 'name', label: 'Client' }, { key: 'value', label: 'Holds', align: 'r' },
      { key: 'since', label: 'Client since' }],
    sql: `SELECT h.client_name name, ROUND(SUM(h.present_market_value)) value,
        MIN(h.inv_since_date) since
      FROM fifo_summary_holding_active h
      WHERE h.advisor_code = ${BOOK} AND h.balance_units > 0.0001
        AND h.client_id NOT IN (SELECT client_id FROM review_packs)
      GROUP BY h.client_id ORDER BY value DESC LIMIT 12`,
    params: sb => [sb],
  },
  {
    id: 'commission_by_amc',
    question: 'Which AMC pays me the most, and at what rate?',
    reads: 'commission lines and the rate card',
    columns: [{ key: 'amc', label: 'AMC' }, { key: 'paid', label: 'Paid to you', align: 'r' },
      { key: 'rate', label: 'Avg rate', align: 'r' }, { key: 'lines', label: 'Lines', align: 'r' }],
    sql: `SELECT a.amc_name amc, ROUND(SUM(b.bkr_payout_amount)) paid,
        ROUND(AVG(b.bkr_percentage) * 100) || ' bps' rate, COUNT(*) lines
      FROM brokerage_master b
      JOIN scheme_master s ON s.scheme_id = b.fk_scheme_id
      JOIN amc_master a ON a.amc_id = s.fk_amc_id
      WHERE b.fk_sb_id = ? AND b.fk_bkr_type_id = 1
      GROUP BY a.amc_id ORDER BY paid DESC LIMIT 12`,
    params: sb => [sb],
  },
];

export function ask(id: string, sbId: number = DEMO_SB): { q: AskQuestion; answer: Answer } | null {
  const q = QUESTIONS.find(x => x.id === id);
  if (!q) return null;
  const rows = db().prepare(q.sql).all(...q.params(sbId)) as Record<string, string | number | null>[];
  return { q, answer: { columns: q.columns, rows, truncated: rows.length >= 12 } };
}

/**
 * The semantic layer, sketched but not built. This is what free text has to map
 * onto: named things, the fields you may ask about, and the measures the engine
 * knows how to compute. Shown so the shape of the real build is visible.
 */
export const SEMANTIC_SKETCH = {
  entities: [
    { name: 'Client', synonyms: ['investor', 'customer', 'family member'], fields: ['name', 'value held', 'risk profile', 'client since', 'health score', 'last review'] },
    { name: 'Fund', synonyms: ['scheme', 'AMC product'], fields: ['name', 'AMC', 'category', 'return', 'benchmark return', 'expense ratio'] },
    { name: 'SIP', synonyms: ['systematic plan', 'monthly'], fields: ['amount', 'live', 'instalments missed', 'mandate end'] },
    { name: 'Transaction', synonyms: ['txn', 'purchase', 'redemption'], fields: ['date', 'amount', 'type', 'folio'] },
    { name: 'Commission', synonyms: ['brokerage', 'payout', 'trail'], fields: ['month', 'rate paid', 'rate agreed', 'amount'] },
    { name: 'Application', synonyms: ['onboarding', 'KYC'], fields: ['stage', 'days waiting', 'channel', 'rejection reason'] },
  ],
  metrics: [
    { name: 'AUM', means: 'market value of holdings', careful: 'always attributed by advisor_code, never the mapping table' },
    { name: 'XIRR', means: 'annualised return on actual cash-flow dates', careful: 'never annualised under one year' },
    { name: 'Net flows', means: 'money in minus money out', careful: 'signed by transaction type, bounded to today' },
    { name: 'Bounce rate', means: 'failed instalments over due instalments', careful: 'bounces must be added back to the denominator' },
  ],
  guardrails: [
    'The model chooses entities, fields and filters. It never writes SQL and never computes a number.',
    'Every generated query is validated against this registry before it runs; anything outside it is refused, not guessed.',
    'A question that cannot be answered says so. It does not return a plausible wrong table.',
    'Row-level security applies first — a broker can only ever ask about their own book.',
    'Every asked question and its answer is logged, so a wrong answer can be traced and the registry corrected.',
  ],
} as const;
