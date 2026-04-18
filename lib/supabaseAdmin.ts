import { createClient } from '@supabase/supabase-js';

// Service-role client. Server-only -- never import this from a
// `'use client'` component or expose the key in browser bundles.
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

export const ATTACHMENTS_BUCKET = 'chat-attachments';
