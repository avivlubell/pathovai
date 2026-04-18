export const runtime = 'nodejs';
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { supabaseAdmin, ATTACHMENTS_BUCKET } from '../../../../lib/supabaseAdmin';
import { extractText } from '../../../../lib/extractText';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB
const ACCEPTED_EXT = [
  '.pdf',
  '.docx',
  '.txt',
  '.md',
  '.markdown',
  '.jpg',
  '.jpeg',
  '.png',
];

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'file';
}

export async function POST(req: Request) {
  const form = await req.formData();
  const chat_id = (form.get('chat_id') as string | null) ?? '';
  const user_id = (form.get('user_id') as string | null) ?? null;
  const file = form.get('file') as File | null;

  if (!chat_id) {
    return NextResponse.json({ error: 'chat_id is required' }, { status: 400 });
  }
  if (!file || typeof file.arrayBuffer !== 'function') {
    return NextResponse.json({ error: 'file is required' }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_BYTES / (1024 * 1024)}MB)` },
      { status: 413 }
    );
  }

  const lowerName = file.name.toLowerCase();
  if (!ACCEPTED_EXT.some((ext) => lowerName.endsWith(ext))) {
    return NextResponse.json(
      { error: 'Unsupported file type' },
      { status: 415 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const safeName = sanitizeFileName(file.name);
  const storage_path = `${chat_id}/${Date.now()}_${safeName}`;

  const upload = await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .upload(storage_path, buffer, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });

  if (upload.error) {
    console.error('storage upload', upload.error);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 }
    );
  }

  const extracted = await extractText(buffer, file.type || '', file.name);

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('chat_attachments')
    .insert({
      chat_id,
      user_id,
      file_name: file.name,
      file_size: file.size,
      mime_type: file.type || null,
      storage_path,
      extracted_text: extracted,
    })
    .select('id, file_name, file_size, mime_type, created_at')
    .single();

  if (insertErr || !inserted) {
    console.error('chat_attachments insert', insertErr);
    await supabaseAdmin.storage
      .from(ATTACHMENTS_BUCKET)
      .remove([storage_path]);
    return NextResponse.json(
      { error: 'Failed to save attachment' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    attachment: {
      id: inserted.id,
      file_name: inserted.file_name,
      file_size: inserted.file_size,
      mime_type: inserted.mime_type,
      has_text: Boolean(extracted),
      created_at: inserted.created_at,
    },
  });
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const { data: row, error: selErr } = await supabaseAdmin
    .from('chat_attachments')
    .select('storage_path')
    .eq('id', id)
    .maybeSingle();

  if (selErr) {
    console.error('chat_attachments select', selErr);
    return NextResponse.json(
      { error: 'Failed to find attachment' },
      { status: 500 }
    );
  }
  if (!row) return NextResponse.json({ ok: true });

  await supabaseAdmin.storage
    .from(ATTACHMENTS_BUCKET)
    .remove([row.storage_path]);

  const { error: delErr } = await supabaseAdmin
    .from('chat_attachments')
    .delete()
    .eq('id', id);

  if (delErr) {
    console.error('chat_attachments delete', delErr);
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
