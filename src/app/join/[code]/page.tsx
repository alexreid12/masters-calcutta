export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { JoinForm } from './JoinForm';

export default async function JoinPage({ params }: { params: { code: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // Middleware redirects unauthenticated users to /login?next=/join/[code]
  if (!user) redirect(`/login?next=/join/${params.code}`);

  // Look up the pool by invite code
  const { data: pool } = await supabase
    .from('pools')
    .select('id, name, year, commissioner_id, join_password, profiles!commissioner_id(display_name)')
    .eq('invite_code', params.code)
    .maybeSingle();

  if (!pool) {
    return (
      <div className="min-h-screen bg-masters-green flex items-center justify-center px-4">
        <div className="bg-masters-cream rounded-2xl shadow-2xl p-10 max-w-md w-full text-center">
          <div className="w-12 h-1 bg-masters-gold rounded mx-auto mb-4" />
          <h1 className="font-display text-3xl text-masters-gold mb-6">Masters Calcutta</h1>
          <h2 className="font-display text-xl text-masters-green mb-2">Invalid Invite Link</h2>
          <p className="text-gray-500 text-sm">This invite link doesn&apos;t exist or has expired.</p>
          <Link href="/" className="btn-primary inline-block mt-6">Back to Home</Link>
        </div>
      </div>
    );
  }

  // Check if already a member → skip straight to the pool
  const { data: membership } = await supabase
    .from('pool_members')
    .select('id')
    .eq('pool_id', pool.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membership) redirect(`/pool/${pool.id}`);

  // No password required → join immediately and redirect
  if (!pool.join_password) {
    await supabase.from('pool_members').insert({ pool_id: pool.id, user_id: user.id });
    redirect(`/pool/${pool.id}`);
  }

  // Password required → render the client form
  const commissionerName = (pool as any).profiles?.display_name ?? 'Unknown';

  return (
    <JoinForm
      poolId={pool.id}
      poolName={pool.name}
      poolYear={pool.year}
      commissionerName={commissionerName}
    />
  );
}
