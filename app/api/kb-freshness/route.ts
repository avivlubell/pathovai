export const runtime = 'nodejs';
export const revalidate = 60;

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

export async function GET() {
  const { data, error } = await supabaseAdmin.rpc('kb_freshness');

  if (error) {
    console.error('kb_freshness rpc', error);
    return NextResponse.json(
      { error: 'Failed to load KB freshness' },
      { status: 500 }
    );
  }

  // The RPC returns a single row (set-returning function exposed as a row).
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ last_updated_at: null, record_count: 0 });
  }

  return NextResponse.json({
    last_updated_at: row.last_updated_at ?? null,
    record_count:
      typeof row.record_count === 'number' ? row.record_count : 0,
  });
}
