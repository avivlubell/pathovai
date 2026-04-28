import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Outreach Touches uses Notion's multi-data-source database feature, which
// requires API version >= 2025-09-03. Older versions return a 400 error
// when reading these databases.
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

async function fetchPage(pageId: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: NOTION_HEADERS,
  });
  const data = await res.json();
  if (data.object === "error") {
    throw new Error(`notion: ${data.code} ${data.message}`);
  }
  return data;
}

// Resolve the parent account by following Related Outreach -> accounts table.
// Notion returns relation IDs with dashes; accounts.notion_page_id is stored
// without dashes (legacy convention from sync-prospect-content), so strip.
async function resolveAccount(relatedOutreachIds: string[]): Promise<{ id: string | null; name: string | null }> {
  if (!relatedOutreachIds.length) return { id: null, name: null };
  const oiPageId = stripDashes(relatedOutreachIds[0]);
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name")
    .eq("notion_page_id", oiPageId)
    .maybeSingle();
  if (error) {
    console.warn(`[sync-touch-content] account lookup error for OI page ${oiPageId}:`, error.message);
    return { id: null, name: null };
  }
  if (!data) {
    console.warn(`[sync-touch-content] no account row for OI page ${oiPageId} — touch will sync without account_id`);
    return { id: null, name: null };
  }
  return { id: data.id, name: data.company_name };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  try {
    const { notion_page_id } = await req.json();
    if (!notion_page_id) {
      return new Response(JSON.stringify({ error: "notion_page_id is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const page = await fetchPage(notion_page_id);
    const props = page.properties || {};

    // The Notion property is literally "Message " with a trailing space —
    // that's how it was named in the database. Easy mistake to make.
    const message = getProp(props, "Message ", "rich_text") ?? getProp(props, "Message", "rich_text");

    const relatedOutreach = getProp(props, "Related Outreach", "relation") as string[];
    const contactRelation = getProp(props, "Contact (Main)", "relation") as string[];
    const account = await resolveAccount(relatedOutreach);

    const pageIdStripped = stripDashes(page.id);
    const record = {
      notion_page_id: pageIdStripped,
      notion_url: page.url ?? `https://notion.so/${pageIdStripped}`,
      account_id: account.id,
      account_name: account.name,
      related_outreach_page_id: relatedOutreach[0] ? stripDashes(relatedOutreach[0]) : null,
      contact_notion_page_id: contactRelation[0] ? stripDashes(contactRelation[0]) : null,
      title: getProp(props, "Title", "title"),
      touch_date: getProp(props, "Touch Date", "date"),
      channel: getProp(props, "Channel", "select"),
      sent: getProp(props, "Sent", "checkbox") ?? false,
      outcome: getProp(props, "Outcome", "select"),
      top_challenges: getProp(props, "Top Challenges", "multi_select") || [],
      message,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("touches")
      .upsert(record, { onConflict: "notion_page_id" });

    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, record }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        notion_page_id: pageIdStripped,
        title: record.title,
        account_id: record.account_id,
        account_name: record.account_name,
        sent: record.sent,
        touch_date: record.touch_date,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
