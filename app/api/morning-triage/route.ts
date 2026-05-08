export const maxDuration = 60;
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/morning-triage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(55000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : 500 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
