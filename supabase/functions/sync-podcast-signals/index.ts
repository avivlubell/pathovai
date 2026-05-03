// sync-podcast-signals — pulls the "Podcast Intelligence — Signal Feed"
// Notion DB (120c558ae84d4556badec345119300b6) into public.podcast_signals.
//
// Modeled on supabase/functions/sync-intelligence. Single-pass full pull
// (no FK dependencies on other Notion DBs). Run on demand or on a weekly
// cron alongside sync-intelligence.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

const PODCAST_DB_ID = "120c558ae84d4556badec345119300b6";

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
    case "url": return prop.url || null;
    case "date": return prop.date?.start || null;
    case "checkbox": return prop.checkbox ?? null;
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

function mapPageToRecord(page: any): any {
  const props = page.properties || {};
  const pageId = stripDashes(page.id);
  const now = new Date().toISOString();

  return {
    notion_page_id: pageId,
    notion_url: page.url || ("https://notion.so/" + pageId),
    title: getProp(props, "Title", "title"),
    show: getProp(props, "Show", "select"),
    guest_name: getProp(props, "Guest Name", "rich_text"),
    guest_company: getProp(props, "Guest Company", "rich_text"),
    air_date: getProp(props, "Air Date", "date"),
    source_url: getProp(props, "Source URL", "url"),
    signal_type: getProp(props, "Signal Type", "select"),
    icp_relevance: getProp(props, "ICP Relevance", "select"),
    content_angle: getProp(props, "Content Angle", "rich_text"),
    key_insight: getProp(props, "Key Insight", "rich_text"),
    used_in_content: getProp(props, "Used in Content", "checkbox") ?? false,
    updated_at: now,
    last_synced_at: now,
  };
}

Deno.serve(async (_req: Request) => {
  const startedAt = new Date();
  let status = "success";
  let totalFound = 0;
  let syncedCount = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  try {
    const pages = await fetchAllPages(PODCAST_DB_ID);
    totalFound = pages.length;

    const records: any[] = [];
    for (const page of pages) {
      try {
        records.push(cleanRecord(mapPageToRecord(page)));
      } catch (e: any) {
        errorCount++;
        errorDetails.push("map:" + e.message);
      }
    }

    if (records.length > 0) {
      const result = await supabase
        .from("podcast_signals")
        .upsert(records, { onConflict: "notion_page_id" });
      if (result.error) {
        status = "partial";
        errorCount++;
        errorDetails.push("upsert:" + result.error.message);
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
      function_name: "sync-podcast-signals",
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

  return new Response(JSON.stringify({
    success: status !== "error",
    total_found: totalFound,
    synced: syncedCount,
    errors: errorCount,
    error_details: errorDetails,
    duration_ms: durationMs,
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
