export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../lib/authOptions';
import { supabaseAdmin } from '../../../../../lib/supabaseAdmin';
import { hashIp } from '../../../../../lib/shareToken';
import { rateLimit, sweepRateLimitBuckets } from '../../../../../lib/rateLimit';
import type { SharedChatRow } from '../../../../../lib/sharedChats';

// GET /api/shared-chats/by-token/:token
// Public resolver. Performs three checks before returning content:
//   1. Token exists.
//   2. Not revoked. (revoked_at is null)
//   3. Auth gate satisfied. If require_auth is true, the caller must
//      have a NextAuth session -- any authenticated PathovAI user
//      qualifies (we don't have a workspace concept yet).
//
// Rate-limited per IP to deter brute-force enumeration of the 22-char
// token space. We never reveal whether a token "exists but is gated"
// vs "doesn't exist" to unauthenticated callers -- both return the
// same 401 -- so an attacker can't use the response to confirm a
// token's existence.

const RATE_LIMIT_PER_MIN = 30;

function clientIp(req: NextRequest): string | null {
  // Vercel populates x-forwarded-for; fall back to x-real-ip.
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip');
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ token: string }> }
) {
  sweepRateLimitBuckets();
  const ip = clientIp(req);
  const limit = rateLimit(`share-resolve:${ip || 'anon'}`, RATE_LIMIT_PER_MIN, 60);
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      {
        status: 429,
        headers: { 'Retry-After': String(limit.retryAfterSeconds) },
      }
    );
  }

  const { token } = await ctx.params;
  if (!token || token.length < 16 || token.length > 64) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data, error } = await supabaseAdmin
    .from('shared_chats')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('shared-chats by-token GET', error);
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const row = data as SharedChatRow;

  if (row.revoked_at) {
    return NextResponse.json(
      {
        error: 'Revoked',
        revoked: true,
      },
      { status: 410 } // Gone -- the resource is intentionally unavailable.
    );
  }

  const session = row.require_auth ? await getServerSession(authOptions) : null;
  const viewerEmail = session?.user?.email || null;

  if (row.require_auth && !viewerEmail) {
    return NextResponse.json(
      {
        error: 'Sign-in required',
        require_auth: true,
      },
      { status: 401 }
    );
  }

  // Audit log. Best-effort -- if it fails we still serve the view.
  try {
    await supabaseAdmin.from('shared_chat_views').insert({
      token: row.token,
      viewer_email: viewerEmail,
      ip_hash: hashIp(ip),
    });
  } catch (e) {
    console.error('shared-chats audit log', e);
  }

  // Strip PII: never return owner_email, only display name. Don't
  // return the database id either -- the public token is the only
  // identifier the viewer needs.
  return NextResponse.json({
    title: row.title,
    owner_display_name: row.owner_display_name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    require_auth: row.require_auth,
    include_context: row.include_context,
    messages: row.messages,
  });
}
