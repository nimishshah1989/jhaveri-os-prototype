'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { placeOrder, startSip, pauseSip } from '../../../lib/invest';
import { placeSwitch, startPlan, stepUp, stopPlan } from '../../../lib/exec';
import { applyNfo, createMandate, renewMandate, setDividendOption } from '../../../lib/mandate';
import { whoami } from '../../../lib/whoami';

/* The client acting on their own money. Identity is resolved on the server by
   `whoami()` and never read from the form — the same rule the rest of the lens
   follows, and the one that matters most on the page that moves money. */

const s = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const money = (f: FormData, k: string) => Math.round(Number(s(f, k)) || 0);

export async function invest(formData: FormData): Promise<void> {
  const clientId = whoami();
  const schemeId = Number(s(formData, 'scheme'));
  const amount = money(formData, 'amount');
  const goalId = Number(s(formData, 'goal')) || undefined;
  const monthly = s(formData, 'monthly') === '1';
  const day = Number(s(formData, 'day')) || 5;

  if (!schemeId || amount <= 0) {
    redirect(`/me/invest?e=${encodeURIComponent('Choose a fund and an amount.')}`);
  }

  const done = monthly
    ? startSip(clientId, schemeId, amount, day, goalId)
    : placeOrder({ clientId, schemeId, kind: 'PURCHASE', amount, goalId });

  if (!done.ok) {
    redirect(`/me/invest?scheme=${schemeId}&e=${encodeURIComponent(done.reason)}`);
  }

  revalidatePath('/me');
  revalidatePath('/me/goals');
  revalidatePath('/me/portfolio');
  redirect(monthly ? '/me/orders?started=1' : `/me/orders?placed=${'order' in done ? done.order.order_id : ''}`);
}

export async function redeem(formData: FormData): Promise<void> {
  const clientId = whoami();
  const schemeId = Number(s(formData, 'scheme'));
  const amount = money(formData, 'amount');
  if (!schemeId || amount <= 0) redirect('/me/portfolio');

  const done = placeOrder({ clientId, schemeId, kind: 'REDEMPTION', amount });
  if (!done.ok) {
    redirect(`/me/invest?scheme=${schemeId}&kind=redeem&e=${encodeURIComponent(done.reason)}`);
  }
  revalidatePath('/me');
  revalidatePath('/me/portfolio');
  redirect(`/me/orders?placed=${done.order.order_id}`);
}

export async function stopSip(formData: FormData): Promise<void> {
  const clientId = whoami();
  const sipId = Number(s(formData, 'sip'));
  const why = s(formData, 'why') || 'Paused from the app';
  if (sipId) pauseSip(clientId, sipId, why);
  revalidatePath('/me/orders');
  redirect('/me/orders');
}

/* ── Execution parity (phase 5) ───────────────────────────────────────────────
   The instruments a client can use anywhere else. Same shape as the two above:
   validate, call the library, redirect to the receipt. The library owns every
   row that gets written, so the verifier can walk the same path without a
   browser — and `whoami()` owns identity, never the form. */

export async function switchFunds(formData: FormData): Promise<void> {
  const clientId = whoami();
  const from = Number(formData.get('from'));
  const to = Number(formData.get('to'));
  const amount = Math.round(Number(formData.get('amount')));
  if (!from || !to || !Number.isFinite(amount) || amount <= 0) return;

  const done = placeSwitch(clientId, from, to, amount);
  if (!done.ok) redirect(`/me/invest?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me');
  revalidatePath('/me/portfolio');
  redirect(`/me/orders?switched=${done.result.out_id}`);
}

export async function startTransferPlan(formData: FormData): Promise<void> {
  const clientId = whoami();
  const kind = String(formData.get('kind') ?? '') as 'STP' | 'SWP';
  if (kind !== 'STP' && kind !== 'SWP') return;
  const from = Number(formData.get('from'));
  const to = kind === 'STP' ? Number(formData.get('to')) : null;
  const amount = Math.round(Number(formData.get('amount')));
  const day = Number(formData.get('day'));
  if (!from || !Number.isFinite(amount) || amount <= 0) return;

  const done = startPlan(clientId, kind, from, to, amount, day);
  if (!done.ok) redirect(`/me/invest?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me/orders');
  redirect(`/me/orders?plan=${kind}`);
}

export async function setStepUp(formData: FormData): Promise<void> {
  const clientId = whoami();
  const sipId = Number(formData.get('sip'));
  const by = Math.round(Number(formData.get('by')));
  const every = Number(formData.get('every'));
  if (!sipId || !Number.isFinite(by)) return;

  const done = stepUp(clientId, sipId, by, every);
  if (!done.ok) redirect(`/me/orders?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me/orders');
  redirect(`/me/orders?stepped=${done.in_a_year}`);
}

export async function endPlan(formData: FormData): Promise<void> {
  const clientId = whoami();
  const sipId = Number(formData.get('sip'));
  if (!sipId) return;
  stopPlan(clientId, sipId, String(formData.get('why') ?? 'Client stopped it from the app').slice(0, 200));
  revalidatePath('/me/orders');
  redirect('/me/orders');
}

export async function applyToNfo(formData: FormData): Promise<void> {
  const clientId = whoami();
  const schemeId = Number(formData.get('scheme'));
  const amount = Math.round(Number(formData.get('amount')));
  if (!schemeId || !Number.isFinite(amount) || amount <= 0) return;

  const done = applyNfo(clientId, schemeId, amount);
  if (!done.ok) redirect(`/me/invest?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me/orders');
  redirect(`/me/orders?nfo=${encodeURIComponent(done.allots_on)}`);
}

export async function newMandate(formData: FormData): Promise<void> {
  const clientId = whoami();
  const bank = String(formData.get('bank') ?? '').trim();
  const cap = Math.round(Number(formData.get('cap')));
  const done = createMandate(clientId, bank, cap);
  if (!done.ok) redirect(`/me/orders?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me/orders');
  redirect(`/me/orders?mandate=${encodeURIComponent(done.umrn)}`);
}

export async function renewTheMandate(formData: FormData): Promise<void> {
  const clientId = whoami();
  const exchId = Number(formData.get('exch'));
  if (!exchId) return;
  const done = renewMandate(clientId, exchId);
  if (!done.ok) redirect(`/me/orders?e=${encodeURIComponent(done.reason)}`);
  revalidatePath('/me/orders');
  redirect(`/me/orders?mandate=${encodeURIComponent(done.umrn)}`);
}

export async function chooseDividend(formData: FormData): Promise<void> {
  const clientId = whoami();
  const folio = String(formData.get('folio') ?? '');
  const schemeId = Number(formData.get('scheme'));
  const option = String(formData.get('option') ?? '') as 'growth' | 'payout' | 'reinvest';
  setDividendOption(clientId, folio, schemeId, option);
  revalidatePath('/me/desk');
  redirect('/me/desk');
}
