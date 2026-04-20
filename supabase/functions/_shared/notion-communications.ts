// Shared helpers for reading the Outreach Touches DB from Notion.
// Reused by `get-communications` (standalone) and `outreach-drafter` (auto-pull).
//
// Uses Notion API 2025-09-03 + the /data_sources endpoint because the
// Outreach Touches DB has multiple data sources; the older /databases
// query endpoint rejects multi-data-source DBs with a 400.

const NOTION_INTEGRATION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN");
const NOTION_OUTREACH_DB_ID =
  Deno.env.get("NOTION_OUTREACH_DB_ID") ?? "bc4daa1322f24e46aadde4b6b0a25ab5";
// Optional override: if set, skip the database metadata lookup and query
// this data source id directly.
const NOTION_OUTREACH_DATA_SOURCE_ID = Deno.env.get("NOTION_OUTREACH_DATA_SOURCE_ID");
const NOTION_VERSION = "2025-09-03";

export interface Communication {
  id: string;
  url: string;
  title: string;
  date: string | null;
  channel: string | null;
  outcome: string | null;
  top_challenges: string[];
  message: string;
  sent: boolean;
}

export interface FetchResult {
  communications: Communication[];
  error?: string;
  raw_first_page?: any;
}

function extractText(prop: any): string {
  if (!prop) return "";
  if (prop.type === "title") {
    return (prop.title ?? []).map((r: any) => r.plain_text ?? "").join("");
  }
  if (prop.type === "rich_text") {
    return (prop.rich_text ?? []).map((r: any) => r.plain_text ?? "").join("");
  }
  return "";
}

function extractSelect(prop: any): string | null {
  if (!prop) return null;
  if (prop.type === "select") return prop.select?.name ?? null;
  if (prop.type === "status") return prop.status?.name ?? null;
  return null;
}

function extractMultiSelect(prop: any): string[] {
  if (!prop || prop.type !== "multi_select") return [];
  return (prop.multi_select ?? []).map((s: any) => s.name);
}

function extractDate(prop: any): string | null {
  if (!prop || prop.type !== "date") return null;
  return prop.date?.start ?? null;
}

function extractCheckbox(prop: any): boolean {
  if (!prop || prop.type !== "checkbox") return false;
  return !!prop.checkbox;
}

function findProp(props: any, name: string): any {
  if (!props) return null;
  if (props[name]) return props[name];
  const target = name.trim().toLowerCase();
  for (const key of Object.keys(props)) {
    if (key.trim().toLowerCase() === target) return props[key];
  }
  return null;
}

export const NOTION_COMMS_CODE_VERSION = "v2-findprop";

function mapPageToCommunication(page: any): Communication {
  const props = page.properties ?? {};
  return {
    id: page.id,
    url: page.url ?? "",
    title: extractText(findProp(props, "Title")) || extractText(findProp(props, "Name")),
    date: extractDate(findProp(props, "Touch Date")),
    channel: extractSelect(findProp(props, "Channel")),
    outcome: extractSelect(findProp(props, "Outcome")),
    top_challenges: extractMultiSelect(findProp(props, "Top Challenges")),
    message: extractText(findProp(props, "Message")),
    sent: extractCheckbox(findProp(props, "Sent")),
  };
}

async function resolveDataSourceId(): Promise<string> {
  if (NOTION_OUTREACH_DATA_SOURCE_ID) return NOTION_OUTREACH_DATA_SOURCE_ID;

  const res = await fetch(
    `https://api.notion.com/v1/databases/${NOTION_OUTREACH_DB_ID}`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${NOTION_INTEGRATION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
      },
    },
  );

  if (!res.ok) {
    const details = await res.text();
    throw new Error(
      `Failed to load database metadata (${res.status}): ${details.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  const dataSources = data.data_sources ?? [];
  if (dataSources.length === 0) {
    throw new Error(
      "Database has no data_sources -- nothing to query. Check integration access.",
    );
  }
  return dataSources[0].id;
}

export async function fetchCommunicationsForAccount(
  notionPageId: string,
  limit = 50,
): Promise<FetchResult> {
  if (!NOTION_INTEGRATION_TOKEN) {
    return { communications: [], error: "NOTION_INTEGRATION_TOKEN not configured" };
  }
  if (!notionPageId) {
    return { communications: [], error: "notion_page_id is empty" };
  }

  try {
    const dataSourceId = await resolveDataSourceId();

    const res = await fetch(
      `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${NOTION_INTEGRATION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filter: {
            property: "Related Outreach",
            relation: { contains: notionPageId },
          },
          sorts: [{ property: "Touch Date", direction: "descending" }],
          page_size: Math.min(limit, 100),
        }),
      },
    );

    if (!res.ok) {
      const details = await res.text();
      return {
        communications: [],
        error: `Notion API ${res.status}: ${details.slice(0, 300)}`,
      };
    }

    const data = await res.json();
    const communications = (data.results ?? [])
      .map(mapPageToCommunication)
      .slice(0, limit);
    return { communications, raw_first_page: data.results?.[0] };
  } catch (err) {
    return {
      communications: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function formatCommunicationsForPrompt(
  communications: Communication[],
  limit = 10,
  messageChars = 800,
): string {
  if (communications.length === 0) {
    return "No prior outreach touches on record for this account.";
  }
  const recent = communications.slice(0, limit);
  const lines = recent.map((c, i) => {
    const msg = c.message.length > messageChars
      ? c.message.slice(0, messageChars) + "…"
      : c.message;
    const header = [
      `#${i + 1}`,
      c.date ?? "(no date)",
      c.channel ?? "(no channel)",
      c.sent ? "SENT" : "NOT SENT",
      c.outcome ? `outcome=${c.outcome}` : null,
    ].filter(Boolean).join(" · ");
    const challenges = c.top_challenges.length > 0
      ? `challenges: ${c.top_challenges.join(", ")}`
      : null;
    return [
      header,
      c.title ? `title: ${c.title}` : null,
      challenges,
      msg ? `message: ${msg}` : null,
    ].filter(Boolean).join("\n");
  });
  const note = communications.length > recent.length
    ? `\n(${communications.length - recent.length} earlier touches omitted.)`
    : "";
  return lines.join("\n---\n") + note;
}
