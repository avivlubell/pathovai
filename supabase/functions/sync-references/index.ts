import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SYNC_SECRET = Deno.env.get("SYNC_TRIGGER_SECRET");

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const REFERENCE_REGISTRY = [
  { notionId: "26faff2ec22280ed8f70e57aa6a098c0", type: "methodology", tags: ["pilot_design", "conversion", "cheat_sheet"] },
  { notionId: "26faff2ec22280a09f6ad5dd90cbb040", type: "methodology", tags: ["executive_access", "csuite", "cheat_sheet"] },
  { notionId: "26faff2ec2228097935cd2a23c381c9a", type: "methodology", tags: ["hospital", "buying_committee", "VAC", "cheat_sheet"] },
  { notionId: "26faff2ec222802bb0b0dc0a1358e5e5", type: "methodology", tags: ["sales_infrastructure", "GTM", "cheat_sheet"] },
  { notionId: "26faff2ec22280cfa175ca68f954fcf0", type: "methodology", tags: ["content", "enablement", "cheat_sheet"] },
  { notionId: "26faff2ec22280f9a7dff2ea89f080dd", type: "methodology", tags: ["KOL", "champion", "cheat_sheet"] },
  { notionId: "261aff2ec22280c69b5efe25939c5557", type: "methodology", tags: ["reimbursement", "cheat_sheet"] },
  { notionId: "262aff2ec2228040a571da56c6df90de", type: "methodology", tags: ["ICP", "framework", "scoring", "qualification"] },
  { notionId: "520c699a1664469fb8db123ade1a8b5d", type: "methodology", tags: ["delivery", "framework", "commercial_intelligence"] },
  { notionId: "45f070ac5b404da3afec6496825dea72", type: "proof_asset", tags: ["case_study", "proof", "validation"] },
  { notionId: "318aff2ec2228096ba34f3b23dde505f", type: "legal_kb", tags: ["legal", "compliance", "contracts"] },
  { notionId: "61b64c4528d944dc89445a51a97f8d62", type: "legal_kb", tags: ["legal", "jurisdiction", "playbooks"] },
  { notionId: "bd970307334b4acfb1f2a4399eb5623f", type: "legal_kb", tags: ["legal", "quebec", "law25", "privacy", "contracts"] },
  { notionId: "23aaff2ec22280138578caebb09a020f", type: "company_context", tags: ["pathova", "mission", "values"] },
  { notionId: "f2d47a3103d14e6f9b1e7d8e5b5bee84", type: "agent_prompt", tags: ["quarterback", "agent", "orchestrator"] },
  { notionId: "3528c5067b9a403db55f1dcb84a15098", type: "outreach_template", tags: ["outreach", "email", "cadence", "templates"] },
  { notionId: "2acaff2ec222808e97cbd1e54a2a42f5", type: "solution_framework", tags: ["solution", "pilot_purgatory", "value_prop"] },
  { notionId: "2acaff2ec222803eba7ce59cbb3bcf29", type: "problem_framework", tags: ["problems", "pain_points", "gaps"] },
  { notionId: "23aaff2ec22280579ebfeae0743585d6", type: "methodology", tags: ["ICP", "strategic", "customer_profile"] },
  { notionId: "263aff2ec22280c4bf41c96c60819507", type: "company_context", tags: ["elevator_pitch", "messaging", "positioning"] },
  { notionId: "2acaff2ec222807e87f7fa00cb8df0e6", type: "company_context", tags: ["narrative", "story", "messaging"] },
  { notionId: "54f03add1aed41c5a602910ae72cec92", type: "company_context", tags: ["operating_system", "process", "pathova"] },
  { notionId: "6c7c033d8b6c4861957b4c42055839ba", type: "competitor_intel", tags: ["differentiation", "competitive", "positioning"] },
  { notionId: "85f594034d21453585cfacce1a11b731", type: "company_context", tags: ["voice", "tone", "writing"] },
  { notionId: "261aff2ec22280bbb39dd2222b1c068f", type: "methodology", tags: ["quick_reference", "cheat_sheets"] },
];


async function fetchNotionPage(pageId: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { "Authorization": `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
  });
  return res.json();
}

async function fetchBlocksFlat(blockId: string): Promise<string> {
  let content = "";
  let cursor: string | undefined;
  do {
    const url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${NOTION_TOKEN}`, "Notion-Version": "2022-06-28" },
    });
    const data = await res.json();
    for (const block of data.results || []) {
      const t = block.type;
      const d = block[t];
      if (d?.rich_text) {
        const text = d.rich_text.map((r: any) => r.plain_text).join("");
        if (text) content += text + "\n";
      } else if (t === "child_database" || t === "child_page") {
        content += `[${t}: ${d?.title || ""}]\n`;
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return content;
}

function getPageTitle(page: any): string {
  const props = page.properties || {};
  for (const key of Object.keys(props)) {
    const prop = props[key];
    if (prop.type === "title" && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join("");
    }
  }
  return "Untitled";
}

serve(async (req) => {
  if (!SYNC_SECRET || req.headers.get("x-sync-secret") !== SYNC_SECRET) {
    return new Response(null, { status: 401 });
  }
  try {
    const results: any[] = [];
    for (const entry of REFERENCE_REGISTRY) {
      try {
        const page = await fetchNotionPage(entry.notionId);
        if (page.object === "error") {
          results.push({ notionId: entry.notionId, type: entry.type, status: "error", error: page.message });
          continue;
        }
        const title = getPageTitle(page) || entry.type;
        const content = await fetchBlocksFlat(entry.notionId);
        const pageId = entry.notionId.replace(/-/g, "");
        const notionUrl = page.url || `https://notion.so/${pageId}`;
        const { error } = await supabase.from("reference_library").upsert({
          notion_page_id: pageId,
          type: entry.type,
          title,
          content: content.length > 0 ? content : "EMPTY",
          tags: entry.tags,
          notion_url: notionUrl,
          last_synced: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }, { onConflict: "notion_page_id" });
        if (error) {
          results.push({ pageId, status: "error", error: error.message });
        } else {
          results.push({ pageId, title, contentLength: content.length, status: "synced" });
        }
      } catch (err) {
        results.push({ notionId: entry.notionId, type: entry.type, status: "error", error: String(err) });
      }
    }
    return new Response(JSON.stringify({ success: true, synced: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
