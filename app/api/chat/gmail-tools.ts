import Anthropic from '@anthropic-ai/sdk';

export const gmailTool: Anthropic.Tool = {
  name: 'search_gmail',
  description: 'Search the users connected Gmail inbox. Use Gmail search syntax (from:, to:, subject:, has:attachment, newer_than:, etc). Only available if user has connected Gmail.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: { type: 'string', description: 'Gmail search query (e.g. "from:daniel subject:nanopass")' },
      maxResults: { type: 'number', description: 'Max emails to return (default 5)' },
    },
    required: ['query'],
  },
};

export async function searchGmail(
  query: string,
  accessToken: string,
  maxResults: number = 5
): Promise<string> {
  try {
    const searchRes = await fetch(
      `https://www.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!searchRes.ok) {
      return JSON.stringify({ error: 'Gmail search failed. User may need to reconnect their Gmail.' });
    }
    const searchData = await searchRes.json();
    if (!searchData.messages || searchData.messages.length === 0) {
      return JSON.stringify({ emails: [], message: 'No emails found matching that query.' });
    }
    const emails = await Promise.all(
      searchData.messages.map(async (msg: any) => {
        const msgRes = await fetch(
          `https://www.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) return null;
        const msgData = await msgRes.json();
        const headers = msgData.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
        let body = '';
        const parts = msgData.payload?.parts || [];
        if (parts.length > 0) {
          const textPart = parts.find((p: any) => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          }
        } else if (msgData.payload?.body?.data) {
          body = Buffer.from(msgData.payload.body.data, 'base64').toString('utf-8');
        }
        return {
          from: getHeader('From'),
          to: getHeader('To'),
          subject: getHeader('Subject'),
          date: getHeader('Date'),
          snippet: msgData.snippet,
          body: body.slice(0, 1000),
        };
      })
    );
    return JSON.stringify({ emails: emails.filter(Boolean) });
  } catch (err: any) {
    return JSON.stringify({ error: `Gmail search error: ${err.message}` });
  }
}

export async function executeGmailTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  accessToken?: string
): Promise<string | null> {
  if (toolName !== 'search_gmail') return null;
  if (!accessToken) {
    return JSON.stringify({ error: 'Gmail not connected. User needs to click + and connect Gmail first.' });
  }
  return searchGmail(
    toolInput.query as string,
    accessToken,
    (toolInput.maxResults as number) || 5
  );
}
