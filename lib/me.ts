import { db } from './db';
import type { Component, Lever } from './scoring';

// Queries that only the client lens needs. Everything the broker lens already
// computes — holdings, look-through, health, tax, SIPs — is imported from
// client360 / portfolio / scoring rather than restated here.

export interface Manager {
  sb_id: number;
  name: string;
  first: string;
  initials: string;
  since: string | null;
}

/** The named human on every page. A client without one is a bug, not an empty state. */
export function manager(clientId: number): Manager | null {
  const r = db().prepare(
    `SELECT sb.sb_id, sb.sb_holder_name name, sb.sb_doj since
     FROM client_master c JOIN sub_broker_master sb ON sb.sb_id = c.fk_primary_sub_broker_id
     WHERE c.cm_user_id = ?`,
  ).get(clientId) as { sb_id: number; name: string; since: string | null } | undefined;
  if (!r) return null;
  const parts = r.name.split(' ');
  return {
    sb_id: r.sb_id,
    name: r.name,
    first: parts[0],
    initials: parts.map(w => w[0]).slice(0, 2).join(''),
    since: r.since,
  };
}

export interface Raised {
  action_id: number;
  action_type: string;
  label: string;
  created_at: string;
  sla_due: string;
  state: string;
}

/** What the client has asked for and where it has got to — the Desk's spine. */
export function raisedByMe(clientId: number): Raised[] {
  return db().prepare(
    `SELECT action_id, action_type, COALESCE(suggested_step,'') label, created_at, sla_due, state
     FROM actions
     WHERE subject_type='client' AND subject_id=? AND created_from='client_app'
     ORDER BY created_at DESC, action_id DESC`,
  ).all(String(clientId)) as Raised[];
}


/* ── What a client can actually be asked to do ───────────────────────────────
   The health model finds weaknesses at stock level — sector weight, top-ten
   concentration, overlap. Those are correct as *diagnosis* and useless as
   *instruction*: a mutual-fund investor cannot trade a stock, and 138 companies
   is already diversified. So a lever only reaches the client if it maps to
   something they can authorise on a fund. Everything else stays as the reason
   behind the score, which is where it belongs.

   Shape borrowed from two places in research/14: Scripbox publishes its rubric
   AND its action bands, turning a verdict into a treatment plan over review
   cycles (§11.2); smallcase makes the act a proposal the client approves in one
   tap, with the rationale attached and logged (§11.5). Between them they answer
   the category's biggest gap — "diagnosis without delivery" (§12.2). */

export interface ClientAct {
  /** What the client is actually approving, in their words. */
  verb: string;
  /** Does anything get sold? Selling needs the tax printed first. */
  sells: boolean;
  /** Which surface carries it out. */
  route: 'fund' | 'sip' | 'tax' | 'talk';
}

export const CLIENT_ACTS: Record<string, ClientAct> = {
  fix_sip: { verb: 'Re-authorise the bank mandate', sells: false, route: 'sip' },
  start_sip: { verb: 'Start a monthly instalment on the idle money', sells: false, route: 'sip' },
  cut_overlap: { verb: 'Point new money at a genuinely different kind of fund', sells: false, route: 'sip' },
  switch_laggard: { verb: 'Switch this fund for a same-category house pick', sells: true, route: 'fund' },
  harvest: { verb: 'Realise the gain that is inside this year’s exemption', sells: true, route: 'tax' },
  reengage: { verb: 'Book the review', sells: false, route: 'talk' },
  review_profile: { verb: 'Revisit what risk you actually want', sells: false, route: 'talk' },
};

export interface Plan {
  /** Acts the client can authorise, biggest gain first. */
  acts: (Lever & { act: ClientAct; area: string })[];
  /** Findings that explain the score but are not instructions. */
  reasons: { area: string; text: string }[];
  /** Scripbox's framing: a portfolio is repaired over review cycles, not in one afternoon. */
  cycles: number;
}

/**
 * Split the health model's levers into what a client can approve and what merely
 * explains the score. Two acts per review cycle — the pace an RM can actually
 * carry a family through, and the pace at which a client will say yes.
 */
export function plan(components: Component[]): Plan {
  const acts: Plan['acts'] = [];
  const reasons: Plan['reasons'] = [];
  for (const c of components) {
    for (const l of c.levers) {
      if (l.kind === 'hygiene') continue;
      const act = CLIENT_ACTS[l.key];
      if (act) acts.push({ ...l, act, area: c.label });
      else reasons.push({ area: c.label, text: l.label });
    }
    for (const ch of c.challenges) reasons.push({ area: c.label, text: ch });
  }
  acts.sort((a, b) => b.delta - a.delta);
  return { acts, reasons, cycles: Math.max(1, Math.ceil(acts.length / 2)) };
}

export interface FundMeta {
  scheme_id: number; name: string; short: string; category: string; asset: string;
  amc: string; risk: string; expense: number; exit_load: number; pick: number;
  nav: number; nav_date: string; benchmark: string | null;
}

/** Everything a client needs printed on a fund's own page. */
export function fundMeta(schemeId: number): FundMeta | null {
  return db().prepare(
    `SELECT sm.scheme_id, sm.scheme_full_name name, sm.scheme_short_name short,
            cm.category_name category, am.main_asset_name asset, amc.amc_name amc,
            sm.risk_level risk, sm.scheme_expense_ratio expense, sm.scheme_exit_load exit_load,
            sm.is_jhaveri_pick pick, sm.scheme_day_end_nav nav, sm.scheme_day_end_nav_date nav_date,
            bm.benchmark_name benchmark
     FROM scheme_master sm
     JOIN category_master cm ON cm.category_id = sm.fk_category_id
     LEFT JOIN main_asset_master am ON am.id = cm.fk_main_asset_id
     JOIN amc_master amc ON amc.amc_id = sm.fk_amc_id
     LEFT JOIN benchmark_master bm ON bm.benchmark_id = sm.fk_benchmark_id
     WHERE sm.scheme_id = ?`,
  ).get(schemeId) as FundMeta | null;
}

/* ── Drilling back ───────────────────────────────────────────────────────────
   An exposure is only honest if you can get from it to the funds that caused it.
   lookThrough() counts how many funds hold a stock; these name them. */

export interface ViaFund { scheme_id: number; fund: string; weight_pct: number; rupees: number }

/** One company: which of the client's funds hold it, and how many rupees through each. */
export function stockVia(clientId: number, stock: string): { sector: string | null; cap: string | null; total: number; via: ViaFund[] } {
  const via = db().prepare(
    `SELECT f.scheme_id, sm.scheme_short_name fund, h.weight_pct,
            ROUND(h.weight_pct / 100.0 * f.present_market_value) rupees
     FROM fifo_summary_holding_active f
     JOIN mf_scheme_holdings h ON h.fk_scheme_id = f.scheme_id
     JOIN stock_master s ON s.stock_id = h.stock_id
     JOIN scheme_master sm ON sm.scheme_id = f.scheme_id
     WHERE f.client_id = ? AND s.stock_name = ?
     ORDER BY rupees DESC`,
  ).all(clientId, stock) as ViaFund[];
  const meta = db().prepare(
    `SELECT sector, cap_band cap FROM stock_master WHERE stock_name = ?`,
  ).get(stock) as { sector: string | null; cap: string | null } | undefined;
  return {
    sector: meta?.sector ?? null,
    cap: meta?.cap ?? null,
    total: via.reduce((s, v) => s + v.rupees, 0),
    via,
  };
}

export interface SectorStock { stock: string; cap: string | null; rupees: number; funds: number }

/** One sector: the companies inside it, in the client's own rupees. */
export function sectorStocks(clientId: number, sector: string): SectorStock[] {
  return db().prepare(
    `SELECT s.stock_name stock, s.cap_band cap,
            ROUND(SUM(h.weight_pct / 100.0 * f.present_market_value)) rupees,
            COUNT(DISTINCT f.scheme_id) funds
     FROM fifo_summary_holding_active f
     JOIN mf_scheme_holdings h ON h.fk_scheme_id = f.scheme_id
     JOIN stock_master s ON s.stock_id = h.stock_id
     WHERE f.client_id = ? AND s.sector = ?
     GROUP BY s.stock_id ORDER BY rupees DESC`,
  ).all(clientId, sector) as SectorStock[];
}
