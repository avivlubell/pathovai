import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const CONTACTS_DB_ID = "94882725033a4cbba875be35b5868ac6";

const NOTION_HEADERS = {
  "Authorization": "Bearer " + NOTION_TOKEN,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

function getProp(props: any, name: string, type: string): any {
  var prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title": return prop.title ? prop.title.map((t: any) => t.plain_text).join("") : null;
    case "rich_text": return prop.rich_text ? prop.rich_text.map((t: any) => t.plain_text).join("") : null;
    case "select": return prop.select ? prop.select.name : null;
    case "multi_select": return prop.multi_select ? prop.multi_select.map((s: any) => s.name) : [];
    case "email": return prop.email || null;
    case "url": return prop.url || null;
    case "phone_number": return prop.phone_number || null;
    case "date": return prop.date ? prop.date.start : null;
    case "relation": return prop.relation ? prop.relation.map((r: any) => r.id) : [];
    default: return null;
  }
}

function cleanRecord(record: any): any {
  var clean: any = {};
  for (var [k, v] of Object.entries(record)) {
    if (v !== null && v !== undefined) clean[k] = v;
  }
  return clean;
}

async function fetchAllContactPages(): Promise<any[]> {
  var items: any[] = [];
  var cursor: string | undefined;
  do {
    var body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    var res = await fetch("https://api.notion.com/v1/databases/" + CONTACTS_DB_ID + "/query", {
      method: "POST",
      headers: NOTION_HEADERS,
      body: JSON.stringify(body),
    });
    var data = await res.json();
    if (data.results) {
      for (var j = 0; j < data.results.length; j++) items.push(data.results[j]);
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

async function resolveCompanyName(companyRelationIds: string[]): Promise<string | null> {
  if (!companyRelationIds || companyRelationIds.length === 0) return null;
  try {
    var pageId = companyRelationIds[0];
    var res = await fetch("https://api.notion.com/v1/pages/" + pageId, {
      headers: NOTION_HEADERS,
    });
    var page = await res.json();
    var props = page.properties || {};
    // Try common title property names
    for (var name of ["Name", "Company", "Account", "Company Name"]) {
      var title = getProp(props, name, "title");
      if (title) return title;
    }
    return null;
  } catch {
    return null;
  }
}

async function resolveAccountId(companyName: string): Promise<string | null> {
  if (!companyName) return null;
  // Try exact match first
  var { data } = await supabase
    .from("accounts")
    .select("id")
    .ilike("company_name", companyName)
    .limit(1)
    .maybeSingle();
  if (data) return data.id;
  // Try fuzzy match with first word
  var firstWord = companyName.split(/[\s,|\-\/]+/)[0];
  if (firstWord && firstWord.length > 2) {
    var { data: fuzzy } = await supabase
      .from("accounts")
      .select("id")
      .ilike("company_name", "%" + firstWord + "%")
      .limit(1)
      .maybeSingle();
    if (fuzzy) return fuzzy.id;
  }
  return null;
}

function mapPageToRecord(page: any): any {
  var props = page.properties || {};
  var pageId = page.id.replace(/-/g, "");
  var now = new Date().toISOString();

  return {
    notion_page_id: pageId,
    full_name: getProp(props, "Name", "title") || "Unknown",
    title: getProp(props, "Title", "rich_text"),
    email: getProp(props, "Email", "email"),
    phone: getProp(props, "Phone", "phone_number"),
    linkedin_url: getProp(props, "LinkedIn", "url"),
    contact_type: getProp(props, "Contact Type", "select"),
    relationship_status: getProp(props, "Relationship Status", "select"),
    communication_channels: getProp(props, "Communication Channels", "multi_select"),
    notes: getProp(props, "Notes", "rich_text"),
    last_contacted: getProp(props, "Last Contacted", "date"),
    updated_at: now,
    _company_relation: getProp(props, "Company", "relation"),
  };
}

Deno.serve(async function(_req: Request) {
  var startedAt = new Date();
  var status = "success";
  var totalFound = 0;
  var syncedCount = 0;
  var linkedCount = 0;
  var errorCount = 0;
  var errorDetails: string[] = [];

  try {
    var pages = await fetchAllContactPages();
    totalFound = pages.length;

    var records: any[] = [];
    for (var i = 0; i < pages.length; i++) {
      try {
        var raw = mapPageToRecord(pages[i]);
        var companyRelation = raw._company_relation;
        delete raw._company_relation;

        // Resolve company name from CO relation
        var companyName = await resolveCompanyName(companyRelation);
        if (companyName) {
          raw.company_name = companyName;
          // Resolve account_id from Supabase accounts
          var accountId = await resolveAccountId(companyName);
          if (accountId) {
            raw.account_id = accountId;
            linkedCount++;
          }
        }

        records.push(cleanRecord(raw));
      } catch (e: any) {
        errorCount++;
        errorDetails.push("map:" + e.message);
      }
    }

    if (records.length > 0) {
      var result = await supabase.from("contacts").upsert(records, {
        onConflict: "notion_page_id",
      });
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

  var completedAt = new Date();
  var durationMs = completedAt.getTime() - startedAt.getTime();

  try {
    await supabase.from("sync_log").insert({
      function_name: "sync-contacts",
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      total_pages_found: totalFound,
      inserted: 0,
      updated: syncedCount,
      errors: errorCount,
      error_details: errorDetails.length > 0 ? errorDetails : null,
      status: status,
      duration_ms: durationMs,
    });
  } catch (_e) {}

  return new Response(JSON.stringify({
    success: status !== "error",
    total_found: totalFound,
    synced: syncedCount,
    linked_to_accounts: linkedCount,
    errors: errorCount,
    error_details: errorDetails,
    duration_ms: durationMs,
  }), {
    headers: { "Content-Type": "application/json" },
  });
});
