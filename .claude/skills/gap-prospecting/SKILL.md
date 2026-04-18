---
name: gap-prospecting
description: Diagnosis-first prospecting. Produces a Prospect Intelligence Card (PIC), then outreach, then runs QA. Use when the user asks to prospect an account, research a buyer, draft outreach for a specific prospect, or evaluate/improve a draft.
---

# Gap Prospecting

Outreach only lands when it names a specific gap the buyer already feels. Pitching features first (product-first) loses. Naming the gap and why-now first (diagnosis-first) wins.

## Pipeline

```
inputs  →  PIC  →  outreach  →  QA
```

1. **PIC** (Prospect Intelligence Card) — structured diagnosis of the account+persona: evidence, symptoms, likely root cause, cost of inaction, why-now, hypothesis.
2. **Outreach** — a message per channel, grounded in PIC evidence. No outreach without a PIC.
3. **QA** — scores the draft against the rubric. Fails are routed back to step 2 with specific fixes.

## Files

- Prompts: [`prompts/pic-generation.md`](../../../prompts/pic-generation.md), [`prompts/outreach-generation.md`](../../../prompts/outreach-generation.md), [`prompts/qa.md`](../../../prompts/qa.md)
- Schemas: [`schemas/pic.schema.json`](../../../schemas/pic.schema.json), [`schemas/outreach.schema.json`](../../../schemas/outreach.schema.json), [`schemas/qa.schema.json`](../../../schemas/qa.schema.json)
- Examples: [`examples/`](../../../examples/)
- Rubric + fixtures: [`evals/`](../../../evals/)

## Rules

- **Never draft outreach without a PIC.** If evidence is thin, say so and ask for more inputs.
- **Cite evidence inline.** Every claim in outreach must map to a `pic.evidence[].id`.
- **Banned phrases** (anti-generic filter; see `evals/rubric.md` for full list): `just checking in`, `circle back`, `synergy`, `quick question`, `hope this finds you well`, `leverage`, `game-changer`, `reach out`.
- **One gap per message.** If the PIC surfaces multiple, pick the highest-severity + highest-confidence one.
- **Honor the persona.** Clinical leaders care about outcomes and workflow; commercial leaders care about revenue and access; market-access cares about reimbursement and evidence.

## Outputs

Always emit structured JSON that validates against the matching schema. Human-readable prose goes inside string fields (e.g. `body`), not outside the JSON envelope.
