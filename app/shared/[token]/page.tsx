import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { hashIp } from '../../../lib/shareToken';
import type { SharedChatRow } from '../../../lib/sharedChats';
import SharedChatView from './SharedChatView';

// Stale renders would let revoked links continue to display, so we
// always render this route at request time.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { token: string };

function clientIpFromHeaders(h: Headers): string | null {
  const xff = h.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return h.get('x-real-ip');
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await params;
  const { data } = await supabaseAdmin
    .from('shared_chats')
    .select('title, owner_display_name, revoked_at')
    .eq('token', token)
    .maybeSingle();
  if (!data || data.revoked_at) {
    return { title: 'Shared chat · PathovAI', robots: { index: false, follow: false } };
  }
  const titleStr = data.title ? `${data.title} · PathovAI` : 'Shared chat · PathovAI';
  return {
    title: titleStr,
    // Don't let Google index private shared links.
    robots: { index: false, follow: false },
  };
}

export default async function SharedChatPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { token } = await params;

  if (!token || token.length < 16 || token.length > 64) {
    return <NotAvailable />;
  }

  const { data, error } = await supabaseAdmin
    .from('shared_chats')
    .select('*')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('shared page lookup', error);
    return <NotAvailable />;
  }

  if (!data) return <NotAvailable />;

  const row = data as SharedChatRow;

  if (row.revoked_at) return <NotAvailable />;

  if (row.require_auth) {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      // Send the visitor through Google OAuth and back here.
      const callbackUrl = `/shared/${token}`;
      redirect(
        `/api/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
      );
    }
  }

  // Audit log -- best-effort. Captures viewer email when known and a
  // salted IP hash otherwise, so the owner can see view counts without
  // anyone storing raw IPs.
  try {
    const h = await headers();
    const session = await getServerSession(authOptions);
    await supabaseAdmin.from('shared_chat_views').insert({
      token: row.token,
      viewer_email: session?.user?.email || null,
      ip_hash: hashIp(clientIpFromHeaders(h)),
    });
  } catch (e) {
    console.error('shared page audit log', e);
  }

  return (
    <SharedChatView
      title={row.title}
      ownerDisplayName={row.owner_display_name}
      createdAt={row.created_at}
      messages={row.messages}
    />
  );
}

function NotAvailable() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-200 px-6">
      <div className="max-w-md text-center space-y-4">
        <img
          src="/PATHOVA_LOGO1_edited_edited_edited.png"
          alt="PathovAI logo"
          className="h-12 w-12 rounded mx-auto"
        />
        <h1 className="text-xl font-semibold text-slate-100">
          This shared chat is no longer available
        </h1>
        <p className="text-sm text-slate-400">
          The owner may have stopped sharing this conversation, or the link
          may have expired. Try asking them for a new link.
        </p>
      </div>
    </main>
  );
}
