export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

type MessageRow = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: unknown;
};

type ChatRow = {
  id: string;
  user_email: string;
  title: string | null;
  messages: MessageRow[];
  created_at: string;
  updated_at: string;
};

function sanitizeMessages(value: unknown): MessageRow[] {
  if (!Array.isArray(value)) return [];
  const out: MessageRow[] = [];
  for (const m of value) {
    if (!m || typeof m !== 'object') continue;
    const role = (m as any).role;
    const content = (m as any).content;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof content !== 'string') continue;
    out.push({
      id: typeof (m as any).id === 'string' ? (m as any).id : crypto.randomUUID(),
      role,
      content,
      sources: (m as any).sources,
    });
  }
  return out;
}

// GET /api/chats  -> list of the user's chats, newest first
export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('user_email', email)
    .order('updated_at', { ascending: false });

  if (error) {
    console.error('chats GET', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  const chats = (data as ChatRow[] | null)?.map((row) => ({
    id: row.id,
    title: row.title ?? '',
    messages: row.messages ?? [],
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  })) ?? [];

  return NextResponse.json({ chats });
}

// POST /api/chats  -> upsert a single chat (called after each turn)
// Body: { id, title?, messages }
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = typeof body?.id === 'string' && body.id.trim() ? body.id.trim() : null;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const messages = sanitizeMessages(body?.messages);
  const title =
    typeof body?.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : null;

  const { error } = await supabaseAdmin
    .from('chats')
    .upsert(
      {
        id,
        user_email: email,
        title,
        messages,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

  if (error) {
    console.error('chats POST', error);
    return NextResponse.json({ error: 'Save failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/chats  -> wipe all chats for the current user
export async function DELETE() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { error } = await supabaseAdmin
    .from('chats')
    .delete()
    .eq('user_email', email);

  if (error) {
    console.error('chats DELETE', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
