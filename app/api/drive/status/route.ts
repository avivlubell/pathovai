import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';

// Probes the Drive API with the current session token to confirm the
// user actually granted the drive.readonly scope. Sessions minted before
// the Drive scope was added will still have an accessToken, but the
// scope will be missing so Drive calls return 403.
export async function GET() {
  const session = await getServerSession(authOptions).catch(() => null);
  const accessToken =
    typeof (session as any)?.accessToken === 'string'
      ? ((session as any).accessToken as string)
      : undefined;

  if (!accessToken) {
    return NextResponse.json({ connected: false, reason: 'no_session' });
  }

  try {
    const res = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({
        connected: true,
        emailAddress: data?.user?.emailAddress ?? null,
      });
    }
    return NextResponse.json({
      connected: false,
      reason: res.status === 403 ? 'scope_missing' : 'probe_failed',
      status: res.status,
    });
  } catch (err: any) {
    return NextResponse.json({
      connected: false,
      reason: 'network_error',
      details: err?.message,
    });
  }
}
