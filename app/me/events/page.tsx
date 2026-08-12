import Link from 'next/link';
import { Icon } from '../../../components/Icon';
import { dmy } from '../../../lib/format';
import { TODAY } from '../../../mockdb/engines';
import { eventDesk, unviewedKinds } from '../../../lib/eventdesk';
import { manager } from '../../../lib/me';
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
      <p className="f-note" style={{ margin: '0 2px 14px' }}>
        {rows.length} things have happened to the funds you hold. Each says what it means for your
        money, and what we make of it — and where we have not written a view, it says that instead of
        inventing one.
      </p>

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

          <div className="f-ins" style={{ marginTop: 11, borderBottom: 0, paddingBottom: 0 }}>
            <span className="g"><Icon name="bulb" /></span>
            <span className="tx">
              <span className="d">What we make of it</span>
              {e.view ?? (
                <>
                  We have not written a house view for this kind of event yet. The fact above is a
                  record; the sentence that should sit here is not written, and we would rather say so
                  than have a page compose one.
                </>
              )}
            </span>
          </div>

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
              Older than the four above. Each still traces to a record, and the house view for its kind
              of event is the same one printed above.
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
