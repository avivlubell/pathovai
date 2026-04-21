import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MEET_FOLDER_ID = '1hqVMgrmItcwEWDjCjZWZgIvA0zi5DjQ8';
const MEET_TRANSCRIPTS_FOLDER_ID =
  process.env.MEET_TRANSCRIPTS_FOLDER_ID || DEFAULT_MEET_FOLDER_ID;

const MAX_TRANSCRIPT_CHARS = 40_000;

export const driveTools: Anthropic.Tool[] = [
  {
    name: 'list_meet_transcripts',
    description:
      'List Google Meet transcripts (Google Docs) from the users Meet Recordings Drive folder, most recent first. Returns fileId, name, createdTime, modifiedTime, webViewLink. Optional `query` filters by filename substring (e.g. a company or attendee name). Follow up with `get_meet_transcript` to read a specific transcripts body. Only available if the user has connected Google with Drive access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional filename substring filter (case-insensitive on Drive side)',
        },
        maxResults: {
          type: 'number',
          description: 'Max transcripts to return (default 20, max 50)',
        },
      },
    },
  },
  {
    name: 'get_meet_transcript',
    description:
      'Fetch the full plain-text body of a specific Google Meet transcript Doc from Drive. Input: `fileId` (obtained from `list_meet_transcripts`). Returns transcript text truncated to ~40k chars plus file metadata.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileId: {
          type: 'string',
          description: 'Drive file ID of the transcript Google Doc',
        },
      },
      required: ['fileId'],
    },
  },
];

async function listMeetTranscripts(
  accessToken: string,
  query: string | undefined,
  maxResults: number
): Promise<string> {
  try {
    const clauses = [
      `'${MEET_TRANSCRIPTS_FOLDER_ID}' in parents`,
      `mimeType = 'application/vnd.google-apps.document'`,
      `trashed = false`,
    ];
    if (query && query.trim()) {
      const safe = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      clauses.push(`name contains '${safe}'`);
    }
    const params = new URLSearchParams({
      q: clauses.join(' and '),
      fields: 'files(id,name,createdTime,modifiedTime,webViewLink)',
      pageSize: String(Math.min(Math.max(maxResults, 1), 50)),
      orderBy: 'modifiedTime desc',
    });
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return JSON.stringify({
        error: `Drive list failed (${res.status}). User may need to sign out and reconnect Google to grant Drive access.`,
        details: errText.slice(0, 300),
      });
    }
    const data = await res.json();
    const files = (data.files || []).map((f: any) => ({
      fileId: f.id,
      name: f.name,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
    }));
    if (files.length === 0) {
      return JSON.stringify({
        transcripts: [],
        message: 'No transcripts found in the Meet Recordings folder matching that filter.',
      });
    }
    return JSON.stringify({ transcripts: files });
  } catch (err: any) {
    return JSON.stringify({ error: `Drive list error: ${err.message}` });
  }
}

async function getMeetTranscript(
  accessToken: string,
  fileId: string
): Promise<string> {
  if (!fileId) {
    return JSON.stringify({ error: 'fileId is required' });
  }
  try {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,createdTime,modifiedTime,webViewLink,mimeType`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const meta = metaRes.ok ? await metaRes.json() : null;

    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!exportRes.ok) {
      const errText = await exportRes.text();
      return JSON.stringify({
        error: `Drive export failed (${exportRes.status}). The file may not be a Google Doc, or the user may need to reconnect Google with Drive access.`,
        details: errText.slice(0, 300),
      });
    }
    const text = await exportRes.text();
    const truncated = text.length > MAX_TRANSCRIPT_CHARS;
    return JSON.stringify({
      fileId,
      name: meta?.name,
      createdTime: meta?.createdTime,
      modifiedTime: meta?.modifiedTime,
      webViewLink: meta?.webViewLink,
      truncated,
      text: truncated ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text,
    });
  } catch (err: any) {
    return JSON.stringify({ error: `Drive get error: ${err.message}` });
  }
}

export async function executeDriveTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  accessToken?: string
): Promise<string | null> {
  if (toolName !== 'list_meet_transcripts' && toolName !== 'get_meet_transcript') {
    return null;
  }
  if (!accessToken) {
    return JSON.stringify({
      error: 'Google Drive not connected. User needs to sign out and reconnect Google to grant Drive access.',
    });
  }
  if (toolName === 'list_meet_transcripts') {
    return listMeetTranscripts(
      accessToken,
      toolInput.query as string | undefined,
      (toolInput.maxResults as number) || 20
    );
  }
  return getMeetTranscript(accessToken, toolInput.fileId as string);
}
