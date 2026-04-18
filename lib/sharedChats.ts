// Shared types for the share-chat feature. Mirrored on client + server
// so the API contract stays consistent and TypeScript catches drift.

export type SharedMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export type SharedChatRow = {
  id: string;
  chat_id: string;
  owner_email: string;
  owner_display_name: string | null;
  token: string;
  title: string | null;
  messages: SharedMessage[];
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  require_auth: boolean;
  include_context: boolean;
};

export type SharedChatPublic = {
  id: string;
  token: string;
  url: string;
  title: string | null;
  owner_display_name: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  require_auth: boolean;
  include_context: boolean;
  view_count: number;
};

export function shareUrlFor(token: string, origin: string): string {
  return `${origin.replace(/\/$/, '')}/shared/${token}`;
}

export function isValidMessage(m: unknown): m is SharedMessage {
  if (!m || typeof m !== 'object') return false;
  const r = m as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    (r.role === 'user' || r.role === 'assistant') &&
    typeof r.content === 'string'
  );
}

export function sanitizeMessages(input: unknown): SharedMessage[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isValidMessage);
}
