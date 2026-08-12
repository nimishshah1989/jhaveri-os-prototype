'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { application, recordStep, setPaper, startApplication, type Step } from '../../lib/join';

/* The HTTP shell around `lib/join.ts`. Everything here is validation and a
   redirect; every row that gets written is written by the library, so the
   verifier can walk the same journey without a browser.

   Every field below crosses a trust boundary. They are validated on shape and
   refused rather than coerced: a silently-corrected PAN is a wrong KYC check,
   and a silently-dropped adviser code is a wrong commission. */

const PAN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const MOBILE = /^[6-9][0-9]{9}$/;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const NAME = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

interface Refusal { field: string; says: string }

function checks(step: Step, f: FormData): Refusal[] {
  const bad: Refusal[] = [];
  const need = (k: string, re: RegExp, says: string) => {
    if (!re.test(s(f, k).toUpperCase())) bad.push({ field: k, says });
  };
  if (step === 'pan') {
    need('pan', PAN, 'A PAN is five letters, four digits, then one letter — like ABCDE1234F.');
    need('name', NAME, 'Your name exactly as it is printed on the PAN card.');
    need('dob', DATE, 'Your date of birth, as day, month and year.');
  }
  if (step === 'bank') {
    if (!/^\d{9,18}$/.test(s(f, 'account'))) bad.push({ field: 'account', says: 'An account number is between 9 and 18 digits, with no spaces.' });
    need('ifsc', IFSC, 'An IFSC is four letters, a zero, then six more characters — like HDFC0001234.');
  }
  if (step === 'nominee' && s(f, 'declined') !== '1') {
    need('nominee_name', NAME, "The nominee's full name.");
    if (!s(f, 'relation')) bad.push({ field: 'relation', says: 'How they are related to you.' });
  }
  if (step === 'profile') {
    for (const k of ['horizon', 'fall', 'purpose']) {
      if (!s(f, k)) bad.push({ field: k, says: 'Pick one. There is no wrong answer here.' });
    }
    if (s(f, 'fatca') !== '1') bad.push({ field: 'fatca', says: 'We cannot open the account without this declaration.' });
  }
  if (step === 'sign' && s(f, 'signed') !== '1') {
    bad.push({ field: 'signed', says: 'The e-signature has not come back from DigiO yet.' });
  }
  return bad;
}

/** What we keep from a step. Only the fields that step is actually asking for. */
const KEEP: Record<Step, string[]> = {
  pan: ['pan', 'name', 'dob'],
  kyc: ['identity_source', 'photo', 'signature'],
  bank: ['account', 'ifsc', 'bank_name'],
  nominee: ['nominee_name', 'relation', 'declined'],
  profile: ['horizon', 'fall', 'purpose', 'fatca'],
  sign: ['signed', 'digio_request_id'],
  waiting: [],
  live: [],
};

/**
 * Self-signup. The adviser code is optional but never ignored: a code that is not
 * in the register stops the journey here with a sentence, because attribution
 * decides commission and a wrong tag is a money error that reconciles perfectly.
 */
export async function start(formData: FormData): Promise<void> {
  const mobile = s(formData, 'mobile');
  const name = s(formData, 'name');
  const code = s(formData, 'code');

  if (!MOBILE.test(mobile) || !NAME.test(name)) {
    redirect(`/join?e=${encodeURIComponent('A ten-digit Indian mobile number, and your name as it appears on your PAN card.')}`);
  }
  const started = startApplication(name, mobile, code);
  if (!started.ok) redirect(`/join?e=${encodeURIComponent(started.reason)}&code=${encodeURIComponent(code)}`);
  redirect(`/join/${started.appId}`);
}

export async function advance(formData: FormData): Promise<void> {
  const appId = Number(s(formData, 'application_id'));
  const step = s(formData, 'step') as Step;
  const app = application(appId);
  if (!app || !(step in KEEP)) return;
  // Only the step the application is actually on may be written. Anything else is
  // a replayed or forged form, and it must not rewrite a completed step.
  if (app.step !== step) redirect(`/join/${appId}`);

  const bad = checks(step, formData);
  if (bad.length) redirect(`/join/${appId}?e=${encodeURIComponent(JSON.stringify(bad))}`);

  const payload: Record<string, string> = {};
  for (const k of KEEP[step]) {
    const v = s(formData, k);
    if (v) payload[k] = k === 'pan' || k === 'ifsc' ? v.toUpperCase() : v;
  }
  recordStep(appId, step, payload);

  revalidatePath('/me');
  revalidatePath('/onboarding');
  redirect(`/join/${appId}`);
}

/** The paper path: the same journey, filed by the adviser, watched by the client. */
export async function switchToPaper(formData: FormData): Promise<void> {
  const appId = Number(s(formData, 'application_id'));
  if (!application(appId)) return;
  setPaper(appId);
  redirect(`/join/${appId}`);
}
