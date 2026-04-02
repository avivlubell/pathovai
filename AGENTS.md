<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Architecture Decisions

### Source of Truth Hierarchy

- **Vercel is authority.** The master prompt lives in `app/api/chat/prompt.txt`. Production calls the Claude API directly from `route.ts` — no Claude Project involved. All prompt changes are version-controlled here.
- **Claude Projects is sandbox.** Used only for dev-session convenience (persistent system prompt across conversations). No knowledge docs uploaded — that's redundant with Supabase and burns tokens every conversation. Claude Project docs are injected into the context window on every conversation; there is no free persistent memory.
- **Supabase is the knowledge layer.** Prospect data, reference library, learnings, KB docs — all live in Supabase. The Quarterback queries these via MCP tools at runtime.

### Tools vs Subagents

Current architecture: one LLM orchestrator (Quarterback in `route.ts`) + deterministic tool calls to Supabase edge functions.

The `invoke_*` edge functions (prospect-researcher, icp-scorer, outreach-drafter, risk-assessor) are a grey zone — they contain Claude/Perplexity LLM calls internally but receive fixed inputs, not conversation-aware context from the Quarterback. They are constrained reasoning, not autonomous subagents.

**Known limitation:** Edge functions don't know what the Quarterback discussed in the session. If outreach drafts feel disconnected from conversation context, the fix is promoting `invoke_outreach_drafter` from an edge function to an inline subagent call where the Quarterback passes richer, conversation-aware context directly.

**Decision:** Tools-only is correct for current scale. Promote to subagents only when the Quarterback struggles to synthesize across tool outputs or when edge function outputs feel disconnected from session context. Outreach drafter is the most likely candidate for promotion.

### When to Add Subagents

Subagents make sense where **judgment** is needed, not just execution:
- Research interpretation (what to research, how to interpret findings)
- Outreach drafting (persuasive writing benefits from specialized prompt + conversation context)
- Risk assessment (nuanced judgment calls)

Subagents do NOT make sense for:
- ICP scoring (formulaic)
- DB queries (deterministic)
- Document classification (pattern matching)
