import { notFound } from 'next/navigation';
import { db } from '../../../lib/db';

export default async function Client360Stub({ params }: PageProps<'/clients/[clientId]'>) {
  const { clientId } = await params;
  const row = db().prepare('SELECT cm_full_name name FROM client_master WHERE cm_user_id=?').get(Number(clientId)) as { name: string } | undefined;
  if (!row) notFound();
  return (
    <div className="stub">
      <h1>{row.name} — Client 360</h1>
      <p>Not built yet — page 3 of the broker lens: overview, holdings with tax lots, transactions, SIPs, family, actions. Next on the build list.</p>
    </div>
  );
}
