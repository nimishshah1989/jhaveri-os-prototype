import { paper, toCsv, PAPERS, type PaperKind } from '../../../../lib/papers';
import { whoami } from '../../../../lib/whoami';

/**
 * The download itself.
 *
 * A route handler rather than a server action, because a server action cannot
 * return a file — and the whole point of phase 7 is that pressing "capital gains
 * statement" produces a capital gains statement rather than a promise of one.
 *
 * SECURITY. The client is `whoami()` on the server. The URL carries the KIND of
 * document, never whose it is: a client id in this path would hand anybody
 * anybody else's holdings, PAN and tax position by editing an address bar. The
 * kind is checked against the register rather than passed through, so a crafted
 * path cannot reach a builder that does not exist.
 */
export async function GET(_req: Request, ctx: RouteContext<'/me/papers/[kind]'>) {
  const { kind } = await ctx.params;
  if (!(kind in PAPERS)) {
    return new Response('No such document.', { status: 404 });
  }
  const built = paper(whoami(), kind as PaperKind);
  if (!built) return new Response('No such document.', { status: 404 });

  return new Response(toCsv(built), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${built.meta.filename}"`,
      // A statement is a snapshot of a priced morning. Caching one would hand a
      // client yesterday's valuation with today's date on the tab.
      'cache-control': 'no-store',
    },
  });
}
