import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NOTION_HEADERS = {
  "Authorization": `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

// Extract text from a Notion rich_text array
function richTextToString(rt: any[]): string {
  if (!rt || !Array.isArray(rt)) return "";
  return rt.map((t: any) => t.plain_text || "").join("");
}

// Extract text from a single block
function blockToText(block: any): string {
  const type = block.type;
  const data = block[type];
  if (!data) return "";

  switch (type) {
    case "paragraph":
    case "quote":
    case "callout":
      return richTextToString(data.rich_text);
    case "heading_1":
      return "# " + richTextToString(data.rich_text);
    case "heading_2":
      return "## " + richTextToString(data.rich_text);
    case "heading_3":
      return "### " + richTextToString(data.rich_text);
    case "bulleted_list_item":
    case "numbered_list_item":
      return "- " + richTextToString(data.rich_text);
    case "to_do":
      const checked = data.checked ? "[x]" : "[ ]";
      return checked + " " + richTextToString(data.rich_text);
    case "toggle":
      return richTextToString(data.rich_text);
    case "divider":
      return "---";
    case "table_row":
      // Cells is an array of arrays of rich_text. Render as pipe-delimited row.
      return (data.cells || [])
        .map((cell: any[]) => richTextToString(cell).trim())
        .join(" | ");
    case "table":
      // The table block itself has no text — its children (table_row) carry the content.
      return "";
    default:
      return richTextToString(data?.rich_text || []);
  }
}

// Fetch all blocks (children) of a page recursively
async function fetchAllBlocks(blockId: string): Promise<string> {
  const lines: string[] = [];
  let cursor: string | undefined;

  do {
    let url = `https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`;
    if (cursor) url += `&start_cursor=${cursor}`;

    const res = await fetch(url, { headers: NOTION_HEADERS });
    const data = await res.json();

    if (data.results) {
      for (const block of data.results) {
        const text = blockToText(block);
        if (text) lines.push(text);

        // Recurse into children (toggles, nested blocks)
        if (block.has_children) {
          const childText = await fetchAllBlocks(block.id);
          if (childText) lines.push(childText);
        }
      }
    }
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return lines.join("\n");
}

// Fetch page properties
async function fetchPageProperties(pageId: string): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: NOTION_HEADERS,
  });
  return await res.json();
}

function getProp(props: any, name: string, type: string): any {
  const prop = props[name];
  if (!prop) return null;
  switch (type) {
    case "title": return prop.title?.map((t: any) => t.plain_text).join("") || null;
    case "rich_text": return prop.rich_text?.map((t: any) => t.plain_text).join("") || null;
    case "number": return prop.number ?? null;
    case "select": return prop.select?.name || null;
    case "multi_select": return prop.multi_select?.map((s: any) => s.name) || [];
    case "checkbox": return prop.checkbox ?? null;
    case "url": return prop.url || null;
    case "date": return prop.date?.start || null;
    default: return null;
  }
}

// Parse body content into structured sections
function parseSections(bodyText: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = bodyText.split("\n");
  let currentSection = "general";
  const sectionMap: Record<string, string> = {};

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (lower.includes("tier 1") && lower.includes("filter")) currentSection = "tier1";
    else if (lower.includes("tier 2") && (lower.includes("angle") || lower.includes("extraction"))) currentSection = "tier2";
    else if (lower.includes("tier 3") && lower.includes("compet")) currentSection = "tier3";
    else if (lower.includes("discovery call") || lower.includes("call intelligence")) currentSection = "discovery";
    else if (lower.includes("final assessment") || lower.includes("icp fit score")) currentSection = "assessment";
    else if (lower.includes("outreach hook") || lower.includes("outreach addition")) currentSection = "outreach";
    else if (lower.includes("recommended next action") || lower.includes("next action")) currentSection = "next_action";
    else if (lower.includes("ceo pain")) currentSection = "ceo_pain";
    else if (lower.includes("risk-bearing") || lower.includes("risk bearing")) currentSection = "risk";

    if (!sectionMap[currentSection]) sectionMap[currentSection] = "";
    sectionMap[currentSection] += line + "\n";
  }

  return sectionMap;
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
        },
      });
    }

    const { notion_page_id, company_name } = await req.json();

    // Resolve page ID: either provided directly or look up from Supabase by company name
    let pageId = notion_page_id;
    if (!pageId && company_name) {
      const { data } = await supabase
        .from("accounts")
        .select("notion_page_id")
        .ilike("company_name", `%${company_name}%`)
        .single();
      pageId = data?.notion_page_id;
    }

    if (!pageId) {
      return new Response(JSON.stringify({ error: "No notion_page_id provided or found" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch page properties
    const page = await fetchPageProperties(pageId);
    const props = page.properties || {};

    // Fetch full page body content
    const bodyText = await fetchAllBlocks(pageId);

    // Parse body into sections
    const sections = parseSections(bodyText);

    // Build research_output from all tiered research
    const researchParts: string[] = [];
    if (sections.tier1) researchParts.push("TIER 1 FILTER:\n" + sections.tier1.trim());
    if (sections.tier2) researchParts.push("TIER 2 ANGLE:\n" + sections.tier2.trim());
    if (sections.tier3) researchParts.push("TIER 3 COMPETITORS:\n" + sections.tier3.trim());
    if (sections.discovery) researchParts.push("DISCOVERY CALL:\n" + sections.discovery.trim());
    if (sections.ceo_pain) researchParts.push("CEO PAIN LANGUAGE:\n" + sections.ceo_pain.trim());
    if (sections.assessment) researchParts.push("FINAL ASSESSMENT:\n" + sections.assessment.trim());
    if (sections.next_action) researchParts.push("NEXT ACTION:\n" + sections.next_action.trim());

    // Always include the full body so the LLM sees everything (contacts, free-form notes,
    // anything outside the recognized tier headings). Parsed sections are appended for
    // structured emphasis but never replace the raw body.
    const researchRaw = researchParts.length > 0
      ? bodyText + "\n\n---\n\n" + researchParts.join("\n\n")
      : bodyText;

    // Extract company name from properties — find any property of type "title"
    // (every Notion DB has exactly one) so we're not brittle to column renames.
    const titleProp = Object.values(props).find((p: any) => p?.type === "title") as any;
    const companyName = titleProp?.title?.[0]?.plain_text?.trim()
      || company_name
      || "Unknown";

    const notionUrl = page.url || `https://notion.so/${pageId}`;

    // Build prospect record from properties
    const record: any = {
      notion_page_id: pageId,
      notion_url: notionUrl,
      company_name: companyName,
      icp_score: getProp(props, "ICP Score", "number"),
      tier: getProp(props, "ICP Tier", "select") || getProp(props, "Tier", "select"),
      fda_status: getProp(props, "Regulatory Status", "select") || getProp(props, "FDA Status", "select"),
      product_category: getProp(props, "Product Category", "select") || getProp(props, "Category", "select"),
      hq_location: getProp(props, "HQ Location", "rich_text") || getProp(props, "Location", "rich_text"),
      hq_country: getProp(props, "HQ Country", "select") || getProp(props, "Country", "select"),
      company_size: getProp(props, "Company Size", "select") || getProp(props, "Size", "select"),
      website_url: getProp(props, "Website", "url"),
      linkedin_url: getProp(props, "LinkedIn", "url") || getProp(props, "LinkedIn URL", "url"),
      funding_stage: getProp(props, "Funding Stage", "select") || getProp(props, "Stage", "select"),
      outreach_status: getProp(props, "Outreach Status", "select") || getProp(props, "Status", "select"),
      owner: getProp(props, "Owner", "select"),
      competitors: getProp(props, "Competitors", "multi_select"),
      // Content from page body
      research_output: researchRaw,
      research_status: researchParts.length > 0 ? "complete" : "pending",
      risk_assessment: sections.risk ? sections.risk.trim() : null,
      outreach_draft: sections.outreach ? sections.outreach.trim() : null,
      timing_assessment: sections.tier2 ? sections.tier2.substring(0, 500).trim() : null,
      research_version: (researchParts.length > 0 ? researchParts.length : 0),
      last_researched: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Also extract Research Summary from properties if available
    const researchSummary = getProp(props, "Research Summary", "rich_text");
    if (researchSummary && !record.research_output) {
      record.research_output = researchSummary;
    }

    // NOTE: skipped key_contacts write — that column doesn't exist on accounts and
    // would fail the upsert. Contacts in the page body now flow through research_output.

    // Clean nulls
    const clean: any = {};
    for (const [k, v] of Object.entries(record)) {
      if (v !== null && v !== undefined) clean[k] = v;
    }

    // Upsert to Supabase
    const { error } = await supabase
      .from("accounts")
      .upsert(clean, { onConflict: "notion_page_id" });

    if (error) {
      return new Response(JSON.stringify({
        success: false,
        error: error.message,
        pageId,
        company: companyName,
      }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      company: companyName,
      pageId,
      sections_found: Object.keys(sections),
      research_length: researchRaw.length,
      body_length: bodyText.length,
      fields_synced: Object.keys(clean),
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
