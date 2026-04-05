export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { StatusBadge, Money, cn } from '@/components/ui';
import type { Pool } from '@/types/database';
import { redirect } from 'next/navigation';
import { TopNav } from '@/components/TopNav';

export default async function HomePage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  // Load profile separately — don't crash if profiles table isn't migrated yet
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, is_commissioner')
    .eq('id', user.id)
    .maybeSingle();

  // Get pools the current user is a member of
  const { data: memberships } = await supabase
    .from('pool_members')
    .select('pool_id')
    .eq('user_id', user.id);

  const memberPoolIds = (memberships ?? []).map((m: any) => m.pool_id as string);

  // Show public pools + any private pool the user is a member of
  const poolQuery = supabase
    .from('pools')
    .select('*, profiles!commissioner_id(display_name)')
    .order('created_at', { ascending: false });

  const { data: pools } = await (
    memberPoolIds.length > 0
      ? poolQuery.or(`is_private.eq.false,id.in.(${memberPoolIds.join(',')})`)
      : poolQuery.eq('is_private', false)
  );

  return (
    <div className="min-h-screen bg-masters-cream">
      <TopNav
        displayName={profile?.display_name ?? user.email ?? 'You'}
        isCommissioner={profile?.is_commissioner ?? false}
      />

      {/* Hero Banner */}
      <div className="bg-masters-green text-white">
        <div className="max-w-5xl mx-auto px-4 py-10 flex flex-col items-center text-center">
          <div className="w-16 h-1 bg-masters-gold rounded mb-4" />
          <h1 className="font-display text-4xl md:text-5xl font-semibold text-masters-gold">
            Masters Calcutta Pool
          </h1>
          <p className="mt-3 text-masters-cream/80 text-lg max-w-xl">
            Auction-style fantasy golf for The Masters Tournament.
            Bid on players, watch the leaderboard, claim your winnings.
          </p>
          <div className="mt-6">
            <Link href="/pool/new" className="btn-gold">
              + Create Pool
            </Link>
          </div>
        </div>
      </div>

      {/* Pool list */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display text-2xl text-masters-green">Your Pools</h2>
          <Link href="/pool/new" className="btn-primary text-sm">
            + Create Pool
          </Link>
        </div>

        {!pools || pools.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500 text-lg">No pools yet.</p>
            <p className="text-gray-400 mt-1">Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {(pools as (Pool & { profiles: { display_name: string } })[]).map((pool) => (
              <Link
                key={pool.id}
                href={`/pool/${pool.id}`}
                className="card hover:shadow-md hover:border-masters-gold/40 transition-all group"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-display text-lg text-masters-green group-hover:text-masters-green-dark font-semibold">
                      {pool.name}
                    </h3>
                    {pool.is_private && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-100 text-gray-500">
                        Private
                      </span>
                    )}
                  </div>
                  <StatusBadge status={pool.status} />
                </div>
                <p className="text-sm text-gray-500 mb-3">
                  {pool.year} · by {pool.profiles?.display_name}
                </p>
                <div className="text-sm">
                  <p className="text-gray-400 text-xs">Prize Pot</p>
                  <Money amount={pool.total_pot} className="text-masters-green font-semibold" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
