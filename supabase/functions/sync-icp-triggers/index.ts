import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ICP_TRIGGERS_DB_ID = "7b8f71ab2d8a45bd84f075ae0a6d6f88";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
      return prop.multi_select?.length ? prop.multi_select.map((o: any) => o.name) : null;
    case "url":
      return prop.url ?? null;
    case "date":
      return prop.date?.start ?? null;
    default:
      return null;
  }
}

async function fetchAllPages(): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const body: Record<string, any> = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${ICP_TRIGGERS_DB_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.object === "error") {
      throw new Error(`notion: ${data.code} ${data.message}`);
    }
    if (data.results) items.push(...data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

function mapPageToRecord(page: any) {
  const props = page.properties || {};
  const pageId = page.id.replace(/-/g, "");
  const now = new Date().toISOString();
  return {
    notion_page_id: pageId,
    notion_url: page.url || `https://notion.so/${pageId}`,

    company_name: getProp(props, "Company", "title") || "Unknown",
    company_url: getProp(props, "Company URL", "url"),
    linkedin_url: getProp(props, "LinkedIn", "url"),
    headquarters: getProp(props, "Headquarters", "rich_text"),

    founder_name: getProp(props, "Founder Name", "rich_text"),
    founder_role: getProp(props, "Founder Role", "rich_text"),
    founder_linkedin: getProp(props, "Founder LinkedIn", "url"),

    total_funding: getProp(props, "Total Funding", "rich_text"),
    last_round_amount: getProp(props, "Last Round Amount", "rich_text"),
    last_round_type: getProp(props, "Last Round Type", "select"),
    investors: getProp(props, "Investors", "rich_text"),
    employee_count: getProp(props, "Employee Count", "rich_text"),
    estimated_runway: getProp(props, "Estimated Runway", "rich_text"),

    fda_status: getProp(props, "FDA Status", "select"),
    fda_510k_number: getProp(props, "510k Number", "rich_text"),
    device_category: getProp(props, "Device Category", "rich_text"),
    clearance_date: getProp(props, "Clearance Date", "date"),
    clinical_evidence_quality: getProp(props, "Clinical Evidence Quality", "rich_text"),

    pilot_sites: getProp(props, "Pilot Sites", "rich_text"),
    commercial_team: getProp(props, "Commercial Team", "select"),
    job_postings_summary: getProp(props, "Job Postings Summary", "rich_text"),

    icp_score: getProp(props, "ICP Score", "rich_text"),
    icp_tier: getProp(props, "ICP Tier", "select"),
    icp_clarity_gap: getProp(props, "ICP Clarity Gap", "select"),
    confidence: getProp(props, "Confidence", "select"),
    conversion_evidence: getProp(props, "Conversion Evidence", "select"),

    trigger_types: getProp(props, "Trigger Type", "multi_select"),
    pain_signals: getProp(props, "Pain Signals", "rich_text"),
    summary: getProp(props, "Summary", "rich_text"),

    outreach_status: getProp(props, "Outreach Status", "select"),
    source: getProp(props, "Source", "url"),
    date_found: getProp(props, "Date Found", "date"),

    updated_at: now,
    last_synced_at: now,
  };
}

Deno.serve(async (_req) => {
  const startedAt = new Date();
  let status: "success" | "partial" | "error" = "success";
  let totalFound = 0;
  let syncedCount = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  try {
    const pages = await fetchAllPages();
    totalFound = pages.length;

    const records: any[] = [];
    for (const page of pages) {
      try {
        records.push(mapPageToRecord(page));
      } catch (e: any) {
        errorCount++;
        errorDetails.push(`map:${e.message}`);
      }
    }

    if (records.length > 0) {
      const { error } = await supabase
        .from("icp_triggers")
        .upsert(records, { onConflict: "notion_page_id" });
      if (error) {
        status = "partial";
        errorCount++;
        errorDetails.push(`upsert:${error.message}`);
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
      function_name: "sync-icp-triggers",
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
  } catch (_e) {
    // best-effort
  }

  return new Response(JSON.stringify({
    success: status !== "error",
    total_found: totalFound,
    synced: syncedCount,
    errors: errorCount,
    error_details: errorDetails,
    duration_ms: durationMs,
  }), { headers: { "Content-Type": "application/json" } });
});
