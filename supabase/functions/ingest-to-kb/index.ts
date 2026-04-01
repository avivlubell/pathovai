import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

async function getEmbedding(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8000),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error("Embedding error:", data.error?.message);
      return null;
    }
    return data.data[0].embedding;
  } catch (err) {
    console.error("Embedding fetch failed:", err);
    return null;
  }
}

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

    // Generate embedding from title + first portion of content
    const embeddingInput = `${title}\n\n${content.slice(0, 6000)}`;
    const embedding = await getEmbedding(embeddingInput);

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

    if (embedding) {
      row.embedding = JSON.stringify(embedding);
    }

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
        has_embedding: !!embedding,
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
