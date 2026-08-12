import { cookies } from 'next/headers';

// How much of the explanation is open, for this reader, on every page.
//
// Management asked for depth that is "not hidden but open to exploration". The ⓘ
// with a word beside it answers the first half; this answers the second. Nothing
// is added or removed by the switch — every explanation on the product is already
// written and already on the page. Essential leaves them folded behind their own
// label; Full unfolds all of them in place, so a reader who wants the reasoning
// reads straight down the page instead of clicking twenty times to find it.
//
// Remembered per reader rather than per session: the founder's call. A cookie is
// the whole of it in the prototype — when there are real accounts this moves to a
// column on the user, and the only thing that changes is this file.

export type Density = 'essential' | 'full';

export const DENSITY_COOKIE = 'jos_density';

export async function density(): Promise<Density> {
  const jar = await cookies();
  return jar.get(DENSITY_COOKIE)?.value === 'full' ? 'full' : 'essential';
}
