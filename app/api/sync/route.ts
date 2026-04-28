import { NextResponse } from 'next/server';

const SUPABASE_FUNCTIONS_BASE = 'https://urmgbmfvjuozvhigflqt.supabase.co/functions/v1';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const NOTION_INTEGRATION_TOKEN = process.env.NOTION_INTEGRATION_TOKEN || '';
// Notion API version 2025-09-03 supports multi-data-source databases (Outreach
// Touches uses this format). Older versions return 400 on Touches reads.
const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_INTEGRATION_TOKEN}`,
  'Notion-Version': '2025-09-03',
};

type RouteDecision =
  | { kind: 'accounts'; dbTitle: string }
  | { kind: 'touches'; dbTitle: string }
  | { kind: 'unknown'; dbTitle: string }
  | { kind: 'error'; reason: string };

// Look up the page's parent database and decide which sync to run.
// Routing prevents Outreach Touches pages from polluting the accounts
// table via the legacy single-endpoint sync. Touches sync ships in Phase 3.
async function resolveRoute(pageId: string): Promise<RouteDecision> {
  const pageRes = await fetch(`https://api.notion.com/v1/pages/${pageId}`, { headers: NOTION_HEADERS });
  if (!pageRes.ok) {
    return { kind: 'error', reason: `Notion page lookup failed: ${pageRes.status}` };
  }
  const page = await pageRes.json();
  const parentDbId = page?.parent?.database_id;
  if (!parentDbId) {
    return { kind: 'error', reason: 'Page is not inside a Notion database' };
  }

  const dbRes = await fetch(`https://api.notion.com/v1/databases/${parentDbId}`, { headers: NOTION_HEADERS });
  if (!dbRes.ok) {
    return { kind: 'error', reason: `Notion database lookup failed: ${dbRes.status}` };
  }
  const db = await dbRes.json();
  const dbTitle = ((db?.title || []) as Array<{ plain_text?: string }>)
    .map(t => t.plain_text || '')
    .join('');
  const t = dbTitle.toLowerCase();

  if (t.includes('outreach intelligence') || t.includes('account')) {
    return { kind: 'accounts', dbTitle };
  }
  if (t.includes('touches') || t.includes('touch')) {
    return { kind: 'touches', dbTitle };
  }
  return { kind: 'unknown', dbTitle };
}

async function callSyncFunction(fn: 'sync-prospect-content' | 'sync-touch-content', pageId: string) {
  const res = await fetch(`${SUPABASE_FUNCTIONS_BASE}/${fn}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({ notion_page_id: pageId }),
  });
  return { res, data: await res.json() };
}

const htmlPage = (title: string, body: string, color = 'green'): string =>
  `<html><body style="font-family:sans-serif;padding:40px;text-align:center;max-width:600px;margin:auto">
    <h2 style="color:${color}">${title}</h2>
    ${body}
    <p style="color:#888;margin-top:24px">You can close this tab.</p>
  </body></html>`;

// GET handler - triggered by Notion Sync URL formula clicks
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const page_id = searchParams.get('page_id');

  if (!page_id) {
    return NextResponse.json({ error: 'page_id is required' }, { status: 400 });
  }

  try {
    const route = await resolveRoute(page_id);

    if (route.kind === 'error') {
      return new NextResponse(
        htmlPage('Sync failed', `<p>${route.reason}</p><p><code>${page_id}</code></p>`, '#c00'),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    if (route.kind === 'unknown') {
      return new NextResponse(
        htmlPage(
          'Unknown source database',
          `<p>This page is in a database we don't have a sync handler for: <code>${route.dbTitle}</code>.</p>
           <p>Expected "Outreach Intelligence" or "Outreach Touches".</p>`,
          '#c00'
        ),
        { status: 400, headers: { 'Content-Type': 'text/html' } }
      );
    }

    const fn = route.kind === 'touches' ? 'sync-touch-content' : 'sync-prospect-content';
    const { res, data } = await callSyncFunction(fn, page_id);
    if (!res.ok) {
      return new NextResponse(
        htmlPage('Sync failed', `<pre style="text-align:left;background:#f8f8f8;padding:12px">${JSON.stringify(data, null, 2)}</pre>`, '#c00'),
        { status: res.status, headers: { 'Content-Type': 'text/html' } },
      );
    }

    const summary = route.kind === 'touches'
      ? `Touch <code>${data.title || page_id}</code> synced` +
        (data.account_name ? ` (account: <strong>${data.account_name}</strong>)` : ' (no parent account resolved)')
      : `Account <code>${data.company || page_id}</code> synced`;

    return new NextResponse(
      htmlPage('Sync triggered successfully', `<p>${summary}</p>`),
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
    const page_id = body?.data?.id || body?.page_id || body?.id;

    if (!page_id) {
      return NextResponse.json({ error: 'Could not extract page_id from webhook payload' }, { status: 400 });
    }

    const route = await resolveRoute(page_id);

    if (route.kind === 'error') {
      return NextResponse.json({ success: false, error: route.reason }, { status: 400 });
    }
    if (route.kind === 'unknown') {
      return NextResponse.json(
        { success: false, error: 'Unknown source database', db: route.dbTitle },
        { status: 400 }
      );
    }
    const fn = route.kind === 'touches' ? 'sync-touch-content' : 'sync-prospect-content';
    const { res, data } = await callSyncFunction(fn, page_id);
    return NextResponse.json({ success: res.ok, data }, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: 'Webhook handler failed', details: String(err) }, { status: 500 });
  }
}
