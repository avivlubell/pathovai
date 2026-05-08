import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const {
      query,
      document_type,
      tags,
      created_after,
      limit = 5,
    } = body;

    let q = supabase
      .from("knowledge_base")
      .select("id, title, content, document_type, tags, created_at, account_id")
      .order("created_at", { ascending: false })
      .limit(Math.min(limit, 20));

    if (document_type) q = q.eq("document_type", document_type);
    if (Array.isArray(tags) && tags.length > 0) q = q.overlaps("tags", tags);
    if (created_after) q = q.gte("created_at", created_after);
    if (query) {
      q = q.or(`title.ilike.%${query}%,content.ilike.%${query}%`);
    }

    const { data, error } = await q;
    if (error) throw error;

    return new Response(JSON.stringify({ results: data ?? [], count: data?.length ?? 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
