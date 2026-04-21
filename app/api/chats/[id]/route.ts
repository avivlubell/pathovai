export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { supabaseAdmin } from '../../../../lib/supabaseAdmin';

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/chats/:id  -> rename (or any partial update)
// Body: { title }
export async function PATCH(req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const title =
    typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : null;
  if (title === null) {
    return NextResponse.json({ error: 'title required' }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from('chats')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('user_email', email);

  if (error) {
    console.error('chats PATCH', error);
    return NextResponse.json({ error: 'Update failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// DELETE /api/chats/:id
export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await ctx.params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const { error } = await supabaseAdmin
    .from('chats')
    .delete()
    .eq('id', id)
    .eq('user_email', email);

  if (error) {
    console.error('chats DELETE :id', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
