import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { companies, triggered_by = "manual" } = await req.json() as {
      companies: string[];
      triggered_by?: string;
    };

    if (!Array.isArray(companies) || companies.length === 0) {
      return new Response(JSON.stringify({ error: "companies must be a non-empty array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const capped = companies.slice(0, 20).map((c) => String(c).trim()).filter(Boolean);

    // Find companies already pending or running to avoid duplicate jobs
    const { data: existing } = await supabase
      .from("research_jobs")
      .select("company_name")
      .in("status", ["pending", "running"])
      .in("company_name", capped);

    const alreadyQueued = new Set(
      (existing ?? []).map((r: any) => r.company_name.toLowerCase())
    );

    const toInsert = capped
      .filter((name) => !alreadyQueued.has(name.toLowerCase()))
      .map((company_name) => ({ company_name, triggered_by, status: "pending" }));

    let jobIds: string[] = [];
    if (toInsert.length > 0) {
      const { data: inserted, error } = await supabase
        .from("research_jobs")
        .insert(toInsert)
        .select("id");
      if (error) throw new Error(error.message);
      jobIds = (inserted ?? []).map((r: any) => r.id);
    }

    return new Response(
      JSON.stringify({
        queued: toInsert.length,
        skipped: capped.length - toInsert.length,
        job_ids: jobIds,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
