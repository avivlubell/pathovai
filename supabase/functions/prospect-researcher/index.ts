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

async function callPerplexityDeepDive(companyName: string, website: string): Promise<string> {
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
        { role: "system", content: DEEPDIVE_PROMPT.replaceAll("[COMPANY_NAME]", companyName).replaceAll("[WEBSITE_URL]", website) },
        { role: "user", content: `Deep-dive research for ${companyName}. Website: ${website}. Find competitors, FDA 510(k) details, and CE mark status.` },
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

// Deterministic post-processor. Perplexity frequently returns "NOT FOUND"
// despite prompt instructions to emit GAP blocks. We rewrite every such
// line into a proper <<<GAP>>> block so the Quarterback can always hand the
// user a Comet-ready prompt regardless of model compliance.
function buildGapBlock(fieldLabel: string, account: Record<string, any>): string {
  const linkedin: string = (account?.linkedin_url as string) || "";
  const website: string = (account?.website_url as string) || "";
  const ceoName: string = (account?.ceo_name as string) || "";
  const name: string = (account?.company_name as string) || "";
  const encodedName = encodeURIComponent(name);
  const linkedinPeople = linkedin ? linkedin.replace(/\/+$/, "") + "/people/" : "";
  const linkedinPosts = linkedin ? linkedin.replace(/\/+$/, "") + "/posts/" : "";
  const crunchbaseSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const f = fieldLabel.toLowerCase();
  let goToUrl = "";
  let cometPrompt = "";
  let why = "Not found via Perplexity web search";

  if (/ce marking|ce mark/.test(f)) {
    goToUrl = `https://ec.europa.eu/tools/eudamed/#/screen/search-device?deviceManufacturer=${encodedName}`;
    cometPrompt = `Search EUDAMED for ${name}. Return any listed medical devices, their UDI-DI, risk class, and CE certificate number. If nothing is listed, state "no CE registration found" verbatim.`;
    why = "CE / EUDAMED database requires direct query";
  } else if (/fda|510\(?k\)?|device classification|product code|predicate/.test(f)) {
    goToUrl = `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?start_search=1&applicant=${encodedName}`;
    cometPrompt = `Search the FDA 510(k) database for ${name}. Return: K-number, clearance date, product code, device classification, predicate device, and indications-for-use statement (verbatim).`;
    why = "FDA database requires direct query";
  } else if (/linkedin about|linkedin.*description|linkedin.*headline/.test(f)) {
    goToUrl = linkedin || `https://www.linkedin.com/search/results/companies/?keywords=${encodedName}`;
    cometPrompt = `Open the company's LinkedIn About section and paste the verbatim text. Also paste the tagline/subheadline under the company name.`;
    why = "LinkedIn company page blocked to crawler";
  } else if (/linkedin employee count|linkedin headcount/.test(f) || /all employees|employees with|commercial\/sales titles|marketing titles|sales titles/.test(f)) {
    goToUrl = linkedinPeople || `https://www.linkedin.com/search/results/companies/?keywords=${encodedName}`;
    cometPrompt = `On this LinkedIn People tab: (1) total employee count shown; (2) list every person with Sales, Commercial, BD, Growth, Marketing, or Revenue in their title, with full title, start date, and location; (3) flag anyone whose tenure is <3 months.`;
    why = "LinkedIn employee list gated to authenticated browser";
  } else if (/ceo.*linkedin url|ceo linkedin profile|founder.*linkedin/.test(f)) {
    goToUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((ceoName || "CEO") + " " + name)}`;
    cometPrompt = `Find the LinkedIn profile of ${ceoName || "the CEO of " + name}. Return the canonical profile URL and the headline text under their name.`;
    why = "Individual LinkedIn profile not indexed by Perplexity";
  } else if (/ceo background|founder background|ceo.*experience/.test(f)) {
    goToUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent((ceoName || "CEO") + " " + name)}`;
    cometPrompt = `Open ${ceoName || "the CEO's"} LinkedIn profile. Return: current role, prior 3 roles (company, title, years), education, and any notable exits or prior-company outcomes.`;
    why = "LinkedIn profile experience section gated";
  } else if (/ceo.*activity|ceo.*post|pain_quotes|posting frequency|engagement|ceo.*sales/.test(f)) {
    goToUrl = linkedinPosts || `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent((ceoName || "CEO") + " " + name)}`;
    cometPrompt = `From ${ceoName || "the CEO's"} last 6 months of LinkedIn posts, return: (1) total post count; (2) every post that mentions sales, commercial, pipeline, customers, pilots, stalls, or messaging challenges — give date + verbatim opening line; (3) average likes/comments across the window.`;
    why = "LinkedIn posts feed gated to authenticated browser";
  } else if (/funding|round|investor|capital raised|total raised|months since.*funding/.test(f)) {
    goToUrl = `https://www.crunchbase.com/organization/${crunchbaseSlug}/company_financials`;
    cometPrompt = `On Crunchbase for ${name}, return every funding round: type (Seed / A / B / etc.), amount, date announced, lead investor, other investors, and cumulative total raised. If a field is not shown, say "not listed".`;
    why = "Funding history behind Crunchbase login";
  } else if (/year founded|founded/.test(f)) {
    goToUrl = `https://www.crunchbase.com/organization/${crunchbaseSlug}`;
    cometPrompt = `Return the founding year of ${name} as shown on Crunchbase, plus the founders listed.`;
    why = "Founding year not in public search results";
  } else if (/homepage|about page|case studies|careers|jobs|target customer.*website|website.*target/.test(f)) {
    goToUrl = website || `https://www.google.com/search?q=${encodedName}`;
    cometPrompt = `On ${name}'s website, find and paste the verbatim text for: ${fieldLabel}. Also give the exact page URL you pulled it from.`;
    why = "Website section not fully indexed by Perplexity";
  } else if (/competitor|competitive/.test(f)) {
    goToUrl = `https://www.google.com/search?q=${encodeURIComponent(name + " competitors alternatives")}`;
    cometPrompt = `Identify 3-5 direct competitors to ${name}. For each: company name, flagship product + category, last funding round + amount, LinkedIn employee count, named customers, and one-line differentiator vs ${name}. Prefer sources newer than 12 months.`;
    why = "Competitive landscape requires manual synthesis";
  } else if (/pilot|customer_count|customer count|deployment|named customers|hospital/.test(f)) {
    goToUrl = website ? (website.replace(/\/+$/, "") + "/news-events") : `https://www.google.com/search?q=${encodeURIComponent(name + " customer hospital pilot announcement")}`;
    cometPrompt = `Scan press releases and news for ${name}. List every named hospital, clinic, health-system, or AMC mentioned as a customer, pilot site, or partner. For each: organization name, relationship type, date announced, exact quote.`;
    why = "Specific customer names rarely in search snippets";
  } else if (/revenue|arr|booking/.test(f)) {
    goToUrl = `https://www.google.com/search?q=${encodeURIComponent(name + " revenue 2025 ARR")}`;
    cometPrompt = `Find any publicly disclosed revenue, ARR, or booking figures for ${name}. If none found, state "no public revenue disclosures" verbatim. Do not estimate.`;
    why = "Private-company revenue rarely disclosed";
  } else if (/months since|timeframe/.test(f)) {
    goToUrl = "";
    cometPrompt = `Once the related date is captured (FDA clearance date, funding date, etc.), compute months-since from today's date. No web fetch required.`;
    why = "Derived field — compute once upstream value is known";
  } else if (/layoff|leadership departure|social media inactive|acquired|pivoted|publicly traded|pure services|sales org/.test(f)) {
    goToUrl = `https://www.google.com/search?q=${encodeURIComponent(name + " " + fieldLabel)}`;
    cometPrompt = `Answer YES or NO for: ${fieldLabel}. Cite the source URL(s) you used. If no evidence either way, say "no evidence" verbatim.`;
    why = "Red-flag signal needs targeted web check";
  } else {
    goToUrl = `https://www.google.com/search?q=${encodeURIComponent(name + " " + fieldLabel)}`;
    cometPrompt = `Find and extract: ${fieldLabel} for ${name}. Quote source URLs.`;
  }

  return [
    "<<<GAP>>>",
    `field: ${fieldLabel}`,
    `why_not_found: ${why}`,
    `go_to_url: ${goToUrl}`,
    `comet_prompt: ${cometPrompt}`,
    "<<<END GAP>>>",
  ].join("\n");
}

function transformNotFoundToGaps(text: string, account: Record<string, any>): string {
  if (!text) return text;
  // Matches lines like:
  //   "4.1 LinkedIn employee count: NOT FOUND (searched ...)"
  //   "2.6 CE marking status: NOT FOUND. Searched all results"
  //   "3.1.2 Amount raised: NOT FOUND"
  // Field label = everything between the leading whitespace and the final colon
  // before "NOT FOUND".
  const lineRegex = /^([ \t]*)([^\n:]+?):\s*NOT FOUND[^\n]*$/gim;
  return text.replace(lineRegex, (_full, indent: string, fieldLabel: string) => {
    return indent + buildGapBlock(fieldLabel.trim(), account);
  });
}

// Strips lines from scraped/LLM-synthesized content that match classic
// indirect prompt injection patterns. Operates on the raw Perplexity output
// before it is stored or injected into any agent context.
const INJECTION_PATTERNS = [
  /ignore\s+(all\s+|your\s+|previous\s+|prior\s+)?instructions/i,
  /ignore\s+(all\s+|your\s+|previous\s+|prior\s+)?rules/i,
  /disregard\s+(all\s+|your\s+|previous\s+)?instructions/i,
  /forget\s+(everything|all|your\s+instructions)/i,
  /you\s+are\s+now\s+/i,
  /new\s+instructions\s*:/i,
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /system\s+prompt/i,
  /override\s+(your\s+)?(instructions|rules|guidelines)/i,
  /act\s+as\s+(if\s+you\s+(are|were)|a\s+)/i,
  /pretend\s+(you\s+are|to\s+be)/i,
  /from\s+now\s+on\s*,?\s+you\s+(must|should|will|are)/i,
];

function sanitizeExternalContent(text: string, source: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const stripped: string[] = [];
  let removedCount = 0;

  for (const line of lines) {
    const matched = INJECTION_PATTERNS.some(p => p.test(line));
    if (matched) {
      stripped.push(`[REDACTED: potential injection pattern removed by sanitizer]`);
      removedCount++;
    } else {
      stripped.push(line);
    }
  }

  if (removedCount > 0) {
    console.warn(`[sanitizer:${source}] removed ${removedCount} line(s) matching injection patterns`);
  }
  return stripped.join("\n");
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

    // Both calls run in parallel — deep-dive no longer depends on main research output
    const [researchResult, deepDiveResult] = await Promise.allSettled([
      callPerplexity(company_name, effectiveWebsite, effectiveLinkedin, effectiveCeo),
      callPerplexityDeepDive(company_name, effectiveWebsite),
    ]);

    if (researchResult.status === "rejected") {
      throw new Error(`Main research failed: ${researchResult.reason}`);
    }
    const research = researchResult.value;
    console.info(`Main research complete for ${company_name}`);

    let deepDive = "";
    if (deepDiveResult.status === "fulfilled") {
      deepDive = deepDiveResult.value;
      console.info(`Deep-dive complete for ${company_name}`);
    } else {
      console.error(`Deep-dive failed for ${company_name}:`, deepDiveResult.reason);
    }

    // Sanitize external content before any further processing or storage.
    const sanitizedResearch = sanitizeExternalContent(research, "research");
    const sanitizedDeepDive = deepDive ? sanitizeExternalContent(deepDive, "deepdive") : "";

    // Extract structured fields from the RAW research text (before gap
    // transformation) so the existing "skip if NOT FOUND" regex paths
    // keep working unchanged.
    const fields = extractFields(sanitizedResearch, sanitizedDeepDive);

    // Transform every remaining "NOT FOUND" line into a proper <<<GAP>>>
    // block with a per-field-type URL and Comet prompt. Done in code so
    // the output is deterministic regardless of whether Perplexity
    // followed the prompt's GAP instructions.
    const researchWithGaps = transformNotFoundToGaps(sanitizedResearch, account);
    const deepDiveWithGaps = sanitizedDeepDive ? transformNotFoundToGaps(sanitizedDeepDive, account) : "";

    // Build update object
    const updateData: Record<string, any> = {
      research_output: researchWithGaps,
      deepdive_output: deepDiveWithGaps || null,
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
