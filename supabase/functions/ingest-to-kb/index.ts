import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req) => {
  try {
    const body = await req.json();
    const { title, content, document_type, tags, account_id, source_url } = body;

    if (!title || !content || !document_type) {
      return new Response(
        JSON.stringify({ error: "title, content, and document_type are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const row: Record<string, unknown> = {
      title,
      content,
      document_type,
      tags: tags || [],
      account_id: account_id || null,
      source_url: source_url || null,
      metadata: {
        ingested_at: new Date().toISOString(),
        content_length: content.length,
        source: "agent_chat",
      },
    };

    const { data, error } = await supabase
      .from("knowledge_base")
      .insert(row)
      .select("id, title, document_type, tags, created_at")
      .single();

    if (error) throw error;

    return new Response(
      JSON.stringify({
        status: "saved",
        id: data.id,
        title: data.title,
        document_type: data.document_type,
        tags: data.tags,
        created_at: data.created_at,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
