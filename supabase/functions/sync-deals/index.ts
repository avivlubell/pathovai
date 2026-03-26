import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const DEALS_DB_ID = Deno.env.get("NOTION_DEALS_DB_ID");

function getProp(props: any, name: string, type: string): any {
  const prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title": return prop.title?.map((t: any) => t.plain_text).join("") || null;
    case "rich_text": return prop.rich_text?.map((t: any) => t.plain_text).join("") || null;
    case "number": return prop.number ?? null;
    case "select": return prop.select?.name || null;
    case "status": return prop.status?.name || null;
    case "url": return prop.url || null;
    case "date": return prop.date?.start || null;
    case "checkbox": return prop.checkbox ?? null;
    case "relation": return prop.relation?.[0]?.id || null;
    case "people": return prop.people?.map((p: any) => p.name).join(", ") || null;
    default: return null;
  }
}

async function getNotionPageTitle(pageId: string): Promise<string | null> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: {
      "Authorization": `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": "2022-06-28",
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  for (const key of Object.keys(data.properties || {})) {
    const p = data.properties[key];
    if (p.type === "title") {
      return p.title?.map((t: any) => t.plain_text).join("") || null;
    }
  }
  return null;
}

async function fetchAllDeals(): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined = undefined;
  do {
    const body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await fetch(`https://api.notion.com/v1/databases/${DEALS_DB_ID}/query`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Notion API error: ${JSON.stringify(data)}`);
    items.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL!, SUPABASE_KEY!);
    const pages = await fetchAllDeals();
    let upserted = 0;
    const errors: string[] = [];

    for (const page of pages) {
      const p = page.properties;

      if (upserted === 0) {
        console.log("Props:", Object.keys(p).join(", "));
        for (const key of Object.keys(p)) {
          if (p[key].type === "title") {
            console.log("Title key:", key, JSON.stringify(p[key].title?.slice(0,1)));
          }
        }
      }

      const dealName = getProp(p, "Deal Name", "title");
      const companyNotionId = getProp(p, "Company", "relation");
      let companyName: string | null = null;
      if (companyNotionId) {
        companyName = await getNotionPageTitle(companyNotionId);
      }
      console.log(`Deal: ${dealName}, Company: ${companyName}`);

      const record = {
        notion_id: page.id,
        deal_name: dealName,
        motion_type: getProp(p, "Motion Type", "select"),
        stage: getProp(p, "Stage", "status"),
        value: getProp(p, "Value", "number"),
        company_notion_id: companyNotionId,
        company_name: companyName,
        expected_close_date: getProp(p, "Expected Close Date", "date"),
        actual_close_date: getProp(p, "Actual Close Date", "date"),
        notes: getProp(p, "Notes", "rich_text"),
        last_edited: page.last_edited_time,
        notion_url: page.url
      };

      const { error } = await supabase.from("deals").upsert(record, { onConflict: "notion_id" });
      if (error) { console.error("Err:", error.message); errors.push(error.message); }
      else upserted++;
    }

    return new Response(JSON.stringify({ success: true, synced: upserted, total: pages.length, errors }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { "Content-Type": "application/json" }
    });
  }
});
