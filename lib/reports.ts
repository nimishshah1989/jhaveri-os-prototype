import { db } from './db';
import { TODAY, addDays } from '../mockdb/engines';
import { DEMO_SB } from './queries';

// The current portal scatters thirteen report screens across four menus, and a
// dashboard number cannot be clicked into the report that explains it. Here a
// report is the export of something you are already looking at — the catalogue
// exists so you can find one you have not navigated to, not as the only way in.
//
// One shell formats all of them. Consistency is not a style guide someone has to
// remember; it is a single component every report renders through.

export const REPORT_FORMAT = {
  currency: 'Indian grouping, ₹ prefix, 2 decimals shown, 4 used in calculation',
  compact: 'Lakh and crore — never million or billion',
  dates: 'DD-MMM-YYYY, IST',
  numbers: 'Right-aligned, tabular figures so columns line up',
  header: 'Jhaveri Securities co-branded with the broker named as the adviser',
  freshness: 'Every report states the date its data is true as at, and which feed produced it',
  disclaimer: 'Mutual fund investments are subject to market risk. Read all scheme related documents carefully. Past performance does not indicate future returns.',
  expiry_days: 7,
} as const;

export type Fmt = 'pdf' | 'xlsx';

export interface ReportDef {
  id: string;
  name: string;
  /** The question it answers, in the user's words. */
  question: string;
  /** One row of the output is one of these. */
  grain: string;
  group: 'Client-facing' | 'Tax' | 'Book & activity' | 'Commission';
  filters: string[];
  formats: Fmt[];
  sources: string[];
  /** Where the same data is already visible on screen, so the export has a home. */
  inContext?: string;
  /** Rows this report would produce for a broker right now. */
  rows: (sbId: number) => number;
  /** Stated when the report is defined but not yet generating. */
  status: 'built' | 'defined';
  note?: string;
}

const BOOK = `(SELECT sb_sub_broker_code FROM sub_broker_master WHERE sb_id=?)`;
const n = (sql: string, ...p: unknown[]) => (db().prepare(sql).get(...p) as { n: number }).n;

export const REPORTS: ReportDef[] = [
  {
    id: 'portfolio_valuation',
    name: 'Portfolio Valuation Summary',
    question: 'What is every client worth today, and how have they done?',
    grain: 'One row per client per scheme, with XIRR against its benchmark',
    group: 'Client-facing',
    filters: ['Client or family group', 'As-at date', 'Active holdings only'],
    formats: ['pdf', 'xlsx'],
    sources: ['fifo_summary_holding_active', 'fifo_summary_holding.sh_xirr', '.sh_bmxirr'],
    inContext: '/clients',
    status: 'built',
    rows: sb => n(`SELECT COUNT(*) n FROM fifo_summary_holding_active WHERE advisor_code=${BOOK} AND balance_units>0.0001`, sb),
  },
  {
    id: 'capital_gain',
    name: 'Capital Gain Report',
    question: 'What gains has a client realised, and what tax follows?',
    grain: 'One row per tax lot sold, FIFO-matched',
    group: 'Tax',
    filters: ['Client or family group', 'Financial year or date range', 'Detail or summary'],
    formats: ['pdf', 'xlsx'],
    sources: ['fifo_purchase_sales_log', 'fifo_summary_holding.sh_realized_ltcg', '.sh_realized_stcg', 'cost_inflation_index'],
    inContext: '/clients/[id] → Tax tab',
    status: 'built',
    note: 'Honours the 31-Jan-2018 grandfathering and the exit-load window.',
    rows: sb => n(`SELECT COUNT(*) n FROM fifo_purchase_sales_log l JOIN folio_master f ON f.fm_folio_no=l.folio_no WHERE f.fm_sub_broker_code=${BOOK}`, sb),
  },
  {
    id: 'taxation',
    name: 'Taxation Report',
    question: 'One tax pack per client per financial year.',
    grain: 'Composite — capital gains, dividends, transactions and ledger in one document',
    group: 'Tax',
    filters: ['Client or family group', 'Financial year', 'Include dividends', 'Include transactions'],
    formats: ['pdf', 'xlsx'],
    sources: ['fifo_summary_holding', 'transaction_master', 'capital_gain_period_master'],
    inContext: '/clients/[id] → Tax tab',
    status: 'built',
    rows: sb => n(`SELECT COUNT(DISTINCT client_id) n FROM fifo_summary_holding_active WHERE advisor_code=${BOOK}`, sb),
  },
  {
    id: 'transaction',
    name: 'Transaction Report',
    question: 'What happened between two dates?',
    grain: 'One row per transaction',
    group: 'Book & activity',
    filters: ['Client, family group, or all', 'Date range', 'Transaction type'],
    formats: ['pdf', 'xlsx'],
    sources: ['transaction_master', 'transaction_type_master'],
    inContext: '/clients/[id] → Transactions tab',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM transaction_master WHERE fk_sb_id=?', sb),
  },
  {
    id: 'dividend',
    name: 'Dividend Report',
    question: 'What has been paid out as dividend?',
    grain: 'One row per dividend event',
    group: 'Book & activity',
    filters: ['Client or family group', 'Date range'],
    formats: ['pdf', 'xlsx'],
    sources: ['transaction_master (type: Dividend Paid / Reinvest)'],
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM transaction_master WHERE fk_sb_id=? AND fk_tran_type_id IN (9,10)', sb),
  },
  {
    id: 'redemption',
    name: 'Redemption Report',
    question: 'Who took money out, and from where?',
    grain: 'One row per redemption transaction',
    group: 'Book & activity',
    filters: ['All, by AMC, by fund, or by broker', 'Financial year or date range'],
    formats: ['pdf', 'xlsx'],
    sources: ['transaction_master', 'transaction_type_master.tr_type_buy_sell_flag'],
    inContext: '/business → clients lost',
    status: 'built',
    rows: sb => n(`SELECT COUNT(*) n FROM transaction_master t JOIN transaction_type_master tt ON tt.tr_type_id=t.fk_tran_type_id WHERE t.fk_sb_id=? AND tt.tr_type_buy_sell_flag=-1`, sb),
  },
  {
    id: 'systematic',
    name: 'Systematic Report',
    question: 'Every SIP, STP and SWP registration.',
    grain: 'One row per registration',
    group: 'Book & activity',
    filters: ['Systematic type', 'Date range', 'Details or summary'],
    formats: ['pdf', 'xlsx'],
    sources: ['sip_master', 'bse_sxp_list'],
    inContext: '/business → SIP book',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM sip_master WHERE fk_sb_id=?', sb),
  },
  {
    id: 'active_sip',
    name: 'Active SIP Report',
    question: 'What is the live SIP book right now?',
    grain: 'One row per live SIP, with instalment health',
    group: 'Book & activity',
    filters: ['Client or family group'],
    formats: ['pdf', 'xlsx'],
    sources: ['sip_master.is_live_sip', 'bse_sxp_list.npayments_missed', 'bse_mandate_list.end_date'],
    inContext: '/business → SIP book',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM sip_master WHERE fk_sb_id=? AND is_live_sip=1', sb),
  },
  {
    id: 'rejection',
    name: 'Rejection Report',
    question: 'Which transactions bounced, and why?',
    grain: 'One row per rejected transaction',
    group: 'Book & activity',
    filters: ['Date range', 'Sub-broker', 'Rejection reason'],
    formats: ['pdf', 'xlsx'],
    sources: ['transaction_master (type 33)', 'bse_order_list.rejection_reason'],
    inContext: '/business → bounce rate',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM transaction_master WHERE fk_sb_id=? AND fk_tran_type_id=33', sb),
  },
  {
    id: 'elss_redemption',
    name: 'ELSS Redemption Available',
    question: 'Which ELSS lots are past their three-year lock-in?',
    grain: 'One row per lot, with holding days and current value',
    group: 'Tax',
    filters: ['Client or family group', 'As-at date'],
    formats: ['pdf', 'xlsx'],
    sources: ['fifo_detail_holding_latest.dhl_holding_days', 'scheme_master.fk_category_id'],
    status: 'built',
    rows: sb => n(`SELECT COUNT(*) n FROM fifo_detail_holding_latest d JOIN scheme_master s ON s.scheme_id=d.fk_scheme_id WHERE d.fk_sb_id=? AND s.fk_category_id=5 AND d.dhl_holding_days>1095`, sb),
  },
  {
    id: 'lt_redemption',
    name: 'Long-term Redemption Available',
    question: 'Which lots can be sold at long-term rates?',
    grain: 'One row per lot past its long-term threshold',
    group: 'Tax',
    filters: ['Client or family group', 'As-at date'],
    formats: ['pdf', 'xlsx'],
    sources: ['fifo_detail_holding_latest.dhl_holding_days', '.dhl_unrealized_ltcg'],
    inContext: '/clients/[id] → Tax tab',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM fifo_detail_holding_latest WHERE fk_sb_id=? AND dhl_unrealized_ltcg > 0', sb),
  },
  {
    id: 'broker_change',
    name: 'Broker Change Report',
    question: 'Which folios moved in from another ARN, and which left?',
    grain: 'One row per folio transferred',
    group: 'Book & activity',
    filters: ['Transfer period', 'Registrar', 'Current ARN'],
    formats: ['pdf', 'xlsx'],
    sources: ['folio_master.is_transferred_out', '.transfer_out_date', 'transaction_master.is_cob'],
    inContext: '/business → clients lost',
    status: 'built',
    rows: sb => n(`SELECT COUNT(*) n FROM folio_master WHERE fm_sub_broker_code=${BOOK} AND is_transferred_out=1`, sb),
  },
  {
    id: 'commission_statement',
    name: 'Commission Statement',
    question: 'Every commission line behind a month\'s payout.',
    grain: 'One row per folio per month, with the rate paid against the rate agreed',
    group: 'Commission',
    filters: ['Month or financial year', 'Include clawbacks', 'Flagged rows only'],
    formats: ['pdf', 'xlsx'],
    sources: ['brokerage_master', 'invoice_master', 'amc_rate_card'],
    inContext: '/earnings',
    status: 'built',
    note: 'Not in the current portal. Brokers reconcile this in Excel today.',
    rows: sb => n('SELECT COUNT(*) n FROM brokerage_master WHERE fk_sb_id=?', sb),
  },
  {
    id: 'review_pack',
    name: 'Client Review Pack',
    question: 'The annual review document for one client.',
    grain: 'One document per client',
    group: 'Client-facing',
    filters: ['Client', 'Include proposals'],
    formats: ['pdf'],
    sources: ['review_packs', 'all Client 360 sources', 'mv_portfolio_attention'],
    inContext: '/review-packs',
    status: 'built',
    rows: sb => n('SELECT COUNT(*) n FROM review_packs WHERE sb_id=?', sb),
  },
];

/**
 * The Cash Flow Report renders blank in the current portal. It is listed so the
 * migration is honest about it rather than quietly dropping a route.
 */
export const NOT_CARRIED = [{
  name: 'Cash Flow Report',
  why: 'Broken in the current portal — the page renders blank and makes no API call. Rebuilt only once someone defines what it should show.',
}];

export interface QueueRow {
  id: number; pdf_type: string; format: string; status: string;
  report_for: string; row_count: number | null;
  requested_at: string; completed_at: string | null; expires_at: string | null;
  name: string; expired: boolean;
}

export function queue(sbId: number): QueueRow[] {
  const rows = db().prepare(`SELECT id, pdf_type, COALESCE(format,'pdf') format, status, report_for,
      row_count, requested_at, completed_at, expires_at
    FROM download_history_logs WHERE user_id=? ORDER BY id DESC LIMIT 40`).all(sbId) as QueueRow[];
  return rows.map(r => ({
    ...r,
    name: REPORTS.find(x => x.id === r.pdf_type)?.name ?? r.pdf_type.replace(/_/g, ' '),
    expired: !!r.expires_at && r.expires_at < TODAY,
  }));
}

export function expiryFor(requestedAt: string): string {
  return addDays(requestedAt, REPORT_FORMAT.expiry_days);
}

/** Reports grouped for the catalogue, in the order a broker thinks about them. */
export function catalogue(sbId: number = DEMO_SB) {
  const groups: ReportDef['group'][] = ['Client-facing', 'Tax', 'Book & activity', 'Commission'];
  return groups.map(g => ({
    group: g,
    reports: REPORTS.filter(r => r.group === g).map(r => ({ ...r, count: r.rows(sbId) })),
  }));
}
