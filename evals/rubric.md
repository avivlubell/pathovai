# Outreach Rubric

A draft passes if it scores **≥ 6 / 7** AND `no_banned_phrases` is true AND `no_generic_opener` is true. Either a banned phrase or a generic opener is an auto-fail even at 6/7.

## Layered grading

The pipeline grades in two layers:

1. **Deterministic (code).** A scanner runs four checks directly on the draft: banned phrases, generic opener, per-channel length constraints, and that every cited `evidence_id` exists in the PIC. These are cheap, reliable, and authoritative — when a deterministic check fires, it wins.
2. **LLM judgment.** The remaining semantic checks (diagnosis stated, CTA specific, persona appropriate) are graded by the model.

The code-level findings are preserved in `qa.deterministic.*` even after merge, so a reviewer can always see what the scanner found versus what the LLM judged.

## Checks

| Check | Grader | Pass criterion |
|---|---|---|
| `diagnosis_stated` | LLM | First 1–2 sentences name a specific observable symptom, not a generic pain. |
| `no_generic_opener` | code | First 1–2 sentences don't match a known template opener (see below). |
| `evidence_cited` | code | `references` is non-empty and every `evidence_id` exists in the PIC. |
| `no_banned_phrases` | code | None of the banned phrases (below) appear in subject or body. |
| `cta_specific` | LLM | CTA is scoped, time-bound, and low-friction — not "a chat" / "to connect" / "quick sync". |
| `persona_appropriate` | LLM | Vocabulary and framing match the persona's role family. |
| `channel_constraints` | code | Respects channel length/format: email subject ≤ 8 words and body ≤ 120 words; linkedin subject null and body ≤ 300 chars; phone subject null and body ≤ 60 words. |

## Banned phrases

Case-insensitive substring match.

- `just checking in`
- `circle back`
- `circling back`
- `touching base`
- `touch base`
- `synergy`
- `synergies`
- `quick question`
- `quick chat`
- `quick sync`
- `hope this finds you well`
- `hope you're doing well`
- `hope you are doing well`
- `leverage`
- `game-changer`
- `game changer`
- `reach out`
- `ping you`
- `thought leader`
- `best-in-class`
- `move the needle`

## Generic-opener patterns

The deterministic scanner rejects any draft whose first 1–2 sentences match one of these templates (case-insensitive). These are high-confidence tells that the opener was not derived from a real diagnosis.

- `I hope this finds you` / `Hope you're doing well`
- `My name is …` as the first clause
- `I'm [role] at [company]` as the opener
- `I noticed you` / `I came across your profile`
- `I wanted to reach out` / `Just wanted to reach out`
- `I'm reaching out` as the opener

## Scoring

```
score = sum(checks.*.true)          # 0..7
passed = score >= 6
       AND checks.no_banned_phrases
       AND checks.no_generic_opener
```

## Suggestions

For each failed check, emit one concrete rewrite hint. Example:

- Failed `diagnosis_stated` → "Open with the 9% case-volume decline from E1 instead of a generic 'I noticed you work on cardiac outcomes.'"
- Failed `no_generic_opener` → "Opener matches 'I wanted to reach out' template. Replace with an evidence-grounded first sentence."
- Failed `cta_specific` → "Replace 'open to a chat?' with a scoped ask like '15 minutes on E4's data against your Q3 schedule.'"
