import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const DAILY_TRIAGE_PARENT_ID = Deno.env.get("NOTION_DAILY_TRIAGE_PARENT_ID")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const NOTION_HEADERS = {
  Authorization: `Bearer ${NOTION_TOKEN}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

const CONTACT_PRIORITY = [
  "CEO", "CRO", "CFO", "VP Sales", "VP Clinical",
  "Physician Champion", "Procurement", "Other",
];

function dashify(id: string): string {
  const s = id.replace(/-/g, "");
  if (s.length !== 32) return id;
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

async function notionFetch(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    ...init,
    headers: { ...NOTION_HEADERS, ...(init.headers as Record<string, string> || {}) },
  });
  const data = await res.json();
  if (!res.ok || data.object === "error") {
    throw new Error(`Notion ${path}: ${data.code ?? res.status} — ${data.message ?? ""}`);
  }
  return data;
}

function rt(text: string, bold = false): any {
  const r: any = { text: { content: text } };
  if (bold) r.annotations = { bold: true };
  return r;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "N/A";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

// Normalize icp_tier strings from either the OI or Trigger Monitor database.
function normTierScore(tier: string | null): number {
  const t = (tier ?? "").toLowerCase();
  if (t.includes("tier 1") || t.includes("priority") || t.includes("highest")) return 1000;
  if (t.includes("tier 2") || t.includes("qualified") || t.includes("strong")) return 500;
  return 0;
}

function buildBlocks(candidates: any[], date: string, totalPool: number, midSequenceAlerts: any[]): any[] {
  const blocks: any[] = [];

  const pipelineCount = candidates.filter((c: any) => c.source === "pipeline").length;
  const triggerCount = candidates.filter((c: any) => c.source === "trigger").length;

  let headerNote: string;
  if (totalPool === 0) {
    headerNote = "No candidates today — pipeline is fully active and no fresh triggers outside it.";
  } else {
    const parts: string[] = [];
    if (pipelineCount > 0) parts.push(`${pipelineCount} re-engage`);
    if (triggerCount > 0) parts.push(`${triggerCount} new trigger`);
    headerNote = `Top ${candidates.length} of ${totalPool} candidates (${parts.join(", ")}).`;
  }

  blocks.push({
    type: "heading_1",
    heading_1: { rich_text: [rt(`Morning Triage — ${date}`)] },
  });
  blocks.push({
    type: "paragraph",
    paragraph: { rich_text: [rt(headerNote)] },
  });
  blocks.push({ type: "divider", divider: {} });

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const icpStr = c.icp_score != null ? String(c.icp_score) : "—";
    const sourceLabel = c.source === "trigger" ? "New Trigger" : "Re-engage";
    const lastTouchStr = c.last_touch_date
      ? `${c.days_cold} days ago (${fmtDate(c.last_touch_date)})`
      : c.source === "trigger" ? "Not in pipeline" : "Never contacted";
    const contactStr = c.primaryContactName
      ? `${c.primaryContactName}${c.primaryContactTitle ? ", " + c.primaryContactTitle : ""}`
      : "No contact on file";

    blocks.push({
      type: "heading_3",
      heading_3: {
        rich_text: [rt(`${i + 1}. ${c.company_name} (${c.tier ?? "—"}) — ICP ${icpStr} · ${sourceLabel}`)],
      },
    });
    blocks.push({
      type: "paragraph",
      paragraph: { rich_text: [rt("Rank: ", true), rt(c.rankReason)] },
    });
    blocks.push({
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [rt("Last touch: ", true), rt(lastTouchStr)],
      },
    });
    if (c.hasFreshTrigger) {
      const trigStr = [c.triggerSummary, c.triggerDate ? `(${fmtDate(c.triggerDate)})` : ""]
        .filter(Boolean).join(" ");
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [rt("Trigger: ", true), rt(trigStr)] },
      });
    }
    if (c.hasTailwind) {
      const twStr = [c.tailwindTitle, c.tailwindDate ? `(${fmtDate(c.tailwindDate)})` : ""]
        .filter(Boolean).join(" ");
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [rt("Industry tailwind: ", true), rt(twStr)],
        },
      });
    }
    blocks.push({
      type: "bulleted_list_item",
      bulleted_list_item: {
        rich_text: [rt("Primary contact: ", true), rt(contactStr)],
      },
    });
    if (i < candidates.length - 1) {
      blocks.push({ type: "divider", divider: {} });
    }
  }

  // Mid-sequence alerts section — active sequences with new signals since last touch
  if (midSequenceAlerts.length > 0) {
    blocks.push({ type: "divider", divider: {} });
    blocks.push({
      type: "heading_2",
      heading_2: { rich_text: [rt("Mid-Sequence Alerts")] },
    });
    blocks.push({
      type: "paragraph",
      paragraph: {
        rich_text: [rt(`${midSequenceAlerts.length} active sequence${midSequenceAlerts.length > 1 ? "s" : ""} received a new signal since last touch.`)],
      },
    });
    for (const a of midSequenceAlerts) {
      const icpStr = a.icp_score != null ? String(a.icp_score) : "—";
      const lastTouchStr = `${a.days_cold} days ago (${fmtDate(a.last_touch_date)})`;
      const alertTypeLabel = a.alertType === "trigger" ? "Trigger" : "Hiring signal";
      const alertStr = [a.alertSummary, a.alertDate ? `(${fmtDate(a.alertDate)})` : ""]
        .filter(Boolean).join(" ");
      blocks.push({
        type: "heading_3",
        heading_3: {
          rich_text: [rt(`${a.company_name} (${a.tier ?? "—"}) — ICP ${icpStr} · Active sequence`)],
        },
      });
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [rt("Last touch: ", true), rt(lastTouchStr)],
        },
      });
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [rt(`${alertTypeLabel}: `, true), rt(alertStr)],
        },
      });
      if (a.primaryContactName) {
        const contactStr = `${a.primaryContactName}${a.primaryContactTitle ? ", " + a.primaryContactTitle : ""}`;
        blocks.push({
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [rt("Primary contact: ", true), rt(contactStr)],
          },
        });
      }
    }
  }

  return blocks;
}

async function clearPageContent(pageId: string): Promise<void> {
  let cursor: string | undefined;
  const blockIds: string[] = [];
  do {
    const params = cursor ? `?start_cursor=${cursor}` : "";
    const data = await notionFetch(`/blocks/${dashify(pageId)}/children${params}`);
    for (const block of data.results ?? []) blockIds.push(block.id);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  for (const id of blockIds) {
    await notionFetch(`/blocks/${id}`, { method: "DELETE" });
  }
}

Deno.serve(async (_req) => {
  if (!DAILY_TRIAGE_PARENT_ID) {
    return new Response(
      JSON.stringify({ success: false, error: "NOTION_DAILY_TRIAGE_PARENT_ID secret not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  try {
    // ── 1. Fetch in parallel: OI accounts + all account names + triggers + hiring signals ─
    const [accsResult, allNamesResult, triggersResult, hiringResult] = await Promise.all([
      supabase
        .from("accounts")
        .select("id, notion_page_id, company_name, tier, icp_score, engage_decision, company_notion_page_id")
        .in("tier", ["Tier 1: Priority", "Tier 2: Qualified"])
        .or("engage_decision.in.(Proceed,Monitor),engage_decision.is.null")
        .not("exclude_from_brief", "is", true),
      // All account company names for dedup — prevents surfacing companies
      // already in the pipeline (any tier) as net-new triggers.
      supabase
        .from("accounts")
        .select("company_name")
        .not("company_name", "is", null),
      supabase
        .from("icp_triggers")
        .select("company_name, icp_tier, icp_score, trigger_types, summary, date_found, founder_name, founder_role, outreach_status")
        .gte("date_found", thirtyDaysAgo)
        .neq("outreach_status", "Disqualified")
        .order("date_found", { ascending: false }),
      supabase
        .from("hiring_signals")
        .select("company, icp_signal, seniority, name, role, date_found, run_date, notes")
        .in("icp_signal", ["Strong fit", "Possible fit"])
        .gte("run_date", thirtyDaysAgo)
        .order("run_date", { ascending: false }),
    ]);

    if (accsResult.error) throw new Error(`accounts: ${accsResult.error.message}`);

    const accs = accsResult.data ?? [];
    const allAccountNames = new Set(
      (allNamesResult.data ?? []).map((a: any) => a.company_name?.toLowerCase()).filter(Boolean)
    );
    const allTriggers = triggersResult.data ?? [];

    // Build trigger lookup: company_name → trigger (most recent per company)
    const triggerMap = new Map<string, any>();
    for (const t of allTriggers) {
      const key = t.company_name?.toLowerCase();
      if (key && !triggerMap.has(key)) triggerMap.set(key, t);
    }

    // Build hiring signal lookup: company → most recent signal per company
    const hiringSignalMap = new Map<string, any>();
    for (const h of hiringResult.data ?? []) {
      const key = h.company?.toLowerCase();
      if (key && !hiringSignalMap.has(key)) hiringSignalMap.set(key, h);
    }

    // ── 2. Pool 1: cold pipeline accounts ────────────────────────────────────
    let pipelineCandidates: any[] = [];
    const midSequenceAlerts: any[] = [];

    if (accs.length > 0) {
      const { data: touchRows } = await supabase
        .from("touches")
        .select("account_id, effective_touch_date")
        .in("account_id", accs.map((a: any) => a.id))
        .eq("sent", true)
        .order("effective_touch_date", { ascending: false, nullsFirst: false });

      // lastTouchMap: account_id → most recent dated send (for days_cold calc)
      // hasSentTouchSet: account_ids with any sent touch, even undated ones —
      // prevents accounts from showing as "never contacted" when Sent Touch Date
      // wasn't filled in Notion.
      const lastTouchMap = new Map<string, string>();
      const hasSentTouchSet = new Set<string>();
      for (const t of touchRows ?? []) {
        hasSentTouchSet.add(t.account_id);
        if (t.effective_touch_date && !lastTouchMap.has(t.account_id)) {
          lastTouchMap.set(t.account_id, t.effective_touch_date);
        }
      }

      const allPipelineCandidates = accs.map((a: any) => {
          const lastTouch = lastTouchMap.get(a.id) ?? null;
          const daysCold = lastTouch
            ? Math.floor((Date.now() - new Date(lastTouch).getTime()) / 86400000)
            : null;
          const key = a.company_name?.toLowerCase();
          const trig = triggerMap.get(key);
          const hiring = hiringSignalMap.get(key);
          // Show whichever fresh signal is most recent
          const hasFreshTrig = !!trig;
          const hasFreshHiring = !!hiring;
          const hasFreshTrigger = hasFreshTrig || hasFreshHiring;
          let triggerSummary: string | null = null;
          let triggerDate: string | null = null;
          if (hasFreshTrig && hasFreshHiring) {
            const trigDate = trig.date_found ?? "";
            const hirDate = hiring.run_date ?? hiring.date_found ?? "";
            if (trigDate >= hirDate) {
              triggerSummary = trig.summary || trig.trigger_types?.join(", ") || "Trigger event";
              triggerDate = trig.date_found ?? null;
            } else {
              triggerSummary = `Hiring: ${hiring.name || hiring.role} (${hiring.seniority || ""})`;
              triggerDate = hiring.run_date ?? hiring.date_found ?? null;
            }
          } else if (hasFreshTrig) {
            triggerSummary = trig.summary || trig.trigger_types?.join(", ") || "Trigger event";
            triggerDate = trig.date_found ?? null;
          } else if (hasFreshHiring) {
            triggerSummary = `Hiring: ${hiring.name || hiring.role} (${hiring.seniority || ""})`;
            triggerDate = hiring.run_date ?? hiring.date_found ?? null;
          }
          return {
            ...a,
            source: "pipeline",
            last_touch_date: lastTouch,
            days_cold: daysCold,
            hasSentTouch: hasSentTouchSet.has(a.id),
            therapeutic_area: [] as string[],
            hasFreshTrigger,
            triggerSummary,
            triggerDate,
            hasTailwind: false,
            tailwindTitle: null as string | null,
            tailwindDate: null as string | null,
            rankScore: 0,
            rankReason: "",
            primaryContactName: null as string | null,
            primaryContactTitle: null as string | null,
          };
        });

      // Include if: truly never contacted (no sent touches at all)
      // OR last dated touch was 90+ days ago.
      // Exclude if: has any sent touch with no date — those aren't "never contacted",
      // the user just didn't fill Sent Touch Date in Notion.
      pipelineCandidates = allPipelineCandidates.filter(
        (a: any) => (a.days_cold === null && !a.hasSentTouch) || a.days_cold >= 90
      );

      // Pool 3: active sequences (< 90 days cold) with signals newer than last touch
      const activeSequenceCandidates = allPipelineCandidates.filter(
        (a: any) => a.days_cold !== null && a.days_cold < 90
      );
      for (const a of activeSequenceCandidates) {
        const key = a.company_name?.toLowerCase();
        const trig = triggerMap.get(key);
        const hiring = hiringSignalMap.get(key);
        const lastTouch = a.last_touch_date ?? null;
        const trigFresh = trig && (!lastTouch || trig.date_found > lastTouch);
        const hiringFresh = hiring && (!lastTouch || (hiring.run_date ?? hiring.date_found ?? "") > lastTouch);
        if (!trigFresh && !hiringFresh) continue;
        // Pick the most recent signal type
        let alertType: "trigger" | "hiring";
        if (trigFresh && hiringFresh) {
          alertType = (trig.date_found ?? "") >= (hiring.run_date ?? hiring.date_found ?? "") ? "trigger" : "hiring";
        } else {
          alertType = trigFresh ? "trigger" : "hiring";
        }
        midSequenceAlerts.push({
          ...a,
          alertType,
          alertSummary: alertType === "trigger"
            ? (trig.summary || trig.trigger_types?.join(", ") || "Trigger event")
            : `Hiring: ${hiring.name || hiring.role} (${hiring.seniority || ""})`,
          alertDate: alertType === "trigger"
            ? (trig.date_found ?? null)
            : (hiring.run_date ?? hiring.date_found ?? null),
        });
      }
    }

    // ── 3. Tailwinds for Pool 1 ──────────────────────────────────────────────
    if (pipelineCandidates.length > 0) {
      const companyIds = pipelineCandidates.map((c: any) => c.company_notion_page_id).filter(Boolean);
      if (companyIds.length > 0) {
        const { data: companies } = await supabase
          .from("companies")
          .select("notion_page_id, therapeutic_area")
          .in("notion_page_id", companyIds);

        const cMap = new Map<string, string[]>();
        for (const co of companies ?? []) {
          if (co.therapeutic_area?.length) cMap.set(co.notion_page_id, co.therapeutic_area);
        }
        for (const c of pipelineCandidates) {
          if (c.company_notion_page_id) {
            c.therapeutic_area = cMap.get(c.company_notion_page_id) ?? [];
          }
        }
      }

      const allTas = [...new Set(pipelineCandidates.flatMap((c: any) => c.therapeutic_area as string[]))];
      if (allTas.length > 0) {
        const { data: tailwinds } = await supabase
          .from("industry_intelligence")
          .select("title, therapeutic_area, source_date")
          .eq("signal_type", "Tailwind")
          .gte("source_date", thirtyDaysAgo)
          .overlaps("therapeutic_area", allTas);

        const taTailwindMap = new Map<string, any>();
        for (const tw of tailwinds ?? []) {
          for (const ta of tw.therapeutic_area ?? []) {
            if (!taTailwindMap.has(ta)) taTailwindMap.set(ta, tw);
          }
        }
        for (const c of pipelineCandidates) {
          for (const ta of c.therapeutic_area) {
            const tw = taTailwindMap.get(ta);
            if (tw) {
              c.hasTailwind = true;
              c.tailwindTitle = tw.title;
              c.tailwindDate = tw.source_date;
              break;
            }
          }
        }
      }
    }

    // ── 4. Contacts for Pool 1 + mid-sequence alerts ────────────────────────
    const contactTargets = [
      ...pipelineCandidates,
      ...midSequenceAlerts,
    ].filter((c: any) => c.id);
    if (contactTargets.length > 0) {
      const { data: contactRows } = await supabase
        .from("contacts")
        .select("account_id, full_name, title, contact_type")
        .in("account_id", contactTargets.map((c: any) => c.id))
        .not("account_id", "is", null);

      const contactMap = new Map<string, any>();
      for (const ct of contactRows ?? []) {
        const existing = contactMap.get(ct.account_id);
        if (!existing) {
          contactMap.set(ct.account_id, ct);
        } else {
          const ep = CONTACT_PRIORITY.indexOf(existing.contact_type ?? "");
          const np = CONTACT_PRIORITY.indexOf(ct.contact_type ?? "");
          if (np !== -1 && (ep === -1 || np < ep)) contactMap.set(ct.account_id, ct);
        }
      }
      for (const c of contactTargets) {
        const ct = contactMap.get(c.id);
        if (ct) {
          c.primaryContactName = ct.full_name;
          c.primaryContactTitle = ct.title || ct.contact_type;
        }
      }
    }

    // ── 5. Pool 2: net-new triggers not already in any OI account ────────────
    const triggerCandidates: any[] = [];
    for (const t of allTriggers) {
      const key = t.company_name?.toLowerCase();
      if (!key || allAccountNames.has(key)) continue; // already in pipeline
      // De-duplicate: one candidate per company
      const alreadyAdded = triggerCandidates.some(
        (c: any) => c.company_name?.toLowerCase() === key
      );
      if (alreadyAdded) continue;

      triggerCandidates.push({
        id: null,
        notion_page_id: null,
        company_name: t.company_name,
        tier: t.icp_tier ?? null,
        icp_score: parseFloat(t.icp_score) || null,
        source: "trigger",
        last_touch_date: null,
        days_cold: null,
        therapeutic_area: [],
        hasFreshTrigger: true,
        triggerSummary: t.summary || t.trigger_types?.join(", ") || "Trigger event",
        triggerDate: t.date_found,
        hasTailwind: false,
        tailwindTitle: null,
        tailwindDate: null,
        rankScore: 0,
        rankReason: "",
        primaryContactName: t.founder_name ?? null,
        primaryContactTitle: t.founder_role ?? null,
      });
    }

    // ── 6. Unified ranking ───────────────────────────────────────────────────
    // Tier (1 > 2) > fresh trigger > industry tailwind > ICP score.
    // normTierScore handles both OI and Trigger Monitor vocabulary.
    const allCandidates = [...pipelineCandidates, ...triggerCandidates];

    for (const c of allCandidates) {
      const tierScore = normTierScore(c.tier);
      const trigScore = c.hasFreshTrigger ? 200 : 0;
      const tailScore = c.hasTailwind ? 100 : 0;
      const icpScore = Number(c.icp_score) || 0;
      c.rankScore = tierScore + trigScore + tailScore + icpScore;

      const parts: string[] = [c.tier ?? "Untiered"];
      if (c.source === "trigger") parts.push("new trigger");
      else if (c.hasFreshTrigger) parts.push("fresh trigger");
      if (c.hasTailwind) parts.push("industry tailwind");
      parts.push(`ICP ${icpScore || "—"}`);
      c.rankReason = parts.join(" · ");
    }

    allCandidates.sort((a: any, b: any) => b.rankScore - a.rankScore);
    const top7 = allCandidates.slice(0, 7);

    // ── 7. Idempotency + Notion write ────────────────────────────────────────
    const { data: existingRun } = await supabase
      .from("triage_runs")
      .select("notion_page_id")
      .eq("run_date", today)
      .maybeSingle();

    const alertsToShow = midSequenceAlerts.slice(0, 3);
    const blocks = buildBlocks(top7, today, allCandidates.length, alertsToShow);
    let notionPageId: string;

    if (existingRun?.notion_page_id) {
      notionPageId = existingRun.notion_page_id;
      await clearPageContent(notionPageId);
      await notionFetch(`/blocks/${dashify(notionPageId)}/children`, {
        method: "PATCH",
        body: JSON.stringify({ children: blocks }),
      });
      await supabase
        .from("triage_runs")
        .update({ candidate_count: top7.length, updated_at: new Date().toISOString() })
        .eq("run_date", today);
    } else {
      const created = await notionFetch("/pages", {
        method: "POST",
        body: JSON.stringify({
          parent: { page_id: dashify(DAILY_TRIAGE_PARENT_ID) },
          properties: {
            title: { title: [{ text: { content: `Morning Triage — ${today}` } }] },
          },
          children: blocks,
        }),
      });
      notionPageId = created.id.replace(/-/g, "");
      await supabase.from("triage_runs").insert({
        run_date: today,
        notion_page_id: notionPageId,
        candidate_count: top7.length,
      });
    }

    // ── 8. Overnight auto-research results ───────────────────────────────────
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: autoResearch } = await supabase
      .from("knowledge_base")
      .select("id, title, content, created_at, tags")
      .contains("tags", ["auto-research", "pending-review"])
      .gte("created_at", yesterday)
      .order("created_at", { ascending: false })
      .limit(10);

    if (autoResearch && autoResearch.length > 0) {
      blocks.push({ type: "divider", divider: {} });
      blocks.push({
        type: "heading_2",
        heading_2: { rich_text: [rt("Overnight Research")] },
      });
      blocks.push({
        type: "paragraph",
        paragraph: {
          rich_text: [rt(`${autoResearch.length} compan${autoResearch.length === 1 ? "y" : "ies"} researched overnight. Ask the QB about any of these for the full brief.`)],
        },
      });
      for (const r of autoResearch) {
        // Extract ICP hypothesis line if present
        const hypothesisMatch = r.content?.match(/6\.\s*ICP_HYPOTHESIS[\s\S]{0,20}?\n([\s\S]{0,400}?)(?:\n\n|\n<<<|$)/i);
        const snippet = hypothesisMatch?.[1]?.trim().slice(0, 300) ?? r.content?.slice(0, 200)?.trim();
        const companyName = r.title?.replace("Auto-Research: ", "") ?? "Unknown";
        blocks.push({
          type: "bulleted_list_item",
          bulleted_list_item: {
            rich_text: [
              rt(`${companyName}: `, true),
              rt(snippet ?? "Research complete — ask QB for summary."),
            ],
          },
        });
      }
    }

    // ── 9. Knowledge base entry ───────────────────────────────────────────────
    if (top7.length > 0) {
      const kbLines = top7.map((c: any, i: number) => {
        const sourceTag = c.source === "trigger" ? "[New Trigger]" : "[Re-engage]";
        return (
          `${i + 1}. ${c.company_name} ${sourceTag} (${c.tier ?? "—"}, ICP ${c.icp_score ?? "—"}) — ${c.rankReason}. ` +
          `Last touch: ${c.days_cold != null ? c.days_cold + " days ago" : c.source === "trigger" ? "not in pipeline" : "never"}.` +
          (c.hasFreshTrigger ? ` Trigger: ${c.triggerSummary}.` : "") +
          (c.hasTailwind ? ` Tailwind: ${c.tailwindTitle}.` : "") +
          (c.primaryContactName ? ` Contact: ${c.primaryContactName}${c.primaryContactTitle ? ", " + c.primaryContactTitle : ""}.` : "")
        );
      });

      const alertLines = alertsToShow.map((a: any) => {
        const alertTypeLabel = a.alertType === "trigger" ? "Trigger" : "Hiring signal";
        return `[Mid-sequence alert] ${a.company_name} (${a.tier ?? "—"}, ICP ${a.icp_score ?? "—"}) — ` +
          `last touch ${a.days_cold} days ago. ${alertTypeLabel}: ${a.alertSummary}.`;
      });

      const overnightLines = (autoResearch ?? []).map((r: any) => {
        const companyName = r.title?.replace("Auto-Research: ", "") ?? "Unknown";
        const hypothesisMatch = r.content?.match(/6\.\s*ICP_HYPOTHESIS[\s\S]{0,20}?\n([\s\S]{0,300}?)(?:\n\n|\n<<<|$)/i);
        const snippet = hypothesisMatch?.[1]?.trim().slice(0, 200) ?? "";
        return `[Overnight Research] ${companyName}${snippet ? ": " + snippet : " — research complete, ask QB for full brief"}`;
      });

      const kbContent =
        `Morning Triage ${today}: ${top7.length} candidate(s) — ` +
        `${pipelineCandidates.filter((c: any) => top7.includes(c)).length} pipeline re-engage, ` +
        `${triggerCandidates.filter((c: any) => top7.includes(c)).length} new triggers.` +
        (alertsToShow.length > 0 ? ` ${alertsToShow.length} mid-sequence alert(s).` : "") +
        (overnightLines.length > 0 ? ` ${overnightLines.length} overnight research result(s).` : "") +
        "\n\n" + kbLines.join("\n") +
        (alertLines.length > 0 ? "\n\n" + alertLines.join("\n") : "") +
        (overnightLines.length > 0 ? "\n\n" + overnightLines.join("\n") : "");

      await supabase.from("knowledge_base").insert({
        title: `Morning Triage ${today}`,
        content: kbContent,
        document_type: "research_note",
        tags: ["triage", "morning-triage", today],
        source_url: null,
        account_id: null,
        metadata: {
          ingested_at: new Date().toISOString(),
          content_length: kbContent.length,
          source: "morning_triage",
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        candidates_shown: top7.length,
        pipeline_candidates: pipelineCandidates.length,
        trigger_candidates: triggerCandidates.length,
        mid_sequence_alerts: alertsToShow.length,
        notion_page_id: notionPageId!,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ success: false, error: e.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
