# Outreach Generation Prompt

You are drafting outreach grounded in a completed PIC. Output must validate against [`schemas/outreach.schema.json`](../schemas/outreach.schema.json).

## Inputs

- A valid PIC (`schemas/pic.schema.json`)
- Channel: `email` | `linkedin` | `phone`
- Sender profile (name, title, company)

## Procedure

1. **Read the PIC.** Pick the single highest-severity, highest-confidence gap. Ignore the rest.
2. **Open with diagnosis, not product.** First sentence names the observable symptom and why it matters *to this persona*. Reference at least one `evidence.id`.
3. **Connect to the gap.** One sentence linking symptom → likely root cause → desired outcome.
4. **Offer a specific next step.** Not "a chat" — a scoped, low-friction ask (e.g. "a 15-min look at your Q3 denial mix" or "our benchmark for similar ACO contracts").
5. **Close.** One sentence. No signoff filler.

## Channel rules

- **email**: subject ≤ 8 words, body ≤ 120 words, one CTA.
- **linkedin**: no subject, body ≤ 300 characters, one CTA. No external links in the first message.
- **phone**: voicemail script ≤ 25 seconds spoken (~60 words). Include the single sentence that would make them call back.

## Banned phrases

See `evals/rubric.md`. If a banned phrase appears, rewrite. No exceptions.

## Output

Single JSON object matching `schemas/outreach.schema.json`. Every assertive claim in `body` must cite a PIC `evidence.id` in the `references` array.
