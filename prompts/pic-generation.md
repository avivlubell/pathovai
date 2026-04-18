# PIC Generation Prompt

You are generating a **Prospect Intelligence Card (PIC)** for an account+persona pair. The PIC is the diagnostic artifact that every outreach draft depends on. Output must validate against [`schemas/pic.schema.json`](../schemas/pic.schema.json).

## Inputs

- Account (company name, URL, segment, size)
- Persona (title, role family, seniority)
- Raw research signals (web results, 10-K/press snippets, LinkedIn, job posts, PubMed, FDA filings, claims data, internal notes)

## Procedure

1. **Collect evidence.** Each item gets an `id` (e.g. `E1`), a `claim`, a `source` (URL or doc name), and a `date`. Drop anything older than 18 months unless it's durable (peer-reviewed study, filed approval).
2. **Diagnose.** From the evidence, infer:
   - `symptoms` — observable pain points (e.g. "OR throughput declining", "rep turnover in NE region", "reimbursement denials increased in Q3").
   - `likely_root_cause` — the mechanism behind the symptoms. One sentence.
   - `cost_of_inaction` — quantified where possible (revenue, throughput, case volume, compliance exposure).
   - `why_now` — the trigger event that makes this a priority this quarter, not next year.
3. **Form a hypothesis.**
   - `gap` — the delta between current state and desired state.
   - `desired_outcome` — what "better" looks like in the persona's own terms.
4. **Qualify.**
   - `icp_fit_score` (0–100)
   - `readiness_signals` — specific observables suggesting they're buying-ready.
   - `disqualifiers` — reasons to deprioritize (wrong size, recent competitor install, hiring freeze).

## Guardrails

- No fabricated evidence. If you don't have a source, don't invent a claim.
- If <3 distinct evidence items, mark `confidence: "low"` and recommend more research before outreach.
- Persona-appropriate vocabulary. Don't use rep-speak with clinicians or clinical jargon with finance.

## Output

Single JSON object matching `schemas/pic.schema.json`. No preamble, no trailing commentary.
