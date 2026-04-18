import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

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

    const { error } = await supabase
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
