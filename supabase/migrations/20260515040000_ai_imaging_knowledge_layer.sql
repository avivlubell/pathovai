-- ============================================================
-- PathovaAI — AI Imaging Operator Knowledge Layer
-- Four static reference tables queried selectively by the
-- ai-imaging-operator edge function. Operator receives only
-- relevant rows as injected context, not the full tables.
-- ============================================================

-- ============================================================
-- TABLE 1: ai_imaging_reimbursement
-- ============================================================

CREATE TABLE ai_imaging_reimbursement (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indication            TEXT NOT NULL,
  indication_label      TEXT NOT NULL,
  cpt_code              TEXT,
  cpt_category          TEXT,
  cpt_description       TEXT,
  cpt_medicare_covered  BOOLEAN DEFAULT FALSE,
  cpt_notes             TEXT,
  ntap_status           TEXT,
  ntap_company          TEXT,
  ntap_fy_approved      TEXT,
  ntap_expiry           TEXT,
  ntap_max_payment_usd  INTEGER,
  ntap_rejection_reason TEXT,
  has_reimbursement_gap BOOLEAN NOT NULL DEFAULT TRUE,
  gap_commercial_impact TEXT NOT NULL,
  tcet_eligible         BOOLEAN DEFAULT NULL,
  tcet_notes            TEXT,
  billed_under          TEXT,
  billing_notes         TEXT,
  roi_narrative         TEXT NOT NULL,
  last_updated          DATE NOT NULL,
  source_notes          TEXT,
  is_verified           BOOLEAN DEFAULT TRUE
);

INSERT INTO ai_imaging_reimbursement VALUES
(
  gen_random_uuid(),
  'stroke_lvo', 'Stroke / LVO Detection',
  NULL, NULL, NULL, FALSE,
  'No AI-specific CPT code. Billed inside CTA head/neck interpretation (70496) with zero separate AI payment.',
  'expired', 'Viz.ai (Viz LVO)', 'FY2021', 'FY2023', 1040,
  NULL,
  TRUE,
  'Viz NTAP expired September 2023. No active NTAP. No CPT code. Hospital carries 100% cost burden with no billing relief. CFO conversation requires labor cost recovery or STAT TAT argument — not reimbursement.',
  TRUE, 'Requires FDA Breakthrough Device designation. Best candidate for TCET given strongest evidence base in AI imaging.',
  'CPT 70496 (CTA head/neck with contrast)', 'AI component not separately billable.',
  'STAT turnaround time improvement tied to door-to-intervention metric is the strongest CFO argument. One avoided drip-and-ship transfer at $30-50K cost avoidance can justify annual software cost.',
  '2026-05-01', 'Viz NTAP FY2021 confirmed. FY2023 expiry confirmed. CMS NTAP data via PMC11736715.', TRUE
),
(
  gen_random_uuid(),
  'pe_detection', 'Pulmonary Embolism Detection',
  NULL, NULL, NULL, FALSE,
  NULL,
  'rejected', 'Aidoc (BriefCase PE)', 'FY2022', NULL, NULL,
  'Failed substantial clinical improvement standard. CMS found insufficient differentiation from existing technology.',
  TRUE,
  'Aidoc PE NTAP explicitly rejected FY2022. No CPT code. Hospital carries 100% cost burden. Among most commercially deployed AI tools yet with no billing pathway — this is a category-wide problem, not company-specific.',
  FALSE, NULL,
  'CPT 71275 (CTA chest with contrast)', 'AI component not separately billable.',
  'After-hours teleradiology cost substitution is strongest CFO argument if institution runs overnight reads remotely. STAT PE detection tied to length-of-stay reduction is secondary — defensible only with local LOS data.',
  '2026-05-01', 'Aidoc NTAP rejection FY2022 confirmed via PMC11612271 and PMC11736715.', TRUE
),
(
  gen_random_uuid(),
  'cardiac_ffrct', 'Coronary CT / FFR-CT',
  '75580', 'Category I',
  'Coronary fractional flow reserve (FFR) derived from augmentative software analysis',
  TRUE,
  'Active Medicare Part B coverage. Separately billable alongside coronary CTA.',
  'none', NULL, NULL, NULL, NULL, NULL,
  FALSE,
  'Only cardiac imaging AI indication with direct reimbursement. HeartFlow is the primary beneficiary. Cleerly (coronary plaque quantification) does NOT have its own CPT — adjacent but not covered.',
  FALSE, NULL,
  'CPT 75580 directly billable', 'Best-in-class reimbursement position in AI imaging.',
  'Direct billing pathway removes primary CFO objection. ROI model can incorporate per-procedure revenue rather than cost avoidance only.',
  '2026-05-01', 'CPT 75580 confirmed active. HeartFlow $176M TTM revenue confirms commercial validation.', TRUE
),
(
  gen_random_uuid(),
  'mammography_ai', 'Mammography AI / Breast Density',
  NULL, NULL, NULL, FALSE,
  'Legacy CAD add-on codes for mammography eliminated by CMS in 2018 PFS. Modern AI tools have no replacement code.',
  'none', NULL, NULL, NULL, NULL,
  'CMS eliminated prior CAD add-on codes in 2018. Active ACR CPT petition for new Category III code — possible within 2–3 years but not confirmed.',
  TRUE,
  'Legacy CAD code elimination created billing gap that has never been filled for AI. iCAD ProFound AI and Hologic Genius AI both sold entirely on operational budget. No billing pathway.',
  FALSE, NULL,
  'Billed under base mammography codes (77065/77066/77067)', 'AI component absorbed into base interpretation — no separate line item.',
  'Workflow efficiency and radiologist capacity argument. Institutions running high mammography volume (100K+ studies/year) can justify on read-time savings. Recall rate reduction tied to malpractice exposure is secondary CFO argument.',
  '2026-05-01', 'CMS 2018 PFS CAD elimination confirmed. ACR petition status per PMC11612271.', TRUE
),
(
  gen_random_uuid(),
  'ich_head_ct', 'Intracranial Hemorrhage / Head CT',
  NULL, NULL, NULL, FALSE, NULL,
  'rejected', 'Viz.ai (Viz SDH)', 'FY2022', NULL, NULL,
  'Failed substantial clinical improvement standard. Viz SDH NTAP application rejected.',
  TRUE,
  'Viz SDH NTAP explicitly rejected FY2022. No CPT code. No active reimbursement pathway.',
  FALSE, NULL,
  'CPT 70450/70460/70470 (CT head without/with contrast)', 'AI component not separately billable.',
  'STAT turnaround time and after-hours coverage arguments apply. Liability avoidance (missed ICH settlement costs) is legitimate secondary argument at risk-management level.',
  '2026-05-01', 'Viz SDH NTAP rejection FY2022 confirmed via PMC11612271.', TRUE
),
(
  gen_random_uuid(),
  'aspects_scoring', 'ASPECTS Scoring for Ischemic Stroke',
  NULL, NULL, NULL, FALSE, NULL,
  'rejected', 'RapidAI (Rapid ASPECTS)', 'FY2022', NULL, NULL,
  'CMS found insufficient differentiation from existing technology. Specific statement: failed to demonstrate substantial clinical improvement.',
  TRUE,
  'RapidAI Rapid ASPECTS NTAP explicitly rejected FY2022. CMS specifically found the tool insufficiently differentiated. This rejection creates a strong headwind for any ASPECTS-adjacent AI company pursuing NTAP.',
  FALSE, NULL,
  'Billed inside CT/CTA interpretation', 'AI component not separately billable.',
  'Outcomes data (not surrogate endpoints) required before NTAP reconsideration. Community hospital outreach should focus on radiologist time savings and read consistency — not reimbursement.',
  '2026-05-01', 'RapidAI NTAP rejection FY2022 confirmed via PMC11612271.', TRUE
),
(
  gen_random_uuid(),
  'chest_ct_triage', 'Chest CT Triage / Incidental Finding',
  NULL, NULL, NULL, FALSE, NULL,
  'none', NULL, NULL, NULL, NULL, NULL,
  TRUE,
  'No CPT code, no NTAP attempt documented in reviewed sources. No reimbursement pathway.',
  FALSE, NULL,
  'CPT 71250/71260/71270 (CT thorax)', 'AI component not separately billable.',
  'Incidental finding capture tied to downstream revenue (lung program, oncology referral) is the most differentiated CFO argument in this indication. Liability argument around missed incidentals is secondary.',
  '2026-05-01', 'Gap confirmed via PMC11612271 gap map.', TRUE
),
(
  gen_random_uuid(),
  'lung_nodule', 'Lung Nodule Detection / Management',
  NULL, NULL, NULL, FALSE, NULL,
  'none', NULL, NULL, NULL, NULL, NULL,
  TRUE,
  'No CPT code, no NTAP. Best economic story comes from service-line ROI and downstream oncology capture rather than payer reimbursement.',
  FALSE, NULL,
  'CPT 71250 (CT thorax)', 'AI component not separately billable.',
  'Downstream oncology revenue capture is strongest CFO argument — lung program economics, Lung-RADS follow-up adherence improvement tied to procedure volume.',
  '2026-05-01', 'Gap confirmed via PMC11612271.', TRUE
),
(
  gen_random_uuid(),
  'msk_fracture', 'MSK / Fracture Detection',
  NULL, NULL, NULL, FALSE, NULL,
  'none', NULL, NULL, NULL, NULL,
  'OsteoDetect received FDA clearance; no CPT code pursued successfully.',
  TRUE,
  'No CPT code, no NTAP. No coordinated CPT petition effort identified. 5–8 year horizon for stable code.',
  FALSE, NULL,
  'Billed under base X-ray/CT codes', 'AI component not separately billable.',
  'Emergency department throughput improvement and after-hours read support are only defensible CFO arguments. Liability avoidance (missed fracture) is secondary.',
  '2026-05-01', 'Gap confirmed via PMC11612271.', TRUE
),
(
  gen_random_uuid(),
  'retinal_ai', 'Diabetic Retinopathy / Retinal AI',
  '92229', 'Category I',
  'Imaging of retina for detection/monitoring of disease; with point-of-care automated analysis with diagnostic report',
  TRUE,
  'Active Medicare Part B coverage. Physician work RVU = 0 (autonomous AI — no physician work component).',
  'none', NULL, NULL, NULL, NULL, NULL,
  FALSE,
  'Most mature AI imaging reimbursement pathway. Primary care point-of-care billing model. Note: this billing model does not translate cleanly to hospital radiology workflows.',
  FALSE, NULL,
  'CPT 92229 directly billable', NULL,
  'Direct per-study billing. Revenue model is cleaner than any other AI imaging indication.',
  '2026-05-01', 'CPT 92229 confirmed Category I. Per PMC11612271.', TRUE
);


-- ============================================================
-- TABLE 2: ai_imaging_competitive
-- ============================================================

CREATE TABLE ai_imaging_competitive (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name            TEXT NOT NULL,
  indication              TEXT NOT NULL,
  commercial_stage        TEXT NOT NULL,
  is_pathova_disqualifier BOOLEAN NOT NULL DEFAULT FALSE,
  disqualifier_reason     TEXT,
  total_funding_usd       BIGINT,
  last_round_type         TEXT,
  last_round_date         DATE,
  ttm_revenue_usd         BIGINT,
  revenue_signal          TEXT,
  fda_cleared             BOOLEAN DEFAULT NULL,
  reimbursement_status    TEXT,
  contract_track_record   TEXT,
  contract_notes          TEXT,
  competitive_notes       TEXT,
  last_updated            DATE NOT NULL,
  is_verified             BOOLEAN DEFAULT TRUE
);

INSERT INTO ai_imaging_competitive VALUES
(
  gen_random_uuid(), 'Viz.ai', 'stroke_lvo',
  'market_leader', TRUE,
  'Commercial-stage market leader. $289M total raised. Broad health-system footprint. Too far for Pathova ICP.',
  289200000, 'Late-stage VC', '2025-01-01', 12000000,
  'Revenue at 2022 financing disclosed as $12M; current ARR not public but significantly higher given growth.',
  TRUE, 'strong',
  'strong', 'Multiple published real-world workflow improvements. Health-system adoption narrative with named enterprise relationships.',
  'NTAP expired FY2023. No active reimbursement for LVO triage beyond base CTA billing. Despite this, they are entrenched. Any ICP company competing in stroke must differentiate on something other than triage speed.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Aidoc', 'pe_detection',
  'market_leader', TRUE,
  'Commercial-stage. $420M total raised. 1,600+ medical centers claimed. Too far for Pathova ICP.',
  420300000, 'Series D+', '2025-01-01', NULL,
  '1,600+ medical centers globally claimed. No public ARR.',
  TRUE, 'weak',
  'claimed', 'Broad deployment language. Many claims are portfolio-level. Named paid PE contracts not frequently public.',
  'PE triage NTAP rejected FY2022. Enterprise bundle seller — PE is one module in emergency radiology platform. This makes them formidable in IDN deals where bundled purchasing is incentivized.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'RapidAI', 'stroke_lvo',
  'market_leader', TRUE,
  'Commercial-stage. ~$46M TTM revenue. 2,500+ hospitals globally. Too far for Pathova ICP.',
  103000000, 'Series C', '2023-06-01', 45900000, NULL,
  TRUE, 'weak',
  'claimed', '2,500+ hospitals globally claimed. Fewer public named U.S. contract announcements than Viz.',
  'Deep neurovascular installed base. Strong clinical integration creates switching cost. ASPECTS scoring NTAP rejected FY2022 — this is a vulnerability if competing companies can make a differentiation argument on outcomes data.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'HeartFlow', 'cardiac_ffrct',
  'market_leader', TRUE,
  'Public company. $176M TTM revenue. CPT 75580 reimbursement. Market leader in coronary CT. Not an ICP.',
  NULL, 'IPO', '2025-01-01', 176000000, NULL,
  TRUE, 'strong',
  'strong', 'Mature commercial contract track record. Broad U.S. adoption confirmed by revenue scale.',
  'Only AI imaging company with genuine Category I CPT reimbursement for its primary indication. Template for what every other AI imaging company is trying to achieve. Cleerly (coronary plaque) is the nearest competitor but significantly weaker on reimbursement.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Lunit', 'chest_xray',
  'market_leader', TRUE,
  'Public company. $58M TTM revenue. Too far for Pathova ICP.',
  NULL, 'Public', '2023-11-01', 58400000, NULL,
  TRUE, 'weak',
  'commercial', 'Commercially real. U.S. named contract proof limited in available public materials.',
  'Strongest financially evidenced chest X-ray AI vendor. But U.S. enterprise penetration less clear than global numbers suggest. Worth tracking whether their U.S. commercial motion is truly scaled.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'iCAD', 'mammography_ai',
  'commercial', TRUE,
  'Public company. $19.5M TTM revenue. Longstanding commercial presence. Too far for Pathova ICP.',
  NULL, 'Public/M&A', NULL, 19500000, NULL,
  TRUE, 'weak',
  'strong', 'Longstanding U.S. market presence through breast imaging centers and OEM channels.',
  'No direct reimbursement pathway despite mature product. Sold entirely on operational budget. ACR actively pursuing new CPT code — if successful, meaningfully strengthens iCAD commercial position.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Bunkerhill Health', 'chest_ct_triage',
  'scaling', FALSE,
  NULL,
  55000000, 'Series B', '2026-03-01', NULL,
  'Mar 2026 $25M round. Emerging commercial player.',
  TRUE, 'weak',
  'pilot_dominant', 'Promising but earlier than Aidoc/Viz. More scaling-stage than entrenched incumbent.',
  'Interesting because their wedge is incidental-findings workflow tied to downstream care coordination, not pure triage. This is a differentiated commercial angle. $55M total funding puts them on the edge of Pathova ICP — research actual commercial traction (paying contracts vs. pilots) before approaching.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Riverain', 'lung_nodule',
  'commercial', FALSE,
  NULL,
  23200000, 'Series B', '2026-01-01', NULL,
  'Generating revenue. Jan 2026 financing. Commercially real but limited penetration.',
  TRUE, 'weak',
  'commercial', 'Established commercial chest imaging vendor. Narrower than platform competitors.',
  'Real commercial vendor with limited enterprise footprint. Could be Pathova ICP depending on actual contract vs. pilot ratio. Jan 2026 raise suggests still scaling. Worth researching before approaching.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Optellum', 'lung_nodule',
  'commercial', FALSE,
  NULL,
  25300000, 'Series A/B', NULL, NULL,
  'Most indication-specific specialist in lung nodule management.',
  NULL, 'weak',
  'pilot_dominant', 'Commercially credible in lung programs but details not well surfaced publicly.',
  'Most focused lung nodule AI vendor. Likely stronger in targeted nodule-management deals than broad radiology contracts. $25M total funding puts them squarely in Pathova ICP zone — research commercial traction.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'Cleerly', 'cardiac_ffrct',
  'commercial', FALSE,
  NULL,
  NULL, 'Series C', '2024-12-01', 24600000, NULL,
  TRUE, 'weak',
  'commercial', 'Commercially growing. Public contract specifics thinner than HeartFlow.',
  'Coronary plaque quantification — adjacent to HeartFlow but NOT covered by CPT 75580. This is their vulnerability. Any deal where procurement asks "why not HeartFlow" puts them in a weak reimbursement comparison. Pathova ICP candidate if their commercial team is thin.',
  '2026-05-01', TRUE
);


-- ============================================================
-- TABLE 3: ai_imaging_procurement
-- ============================================================

CREATE TABLE ai_imaging_procurement (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_type      TEXT NOT NULL,
  topic                 TEXT NOT NULL,
  title                 TEXT NOT NULL,
  content               TEXT NOT NULL,
  failure_mode_relevance TEXT[],
  outreach_application  TEXT,
  last_updated          DATE NOT NULL,
  is_verified           BOOLEAN DEFAULT TRUE
);

INSERT INTO ai_imaging_procurement VALUES
(
  gen_random_uuid(), 'amc', 'approval_timeline',
  'AMC Procurement Timeline',
  '12–24 months typical. IRB may be required even for commercial tools when institution is prospectively collecting performance data or monitoring outcomes. CMIO is enterprise-level champion or blocker. Radiology informatics faculty hold structural influence. IT security holds structural veto over any cloud-based PHI tool. Research co-development interest frequently complicates and extends deals — faculty may have equity or advisory conflicts requiring institutional review.',
  ARRAY['FM5'], 'AMC deals should not be in the first 3 accounts for a company trying to generate revenue in the next 12 months. If a founder is leading with AMC deals they are optimizing for prestige not revenue.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'community_hospital', 'approval_timeline',
  'Community Hospital Procurement Timeline',
  '3–9 months typical. Sub-$50K–$100K annual cost = department-level approval possible without formal capital committee. Radiology director plus CFO sign-off is the path. No IRB, no enterprise governance. Single strong champion radiologist who found the tool at RSNA is the entire initiation and advocacy function. IT bandwidth is most underestimated blocker — small IT teams, PACS administrator managing multiple systems, integration competes with everything else in the queue.',
  ARRAY['FM1', 'FM2', 'FM3'], 'Community hospital is the primary target institution type for ICP companies. Pricing below $100K/year is not just positioning — it is the structural key that unlocks department-level approval and bypasses capital committee entirely.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'large_idn', 'approval_timeline',
  'Large IDN Procurement Timeline',
  '9–18 months typical. Centralized enterprise governance, supply chain actively involved. GPO contract alignment reviewed. Enterprise IT security holds veto over cloud PHI tools. May have dedicated AI governance structures functioning like internal FDA review offices with formal intake forms, risk stratification, and staged shadow deployment requirements.',
  ARRAY['FM5'], 'IDN deals require multi-stakeholder engagement from day one. A single champion at one site is not sufficient — the founder needs an enterprise champion at the IDN level or the deal dies when it reaches supply chain.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'all', 'single_point_failures',
  'Seven Governance Committee Kill Shots',
  '1. NO LOCAL VALIDATION DATA — Presenting published AUC from a benchmark dataset without local retrospective pilot or sandbox evaluation. Committees now require local data before procurement vote.
2. CLOUD PHI EXPOSURE WITHOUT BAA — If security review surfaces unauthorized PHI transfer (even metadata), deal stops. Often permanently at that institution.
3. PACS INTEGRATION REQUIRING SEPARATE WORKSTATION — Radiologists will not tolerate workflow interruptions. Separate application window = usability veto from practicing radiologist committee members.
4. NO FDA CLEARANCE FOR CLINICAL CLAIM — Legal will not approve clinical deployment of tools marketed research-use-only without explicit IRB coverage.
5. VENDOR INSTABILITY SIGNALS — Committees now ask about funding runway, client retention, acquisition rumors. Company that cannot answer confidently raises a red flag.
6. ALGORITHMIC BIAS WITHOUT MITIGATION PLAN — AMCs and IDNs with equity mandates require stratified performance by race, sex, BMI, scanner manufacturer.
7. NO POST-MARKET MONITORING COMMITMENT — ACR/RSNA multi-society statement requires QA plan and performance drift detection. Absence is now a deal-breaker at larger institutions.',
  ARRAY['FM5'], 'When a founder says "we keep getting delayed at the committee level" — run through these seven. One of them is the cause.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'all', 'it_integration',
  'IT Integration Timeline Reality',
  'Contract to go-live: 3–6 months at community hospital under favorable conditions. 6–12 months at AMC/IDN. Bottleneck is almost never the vendor — it is hospital IT staffing capacity and change management queue. DICOM integration requires: DICOM listener/router, HL7 ADT feed, DICOM SR for result injection back into PACS, network segmentation for outbound HTTPS to vendor cloud. Different scanner manufacturers implement DICOM differently — vendor validated on Siemens CT may face unexpected failures on GE scanner output even within the same standard.',
  ARRAY['FM2'], 'When a founder says "we are waiting on IT" — the real question is whether they have a dedicated IT contact, a project timeline, and a documentation package in IT review. If not, there is no active integration — there is a stalled handoff.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'all', 'security_requirements',
  'IT Security Documentation Requirements for Cloud AI Tools',
  'Required before IT approves cloud connectivity for a PHI-accessing AI tool:
BAA: must be executed before any PHI transfer. Non-negotiable HIPAA requirement.
SOC 2 Type II: without this, IT security at most institutions will not approve cloud connectivity. Most common missing document.
HIPAA Security Rule compliance: administrative, physical, and technical safeguards.
Data flow diagram: where PHI goes, in what form, encrypted to what standard, who can access.
Penetration test results or vulnerability assessment: required at AMCs and larger IDNs.
Data retention and deletion policy: what happens to processed images after inference.
Encryption: TLS 1.2+ in transit, AES-256 at rest minimum.
Cloud infrastructure: AWS/Azure/GCP HIPAA eligibility confirmation.
Most common gaps: missing SOC 2, incomplete data flow documentation, ambiguous BAA language around model retraining rights.',
  ARRAY['FM2'], 'A complete security package delivered proactively before IT asks compresses security review from 4 months to 6 weeks.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'all', 'evaluation_rubric',
  'Five Evaluation Domains Governance Committees Actually Score On',
  '1. CLINICAL RELEVANCE AND USE CASE FIT — Does this solve a real workflow problem at THIS institution? Is it first reader, concurrent reader, or triage tool?
2. PERFORMANCE AND VALIDATION — FDA clearance is necessary but not sufficient. Was validation on external data? Does it match this institution''s demographics and scanner fleet? Stratified performance by race, sex, BMI, scanner manufacturer now expected at AMCs/IDNs.
3. INTEGRATION AND WORKFLOW — DICOM integration, PACS compatibility, whether results are inside PACS or separate window (separate = usability veto), latency, HL7/EHR integration.
4. REGULATORY, LEGAL, SECURITY — FDA clearance, HIPAA/BAA, data ownership, post-market QA plan.
5. FINANCIAL AND VENDOR VIABILITY — Licensing model, total cost of ownership including IT implementation labor, vendor financial stability, ROI model support materials.',
  ARRAY['FM5'], 'Founders who have only engaged the clinical champion have zero preparation for domains 3, 4, and 5. These are where deals die.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'community_hospital', 'gpo_dynamics',
  'GPO Dynamics at Community Hospitals',
  'Vizient, Premier, and HealthTrust members are incentivized to use pre-negotiated GPO contract vehicles. A GPO contract compresses community hospital procurement from 6 months to 2–3 months by eliminating competitive bidding requirements. GPO contracts do NOT accelerate AMC or large IDN procurement. Early-stage companies without enterprise customer logos will struggle to qualify — GPOs require financial stability documentation, insurance minimums, and reference customers.',
  ARRAY['FM3', 'FM5'], 'If a founder is targeting community hospitals, ask whether they have pursued GPO contracting. If not, and they have the customer base to qualify, this is an unlock that could compress every subsequent deal.',
  '2026-05-01', TRUE
);


-- ============================================================
-- TABLE 4: ai_imaging_roi_models
-- ============================================================

CREATE TABLE ai_imaging_roi_models (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indication        TEXT,
  institution_type  TEXT,
  roi_type          TEXT NOT NULL,
  title             TEXT NOT NULL,
  content           TEXT NOT NULL,
  primary_metric    TEXT,
  defensibility     TEXT,
  defensibility_notes TEXT,
  last_updated      DATE NOT NULL,
  is_verified       BOOLEAN DEFAULT TRUE
);

INSERT INTO ai_imaging_roi_models VALUES
(
  gen_random_uuid(), NULL, NULL, 'dismissed',
  'Finance Arguments That Get Rejected',
  '"Improved diagnostic accuracy" as a standalone claim without linking to a billing or liability event. "Reduced radiologist burnout." "Market differentiation." "Earlier cancer detection" without linking to a specific billing event. Quality improvement metrics not tied to specific cost events.',
  'None — these do not map to P&L line items', 'low',
  'Finance committees recognize these as vendor-framed arguments without institutional data. Rejected not because untrue but because unverifiable from the hospital side.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), NULL, NULL, 'approved',
  'Radiologist Time Savings → Labor Cost Recovery',
  'Delta read time per study type × daily study volume × radiologist fully-loaded hourly cost. Requires shadow-mode time-motion study to generate institutional data. Vendor benchmark data ("our tool saves 15 minutes per read at peer institutions") is rejected — must be the hospital''s own data.',
  'Radiologist labor budget line', 'high',
  'Caveat: in fee-for-service environments where radiologists bill by RVU, time savings = capacity not direct cost reduction, unless the practice is capacity-constrained. Must confirm billing model before using this argument.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), 'stroke_lvo,pe_detection,ich_head_ct', NULL, 'approved',
  'STAT Turnaround Time → Downstream Cost Avoidance',
  'Delta TAT for emergent studies × annual volume × hospital cost per delayed treatment event (DRG comparison). Best for acute care tools (LVO, ICH, PE) where door-to-intervention metrics are tracked. One avoided drip-and-ship transfer ($30–50K cost) can justify annual software cost.',
  'Emergency care cost avoidance / DRG optimization', 'high',
  'Most credible sub-12-month payback case for emergency radiology AI. Requires institution to have time-to-treatment data from their EHR — most AMCs and IDNs track this; community hospitals may not.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), NULL, 'community_hospital', 'approved',
  'After-Hours Coverage → Locum / Teleradiology Cost Substitution',
  'Current teleradiology or overnight/weekend coverage spend is a tracked budget line item. If AI enables coverage model changes or delays outsourcing trigger, cost savings are directly quantifiable. High defensibility at community hospitals with significant teleradiology spend.',
  'Teleradiology / locum tenens budget', 'high',
  'Most powerful argument at community hospitals running $200K–$500K+ in annual teleradiology spend. Must get actual spend figure from finance — vendor estimates will not be accepted.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), NULL, NULL, 'approved',
  'Malpractice Liability Avoidance',
  'Historical miss rate at institution × average settlement cost for that miss type × annual volume. Finance committees accept this as qualitative credit but rarely make it the primary ROI calculation. Resonates with CMOs and risk management, who sometimes separately champion the purchase.',
  'Malpractice reserves / risk management budget', 'low',
  'Use as secondary argument only. Do not lead with this — finance does not book it as hard savings.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), NULL, NULL, 'sub_12_month_path',
  'Sub-12-Month Payback: Conditions Required',
  'A genuine sub-12-month payback requires ONE of:
1. Annual subscription cost under $100K and high-volume use case (even modest efficiency gains generate savings at scale).
2. Tool eliminates a specific cost already tracked in institutional budget (teleradiology, locum, specific outsourcing line).
3. Performance-based contract where vendor shares financial risk and payout is tied to documented outcomes.
4. Tool prevents a single high-cost event (one avoided PE miss settlement > annual software cost).',
  'Payback period', 'high',
  'The $100K annual threshold aligns with community hospital department-level purchasing authority. Pricing above this triggers capital committee review, adding 3–6 months to procurement.',
  '2026-05-01', TRUE
),
(
  gen_random_uuid(), NULL, NULL, 'data_inputs',
  'Data Inputs Finance Committees Require — Must Come From Hospital',
  'Baseline study volume by type: from RIS/PACS, not vendor estimates.
Current read time by study type: from RIS timestamps or radiologist productivity reports.
Fully-loaded radiologist hourly cost: from HR, not industry benchmarks.
Current teleradiology/locum spend if applicable: from finance, not vendor-estimated.
IT implementation cost estimate: from IT, not vendor-provided.
Historical incident/near-miss data if using liability case: from risk management.
The single most common reason ROI models fail: built on vendor-provided benchmark data. Finance committees recognize and reject it.',
  'All P&L lines', 'high',
  'This is a core Pathova deliverable. The template exists; the founder does not have to gather the data alone — Pathova facilitates the data request and builds the model.',
  '2026-05-01', TRUE
);


-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_reimb_indication ON ai_imaging_reimbursement(indication);
CREATE INDEX idx_reimb_gap ON ai_imaging_reimbursement(has_reimbursement_gap);
CREATE INDEX idx_reimb_label ON ai_imaging_reimbursement(lower(indication_label));

CREATE INDEX idx_competitive_indication ON ai_imaging_competitive(indication);
CREATE INDEX idx_competitive_disqualifier ON ai_imaging_competitive(is_pathova_disqualifier);
CREATE INDEX idx_competitive_stage ON ai_imaging_competitive(commercial_stage);
CREATE INDEX idx_competitive_name ON ai_imaging_competitive(lower(company_name));

CREATE INDEX idx_procurement_institution ON ai_imaging_procurement(institution_type);
CREATE INDEX idx_procurement_topic ON ai_imaging_procurement(topic);
CREATE INDEX idx_procurement_failure_mode ON ai_imaging_procurement USING GIN(failure_mode_relevance);

CREATE INDEX idx_roi_indication ON ai_imaging_roi_models(indication);
CREATE INDEX idx_roi_type ON ai_imaging_roi_models(roi_type);
CREATE INDEX idx_roi_institution ON ai_imaging_roi_models(institution_type);


-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE ai_imaging_reimbursement ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON ai_imaging_reimbursement
  USING (auth.role() = 'service_role');

ALTER TABLE ai_imaging_competitive ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON ai_imaging_competitive
  USING (auth.role() = 'service_role');

ALTER TABLE ai_imaging_procurement ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON ai_imaging_procurement
  USING (auth.role() = 'service_role');

ALTER TABLE ai_imaging_roi_models ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_full_access ON ai_imaging_roi_models
  USING (auth.role() = 'service_role');
