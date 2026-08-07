import { notFound } from 'next/navigation';

const STUBS: Record<string, string> = {
  business: 'My business',
  marketing: 'Marketing',
  'review-packs': 'Review pack',
};

export default async function StubPage({ params }: PageProps<'/[stub]'>) {
  const { stub } = await params;
  const title = STUBS[stub];
  if (!title) notFound();
  return (
    <div className="stub">
      <h1>{title}</h1>
      <p>Not built yet — page {Object.keys(STUBS).indexOf(stub) + 6} of the 8-page broker lens. Today, My clients, Client 360, Onboarding and My earnings ship first; this one follows on the same foundation.</p>
    </div>
  );
}
