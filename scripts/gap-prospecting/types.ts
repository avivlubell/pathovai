export type RoleFamily =
  | 'clinical'
  | 'commercial'
  | 'market_access'
  | 'operations'
  | 'finance'
  | 'it'
  | 'executive';

export type Seniority = 'ic' | 'manager' | 'director' | 'vp' | 'c_suite';

export type Channel = 'email' | 'linkedin' | 'phone';

export type Confidence = 'low' | 'medium' | 'high';

export interface Prospect {
  account: { name: string; url?: string; segment: string; size?: string };
  persona: { title: string; role_family: RoleFamily; seniority: Seniority };
  research_signals: { claim: string; source: string; date: string }[];
  channel: Channel;
  sender: { name: string; title: string; company: string };
}

export interface PIC {
  account: Prospect['account'];
  persona: Prospect['persona'];
  evidence: { id: string; claim: string; source: string; date: string }[];
  problem_diagnosis: {
    symptoms: string[];
    likely_root_cause: string;
    cost_of_inaction: string;
    why_now: string;
  };
  hypothesis: { gap: string; desired_outcome: string };
  qualification: {
    icp_fit_score: number;
    readiness_signals: string[];
    disqualifiers: string[];
  };
  confidence: Confidence;
}

export interface Outreach {
  channel: Channel;
  subject: string | null;
  body: string;
  cta: string;
  references: { pic_section: 'problem_diagnosis' | 'hypothesis' | 'qualification'; evidence_id: string }[];
  sender?: { name?: string; title?: string; company?: string };
}

export interface QAResult {
  score: number;
  passed: boolean;
  checks: {
    diagnosis_stated: boolean;
    evidence_cited: boolean;
    no_banned_phrases: boolean;
    cta_specific: boolean;
    persona_appropriate: boolean;
    channel_constraints: boolean;
  };
  banned_phrases_found: string[];
  suggestions: { check: string; fix: string }[];
}

export type Stage = 'pic' | 'outreach' | 'qa';
