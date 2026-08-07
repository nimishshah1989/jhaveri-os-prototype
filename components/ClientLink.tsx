import Link from 'next/link';

// One place decides how a client's name is rendered, so a name is never a dead end
// anywhere in the product — and every one of them carries the same initials disc,
// which is what makes a list of people scannable before you have read it.
// The colour is derived from the name, so a client looks the same on every screen.

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

function shade(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 6;
  return h;
}

export function ClientLink({ id, name, muted, avatar = true, href }: {
  id?: number | null; name: string; muted?: boolean; avatar?: boolean;
  /** Somewhere other than the profile — the queue sends a name to its action drawer. */
  href?: string;
}) {
  const face = avatar ? <span className={`av a${shade(name)}`} aria-hidden="true">{initials(name)}</span> : null;
  const to = href ?? (id ? `/clients/${id}` : null);
  if (!to) return <span className={muted ? 'd' : undefined}>{face}{name}</span>;
  // An in-page destination must not jump the queue back to the top.
  return (
    <Link href={to} className={muted ? 'lnk muted' : 'lnk'} scroll={href ? false : undefined}>{face}{name}</Link>
  );
}
