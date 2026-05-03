import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Lazy init — createClient('') throws "supabaseUrl is required", which crashed
// the build on Vercel projects that don't have NEXT_PUBLIC_SUPABASE_URL set
// (page-data collection evaluates the module). Defer to request time so build
// works regardless of env presence and we still surface a clear runtime error.
let _supabase: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      'feedback route: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set',
    );
  }
  _supabase = createClient(url, key);
  return _supabase;
}

type FeedbackBody = {
  message_id?: unknown;
  chat_id?: unknown;
  user_id?: unknown;
  rating?: unknown;
  reason?: unknown;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as FeedbackBody;
    const message_id = typeof body.message_id === 'string' ? body.message_id : '';
    const chat_id =
      typeof body.chat_id === 'string' && body.chat_id ? body.chat_id : null;
    const user_id =
      typeof body.user_id === 'string' && body.user_id ? body.user_id : 'anonymous';
    const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim().slice(0, 2000)
        : null;

    if (!message_id || !rating) {
      return NextResponse.json(
        { error: 'message_id and rating are required' },
        { status: 400 }
      );
    }

    const { error } = await getSupabase()
      .from('message_feedback')
      .upsert(
        { message_id, chat_id, user_id, rating, reason },
        { onConflict: 'user_id,message_id' }
      );

    if (error) {
      console.error('feedback insert failed', error);
      return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('feedback error', err);
    return NextResponse.json({ error: 'Failed to save feedback' }, { status: 500 });
  }
}
