import { db } from './db';

/* ── The KRA verdict, and the words we say about it ─────────────────
Split out of lib/join.ts, which had grown past the file cap. This half is the
regulator's vocabulary and our translation of it; the other half is the journey.
Nothing here writes.                                                          */

/**
 * The KRA's vocabulary, exactly as the database already spells it. One home for
 * it, because a status written here as 'VERIFIED' when every existing row says
 * 'KRA Verified' produces a client who is verified on our screen and pending on
 * the broker's — two lenses, one truth, disagreeing.
 */
export const KRA = {
  verified: 'KRA Verified',
  rejected: 'KRA Rejected',
  pending: 'Under Process',
  clean: 'ERR-00000',
  /** `client_kyc_logs.status` and `onboarding_applications.kyc_status` use these. */
  internal: { verified: 'VERIFIED', pending: 'PENDING' },
  /** How the KYC was collected. The app journey is always the digital one. */
  type: { digital: 'Aadhaar eKYC', paper: 'Physical KRA' },
} as const;

export type KycBranch = 'validated' | 'lapsed' | 'none';

export interface KycVerdict {
  branch: KycBranch;
  /** The KRA's own code, when it gave one. */
  code: string | null;
  /** What we say to the client. Written policy for every code we phrase. */
  plain: string;
  /** What they have to do next, in their words. */
  ask: string;
  /** True when the official wording is being shown because we have no sentence. */
  unphrased: boolean;
}

/**
 * What the KRA holds for this PAN. Deterministic on the PAN itself, never
 * random: a verifier has to be able to walk the same branch twice, and a demo
 * has to be able to show all three on demand.
 * ponytail: the real check is a KRA API call; this is the same three branches
 * the live one returns, keyed off the PAN so they are reproducible.
 */
export function kycFor(pan: string): KycVerdict {
  const p = pan.trim().toUpperCase();
  const held = db().prepare(
    `SELECT kra_status, kra_status_code FROM client_kyc_logs WHERE UPPER(pan_no) = ? ORDER BY id DESC LIMIT 1`,
  ).get(p) as { kra_status: string | null; kra_status_code: string | null } | undefined;

  const code = held?.kra_status_code && held.kra_status_code !== KRA.clean ? held.kra_status_code : null;
  const branch: KycBranch = held
    ? (held.kra_status === KRA.verified && !code ? 'validated' : 'lapsed')
    : (Number(p.slice(5, 9)) % 3 === 0 ? 'lapsed' : 'none');

  if (branch === 'validated') {
    return {
      branch, code: null, unphrased: false,
      plain: 'The KRA already holds a verified KYC against this PAN, so there is nothing to re-submit.',
      ask: 'Nothing. We carry it forward and move on to your bank details.',
    };
  }
  const words = code ? phrase(code) : null;
  if (branch === 'lapsed') {
    const inFlight = held?.kra_status === KRA.pending;
    return {
      branch, code, unphrased: code != null && words == null,
      plain: words?.plain ?? (code ? official(code) : inFlight
        ? 'There is already a KYC with the KRA against this PAN, and they have not come back on it yet.'
        : 'The KRA holds a record against this PAN, but it is no longer current — the rules changed after it was filed.'),
      ask: words?.ask ?? (inFlight
        ? 'Nothing new, unless the KRA asks. Filing a second set now would only put you behind your own application.'
        : 'A fresh set of documents. The earlier file cannot be revived.'),
    };
  }
  return {
    branch, code: null, unphrased: false,
    plain: 'The KRA holds nothing against this PAN, which simply means this is your first mutual fund account.',
    ask: 'Proof of who you are and where you live, a photograph, and your signature. Ten minutes, once, forever.',
  };
}

/**
 * The phrasebook is written policy — the same discipline `lib/onboarding.ts`
 * applies for the broker. A wrong sentence sends a client for the wrong
 * document, so a code we have not phrased renders the official wording and says
 * so, rather than being guessed at.
 */
const PLAIN_WORDS: Record<string, { plain: string; ask: string }> = {
  'ERR-00009': {
    plain: 'The PAN does not match income-tax records — usually a typo, or a name spelt differently from the card.',
    ask: 'Check the number against your card, and enter your name exactly as it is printed there.',
  },
  'ERR-00004': {
    plain: 'The address on your earlier form does not match the proof filed with it.',
    ask: 'An address proof that matches what you enter here — or change what you enter to match the proof. One or the other, not both.',
  },
  'ERR-00017': {
    plain: 'Your signature did not match the one the KRA already holds.',
    ask: 'Sign again on a blank sheet, the way you sign at your bank, and photograph it.',
  },
  'ERR-00010': {
    plain: 'This PAN belongs to someone under 18, so the account cannot stand on its own.',
    ask: "A guardian's PAN and KYC, and the birth certificate.",
  },
  'ERR-00031': {
    plain: 'The KRA closed your earlier file because the documents did not arrive inside their deadline.',
    ask: 'The full set again. The earlier upload has expired and cannot be revived.',
  },
};

const phrase = (code: string) => PLAIN_WORDS[code] ?? null;

function official(code: string): string {
  const row = db().prepare(`SELECT error_description d FROM kra_error_codes WHERE error_code = ?`).get(code) as { d: string } | undefined;
  return row ? `The KRA's own words: "${row.d}". We have not yet written a plainer sentence for this one.` : code;
}

/** Codes with no written sentence. Surfaced, never hidden — same as the broker lens. */
export function unphrasedJoinCodes(): string[] {
  return (db().prepare(`SELECT error_code FROM kra_error_codes WHERE error_code != 'ERR-00000'`).all() as
    { error_code: string }[]).map(r => r.error_code).filter(c => !PLAIN_WORDS[c]);
}

