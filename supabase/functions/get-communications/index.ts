import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCommunicationsForAccount, NOTION_COMMS_CODE_VERSION } from "../_shared/notion-communications.ts";
import { resolveAccountByName } from "../_shared/fuzzy-lookup.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const account_id: string | undefined = body?.account_id ?? body?.prospect_id;
    const company_name: string | undefined = body?.company_name;

    if (!account_id && !company_name) {
      return new Response(
        JSON.stringify({ error: "account_id or company_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let account: any = null;
    let matchInfo: any = undefined;
    if (account_id) {
      const { data } = await supabase
        .from("accounts")
        .select("id, company_name, notion_page_id")
        .eq("id", account_id)
        .single();
      account = data;
    } else if (company_name) {
      const resolved = await resolveAccountByName(supabase, company_name);
      if (resolved) {
        const { data } = await supabase
          .from("accounts")
          .select("id, company_name, notion_page_id")
          .eq("id", resolved.id)
          .single();
        account = data;
        matchInfo = resolved.match_info;
      }
    }

    // Fallback: if UUID lookup failed but we have a company_name, resolve
    // by name. Covers the case where the QB passes a stale/hallucinated
    // UUID alongside a valid name.
    if (!account && company_name) {
      const resolved = await resolveAccountByName(supabase, company_name);
      if (resolved) {
        const { data } = await supabase
          .from("accounts")
          .select("id, company_name, notion_page_id")
          .eq("id", resolved.id)
          .single();
        account = data;
        matchInfo = resolved.match_info;
      }
    }

    if (!account) {
      return new Response(
        JSON.stringify({ error: "Account not found", query: company_name ?? null }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!account.notion_page_id) {
      return new Response(
        JSON.stringify({
          account_id: account.id,
          company_name: account.company_name,
          _match_info: matchInfo,
          count: 0,
          communications: [],
          note: "Account has no notion_page_id -- cannot filter communications by relation.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const debug = body?.debug === true;
    const { communications, error, raw_first_page } = await fetchCommunicationsForAccount(
      account.notion_page_id,
      50,
    );

    if (error) {
      return new Response(
        JSON.stringify({
          account_id: account.id,
          company_name: account.company_name,
          _match_info: matchInfo,
          count: 0,
          communications: [],
          error,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({
        account_id: account.id,
        company_name: account.company_name,
        _match_info: matchInfo,
        count: communications.length,
        communications,
        _code_version: NOTION_COMMS_CODE_VERSION,
        ...(debug ? { raw_first_page } : {}),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
