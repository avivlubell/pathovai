export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { generateShareToken } from '../../../lib/shareToken';
import {
  sanitizeMessages,
  shareUrlFor,
  SharedChatPublic,
  SharedChatRow,
} from '../../../lib/sharedChats';

function originFromRequest(req: NextRequest): string {
  // Trust the forwarded host first (Vercel sets it), then x-forwarded-proto.
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  if (host) return `${proto}://${host}`;
  return new URL(req.url).origin;
}

async function viewCountForToken(token: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from('shared_chat_views')
    .select('id', { count: 'exact', head: true })
    .eq('token', token);
  return count ?? 0;
}

function toPublic(row: SharedChatRow, origin: string, view_count: number): SharedChatPublic {
  return {
    id: row.id,
    token: row.token,
    url: shareUrlFor(row.token, origin),
    title: row.title,
    owner_display_name: row.owner_display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    revoked_at: row.revoked_at,
    require_auth: row.require_auth,
    include_context: row.include_context,
    view_count,
  };
}

// GET /api/shared-chats?chat_id=...
// Returns the (single) active share for this chat owned by the current
// user, or null if none exists. Used by the share modal to load state
// when it opens.
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const chatId = req.nextUrl.searchParams.get('chat_id');
  if (!chatId) {
    return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('shared_chats')
    .select('*')
    .eq('owner_email', email)
    .eq('chat_id', chatId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('shared-chats GET', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  if (!data) return NextResponse.json({ share: null });

  const origin = originFromRequest(req);
  const view_count = await viewCountForToken(data.token);
  return NextResponse.json({ share: toPublic(data as SharedChatRow, origin, view_count) });
}

// POST /api/shared-chats
// Body: { chat_id, title?, messages, require_auth?, include_context? }
// Creates a new share row with a fresh token, or returns the existing
// non-revoked share for this (owner, chat_id) -- we don't want a chat
// to fragment into multiple competing share links.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  const displayName = session?.user?.name || null;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const chatId = typeof body.chat_id === 'string' ? body.chat_id.trim() : '';
  if (!chatId) {
    return NextResponse.json({ error: 'chat_id required' }, { status: 400 });
  }

  const messages = sanitizeMessages(body.messages);
  if (messages.length === 0) {
    return NextResponse.json(
      { error: 'Cannot share an empty chat' },
      { status: 400 }
    );
  }

  const title =
    typeof body.title === 'string' && body.title.trim()
      ? body.title.trim().slice(0, 200)
      : messages[0]?.content?.slice(0, 80) || 'Shared chat';

  const requireAuth = body.require_auth === undefined ? true : !!body.require_auth;
  const includeContext = !!body.include_context;

  // Reuse an existing live share for this chat if there is one. Avoids
  // a sales rep accidentally generating multiple links by clicking
  // Share twice.
  const { data: existing } = await supabaseAdmin
    .from('shared_chats')
    .select('*')
    .eq('owner_email', email)
    .eq('chat_id', chatId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const origin = originFromRequest(req);

  if (existing) {
    // Refresh the snapshot + settings so the live link matches the
    // current chat state.
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('shared_chats')
      .update({
        title,
        messages,
        require_auth: requireAuth,
        include_context: includeContext,
        owner_display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (updateError || !updated) {
      console.error('shared-chats POST update', updateError);
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }
    const view_count = await viewCountForToken(updated.token);
    return NextResponse.json({
      share: toPublic(updated as SharedChatRow, origin, view_count),
    });
  }

  const token = generateShareToken();
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('shared_chats')
    .insert({
      chat_id: chatId,
      owner_email: email,
      owner_display_name: displayName,
      token,
      title,
      messages,
      require_auth: requireAuth,
      include_context: includeContext,
    })
    .select('*')
    .single();

  if (insertError || !inserted) {
    console.error('shared-chats POST insert', insertError);
    return NextResponse.json({ error: 'Create failed' }, { status: 500 });
  }

  return NextResponse.json({
    share: toPublic(inserted as SharedChatRow, origin, 0),
  });
}
