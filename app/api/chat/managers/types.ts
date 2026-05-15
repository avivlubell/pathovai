import type Anthropic from '@anthropic-ai/sdk';

export type ManagerType = 'research' | 'crm' | 'qualification' | 'outreach' | 'kb';

export interface TaskPacket {
  task: string;
  company_name?: string;
  user_intent: string;
  established_facts?: string[];
  focus_areas?: string[];
}

export interface ManagerConfig {
  systemPrompt: string;
  tools: Anthropic.Tool[];
  maxRounds?: number;
}
