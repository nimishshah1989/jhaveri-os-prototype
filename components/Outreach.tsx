import type { Draft } from '../lib/outreach';

// The one-touch message row on a stalled or rejected application.
//
// A link, not a send. The draft opens in WhatsApp or the mail client with the
// words already in it, and the broker presses send — so there is a human between
// the rule and the client, and no message leaves this product without one.
//
// Consent is shown rather than enforced, and that distinction is deliberate: an
// onboarding message is service communication, not marketing, so a missing consent
// does not make it unlawful. It does make it worth knowing before you type, and a
// client who has withdrawn gets a warning the broker has to read past.

const STATE: Record<Draft['consent'], { label: string; cls: string } | null> = {
  granted: null,                                                   // the ordinary case says nothing
  'never asked': { label: 'no consent on file', cls: 'stale' },
  withdrawn: { label: 'withdrew consent', cls: 'atrisk' },
};

export function Outreach({ drafts }: { drafts: Draft[] }) {
  return (
    <div className="outreach">
      {drafts.map(d => {
        const flag = STATE[d.consent];
        return (
          <span key={d.channel} className="och">
            {d.href ? (
              <a href={d.href} target="_blank" rel="noreferrer" title={d.body}>
                {d.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} the draft
              </a>
            ) : (
              <span className="none" title="No number or address on file for this application">
                No {d.channel === 'whatsapp' ? 'number' : 'address'} on file
              </span>
            )}
            {flag && <span className={`fchip ${flag.cls}`}>{flag.label}</span>}
          </span>
        );
      })}
    </div>
  );
}
