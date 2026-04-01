import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const GI_DB_ID = "040d8d933e044730b86edc9b045cdb78";

function getProp(props, name, type) {
  var prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title": return prop.title ? prop.title.map(function(t) { return t.plain_text; }).join("") : null;
    case "rich_text": return prop.rich_text ? prop.rich_text.map(function(t) { return t.plain_text; }).join("") : null;
    case "number": return prop.number != null ? prop.number : null;
    case "select": return prop.select ? prop.select.name : null;
    case "status": return prop.status ? prop.status.name : null;
    case "url": return prop.url || null;
    case "email": return prop.email || null;
    case "people": return prop.people ? prop.people.map(function(p) { return p.name; }).join(", ") : null;
    default: return null;
  }
}

function cleanRecord(record) {
  var clean = {};
  var keys = Object.keys(record);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var v = record[k];
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return clean;
}

async function fetchAllGIPages() {
  var items = [];
  var cursor = undefined;
  do {
    var body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var res = await fetch("https://api.notion.com/v1/databases/" + GI_DB_ID + "/query", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + NOTION_TOKEN,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    var data = await res.json();
    if (data.results) {
      for (var j = 0; j < data.results.length; j++) items.push(data.results[j]);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

function mapPageToRecord(page) {
  var props = page.properties || {};
  var pageId = page.id.replace(/-/g, "");
  var notionUrl = page.url || "https://notion.so/" + pageId;
  var companyName = getProp(props, "Account", "title") || "Unknown";
  var now = new Date().toISOString();
  return {
    notion_page_id: pageId,
    notion_url: notionUrl,
    company_name: companyName,
    icp_score: getProp(props, "ICP Score", "number"),
    tier: getProp(props, "Pathova ICP Tier", "select"),
    gap0_severity: getProp(props, "Gap 0 Severity", "select"),
    engage_decision: getProp(props, "Engage Decision", "select"),
    fda_status: getProp(props, "FDA Status", "select") || getProp(props, "Regulatory Status", "select"),
    product_category: getProp(props, "Product Category", "select"),
    hq_location: getProp(props, "HQ Location", "rich_text"),
    hq_country: getProp(props, "HQ Country", "select"),
    website_url: getProp(props, "Website", "url"),
    linkedin_url: getProp(props, "LinkedIn URL", "url"),
    ceo_email: getProp(props, "Email", "email") || getProp(props, "Email", "rich_text"),
    research_status: getProp(props, "Research Status", "select"),
    outreach_status: getProp(props, "Status", "status"),
    owner: getProp(props, "Owner", "people") || getProp(props, "Owner", "select"),
    updated_at: now,
    last_synced_at: now
  };
}

Deno.serve(async function(req) {
  var startedAt = new Date();
  var status = "success";
  var totalFound = 0;
  var syncedCount = 0;
  var errorCount = 0;
  var errorDetails = [];

  try {
    var giPages = await fetchAllGIPages();
    totalFound = giPages.length;

    var records = [];
    for (var i = 0; i < giPages.length; i++) {
      try {
        records.push(cleanRecord(mapPageToRecord(giPages[i])));
      } catch (e) {
        errorCount++;
        errorDetails.push("map:" + e.message);
      }
    }

    if (records.length > 0) {
      var result = await supabase.from("accounts").upsert(records, { onConflict: "notion_page_id" });
      if (result.error) {
        status = "partial";
        errorCount++;
        errorDetails.push("upsert:" + result.error.message);
      } else {
        syncedCount = records.length;
      }
    }
  } catch (e) {
    status = "error";
    errorCount++;
    errorDetails.push(e.message);
  }

  var completedAt = new Date();
  var durationMs = completedAt.getTime() - startedAt.getTime();

  try {
    await supabase.from("sync_log").insert({
      function_name: "sync-prospects",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      total_pages_found: totalFound,
      inserted: 0,
      updated: syncedCount,
      errors: errorCount,
      error_details: errorDetails.length > 0 ? errorDetails : null,
      status: status,
      duration_ms: durationMs
    });
  } catch (e) {}

  return new Response(JSON.stringify({
    success: status !== "error",
    total_found: totalFound,
    synced: syncedCount,
    errors: errorCount,
    error_details: errorDetails,
    duration_ms: durationMs
  }), { headers: { "Content-Type": "application/json" } });
});
