import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { eventDesk, unviewedKinds } from '../../../lib/eventdesk';
import { manager } from '../../../lib/me';
import { FolioBars } from '../folio-charts';
import { ME } from '../layout';
import { raise } from '../acts';

export const dynamic = 'force-dynamic';

const GLYPH: Record<string, string> = {
  manager_changed: 'users', manager_wrote: 'chat', style_moved: 'spark',
  mandate_ending: 'alert', instalment_failed: 'alert', worst_month: 'down',
};

/**
 * The event desk. Everything that has happened to this client's funds, each with
 * the house's written view and the consequence in the client's own rupees.
 *
 * Nothing on this page is a news feed. Every row is derived from a record that
 * already exists — a dated handover, a mandate end date, a refused instalment, a
 * style box computed from holdings — and the view beside it is written policy
 * held in one place. An event kind with no written view says so.
 */
export default async function Events() {
  const rows = eventDesk(ME);
  const rm = manager(ME);
  const gaps = unviewedKinds();
  // A reading surface, capped at 2.5 screens — measured at 3.05 with every
  // event as a full card. The recent ones earn the house view beside them;
  // older ones are a log, and a log is a list.
  const RECENT = 4;
  const recent = rows.slice(0, RECENT);
  const older = rows.slice(RECENT);
  // One bar per fund, carrying the largest sum any single change on it puts at
  // stake. Keyed on the scheme, not on the name: all three of this client's
  // funds begin "WhiteOak Capital", so a name-prefix key collapsed them into a
  // single bar and the chart silently disappeared.
  const byFund = new Map<number, { name: string; value: number }>();
  for (const e of rows) {
    if (e.at_stake == null || e.scheme_id == null) continue;
    const label = (e.fund ?? '').replace(/ (Dir|Reg) ?Gr$/, '').replace(/^WhiteOak Capital /, '');
    const at = byFund.get(e.scheme_id);
    if (!at || e.at_stake > at.value) byFund.set(e.scheme_id, { name: label, value: e.at_stake });
  }
  const ranked = [...byFund.values()].sort((a, b) => b.value - a.value)
    .map(r => ({ ...r, tone: 'gold' as const }));

  if (rows.length === 0) {
    return (
      <>
        <p className="f-hello">What changed.</p>
        <div className="f-card">
          <div className="f-k"><Icon name="info" /> Nothing has</div>
          <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--f-muted)', marginTop: 9 }}>
            No manager has changed, no mandate is near its end, and no instalment has been refused on
            anything you hold. A quiet page is the good outcome here, and we would rather print it
            than manufacture something to tell you about.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <p className="f-hello">What changed.</p>
      {/* Ranked by what each change actually touches, so the biggest number is
          the first thing read rather than the most recent one. */}
      {ranked.length > 1 && (
        <div className="f-card">
          <div className="f-k"><Icon name="money" /> What each change touches</div>
          <FolioBars rows={ranked} />
          <p className="f-note" style={{ marginBottom: 0 }}>
            {rows.length} changes on the funds you hold, newest first below.
          </p>
        </div>
      )}

      {recent.map(e => (
        <div className="f-card" key={e.key}>
          <div className="f-k">
            <Icon name={GLYPH[e.kind] ?? 'info'} />
            {e.days_ago === 0 ? 'Today' : `${e.days_ago} day${e.days_ago === 1 ? '' : 's'} ago`}
            {e.scheme_id != null && (
              <Link href={`/me/portfolio/${e.scheme_id}`} className="rt">
                {(e.fund ?? '').replace(/ (Dir|Reg) ?Gr$/, '')} <Icon name="chev" />
              </Link>
            )}
          </div>

          <div className="t" style={{ fontSize: 15, fontWeight: 650, lineHeight: 1.4, marginTop: 9 }}>
            {e.what}
          </div>

          {e.consequence && (
            <div className="s" style={{ fontSize: 13, color: 'var(--f-muted)', marginTop: 7, lineHeight: 1.55 }}>
              {e.consequence}
            </div>
          )}

          <details className="f-acc" style={{ marginTop: 8 }}>
            <summary><Icon name="chev" /> What we make of it</summary>
            <div className="body" style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--f-muted)' }}>
              {e.view ?? 'We have not written a house view for this kind of event yet, and would rather say so than have a page compose one.'}
            </div>
          </details>

          {e.act && (
            <form action={raise}>
              <input type="hidden" name="kind" value={e.act.kind} />
              <input type="hidden" name="label" value={e.act.label} />
              <input type="hidden" name="evidence" value={`event desk · ${e.kind} · ${dmy(e.on)}`} />
              <button className="f-btn" type="submit">{e.act.label}</button>
            </form>
          )}
        </div>
      ))}

      {older.length > 0 && (
        <>
          <div className="f-sect">Earlier</div>
          <div className="f-card">
            {older.map(e => (
              <div className="f-ins" key={e.key}>
                <span className="g"><Icon name={GLYPH[e.kind] ?? 'info'} /></span>
                <span className="tx">
                  <span className="d">
                    {e.days_ago} days ago{e.fund ? ` · ${e.fund.replace(/ (Dir|Reg) ?Gr$/, '')}` : ''}
                  </span>
                  <b>{e.what}</b>
                  {e.consequence && <> {e.consequence}</>}
                </span>
              </div>
            ))}
            <p className="f-note" style={{ marginBottom: 0 }}>
              Older than the four above, same house view as their kind.
            </p>
          </div>
        </>
      )}

      <p className="f-note">
        Priced and dated {dmy(TODAY)}. {rm?.first ?? 'Your manager'} sees the same list.
        {gaps.length > 0 && ` ${gaps.length} kind${gaps.length === 1 ? '' : 's'} of event still have no written house view: ${gaps.join(', ')}.`}
      </p>
    </>
  );
}
