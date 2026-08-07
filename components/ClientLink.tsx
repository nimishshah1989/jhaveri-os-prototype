import Link from 'next/link';

// One place decides how a client's name is rendered, so a name is never a dead
// end anywhere in the product. If a client id is missing (a lead who is not a
// client yet), it degrades to plain text rather than a broken link.
export function ClientLink({ id, name, muted }: { id?: number | null; name: string; muted?: boolean }) {
  if (!id) return <span className={muted ? 'd' : undefined}>{name}</span>;
  return <Link href={`/clients/${id}`} className={muted ? 'lnk muted' : 'lnk'}>{name}</Link>;
}
