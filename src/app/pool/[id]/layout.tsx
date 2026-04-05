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
    .select('id, name, status, total_pot, commissioner_id, is_private')
    .eq('id', params.id)
    .single();

  if (error || !pool) notFound();

  // Private pools: gate to members only
  if (pool.is_private) {
    const { data: membership } = await supabase
      .from('pool_members')
      .select('id')
      .eq('pool_id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return (
        <div className="min-h-screen bg-masters-cream flex items-center justify-center px-4">
          <div className="card text-center py-12 max-w-md w-full">
            <h2 className="font-display text-xl text-masters-green mb-2">Private Pool</h2>
            <p className="text-gray-500 text-sm">You need an invite link to access this pool.</p>
            <p className="text-gray-400 text-xs mt-2">Ask the commissioner to share their invite link with you.</p>
          </div>
        </div>
      );
    }
  }

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
