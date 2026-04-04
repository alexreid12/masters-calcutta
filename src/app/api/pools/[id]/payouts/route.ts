import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { calculatePayouts } from '@/lib/payout-engine';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const [leaderRes, ownerRes, rulesRes, scoresRes, golfersRes] = await Promise.all([
    supabase.from('leaderboard').select('*').eq('pool_id', params.id),
    supabase.from('ownership').select('*').eq('pool_id', params.id),
    supabase.from('payout_rules').select('*').eq('pool_id', params.id).eq('is_active', true),
    supabase.from('scores').select('*').eq('pool_id', params.id),
    supabase.from('golfers').select('*').eq('pool_id', params.id),
  ]);

  if (!leaderRes.data || !ownerRes.data || !rulesRes.data)
    return NextResponse.json({ error: 'Data load failed' }, { status: 500 });

  const results = calculatePayouts({
    totalPot: pool.total_pot,
    leaderboard: leaderRes.data,
    rules: rulesRes.data,
    ownerships: ownerRes.data,
    scores: scoresRes.data ?? [],
    golfers: golfersRes.data ?? [],
  });

  await supabase.from('payouts').delete().eq('pool_id', params.id);

  if (results.length > 0) {
    const { error } = await supabase.from('payouts').insert(
      results.map((r) => ({
        pool_id: params.id,
        user_id: r.owner_id,
        golfer_id: r.golfer_id,
        finish_position: r.finish_position,
        payout_rule_id: r.payout_rule_id,
        rule_type: r.rule_type,
        payout_amount: r.payout_amount,
        net_profit: r.net_profit,
        purchase_price: r.purchase_price,
        award_score: r.award_score ?? null,
        award_round: r.award_round ?? null,
        award_label: r.award_label,
        applied_percentage: r.applied_percentage,
      }))
    );
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ results });
}
