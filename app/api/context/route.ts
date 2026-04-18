export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';

type ContextBody = {
  chat_id?: unknown;
  user_id?: unknown;
  notes?: unknown;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chat_id = url.searchParams.get('chat_id');
  if (!chat_id) {
    return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  }

  const [ctxRes, attRes] = await Promise.all([
    supabaseAdmin
      .from('chat_contexts')
      .select('notes')
      .eq('chat_id', chat_id)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_attachments')
      .select('id, file_name, file_size, mime_type, created_at, extracted_text')
      .eq('chat_id', chat_id)
      .order('created_at', { ascending: true }),
  ]);

  if (ctxRes.error) {
    console.error('chat_contexts select', ctxRes.error);
    return NextResponse.json({ error: 'Failed to load context' }, { status: 500 });
  }
  if (attRes.error) {
    console.error('chat_attachments select', attRes.error);
    return NextResponse.json({ error: 'Failed to load attachments' }, { status: 500 });
  }

  const attachments = (attRes.data ?? []).map((a) => ({
    id: a.id,
    file_name: a.file_name,
    file_size: a.file_size,
    mime_type: a.mime_type,
    has_text: Boolean(a.extracted_text),
    created_at: a.created_at,
  }));

  return NextResponse.json({
    notes: ctxRes.data?.notes ?? '',
    attachments,
  });
}

export async function PUT(req: Request) {
  const body = (await req.json()) as ContextBody;
  const chat_id = typeof body.chat_id === 'string' ? body.chat_id : '';
  const user_id =
    typeof body.user_id === 'string' && body.user_id ? body.user_id : null;
  const notes = typeof body.notes === 'string' ? body.notes : '';

  if (!chat_id) {
    return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('chat_contexts')
    .upsert(
      { chat_id, user_id, notes, updated_at: new Date().toISOString() },
      { onConflict: 'chat_id' }
    );

  if (error) {
    console.error('chat_contexts upsert', error);
    return NextResponse.json({ error: 'Failed to save context' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const chat_id = url.searchParams.get('chat_id');
  if (!chat_id) {
    return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  }

  const { data: atts } = await supabaseAdmin
    .from('chat_attachments')
    .select('storage_path')
    .eq('chat_id', chat_id);

  if (atts && atts.length > 0) {
    await supabaseAdmin.storage
      .from('chat-attachments')
      .remove(atts.map((a) => a.storage_path).filter(Boolean) as string[]);
  }

  await Promise.all([
    supabaseAdmin.from('chat_attachments').delete().eq('chat_id', chat_id),
    supabaseAdmin.from('chat_contexts').delete().eq('chat_id', chat_id),
  ]);

  return NextResponse.json({ ok: true });
}
