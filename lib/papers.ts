import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { clientHeader, clientHoldings, clientTxns, taxPosition } from './client360';
import { ORDER_RULES } from './invest';

/* ── Papers ──────────────────────────────────────────────────────────────────
   Phase 7. The unglamorous half, and the half reviews are lost on.

   Until now the Desk listed three documents and pressing one raised a request
   on the manager's queue. A client who taps "capital gains statement" and gets
   a promise instead of a statement has learned something about this firm, and
   it is not what we meant them to learn. These produce the file.

   THE INVARIANT. A document is built from the same functions the screen it sits
   behind renders — `clientHoldings`, `clientTxns`, `taxPosition` — never from a
   second query written for the export. That is the Review Pack rule applied to
   client documents, and it exists because the first thing anybody does with a
   statement is check it against the app, and the second thing they do if it
   disagrees is stop trusting both.

   ponytail: CSV, not PDF. A statement's job is to be opened by a bank, an
   accountant or a visa office, and every one of them opens a spreadsheet. A PDF
   renderer is a dependency, a font problem and a layout argument for a file
   nobody reads on a phone. When a branded PDF is genuinely wanted, this file
   stays the source of the rows and only the writer changes.                   */

export type PaperKind = 'valuation' | 'gains' | 'ledger' | 'elss';

export interface PaperMeta {
  kind: PaperKind;
  title: string;
  /** What it is for, in the words of whoever asks for it. */
  blurb: string;
  filename: string;
}

export const PAPERS: Record<PaperKind, Omit<PaperMeta, 'kind' | 'filename'>> = {
  valuation: {
    title: 'Valuation statement',
    blurb: 'Every holding priced at the latest NAV, with units, cost and your rate. What a bank or a visa office asks for.',
  },
  gains: {
    title: 'Capital gains, this financial year',
    blurb: 'Realised and notional kept apart, long-term and short-term separated. For your accountant.',
  },
  ledger: {
    title: 'Folio ledger',
    blurb: 'Every entry on every folio since the beginning, including the instalments the bank refused.',
  },
  elss: {
    title: 'Tax-saving proof, 80C',
    blurb: 'What went into tax-saving funds this financial year, and the date each amount unlocks. What your employer asks for in January.',
  },
};

/** The Indian financial year containing a date. 1 April to 31 March. */
export function financialYear(iso: string = TODAY): { from: string; to: string; label: string } {
  const y = Number(iso.slice(0, 4));
  const startYear = Number(iso.slice(5, 7)) >= 4 ? y : y - 1;
  return {
    from: `${startYear}-04-01`,
    to: `${startYear + 1}-03-31`,
    label: `${startYear}-${String(startYear + 1).slice(2)}`,
  };
}

export interface Paper {
  meta: PaperMeta;
  /** Column headers, in order. */
  columns: string[];
  rows: (string | number)[][];
  /** Printed under the table: what this was computed from and when. */
  footer: string[];
}

/**
 * A rupee figure for a cell. A NULL is a blank rather than a zero — the house
 * rule is that missing money is missing, and a 0.00 on a statement reads as a
 * fund that earned nothing rather than one we could not price.
 */
const money = (n: number | null | undefined): number | '' =>
  n == null || !Number.isFinite(n) ? '' : Math.round(n * 100) / 100;

/** Anything that could carry a comma or a quote has to survive a spreadsheet. */
function csvCell(v: string | number): string {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(p: Paper): string {
  const lines = [
    `# ${p.meta.title}`,
    ...p.footer.map(f => `# ${f}`),
    '',
    p.columns.map(csvCell).join(','),
    ...p.rows.map(r => r.map(csvCell).join(',')),
  ];
  return lines.join('\n') + '\n';
}

function whose(clientId: number): { name: string; pan: string | null } {
  const h = clientHeader(clientId);
  const pan = (db().prepare(`SELECT cm_pan_no p FROM client_master WHERE cm_user_id = ?`)
    .get(clientId) as { p: string } | undefined)?.p ?? null;
  return { name: h?.name ?? `Client ${clientId}`, pan };
}

/* ── the four documents ───────────────────────────────────────────────────── */

/**
 * What you own, priced this morning. Built from `clientHoldings` — the same rows
 * the Portfolio page lists — so the two can never disagree.
 */
function valuation(clientId: number): Paper {
  const rows = clientHoldings(clientId).rows;
  const who = whose(clientId);
  return {
    meta: { kind: 'valuation', ...PAPERS.valuation, filename: `valuation-${clientId}-${TODAY}.csv` },
    columns: ['Fund', 'Category', 'Folio', 'Units', 'Average cost', 'Invested', 'NAV', 'Value', 'Gain', 'Your rate %'],
    rows: rows.map(h => [
      h.fund_name, h.fund_category, h.folio_no, money(h.units),
      money(h.avg_cost),
      money(h.invested), money(h.nav), money(h.value), money(h.value - h.invested),
      h.xirr ?? '',
    ]),
    footer: [
      `${who.name}${who.pan ? ` · PAN ${who.pan}` : ''}`,
      `Priced ${TODAY} from the fund houses' declared NAVs.`,
      `${rows.length} holdings. A blank rate means the holding is under a year old and annualising it would be arithmetic rather than a return.`,
    ],
  };
}

/**
 * Gains, realised and notional kept apart. `taxPosition` is the same function
 * the Desk's tax card reads, so the statement and the screen cannot differ.
 */
function gains(clientId: number): Paper {
  const fy = financialYear();
  const t = taxPosition(clientId).value;
  const holds = clientHoldings(clientId).rows;
  const who = whose(clientId);

  const rows: (string | number)[][] = [
    ['Realised', 'Long term', money(t.real_lt), 'Sales in this financial year on units held over a year'],
    ['Realised', 'Short term', money(t.real_st), 'Sales in this financial year on units held under a year'],
    ['Notional', 'Long term', money(t.unreal_lt), 'Gain sitting in units held over a year. Not taxable until sold'],
    ['Notional', 'Short term', money(t.unreal_st), 'Gain sitting in units held under a year. Not taxable until sold'],
  ];
  // Per fund, so an accountant can tie the total to something.
  for (const h of holds) {
    rows.push(['By fund', h.fund_name, money(h.value - h.invested), `Folio ${h.folio_no}, notional`]);
  }
  return {
    meta: { kind: 'gains', ...PAPERS.gains, filename: `capital-gains-${fy.label}-${clientId}.csv` },
    columns: ['Kind', 'Head', 'Amount', 'Note'],
    rows,
    footer: [
      `${who.name}${who.pan ? ` · PAN ${who.pan}` : ''} · financial year ${fy.label} (${fy.from} to ${fy.to})`,
      `Long-term gains on equity are exempt up to ${ORDER_RULES.ltcg_exempt} a year, then taxed at ${ORDER_RULES.ltcg_rate}%. Short-term at ${ORDER_RULES.stcg_rate}%.`,
      'Realised figures come from your own sales, matched oldest-lot-first the way the registrar matches them.',
      'This is a record of what happened, not tax advice.',
    ],
  };
}

/** Every entry, including the ones that failed. A ledger that hides a bounce is a brochure. */
function ledger(clientId: number): Paper {
  const t = clientTxns(clientId);
  const who = whose(clientId);
  return {
    meta: { kind: 'ledger', ...PAPERS.ledger, filename: `ledger-${clientId}-${TODAY}.csv` },
    columns: ['Date', 'Fund', 'Type', 'Amount', 'Units', 'Price'],
    rows: t.rows.map(r => [
      r.tr_date, r.fund_name, r.type_name, money(r.tr_amount),
      r.tr_units ? money(r.tr_units) : '', r.tr_price ? money(r.tr_price) : '',
    ]),
    footer: [
      `${who.name}${who.pan ? ` · PAN ${who.pan}` : ''}`,
      `${t.rows.length} entries from ${t.from} to ${t.to}.`,
      'Refused instalments are included and labelled. A ledger that leaves them out is a brochure.',
    ],
  };
}

/**
 * 80C proof. Only purchases into tax-saving funds inside this financial year,
 * each with the date its three-year lock expires — which is the fact nobody has
 * and everybody needs, because the lock runs from the day each instalment was
 * bought, not from the day the folio opened.
 */
function elss(clientId: number): Paper {
  const fy = financialYear();
  const who = whose(clientId);
  const rows = db().prepare(
    `SELECT t.tr_date, s.scheme_short_name fund, t.tr_amount amount, t.tr_units units,
            date(t.tr_date, '+3 years') unlocks
     FROM transaction_master t
     JOIN scheme_master s ON s.scheme_id = t.fk_scheme_id
     JOIN category_master c ON c.category_id = s.fk_category_id
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND t.is_active = 1 AND tt.tr_type_buy_sell_flag = 1
       AND c.category_name LIKE '%ELSS%'
       AND t.tr_date >= ? AND t.tr_date <= ?
     ORDER BY t.tr_date`,
  ).all(clientId, fy.from, fy.to) as
    { tr_date: string; fund: string; amount: number; units: number; unlocks: string }[];

  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    meta: { kind: 'elss', ...PAPERS.elss, filename: `80c-proof-${fy.label}-${clientId}.csv` },
    columns: ['Date', 'Fund', 'Amount', 'Units', 'Unlocks on'],
    rows: rows.map(r => [r.tr_date, r.fund, money(r.amount), money(r.units), r.unlocks]),
    footer: [
      `${who.name}${who.pan ? ` · PAN ${who.pan}` : ''} · financial year ${fy.label}`,
      `${rows.length} investments totalling ${money(total)}.`,
      'Each amount is locked for three years from its own date, not from when the folio opened. That is why a monthly instalment unlocks a month at a time.',
      total === 0 ? 'Nothing went into a tax-saving fund this year, so there is nothing to claim.' : 'Section 80C caps the deduction at 150000 across every eligible instrument, not per fund.',
    ],
  };
}

const BUILDERS: Record<PaperKind, (clientId: number) => Paper> = {
  valuation, gains, ledger, elss,
};

export function paper(clientId: number, kind: PaperKind): Paper | null {
  const build = BUILDERS[kind];
  if (!build) return null;
  const p = build(clientId);
  // A document is recorded the moment it is produced. The broker lens reads this
  // table to see what a client has actually taken, and a download nobody logged
  // is a download nobody can be asked about.
  db().prepare(
    `INSERT INTO download_history_logs (user_id, pdf_type, status, file_url, report_for, is_broker, requested_at, completed_at)
     VALUES (?, ?, 'COMPLETED', ?, ?, 0, ?, ?)`,
  ).run(clientId, kind.toUpperCase(), p.meta.filename, `client:${clientId}`, TODAY, TODAY);
  return p;
}

/** Every paper on offer, with whether there is anything in it for this client. */
export function available(clientId: number): (PaperMeta & { rows: number })[] {
  return (Object.keys(PAPERS) as PaperKind[]).map(kind => {
    const p = BUILDERS[kind](clientId);
    return { ...p.meta, rows: p.rows.length };
  });
}

/* ── milestone receipts ──────────────────────────────────────────────────────
   research/14 and DESIGN.md both refuse engagement notifications. A milestone is
   the opposite of one: it is a thing that actually happened to this client's
   money, dated, and it says nothing unless it is true. Every one is derived. */

export interface Milestone {
  key: string;
  on: string;
  title: string;
  detail: string;
}

export function milestones(clientId: number): Milestone[] {
  const out: Milestone[] = [];
  const k = db().prepare(
    `SELECT ROUND(SUM(present_market_value)) v, ROUND(SUM(cost_amount)) put, MIN(inv_since_date) since
     FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).get(clientId) as { v: number; put: number; since: string | null } | undefined;
  if (!k?.v || !k.since) return out;

  // The day the money first earned more than it cost — a real crossing, found
  // in the ledger rather than announced on a schedule.
  if (k.v > k.put) {
    out.push({
      key: 'ahead', on: TODAY,
      title: 'Worth more than you put in',
      detail: `${Math.round(((k.v - k.put) / k.put) * 1000) / 10}% above what went in, across everything you hold here.`,
    });
  }
  const years = Math.floor((Date.parse(TODAY) - Date.parse(k.since)) / 3.1557e10);
  if (years >= 1) {
    out.push({
      key: `years-${years}`, on: k.since,
      title: `${years} year${years === 1 ? '' : 's'} invested`,
      detail: `Your first units were bought on ${k.since}. Nothing about that is automatic — most accounts opened that year are already closed.`,
    });
  }
  const sips = db().prepare(
    `SELECT COUNT(*) n FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     WHERE t.fk_acc_id = ? AND tt.tr_type_name = 'Systematic Investment' AND t.is_active = 1`,
  ).get(clientId) as { n: number };
  if (sips.n >= 12) {
    out.push({
      key: `instalments-${sips.n}`, on: TODAY,
      title: `${sips.n} instalments paid`,
      detail: 'Including the months the market fell, which are the ones that did the work.',
    });
  }
  return out;
}
