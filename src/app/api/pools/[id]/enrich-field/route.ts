import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// Masters 2025 field: [name, world_ranking | null, is_amateur]
const FIELD_DATA: [string, number | null, boolean][] = [
  ['Scottie Scheffler', 1, false],
  ['Rory McIlroy', 2, false],
  ['Cameron Young', 3, false],
  ['Tommy Fleetwood', 4, false],
  ['Xander Schauffele', 5, false],
  ['Matt Fitzpatrick', 6, false],
  ['Justin Rose', 7, false],
  ['Collin Morikawa', 8, false],
  ['Russell Henley', 9, false],
  ['Chris Gotterup', 10, false],
  ['Robert MacIntyre', 11, false],
  ['Sepp Straka', 12, false],
  ['J.J. Spaun', 13, false],
  ['Hideki Matsuyama', 14, false],
  ['Justin Thomas', 15, false],
  ['Ben Griffin', 16, false],
  ['Jacob Bridgeman', 17, false],
  ['Ludvig Aberg', 18, false],
  ['Alex Noren', 19, false],
  ['Harris English', 20, false],
  ['Viktor Hovland', 21, false],
  ['Akshay Bhatia', 22, false],
  ['Patrick Reed', 23, false],
  ['Bryson DeChambeau', 24, false],
  ['Keegan Bradley', 25, false],
  ['Maverick McNealy', 26, false],
  ['Ryan Gerard', 27, false],
  ['Jon Rahm', 28, false],
  ['Si Woo Kim', 29, false],
  ['Tyrrell Hatton', 30, false],
  ['Min Woo Lee', 31, false],
  ['Shane Lowry', 32, false],
  ['Sam Burns', 33, false],
  ['Patrick Cantlay', 34, false],
  ['Kurt Kitayama', 35, false],
  ['Marco Penge', 36, false],
  ['Daniel Berger', 37, false],
  ['Nico Echavarria', 38, false],
  ['Aaron Rai', 39, false],
  ['Corey Conners', 40, false],
  ['Jason Day', 41, false],
  ['Jake Knapp', 42, false],
  ['Michael Brennan', 43, false],
  ['Matt McCarty', 44, false],
  ['Ryan Fox', 45, false],
  ['Brian Harman', 46, false],
  ['Nicolai Hojgaard', 47, false],
  ['Kristoffer Reitan', 48, false],
  ['Andrew Novak', 49, false],
  ['Sam Stevens', 50, false],
  ['Sergio Garcia', null, false],
  ['Angel Cabrera', null, false],
  ['Fred Couples', null, false],
  ['Dustin Johnson', null, false],
  ['Zach Johnson', null, false],
  ['Brooks Koepka', null, false],
  ['Cameron Smith', null, false],
  ['Adam Scott', null, false],
  ['Charl Schwartzel', null, false],
  ['Bubba Watson', null, false],
  ['Mike Weir', null, false],
  ['Danny Willett', null, false],
  ['Jose Maria Olazabal', null, false],
  ['Vijay Singh', null, false],
  ['Jordan Spieth', null, false],
  ['Im Sung-jae', null, false],
  ['Nick Taylor', null, false],
  ['Tom McKibbin', null, false],
  ['Max Greyserman', null, false],
  ['Harry Hall', null, false],
  ['Max Homa', null, false],
  ['Haotong Li', null, false],
  ['Michael Kim', null, false],
  ['Davis Riley', null, false],
  ['Carlos Ortiz', null, false],
  ['Aldrich Potgieter', null, false],
  ['Rasmus Hojgaard', null, false],
  ['Gary Woodland', null, false],
  ['Sami Valimaki', null, false],
  ['Brian Campbell', null, false],
  ['Johnny Keefer', null, false],
  ['Ethan Fang', null, true],
  ['Jackson Herrington', null, true],
  ['Brandon Holtz', null, true],
  ['Mason Howell', null, true],
  ['Casey Jarvis', null, true],
  ['Fifa Laopakdee', null, true],
  ['Naoyuki Kataoka', null, true],
  ['Mateo Pulcini', null, true],
  ['Rasmus Neergaard-Petersen', null, true],
];

function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '') // strip punctuation
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

  const { data: golfers } = await supabase
    .from('golfers')
    .select('id, name')
    .eq('pool_id', params.id);

  const byNormalizedName = new Map(
    (golfers ?? []).map((g) => [normalize(g.name), g.id])
  );

  const updated: string[] = [];
  const notFound: string[] = [];

  for (const [name, ranking, isAmateur] of FIELD_DATA) {
    const golferId = byNormalizedName.get(normalize(name)) ?? null;
    if (!golferId) {
      notFound.push(name);
      continue;
    }
    await supabase
      .from('golfers')
      .update({ world_ranking: ranking, is_amateur: isAmateur })
      .eq('id', golferId);
    updated.push(name);
  }

  return NextResponse.json({
    updated: updated.length,
    notFound: notFound.length,
    updatedNames: updated,
    notFoundNames: notFound,
  });
}
