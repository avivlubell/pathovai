# Outreach Drafter — QB Procedure Brief

## What it does
Produces a diagnosis-first Prospect Intelligence Card (PIC) then a 3-touch outreach sequence (LinkedIn + 2 emails) grounded in evidence. Prior outreach history is synced from Notion into Supabase and injected into the account context the drafter receives — the drafter reads it from there, not directly from Notion. Runs deterministic QA checks before finalizing. Loads learnings from `agent_learnings` tagged `outreach-drafter` or `all`.

## Hard prerequisites — enforce these before calling
1. **Research must be on file.** The drafter needs evidence to ground claims. No research = generic outreach = wasted call.
2. **ICP tier must be Tier 1 or Tier 2.** Don't draft outreach for Non-ICP or Tier 3 accounts without explicit user override.
3. **Only one account_id required** — the drafter picks the best target contact internally from account data. You do not need to supply a contact.

## The PIC (Prospect Intelligence Card)
Before drafting any message, the drafter builds a PIC — structured diagnosis of the account:
- **Gap**: the specific commercial problem observable from evidence
- **Symptom**: what's visible externally (pilots stalling, no commercial team, CEO doing BD manually)
- **Root cause hypothesis**: why the symptom exists
- **Cost of inaction**: what happens if the problem isn't solved
- **Why now**: the time-bound trigger (FDA clearance age, funding runway, competitive pressure)
- **Evidence**: specific citations from research data that support the above

You should always be able to tell the user what gap the outreach is diagnosing and why.

## The 6 messaging hooks
The drafter selects one hook per sequence based on the gap pattern. Know these so you can explain the choice:

1. **PILOT PURGATORY** — Use when the company has multiple pilots, long cycles, and low conversion. Frame: the problem isn't the technology — the story fragments across the buying process. "Most medtech companies with FDA clearance get stuck running 3-7 pilots with strong clinical outcomes but zero conversions after 12+ months." Note: PILOT PURGATORY and FREE PILOT TRAP describe the same underlying cash-burn problem. PURGATORY emphasizes being stuck; FREE PILOT TRAP emphasizes giving the technology away without the right value framing. Use whichever is better supported by the evidence.

2. **STORY FRAGMENTATION** — Use when the company's story hasn't been designed to travel across all hospital evaluators. The internal stakeholders who typically evaluate: clinical champion, IT, scheduling, CFO, procurement/VAC. Without a unified narrative, each evaluator evaluates in a vacuum and writes their own version of what the product is. You lose the plot. You lose control of how value is defined across the buying process. The fix: a single coherent story that holds up when any of these stakeholders picks it up independently.

3. **VAC / BUSINESS CASE** — Use when the company is still trying to validate the science, when clinical validation is already done. Two things haven't been built: (1) **Economic translation** — clinical outcomes converted into numbers specific to this hospital's adoption of this specific technology. Not a generic ROI calc — a business case the CFO can act on, built around their context. (2) **Operational compatibility map** — every knock-on effect of introducing the technology into the system: which stakeholders are impacted, how, and why. This surfaces scheduling, IT, and workflow friction points early, before they kill the deal in procurement. Note: VAC (Value Analysis Committee) is a hospital procurement process, not a Pathova product.

4. **RELATIONSHIP EXHAUSTION** — Use when early wins came through the founder's personal network and growth is now stuck. The issue is not burnout — it's a scalability ceiling. Founder-led selling is not a viable path to 20+ sites. The fix is systematizing what the founder does (repeatable market access infrastructure), not removing them from the process.

5. **FREE PILOT TRAP** — Same underlying problem as PILOT PURGATORY: burning cash through pilots that don't convert. Root cause: mistaking clinical enthusiasm for deal momentum. The clinical champion loves the product — but they don't control the budget, procurement, or implementation decision. Without baking buyer value (economic + operational, per the full VAC) into the pilot design, the company is giving the technology away with almost no chance of return. The fix: reframe what the pilot is proving — not "does the science work" but "does this make economic and operational sense for the buyer system."

6. **FOUR NARRATIVE GAPS** — Use when ICP scoring shows multiple gaps across the board. Frame: four specific gaps compound each other. Gap 1: ICP clarity. Gap 2: No VAC navigation system. Gap 3: Economic value props that don't survive CFO scrutiny. Gap 4: Pilots designed for clinical validation, not commercial conversion.

Hook selection guidance:
- Q1=YES, Q2=YES → PILOT PURGATORY or STORY FRAGMENTATION
- Q3=STRONG → lead with the specific gap identified
- Q3=MODERATE → RELATIONSHIP EXHAUSTION
- Multiple pilots mentioned → FREE PILOT TRAP
- Recently raised funding → urgency framing around runway

## Banned phrases — catch these in every draft
If any of these appear in the output, flag it before presenting:
`just checking in`, `circle back`, `synergy`, `quick question`, `hope this finds you well`, `leverage`, `game-changer`, `reach out`, `touch base`, `following up`, `per my last email`, `as per`, `I wanted to`, `I hope`, `revolutionary`, `cutting-edge`, `innovative solution`, `best-in-class`, `state-of-the-art`, `paradigm shift`, `holistic approach`, `thought leader`

## Voice requirements
- Founder-to-founder tone, not consultant tone
- Direct and specific, not warm and vague
- Every claim must cite a specific piece of evidence from the PIC
- No feature pitching — lead with the gap, not the product
- Confidence calibrated to evidence: HIGH (named customer + specific outcome), MEDIUM (named pilot + general signal), LOW (inferred from signals only)

## Channel constraints
- **LinkedIn**: ≤300 characters, no external links in first message, one CTA
- **Email**: subject ≤8 words, body ≤120 words, one CTA
- **Phone/voicemail**: ≤60 words (~25 seconds spoken), one callback hook

## QA checks the drafter runs automatically
The drafter runs deterministic checks before finalizing:
- No banned phrases present
- No generic opener (e.g. "I hope this finds you well")
- Channel constraints met (length, link rules)
- Evidence cited: every claim in the body maps to a PIC evidence_id in the references array

## How to present output to the user
1. Name the hook used and why ("PILOT PURGATORY — they have 4 named pilots and 0 conversions")
2. State the confidence level and what it's based on ("MEDIUM — Mayo Clinic pilot named but no conversion data")
3. Show the 3-touch sequence
4. Note any QA flags if the drafter returned warnings
5. Ask the user if the gap diagnosis feels right before they review the copy — a wrong diagnosis produces good-sounding but wrong outreach

## After presenting — iteration rules
- If the user wants to swap a word or tighten a line: do it inline in conversation, don't re-invoke the drafter
- If the user surfaces new evidence (new stakeholder, changed gap, fresh research): re-invoke the drafter with the full context
- If the draft fails QA: tell the user which check failed and what the specific fix is before re-invoking
