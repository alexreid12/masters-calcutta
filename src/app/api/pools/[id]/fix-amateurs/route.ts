import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const AMATEURS = [
  'Ethan Fang',
  'Jackson Herrington',
  'Brandon Holtz',
  'Mason Howell',
  'Fifa Laopakdee',
  'Mateo Pulcini',
];

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: pool } = await supabase
    .from('pools')
    .select('commissioner_id')
    .eq('id', params.id)
    .single();

  if (!pool) return NextResponse.json({ error: 'Pool not found' }, { status: 404 });
  if (pool.commissioner_id !== user.id)
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 });

  // Step 1: reset everyone to false
  const { error: resetError } = await supabase
    .from('golfers')
    .update({ is_amateur: false })
    .eq('pool_id', params.id);

  if (resetError) return NextResponse.json({ error: resetError.message }, { status: 500 });

  // Step 2: load golfers and match amateurs by normalized name
  const { data: golfers } = await supabase
    .from('golfers')
    .select('id, name')
    .eq('pool_id', params.id);

  const byNorm = new Map((golfers ?? []).map((g) => [normalize(g.name), g.id]));

  const matched: string[] = [];
  const notFound: string[] = [];

  for (const name of AMATEURS) {
    const id = byNorm.get(normalize(name)) ?? null;
    if (!id) {
      notFound.push(name);
      continue;
    }
    await supabase.from('golfers').update({ is_amateur: true }).eq('id', id);
    matched.push(name);
  }

  return NextResponse.json({ reset: golfers?.length ?? 0, matched, notFound });
}
