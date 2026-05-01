// sync-intelligence — pulls the two Notion databases nested under the
// "📡 Market Intelligence Briefings" page into Supabase. Two-pass:
//   1) Intelligence Scans  → public.intelligence_scans
//   2) Industry Intelligence → public.industry_intelligence
// (items second so their scan_notion_page_id FK is satisfied).
//
// Modeled on supabase/functions/sync-companies. Run weekly (Sunday after the
// scanner writes new rows), or on demand via dispatch-sync.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

const SCANS_DB_ID = "1fd4e59e2dde4e90a0f326cb80dbe83e";
const ITEMS_DB_ID = "d0c5b57b71b9437697a5b700ca309c0b";

const NOTION_HEADERS = {
  "Authorization": "Bearer " + NOTION_TOKEN,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

function stripDashes(id: string): string {
  return id.replace(/-/g, "");
}

function getProp(props: any, name: string, type: string): any {
  const prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title": return prop.title?.map((t: any) => t.plain_text).join("") || null;
    case "rich_text": return prop.rich_text?.map((t: any) => t.plain_text).join("") || null;
    case "select": return prop.select?.name || null;
    case "status": return prop.status?.name || null;
    case "multi_select": return prop.multi_select?.map((s: any) => s.name) || [];
    case "number": return prop.number ?? null;
    case "url": return prop.url || null;
    case "date": return prop.date?.start || null;
    case "checkbox": return prop.checkbox ?? null;
    case "unique_id": return prop.unique_id?.number ?? null;
    case "relation": return prop.relation?.map((r: any) => stripDashes(r.id)) || [];
    default: return null;
  }
}

function cleanRecord(record: any): any {
  const clean: any = {};
  for (const [k, v] of Object.entries(record)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return clean;
}

async function fetchAllPages(dbId: string): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch("https://api.notion.com/v1/databases/" + dbId + "/query", {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.results) items.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

function mapScanPageToRecord(page: any): any {
  const props = page.properties || {};
  const pageId = stripDashes(page.id);
  const now = new Date().toISOString();

  return {
    notion_page_id: pageId,
    notion_url: page.url || ("https://notion.so/" + pageId),
    scan_id: getProp(props, "Scan ID", "unique_id"),
    title: getProp(props, "Title", "title"),
    scan_date: getProp(props, "Scan Date", "date"),
    executive_summary: getProp(props, "Executive Summary", "rich_text"),
    weekly_messaging_angles: getProp(props, "Weekly Messaging Angles", "rich_text"),
    top_categories: getProp(props, "Top Categories", "multi_select"),
    icp_relevance: getProp(props, "ICP Relevance", "select"),
    updated_at: now,
  };
}

function mapItemPageToRecord(page: any): any {
  const props = page.properties || {};
  const pageId = stripDashes(page.id);
  const now = new Date().toISOString();

  // Scan is a relation — take the first related scan if multiple (shouldn't happen).
  const scanRelations: string[] = getProp(props, "Scan", "relation") || [];
  const scanNotionPageId = scanRelations.length > 0 ? scanRelations[0] : null;

  return {
    notion_page_id: pageId,
    notion_url: page.url || ("https://notion.so/" + pageId),
    title: getProp(props, "Title", "title"),
    category: getProp(props, "Category", "select"),
    signal_type: getProp(props, "Signal Type", "select"),
    source_publication: getProp(props, "Source Publication", "rich_text"),
    source_url: getProp(props, "Source URL", "url"),
    source_date: getProp(props, "Source Date", "date"),
    what_happened: getProp(props, "What Happened", "rich_text"),
    so_what: getProp(props, "So What", "rich_text"),
    therapeutic_area: getProp(props, "Therapeutic Area", "multi_select"),
    icp_stage: getProp(props, "ICP Stage", "multi_select"),
    buyer_persona: getProp(props, "Buyer Persona", "multi_select"),
    topic_tags: getProp(props, "Topic Tags", "multi_select"),
    urgency_window: getProp(props, "Urgency Window", "select"),
    scan_notion_page_id: scanNotionPageId,
    used_in_outreach: getProp(props, "Used In Outreach", "checkbox") ?? false,
    last_cited: getProp(props, "Last Cited", "date"),
    updated_at: now,
  };
}

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  let status = "success";
  let scansFound = 0;
  let scansSynced = 0;
  let itemsFound = 0;
  let itemsSynced = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  try {
    // Pass 1: Intelligence Scans (parents — must land before items reference them).
    const scanPages = await fetchAllPages(SCANS_DB_ID);
    scansFound = scanPages.length;

    const scanRecords: any[] = [];
    for (const page of scanPages) {
      try {
        scanRecords.push(cleanRecord(mapScanPageToRecord(page)));
      } catch (e: any) {
        errorCount++;
        errorDetails.push("scan_map:" + e.message);
      }
    }

    if (scanRecords.length > 0) {
      const result = await supabase
        .from("intelligence_scans")
        .upsert(scanRecords, { onConflict: "notion_page_id" });
      if (result.error) {
        status = "partial";
        errorCount++;
        errorDetails.push("scan_upsert:" + result.error.message);
      } else {
        scansSynced = scanRecords.length;
      }
    }

    // Pass 2: Industry Intelligence items (children — scan FK must already exist).
    const itemPages = await fetchAllPages(ITEMS_DB_ID);
    itemsFound = itemPages.length;

    const itemRecords: any[] = [];
    for (const page of itemPages) {
      try {
        itemRecords.push(cleanRecord(mapItemPageToRecord(page)));
      } catch (e: any) {
        errorCount++;
        errorDetails.push("item_map:" + e.message);
      }
    }

    if (itemRecords.length > 0) {
      const result = await supabase
        .from("industry_intelligence")
        .upsert(itemRecords, { onConflict: "notion_page_id" });
      if (result.error) {
        status = "partial";
        errorCount++;
        errorDetails.push("item_upsert:" + result.error.message);
      } else {
        itemsSynced = itemRecords.length;
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
      function_name: "sync-intelligence",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      total_pages_found: scansFound + itemsFound,
      inserted: 0,
      updated: scansSynced + itemsSynced,
      errors: errorCount,
      error_details: errorDetails.length > 0 ? errorDetails : null,
      status,
      duration_ms: durationMs,
    });
  } catch (_e) {}

  return new Response(JSON.stringify({
    success: status !== "error",
    scans_found: scansFound,
    scans_synced: scansSynced,
    items_found: itemsFound,
    items_synced: itemsSynced,
    errors: errorCount,
    error_details: errorDetails,
    duration_ms: durationMs,
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
