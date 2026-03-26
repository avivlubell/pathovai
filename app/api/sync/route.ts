import { NextResponse } from 'next/server';

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// GET handler - triggered by Notion Sync URL formula clicks
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page_id = searchParams.get('page_id');

  if (!page_id) {
    return NextResponse.json({ error: 'page_id is required' }, { status: 400 });
  }

  try {
    const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ notion_page_id: page_id }),
    });

    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json({ error: 'Sync failed', details: data }, { status: res.status });
    }

    // Return a simple HTML success page so the Notion click feels responsive
    return new NextResponse(
      `<html><body style="font-family:sans-serif;padding:40px;text-align:center">
        <h2>Sync triggered successfully</h2>
        <p>Prospect with page ID <code>${page_id}</code> is syncing to Supabase.</p>
        <p style="color:green">You can close this tab.</p>
      </body></html>`,
      { status: 200, headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err) {
    return NextResponse.json({ error: 'Sync request failed', details: String(err) }, { status: 500 });
  }
}

// POST handler - triggered by Notion webhook automation
export async function POST(req: Request) {
  try {
    const body = await req.json();
    // Notion webhook sends page data - extract the page ID
    const page_id = body?.data?.id || body?.page_id || body?.id;

    if (!page_id) {
      return NextResponse.json({ error: 'Could not extract page_id from webhook payload' }, { status: 400 });
    }

    const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/sync-prospect-content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ notion_page_id: page_id }),
    });

    const data = await res.json();
    return NextResponse.json({ success: res.ok, data }, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: 'Webhook handler failed', details: String(err) }, { status: 500 });
  }
}
