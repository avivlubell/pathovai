export const maxDuration = 300;
export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { SYSTEM_PROMPT } from './system-prompt';
import { createClient } from '@supabase/supabase-js';
import { buildConversationContext } from '../../../lib/contextPrompt';
import { authOptions } from '../../../lib/authOptions';
import { delegateTools } from './delegate-tools';
import { executeTool, humanizeToolCall } from './tool-executor';
import { runManager } from './managers/runner';
import type { ManagerType, TaskPacket } from './managers/types';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fetchLearnings(): Promise<{ text: string; tokenEstimate: number }> {
  try {
    const { data } = await supabase
      .from('v_canonical_learnings')
      .select('content, agent_source, severity')
      .in('severity', ['hard_rule', 'preference'])
      .or('agent_source.eq.*,agent_source.eq.quarterback,agent_source.is.null')
      .order('created_at', { ascending: false })
      .limit(30);
    if (!data || data.length === 0) return { text: '', tokenEstimate: 0 };
    const lines = data.map((l: any) =>
      `[${l.agent_source || '*'}][${l.severity}] ${l.content}`
    );
    const text = '\n\n## Active Learnings & Corrections\n' + lines.join('\n');
    return { text, tokenEstimate: Math.ceil(text.length / 4) };
  } catch {
    return { text: '', tokenEstimate: 0 };
  }
}

interface ToolCallRecord {
  name: string;
  result: string;
}

const VERIFIER_TOOL = {
  name: 'report_verification',
  description:
    'Report claims in the assistant draft that cannot be grounded in the tool outputs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      flag: {
        type: 'array',
        description:
          'Specific claims that cannot be confirmed from the tool data and should be surfaced to the user for verification.',
        items: {
          type: 'object',
          properties: {
            line: {
              type: 'string',
              description:
                'The verbatim line from the draft, including any leading bullet markers, list numbers, or table pipe characters. Must match the draft text exactly so the line can be located and replaced.',
            },
            claim: {
              type: 'string',
              description: 'A short, readable description of the unverified claim.',
            },
            reason: {
              type: 'string',
              description:
                'One sentence stating the specific entity/number/date/quote you searched for in the corpus and confirming it was absent. Format: "Searched corpus for X — not present." Do not use generic phrases like "needs a source tag" or "doesn\'t say where this came from"; those are not valid grounding-failure reasons.',
            },
            criticality: {
              type: 'string',
              enum: ['HIGH', 'MEDIUM', 'LOW'],
              description:
                'HIGH = factual error likely to mislead. MEDIUM = should verify before acting. LOW = probably fine but worth a check.',
            },
          },
          required: ['line', 'claim', 'reason', 'criticality'],
        },
      },
      strip: {
        type: 'array',
        description:
          'Direct quotes attributed to a named person or org that do not appear in the tool data. These lines will be removed from the response.',
        items: {
          type: 'object',
          properties: {
            line: {
              type: 'string',
              description: 'The verbatim line from the draft to remove. Must match exactly.',
            },
            reason: {
              type: 'string',
              description: 'One sentence explaining why this is treated as fabrication.',
            },
          },
          required: ['line', 'reason'],
        },
      },
    },
    required: ['flag', 'strip'],
  },
};

const VERIFIER_SYSTEM_PROMPT = `You are a fact-checker for a sales prospecting assistant. You receive a draft response the assistant wrote and the raw tool outputs the assistant pulled. Identify specific claims in the draft that cannot be grounded in the tool outputs.

YOUR ONE JOB is grounding: did the entity / number / date / quote in the draft appear in the corpus? Nothing else.

You are NOT a style reviewer, citation reviewer, or QA assistant. Specifically, do not:
- Flag lines for missing inline source tags, citations, or attribution. The assistant has its own rules about citations; that is not your concern.
- Invent your own QA criteria. The "Do NOT flag" list below is exhaustive — if a line doesn't fall into a flag category from THIS prompt, leave it alone.
- Use generic reasons like "doesn't say where this came from" or "needs a source tag". The only valid reason to flag is that you searched the corpus and the specific entity/number/date/quote is genuinely absent.

Before flagging anything, you MUST search the corpus for the supporting evidence. The reason field MUST quote a verbatim excerpt of what you searched for and confirm the corpus did not contain it. If you cannot articulate what specifically you searched for and didn't find, do not flag.

Be tolerant of harmless format differences:
- Date formats: "Dec 2025", "December 2025", "12/2025", "2025-12-15" all refer to the same date.
- Name variants: "IdentifEye" matches "Identifeye" matches "identifeye health". Case and spacing don't matter.
- Numeric formats: "$10M" matches "$10,000,000" matches "10 million".
- Aggregations: if the draft says "78 LinkedIn touches" and the data has 78 LinkedIn rows, that's correct — do not flag derived counts/sums.
- Verb/event paraphrases: "established", "effective", "active", "launched", "introduced", "released", "took effect", "went live", "announced", "set up", "stood up" all describe the same kind of milestone. If the corpus says a code/program/policy was "effective April 1, 2026" and the draft says "established in April 2026" / "launched in April 2026" / "took effect April 2026", that is the same event paraphrased — do not flag. The grounded fact is the entity + the date + the milestone existing; the verb is the assistant's word choice. Granularity differences in the same direction are fine too: "April 2026" is a faithful summary of "April 1, 2026". Only flag if the date is wrong (different month/year), the entity is missing, or the milestone itself is absent.

Sanity check before writing a flag: read the reason field you are about to submit. If it contains ANY of these affirmative phrases — "found X in query_Y", "is present", "phrase ... is present", "appears verbatim", "matches the corpus/data", "grounded in", "record shows", "data shows", "notes show", "notes mention", "the [X] record shows" — the claim IS grounded by your own admission. Drop the flag. There is no valid flag whose reason starts with "Searched corpus for X — found ..."; only "Searched corpus for X — not present" is a valid grounding failure.

Grounding is corpus-wide: if the entity/number/date/quote appears in ANY tool output in the corpus — whether in query_deals notes, query_touches rows, account detail fields, or anywhere else — the claim is grounded. Do not require a specific "canonical" tool to be the source. A WhatsApp touch mentioned in deal notes IS grounded even if it does not appear as a dedicated row in query_touches. If your reason says "query_X record shows Y in the notes, but query_Z does not return Y", the claim is grounded — drop the flag.

Time-sensitive claims ("past due", "overdue", "X days ago", "this week", "last month"): evaluate using today's date from the <context> block. Do not flag a "past due" claim if the corpus contains the touch date and today's date confirms it is in the past.

Specifically forbidden flag patterns, even if you feel something is "off":
- Word-choice disputes when the entity + date + milestone are all in the corpus ("the data states X became Y on D, not that it was 'Z' on D"). The verb is the assistant's choice, not a fact.
- Granularity disputes ("the data says April 1, 2026, not 'April 2026'"). Month-grain is a faithful summary of full-date.
- Corpus-internal contradictions. If two fields in the corpus disagree (e.g., a structured \`clearance_date: '2026-02-26'\` plus a summary string saying "cleared April 9, 2026"), and the draft cites one of those values, the draft IS grounded — pick the value it cites and confirm presence, then stop. Do not flag the draft for a contradiction that lives inside the source data; that is a corpus integrity issue for a different surface, not a draft hallucination.
- Cross-claim consistency disputes ("the draft says February 2026 but later says '3 months post-clearance' implying May"). The verifier checks whether each claim is in the corpus, not whether the assistant's prose is internally self-consistent.

Two output categories:

flag — a claim cannot be grounded and should be surfaced to the user:
- A name of a person, org, or product not in the data.
- A number, date, or amount not in the data (after format normalization).
- A claim that contradicts the data.
- A claim attributed to "the data" or "the records" that you cannot find in the data.

strip — a direct quote attributed to a specific named person or org that is not in the data. Use sparingly; only for explicit attributed quotes in the form \`[Person] said: "[quote]"\` or \`"[quote]" — [Person]\`. Do NOT strip: trend observations, characterizations, industry phrases ("a phrase being used inside health systems to describe X"), or paraphrases of what someone might think/do. The test is: is a named individual directly credited with saying a specific sentence? If it's a behavior pattern, market observation, or conceptual framing attributed loosely to a group or industry, leave it alone.

Do NOT flag:
- Editorial commentary, rhetorical questions, framing language, or transitions ("the elephant in the room", "before we start firing these off", "what's the play?").
- Counts, sums, or aggregations clearly derived from rows in the data.
- Generic tactical recommendations or qualitative observations.
- Common knowledge or domain language unrelated to the user's specific data.
- Claims that match the data with only minor format/spelling differences.
- Section headers, labels, or table column headers.
- Editorial summaries, paraphrases, or meta-statements about how a knowledge-base / reference document labels, frames, indexes, or organizes content — these are the assistant's interpretation of the source, not factual claims about prospects, dates, or entities. Examples to leave alone: "the term used in the KB is X", "the KB frames this as Y", "it's not indexed under Z as a label", "the solution framing — not 'remove the founder', but…". Quoted key phrases inside such summaries are the assistant naming a concept, not asserting a verbatim citation, and should not be flagged just because the exact phrase isn't in the corpus.
- Conceptual / methodology questions answered from \`search_references\` (the Pathova Reference Library). The corpus is internal methodology docs; the assistant is allowed to summarize, paraphrase, and re-label content. Only flag if the assistant invents a specific entity, number, date, person, or quote that isn't supported anywhere in the corpus.
- Self-reports about tool execution and session state — statements describing what a tool call did or did not return ("the query returned zero results", "no rows came back from search_accounts_and_contacts", "I couldn't find X in the data I pulled", "the touches log has 63 unique accounts"). These describe the assistant's own session, not claims about prospects, and are unverifiable from a corpus that contains only tool outputs by construction.
- Statements about the assistant's own capabilities, tool availability, or process limitations ("there's no single query that returns Y", "I'd need to pull each account individually", "this would be labor intensive", "I don't have a tool that does Z"). These describe the toolset, not the data.
- Procedural recommendations and suggested user actions ("you could run a Notion filter where X is empty", "the fastest path is to check Y", "try opening Z and filtering by W"). Advice about what the user *could do* is not a factual assertion about prospects, dates, or entities — even if it names a Notion property or describes a feature. Only flag if the recommendation embeds a specific made-up entity, number, or quote.
- Hedged inferences and hypotheses explicitly framed as such ("this looks like a sync gap between Notion and Supabase", "appears to be incomplete", "I'd guess that…"). Only flag if the hedge wraps a specific invented entity/number/date/quote.
- Faithful row summaries from tool query results. If \`query_deals\` returned a row for "Healables" with stage "Won" and a non-empty notes field, then the draft line "Healables / Won / Detailed notes present" is a correct summary of that row. Words like "Detailed notes present", "No notes", "notes available", "stage: Won", "in qualifying" are the assistant's characterizations of row content — do not require these phrases to appear verbatim in the corpus. Only flag if the company isn't in the deals output, the stage is wrong, or the notes-presence summary contradicts what's actually in the row.
- Copy-pasteable research prompts the assistant authored for the user to run in an external tool (Perplexity, Comet, Crunchbase, FDA 510(k), Notion AI, LinkedIn). These are imperatives, not claims — they tell the user what to fetch, not what is true. Recognize them by the imperative voice ("Search for…", "Return all funding rounds…", "List every person with…", "Copy verbatim…", "Find any page mentioning…"), and by adjacent venue pointers like "→ Crunchbase" or "→ FDA 510(k) database". The assistant naming a target company inside such a prompt (e.g. "Search for 'Aevice Health'") is not a claim about Aevice — it's a query string. Leave the entire block alone.
- Section headers and venue pointers: lines like "PRIORITY 4 — Funding verification", "PRIORITY 7 — Red flags check", "→ Crunchbase", "→ LinkedIn people page" are scaffolding for the prompt blocks above. They are not claims and have no source to cite. Never flag them with reasons like "doesn't say where this came from" or "needs a source tag" — that reason is categorically banned.

Worked example. Suppose the corpus contains a \`query_deals\` block with rows including:
  { company: "Healables", stage: "Won", notes: "Long detailed text here..." }
  { company: "PathKeeper Surgical", stage: "Won", notes: null }
The draft says:
  - Healables / Won / Detailed notes present
  - PathKeeper Surgical / Won / No notes
Correct verifier output: empty flag array. Both lines are faithful summaries of rows that exist in the corpus, even though the strings "Detailed notes present" and "No notes" do not appear verbatim in the data.

Worked example (verb/event paraphrase). Suppose the corpus contains an ICP trigger row:
  { account: "Bunkerhill Health", trigger: "CMS billing code", date_effective: "2026-04-01", announced_on: "2026-04-15" }
The draft says:
  - Bunkerhill Health — CMS billing code established in April 2026
Correct verifier output: empty flag array. The entity, the milestone (CMS billing code), and the month/year are all present in the corpus. "Established", "effective", and "took effect" are interchangeable verbs for this milestone, and "April 2026" is a faithful month-grain summary of "2026-04-01". Do NOT flag with reasons like "the data says effective April 1, not established" — that is wording quibbling, not a grounding failure.

Worked example (corpus-internal contradiction). Suppose the corpus contains an ICP trigger row:
  { account: "Sibel Health", clearance_date: "2026-02-26", summary: "Sibel Health received FDA 510(k) clearance on April 9, 2026 ..." }
The draft says:
  - Sibel Health received FDA clearance in February 2026
Correct verifier output: empty flag array. The structured \`clearance_date\` field says 2026-02-26, which is February 2026 — the draft is faithful to that field. The fact that the \`summary\` text inside the same row contradicts itself with "April 9, 2026" is a data-quality problem in the source, not a draft hallucination. The verifier MUST NOT flag the draft for an inconsistency that exists inside the corpus; pick the value the draft cites, confirm it is present, and stop. Do not write reasons like "the corpus has two dates that disagree" or "these two dates contradict each other within the same source record" — those are observations about the data, not grounding failures of the draft.

Worked example (cross-claim consistency). Same Sibel row above. The draft says:
  - Sibel Health received FDA clearance in February 2026
  - 3 months post-clearance (as of May 2026)
Correct verifier output: empty flag array. The first line is grounded by \`clearance_date: 2026-02-26\`. The second line is the assistant doing arithmetic from today's date — it is not a claim about Sibel from the corpus, it is a derived recency descriptor. Do not flag either line, and especially do not flag the first one with reasoning that compares it to the second ("the draft says February but also says 3 months post-clearance as if written in May"). Each claim is checked against the corpus on its own.

Be conservative. False positives are worse than missed edge cases — the user has explicitly asked for fewer false flags. Return empty arrays if nothing is wrong. When in doubt, don't flag.

Rule of thumb before flagging: ask "is this a claim about a prospect, person, company, date, number, or quote?" If it's a claim about *the assistant's tools*, *the act of querying*, *what the user could do next*, *the assistant's own uncertainty*, or *a faithful summary of a row that exists in the corpus*, do not flag it — even if the exact wording isn't in the corpus, since the corpus is tool output, not session metadata.

For each flagged item, the \`line\` field MUST be a verbatim copy of the draft line (including leading bullet/number/pipe characters) so it can be located by exact substring match and replaced.`;

async function verifyClaims(
  text: string,
  toolCalls: ToolCallRecord[],
): Promise<{ verified: string; flagCount: number; stripCount: number }> {
  if (!text || toolCalls.length === 0) return { verified: text, flagCount: 0, stripCount: 0 };

  const corpus = toolCalls
    .map(tc => `=== ${tc.name} ===\n${tc.result}`)
    .join('\n\n');

  const draftForVerifier = text.replace(
    /```[\s\S]*?```/g,
    '```[copy-pasteable research prompt — not a factual claim, ignore]```',
  );

  type Flag = { line: string; claim: string; reason: string; criticality: string };
  type Strip = { line: string; reason: string };
  let flags: Flag[] = [];
  let strips: Strip[] = [];

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system: [
        {
          type: 'text',
          text: VERIFIER_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [VERIFIER_TOOL as any],
      tool_choice: { type: 'tool', name: 'report_verification' },
      messages: [
        {
          role: 'user',
          content:
            `<context>Today's date: ${new Date().toISOString().split('T')[0]}</context>\n\n` +
            `<draft>\n${draftForVerifier}\n</draft>\n\n` +
            `<tool_data>\n${corpus}\n</tool_data>`,
        },
      ],
    });
    console.log('VERIFIER USAGE:', JSON.stringify(response.usage));
    const toolUse = response.content.find(
      (b): b is Anthropic.ContentBlock & { type: 'tool_use' } => b.type === 'tool_use',
    );
    if (toolUse) {
      const input = toolUse.input as { flag?: Flag[]; strip?: Strip[] };
      flags = Array.isArray(input.flag) ? input.flag : [];
      strips = Array.isArray(input.strip) ? input.strip : [];
    }
  } catch (e) {
    console.error('[verifyClaims] LLM verifier failed; returning text unmodified', e);
    return { verified: text, flagCount: 0, stripCount: 0 };
  }

  const BANNED_REASON = /\b(needs?|missing|add|lacks?|requires?|without|no)\s+(an?\s+)?(source|citation|reference|attribution)\s*(tag|link|url)?|doesn'?t\s+say\s+where|where\s+(the\s+)?(quote|claim|info(rmation)?)\s+came\s+from|missing\s+(a\s+)?source\s+tag\b/i;

  const isGroundedReason = (r: string): boolean => {
    if (/\bphrase\b[^.]{0,300}\bis\s+present\b/i.test(r)) return true;
    if (/\bappears?\s+verbatim\b/i.test(r)) return true;
    if (/\bgrounded\s+in\b/i.test(r)) return true;
    if (/\bfound\b[^.]{0,200}\bin\s+query_/i.test(r)) return true;
    if (/\bfound\b[^.]{0,200}\bin\s+the\s+(corpus|data|row|record|tool\s+output)\b/i.test(r)) return true;
    // Catch "the [X] record shows Y" — verifier admits finding the data somewhere in corpus
    if (/\b(?:the\s+)?(?:query_\w+\s+)?(?:record|data|notes?|row)\s+shows?\b/i.test(r)) return true;
    // Catch "notes mention/contain/include"
    if (/\bnotes?\s+(?:mention|contain|include)\b/i.test(r)) return true;
    // Catch "shown in the [corpus|data|notes|record]"
    if (/\bshown\s+in\s+(?:the\s+)?(?:corpus|data|notes?|record)\b/i.test(r)) return true;
    return false;
  };

  flags = flags.filter(f => {
    if (!f.reason) return true;
    if (BANNED_REASON.test(f.reason)) {
      console.warn(`[verifyClaims] dropped flag with banned meta-reason: ${JSON.stringify(f.reason.slice(0, 160))}`);
      return false;
    }
    if (isGroundedReason(f.reason)) {
      console.warn(`[verifyClaims] dropped flag whose reason admits grounding: ${JSON.stringify(f.reason.slice(0, 160))}`);
      return false;
    }
    return true;
  });

  const notionTools = new Set([
    'query_touches', 'get_account_detail', 'search_accounts_and_contacts',
    'query_deals', 'get_communications', 'query_icp_triggers',
    'delegate_crm',
  ]);
  const webTools = new Set([
    'invoke_prospect_researcher', 'search_fda_devices', 'search_clinical_trials',
    'search_cms_coverage', 'search_icd10', 'query_industry_intelligence',
    'query_podcast_signals', 'query_hiring_signals', 'delegate_research',
  ]);

  const usedNotion = toolCalls.some(tc => notionTools.has(tc.name));
  const usedWeb = toolCalls.some(tc => webTools.has(tc.name));

  const notionDbs = new Set<string>();
  for (const tc of toolCalls) {
    if (tc.name === 'query_touches' || tc.name === 'delegate_crm') notionDbs.add('Outreach Touches');
    if (tc.name === 'get_account_detail' || tc.name === 'search_accounts_and_contacts') notionDbs.add('Outreach Intelligence');
    if (tc.name === 'query_deals') notionDbs.add('Motions & Deals');
    if (tc.name === 'query_icp_triggers') notionDbs.add('ICP Trigger Monitor');
  }

  const cleanClaimText = (c: string): string => {
    c = c.replace(/^(\s*(?:[-*•]\s+|\d+\.\s+|\|\s*)?)/, '').trim();
    if (c.startsWith('|') || /\s\|\s/.test(c)) {
      c = c.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').replace(/\s*\|\s*/g, ' / ');
    }
    return c.slice(0, 240);
  };

  const autoVerifyPrompt = (claim: string): string => {
    const c = cleanClaimText(claim);
    const notionPrompt = (): string => {
      const dbList = Array.from(notionDbs).join(' or ');
      return (
        `[Notion AI — open the ${dbList} database${notionDbs.size > 1 ? 's' : ''}]\n` +
        `Verify whether this is accurate against the current data: "${c}". ` +
        `Return: (1) the matching row(s), (2) the exact property values that confirm or refute, ` +
        `(3) the count of matching rows. ` +
        `If no rows match, reply "not found" — do not infer.`
      );
    };
    const webPrompt = (): string =>
      `[Perplexity / Comet — public web]\n` +
      `Verify whether this statement is currently true: "${c}". ` +
      `Source from primary materials only (the company's website, press releases, ` +
      `SEC/FDA filings, LinkedIn). ` +
      `Return: (1) supporting URL, (2) verbatim excerpt from the source that confirms or refutes, ` +
      `(3) publication date. ` +
      `If the statement cannot be confirmed from primary sources, return "not found" — do not infer.`;
    if (usedNotion && usedWeb) return `${notionPrompt()}\n\n${webPrompt()}`;
    if (usedNotion) return notionPrompt();
    return webPrompt();
  };

  let working = text;
  const stripped: string[] = [];

  for (const s of strips) {
    if (!s.line) continue;
    const idx = working.indexOf(s.line);
    if (idx === -1) {
      console.warn(`[verifyClaims] strip line not found in draft: ${JSON.stringify(s.line.slice(0, 120))}`);
      continue;
    }
    const lineStart = working.lastIndexOf('\n', idx - 1) + 1;
    const lineEnd = working.indexOf('\n', idx + s.line.length);
    const end = lineEnd === -1 ? working.length : lineEnd + 1;
    const fullLine = working.slice(lineStart, lineEnd === -1 ? working.length : lineEnd).trim();
    stripped.push(fullLine);
    working = working.slice(0, lineStart) + working.slice(end);
    console.warn(`[verifyClaims] stripped line. reason: ${s.reason}. line: ${s.line.slice(0, 160)}`);
  }

  type ChecklistItem = { claim: string; criticality: string; reason: string; prompt: string };
  const items: ChecklistItem[] = [];

  const PREFIX_RE = /^(\s*(?:[-*•]\s+|\d+\.\s+|\|\s*)?)/;
  for (const f of flags) {
    if (!f.line) continue;
    const idx = working.indexOf(f.line);
    if (idx === -1) {
      console.warn(`[verifyClaims] flag line not found in draft: ${JSON.stringify(f.line.slice(0, 120))}`);
      continue;
    }
    const cleaned = cleanClaimText(f.claim || f.line);
    const prose = f.line.replace(PREFIX_RE, '$1⚠ ');
    working = working.slice(0, idx) + prose + working.slice(idx + f.line.length);
    items.push({
      claim: cleaned,
      criticality: f.criticality || 'unassessed',
      reason: f.reason || '',
      prompt: autoVerifyPrompt(cleaned),
    });
    console.warn(`[verifyClaims] flagged line. reason: ${f.reason}. line: ${f.line.slice(0, 160)}`);
  }

  let verified = working.replace(/\n{3,}/g, '\n\n').trim();

  if (items.length === 0 && stripped.length === 0) return { verified, flagCount: 0, stripCount: 0 };

  const sevRank = (s: string): number => {
    const u = s.toUpperCase();
    if (u.startsWith('HIGH')) return 0;
    if (u.startsWith('MEDIUM')) return 1;
    if (u.startsWith('LOW')) return 2;
    return 3;
  };
  items.sort((a, b) => sevRank(a.criticality) - sevRank(b.criticality));

  const compactReason = (r: string): string => {
    let s = r.replace(/^searched\s+(corpus|the\s+corpus|tool\s+data)[^.—-]*[—-]\s*/i, '').trim();
    s = s.replace(/\s+/g, ' ');
    return s.length > 140 ? s.slice(0, 137).replace(/\s+\S*$/, '') + '…' : s;
  };

  const totalCount = items.length + stripped.length;
  const out: string[] = ['', '---', `**⚠ Unverified (${totalCount}):**`];

  items.forEach((item, idx) => {
    const sevRaw = item.criticality.match(/^(HIGH|MEDIUM|LOW)/i)?.[1]?.toUpperCase();
    const sev = sevRaw ? `${sevRaw} — ` : '';
    const reason = item.reason ? ` · ${compactReason(item.reason)}` : '';
    out.push(`${idx + 1}. ${sev}${item.claim}${reason}`);
  });

  if (stripped.length > 0) {
    out.push('');
    out.push(`**Removed (${stripped.length})** — quoted content not found in tool data, attributed to a named person/org:`);
    for (const claim of stripped) out.push(`- ~~${claim}~~`);
  }

  if (items.length > 0) {
    out.push('');
    out.push('_Ask for the verify prompt for #N to get a paste-ready Notion AI / Perplexity query._');
  }

  return { verified: verified + '\n' + out.join('\n').trimEnd(), flagCount: items.length, stripCount: stripped.length };
}

function collectSources(
  rawResult: string,
  acc: Array<{ id: string; title: string; snippet: string }>,
  seen: Set<string>
): void {
  try {
    const parsed = JSON.parse(rawResult);
    const refs = parsed?.references;
    if (!Array.isArray(refs)) return;
    for (const r of refs) {
      const id = typeof r?.id === 'string' ? r.id : null;
      const title = typeof r?.title === 'string' ? r.title : null;
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      const content = typeof r?.content === 'string' ? r.content : '';
      const snippet = content.replace(/\s+/g, ' ').trim().slice(0, 240);
      acc.push({ id, title, snippet });
    }
  } catch {
    // ignore malformed results
  }
}

function extractReply(finalText: string): string {
  let parsed: any;
  try {
    parsed = JSON.parse(finalText);
  } catch {
    return finalText;
  }
  const content = parsed?.content;
  if (content) {
    const parts: string[] = [];
    if (content.beta_disclaimer) parts.push(content.beta_disclaimer);
    if (content.mode_declaration) parts.push(content.mode_declaration);
    if (content.main_content) parts.push(content.main_content);
    const unc = content.uncertainty_separation;
    if (unc) {
      if (Array.isArray(unc.what_we_know) && unc.what_we_know.length > 0) {
        parts.push('**What We Know (Verified)**');
        unc.what_we_know.forEach((item: string) => parts.push(`- ${item}`));
      }
      if (Array.isArray(unc.what_were_inferring) && unc.what_were_inferring.length > 0) {
        parts.push("**What We're Inferring**");
        unc.what_were_inferring.forEach((item: string) => parts.push(`- ${item}`));
      }
      if (Array.isArray(unc.what_we_dont_know) && unc.what_we_dont_know.length > 0) {
        parts.push("**What We Don't Know (Gaps)**");
        unc.what_we_dont_know.forEach((item: string) => parts.push(`- ${item}`));
      }
    }
    if (content.database_actions) parts.push('---\n' + content.database_actions);
    if (parts.length > 0) return parts.join('\n\n');
  }
  return typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2);
}

const DELEGATE_TOOL_NAMES = new Set([
  'delegate_research',
  'delegate_crm',
  'delegate_qualify',
  'delegate_outreach',
  'delegate_kb',
]);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chatMessages = body?.messages;
    const chatId: string | null =
      typeof body?.chat_id === 'string' && body.chat_id ? body.chat_id : null;
    if (!Array.isArray(chatMessages)) {
      return NextResponse.json(
        { error: 'Invalid payload: messages must be an array' },
        { status: 400 }
      );
    }

    const session = await getServerSession(authOptions).catch(() => null);
    const gmailAccessToken =
      typeof (session as any)?.accessToken === 'string'
        ? ((session as any).accessToken as string)
        : undefined;

    const conversationContext = chatId
      ? await buildConversationContext(chatId).catch(() => '')
      : '';

    const MAX_HISTORY_CHARS = 150_000 * 4;
    let historyChars = 0;
    const trimmedMessages = [];
    for (let i = chatMessages.length - 1; i >= 0; i--) {
      const len = (chatMessages[i].content ?? '').length;
      if (historyChars + len > MAX_HISTORY_CHARS) break;
      historyChars += len;
      trimmedMessages.unshift(chatMessages[i]);
    }
    if (trimmedMessages.length === 0 && chatMessages.length > 0) {
      trimmedMessages.push(chatMessages[chatMessages.length - 1]);
    }

    const messages: Anthropic.MessageParam[] = trimmedMessages.map((m: any) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        };

        const MAX_TOOL_ROUNDS = 15;
        let round = 0;
        const sources: Array<{ id: string; title: string; snippet: string }> = [];
        const seenSourceIds = new Set<string>();
        const turnToolCalls: ToolCallRecord[] = [];
        let stepCounter = 0;
        const stepCounterRef = { value: stepCounter };

        try {
          const { text: learningsText, tokenEstimate: learningsTokens } = await fetchLearnings();
          if (learningsTokens > 0) console.log('LEARNINGS TOKENS (est):', learningsTokens);
          const todayStr = new Date().toISOString().split('T')[0];
          const learningsAndContext = `\n\nToday's date: ${todayStr}` + learningsText + conversationContext;

          while (round < MAX_TOOL_ROUNDS) {
            round++;
            const response = await anthropic.messages.create({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              system: [
                {
                  type: 'text',
                  text: SYSTEM_PROMPT,
                  cache_control: { type: 'ephemeral' },
                },
                ...(learningsAndContext
                  ? [{ type: 'text' as const, text: learningsAndContext }]
                  : []),
              ],
              tools: delegateTools,
              tool_choice: { type: 'auto' },
              messages,
            });

            console.log('USAGE:', JSON.stringify(response.usage));

            const toolUseBlocks = response.content.filter(
              (b): b is Anthropic.ContentBlock & { type: 'tool_use' } =>
                b.type === 'tool_use'
            );

            if (toolUseBlocks.length === 0 || response.stop_reason === 'end_turn') {
              const textBlocks = response.content.filter(
                (b): b is Anthropic.ContentBlock & { type: 'text' } =>
                  b.type === 'text'
              );
              const rawText = textBlocks.map((b: any) => b.text).join('\n');
              const finalText = rawText.trim()
                ? rawText
                : '[The agent completed all tool calls but produced no summary. Please try again or rephrase your request.]';
              const reply = extractReply(finalText);
              const { verified: verifiedReply, flagCount, stripCount } = await verifyClaims(reply, turnToolCalls);
              void supabase.from('pic_accuracy_events').insert({
                session_id: chatId,
                flag_count: flagCount,
                strip_count: stripCount,
              }).then(null, () => {});
              send('done', { reply: verifiedReply, sources });
              controller.close();
              return;
            }

            messages.push({
              role: 'assistant',
              content: response.content as any,
            });

            const toolResults: any[] = [];
            for (const toolBlock of toolUseBlocks) {
              const toolInput = toolBlock.input as Record<string, unknown>;
              const stepId = `s${++stepCounterRef.value}`;
              const label = humanizeToolCall(toolBlock.name, toolInput);
              const startedAt = Date.now();

              send('trace', {
                id: stepId,
                phase: 'start',
                tool: toolBlock.name,
                label,
              });

              let result: string;

              if (DELEGATE_TOOL_NAMES.has(toolBlock.name)) {
                const rawType = toolBlock.name.replace('delegate_', '');
                const managerType = (rawType === 'qualify' ? 'qualification' : rawType) as ManagerType;
                const packet = toolInput as unknown as TaskPacket;
                result = await runManager(
                  managerType,
                  packet,
                  gmailAccessToken,
                  send,
                  stepCounterRef,
                  turnToolCalls,
                  anthropic
                );
              } else {
                result = await executeTool(toolBlock.name, toolInput, gmailAccessToken);
                if (toolBlock.name === 'search_references') {
                  collectSources(result, sources, seenSourceIds);
                }
                turnToolCalls.push({ name: toolBlock.name, result });
              }

              const durationMs = Date.now() - startedAt;
              send('trace', {
                id: stepId,
                phase: 'end',
                tool: toolBlock.name,
                durationMs,
              });
              void supabase.from('tool_metrics').insert({
                session_id: chatId,
                tool_name: toolBlock.name,
                duration_ms: durationMs,
                success: !result.startsWith('Error'),
              }).then(null, () => {});

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolBlock.id,
                content: result,
              });
            }

            messages.push({
              role: 'user',
              content: toolResults,
            });
          }

          send('done', {
            reply: '[Agent reached maximum tool-use rounds. Please try a simpler query.]',
            sources,
          });
          controller.close();
        } catch (err: any) {
          console.error('Claude error', err);
          send('error', {
            error: 'Server error',
            details: err?.message ?? String(err),
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('Claude error', err);
    return NextResponse.json(
      { error: 'Server error', details: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
