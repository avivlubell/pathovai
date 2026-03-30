import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const DOC_TYPE_PATTERNS: Record<string, RegExp[]> = {
  clinical_study: [/clinical trial/i, /randomized/i, /placebo/i, /endpoint/i, /p-value/i, /cohort/i],
  regulatory_filing: [/510\(k\)/i, /FDA/i, /predicate device/i, /de novo/i, /PMA/i, /clearance/i],
  competitive_intel: [/competitor/i, /market share/i, /pricing/i, /SWOT/i, /competitive landscape/i],
  api_documentation: [/endpoint/i, /API/i, /REST/i, /GraphQL/i, /authentication/i, /bearer token/i],
  sales_collateral: [/ROI/i, /case study/i, /customer success/i, /testimonial/i, /value prop/i],
  contract: [/terms and conditions/i, /agreement/i, /whereas/i, /indemnif/i, /liability/i],
  pitch_deck: [/TAM.*SAM/i, /market opportunity/i, /go-to-market/i, /traction/i],
  whitepaper: [/abstract/i, /methodology/i, /conclusion/i, /references/i, /peer.?review/i],
};

function classifyDocument(text: string): string {
  const scores: Record<string, number> = {};
  for (const [docType, patterns] of Object.entries(DOC_TYPE_PATTERNS)) {
    scores[docType] = patterns.filter((p) => p.test(text)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 2 ? best[0] : "general";
}

serve(async (req) => {
  try {
    const { filename, file_size, file_type, raw_text, file_url, user_id } = await req.json();
    if (!raw_text?.trim()) {
      return new Response(JSON.stringify({ error: "No text content" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }
    const doc_type = classifyDocument(raw_text);
    const { data, error } = await supabase.from("documents").insert({
      user_id, filename, file_size, file_type, doc_type, raw_text, file_url, awaiting_intent: true,
    }).select().single();
    if (error) throw error;
    return new Response(JSON.stringify({ document_id: data.id, doc_type, filename, status: "parsed" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
