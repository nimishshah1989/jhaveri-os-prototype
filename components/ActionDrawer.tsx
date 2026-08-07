import Link from 'next/link';
import type { ActionDetail } from '../lib/action-detail';
import { inrCompact, dmy2 } from '../lib/format';
import { typeOf, evidence, sla } from '../lib/queue-display';
import { QueueActions } from './QueueActions';
import { Icon } from './Icon';

// What opens when a broker clicks a row. He is about to pick up the phone, so the
// panel answers his four questions in the order he asks them:
//   what happened · what do I do · who is this · has this ever worked
// and then lets him log the outcome without going anywhere.
//
// It is a plain link-driven panel — the URL carries ?action=<id>, so a queue item
// is shareable, survives a refresh, and needs no client-side state.

// The draft is a starting sentence, never a send-behind-your-back. Only the types
// where a broker genuinely opens with a message get one; the rest show no button
// rather than a hollow "Hi {name}, hope you are well".
const DRAFT: Record<string, (name: string) => string> = {
  sip_bounce_save: n => `Hi ${n}, your SIP instalment did not go through this month. Nothing to worry about — shall I help you fix the mandate so the plan stays on track?`,
  mandate_expiring: n => `Hi ${n}, the bank mandate behind your SIP is about to expire. Can I send you the renewal link so the instalments continue uninterrupted?`,
  idle_no_sip: n => `Hi ${n}, you are invested but not on a monthly plan yet. Would you like me to work out a SIP amount that fits your cashflow?`,
  kyc_unstick: n => `Hi ${n}, your account opening is waiting on one last step at our end. Do you have five minutes today so we can close it out?`,
  campaign_responder: n => `Hi ${n}, thanks for coming back on that. When would be a good time to talk it through?`,
  dormant_review: n => `Hi ${n}, it has been a while since we reviewed your portfolio. Shall I put together an update and find a time to walk you through it?`,
};

export function ActionDrawer({ detail, nextId }: { detail: ActionDetail; nextId?: number }) {
  const { item, client, precedent, alsoOpen } = detail;
  const t = typeOf(item.action_type);
  const d = sla(item.sla_due);
  const facts = evidence(item.trigger_evidence);
  const draft = client && DRAFT[item.action_type]?.(client.name.split(' ')[0]);
  const wa = client?.mobile && draft
    ? `https://wa.me/91${client.mobile}?text=${encodeURIComponent(draft)}`
    : null;

  return (
    <>
      <Link href="/today" className="scrim" aria-label="Close" />
      <aside className="drawer" aria-label={`${t.label} — ${item.client_name ?? 'detail'}`}>
        <header>
          <span className={`tchip ${t.tone}`}><Icon name={t.icon} /> {t.label}</span>
          <Link href="/today" className="x" aria-label="Close">×</Link>
        </header>

        <h2>{item.client_name ?? 'Unassigned'}</h2>
        <div className="dsub">
          {item.impact_score > 0 && <b className="num">{inrCompact(item.impact_score)} at stake</b>}
          {item.impact_score > 0 && ' · '}
          <span className={`due ${d.tone}`}>{d.text}</span>
          {' · raised '}{dmy2(detail.created_at)}
        </div>

        <section className="dblock">
          <h3><Icon name="alert" /> What happened</h3>
          <dl className="dfacts">
            {facts.map((f, i) => (
              // Some evidence values say what they are on their own — "₹25,000/mo",
              // "62% in one scheme". Those get the full width and no invented label.
              <div key={i} className={f.lead ? undefined : 'wide'}>
                {f.lead && <dt>{f.lead}</dt>}
                <dd className="num">{f.value}</dd>
              </div>
            ))}
          </dl>
          {/* "You" is only ever claimed for work the broker actually typed. Several
              engine-minted rows carry created_from='manual' in the seed, so the
              action's own type is the honest test, not that column alone. */}
          <p className="dnote">
            Raised by {detail.created_from?.startsWith('rule:')
              ? <>rule <code>{detail.created_from.slice(5)}</code> — a fixed condition on your book, not a prediction</>
              : item.action_type === 'manual' ? 'you' : 'the engine'}.
          </p>
        </section>

        <section className="dblock do">
          <h3><Icon name="arrow" /> Do this</h3>
          <p className="dstep">{item.suggested_step ?? 'No suggested step — use your judgement and log what you did.'}</p>
          <div className="dcontact">
            {client?.mobile && <a className="btn" href={`tel:+91${client.mobile}`}>Call {client.mobile}</a>}
            {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp draft</a>}
            {client?.email && <a className="btn ghost" href={`mailto:${client.email}`}>Email</a>}
          </div>
          {draft && <p className="ddraft">“{draft}”<span className="d"> — edit before sending; nothing is sent for you.</span></p>}
        </section>

        {client && (
          <section className="dblock">
            <h3><Icon name="users" /> Who this is</h3>
            <dl className="dfacts">
              <div><dt>portfolio</dt><dd className="num">{inrCompact(client.value)}</dd></div>
              {client.since && <div><dt>invested since</dt><dd className="num">{dmy2(client.since)}</dd></div>}
              {client.risk && <div><dt>risk profile</dt><dd>{client.risk}</dd></div>}
              <div>
                <dt>last contact</dt>
                <dd className="num">{client.last_contact
                  ? `${client.last_contact.kind} · ${dmy2(client.last_contact.occurred_at)}`
                  : 'never logged'}</dd>
              </div>
            </dl>
            {alsoOpen.length > 0 && (
              <p className="dnote">
                Also open for {client.name.split(' ')[0]}:{' '}
                {alsoOpen.map((a, i) => (
                  <span key={a.action_id}>
                    {i > 0 && ', '}
                    <Link href={`/today?action=${a.action_id}`}>{typeOf(a.action_type).label}</Link>
                    {' '}<span className="d">({sla(a.sla_due).text})</span>
                  </span>
                ))}
                {' '}— one call can close more than one.
              </p>
            )}
            <Link href={`/clients/${client.client_id}`} className="dfull">Open full profile →</Link>
          </section>
        )}

        <section className={`dblock ${precedent.enough ? '' : 'thin'}`}>
          <h3><Icon name="bulb" /> Has this worked before</h3>
          {precedent.enough ? (
            <p className="dstat">
              <b className="num">{precedent.won} of {precedent.closed}</b> {t.label.toLowerCase()} items
              you closed ended with the client acting.
            </p>
          ) : (
            <p className="dnote">
              {precedent.closed === 0
                ? 'No closed outcomes on this kind of item yet'
                : `Only ${precedent.closed} closed outcome${precedent.closed === 1 ? '' : 's'} so far`}
              {' '}— too few to tell you anything honest. This fills in as you work the queue.
            </p>
          )}
        </section>

        {/* Logging an outcome hands him the next item instead of the list he was
            already looking at — thirty items becomes one pass, not thirty round trips. */}
        <section className="dblock close">
          <h3><Icon name="check" /> Log what you did</h3>
          <QueueActions actionId={item.action_id} step={item.suggested_step} next={nextId} />
          <div className="dwalk">
            {nextId
              ? <Link href={`/today?action=${nextId}`} className="btn ghost">Skip to next item →</Link>
              : <span className="dnote">Last item in the queue.</span>}
          </div>
        </section>
      </aside>
    </>
  );
}
