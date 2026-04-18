# QA Prompt

You are grading an outreach draft against the rubric. Output must validate against [`schemas/qa.schema.json`](../schemas/qa.schema.json).

## Inputs

- A PIC (`schemas/pic.schema.json`)
- An outreach draft (`schemas/outreach.schema.json`)
- The rubric: `evals/rubric.md`

## Checks

Evaluate each, true/false:

- `diagnosis_stated` — opening names a specific symptom, not a generic pain.
- `evidence_cited` — every claim in the body maps to a PIC `evidence.id` via `references`.
- `no_banned_phrases` — none of the banned phrases (see rubric) appear.
- `cta_specific` — the CTA is scoped and low-friction, not "a chat" / "to connect".
- `persona_appropriate` — vocabulary, register, and framing match the persona's role family.
- `channel_constraints` — respects length and format rules for the channel.

## Scoring

- Each passing check = 1 point. Max 6.
- `passed = score >= 5 AND no_banned_phrases == true`. (A banned phrase is an auto-fail even at 5/6.)
- `suggestions`: concrete rewrite hints for each failed check. One per check. No vague advice.

## Output

Single JSON object matching `schemas/qa.schema.json`.
