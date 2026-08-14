'use server';

import { cookies } from 'next/headers';
import { TODAY } from '../../mockdb/engines';

/* ── When you last looked ────────────────────────────────────────────────────
   The Today hero needs a last-seen, and a lens with no auth has exactly one
   honest place to keep it: the browser. The server does not know who is
   looking, so it cannot know when they last did.

   ponytail: a plain dated cookie, read on render and stamped forward. No table,
   no session store, no second identity. When a session exists this becomes a
   column and `sinceLastLook` above it does not change.                        */

const KEY = 'folio-seen';

/** The date this browser last opened Today, or null the first time. */
export async function lastSeen(): Promise<string | null> {
  const raw = (await cookies()).get(KEY)?.value ?? '';
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= TODAY ? raw : null;
}

/**
 * Stamps today. Called from a form action rather than during render, because a
 * cookie written while rendering would mark the visit before the client had
 * seen what changed — and then it would never be shown at all.
 */
export async function markSeen(): Promise<void> {
  (await cookies()).set(KEY, TODAY, {
    httpOnly: true, sameSite: 'lax', path: '/me',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 365,
  });
}
