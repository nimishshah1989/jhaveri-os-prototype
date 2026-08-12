import { cookies } from 'next/headers';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Step } from './join';

/* ── The journey, carried by the browser ─────────────────────────────────────
   `lib/db.ts` copies the seeded database to /tmp once per serverless instance,
   so two requests in the same journey can land on two different instances with
   two different copies. Locally that never happens; in production it means a
   client fills in their PAN, presses Continue, and the next screen says the
   application does not exist.

   The fix is to stop asking a per-instance filesystem to remember something
   that belongs to one browser anyway. Every completed step is already a small
   JSON payload, so the whole journey fits in a cookie, signed so the fields
   that decide money — the adviser code above all — cannot be edited in
   DevTools between two steps. The database write still happens; it is now the
   mirror rather than the memory, and `application()` merges the two.

   ponytail: HMAC over a JSON body, `node:crypto`, no dependency and no session
   store. If the prototype ever grows real auth, this becomes the session
   cookie and the journey moves into it — same shape, one signer. */

export interface Journey {
  /** The application id, as allocated by whichever instance started it. */
  id: number;
  /** Adviser the client is tagged to. A money field: it decides commission. */
  sb: number;
  /** That adviser's name, for the screen. */
  br: string;
  channel: 'digital' | 'offline';
  lead: number | null;
  /** Completed steps and what each one captured, oldest first. */
  e: [Step, Record<string, string>][];
}

const NAME = 'jn';
/**
 * A prototype with no auth has no key management either. The signature is here
 * to stop a client editing their own adviser code mid-journey, not to protect a
 * secret — so a build-time default is honest, and a real deployment sets the env.
 */
const SECRET = process.env.JOURNEY_SECRET ?? 'jhaveri-prototype-journey-v1';

const sign = (body: string) => createHmac('sha256', SECRET).update(body).digest('base64url');

function verify(body: string, mac: string): boolean {
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The cookie value for a journey. Pure, so a verifier can exercise the seal. */
export function seal(j: Journey): string {
  const body = Buffer.from(JSON.stringify(j), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

/** The journey inside a cookie value, or null if it was edited on the way. */
export function open(raw: string): Journey | null {
  const cut = raw.lastIndexOf('.');
  if (cut < 1) return null;
  const [body, mac] = [raw.slice(0, cut), raw.slice(cut + 1)];
  if (!verify(body, mac)) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Journey;
  } catch {
    return null;
  }
}

/** The journey this browser is carrying, if it is the one being asked about. */
export async function readJourney(id: number): Promise<Journey | null> {
  const raw = (await cookies()).get(NAME)?.value;
  const j = raw ? open(raw) : null;
  // A cookie from a different application is not this application's state.
  return j && j.id === id ? j : null;
}

export async function writeJourney(j: Journey): Promise<void> {
  (await cookies()).set(NAME, seal(j), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // A joining session that has gone cold is better restarted than resumed
    // against a database that has since been reseeded under it.
    maxAge: 60 * 60 * 6,
  });
}
