import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const CHAR_CHUNK = 3200;
const CHAR_OVERLAP = 400;

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = start + CHAR_CHUNK;
    if (end < text.length) {
      const brk = Math.max(text.lastIndexOf(".", end), text.lastIndexOf("\n", end));
      if (brk > start + CHAR_CHUNK * 0.5) end = brk + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end - CHAR_OVERLAP;
  }
  return chunks.filter((c) => c.length > 50);
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Embedding API error");
  return data.data.map((d: any) => d.embedding);
}

serve(async (req) => {
  try {
    const { document_id } = await req.json();
    if (!document_id) return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    const { data: doc, error: docErr } = await supabase.from("documents").select("*").eq("id", document_id).single();
    if (docErr || !doc) return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { "Content-Type": "application/json" } });

    const chunks = chunkText(doc.raw_text);
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += 20) {
      const embeddings = await getEmbeddings(chunks.slice(i, i + 20));
      allEmbeddings.push(...embeddings);
    }

    const rows = chunks.map((chunk_text, idx) => ({
      document_id, chunk_index: idx, chunk_text,
      embedding: JSON.stringify(allEmbeddings[idx]),
      metadata: { doc_type: doc.doc_type, filename: doc.filename, chunk_of: chunks.length },
    }));

    const { error: insertErr } = await supabase.from("knowledge_chunks").insert(rows);
    if (insertErr) throw insertErr;

    await supabase.from("documents")
      .update({ awaiting_intent: false, metadata: { ...doc.metadata, saved_to_kb: true } })
      .eq("id", document_id);

    return new Response(JSON.stringify({ document_id, chunks_created: chunks.length, status: "ingested" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
