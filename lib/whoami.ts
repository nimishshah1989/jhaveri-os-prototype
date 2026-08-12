/**
 * The one place the acting client is decided.
 *
 * It lives in its own module rather than inside a server-action file because a
 * `'use server'` module may only export async functions — and the moment two
 * different action files each resolved identity their own way, one of them would
 * eventually read it from the form. There is exactly one of these, on purpose.
 *
 * SECURITY. Identity is resolved on the server and NEVER read from a form. Today
 * the lens has no auth, so this changes nothing; the day a session exists, a
 * client id supplied by the browser would be an account takeover shaped exactly
 * like a feature. This function becomes the session lookup, and RLS scopes every
 * write beneath it.
 */
export function whoami(): number {
  return Number(process.env.FOLIO_CLIENT ?? 101);
}
