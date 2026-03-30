export type DocumentIntent =
  | 'extract_endpoints' | 'icp_scoring' | 'competitive_analysis'
  | 'save_to_kb' | 'summarize' | 'extract_contacts'
  | 'regulatory_analysis' | 'pricing_analysis' | 'risk_assessment'
  | 'draft_outreach' | 'general_question';

const INTENT_PATTERNS: Record<DocumentIntent, RegExp[]> = {
  extract_endpoints: [/endpoint/i, /API/i, /routes?/i, /URL/i, /integration/i],
  icp_scoring: [/ICP/i, /score/i, /fit/i, /qualify/i, /ideal customer/i],
  competitive_analysis: [/compet/i, /vs\.?/i, /compare/i, /differentiat/i, /landscape/i],
  save_to_kb: [/save/i, /knowledge base/i, /\bKB\b/i, /store/i, /remember/i, /ingest/i],
  summarize: [/summar/i, /overview/i, /key (points|takeaways)/i, /tl;?dr/i],
  extract_contacts: [/contact/i, /email/i, /team/i, /people/i, /leadership/i],
  regulatory_analysis: [/FDA/i, /510\(k\)/i, /clearance/i, /regulat/i, /approval/i],
  pricing_analysis: [/pric/i, /cost/i, /reimburse/i, /CPT/i, /billing/i],
  risk_assessment: [/risk/i, /red flag/i, /concern/i, /warning/i],
  draft_outreach: [/outreach/i, /email draft/i, /reach out/i, /cold email/i, /sequence/i],
  general_question: [],
};

export function classifyIntent(msg: string): DocumentIntent[] {
  const results: { intent: DocumentIntent; score: number }[] = [];
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [DocumentIntent, RegExp[]][]) {
    if (!patterns.length) continue;
    const hits = patterns.filter((p) => p.test(msg)).length;
    if (hits > 0) results.push({ intent, score: hits / patterns.length });
  }
  if (!results.length) return ['general_question'];
  return results.sort((a, b) => b.score - a.score).filter((r) => r.score >= 0.2).map((r) => r.intent);
}
