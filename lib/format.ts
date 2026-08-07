const inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function inr(n: number): string {
  return `₹${inrFmt.format(Math.round(n))}`;
}

export function inrCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}${inr(abs)}`;
}

export function signedInrCompact(n: number): string {
  return n >= 0 ? `+${inrCompact(n)}` : inrCompact(n);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
}

// Table variant: 2-digit year saves column width (founder rule).
export function dmy2(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MONTHS[Number(m) - 1]}-${y.slice(2)}`;
}
