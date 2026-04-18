# Outreach Rubric

A draft passes if it scores **≥ 5 / 6** AND contains **zero banned phrases**. A banned phrase is an auto-fail even at 5/6.

## Checks

| Check | Pass criterion |
|---|---|
| `diagnosis_stated` | First 1–2 sentences name a specific observable symptom, not a generic pain. |
| `evidence_cited` | Every assertive claim in the body maps to a PIC `evidence.id` via `references`. |
| `no_banned_phrases` | None of the banned phrases (below) appear in subject or body. |
| `cta_specific` | CTA is scoped, time-bound, and low-friction — not "a chat" / "to connect" / "quick sync". |
| `persona_appropriate` | Vocabulary and framing match the persona's role family (clinical, commercial, market_access, etc.). |
| `channel_constraints` | Respects channel length/format: email subject ≤ 8 words and body ≤ 120 words; linkedin body ≤ 300 chars; phone ≤ ~60 words. |

## Banned phrases

Case-insensitive substring match. Regex-style word boundaries are fine.

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

## Why these are banned

Each one is a tell that the sender had nothing specific to say and filled the gap with filler. They don't just sound generic — they actively signal to a buyer that this is a mass send.

## Scoring logic

```
score = sum(checks.*.true)          # 0..6
passed = (score >= 5) AND checks.no_banned_phrases
```

## Suggestions

For each failed check, emit one concrete rewrite hint. Example:

- Failed `diagnosis_stated` → "Open with the 9% case-volume decline from E1 instead of a generic 'I noticed you work on cardiac outcomes.'"
- Failed `cta_specific` → "Replace 'open to a chat?' with a scoped ask like '15 minutes on E4's data against your Q3 schedule.'"
