import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BATCH_LIMIT = 3;
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1`;

async function callEdgeFunction(name: string, body: Record<string, unknown>): Promise<any> {
  const resp = await fetch(`${FUNCTION_BASE}/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, status: resp.status, data: JSON.parse(text) };
  } catch {
    return { ok: resp.ok, status: resp.status, data: text };
  }
}

async function getUnprocessedProspects(limit: number) {
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, icp_score, research_status, notion_page_id")
    .is("icp_score", null)
    .not("company_name", "is", null)
        .not("notion_page_id", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Query failed: ${error.message}`);
  return data || [];
}

async function runPipelineForProspect(prospect: { id: string; company_name: string }) {
  const results: Record<string, any> = { prospect_id: prospect.id, company: prospect.company_name };
  const startTime = Date.now();


  // Step 0: Ensure prospect data is hydrated from Notion
  try {
    const { data: freshProspect } = await supabase
      .from("accounts")
            .select("research_output, research_summary, notion_page_id")
      .eq("id", prospect.id)
      .single();

        if (!freshProspect?.research_output && !freshProspect?.research_summary) {
      console.info(`[Pipeline] ${prospect.company_name} has no research data - attempting sync...`);

      if (freshProspect?.notion_page_id) {
        try {
          const syncResult = await callEdgeFunction("sync-prospect-content", {
            notion_page_id: freshProspect.notion_page_id,
            company_name: prospect.company_name,
          });
          results.sync = { ok: syncResult.ok, status: syncResult.status };
          console.info(`[Pipeline] Sync completed for ${prospect.company_name}: ${syncResult.ok}`);
        } catch (syncErr) {
          console.warn(`[Pipeline] Sync failed for ${prospect.company_name}:`, syncErr);
          results.sync = { ok: false, error: String(syncErr) };
        }
      } else {
        console.warn(`[Pipeline] ${prospect.company_name} has no notion_page_id - cannot sync, scoring against shell`);
        results.sync = { ok: false, error: "no_notion_page_id" };
      }
    } else {
      console.info(`[Pipeline] ${prospect.company_name} already has research data - skipping sync`);
      results.sync = { ok: true, skipped: true };
    }
  } catch (syncCheckErr) {
    console.warn(`[Pipeline] Sync check failed for ${prospect.company_name}:`, syncCheckErr);
    results.sync = { ok: false, error: String(syncCheckErr) };
  }


  // Step 0.5: Perplexity Research (if no research_output yet)
  try {
    // Re-fetch prospect to check for research_output
    const { data: currentProspect } = await supabase
      .from("accounts")
      .select("research_output")
      .eq("id", prospect.id)
      .single();

    if (!currentProspect?.research_output) {
      console.info(`[Pipeline] Running Perplexity research for ${prospect.company_name}...`);
      const researchResult = await callEdgeFunction("prospect-researcher", {
        prospect_id: prospect.id,
        company_name: prospect.company_name,
      });
      results.research = { ok: researchResult.ok, status: researchResult.status };
      if (researchResult.ok) {
        console.info(`[Pipeline] Research completed for ${prospect.company_name}`);
      } else {
        console.warn(`[Pipeline] Research returned non-ok for ${prospect.company_name}:`, researchResult.status);
      }
    } else {
      console.info(`[Pipeline] ${prospect.company_name} already has research_output - skipping Perplexity`);
      results.research = { ok: true, skipped: true };
    }
  } catch (researchErr) {
    console.error(`[Pipeline] Perplexity research failed for ${prospect.company_name}:`, researchErr);
    results.research = { ok: false, error: String(researchErr) };
  }
  // Step 1: ICP Scorer
  console.info(`[Pipeline] Scoring ${prospect.company_name}...`);
  try {
    const scorerResult = await callEdgeFunction("icp-scorer", {
      prospect_id: prospect.id,
      company_name: prospect.company_name,
    });
    results.icp_scorer = { ok: scorerResult.ok, status: scorerResult.status };
    if (scorerResult.ok && scorerResult.data?.tier === "Non-ICP") {
      console.info(`[Pipeline] ${prospect.company_name} scored Non-ICP/disqualified - skipping remaining agents`);
      results.skipped_agents = ["risk-assessor", "outreach-drafter"];
      results.skip_reason = "disqualified_by_scorer";
      results.duration_ms = Date.now() - startTime;
      return results;
    }
  } catch (err) {
    console.error(`[Pipeline] ICP scorer failed for ${prospect.company_name}:`, err);
    results.icp_scorer = { ok: false, error: String(err) };
    results.duration_ms = Date.now() - startTime;
    return results;
  }

  // Step 2: Risk Assessor
  console.info(`[Pipeline] Assessing risk for ${prospect.company_name}...`);
  try {
    const riskResult = await callEdgeFunction("risk-assessor", {
      prospect_id: prospect.id,
      company_name: prospect.company_name,
    });
    results.risk_assessor = { ok: riskResult.ok, status: riskResult.status };
    // risk-assessor doesn't write to DB, so we save the output
    if (riskResult.ok && riskResult.data) {
      const { error: updateErr } = await supabase
        .from("accounts")
        .update({
          risk_assessment: typeof riskResult.data === "string"
            ? riskResult.data
            : JSON.stringify(riskResult.data),
          updated_at: new Date().toISOString(),
        })
        .eq("id", prospect.id);
      if (updateErr) console.error(`[Pipeline] Failed to save risk assessment:`, updateErr);
    }
  } catch (err) {
    console.error(`[Pipeline] Risk assessor failed for ${prospect.company_name}:`, err);
    results.risk_assessor = { ok: false, error: String(err) };
  }

  // Step 3: Outreach Drafter
  console.info(`[Pipeline] Drafting outreach for ${prospect.company_name}...`);
  try {
    const outreachResult = await callEdgeFunction("outreach-drafter", {
      prospect_id: prospect.id,
    });
    results.outreach_drafter = { ok: outreachResult.ok, status: outreachResult.status };
  } catch (err) {
    console.error(`[Pipeline] Outreach drafter failed for ${prospect.company_name}:`, err);
    results.outreach_drafter = { ok: false, error: String(err) };
  }

  // Mark research_status as complete
  await supabase
    .from("accounts")
    .update({ research_status: "pipeline_complete", updated_at: new Date().toISOString() })
    .eq("id", prospect.id);

  results.duration_ms = Date.now() - startTime;
  return results;
}

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  try {
    const url = new URL(req.url);
    const limitParam = parseInt(url.searchParams.get("limit") || String(BATCH_LIMIT));
    const prospectId = url.searchParams.get("prospect_id");

    let prospects;
    if (prospectId) {
      // Run pipeline for a specific prospect
      const { data, error } = await supabase
        .from("accounts")
        .select("id, company_name")
        .eq("id", prospectId)
        .single();
      if (error || !data) {
        return new Response(
          JSON.stringify({ error: "Prospect not found", details: error?.message }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      prospects = [data];
    } else {
      prospects = await getUnprocessedProspects(limitParam);
    }

    if (prospects.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "No unprocessed prospects found", processed: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.info(`[Pipeline] Processing ${prospects.length} prospect(s)...`);
    const results = [];
    for (const prospect of prospects) {
      const result = await runPipelineForProspect(prospect);
      results.push(result);
      // Throttle between prospects to avoid rate limits
      if (prospects.length > 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    const successCount = results.filter((r) => r.icp_scorer?.ok).length;
    return new Response(
      JSON.stringify({
        success: true,
        processed: results.length,
        scored: successCount,
        errors: results.length - successCount,
        duration_ms: Date.now() - startTime,
        results,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[Pipeline] Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
