// Fuzzy name matching helper shared by all edge functions that resolve
// accounts or contacts from user-typed names. Wraps the pg_trgm-backed
// RPCs defined in supabase/sql/fuzzy_name_matching.sql and provides a
// consistent candidate + confidence shape so the Quarterback can
// disambiguate ("did you mean...?") without each function reinventing
// the wheel.

export interface AccountMatch {
  id: string;
  company_name: string;
  score: number;
  matched_on: "company_name" | "alias";
}

export interface ContactMatch {
  id: string;
  full_name: string;
  company_name: string | null;
  account_id: string | null;
  score: number;
}

export interface MatchInfo<T> {
  query: string;
  top: T | null;
  candidates: T[];
  confident: boolean;
  ambiguous: boolean;
  matched_on?: "company_name" | "alias";
}

// Callers use these defaults unless they have a reason to tune. Sync
// flows (e.g., sync-contacts linking) should pass a stricter minScore
// to avoid creating wrong FK links silently.
export const DEFAULT_MIN_SCORE = 0.3;
export const HIGH_CONFIDENCE_SCORE = 0.6;
export const CONFIDENT_GAP = 0.15;

export async function fuzzyFindAccounts(
  supabase: any,
  query: string,
  opts: { limit?: number; minScore?: number } = {},
): Promise<AccountMatch[]> {
  if (!query || typeof query !== "string" || !query.trim()) return [];
  const q = query.trim();
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const { data, error } = await supabase.rpc("fuzzy_find_accounts", {
    q,
    match_limit: limit,
    min_score: minScore,
  });

  if (!error && Array.isArray(data)) {
    return data as AccountMatch[];
  }

  // RPC missing (migration not yet applied) -> fall back to legacy
  // substring match so the edge function keeps working.
  const { data: fb } = await supabase
    .from("accounts")
    .select("id, company_name")
    .ilike("company_name", `%${q}%`)
    .limit(limit);
  return (fb || []).map((r: any) => ({
    id: r.id,
    company_name: r.company_name,
    score: 0,
    matched_on: "company_name" as const,
  }));
}

export async function fuzzyFindContacts(
  supabase: any,
  query: string,
  opts: { limit?: number; minScore?: number } = {},
): Promise<ContactMatch[]> {
  if (!query || typeof query !== "string" || !query.trim()) return [];
  const q = query.trim();
  const limit = opts.limit ?? 5;
  const minScore = opts.minScore ?? DEFAULT_MIN_SCORE;

  const { data, error } = await supabase.rpc("fuzzy_find_contacts", {
    q,
    match_limit: limit,
    min_score: minScore,
  });

  if (!error && Array.isArray(data)) {
    return data as ContactMatch[];
  }

  const { data: fb } = await supabase
    .from("contacts")
    .select("id, full_name, company_name, account_id")
    .ilike("full_name", `%${q}%`)
    .limit(limit);
  return (fb || []).map((r: any) => ({
    id: r.id,
    full_name: r.full_name,
    company_name: r.company_name,
    account_id: r.account_id,
    score: 0,
  }));
}

// Summarize a ranked candidate list into a decision the caller can
// act on. "confident" = safe to proceed silently. "ambiguous" = pick
// top but surface the alternatives so the agent can confirm with the
// user.
export function summarizeAccountMatches(
  query: string,
  matches: AccountMatch[],
): MatchInfo<AccountMatch> {
  if (matches.length === 0) {
    return { query, top: null, candidates: [], confident: false, ambiguous: false };
  }
  const top = matches[0];
  const gap = matches[1] ? top.score - matches[1].score : 1;
  const confident = top.score >= HIGH_CONFIDENCE_SCORE && gap >= CONFIDENT_GAP;
  const ambiguous = matches.length > 1 && !confident;
  return {
    query,
    top,
    candidates: matches,
    confident,
    ambiguous,
    matched_on: top.matched_on,
  };
}

export function summarizeContactMatches(
  query: string,
  matches: ContactMatch[],
): MatchInfo<ContactMatch> {
  if (matches.length === 0) {
    return { query, top: null, candidates: [], confident: false, ambiguous: false };
  }
  const top = matches[0];
  const gap = matches[1] ? top.score - matches[1].score : 1;
  const confident = top.score >= HIGH_CONFIDENCE_SCORE && gap >= CONFIDENT_GAP;
  const ambiguous = matches.length > 1 && !confident;
  return { query, top, candidates: matches, confident, ambiguous };
}

// Convenience wrapper for the common "resolve a name to an account_id"
// flow used by every specialist agent. Returns null when nothing
// clears the threshold.
export async function resolveAccountByName(
  supabase: any,
  name: string,
  opts: { minScore?: number; limit?: number } = {},
): Promise<{ id: string; company_name: string; match_info: MatchInfo<AccountMatch> } | null> {
  const matches = await fuzzyFindAccounts(supabase, name, opts);
  const info = summarizeAccountMatches(name, matches);
  if (!info.top) return null;
  return { id: info.top.id, company_name: info.top.company_name, match_info: info };
}
