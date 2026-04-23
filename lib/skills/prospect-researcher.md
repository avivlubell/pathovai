# Prospect Researcher — QB Procedure Brief

## What it does
Runs two live Perplexity web searches and saves structured output to the `accounts` table.

**Call 1 — Main research** extracts 10 sections:
1. Company basics (legal name, HQ, founding year, description, product names/category, target customer language)
2. Regulatory status (FDA clearance type, date, 510(k) number, CE marking, other approvals)
3. Funding history (each round: type, amount, date, investors, use of funds; total raised; months since last round)
4. Team & employee data (LinkedIn headcount, commercial/sales titles, CEO background, CEO LinkedIn)
5. Commercial evidence (named pilots, customers, partners; pilot count; customer count; revenue if public)
6. CEO/Founder LinkedIn activity (posts last 6 months, pain language quotes, posting frequency, engagement)
7. Website language (homepage headline, target customer copy, case studies page, careers/jobs page)
8. Competitive landscape (3–5 direct competitors with funding, employee count, named customers, differentiator)
9. Red flags & disqualifiers (acquired? pivoted? B2C? established sales org? publicly traded? recent layoffs?)
10. Signal flags (pilot-to-conversion ratio, targeting specificity, commercial leadership presence, CEO sales activity, months since FDA clearance, months since funding, one-line company summary)

**Call 2 — Deep-dive** focuses specifically on competitors, FDA 510(k) details, and CE mark status.

## GAP blocks
When data cannot be found publicly, the researcher emits a structured `<<<GAP>>>` block containing:
- `field`: what was missing
- `why_not_found`: reason (e.g. "LinkedIn gated to authenticated browser")
- `go_to_url`: the single best URL to open
- `comet_prompt`: a ready-to-paste instruction for the user to fetch it manually

**Your job**: surface every GAP block to the user verbatim as a Comet handoff. Never summarize gaps away or say "research was thin." The user needs to know exactly what is missing and where to go get it.

## Before calling
- Check `last_researched` on the account. If within 7 days and no major events are expected, skip and use existing data.
- Confirm `website_url`, `linkedin_url`, and `ceo_name` are populated on the account — the researcher's Perplexity queries anchor on these. If they're missing, the research will be weaker; warn the user.

## After calling
- Tell the user which sections came back with data and which have GAP blocks.
- If Section 9 (red flags) shows a disqualifier (B2C, established sales org 8+ reps, acquired, publicly traded), flag it immediately before proceeding to ICP scoring.
- If Section 5 (commercial evidence) shows zero named customers and zero named pilots, note it — this is a key ICP signal.
- Research is "complete enough to score" when Sections 1, 2, 3, 5, and 9 have substantive data. Gaps in Sections 6 and 7 are acceptable to proceed.
