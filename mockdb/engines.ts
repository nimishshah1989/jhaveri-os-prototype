// Deterministic engines for the seed database. No Date.now(), no Math.random() —
// same seed in, same database out, every run.

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export type Rand = ReturnType<typeof rng>;

export const pick = <T>(r: Rand, arr: T[]): T => arr[Math.floor(r() * arr.length)];
export const between = (r: Rand, lo: number, hi: number) => lo + r() * (hi - lo);
export const intBetween = (r: Rand, lo: number, hi: number) => Math.floor(between(r, lo, hi + 1));
export const chance = (r: Rand, p: number) => r() < p;
export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export const TODAY = '2026-08-07'; // seed epoch — the prototype's "today"
const MS_DAY = 86400000;
export const toISO = (d: Date) => d.toISOString().slice(0, 10);
export const parse = (iso: string) => new Date(iso + 'T00:00:00Z');
export const addDays = (iso: string, days: number) => toISO(new Date(parse(iso).getTime() + days * MS_DAY));
export const daysBetween = (a: string, b: string) =>
  Math.round((parse(b).getTime() - parse(a).getTime()) / MS_DAY);
export const monthStart = (iso: string) => iso.slice(0, 7) + '-01';

export interface NavSeries { dates: string[]; navs: number[] }

export function makeNavSeries(r: Rand, startNav: number, months: number, annualDrift: number, annualVol: number, endDate: string): NavSeries {
  const dates: string[] = [];
  const navs: number[] = [];
  let nav = startNav;
  const mDrift = annualDrift / 12;
  const mVol = annualVol / Math.sqrt(12);
  for (let i = months - 1; i >= 0; i--) {
    // walk backwards from a forward pass: generate forward then assign dates backwards
    dates.push(addDays(endDate, -Math.round((i * 365.25) / 12)));
  }
  for (let i = 0; i < months; i++) {
    navs.push(round4(nav));
    const shock = (r() + r() + r() - 1.5) * 2; // ~N(0,1)-ish, bounded
    nav = nav * (1 + mDrift + mVol * shock);
    if (nav < startNav * 0.35) nav = startNav * 0.35;
  }
  return { dates, navs };
}

export function navAt(s: NavSeries, iso: string): number {
  const t = parse(iso).getTime();
  if (t <= parse(s.dates[0]).getTime()) return s.navs[0];
  const last = s.dates.length - 1;
  if (t >= parse(s.dates[last]).getTime()) return s.navs[last];
  for (let i = 1; i <= last; i++) {
    const t1 = parse(s.dates[i]).getTime();
    if (t <= t1) {
      const t0 = parse(s.dates[i - 1]).getTime();
      const f = (t - t0) / (t1 - t0);
      return round4(s.navs[i - 1] + f * (s.navs[i] - s.navs[i - 1]));
    }
  }
  return s.navs[last];
}

export function xirr(flows: { date: string; amount: number }[]): number | null {
  if (flows.length < 2) return null;
  const t0 = parse(flows[0].date).getTime();
  const yrs = flows.map(f => (parse(f.date).getTime() - t0) / (365.25 * MS_DAY));
  const amounts = flows.map(f => f.amount);
  const hasNeg = amounts.some(a => a < 0), hasPos = amounts.some(a => a > 0);
  if (!hasNeg || !hasPos) return null;
  const npv = (rate: number) => amounts.reduce((s, a, i) => s + a / Math.pow(1 + rate, yrs[i]), 0);
  let rate = 0.1;
  for (let i = 0; i < 50; i++) {
    const f = npv(rate);
    const h = 1e-6;
    const d = (npv(rate + h) - f) / h;
    if (Math.abs(d) < 1e-12) break;
    const next = rate - f / d;
    if (!isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - rate) < 1e-9) return round4(next);
    rate = next;
  }
  // bisection fallback on [-0.95, 10]
  let lo = -0.95, hi = 10;
  let fLo = npv(lo);
  if (fLo * npv(hi) > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return round4(mid);
    if (fLo * fMid < 0) hi = mid; else { lo = mid; fLo = fMid; }
  }
  return round4((lo + hi) / 2);
}

export interface Txn {
  trId: number; date: string; units: number; price: number; amount: number;
  buySell: 1 | -1; bosCode: string;
}
export interface Lot {
  purchaseTrId: number; date: string; units: number; balance: number; price: number; bosCode: string;
}
export interface SaleMatch {
  lotIndex: number; sellTrId: number; date: string; units: number; sellPrice: number;
  holdingDays: number; bosCode: string;
}
export interface FifoResult {
  lots: Lot[]; sales: SaleMatch[];
  realizedST: number; realizedLT: number;
  balanceUnits: number; investedRemaining: number;
}

/** Process one folio×scheme's transactions in date order. ltThresholdDays: 365 equity, 1095 debt. */
export function runFifo(txns: Txn[], ltThresholdDays: number): FifoResult {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date) || a.trId - b.trId);
  const lots: Lot[] = [];
  const sales: SaleMatch[] = [];
  let realizedST = 0, realizedLT = 0;
  for (const t of sorted) {
    if (t.buySell === 1) {
      lots.push({ purchaseTrId: t.trId, date: t.date, units: t.units, balance: t.units, price: t.price, bosCode: t.bosCode });
    } else {
      let toSell = t.units;
      for (let i = 0; i < lots.length && toSell > 1e-6; i++) {
        const lot = lots[i];
        if (lot.balance <= 1e-6) continue;
        const consumed = Math.min(lot.balance, toSell);
        lot.balance = round4(lot.balance - consumed);
        toSell = round4(toSell - consumed);
        const hd = daysBetween(lot.date, t.date);
        const gain = consumed * (t.price - lot.price);
        if (hd >= ltThresholdDays) realizedLT += gain; else realizedST += gain;
        sales.push({ lotIndex: i, sellTrId: t.trId, date: t.date, units: consumed, sellPrice: t.price, holdingDays: hd, bosCode: t.bosCode });
      }
    }
  }
  const balanceUnits = round4(lots.reduce((s, l) => s + l.balance, 0));
  const investedRemaining = round2(lots.reduce((s, l) => s + l.balance * l.price, 0));
  return { lots, sales, realizedST: round2(realizedST), realizedLT: round2(realizedLT), balanceUnits, investedRemaining };
}

/** Unrealized ST/LT split of open lots at a valuation date/price. */
export function unrealizedSplit(lots: Lot[], valDate: string, valPrice: number, ltThresholdDays: number) {
  let st = 0, lt = 0;
  for (const l of lots) {
    if (l.balance <= 1e-6) continue;
    const gain = l.balance * (valPrice - l.price);
    if (daysBetween(l.date, valDate) >= ltThresholdDays) lt += gain; else st += gain;
  }
  return { unrealizedST: round2(st), unrealizedLT: round2(lt) };
}

export function inr(n: number): string {
  const neg = n < 0; const s = Math.abs(Math.round(n)).toString();
  const head = s.length > 3 ? s.slice(0, -3) : '';
  const tail = s.slice(-3);
  const grouped = head ? head.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + tail : tail;
  return (neg ? '-₹' : '₹') + grouped;
}
