# ICP Scorer — QB Procedure Brief

## What it does
Answers 4 classification questions based strictly on account data, then assigns a tier deterministically in code (Claude classifies, code decides — Claude never assigns tiers directly).

Also loads the live ICP framework from the `reference_library` table (rows tagged `reference_type = 'methodology'`, title contains "ICP") and appends it to the scoring context.

## The 4 questions

**Q1 — Right industry?** (YES / NO)
Is this company a medtech/health-tech company selling software, devices, or AI to healthcare providers or payers? NO = Non-ICP, stop.

**Q2 — Right stage?** (YES / TOO_EARLY / TOO_MATURE)
- YES: Post-FDA clearance (or strong regulatory pathway), evidence of commercial activity, Series A or later funding
- TOO_EARLY: Pre-FDA, pre-revenue, idea stage — not ready for a sales conversation
- TOO_MATURE: Has an established sales org (VP Sales + 8+ reps) and proven distribution — doesn't need what Pathova offers

**Q3 — Gap signals present?** (STRONG / MODERATE / NONE)
Observable symptoms of a commercial gap Pathova can address:
- STRONG: Multiple signals (e.g. pilots stalling + no commercial leader + CEO doing outreach + funding urgency)
- MODERATE: Some signals but limited evidence (e.g. one pilot mentioned, no commercial team visible)
- NONE: No observable symptoms of a gap

**Q4 — Disqualifiers?** (NONE / list of disqualifiers)
Hard stops: acquired, pivoted to B2C, pure services company (no product), publicly traded, competitor.

## Tier mapping (deterministic)
| Q1 | Q2 | Q3 | Q4 | Tier |
|---|---|---|---|---|
| NO | any | any | any | Non-ICP |
| YES | TOO_EARLY | any | any | Non-ICP |
| YES | TOO_MATURE | any | any | Tier 3: Monitor |
| YES | YES | STRONG | NONE | Tier 1: Priority |
| YES | YES | MODERATE | NONE | Tier 2: Qualified |
| YES | YES | NONE | NONE | Tier 3: Monitor |
| any | any | any | not NONE | Non-ICP |

## How to present results to the user
Don't just say "Tier 2." Explain the 4 answers:
- "Right industry: YES — medtech AI for pathology workflows"
- "Right stage: YES — 510(k) cleared Feb 2024, Series A, commercial activity beginning"
- "Gap signals: MODERATE — one named pilot (Mayo Clinic), no commercial leader on LinkedIn"
- "Disqualifiers: NONE"
- Therefore: Tier 2: Qualified

Also surface `data_gaps` from the scorer output — these are fields that were missing or uncertain that would have changed the classification if known. Tell the user what to go find.

## Before calling
- Research should be on file (Sections 1, 2, 3, 5, 9 populated). If not, run `invoke_prospect_researcher` first.
- If research is >30 days old and the account is moving toward Priority, prompt the user to refresh.

## After calling
- If Tier 1 or Tier 2: proceed to risk assessment next.
- If Tier 3: ask the user if they want to monitor or pause. Don't auto-proceed to outreach.
- If Non-ICP: tell the user clearly. Don't run outreach. Offer to archive or monitor.
