import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MEET_FOLDER_ID = '1hqVMgrmItcwEWDjCjZWZgIvA0zi5DjQ8';
const MEET_TRANSCRIPTS_FOLDER_ID =
  process.env.MEET_TRANSCRIPTS_FOLDER_ID || DEFAULT_MEET_FOLDER_ID;

const MAX_TRANSCRIPT_CHARS = 40_000;

const EXPORTABLE_MIME_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',
  'application/vnd.google-apps.spreadsheet': 'text/csv',
  'application/vnd.google-apps.presentation': 'text/plain',
};

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
  {
    name: 'search_drive',
    description:
      'Search the users entire Google Drive for files by filename OR full-text content. Use for finding documents that are NOT Meet transcripts (MOUs, contracts, decks, notes, spreadsheets, etc.). Returns up to 50 files with id, name, mimeType, timestamps, webViewLink, and owner email. Follow up with `get_drive_file` to read a specific files body. Broad scope -- can match any file the user has access to.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search term matched against filename OR full-text body (e.g. "MOU Tribun", "pricing deck", "Acme contract")',
        },
        maxResults: {
          type: 'number',
          description: 'Max files to return (default 20, max 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_drive_file',
    description:
      'Fetch the content of any Drive file by fileId. Supports Google Docs (exported as plain text), Sheets (as CSV), Slides (as plain text), and plain text files. Returns text truncated to ~40k chars with metadata. For PDFs or binary files, returns an error with a webViewLink -- the user should upload those via the file upload flow instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        fileId: {
          type: 'string',
          description: 'Drive file ID (obtained from `search_drive` or a direct Drive link)',
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

async function searchDrive(
  accessToken: string,
  query: string,
  maxResults: number
): Promise<string> {
  if (!query || !query.trim()) {
    return JSON.stringify({ error: 'query is required' });
  }
  try {
    const safe = query.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = `(name contains '${safe}' or fullText contains '${safe}') and trashed = false`;
    const params = new URLSearchParams({
      q,
      fields: 'files(id,name,mimeType,createdTime,modifiedTime,webViewLink,owners(emailAddress))',
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
        error: `Drive search failed (${res.status}). User may need to sign out and reconnect Google to grant Drive access.`,
        details: errText.slice(0, 300),
      });
    }
    const data = await res.json();
    const files = (data.files || []).map((f: any) => ({
      fileId: f.id,
      name: f.name,
      mimeType: f.mimeType,
      createdTime: f.createdTime,
      modifiedTime: f.modifiedTime,
      webViewLink: f.webViewLink,
      owner: f.owners?.[0]?.emailAddress ?? null,
    }));
    if (files.length === 0) {
      return JSON.stringify({
        files: [],
        message: 'No Drive files found matching that query.',
      });
    }
    return JSON.stringify({ files });
  } catch (err: any) {
    return JSON.stringify({ error: `Drive search error: ${err.message}` });
  }
}

async function getDriveFile(
  accessToken: string,
  fileId: string
): Promise<string> {
  if (!fileId) {
    return JSON.stringify({ error: 'fileId is required' });
  }
  try {
    const metaRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,createdTime,modifiedTime,webViewLink`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!metaRes.ok) {
      const errText = await metaRes.text();
      return JSON.stringify({
        error: `Drive file metadata fetch failed (${metaRes.status})`,
        details: errText.slice(0, 300),
      });
    }
    const meta = await metaRes.json();
    const mimeType = meta.mimeType as string;
    const exportMime = EXPORTABLE_MIME_TYPES[mimeType];

    let text = '';
    let truncated = false;

    if (exportMime) {
      const exportRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent(exportMime)}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!exportRes.ok) {
        const errText = await exportRes.text();
        return JSON.stringify({
          error: `Drive export failed (${exportRes.status})`,
          details: errText.slice(0, 300),
          name: meta.name,
          mimeType,
        });
      }
      text = await exportRes.text();
    } else if (mimeType?.startsWith('text/')) {
      const downloadRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!downloadRes.ok) {
        const errText = await downloadRes.text();
        return JSON.stringify({
          error: `Drive download failed (${downloadRes.status})`,
          details: errText.slice(0, 300),
          name: meta.name,
          mimeType,
        });
      }
      text = await downloadRes.text();
    } else {
      return JSON.stringify({
        error: `Unsupported mime type: ${mimeType}. This tool supports Google Docs, Sheets, Slides, and plain text files. For PDFs or binary files, ask the user to upload the file via the + button so process_document can extract it.`,
        name: meta.name,
        mimeType,
        webViewLink: meta.webViewLink,
      });
    }

    truncated = text.length > MAX_TRANSCRIPT_CHARS;
    return JSON.stringify({
      fileId,
      name: meta.name,
      mimeType,
      createdTime: meta.createdTime,
      modifiedTime: meta.modifiedTime,
      webViewLink: meta.webViewLink,
      truncated,
      text: truncated ? text.slice(0, MAX_TRANSCRIPT_CHARS) : text,
    });
  } catch (err: any) {
    return JSON.stringify({ error: `Drive get error: ${err.message}` });
  }
}

const DRIVE_TOOL_NAMES = new Set([
  'list_meet_transcripts',
  'get_meet_transcript',
  'search_drive',
  'get_drive_file',
]);

export async function executeDriveTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  accessToken?: string
): Promise<string | null> {
  if (!DRIVE_TOOL_NAMES.has(toolName)) {
    return null;
  }
  if (!accessToken) {
    return JSON.stringify({
      error: 'Google Drive not connected. User needs to sign out and reconnect Google to grant Drive access.',
    });
  }
  switch (toolName) {
    case 'list_meet_transcripts':
      return listMeetTranscripts(
        accessToken,
        toolInput.query as string | undefined,
        (toolInput.maxResults as number) || 20
      );
    case 'get_meet_transcript':
      return getMeetTranscript(accessToken, toolInput.fileId as string);
    case 'search_drive':
      return searchDrive(
        accessToken,
        toolInput.query as string,
        (toolInput.maxResults as number) || 20
      );
    case 'get_drive_file':
      return getDriveFile(accessToken, toolInput.fileId as string);
    default:
      return null;
  }
}
