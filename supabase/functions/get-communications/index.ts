import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { fetchCommunicationsForAccount } from "../_shared/notion-communications.ts";

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
    if (account_id) {
      const { data } = await supabase
        .from("accounts")
        .select("id, company_name, notion_page_id")
        .eq("id", account_id)
        .single();
      account = data;
    } else if (company_name) {
      const { data } = await supabase
        .from("accounts")
        .select("id, company_name, notion_page_id")
        .ilike("company_name", `%${company_name}%`)
        .limit(1)
        .single();
      account = data;
    }

    if (!account) {
      return new Response(
        JSON.stringify({ error: "Account not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!account.notion_page_id) {
      return new Response(
        JSON.stringify({
          account_id: account.id,
          company_name: account.company_name,
          count: 0,
          communications: [],
          note: "Account has no notion_page_id -- cannot filter communications by relation.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { communications, error } = await fetchCommunicationsForAccount(
      account.notion_page_id,
      50,
    );

    if (error) {
      return new Response(
        JSON.stringify({
          account_id: account.id,
          company_name: account.company_name,
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
        count: communications.length,
        communications,
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
