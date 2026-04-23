# Risk Assessor — QB Procedure Brief

## What it does
Evaluates 6 risk categories for an account using Claude, then returns a go/no-go signal. Also loads patterns from `reference_library` (titles matching "pattern", "risk", "playbook") and learnings from `agent_learnings` tagged `risk-assessor` or `all`.

## The 6 risk categories

**1. Capital Risk**
Funding recency and runway signals. Key red flag: Seed-only with no follow-on in 36+ months. Also watch for: total raised under $2M with no recent round, recent bridge round (indicates stress).

**2. Operational Risk**
Team size trends — growth vs contraction. Recent leadership departures, especially in commercial roles. Hiring patterns (are they building or shrinking?).

**3. Commercial Viability Risk**
Revenue signals, contract evidence, pilot-to-paid conversion patterns. A company with 10 pilots and 0 conversions is a different risk profile than one with 2 pilots and 2 contracts.

**4. Regulatory Risk**
FDA pathway complexity. Pending clearance = timing uncertainty. De Novo or PMA = longer runway. Competitive regulatory pressure (are competitors clearing faster?).

**5. Engagement Risk**
Decision-maker accessibility — is the CEO reachable or hidden behind a sales layer? Prior outreach history: how many touches, any response? Academic-identity CEO (research-first, revenue-averse) vs commercial-identity CEO (knows they need to sell).

**6. Market Timing Risk**
Competitive pressure, reimbursement landscape, market window signals. Is the window opening or closing?

## Output structure
```json
{
  "overall_risk_score": 1–10,
  "risk_level": "LOW | MODERATE | HIGH | CRITICAL",
  "go_no_go_signal": "GO | GO_WITH_CAUTION | PAUSE | NO_GO",
  "risks": [{ "category": "...", "severity": "...", "finding": "...", "evidence": "...", "mitigation": "..." }],
  "critical_unknowns": ["..."],
  "recommendation": "1–2 sentence summary"
}
```

## How to present results to the user
Lead with the go/no-go signal and the top 1–2 risks by severity. Don't read out all 6 categories if most are LOW.

Example: "GO WITH CAUTION. Main risks: Capital (Seed only, 28 months since last raise — runway pressure) and Engagement (CEO has academic background, 0 LinkedIn activity). Critical unknown: whether the CEO handles commercial conversations personally."

Surface `critical_unknowns` to the user — these are things the assessor flagged as missing that would change the risk picture if known.

## Before calling
- ICP scoring should be complete. Risk assessment on a Non-ICP account wastes a call.
- If research is missing, the risk assessment will be shallow — warn the user.

## After calling
- GO or GO_WITH_CAUTION: proceed to outreach.
- PAUSE: discuss with the user what would need to change before proceeding.
- NO_GO: recommend archiving or a 90-day revisit trigger. Don't draft outreach.
