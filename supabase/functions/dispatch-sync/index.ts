import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const NOTION_TOKEN = Deno.env.get('NOTION_INTEGRATION_TOKEN')!;

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  'Notion-Version': '2025-09-03',
};

type RouteDecision =
  | { kind: 'accounts'; dbTitle: string }
  | { kind: 'touches'; dbTitle: string }
  | { kind: 'unknown'; dbTitle: string }
  | { kind: 'error'; reason: string };

// Pure routing-decision endpoint. Looks up a Notion page's parent
// database and returns which sync function the caller should invoke.
// Lives here (instead of in the Vercel /api/sync route) so the
// NOTION_INTEGRATION_TOKEN secret stays in Supabase's environment and
// doesn't need to be wired into Vercel.
//
// Intentionally does NOT call sync-prospect-content / sync-touch-content
// from here. Inter-edge-function calls hit auth-format mismatches with
// the new sb_secret_xxx key that Supabase auto-injects, and routing this
// path through Vercel keeps the working call pattern (legacy JWT in the
// Next.js env -> sync function) unchanged.
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
    .map((t) => t.plain_text || '')
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const { notion_page_id } = await req.json();
    if (!notion_page_id) {
      return json({ kind: 'error', reason: 'notion_page_id is required' }, 400);
    }

    const route = await resolveRoute(notion_page_id);
    const status = route.kind === 'error' ? 400 : 200;
    return json(route, status);
  } catch (err: any) {
    return json({ kind: 'error', reason: String(err?.message || err) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
