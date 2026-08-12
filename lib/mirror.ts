import { db } from './db';
import { TODAY } from '../mockdb/engines';
import { inr, inrCompact, dmy } from './format';

/* ── The Mirror ──────────────────────────────────────────────────────────────
   What the client did, and what it did to them. Every entry is generated from
   their own transaction history by a rule that runs for any client — no entry is
   written by hand, and a client whose history does not trigger a rule simply has
   fewer entries. Rules, in order: patience · instalment discipline · every exit ·
   missed instalments · a step-up counterfactual · the largest single decision. */

export interface MirrorEntry {
  key: string;
  when: string;
  deed: string;
  figure: string;
  caption: string;
  verdict: string;
  good: boolean;
  /** Present when the entry has something to do about it. */
  act?: { kind: string; label: string };
  /** Present when the client can say "this was planned" and retire the entry. */
  strikeable?: boolean;
}

interface Move {
  d: string; sid: number; typ: string; flag: number; amt: number; units: number; px: number; fund: string;
}

function moves(clientId: number): Move[] {
  return db().prepare(
    `SELECT t.tr_date d, t.fk_scheme_id sid, tt.tr_type_name typ, tt.tr_type_buy_sell_flag flag,
            t.tr_amount amt, t.tr_units units, t.tr_price px, sm.scheme_short_name fund
     FROM transaction_master t
     JOIN transaction_type_master tt ON tt.tr_type_id = t.fk_tran_type_id
     JOIN scheme_master sm ON sm.scheme_id = t.fk_scheme_id
     WHERE t.fk_acc_id = ? AND t.is_active = 1 AND t.tr_date <= ?
     ORDER BY t.tr_date, t.tr_id`,
  ).all(clientId, TODAY) as Move[];
}

function navNow(clientId: number): Map<number, number> {
  const rows = db().prepare(
    `SELECT scheme_id sid, nav FROM fifo_summary_holding_active WHERE client_id = ?`,
  ).all(clientId) as { sid: number; nav: number }[];
  return new Map(rows.map(r => [r.sid, r.nav]));
}

/** Month-end worth vs money in, from the client's own transactions and real NAVs. */
function monthlyWorth(clientId: number): { d: string; worth: number; put: number }[] {
  const all = moves(clientId);
  if (!all.length) return [];
  const dates = (db().prepare(
    `SELECT DISTINCT price_date d FROM mf_historical_price_master WHERE price_date >= ? AND price_date <= ? ORDER BY d`,
  ).all(all[0].d, TODAY) as { d: string }[]).map(r => r.d);
  const px = db().prepare(`SELECT price FROM mf_historical_price_master WHERE fk_scheme_id=? AND price_date=?`);
  const out: { d: string; worth: number; put: number }[] = [];
  for (const d of dates) {
    const units = new Map<number, number>();
    let put = 0;
    for (const m of all) {
      if (m.d > d) break;
      units.set(m.sid, (units.get(m.sid) ?? 0) + m.units * m.flag);
      put += m.amt * m.flag;
    }
    let worth = 0, priced = true;
    for (const [sid, u] of units) {
      const r = px.get(sid, d) as { price: number } | undefined;
      if (!r) { priced = false; break; }        // never half-price a total
      worth += u * r.price;
    }
    if (priced) out.push({ d, worth: Math.round(worth), put: Math.round(put) });
  }
  return out;
}

/** Everything the rules need, gathered once. */
interface Ctx {
  all: Move[]; nav: Map<number, number>; arc: { d: string; worth: number; put: number }[];
  sipTx: Move[]; clientId: number;
}
const money = (n: number) => inr(Math.abs(n));
const monthsBetween = (from: string) => Math.round((Date.parse(TODAY) - Date.parse(from)) / 2.63e9);
const pricedNow = (c: Ctx, m: Move) => (c.nav.get(m.sid) ?? m.px) * m.units;

/** Rule 1 — what staying put was worth, and what it had to sit through. */
function rulePatience(c: Ctx): MirrorEntry | null {
  if (c.arc.length < 2) return null;
  const last = c.arc[c.arc.length - 1];
  const earned = last.worth - last.put;
  let worst = 0, worstAt = '', falls = 0;
  for (let i = 1; i < c.arc.length; i++) {
    const dp = (c.arc[i].worth - c.arc[i - 1].worth) / Math.max(1, c.arc[i - 1].worth) * 100;
    if (dp < 0) falls++;
    if (dp < worst) { worst = dp; worstAt = c.arc[i].d; }
  }
  return {
    key: 'patience', when: `${dmy(c.all[0].d)} → today`, good: earned >= 0,
    deed: `You stayed${worstAt ? `. Through every dip, including ${dmy(worstAt).slice(3)}'s ${worst.toFixed(1)}%` : ''}.`,
    figure: `${earned >= 0 ? '+' : '−'}${money(earned)}`, caption: 'earned by staying put',
    verdict: `The hardest thing in investing is nothing, and you did it for ${monthsBetween(c.all[0].d)} months. ${falls} of them fell, and not one rupee left in fear.`,
  };
}

/** Rule 2 — buying every month, measured against the index on the same dates. */
function ruleInstalments(c: Ctx): MirrorEntry | null {
  if (c.sipTx.length < 6) return null;
  const sid = c.sipTx[c.sipTx.length - 1].sid;
  const mine = c.sipTx.filter(m => m.sid === sid);
  const cheap = Math.min(...mine.map(m => m.px)), dear = Math.max(...mine.map(m => m.px));
  const h = db().prepare(`SELECT f.xirr, sh.sh_bmxirr bm FROM fifo_summary_holding_active f
    LEFT JOIN fifo_summary_holding sh ON sh.fk_acc_id=f.client_id AND sh.fk_scheme_id=f.scheme_id
    WHERE f.client_id=? AND f.scheme_id=?`).get(c.clientId, sid) as { xirr: number | null; bm: number | null } | undefined;
  return {
    key: 'instalments', when: `${mine.length} instalments`, good: (h?.xirr ?? 0) >= (h?.bm ?? 0),
    deed: 'You bought every month, including the months that hurt.',
    figure: h?.xirr != null && h?.bm != null ? `${h.xirr}% vs ${h.bm}%` : `${mine.length} months`,
    caption: h?.bm != null ? 'you, against the index on your dates' : 'never a month skipped',
    verdict: `Cheap months bought more units and the recovery paid them best. The same ${inr(mine[0].amt)} bought ${(mine[0].amt / cheap).toFixed(0)} units at your best price and ${(mine[0].amt / dear).toFixed(0)} at your worst — the average did the work.`,
  };
}

/** Rule 3 — every exit, priced to this morning. */
function ruleExits(c: Ctx): MirrorEntry[] {
  return c.all.filter(m => m.flag === -1).map(m => {
    const now = pricedNow(c, m), diff = now - m.amt;
    return {
      key: `exit-${m.d}`, when: dmy(m.d), good: diff <= 0, strikeable: true,
      deed: `You withdrew ${inr(m.amt)} from ${m.fund}.`,
      figure: `${diff > 0 ? '−' : '+'}${money(diff)}`, caption: "the exit's cost, so far",
      verdict: `Those ${m.units.toFixed(3)} units would be worth ${inr(now)} this morning. Printed not to scold — the habit is what compounds, in either column.`,
    };
  });
}

/** Rule 4 — instalments the bank refused, and what they would have bought. */
function ruleMissed(c: Ctx): MirrorEntry | null {
  const instalments = c.all.filter(m => /Systematic Investment|SIP Rejection/.test(m.typ));
  let consec = 0;
  for (let i = instalments.length - 1; i >= 0 && instalments[i].typ === 'SIP Rejection'; i--) consec++;
  if (!consec) return null;
  const missed = instalments.filter(m => m.typ === 'SIP Rejection').slice(-consec);
  const wouldBe = missed.reduce((s, m) => s + (m.amt / m.px) * (c.nav.get(m.sid) ?? m.px), 0);
  const idle = missed.reduce((s, m) => s + m.amt, 0);
  return {
    key: 'missed', when: missed.map(m => dmy(m.d).slice(3, 6)).join(' · '), good: false,
    deed: `${consec} instalment${consec > 1 ? 's' : ''} missed — a mandate quietly expiring.`,
    figure: inr(idle), caption: 'standing idle',
    verdict: `Not a decision, an expiry. Collected, they would stand at ${inr(wouldBe)} today. The right-hand column does not know the difference, and it is charging you anyway.`,
    act: { kind: 'fix_mandate', label: 'Renew it — restart the streak' },
  };
}

/** Rule 5 — the step-up not made, replayed on the client's own prices. */
function ruleStepUp(c: Ctx): MirrorEntry | null {
  if (c.sipTx.length < 6) return null;
  const step = 5000, sid = c.sipTx[c.sipTx.length - 1].sid;
  const mine = c.sipTx.filter(m => m.sid === sid);
  let units = 0, put = 0;
  for (const m of mine) { units += step / m.px; put += step; }
  const would = units * (c.nav.get(sid) ?? mine[mine.length - 1].px);
  return {
    key: 'stepup', when: 'A page from tomorrow', good: true,
    deed: `Had you added ${inr(step)} a month from the first instalment —`,
    figure: `+${money(would - put)}`, caption: 'more, by this morning',
    verdict: `Replayed on your own fund's true prices: ${inrCompact(put)} more in would stand at ${inrCompact(would)}. History, not a promise; consistency, not timing.`,
    act: { kind: 'step_up', label: "Put it on your manager's desk" },
  };
}

/** Rule 6 — the largest single decision, and where it stands. */
function ruleLump(c: Ctx): MirrorEntry | null {
  const sipAmt = c.sipTx[0]?.amt ?? 0;
  const lumps = c.all.filter(m => m.flag === 1 && /Purchase/.test(m.typ) && m.amt >= 2 * Math.max(sipAmt, 1));
  if (!lumps.length) return null;
  const big = lumps.reduce((a, b) => (a.amt > b.amt ? a : b));
  const now = pricedNow(c, big);
  return {
    key: 'lump', when: dmy(big.d), good: now >= big.amt,
    deed: `You put ${inr(big.amt)} in at once — your largest single decision.`,
    figure: `${now >= big.amt ? '+' : '−'}${money(now - big.amt)}`, caption: 'since that day',
    verdict: `Bought at ₹${big.px.toFixed(2)}; ₹${(c.nav.get(big.sid) ?? big.px).toFixed(2)} this morning — ${((now / big.amt - 1) * 100).toFixed(1)}% in ${monthsBetween(big.d)} months. Courage, dated and priced.`,
  };
}

export function mirror(clientId: number): MirrorEntry[] {
  const all = moves(clientId);
  if (!all.length) return [];
  const c: Ctx = {
    clientId, all, nav: navNow(clientId), arc: monthlyWorth(clientId),
    sipTx: all.filter(m => m.typ === 'Systematic Investment'),
  };
  return [rulePatience(c), ruleInstalments(c), ...ruleExits(c), ruleMissed(c), ruleStepUp(c), ruleLump(c)]
    .filter((e): e is MirrorEntry => e !== null);
}

