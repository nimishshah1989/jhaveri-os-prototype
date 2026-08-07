import { notFound } from 'next/navigation';

// Every broker-lens page is built. The Ops and Management lenses land here next.
const STUBS: Record<string, string> = {};

export default async function StubPage({ params }: PageProps<'/[stub]'>) {
  const { stub } = await params;
  const title = STUBS[stub];
  if (!title) notFound();
  return (
    <div className="stub">
      <h1>{title}</h1>
      <p>Not built yet.</p>
    </div>
  );
}
