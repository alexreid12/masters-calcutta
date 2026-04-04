export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { PoolNav } from '@/components/PoolNav';
import { redirect, notFound } from 'next/navigation';

export default async function PoolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { id: string };
}) {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/pool/${params.id}`);

  const { data: pool, error } = await supabase
    .from('pools')
    .select('id, name, status, total_pot, commissioner_id')
    .eq('id', params.id)
    .single();

  if (error || !pool) notFound();

  return (
    <div className="min-h-screen bg-masters-cream">
      <PoolNav
        poolId={pool.id}
        status={pool.status}
        isCommissioner={user.id === pool.commissioner_id}
        poolName={pool.name}
        totalPot={pool.total_pot}
      />
      <main className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
