'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { placeOrder, startSip, pauseSip } from '../../../lib/invest';
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
