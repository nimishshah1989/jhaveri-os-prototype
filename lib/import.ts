import type BetterSqlite3 from 'better-sqlite3';
import { db } from './db';
import { TODAY } from '../mockdb/engines';

/* ── MF Central / CAS ────────────────────────────────────────────────────────
   Phase 2. A client's money is not the part of it we happen to manage, and an
   app that shows only the advised half is a statement rather than a picture.

   `fetchCas` is the seam. In the live build it is an authenticated call to MF
   Central against a PAN, returning every folio the two RTAs hold for that
   person. Here it returns the same shape, derived deterministically from the
   PAN, so a verifier can fetch twice and get the same answer — which is the
   only way to test that a re-import does not double somebody's net worth.

   Two rules the rest of this file exists to keep:

   1. ONE PRICE. A held-away row stores units, not rupees. Value is units times
      the same `mf_latest_price_master` NAV the advised book uses. The two halves
      of a net worth cannot disagree about what a fund is worth.
   2. ONE DENOMINATOR. Held-away money never enters a Jhaveri figure. Every
      total that mixes them is returned as three numbers — with us, elsewhere,
      and everything — and the page prints the label with the figure.          */

export interface CasRow {
  folio_no: string;
  scheme_name: string;
  amc_name: string;
  /** The code the RTA sends. How a row becomes a scheme we can price. */
  amfi_code: string | null;
  units: number;
  cost_amount: number;
  rta: 'CAMS' | 'KFintech';
}

/** Stable hash of a PAN. The live call is keyed on the PAN too; so is this. */
function panSeed(pan: string): number {
  let h = 2166136261;
  for (const ch of pan.toUpperCase()) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * What MF Central returns for this PAN.
 *
 * ponytail: deterministic from the PAN rather than random, and reading the
 * scheme register for names and codes rather than inventing them — a held-away
 * fund has to be a fund that exists, or the consolidation act has nothing to
 * consolidate. Replace the body with the HTTP call and nothing above it changes.
 */
export function fetchCas(pan: string, conn: BetterSqlite3.Database = db()): CasRow[] {
  const owner = conn.prepare(`SELECT cm_user_id id FROM client_master WHERE cm_pan_no = ?`)
    .get(pan) as { id: number } | undefined;

  // Schemes this person does NOT already hold with us. Held-away means elsewhere.
  const candidates = conn.prepare(
    `SELECT s.scheme_id, s.scheme_full_name name, s.scheme_amfi_code amfi, a.amc_name amc,
            s.scheme_rta rta, p.price nav
     FROM scheme_master s
     JOIN amc_master a ON a.amc_id = s.fk_amc_id
     JOIN mf_latest_price_master p ON p.fk_scheme_id = s.scheme_id
     WHERE s.scheme_id NOT IN (SELECT scheme_id FROM fifo_summary_holding_active WHERE client_id = ?)
     ORDER BY s.scheme_id`,
  ).all(owner?.id ?? -1) as { scheme_id: number; name: string; amfi: string; amc: string; rta: string; nav: number }[];
  if (!candidates.length) return [];

  const seed = panSeed(pan);
  // Most people have a couple of old folios; some have none at all, and that
  // path has to render an empty state rather than a zero.
  const count = seed % 7 === 0 ? 0 : 2 + (seed % 3);
  const rows: CasRow[] = [];
  const taken = new Set<number>();

  for (let i = 0; i < count; i++) {
    const idx = (seed >>> (i * 3)) % candidates.length;
    let at = idx;
    while (taken.has(at)) at = (at + 1) % candidates.length;
    taken.add(at);
    const c = candidates[at];
    // Sized on a rupee amount and divided by the fund's real NAV, rather than a
    // unit count picked out of the air: NAVs here span ₹10 to ₹300, so a fixed
    // unit range produces folios worth ₹400 and folios worth ₹3 lakh at random.
    // A held-away book has to be the size a held-away book actually is, or the
    // consolidated picture is unjudgeable.
    const target = 120000 + ((seed >>> (i * 5)) % 530000);
    const units = Math.round((target / c.nav) * 1000) / 1000;
    rows.push({
      folio_no: `${9000000 + ((seed + i * 7919) % 900000)}`,
      scheme_name: c.name,
      amc_name: c.amc,
      amfi_code: c.amfi,
      units,
      // What they paid is the RTA's figure, not ours — it is the one number in a
      // CAS we cannot re-derive, because we never saw the transactions. Set below
      // today's value on most folios and above it on some, the way a real book is.
      cost_amount: Math.round(target * (0.72 + ((seed >>> (i * 4)) % 55) / 100)),
      rta: c.rta === 'C' ? 'CAMS' : 'KFintech',
    });
  }

  // One folio from a house we do not distribute, for anyone with any at all.
  // It is not decoration: an unmatched row is the common case in a real CAS, and
  // it is the row that proves the app counts what it cannot price instead of
  // quietly valuing it at nothing.
  if (rows.length) {
    rows.push({
      folio_no: `${8100000 + (seed % 90000)}`,
      scheme_name: 'Quantum Long Term Equity Value Fund - Direct Growth',
      amc_name: 'Quantum Asset Management',
      amfi_code: null,
      units: Math.round((((seed >>> 11) % 40000) / 100 + 20) * 1000) / 1000,
      cost_amount: Math.round(90000 + ((seed >>> 13) % 260000)),
      rta: 'KFintech',
    });
  }
  return rows;
}

export interface ImportResult {
  /** Rows in the table before and after. Logged, per the data-engineering rule. */
  before: number;
  after: number;
  fetched: number;
  inserted: number;
  updated: number;
  /** Rows whose scheme we do not distribute, and therefore cannot price. */
  unmatched: number;
  run_id: number;
}

/**
 * Fetch and land one client's held-away folios.
 *
 * Idempotent on the natural key (PAN + folio + scheme), because a CAS is
 * re-fetched every month and the second import must not double a net worth.
 */
export function importHeldAway(clientId: number, conn: BetterSqlite3.Database = db()): ImportResult {
  const who = conn.prepare(`SELECT cm_pan_no pan FROM client_master WHERE cm_user_id = ?`)
    .get(clientId) as { pan: string } | undefined;
  const before = (conn.prepare(`SELECT COUNT(*) n FROM heldaway_folios`).get() as { n: number }).n;
  if (!who?.pan) {
    return { before, after: before, fetched: 0, inserted: 0, updated: 0, unmatched: 0, run_id: 0 };
  }

  const rows = fetchCas(who.pan, conn);
  const match = conn.prepare(`SELECT scheme_id FROM scheme_master WHERE scheme_amfi_code = ?`);
  const put = conn.prepare(
    `INSERT INTO heldaway_folios
       (pan_no, client_id, folio_no, fk_scheme_id, scheme_name, amc_name, amfi_code,
        units, cost_amount, rta, first_seen, as_of, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'mfcentral')
     ON CONFLICT (pan_no, folio_no, scheme_name) DO UPDATE SET
       units = excluded.units, cost_amount = excluded.cost_amount,
       fk_scheme_id = excluded.fk_scheme_id, as_of = excluded.as_of`,
  );

  let inserted = 0, updated = 0, unmatched = 0;
  for (const r of rows) {
    const sid = r.amfi_code
      ? (match.get(r.amfi_code) as { scheme_id: number } | undefined)?.scheme_id ?? null
      : null;
    if (sid == null) unmatched++;
    const existed = (conn.prepare(
      `SELECT COUNT(*) n FROM heldaway_folios WHERE pan_no = ? AND folio_no = ? AND scheme_name = ?`,
    ).get(who.pan, r.folio_no, r.scheme_name) as { n: number }).n;
    put.run(who.pan, clientId, r.folio_no, sid, r.scheme_name, r.amc_name, r.amfi_code,
      r.units, r.cost_amount, r.rta, TODAY, TODAY);
    if (existed) updated++; else inserted++;
  }

  const after = (conn.prepare(`SELECT COUNT(*) n FROM heldaway_folios`).get() as { n: number }).n;
  const run = conn.prepare(
    `INSERT INTO import_runs (source, window_from, window_to, state, started_at, finished_at, row_counts)
     VALUES ('mfcentral', ?, ?, 'promoted', ?, ?, ?)`,
  ).run(TODAY, TODAY, TODAY, TODAY,
    JSON.stringify({ before, fetched: rows.length, inserted, updated, unmatched, after }));

  return { before, after, fetched: rows.length, inserted, updated, unmatched, run_id: Number(run.lastInsertRowid) };
}

/* ── reading it back ─────────────────────────────────────────────────────────── */

export interface HeldAway {
  ha_id: number;
  folio_no: string;
  scheme_name: string;
  amc_name: string;
  scheme_id: number | null;
  units: number;
  cost_amount: number | null;
  /** Units × the same NAV the advised book uses. Null when we cannot price it. */
  value: number | null;
  nav: number | null;
  nav_date: string | null;
  rta: string | null;
  as_of: string;
  /** True when this scheme is also held with Jhaveri — the consolidation case. */
  also_with_us: boolean;
}

export function heldAway(clientId: number): HeldAway[] {
  return db().prepare(
    `SELECT h.ha_id, h.folio_no, h.scheme_name, h.amc_name, h.fk_scheme_id scheme_id,
            h.units, h.cost_amount, h.rta, h.as_of,
            p.price nav, p.price_date nav_date,
            ROUND(h.units * p.price) value,
            EXISTS (SELECT 1 FROM fifo_summary_holding_active f
                    WHERE f.client_id = h.client_id AND f.scheme_id = h.fk_scheme_id) also_with_us
     FROM heldaway_folios h
     LEFT JOIN mf_latest_price_master p ON p.fk_scheme_id = h.fk_scheme_id
     WHERE h.client_id = ?
     ORDER BY value DESC NULLS LAST, h.scheme_name`,
  ).all(clientId) as HeldAway[];
}

export interface NetWorth {
  /** The advised book. The figure every other page in this app already prints. */
  with_us: number;
  /** Everything else, priced on the same NAVs. */
  elsewhere: number;
  /** The sum. Never shown without both halves beside it. */
  everything: number;
  /** Folios found but not priceable, counted rather than valued at zero. */
  unpriced: number;
  folios: number;
  as_of: string | null;
}

/**
 * The two figures, and their sum. Returned together so a page physically cannot
 * print the blended number without the labelled halves that make it honest.
 */
export function netWorth(clientId: number): NetWorth {
  const us = (db().prepare(
    `SELECT COALESCE(ROUND(SUM(present_market_value)), 0) v FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).get(clientId) as { v: number }).v;
  const rows = heldAway(clientId);
  const elsewhere = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  return {
    with_us: us,
    elsewhere,
    everything: us + elsewhere,
    unpriced: rows.filter(r => r.value == null).length,
    folios: rows.length,
    as_of: rows[0]?.as_of ?? null,
  };
}

/** The last time this client's CAS was pulled, for the stamp on the page. */
export function lastImport(): { at: string; counts: Record<string, number> } | null {
  const r = db().prepare(
    `SELECT finished_at at, row_counts FROM import_runs WHERE source = 'mfcentral'
     ORDER BY run_id DESC LIMIT 1`,
  ).get() as { at: string; row_counts: string } | undefined;
  if (!r) return null;
  try { return { at: r.at, counts: JSON.parse(r.row_counts) }; } catch { return { at: r.at, counts: {} }; }
}
