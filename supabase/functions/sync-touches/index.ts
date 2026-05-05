import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Bulk variant of sync-touch-content. Iterates the entire Outreach Touches
// data source and upserts every page into public.touches. Mirrors the
// per-page mapping in sync-touch-content/index.ts — keep them in lockstep.
//
// Touches uses Notion's multi-data-source database feature (API >= 2025-09-03),
// so the bulk read goes against POST /v1/data_sources/{id}/query, not the
// legacy /v1/databases/{id}/query endpoint.

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

const TOUCHES_DATA_SOURCE_ID = "b10de04e-db6d-4c40-ae84-c4298743fe5b";

const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": "2025-09-03",
  "Content-Type": "application/json",
};

const stripDashes = (id: string): string => id.replace(/-/g, "");

function getProp(props: Record<string, any>, name: string, type: string): any {
  const prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title":
      return prop.title?.length ? prop.title.map((t: any) => t.plain_text).join("") : null;
    case "rich_text":
      return prop.rich_text?.length ? prop.rich_text.map((t: any) => t.plain_text).join("") : null;
    case "select":
      return prop.select?.name ?? null;
    case "multi_select":
      return prop.multi_select?.length ? prop.multi_select.map((o: any) => o.name) : [];
    case "checkbox":
      return prop.checkbox ?? false;
    case "date":
      return prop.date?.start ?? null;
    case "relation":
      return prop.relation?.length ? prop.relation.map((r: any) => r.id) : [];
    default:
      return null;
  }
}

function cleanRecord(record: Record<string, any>): Record<string, any> {
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return clean;
}

async function fetchAllTouchPages(): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(
      `https://api.notion.com/v1/data_sources/${TOUCHES_DATA_SOURCE_ID}/query`,
      {
        method: "POST",
        headers: NOTION_HEADERS,
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Notion query failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = await res.json();
    if (data.results) items.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

// Pre-load accounts indexed by Notion page ID. Avoids N round-trips during
// the per-row FK resolution. Mirrors the prefetch pattern in sync-prospects.
async function loadAccountIndex(): Promise<Map<string, { id: string; name: string }>> {
  const index = new Map<string, { id: string; name: string }>();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, notion_page_id");
  if (error) {
    throw new Error(`accounts prefetch failed: ${error.message}`);
  }
  for (const row of data || []) {
    if (row.notion_page_id) {
      index.set(row.notion_page_id, { id: row.id, name: row.company_name });
    }
  }
  return index;
}

function mapPageToRecord(
  page: any,
  accountIndex: Map<string, { id: string; name: string }>,
): Record<string, any> | null {
  if (page.in_trash || page.archived) return null;

  const props = page.properties || {};
  const pageIdStripped = stripDashes(page.id);

  // Per the agreed schema, the property is literally "Message " with a
  // trailing space (database history). Fall back to the trimmed form in
  // case it's ever renamed.
  const message = getProp(props, "Message ", "rich_text") ?? getProp(props, "Message", "rich_text");

  const relatedOutreach = getProp(props, "Related Outreach", "relation") as string[];
  const contactRelation = getProp(props, "Contact (Main)", "relation") as string[];

  let accountId: string | null = null;
  let accountName: string | null = null;
  if (relatedOutreach[0]) {
    const oiPageId = stripDashes(relatedOutreach[0]);
    const hit = accountIndex.get(oiPageId);
    if (hit) {
      accountId = hit.id;
      accountName = hit.name;
    }
  }

  return {
    notion_page_id: pageIdStripped,
    notion_url: page.url ?? `https://notion.so/${pageIdStripped}`,
    account_id: accountId,
    account_name: accountName,
    related_outreach_page_id: relatedOutreach[0] ? stripDashes(relatedOutreach[0]) : null,
    contact_notion_page_id: contactRelation[0] ? stripDashes(contactRelation[0]) : null,
    title: getProp(props, "Title", "title"),
    // Touch Date = planned-only (forward-looking, cleared after send)
    // Sent Touch Date = actual send date (manual property post 2026-05-05)
    touch_date: getProp(props, "Touch Date", "date"),
    sent_touch_date: getProp(props, "Sent Touch Date", "date"),
    channel: getProp(props, "Channel", "select"),
    sent: getProp(props, "Sent", "checkbox") ?? false,
    outcome: getProp(props, "Outcome", "select"),
    top_challenges: getProp(props, "Top Challenges", "multi_select") || [],
    message,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  let status = "success";
  let totalFound = 0;
  let syncedCount = 0;
  let skippedTrashed = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  try {
    const accountIndex = await loadAccountIndex();
    const pages = await fetchAllTouchPages();
    totalFound = pages.length;

    const records: Record<string, any>[] = [];
    for (const page of pages) {
      try {
        const record = mapPageToRecord(page, accountIndex);
        if (record === null) {
          skippedTrashed++;
          continue;
        }
        records.push(cleanRecord(record));
      } catch (e: any) {
        errorCount++;
        errorDetails.push(`map:${e.message}`);
      }
    }

    if (records.length > 0) {
      const result = await supabase
        .from("touches")
        .upsert(records, { onConflict: "notion_page_id" });
      if (result.error) {
        status = "partial";
        errorCount++;
        errorDetails.push(`upsert:${result.error.message}`);
      } else {
        syncedCount = records.length;
      }
    }
  } catch (e: any) {
    status = "error";
    errorCount++;
    errorDetails.push(e.message);
  }

  const completedAt = new Date();
  const durationMs = completedAt.getTime() - startedAt.getTime();

  try {
    await supabase.from("sync_log").insert({
      function_name: "sync-touches",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      total_pages_found: totalFound,
      inserted: 0,
      updated: syncedCount,
      errors: errorCount,
      error_details: errorDetails.length > 0 ? errorDetails : null,
      status,
      duration_ms: durationMs,
    });
  } catch (_e) {}

  return new Response(
    JSON.stringify({
      success: status !== "error",
      total_found: totalFound,
      synced: syncedCount,
      skipped_trashed: skippedTrashed,
      errors: errorCount,
      error_details: errorDetails,
      duration_ms: durationMs,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
