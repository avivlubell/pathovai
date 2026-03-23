import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const NOTION_TOKEN = Deno.env.get("NOTION_INTEGRATION_TOKEN")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")!;
const NOTION_VERSION = "2022-06-28";
const DATABASE_ID = "040d8d933e044730b86edc9b045cdb78";

const RESEARCH_PROMPT = `You are a data extraction tool. Your job is to find and return RAW FACTS about a company. Do not analyze, score, recommend, or strategize. Do not use words like "suggests," "indicates," or "implies." Just extract what is directly observable and cite every source.

COMPANY: [COMPANY_NAME]
WEBSITE: [WEBSITE_URL]
LINKEDIN: [LINKEDIN_URL]
CEO/FOUNDER: [CEO_NAME]

INSTRUCTIONS: Extract every data point listed below. For each:
- If found: State the fact + source URL + date retrieved or published
- If not found after searching: State "NOT FOUND" and list where you searched
- Do not infer. Do not guess. Do not fill gaps with assumptions.

---
SECTION 1: COMPANY BASICS
1.1 Company legal name
1.2 Headquarters location (city, state, country)
1.3 Year founded
1.4 Company description (verbatim from website "About" section)
1.5 LinkedIn "About" section text (verbatim)
1.6 Product name(s) and one-line description of each
1.7 Product category: SaMD / Hardware device / DTx / Clinical AI / Combination / Other
1.8 Target customer as stated on website (copy exact language)
1.9 Target customer as stated on LinkedIn (copy exact language)
Source URL for each.

---
SECTION 2: REGULATORY STATUS
2.1 FDA clearance/approval: YES / NO / PENDING / NOT FOUND
2.2 If YES: Clearance type (510(k) / De Novo / PMA / EUA)
2.3 If YES: FDA clearance date (exact date)
2.4 If YES: 510(k) number or approval number
2.5 If YES: Device classification and product code
2.6 CE marking status: YES / NO / NOT FOUND (Search: "[COMPANY_NAME] CE mark" OR "[COMPANY_NAME] CE marking" OR "[product name] CE mark" OR "[COMPANY_NAME] European approval")
2.7 Other regulatory approvals (Health Canada, TGA, PMDA, etc.)
2.8 Months since most recent regulatory clearance (calculate from clearance date to today)
Source URL for each. Check: FDA 510(k) database, company press releases, company website.
FDA SEARCH FALLBACK INSTRUCTIONS (if initial search returns no results):
- Try alternate applicant names: company name without "Inc.", parent company name, DBA names
- Search by product/trade name instead of applicant (e.g., search product name not just company name)
- Search the De Novo database separately: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm
- Search the PMA database: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpma/pma.cfm
- Try the FDA open API with trade name: https://api.fda.gov/device/510k.json?search=openfda.device_name:"[product name]"
- Google: "[COMPANY_NAME]" AND ("510(k)" OR "K2" OR "De Novo" OR "DEN") site:fda.gov
- Google: "[COMPANY_NAME]" AND "FDA clearance" AND ("510(k) number" OR "clearance date")
- Check if the company website has a regulatory/compliance page with clearance numbers

---
SECTION 3: FUNDING HISTORY
For EACH funding round found:
3.X.1 Round type (Pre-Seed / Seed / Series A / B / C / etc.)
3.X.2 Amount raised
3.X.3 Date announced
3.X.4 Lead investor(s)
3.X.5 Other notable investors
3.X.6 Stated use of funds (direct quote from press release)
3.X.7 Source URL
3.TOTAL Total capital raised across all rounds
3.LATEST Most recent round: type + amount + date
3.MONTHS Months since most recent funding round (calculate)

---
SECTION 4: TEAM & EMPLOYEE DATA
4.1 LinkedIn employee count (exact number shown on company page)
4.2 List ALL employees with commercial/sales titles found on LinkedIn:
Format: [Name] | [Title] | [Start Date] | [LinkedIn URL]
Search for: VP Sales, CRO, CCO, Head of Commercial, Head of Sales, Director of Sales, Account Executive, Account Manager, Business Development, Sales Operations, Market Access, Reimbursement, Sales Engineer
4.3 List ALL employees with marketing titles (same format)
4.4 CEO/Founder name and title
4.5 CEO LinkedIn URL
4.6 CEO background summary (prior companies and roles from LinkedIn - facts only)
4.7 Does the CEO appear to be the primary person doing sales/BD activity? (Based on LinkedIn post topics - note if CEO posts are about customer meetings, demos, pilot visits, hospital partnerships)
Source: LinkedIn company page, LinkedIn people search filtered by company.

---
SECTION 5: COMMERCIAL EVIDENCE
For EACH pilot, customer, partner, or deployment mentioned publicly:
5.X.1 Organization name (hospital, health system, clinic)
5.X.2 Type: Academic Medical Center / Community Hospital / Rural Hospital / Critical Access / VA / Military / Specialty / Health System / Other
5.X.3 Relationship type as described: "pilot" / "evaluation" / "customer" / "partner" / "deployment" / "contract" / other (use exact language from source)
5.X.4 Date announced
5.X.5 Source URL
5.X.6 Exact quote describing the relationship
5.PILOT_COUNT Total count of sites described with pilot/evaluation/trial language
5.CUSTOMER_COUNT Total count of sites described with customer/contract/paid/revenue language
5.CONVERSION_POSTS Number of posts/announcements using "first paying customer," "contract signed," "revenue milestone," or similar
5.REVENUE Any publicly stated revenue figures, ARR, or revenue-range indicators
5.VOLUME_METRICS Any stated volume metrics — For EACH metric, include the FULL sentence it appears in. Do not extract numbers without context. Format: [number] — [full sentence containing the number] — [source URL] (e.g., "300K+ screenings," "50,000 patients monitored")

---
SECTION 6: CEO/FOUNDER LINKEDIN ACTIVITY
Extract the CEO's LinkedIn posts from the last 6 months. For EACH relevant post:
6.X.1 Post date
6.X.2 Full post text (verbatim - do not summarize or paraphrase)
6.X.3 Post URL (if accessible)
6.X.4 Topic tags (select all that apply): Pilot announcement / Customer/conversion announcement / Fundraising/investor / Hiring/team / Regulatory/FDA / Clinical outcomes/validation / Reimbursement/payer/coverage / Hospital procurement/VAC/buying process / Scaling challenges / Sales/commercial infrastructure / Product/feature / Industry/market commentary / Conference/event / Other
6.PAIN_QUOTES Extract ALL direct quotes where CEO uses any of these words/phrases: "challenge," "struggle," "figuring out," "complexity," "scaling," "reimbursement," "payer," "coverage," "CPT," "pilot conversion," "procurement," "runway," "difficult," "hard part," "learning," "mistake," "didn't expect"
Format: "[exact quote]" - [date] - [post URL]
If NONE found, state: "NO PAIN LANGUAGE FOUND in last 6 months. CEO posts focus on: [list top 3 topics by frequency]"
6.POSTING_FREQUENCY Average posts per month over last 6 months
6.ENGAGEMENT Average likes/comments on posts (rough estimate)

---
SECTION 7: WEBSITE LANGUAGE EXTRACTION
Copy the EXACT text (verbatim, not paraphrased) from these website locations:
7.1 Homepage headline and subheadline
7.2 Homepage "who we serve" or target customer language (exact words)
7.3 About page - company description paragraph
7.4 Any page describing pilots, evaluations, or trial programs: URL of page / Full text of pilot/evaluation offer (exact words) / Is the word "free" used? YES/NO / Is there a qualification process described? YES/NO / Is there pricing mentioned? YES/NO
7.5 Any page describing target customers or market segments: URL of page / Does it specify hospital TYPE? YES/NO / Does it specify clinical DEPARTMENT? YES/NO / Does it specify payment MODEL? YES/NO / Or is it generic (e.g., "hospitals," "health systems")? - copy exact phrase
7.6 Case studies or customer stories page: Number of case studies visible / Hospital names mentioned / Outcomes described (exact language)
7.7 Careers/jobs page: List ALL open commercial/sales/marketing roles with titles / For sales roles: Do job descriptions mention "ICP," "qualification," "target profile," or "ideal customer"? Copy relevant sentences.

---
SECTION 8: COMPETITIVE LANDSCAPE
For EACH direct competitor found (same product category + same target customer). IMPORTANT: Prioritize competitors that use the same core technology approach and solve the same clinical problem. For each competitor listed, note whether they are a DIRECT competitor (same technology, same use case) or ADJACENT (related space but different technology approach, e.g., VR training vs AR surgical navigation). Always include at least 3-5 competitors even if some are adjacent:
8.X.1 Company name
8.X.2 Product name and category
8.X.3 Funding: total raised + most recent round
8.X.4 LinkedIn employee count
8.X.5 Commercial team size (if visible on LinkedIn)
8.X.6 Named customers/hospitals visible publicly
8.X.7 Key differentiator vs. target company
8.X.8 Source URLs
8.RECENT_MOVES Any competitor announcements in last 6 months: Major customer wins / Partnerships / Funding rounds / Product launches / Regulatory approvals
Format: [Competitor] - [Event] - [Date] - [URL]
MANDATORY COMPETITOR SEARCH QUERIES (run ALL of these - you MUST return at least 3 competitors even if data is limited. If direct competitors are not found, expand to the broader category):
- Google: "[product category] companies" (e.g., "augmented reality surgical navigation companies")
- Google: "[COMPANY_NAME] competitors" OR "[COMPANY_NAME] alternatives"
- Google: "[product category] market landscape" OR "[product category] market map"
- Google: "[product name] vs" (e.g., "SurgicalAR vs")
- Check company website for any competitive positioning or "why us" page
- Search Crunchbase, CB Insights, Tracxn, and G2 for companies in the same category. Try: site:cbinsights.com "[COMPANY_NAME]" competitors, site:tracxn.com "[product category]", "[COMPANY_NAME] competitors" site:crunchbase.com
If the target company makes surgical navigation technology, also search: "surgical navigation companies," "AR surgery companies," "computer-assisted surgery competitors"

---
SECTION 9: RED FLAGS & DISQUALIFIERS
9.1 Has the company been acquired? YES/NO - evidence
9.2 Has the company pivoted out of MedTech? YES/NO - evidence
9.3 Is the company's social media inactive (no posts in 6+ months)? YES/NO
9.4 Is this a B2C business model? YES/NO - evidence
9.5 Does the company have an established sales org (VP Sales + 8+ reps)? YES/NO - evidence
9.6 Is the company pure services (no product)? YES/NO
9.7 Is the company publicly traded? YES/NO - ticker if yes
9.8 Any layoff announcements in last 12 months? YES/NO - details
9.9 Any leadership departures in last 6 months? YES/NO - details

---
SECTION 10: SEARCH LIMITATIONS
10.1 Pages that were gated, restricted, or returned errors
10.2 LinkedIn profiles that were private
10.3 Data points you searched for but could not find
10.4 Timeframe limitations
10.5 Any data point where you had to rely on a single source with no corroboration

---
MANDATORY SEARCH TARGETS (visit these URLs directly):
- FDA 510(k) database: https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm - search by applicant name [COMPANY_NAME]
- Crunchbase: https://www.crunchbase.com/organization/ - search for [COMPANY_NAME]
- Google for LinkedIn data: search "[CEO_NAME]" site:linkedin.com AND "[COMPANY_NAME]" site:linkedin.com
- Company careers page: [WEBSITE_URL]/careers OR [WEBSITE_URL]/jobs
- Company press/news: [WEBSITE_URL]/press OR [WEBSITE_URL]/news OR [WEBSITE_URL]/newsroom
- FDA device database API: https://api.fda.gov/device/510k.json?search=applicant:"[COMPANY_NAME]"
---
SECTION 11: SIGNAL FLAGS (based on extracted data above)
11.1 Pilot-to-Conversion Ratio: Count of pilot/evaluation mentions (from 5.PILOT_COUNT) vs. customer/contract mentions (from 5.CUSTOMER_COUNT). State ratio only. If 5.CONVERSION_POSTS = 0, flag: "ZERO CONVERSION LANGUAGE FOUND."
11.2 Targeting Specificity: Based on Sections 1.8, 1.9, and 7.5 - does the company specify hospital TYPE, clinical DEPARTMENT, and payment MODEL? Or is language generic? State which and copy the exact phrase.
11.3 Commercial Leadership Presence: Based on Section 4.2 - are VP Sales/CRO/CCO roles filled? YES with names, or NO.
11.4 CEO Sales Activity: Based on Section 6 - does CEO post about customer meetings, demos, pilot visits? YES with count, or NOT DETERMINABLE.
11.5 Months Since FDA Clearance: Calculated from Section 2.3 clearance date to today. State number.
11.6 Months Since Last Funding: Calculated from Section 3.LATEST date to today. State number.
11.7 One-Line Company Summary: Write a single factual sentence: [product category], [FDA status], [latest funding round + date + lead investor], [deployment count], [revenue indicator if found].
OUTPUT RULES:
- Return data in the exact section/numbering format above
- Every data point must have a source URL or state "NOT FOUND" + where you searched
- Copy exact language from sources - do not paraphrase or summarize
- Do not score, rate, rank, recommend, or analyze anything (except Section 11 signal flags which are factual cross-references)
- Do not use words like "suggests," "indicates," "implies," "likely," or "appears"
- If you cannot find something, say so. Do not fill gaps.

`;

const DEEPDIVE_PROMPT = `You are a competitive intelligence researcher. Your ONLY job is to find COMPETITORS, FDA CLEARANCE DETAILS, and CE MARKING STATUS for this company.
COMPANY: [COMPANY_NAME]
PRODUCTS: [PRODUCTS]
PRODUCT CATEGORY: [PRODUCT_CATEGORY]
WEBSITE: [WEBSITE_URL]

You have ONE job: fill in these gaps with real data. Spend ALL your search effort on these 3 areas.

## AREA 1: COMPETITIVE LANDSCAPE
Find 3-5 companies that compete with [COMPANY_NAME].
SEARCH STRATEGY (run ALL of these searches):
1. "[PRODUCT_CATEGORY] companies"
2. "[PRODUCT_CATEGORY] market landscape 2024 2025"
3. "companies like [COMPANY_NAME]"
4. "[COMPANY_NAME] competitors" site:cbinsights.com OR site:tracxn.com OR site:crunchbase.com OR site:g2.com
5. "[PRODUCT_CATEGORY] startups funded"
6. "[PRODUCT_CATEGORY] market map"
7. Check [COMPANY_NAME] website for any "why us" or competitive comparison page

For EACH competitor found, report:
- Company name
- Product name and what it does
- DIRECT (same technology + same use case) or ADJACENT (related but different approach)
- Funding (total raised if available)
- Key differentiator vs [COMPANY_NAME]
- Source URL

You MUST return at least 3 competitors. If you cannot find direct competitors, expand to adjacent companies and label them ADJACENT.

## AREA 2: FDA CLEARANCE DETAILS
Search for the specific 510(k) clearance number and details.
SEARCH STRATEGY:
1. Search FDA 510(k) database for applicant "[COMPANY_NAME]"
2. Search FDA 510(k) database for device/trade name: [PRODUCTS]
3. Google: "[COMPANY_NAME]" AND "510(k)" AND "clearance"
4. Google: "[PRODUCTS]" AND "510(k)" AND "FDA"
5. Google: "[COMPANY_NAME]" AND "K2" site:fda.gov
6. Google: "[PRODUCTS]" AND "FDA cleared" AND "510(k) number"
7. Check company press releases for FDA clearance announcements
8. Try accessdata.fda.gov with trade name variations

Report:
- Clearance type (510(k) / De Novo / PMA)
- 510(k) number or approval number
- Clearance date (exact)
- Device classification and product code
- Predicate device (if 510(k))
- Source URL for each

## AREA 3: CE MARKING STATUS
SEARCH STRATEGY:
1. "[COMPANY_NAME] CE mark" OR "CE marking"
2. "[PRODUCTS] CE mark" OR "CE marked"
3. "[COMPANY_NAME] European approval" OR "EU MDR"
4. "[COMPANY_NAME] Europe launch" OR "European market"
5. Check company press releases for CE mark announcements
6. Check if company mentions "international commercialization" and whether Europe is included

Report: YES / NO / NOT FOUND with source URL

OUTPUT RULES:
- Return RAW FACTS only
- Every data point must have a source URL
- If NOT FOUND after exhaustive search, state NOT FOUND and list all searches attempted
- Do not infer or guess
`;
async function notionHeaders() {
  return {
    "Authorization": `Bearer ${NOTION_TOKEN}`,
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION,
  };
}
async function queryPendingProspects(): Promise<any[]> {
  const resp = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
    method: "POST",
    headers: await notionHeaders(),
    body: JSON.stringify({
      filter: {
        property: "Research Status",
        select: { equals: "Pending" },
      },
      page_size: 10,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error("Notion query failed:", resp.status, text);
    return [];
  }
  const data = await resp.json();
  console.info("Found", (data.results || []).length, "pending prospects"); console.log("Notion response:", JSON.stringify(data).substring(0, 1000));
  return data.results || [];
}
function getAccountName(page: any): string {
  const titleProp = page.properties?.["Account"];
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text;
  }
  return "";
}
async function callPerplexity(companyName: string, website: string, linkedinUrl: string, ceoName: string): Promise<string> {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar-pro", max_tokens: 8000, temperature: 0.0, return_citations: true, search_domain_filter: ["-reddit.com", "-pinterest.com", "-quora.com"], search_recency_filter: "year", web_search_options: { search_context_size: "high" },
      messages: [
        { role: "system", content: RESEARCH_PROMPT.replaceAll("[COMPANY_NAME]", companyName).replaceAll("[WEBSITE_URL]", website).replaceAll("[LINKEDIN_URL]", linkedinUrl).replaceAll("[CEO_NAME]", ceoName) },
        { role: "user", content: `Research this company: ${companyName}. Website: ${website}. LinkedIn: ${linkedinUrl}. CEO/Founder: ${ceoName}.` },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Perplexity error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
}

async function callPerplexityDeepDive(companyName: string, website: string, products: string, productCategory: string): Promise<string> {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar-pro", max_tokens: 8000, temperature: 0.0, return_citations: true, search_domain_filter: ["-reddit.com", "-pinterest.com", "-quora.com"], web_search_options: { search_context_size: "high" },
      messages: [
        { role: "system", content: DEEPDIVE_PROMPT.replaceAll("[COMPANY_NAME]", companyName).replaceAll("[WEBSITE_URL]", website).replaceAll("[PRODUCTS]", products).replaceAll("[PRODUCT_CATEGORY]", productCategory) },
        { role: "user", content: `Deep-dive research for ${companyName}. Products: ${products}. Category: ${productCategory}. Website: ${website}. Find competitors, FDA 510(k) details, and CE mark status.` },
      ],
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Perplexity deep-dive error ${resp.status}: ${text}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content ?? JSON.stringify(data);
}
function chunkText(text: string, maxLen = 1900): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}
async function appendResearchToPage(pageId: string, research: string) {
  const chunks = chunkText(research);
  const children: any[] = [
    {
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Perplexity Research Output" } }],
      },
    },
  ];
  for (const chunk of chunks) {
    children.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: chunk } }],
      },
    });
  }
  const resp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: "PATCH",
    headers: await notionHeaders(),
    body: JSON.stringify({ children }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Notion append failed ${resp.status}: ${text}`);
  }
}
async function updateResearchStatus(pageId: string, status: string) {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: await notionHeaders(),
    body: JSON.stringify({
      properties: {
        "Research Status": { select: { name: status } },
      },
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    console.error(`Failed to update status for ${pageId}:`, resp.status, text);
  }
}
async function processProspects(): Promise<{ processed: number; errors: number }> {
  const pages = await queryPendingProspects();
  let processed = 0;
  let errors = 0;
  for (const page of pages) {
    const pageId = page.id;
    const companyName = getAccountName(page);        const website = page.properties?.["Website"]?.url || page.properties?.["Website URL"]?.url || "";        const linkedinUrl = page.properties?.["LinkedIn"]?.url || page.properties?.["LinkedIn URL"]?.url || "";        const ceoName = page.properties?.["CEO"]?.rich_text?.[0]?.plain_text || page.properties?.["CEO Name"]?.rich_text?.[0]?.plain_text || page.properties?.["Contact"]?.rich_text?.[0]?.plain_text || "";
    console.log(`Properties for ${pageId}:`, Object.keys(page.properties || {}));        console.log(`Extracted - company: ${companyName}, website: ${website}, linkedin: ${linkedinUrl}, ceo: ${ceoName}`);        if (!companyName) {
      console.error(`Page ${pageId} has no Account name, skipping`);
      await updateResearchStatus(pageId, "Error");
      errors++;
      continue;
    }
    console.info(`Researching: ${companyName} (${pageId})`);
    try {
      const research = await callPerplexity(companyName, website, linkedinUrl, ceoName);
      await appendResearchToPage(pageId, research);
            // === CALL 2: Deep-dive for competitors, FDA details, CE marking ===
      const productsMatch = research.match(/1\.6[^:]*:\s*([^\n]+)/i);
      const products = productsMatch ? productsMatch[1].replace(/\[\d+\]/g, '').replace(/\s*Source URL.*/i, '').trim().substring(0, 500) : companyName;
      const categoryMatch = research.match(/1\.7[^:]*(?:category|classification)[^:]*:\s*([^\n]+)/i);
      const productCategory = categoryMatch ? categoryMatch[1].replace(/\[\d+\]/g, '').replace(/\s*Source URL.*/i, '').trim().substring(0, 200) : "medical device";
            // Filter out NOT FOUND values from all extracted fields
      const isValid = (v: string) => v && !/not found/i.test(v) && !/searched/i.test(v);
      console.info(`Deep-dive inputs - products: ${products.substring(0, 100)}, category: ${productCategory}`);
            let deepDiveText = "";
      try {
        const deepDive = await callPerplexityDeepDive(companyName, website, products, productCategory);
        await appendResearchToPage(pageId, "\n\n---\n\n## Deep-Dive Research (Competitors, FDA, CE)\n\n" + deepDive);
                deepDiveText = deepDive;
        console.info(`Deep-dive complete for ${companyName}`);
      } catch (ddErr) {
        console.error(`Deep-dive failed for ${companyName}:`, ddErr);
        // Continue without deep-dive - don't fail the whole process
      }
            // Extract one-line summary from Section 11.7 and write to Notion property
      const summaryMatch = research.match(/11\.7[^:]*:\s*(.+?)(?:\n|$)/);
      const summary = summaryMatch ? summaryMatch[1].trim().substring(0, 2000) : "";
      if (summary) {
                    // Extract structured fields from research - clean citation brackets like [1][2]
      const cleanCitations = (s: string) => s.replace(/\[\d+\]/g, '').replace(/\s*Source URL.*/i, '').trim();
      const hqMatch = research.match(/1\.2[^:]*(?:location|headquarters)[^:]*:\s*([^\n]+)/i);
      const hqRaw = hqMatch ? cleanCitations(hqMatch[1]).substring(0, 100) : "";
      const hqLocation = /not found/i.test(hqRaw) ? "" : hqRaw;
      const yearMatch = research.match(/1\.3[^:]*(?:year|founded)[^:]*:\s*(\d{4})/i);
      const yearFounded = yearMatch ? yearMatch[1] : "";
      const fdaApprovalMatch = research.match(/2\.1[^:]*FDA[^:]*:\s*([^\n]+)/i);
      const fdaDateMatch = research.match(/2\.3[^:]*FDA[^:]*date[^:]*:\s*([^\n]+)/i);
      const fdaStatus = fdaApprovalMatch && /yes/i.test(fdaApprovalMatch[1]) ? "FDA 510(k) cleared" + (fdaDateMatch ? " " + cleanCitations(fdaDateMatch[1]) : "") : "";
      const compNames = [...(research + " " + deepDiveText).matchAll(/(?:Competitor\s*\d*\s*(?::|-)\s*)([^\n]+)/gi)].map(m => m[1].trim()).filter(n => n.length > 2 && n.length < 60).slice(0, 10);
      const competitors = compNames.join(", ");
            console.info("Extraction - hq: " + hqLocation + ", year: " + yearFounded + ", fda: " + fdaStatus + ", cat: " + productCategory);

                  // === INTELLIGENCE GAP DETECTION ===
      const gapFields = [
        { field: "hq_location", value: hqLocation, category: "CRITICAL", label: "Headquarters location" },
        { field: "year_founded", value: yearFounded, category: "IMPORTANT", label: "Year founded" },
        { field: "fda_status", value: fdaStatus, category: "CRITICAL", label: "FDA clearance status" },
        { field: "product_category", value: productCategory, category: "CRITICAL", label: "Product category" },
        { field: "competitors", value: competitors, category: "NICE_TO_HAVE", label: "Competitors" },
      ];
      const notFoundInText = (research + " " + deepDiveText).toLowerCase();
      const textGaps: string[] = [];
      if (notFoundInText.includes("funding") && notFoundInText.includes("not found")) textGaps.push("IMPORTANT: Funding history");
      if (notFoundInText.includes("employee") && notFoundInText.includes("not found")) textGaps.push("CRITICAL: Employee count");
      if (notFoundInText.includes("revenue") && notFoundInText.includes("not found")) textGaps.push("IMPORTANT: Revenue estimates");
      if (notFoundInText.includes("customer") && notFoundInText.includes("not found")) textGaps.push("IMPORTANT: Target customers");
      
      const structuredGaps = gapFields
        .filter(g => !g.value || /not found/i.test(g.value))
        .map(g => ({ field: g.field, category: g.category, label: g.label }));
      const allGaps = [
        ...structuredGaps.map(g => `${g.category}: ${g.label}`),
        ...textGaps
      ];
      
      // Generate follow-up queries for gaps
      const followupQueries: string[] = [];
      for (const gap of structuredGaps) {
        if (gap.field === "fda_status") followupQueries.push(`"${companyName}" FDA 510k clearance site:accessdata.fda.gov`);
        if (gap.field === "hq_location") followupQueries.push(`"${companyName}" headquarters location office address`);
        if (gap.field === "product_category") followupQueries.push(`"${companyName}" medical device product SaMD DTx`);
        if (gap.field === "year_founded") followupQueries.push(`"${companyName}" founded year incorporated site:crunchbase.com`);
      }
      for (const tg of textGaps) {
        if (tg.includes("Funding")) followupQueries.push(`"${companyName}" funding round series raised site:crunchbase.com`);
        if (tg.includes("Employee")) followupQueries.push(`"${companyName}" employees team size site:linkedin.com`);
        if (tg.includes("Revenue")) followupQueries.push(`"${companyName}" revenue ARR annual recurring`);
        if (tg.includes("Target customers")) followupQueries.push(`"${companyName}" customers hospitals health systems partners`);
      }
      console.info(`Gaps detected: ${allGaps.length}, Follow-up queries: ${followupQueries.length}`);
        await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
                    
          method: "PATCH",
          headers: await notionHeaders(),
          body: JSON.stringify({
            properties: {
              "Research Summary": { rich_text: [{ type: "text", text: { content: summary } }] },
                          ...(hqLocation && { "HQ Location": { rich_text: [{ type: "text", text: { content: hqLocation } }] } }),
            ...(yearFounded && { "Year Founded": { rich_text: [{ type: "text", text: { content: yearFounded } }] } }),
            ...(productCategory && { "Product Category": { select: { name: productCategory.substring(0, 100) } } }),
            ...(fdaStatus && { "FDA Status": { select: { name: fdaStatus.substring(0, 100) } } }),
            ...(competitors && { "Competitors": { rich_text: [{ type: "text", text: { content: competitors } }] } }),
            },
          }),
        });
      }
      await updateResearchStatus(pageId, "Complete");
      processed++;
      console.info(`Done: ${companyName}`);
    } catch (err) {
      console.error(`Error researching ${companyName}:`, err);
      await updateResearchStatus(pageId, "Error");
      errors++;
    }
  }
    return { processed, errors, data_gaps: allGaps || [], followup_queries: followupQueries || [] };
}
console.info("prospect-researcher started");
Deno.serve(async (_req: Request) => {
  try {
    const result = await processProspects();
    return new Response(
      JSON.stringify({ success: true, ...result }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Unhandled error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
