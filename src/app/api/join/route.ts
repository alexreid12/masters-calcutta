import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { pool_id, password } = await req.json();
  if (!pool_id) return NextResponse.json({ error: 'pool_id required' }, { status: 400 });

  // Fetch the pool — password check is server-side only so it's never exposed to client
  const { data: pool } = await supabase
    .from('pools')
    .select('id, join_password')
    .eq('id', pool_id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });

  if (pool.join_password && pool.join_password !== password) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
  }

  const { error } = await supabase
    .from('pool_members')
    .insert({ pool_id, user_id: user.id });

  if (error) {
    // 23505 = unique violation — already a member, treat as success
    if (error.code === '23505') return NextResponse.json({ success: true });
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
