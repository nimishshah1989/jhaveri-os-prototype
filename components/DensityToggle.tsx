import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { DENSITY_COOKIE, density } from '../lib/density';

// One control, in the header, on every page. Two submit buttons rather than a
// select: the reader can see both states and which one is on without opening
// anything, and it works with JavaScript off because it is a form.

async function choose(formData: FormData): Promise<void> {
  'use server';
  const to = formData.get('to') === 'full' ? 'full' : 'essential';
  const jar = await cookies();
  jar.set(DENSITY_COOKIE, to, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  });
  // Every page reads this, and the layout paints the attribute the CSS keys off.
  revalidatePath('/', 'layout');
}

export async function DensityToggle(): Promise<React.ReactElement> {
  const now = await density();
  return (
    <form action={choose} className="density" aria-label="How much explanation to show">
      <span className="dlabel">Detail</span>
      {(['essential', 'full'] as const).map(to => (
        <button key={to} type="submit" name="to" value={to}
          className={now === to ? 'on' : undefined}
          aria-pressed={now === to}
          title={to === 'full'
            ? 'Open every explanation in place, on every page'
            : 'Keep explanations folded behind their own label'}>
          {to === 'full' ? 'Full' : 'Essential'}
        </button>
      ))}
    </form>
  );
}
