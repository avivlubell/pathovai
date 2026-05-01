import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);

const COMPANIES_DB_ID = "5de708d0857543cb8e25714d82cee7b8";

const NOTION_HEADERS = {
  "Authorization": "Bearer " + NOTION_TOKEN,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

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

async function fetchAllCompanyPages(): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch("https://api.notion.com/v1/databases/" + COMPANIES_DB_ID + "/query", {
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
  const pageId = page.id.replace(/-/g, "");
  const now = new Date().toISOString();

  return {
    notion_page_id: pageId,
    notion_url: page.url || ("https://notion.so/" + pageId),
    company_name: getProp(props, "Company Name", "title"),

    icp_tier: getProp(props, "ICP Tier", "select"),
    primary_gap: getProp(props, "Primary Gap", "multi_select"),
    therapeutic_area: getProp(props, "Therapeutic Area", "multi_select"),

    regulatory_status: getProp(props, "Regulatory Status", "select"),
    ce_mark_status: getProp(props, "CE Mark Status", "select"),
    coverage_status: getProp(props, "Coverage Status", "select"),
    mac_variability: getProp(props, "MAC Variability", "select"),
    cpt_code: getProp(props, "CPT Code", "rich_text"),
    reimbursement_notes: getProp(props, "Reimbursement Notes", "rich_text"),

    pivotal_trial_status: getProp(props, "Pivotal Trial Status", "select"),
    number_of_paying_hospitals: getProp(props, "Number of Paying Hospitals", "number"),

    funding_stage: getProp(props, "Funding Stage", "select"),
    lead_investor_type: getProp(props, "Lead Investor Type", "select"),
    total_funding_raised: getProp(props, "Total Funding Raised", "number"),
    employee_count: getProp(props, "Employee Count", "number"),
    estimated_runway_months: getProp(props, "Est. Runway (Months)", "number"),

    status: getProp(props, "Status", "status"),
    source: getProp(props, "Source", "select"),
    next_action: getProp(props, "Next Action", "rich_text"),
    research_summary: getProp(props, "Research Summary", "rich_text"),

    website: getProp(props, "Website", "url"),
    last_activity: getProp(props, "Last Activity", "date"),

    updated_at: now,
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
    const pages = await fetchAllCompanyPages();
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
        .from("companies")
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
      function_name: "sync-companies",
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
