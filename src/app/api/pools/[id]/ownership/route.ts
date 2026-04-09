import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

/** GET — returns all profiles (for dropdown) + current pool ownership */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id')
    .eq('id', params.id)
    .single();
  if (pool?.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const serviceClient = createServiceClient();
  const [profilesRes, ownershipRes] = await Promise.all([
    serviceClient
      .from('profiles')
      .select('id, display_name, email')
      .order('display_name'),
    serviceClient
      .from('ownership')
      .select('golfer_id, user_id, purchase_price, acquired_via')
      .eq('pool_id', params.id),
  ]);

  return NextResponse.json({
    profiles: profilesRes.data ?? [],
    ownership: ownershipRes.data ?? [],
  });
}

/** PUT — apply manual ownership changes for one or more golfers */
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id')
    .eq('id', params.id)
    .single();
  if (pool?.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  const body = await req.json();
  const changes: { golfer_id: string; user_id: string | null; purchase_price: number | null }[] =
    body.changes;

  if (!Array.isArray(changes) || changes.length === 0)
    return NextResponse.json({ error: 'No changes provided' }, { status: 400 });

  const serviceClient = createServiceClient();
  let updatedCount = 0;

  for (const change of changes) {
    const { golfer_id, user_id, purchase_price } = change;

    if (!user_id) {
      // Remove ownership
      const { error } = await serviceClient
        .from('ownership')
        .delete()
        .eq('pool_id', params.id)
        .eq('golfer_id', golfer_id);
      if (error) return NextResponse.json({ error: `Delete failed for golfer ${golfer_id}: ${error.message}` }, { status: 500 });
    } else {
      const { data: existing, error: selectError } = await serviceClient
        .from('ownership')
        .select('id')
        .eq('pool_id', params.id)
        .eq('golfer_id', golfer_id)
        .maybeSingle();
      if (selectError) return NextResponse.json({ error: `Lookup failed for golfer ${golfer_id}: ${selectError.message}` }, { status: 500 });

      if (existing) {
        const { error } = await serviceClient
          .from('ownership')
          .update({ user_id, purchase_price: purchase_price ?? 0 })
          .eq('id', existing.id);
        if (error) return NextResponse.json({ error: `Update failed for golfer ${golfer_id}: ${error.message}` }, { status: 500 });
      } else {
        const { error } = await serviceClient.from('ownership').insert({
          pool_id: params.id,
          golfer_id,
          user_id,
          purchase_price: purchase_price ?? 0,
          acquired_via: 'manual',
        });
        if (error) return NextResponse.json({ error: `Insert failed for golfer ${golfer_id}: ${error.message}` }, { status: 500 });
      }
    }
    updatedCount++;
  }

  // Recalculate pot from all current ownership records
  const { data: allOwnership } = await serviceClient
    .from('ownership')
    .select('purchase_price')
    .eq('pool_id', params.id);
  const newPot = (allOwnership ?? []).reduce((sum, o: any) => sum + Number(o.purchase_price), 0);
  await serviceClient.from('pools').update({ total_pot: newPot }).eq('id', params.id);

  return NextResponse.json({ updated: updatedCount });
}
