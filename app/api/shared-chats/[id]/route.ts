export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';
import {
  sanitizeMessages,
  shareUrlFor,
  SharedChatPublic,
  SharedChatRow,
} from '../../../../lib/sharedChats';

function originFromRequest(req: NextRequest): string {
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

// PATCH /api/shared-chats/:id
// Body: { require_auth?, include_context?, messages?, title? }
// Owner-only update of a single share. We deliberately allow the
// `messages` snapshot to be refreshed here so the client can keep
// the shared view in sync with the latest chat state without having
// to revoke + recreate.
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('shared_chats')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('shared-chats PATCH lookup', lookupError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (existing.owner_email !== email) {
    // Don't leak existence to non-owners.
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.require_auth === 'boolean') update.require_auth = body.require_auth;
  if (typeof body.include_context === 'boolean')
    update.include_context = body.include_context;
  if (typeof body.title === 'string') update.title = body.title.trim().slice(0, 200);
  if (Array.isArray(body.messages)) {
    const messages = sanitizeMessages(body.messages);
    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Cannot share an empty chat' },
        { status: 400 }
      );
    }
    update.messages = messages;
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from('shared_chats')
    .update(update)
    .eq('id', id)
    .select('*')
    .single();

  if (updateError || !updated) {
    console.error('shared-chats PATCH update', updateError);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }

  const origin = originFromRequest(req);
  const view_count = await viewCountForToken(updated.token);
  return NextResponse.json({
    share: toPublic(updated as SharedChatRow, origin, view_count),
  });
}

// DELETE /api/shared-chats/:id
// Soft-delete by setting revoked_at. The shared view will then render
// the friendly "no longer available" page instead of returning 404,
// which is friendlier for a teammate clicking an old link.
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await ctx.params;
  if (!id) {
    return NextResponse.json({ error: 'id required' }, { status: 400 });
  }

  const { data: existing, error: lookupError } = await supabaseAdmin
    .from('shared_chats')
    .select('id, owner_email')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('shared-chats DELETE lookup', lookupError);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }
  if (!existing || existing.owner_email !== email) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error: revokeError } = await supabaseAdmin
    .from('shared_chats')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id);

  if (revokeError) {
    console.error('shared-chats DELETE revoke', revokeError);
    return NextResponse.json({ error: 'Revoke failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
