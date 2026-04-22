import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAccountByName } from "../_shared/fuzzy-lookup.ts";

const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RESEARCH_PROMPT = `You are a data extraction tool. Your job is to find and return RAW FACTS about a company. Do not analyze, score, recommend, or strategize. Do not use words like "suggests," "indicates," or "implies." Just extract what is directly observable and cite every source.

COMPANY: [COMPANY_NAME]
WEBSITE: [WEBSITE_URL]
LINKEDIN: [LINKEDIN_URL]
CEO/FOUNDER: [CEO_NAME]

INSTRUCTIONS: Extract every data point listed below. For each:
- If found: State the fact + source URL + date retrieved or published
- If not found after searching: Emit a GAP block (see GAP BLOCK FORMAT below) so the human can fetch it manually via their Perplexity Comet browser. Do NOT just write "NOT FOUND" and move on.
- Do not infer. Do not guess. Do not fill gaps with assumptions.

HARD RULE: The literal string "NOT FOUND" is banned from your output. If a field is not found, you MUST emit a <<<GAP>>> block for it. Field definitions below may list "NOT FOUND" as a legacy option — ignore it; use GAP blocks instead.

GAP BLOCK FORMAT — use this exact shape for every data point you could not find:

<<<GAP>>>
field: <section number and field name, e.g. "4.1 LinkedIn employee count">
why_not_found: <one line — e.g. "LinkedIn company page blocked to crawler", "not published publicly", "pre-IPO private company">
go_to_url: <the single most useful URL the user should open in Comet — e.g. the company LinkedIn People page, the careers page, the CEO's LinkedIn posts tab>
comet_prompt: <a ready-to-paste instruction for Comet on that page — concrete, specific, extracts the field above. Do not be generic. Example: "List every person shown here with 'Sales', 'Commercial', 'BD', or 'Marketing' in their title, plus their start date and location.">
<<<END GAP>>>

---
SECTION 1: COMPANY BASICS
1.1 Company legal name
1.2 Headquarters location (city, state, country)
1.3 Year founded
1.4 Company description (verbatim from website About section)
1.5 LinkedIn About section text (verbatim)
1.6 Product name(s) and one-line description of each
1.7 Product category: SaMD / Hardware device / DTx / Clinical AI / Combination / Other
1.8 Target customer as stated on website (copy exact language)
1.9 Target customer as stated on LinkedIn (copy exact language)
Source URL for each.

---
SECTION 2: REGULATORY STATUS
2.1 FDA clearance/approval: YES / NO / PENDING (or GAP block)
2.2 If YES: Clearance type (510(k) / De Novo / PMA / EUA)
2.3 If YES: FDA clearance date (exact date)
2.4 If YES: 510(k) number or approval number
2.5 If YES: Device classification and product code
2.6 CE marking status: YES / NO (or GAP block)
2.7 Other regulatory approvals (Health Canada, TGA, PMDA, etc.)
2.8 Months since most recent regulatory clearance
Source URL for each.

---
SECTION 3: FUNDING HISTORY
For EACH funding round found:
3.X.1 Round type (Pre-Seed / Seed / Series A / B / C / etc.)
3.X.2 Amount raised
3.X.3 Date announced
3.X.4 Lead investor(s)
3.X.5 Other notable investors
3.X.6 Stated use of funds
3.X.7 Source URL
3.TOTAL Total capital raised across all rounds
3.LATEST Most recent round: type + amount + date
3.MONTHS Months since most recent funding round

---
SECTION 4: TEAM & EMPLOYEE DATA
4.1 LinkedIn employee count
4.2 List ALL employees with commercial/sales titles found on LinkedIn
4.3 List ALL employees with marketing titles
4.4 CEO/Founder name and title
4.5 CEO LinkedIn URL
4.6 CEO background summary
4.7 Does the CEO appear to be the primary person doing sales/BD activity?
Source: LinkedIn company page.

---
SECTION 5: COMMERCIAL EVIDENCE
For EACH pilot, customer, partner, or deployment mentioned publicly:
5.X.1 Organization name
5.X.2 Type: Academic Medical Center / Community Hospital / Rural Hospital / etc.
5.X.3 Relationship type as described
5.X.4 Date announced
5.X.5 Source URL
5.X.6 Exact quote describing the relationship
5.PILOT_COUNT Total count of pilot/evaluation sites
5.CUSTOMER_COUNT Total count of customer/contract sites
5.REVENUE Any publicly stated revenue figures
5.VOLUME_METRICS Any stated volume metrics

---
SECTION 6: CEO/FOUNDER LINKEDIN ACTIVITY
Extract the CEO LinkedIn posts from the last 6 months.
6.PAIN_QUOTES Extract ALL direct quotes where CEO uses pain language
6.POSTING_FREQUENCY Average posts per month
6.ENGAGEMENT Average likes/comments

---
SECTION 7: WEBSITE LANGUAGE EXTRACTION
7.1 Homepage headline and subheadline
7.2 Homepage target customer language
7.3 About page company description
7.4 Any page describing pilots or evaluations
7.5 Any page describing target customers
7.6 Case studies page
7.7 Careers/jobs page - list commercial/sales roles

---
SECTION 8: COMPETITIVE LANDSCAPE
For EACH direct competitor found:
8.X.1 Company name
8.X.2 Product name and category
8.X.3 Funding total + most recent round
8.X.4 LinkedIn employee count
8.X.5 Commercial team size
8.X.6 Named customers/hospitals
8.X.7 Key differentiator
8.X.8 Source URLs
You MUST return at least 3 competitors.

---
SECTION 9: RED FLAGS & DISQUALIFIERS
9.1 Has the company been acquired? YES/NO
9.2 Has the company pivoted out of MedTech? YES/NO
9.3 Is social media inactive (6+ months)? YES/NO
9.4 Is this B2C? YES/NO
9.5 Established sales org (VP Sales + 8+ reps)? YES/NO
9.6 Pure services (no product)? YES/NO
9.7 Publicly traded? YES/NO
9.8 Any layoffs in last 12 months? YES/NO
9.9 Any leadership departures in last 6 months? YES/NO

---
SECTION 10: RESERVED (search limitations now captured via <<<GAP>>> blocks above)

---
SECTION 11: SIGNAL FLAGS
11.1 Pilot-to-Conversion Ratio
11.2 Targeting Specificity
11.3 Commercial Leadership Presence
11.4 CEO Sales Activity
11.5 Months Since FDA Clearance
11.6 Months Since Last Funding
11.7 One-Line Company Summary

OUTPUT RULES:
- Return data in the exact section/numbering format above
- Every data point must have either a source URL OR a <<<GAP>>> block pointing the user to where they can fetch it manually in Comet
- Copy exact language from sources - do not paraphrase
- Do not score, rate, rank, recommend, or analyze
- If you cannot find something, emit a GAP block. Never fill gaps with guesses or inferences.`;

const DEEPDIVE_PROMPT = `You are a competitive intelligence researcher. Your ONLY job is to find COMPETITORS, FDA CLEARANCE DETAILS, and CE MARKING STATUS for this company.
COMPANY: [COMPANY_NAME]
PRODUCTS: [PRODUCTS]
PRODUCT CATEGORY: [PRODUCT_CATEGORY]
WEBSITE: [WEBSITE_URL]

You have ONE job: fill in these gaps with real data.

## AREA 1: COMPETITIVE LANDSCAPE
Find 3-5 companies that compete with [COMPANY_NAME].
For EACH competitor found, report:
- Company name
- Product name and what it does
- DIRECT or ADJACENT competitor
- Funding (total raised if available)
- Key differentiator vs [COMPANY_NAME]
- Source URL
You MUST return at least 3 competitors.

## AREA 2: FDA CLEARANCE DETAILS
Search for specific 510(k) clearance number and details.
Report: Clearance type, 510(k) number, Clearance date, Device classification, Predicate device, Source URL.

## AREA 3: CE MARKING STATUS
Report: YES / NO with source URL, or a <<<GAP>>> block if you cannot determine it.

OUTPUT RULES:
- Return RAW FACTS only
- Every data point must have a source URL, OR a <<<GAP>>> block so the user can fetch it manually in Comet
- GAP BLOCK FORMAT:
  <<<GAP>>>
  field: <what you were looking for>
  why_not_found: <one line>
  go_to_url: <single best URL to open in Comet>
  comet_prompt: <ready-to-paste, specific extraction instruction>
  <<<END GAP>>>
- Do not infer or guess`;

async function callPerplexity(companyName: string, website: string, linkedinUrl: string, ceoName: string): Promise<string> {
  const resp = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: "sonar-pro",
      max_tokens: 8000,
      temperature: 0.0,
      return_citations: true,
      search_domain_filter: ["-reddit.com", "-pinterest.com", "-quora.com"],
      search_recency_filter: "year",
      web_search_options: { search_context_size: "high" },
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
      model: "sonar-pro",
      max_tokens: 8000,
      temperature: 0.0,
      return_citations: true,
      search_domain_filter: ["-reddit.com", "-pinterest.com", "-quora.com"],
      web_search_options: { search_context_size: "high" },
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

function extractFields(research: string, deepDive: string) {
  const clean = (s: string) => s.replace(/\[\d+\]/g, "").replace(/\s*Source URL.*/i, "").trim();
  const match = (pattern: RegExp, text: string) => {
    const m = text.match(pattern);
    return m ? clean(m[1]) : null;
  };

  const hqRaw = match(/1\.2[^:]*(?:location|headquarters)[^:]*:\s*([^\n]+)/i, research);
  const hqLocation = hqRaw && !/not found/i.test(hqRaw) ? hqRaw.substring(0, 100) : null;

  const yearMatch = research.match(/1\.3[^:]*(?:year|founded)[^:]*:\s*(\d{4})/i);
  const yearFounded = yearMatch ? yearMatch[1] : null;

  const productCatMatch = match(/1\.7[^:]*(?:category|classification)[^:]*:\s*([^\n]+)/i, research);
  const productCategory = productCatMatch && !/not found/i.test(productCatMatch) ? productCatMatch.substring(0, 100) : null;

  const fdaMatch = match(/2\.1[^:]*FDA[^:]*:\s*([^\n]+)/i, research);
  const fdaDateMatch = match(/2\.3[^:]*FDA[^:]*date[^:]*:\s*([^\n]+)/i, research);
  const fdaStatus = fdaMatch && /yes/i.test(fdaMatch)
    ? "FDA 510(k) cleared" + (fdaDateMatch ? " " + fdaDateMatch : "")
    : fdaMatch && /pending/i.test(fdaMatch) ? "FDA Pending" : null;

  const summaryMatch = match(/11\.7[^:]*:\s*(.+?)(?:\n|$)/, research);
  const researchSummary = summaryMatch ? summaryMatch.substring(0, 2000) : null;

  const compNames = [...(research + " " + deepDive).matchAll(/(?:Competitor\s*\d*\s*(?::|-)\s*)([^\n]+)/gi)]
    .map(m => m[1].trim()).filter(n => n.length > 2 && n.length < 60).slice(0, 10);
  const competitors = compNames.length > 0 ? compNames.join(", ") : null;

  return { hqLocation, yearFounded, productCategory, fdaStatus, researchSummary, competitors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { company_name, website_url, linkedin_url, ceo_name, notion_page_id, account_id } = body;

    if (!company_name) {
      return new Response(
        JSON.stringify({ error: "company_name is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Resolve the account row up front. This gives us the row id for the
    // later update AND lets us hydrate website_url/linkedin_url/ceo_name
    // from the DB when the caller didn't pass them -- otherwise Perplexity
    // gets an empty [LINKEDIN_URL] in its prompt and can't anchor its
    // LinkedIn searches.
    let account: Record<string, any> | null = null;
    if (notion_page_id) {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("notion_page_id", notion_page_id)
        .maybeSingle();
      account = data;
    } else if (account_id) {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("id", account_id)
        .maybeSingle();
      account = data;
    } else {
      // Fuzzy-resolve by name so "Medtronik" still lands on Medtronic.
      const resolved = await resolveAccountByName(supabase, company_name);
      if (resolved) {
        const { data } = await supabase
          .from("accounts")
          .select("*")
          .eq("id", resolved.id)
          .maybeSingle();
        account = data;
      }
    }

    if (!account) {
      throw new Error(
        `No account matched (company_name='${company_name}', notion_page_id='${notion_page_id ?? ""}', account_id='${account_id ?? ""}')`
      );
    }

    // Caller-supplied values win; DB fields fill the gaps.
    const effectiveWebsite = website_url || account.website_url || "";
    const effectiveLinkedin = linkedin_url || account.linkedin_url || "";
    const effectiveCeo = ceo_name || account.ceo_name || "";

    console.info(
      `Researching: ${company_name} (website=${effectiveWebsite || "MISSING"}, linkedin=${effectiveLinkedin || "MISSING"}, ceo=${effectiveCeo || "MISSING"})`
    );

    // Call 1: Main research
    const research = await callPerplexity(
      company_name,
      effectiveWebsite,
      effectiveLinkedin,
      effectiveCeo
    );
    console.info(`Main research complete for ${company_name}`);

    // Extract products and category for deep-dive
    const productsMatch = research.match(/1\.6[^:]*:\s*([^\n]+)/i);
    const products = productsMatch ? productsMatch[1].replace(/\[\d+\]/g, "").trim().substring(0, 500) : company_name;
    const catMatch = research.match(/1\.7[^:]*(?:category|classification)[^:]*:\s*([^\n]+)/i);
    const productCat = catMatch ? catMatch[1].replace(/\[\d+\]/g, "").trim().substring(0, 200) : "medical device";

    // Call 2: Deep-dive for competitors, FDA, CE
    let deepDive = "";
    try {
      deepDive = await callPerplexityDeepDive(company_name, effectiveWebsite, products, productCat);
      console.info(`Deep-dive complete for ${company_name}`);
    } catch (ddErr) {
      console.error(`Deep-dive failed for ${company_name}:`, ddErr);
    }

    // Extract structured fields
    const fields = extractFields(research, deepDive);

    // Build update object
    const updateData: Record<string, any> = {
      research_output: research,
      deepdive_output: deepDive || null,
      research_status: "Complete",
      last_researched: new Date().toISOString(),
      research_version: 2,
      updated_at: new Date().toISOString(),
    };

    if (fields.researchSummary) updateData.research_summary = fields.researchSummary;
    if (fields.hqLocation) updateData.hq_location = fields.hqLocation;
    if (fields.yearFounded) updateData.year_founded = fields.yearFounded;
    if (fields.productCategory) updateData.product_category = fields.productCategory;
    if (fields.fdaStatus) updateData.fda_status = fields.fdaStatus;
    if (fields.competitors) updateData.competitors = fields.competitors;

    const { data: result, error: updateErr } = await supabase
      .from("accounts")
      .update(updateData)
      .eq("id", account.id)
      .select()
      .single();
    if (updateErr) throw new Error(`Supabase update error: ${updateErr.message}`);

    console.info(`Research saved for ${company_name}`);

    return new Response(
      JSON.stringify({ success: true, prospect: result }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("prospect-researcher error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
