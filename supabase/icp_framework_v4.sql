-- Pathova ICP Framework v4.0
-- Run this in the Supabase SQL Editor.
-- Step 1: Run the SELECT first to see what currently exists.
-- Step 2: Run the UPDATE. If it returns 0 rows affected, run the INSERT instead.

-- ── STEP 1: Preview current document ──────────────────────────────────────────
SELECT id, title, reference_type, LEFT(content, 300) AS content_preview
FROM reference_library
WHERE reference_type = 'methodology'
  AND title ILIKE '%ICP%';

-- ── STEP 2: Update existing document ──────────────────────────────────────────
UPDATE reference_library
SET
  title   = 'Pathova ICP Framework v4.0',
  content = $icp$
# Pathova ICP Framework v4.0

## Who Pathova Serves

Pathova helps commercial leaders navigate complex stakeholder landscapes in the life sciences industry. The core value is helping any company — from founder-led startups to established commercial teams — build a repeatable, consistent approach to selling products into clinical environments.

The buyer of Pathova is whoever sits at the sales helm: the Founder (early stage), VP Sales, CRO, CCO, or any commercial leader accountable for revenue. The company size, funding stage, or sales team maturity does not matter as much as whether there is a broken or non-repeatable commercial motion that Pathova can improve.

---

## Q1: RIGHT INDUSTRY

**Question:** Does the company sell a product (not pure services) into hospitals, IDNs, medical offices, or health systems through a complex, committee-driven purchase process?

**YES** — any of the following:
- MedTech: medical devices, surgical tools, diagnostics, imaging hardware — pre or post-FDA clearance (510(k), PMA, De Novo, or exempt)
- SaMD: Software as a Medical Device — cleared or under review
- Health IT: EHR integrations, clinical workflow software, care management platforms, hospital analytics, revenue cycle tools, population health tools, interoperability/data infrastructure
- Sub-clinical tools: hospital operations software, supply chain, staff scheduling, administrative tools — anything deployed within a hospital or health system
- The defining criteria are WHERE it sells (hospitals, IDNs, medical offices, health systems) and HOW it sells (multi-stakeholder, committee-driven, value analysis committee / buying committee process)

**NO** — any of the following disqualifies on Q1:
- Pure professional services with no recurring product revenue
- B2C / consumer health apps (no institutional buying process)
- Pharmaceutical or biotech manufacturing (GPO, formulary, PBM commercial motion is fundamentally different)
- Companies not selling into clinical environments (e.g., sells to consumers, payers only, or non-healthcare industries)

---

## Q2: RIGHT STAGE

**Question:** Is the company at a stage where Pathova's methodology creates meaningful commercial lift?

**YES** — the company has at least one paying customer or an active commercial motion underway. This includes:
- Early-stage companies making their first 1–5 hospital sales
- Growth-stage companies trying to scale beyond their first cluster of customers
- Companies with commercial teams in place but struggling with repeatability — winning some deals through heroics but not through process
- Companies where the sales motion exists but hasn't been systematized

**TOO_EARLY** — pre-first customer with no active commercial motion. The product may exist but there is no sales motion to improve yet. Return TOO_EARLY only when there is no commercial activity at all.

**TOO_MATURE** — the company is a large, known commodity. TOO_MATURE requires ALL FOUR of the following to be true:
1. Known commodity: widely recognized brand in their space, institutional name recognition
2. Broad distribution: products deployed across many hospitals or health systems at meaningful scale
3. Stable commercial infrastructure: established, tenured executive team with low turnover, proven sales organization
4. Significant revenue: approximately $100M+ annual revenue (hard disqualifier), or $50M+ combined with the above three factors (soft signal — apply judgment)

**CRITICAL NOTES ON STAGE:**
- Revenue alone does NOT make a company too mature. A company doing $5M–$50M annually is NOT too mature — they are in the sweet spot.
- A company with a VP Sales and AEs is NOT automatically too mature. Having a commercial team does not mean the commercial motion is working.
- The presence of sales headcount is NOT a positive signal by itself. Pathova's most valuable prospects often have a sales team that is underperforming — deals won through heroics, not process.

---

## Q3: GAP SIGNALS

**Question:** Are there observable signals that Pathova's methodology would provide meaningful commercial lift?

- **STRONG**: 2 or more of the following signals are present
- **MODERATE**: 1 signal is present
- **NONE**: No signals detected

### Gap Signal Definitions

**1. ACTIVITY WITHOUT REVENUE**
The company generates PR activity (pilot announcements, partnership announcements, clinical validation studies, patient treatment milestones, conference presentations) but shows no revenue signals. Red flags: no announced paying customers, no contract announcements, no expansion deals, no ARR or revenue mentions. This is the most reliable single indicator of commercial dysfunction at scale.

**2. SALES LEADERSHIP TURNOVER**
VP Sales, CRO, or CCO is the 2nd or 3rd hire in that role within 24 months. Frequent leadership changes at the commercial helm indicate a non-repeatable foundation. Each new hire resets the sales motion rather than building on it.

**3. FOUNDER-AS-SELLER**
The CEO or founder is publicly doing the selling work — product demos, LinkedIn posts promoting clinical features, conference keynotes about the product, named in press releases as the relationship-holder — while the VP Sales or commercial team has low public presence. The more heavily the founder is doing commercial work, the more likely the sales team has not found its stride. This is not a hard rule but is a strong directional signal.

**4. CAPITAL WITHOUT TRACTION**
The company has raised $5M+ in venture funding (Seed, Series A, Series B) but shows no commensurate revenue signals or announced paying customers. The higher the raise without visible traction, the higher the stakes and the more acute the commercial pain. A company that has raised $15M+ and cannot demonstrate commercial velocity is under significant investor pressure.

**5. NON-REPEATABLE COMMERCIAL MOTION**
The company is winning some deals but through extraordinary effort (heroics), not process. Evidence: long pilot-to-contract timelines (12+ months from pilot announcement to customer announcement), few or no expansion announcements from existing customers, deals require disproportionate founder or executive involvement to close, every win feels like a unique event rather than a repeatable pattern.

**6. COMMERCIAL TEAM IMMATURITY**
AEs and sales staff are junior (1–3 years of relevant enterprise experience), no experienced reps with a track record of navigating hospital buying committees, or the team was recently assembled with no established track record in this specific selling environment.

---

## Q4: DISQUALIFIERS

Any of the following = Non-ICP (answer with specific disqualifier label, not just "NONE"):

- **LARGE_ESTABLISHED_COMMODITY**: Large company that is a known commodity with broad distribution, stable executive team, and significant revenue ($100M+, or $50M+ with institutional recognition and market penetration). These companies can hire and build whatever commercial infrastructure they need.
- **PURE_SERVICES**: No product to sell — pure professional services, consulting, staffing, or implementation with no recurring revenue product.
- **WRONG_MARKET**: Does not sell into hospitals, IDNs, medical offices, or health systems. Sells only to consumers, payers, or non-healthcare industries.
- **NO_COMMERCIAL_MOTION**: Pre-product or pre-first customer with no path to commercial activity in the near term (equivalent to TOO_EARLY in Q2 — if Q2 is TOO_EARLY, flag this in Q4 as well).
- **WRONG_INDUSTRY**: Pharmaceutical or biotech manufacturing where the commercial motion is GPO, formulary, or PBM-driven rather than direct hospital committee sales.

If none of the above apply, answer Q4 with "NONE".

---

## Tier Determination Reference

| Q1 | Q2 | Q3 | Q4 | Tier |
|---|---|---|---|---|
| YES | YES | STRONG | NONE | Tier 1: Priority |
| YES | YES | MODERATE | NONE | Tier 2: Qualified |
| YES | YES | NONE | NONE | Tier 3: Monitor |
| YES | TOO_MATURE | any | NONE | Tier 3: Monitor |
| YES | TOO_EARLY | any | any | Non-ICP |
| NO | any | any | any | Non-ICP |
| any | any | any | not NONE | Non-ICP |
$icp$
WHERE reference_type = 'methodology'
  AND title ILIKE '%ICP%';

-- ── STEP 3: If UPDATE returned 0 rows, run this INSERT instead ────────────────
-- (Remove the leading comment markers and run only if needed)

-- INSERT INTO reference_library (title, reference_type, content, created_at, updated_at)
-- VALUES (
--   'Pathova ICP Framework v4.0',
--   'methodology',
--   $icp$
-- (paste the full content block from STEP 2 here)
--   $icp$,
--   NOW(),
--   NOW()
-- );
