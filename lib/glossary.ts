import type { ProvenanceTag } from './queries';

// ONE registry, two consumers.
//
//   · The ⓘ beside every figure on screen reads from here — what the number is,
//     how the person looking at it should read it, and the arithmetic behind it.
//   · The vendor's backend appendix at /backend is generated from the same
//     entries, so the document a vendor builds from cannot drift from the running
//     product. If a figure has no entry, the appendix says so rather than
//     inventing coverage.
//
// The two audiences get different halves of the same record. A broker sees
// `means`, `read`, `act`, `formula` and `caveat` — plain words only. The vendor
// appendix at /backend additionally shows `sources` and the live SQL. Table and
// column names never appear in front of a broker: they explain nothing to
// someone who does not have the schema, and they cost trust.

export interface Term {
  label: string;
  /** What the number is, in one sentence a broker would use. */
  means: string;
  /** How to read it — what good and bad look like. */
  read: string;
  /** What to actually do about it. Optional: some figures are context, not a cue. */
  act?: string;
  /** The arithmetic in plain English. Never SQL — that lives on /backend. */
  formula?: string;
  tag: ProvenanceTag;
  /** Production table.column names this resolves to. */
  sources: string[];
  /** Where it appears, for the appendix's index. */
  pages: string[];
  /** Anything the number deliberately does not cover. */
  caveat?: string;
}

export const GLOSSARY: Record<string, Term> = {
  // ── Today ──────────────────────────────────────────────────────────────────
  my_book: {
    label: 'My book',
    means: 'The market value today of every holding attributed to you.',
    read: 'This is the number every other money figure on the platform divides by. If it looks wrong, nothing else is trustworthy.',
    act: 'If a client is missing from it, their holdings are not attributed to you — raise that with ops before it costs you commission.',
    formula: 'SUM(present_market_value) over holdings whose advisor_code is yours, valued at the latest NAV.',
    tag: 'computed',
    sources: ['fifo_summary_holding_active.present_market_value', '.advisor_code', '.holding_date'],
    pages: ['Today', 'Growth'],
    caveat: 'Attribution is by advisor_code, not by the client-mapping table. The two disagree by design — see the one-denominator rule.',
  },
  net_flows_mtd: {
    label: 'Net flows this month',
    means: 'Money in minus money out across your clients this calendar month.',
    read: 'Positive means you brought money in. This is the part of growth you control — the rest is the market.',
    act: 'Negative this late in the month usually means a redemption you did not know about. Open the list and check the largest one.',
    formula: 'SUM(amount × direction) where direction comes from the transaction type, bounded to this month and today.',
    tag: 'computed',
    sources: ['transaction_master.tr_amount', '.tr_date', 'transaction_type_master.tr_type_buy_sell_flag'],
    pages: ['Today', 'Growth'],
  },
  churn_risk: {
    label: 'Churn risk',
    means: 'Clients the attention engine has flagged as at risk of leaving or drifting.',
    read: 'Work the largest first. A flag is a reason to call, not a verdict.',
    act: 'Open the list, take the top three, and phone them this week.',
    formula: 'Distinct clients in your book carrying any flag on the nightly attention board.',
    tag: 'rule',
    sources: ['mv_portfolio_attention.flag_type', '.client_id'],
    pages: ['Today'],
  },
  idle_no_sip: {
    label: 'Invested, no SIP',
    means: 'Clients holding money with you but no live monthly commitment.',
    read: 'The single largest source of new SIP volume in most books — they already trust you.',
    act: 'Pick the largest and propose a SIP sized to what they already hold.',
    tag: 'computed',
    sources: ['fifo_summary_holding_active.client_id', 'sip_master.is_live_sip'],
    pages: ['Today'],
  },
  sips_at_risk: {
    label: 'SIPs at risk',
    means: 'Live SIPs that have bounced twice or whose mandate expires within 45 days.',
    read: 'A bounced SIP is the cheapest thing on this page to save — it is already sold.',
    act: 'Fix the mandate before the next instalment date. After two more misses the plan usually dies.',
    formula: 'Annualised: monthly instalment × 12, summed across the plans at risk.',
    tag: 'rule',
    sources: ['sip_master.tr_amount', 'bse_sxp_list.npayments_missed', 'bse_mandate_list.end_date'],
    pages: ['Today', 'Growth'],
  },
  onboarding_stuck: {
    label: 'Onboarding stuck',
    means: 'Applications of yours blocked past the seven-day threshold, or rejected outright.',
    read: 'Every day here is a day the client is not invested and may change their mind.',
    act: 'An unsigned e-log needs the client; missing documents need the branch. Two problems, two different calls.',
    formula: 'A KRA rejection counts from day one; an unsigned e-log or a pending KYC counts after seven days.',
    tag: 'rule',
    sources: ['onboarding_applications.elog_status', '.stall_since', '.kyc_status', '.started_at'],
    pages: ['Today', 'Pipeline'],
  },
  scoreboard: {
    label: 'My scoreboard',
    means: 'Actions you closed inside their deadline, out of all you closed.',
    read: 'Management sees this same number. It measures follow-through, not effort.',
    tag: 'computed',
    sources: ['actions.state', '.sla_due', '.closed_at'],
    pages: ['Today'],
  },

  // ── Growth (My business) ───────────────────────────────────────────────────
  book_today: {
    label: 'Book today',
    means: 'Your assets under management as at the most recent daily valuation.',
    read: 'Compare it with the month-on-month figure beside it. Level is vanity; direction is the job.',
    act: 'If it fell and you did not expect it, check net flows before you check the market.',
    formula: 'Daily AUM spine: each folio\'s units carried forward through its own transactions, valued at that day\'s NAV, summed per broker.',
    tag: 'computed',
    sources: ['mv_aum_daily.aum', '.client_count', '.aum_date'],
    pages: ['Growth'],
  },
  aum_peak_day: {
    label: 'Monthly AUM (peak-day)',
    means: 'The highest daily AUM reached in the month — the definition the firm reports on.',
    read: 'Use this when comparing to anything the firm has published. Use month-end when you need the growth split to add up.',
    formula: 'MAX(daily AUM) within the calendar month, with the date it occurred.',
    tag: 'rule',
    sources: ['mv_monthly_aum.peak_day_aum', '.peak_date'],
    pages: ['Growth'],
    caveat: 'Peak-day and month-end differ. Only month-end makes opening + flows + market equal closing exactly.',
  },
  growth_split: {
    label: 'Flows vs market',
    means: 'How much of your growth you brought in, and how much the market handed you.',
    read: 'If market is the larger share, the book grew without you. That is the number to be uncomfortable about.',
    act: 'If the market did most of it, that is the month to book more new money rather than admire the total.',
    formula: 'Market movement = closing − opening − net flows. The residual, by definition — so opening + flows + market always equals closing.',
    tag: 'computed',
    sources: ['mv_monthly_aum.opening_aum', '.net_flows', '.market_movement', '.month_end_aum'],
    pages: ['Growth'],
  },
  sip_bounce_rate: {
    label: 'Bounce rate',
    means: 'The share of SIP instalments that failed rather than collected, over six months.',
    read: 'Above about 5% usually means mandate hygiene, not client intent. Below that, chase individually.',
    act: 'Check bank details in bulk rather than chasing clients one at a time.',
    formula: 'bounced ÷ (collected + bounced). A bounce never counted as an instalment, so it has to be added back to the denominator.',
    tag: 'computed',
    sources: ['transaction_master.fk_tran_type_id'],
    pages: ['Growth'],
  },
  clients_won_lost: {
    label: 'Won / lost',
    means: 'Clients who first invested with you, and clients who left, this financial year.',
    read: 'Lost means they transferred to another distributor or redeemed everything. A client who has gone quiet is not counted here — they are still yours to save.',
    act: 'Every name in the lost column is worth one phone call to understand why. That is the cheapest research you will ever do.',
    tag: 'rule',
    sources: ['folio_master.folio_start_date', '.is_transferred_out', 'fifo_summary_holding_active.balance_units'],
    pages: ['Growth'],
  },
  target_attainment: {
    label: 'Target vs actual',
    means: 'What you committed to this month against what has actually happened.',
    read: 'The faint mark on each bar is where you would be if the month landed evenly. Behind the mark matters; behind 100% on the 7th does not.',
    act: 'Compare against the pace mark, not against 100%. Behind the mark on the 20th is a real problem; on the 3rd it is not.',
    tag: 'computed',
    sources: ['sb_monthly_target.target_lumpsum_amount', '.target_sip_count', '.target_client_count'],
    pages: ['Growth'],
  },

  // ── Earnings ───────────────────────────────────────────────────────────────
  payout_net: {
    label: 'Net payout',
    means: 'What reaches your account for the month, after GST is added and TDS deducted.',
    read: 'The ladder above shows every step. If you disagree with the total, you can disagree with a specific rung.',
    act: 'If the total looks wrong, open the ladder and find the rung you disagree with, then raise a dispute on those exact rows.',
    formula: 'trail at your tier rate, + 18% GST if you are registered, − 5% TDS.',
    tag: 'computed',
    sources: ['brokerage_master.bkr_payout_amount', '.payout_gst_amount', '.payout_tds'],
    pages: ['Earnings'],
  },
  tier_rate: {
    label: 'Your rate',
    means: 'The share of the trail your book earns that is paid to you.',
    read: 'The next rung is priced in what it would add to this month. Rates come from the same table the payout run uses.',
    act: 'The next rung is priced in what it would add each month. That is the number to weigh against the extra business it needs.',
    tag: 'rule',
    sources: ['broker_category_payout_pct_master.trail_1st_yr_pct', 'sub_broker_category_master.cat_category_name'],
    pages: ['Earnings'],
  },
  amc_variance: {
    label: 'Short-paid by AMCs',
    means: 'Where an AMC paid a lower trail rate than the empanelment letter agreed.',
    read: 'Priced at what it cost you, not the firm. Raising a dispute cites the exact commission rows, not a description of them.',
    act: 'Raise a dispute. It cites the exact commission rows, so ops can take it to the AMC without rebuilding your working.',
    formula: 'For each flagged row: (paid rate − agreed rate) × the money it was charged on, then × your tier rate.',
    tag: 'rule',
    sources: ['brokerage_master.reco_status', '.reco_difference', '.bkr_percentage', 'amc_rate_card.agreed_trail_bps'],
    pages: ['Earnings'],
  },
  clawback: {
    label: 'Clawback',
    means: 'Trail already paid to you that came back because a client exited within a year.',
    read: 'Each one names the redemption that caused it. None is unexplained.',
    act: 'Look at the holding period. A pattern of exits inside a year is a selling problem, not an accident.',
    tag: 'computed',
    sources: ['brokerage_master.clawback_source_txn', '.bkr_payout_amount', 'transaction_master.tr_date'],
    pages: ['Earnings'],
  },

  // ── Pipeline (Onboarding) ──────────────────────────────────────────────────
  days_to_live: {
    label: 'Days lead to live',
    means: 'Median days from opening an application to the exchange allotting a client code.',
    read: 'This is the page\'s goal metric. AssetPlus advertises 180 seconds for the digital path — that gap is the point.',
    act: 'Every day here is a day the client is not invested and can change their mind.',
    formula: 'Median of (ucc_allotted date − application_started date) across finished applications, measured off the event ledger.',
    tag: 'computed',
    sources: ['events.event_type', '.occurred_at', '.subject_id'],
    pages: ['Pipeline'],
  },
  stall_days: {
    label: 'Stalled',
    means: 'Applications waiting longer than the threshold, or rejected outright.',
    read: 'Two kinds, two fixes: an unsigned e-log needs the client; missing documents need the branch.',
    act: 'Work the oldest first, and use the right fix for the kind of stall — nudging a client about a document the branch has not sent wastes both your time.',
    formula: 'A rejection blocks from day one. Time-based stalls trip after seven days waiting.',
    tag: 'rule',
    sources: ['onboarding_applications.elog_status', '.stall_since', '.kyc_status'],
    pages: ['Pipeline'],
  },

  // ── Campaigns (Marketing) ──────────────────────────────────────────────────
  send_set: {
    label: 'Who actually gets it',
    means: 'Your segment, minus everyone you may not lawfully contact on this channel.',
    read: 'This subtraction is the send list. Consent is per channel — agreeing on WhatsApp is not agreeing on SMS.',
    act: 'If the reachable number is small, the fix is consent, not a better campaign. Ask for it at the next review.',
    formula: 'segment − never asked − withdrew = will receive.',
    tag: 'rule',
    sources: ['consents.channel', '.purpose', '.state', 'fifo_summary_holding_active.present_market_value'],
    pages: ['Campaigns'],
  },
  attributed_rupees: {
    label: 'Attributed ₹',
    means: 'Money a client invested after replying, where you closed the action and named the transaction.',
    read: 'Deliberately conservative. Money that arrived without being linked is not claimed — that is the difference between a marketing report and a number you can defend.',
    act: 'Close your responder actions and name the transaction. If you do not, the money you actually earned will not show here.',
    tag: 'computed',
    sources: ['actions.linked_txn_ids', 'campaign_responses.minted_action_id', 'transaction_master.tr_amount'],
    pages: ['Campaigns'],
    caveat: 'It records that a client replied and that a human named the transaction. It does not prove the campaign caused it.',
  },

  // ── Reviews ────────────────────────────────────────────────────────────────
  review_due: {
    label: 'Needs a review',
    means: 'Clients past twelve months since their last pack, or carrying a fresh attention flag.',
    read: 'Ranked by money at stake times how overdue. Each row says which rule fired.',
    act: 'Start at the top — it is already sorted by money at stake against how overdue it is.',
    tag: 'rule',
    sources: ['review_packs.generated_at', 'mv_portfolio_attention.flag_type'],
    pages: ['Reviews'],
  },

  // ── Cross-cutting ──────────────────────────────────────────────────────────
  health_score: {
    label: 'Client health',
    means: 'A 0–100 score across five components, each worth 20.',
    read: 'The gain chip beside it is what is reachable by acting. Click any component to see the levers and their point value.',
    act: 'Click a component to see which specific moves raise it and by how much. Two conversations usually move a score more than ten small ones.',
    formula: 'Deterministic: five pure functions of the client\'s own data. No model, no learning — every point is traceable.',
    tag: 'rule',
    sources: ['lib/scoring.ts SCORING_RULES', 'fifo_summary_holding_active', 'sip_master', 'transaction_master'],
    pages: ['Clients', 'Client 360', 'Reviews'],
  },
  xirr: {
    label: 'Return (XIRR)',
    means: 'The annualised return on the actual timing of the money, not a simple gain percentage.',
    read: 'Always compared against the same period\'s benchmark shown beside it. Ahead or behind that is what matters, not the absolute number.',
    act: 'Only compare it with the benchmark beside it. A 12% return is good or bad depending entirely on what the market did.',
    formula: 'Cash-flow XIRR over the client\'s own dated flows plus today\'s value. Never an average of per-holding XIRRs.',
    tag: 'computed',
    sources: ['fifo_summary_holding.sh_xirr', '.sh_bmxirr'],
    pages: ['Clients', 'Client 360', 'Reviews'],
    caveat: 'Holdings under a year are not annualised — a short holding shows no XIRR rather than a misleading one.',
  },
};

// Shown to a broker, in their language — "can I trust this number, and why".
export const TAG_TRUST: Record<ProvenanceTag, string> = {
  computed: 'Counted from your actual records. It will be the same every time you look.',
  rule: 'Depends on a threshold the firm set. Change the threshold and this number changes.',
  learned: 'Learned from what actually worked. It only appears once there is enough evidence behind it.',
};

// The engineer-facing version, used on the backend appendix only.
export const TAG_MEANING: Record<ProvenanceTag, string> = {
  computed: 'Arithmetic over the ledger. Same inputs, same answer, every time.',
  rule: 'A threshold or definition someone chose. Changing it changes the number — and it is versioned, not hard-coded.',
  learned: 'Inferred from outcomes. Shown only once enough real outcomes exist to earn it.',
};

export function term(id: string): Term | undefined {
  return GLOSSARY[id];
}

/** Coverage, stated honestly wherever it is shown. */
export function glossaryCoverage(): { written: number; pages: string[] } {
  const pages = [...new Set(Object.values(GLOSSARY).flatMap(t => t.pages))].sort();
  return { written: Object.keys(GLOSSARY).length, pages };
}
