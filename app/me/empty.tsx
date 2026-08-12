import { Icon } from '../../components/Icon';
import { manager } from '../../lib/me';
import { raise } from './acts';

/**
 * The first-run state, and the honest one. research/14 §10.14 lists "empty states
 * with an action" as table stakes, and §12 warns that this category prints numbers
 * it cannot stand behind — a health score of 70 on a portfolio holding nothing is
 * exactly that. So a client with no money sees no score, no arc and no shape: one
 * sentence about what happens next, and the person who makes it happen.
 */
export function Nothing({ clientId, page }: { clientId: number; page: 'today' | 'portfolio' | 'desk' }) {
  const rm = manager(clientId);
  const line = {
    today: 'Your first instalment writes the first page of this. Until then there is nothing here worth printing, and we are not going to invent it.',
    portfolio: 'Nothing is held on these folios yet. When the first units are allotted, this page fills itself — the arc, the look-through, the audit, all of it.',
    desk: 'Your record starts with your first transaction. Papers, tax dates and the household register appear as there is something to put in them.',
  }[page];

  return (
    <>
      <div className="f-card">
        <div className="f-k"><Icon name="info" /> Nothing here yet</div>
        <p style={{ fontSize: 13.5, lineHeight: 1.6, color: 'var(--f-muted)', marginTop: 10 }}>{line}</p>
        {rm && (
          <form action={raise}>
            <input type="hidden" name="kind" value="call_rm" />
            <input type="hidden" name="label" value="Client asked how to start" />
            <input type="hidden" name="evidence" value={`empty ${page} page`} />
            <button className="f-btn" type="submit"><Icon name="chat" /> Ask {rm.first} how to start</button>
          </form>
        )}
      </div>
      <p className="f-note">
        {rm
          ? `${rm.name} is your manager. Everything in this app is free — the fund houses pay a trail on what you hold, and that pays for all of it.`
          : 'No manager is assigned to you yet, which is a gap on our side rather than yours. Jhaveri has been told.'}
      </p>
    </>
  );
}
