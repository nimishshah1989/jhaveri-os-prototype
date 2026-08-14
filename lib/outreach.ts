import { db } from './db';
import { ONBOARDING_RULES, type AppCard, type Rejection } from './onboarding';

// The message a broker sends at the point an application stops moving.
//
// None of the words here are new. A rejection already has a plain-English
// explanation and a specific ask — written once, in lib/onboarding, so the card on
// screen and the message to the client cannot describe the same problem two ways.
// This file only decides how those words are addressed and delivered.
//
// Deliberately drafts rather than sends. Every send in this product goes through a
// consent check and a logged artefact; an onboarding nudge is service
// communication rather than marketing, but the moment it becomes a one-click send
// it needs the same trail, and that is a bigger piece of work than a draft the
// broker reads before pressing anything.

export type Channel = 'whatsapp' | 'email';

export interface Draft {
  channel: Channel;
  subject: string | null;
  body: string;
  /** Whether the client has said this channel is fine. */
  consent: 'granted' | 'withdrawn' | 'never asked';
  /** wa.me / mailto, ready to open. Null when we have no number or address. */
  href: string | null;
}

/** What consent is on record for a channel, if any. */
function consentFor(c: AppCard, channel: Channel): Draft['consent'] {
  if (c.client_id != null) {
    const row = db().prepare(
      `SELECT state FROM consents WHERE client_id = ? AND channel = ?
        ORDER BY ts DESC LIMIT 1`,
    ).get(c.client_id, channel) as { state: string } | undefined;
    if (row) return row.state === 'granted' ? 'granted' : 'withdrawn';
  }
  const lead = leadConsent(c.application_id);
  if (lead === 'granted') return 'granted';
  if (lead === 'withdrawn' || lead === 'refused') return 'withdrawn';
  return 'never asked';
}

/**
 * Where to reach them. An application that has not reached UCC has no client
 * record yet, which is precisely the population this exists for — so the lead row
 * that started it is the fallback, and it is the only contact detail that exists
 * for most of the pipeline.
 */
function reach(c: AppCard): { mobile: string | null; email: string | null } {
  if (c.client_id != null) {
    const r = db().prepare(
      `SELECT cm_mobile_number mobile, cm_email_id email FROM client_master WHERE cm_user_id = ?`,
    ).get(c.client_id) as { mobile: string | null; email: string | null } | undefined;
    if (r?.mobile || r?.email) return { mobile: r.mobile ?? null, email: r.email ?? null };
  }
  const l = db().prepare(
    `SELECT l.mobile, l.email FROM onboarding_applications oa
       JOIN leads l ON l.lead_id = oa.lead_id WHERE oa.application_id = ?`,
  ).get(c.application_id) as { mobile: string | null; email: string | null } | undefined;
  return { mobile: l?.mobile ?? null, email: l?.email ?? null };
}

/**
 * A lead who has not become a client has no consent row either; the lead itself
 * carries the state captured when the number was taken. DPDP needs a basis, and
 * "we have not asked" is a legitimate answer that the card has to show rather
 * than assume away.
 */
function leadConsent(applicationId: number): string | null {
  const r = db().prepare(
    `SELECT l.consent_state s FROM onboarding_applications oa
       JOIN leads l ON l.lead_id = oa.lead_id WHERE oa.application_id = ?`,
  ).get(applicationId) as { s: string } | undefined;
  return r?.s ?? null;
}

const first = (name: string) => name.split(' ')[0];

/**
 * What to say at each place an application stops. The stall messages are written
 * here because a stall has no words of its own; a rejection's do not appear here
 * at all, because it already has them.
 */
const STALL: Record<string, (c: AppCard) => string> = {
  kyc: c => `we are still waiting on the KYC check for your account. It has been ${c.days} days, `
    + `which is longer than it should take, and I am chasing it from our side.`,
  elog: c => `your account is through KYC and waiting on the exchange e-sign step. `
    + `It has been sitting there ${c.days} days — if you did not receive the link, I can send it again.`,
  ucc: c => `everything is approved and we are waiting on the exchange to allot your client code. `
    + `That is with them, not with you — nothing further is needed from your side.`,
  lead: () => `we have your details and have not started the application yet. `
    + `Whenever you are ready, it takes about ten minutes.`,
};

/** The draft for an application that has stopped moving, in one channel. */
export function stallDraft(c: AppCard, channel: Channel): Draft {
  const line = (STALL[c.stage] ?? STALL.kyc)(c);
  const body = `Hello ${first(c.name)}, ${line}`
    + (c.days >= ONBOARDING_RULES.stall_days ? ` Sorry it has taken this long.` : '');
  return dress(c, channel, `Your account with Jhaveri — where it has got to`, body);
}

/**
 * The draft for a rejection. The explanation and the ask are the same strings the
 * card prints, so a client can never be told one thing on the phone and another in
 * writing.
 */
export function rejectionDraft(r: Rejection, channel: Channel): Draft {
  const body = `Hello ${first(r.name)}, the KYC check came back with a query on your application. `
    + `${r.plain} To fix it we need: ${r.ask} `
    + `Send it whenever suits and I will re-file the same day.`;
  return dress(r, channel, `Your KYC — one thing to correct`, body);
}

function dress(c: AppCard, channel: Channel, subject: string, body: string): Draft {
  const to = reach(c);
  const consent = consentFor(c, channel);
  const href = channel === 'whatsapp'
    ? (to.mobile ? `https://wa.me/${to.mobile.replace(/\D/g, '')}?text=${encodeURIComponent(body)}` : null)
    : (to.email ? `mailto:${to.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}` : null);
  return {
    channel,
    subject: channel === 'email' ? subject : null,
    body,
    consent,
    href,
  };
}

/** Both channels at once, which is what a card offers. */
export function draftsFor(c: AppCard, rejection?: Rejection): Draft[] {
  const make = (ch: Channel) => (rejection ? rejectionDraft(rejection, ch) : stallDraft(c, ch));
  return [make('whatsapp'), make('email')];
}
