import Anthropic from '@anthropic-ai/sdk';

export const calendarTools: Anthropic.Tool[] = [
  {
    name: 'list_calendar_events',
    description:
      'List events from the user\'s Google Calendar within a time range. Use for finding upcoming meetings, past calls with prospects, or scheduled follow-ups. Returns event title, start/end time, attendees, and description. Supports optional text search across event titles and descriptions (e.g. a company or contact name). Only available if the user has connected Google with Calendar access.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Optional text search across event titles and descriptions (e.g. "Riverbend Heart", "Daniel")',
        },
        timeMin: {
          type: 'string',
          description: 'Start of time range as ISO 8601 datetime (e.g. "2026-05-01T00:00:00Z"). Defaults to now.',
        },
        timeMax: {
          type: 'string',
          description: 'End of time range as ISO 8601 datetime (e.g. "2026-05-31T23:59:59Z"). Defaults to 30 days from now.',
        },
        maxResults: {
          type: 'number',
          description: 'Max events to return (default 20, max 50)',
        },
      },
    },
  },
];

async function listCalendarEvents(
  accessToken: string,
  query: string | undefined,
  timeMin: string | undefined,
  timeMax: string | undefined,
  maxResults: number
): Promise<string> {
  try {
    const now = new Date();
    const thirtyDaysOut = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: timeMin || now.toISOString(),
      timeMax: timeMax || thirtyDaysOut.toISOString(),
      maxResults: String(Math.min(Math.max(maxResults, 1), 50)),
      fields: 'items(id,summary,description,start,end,attendees,htmlLink,location)',
    });
    if (query && query.trim()) {
      params.set('q', query.trim());
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      const errText = await res.text();
      return JSON.stringify({
        error: `Calendar list failed (${res.status}). User may need to sign out and reconnect Google to grant Calendar access.`,
        details: errText.slice(0, 300),
      });
    }
    const data = await res.json();
    const events = (data.items || []).map((e: any) => ({
      id: e.id,
      summary: e.summary || '(No title)',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      attendees: (e.attendees || []).map((a: any) => a.email).filter(Boolean),
      description: e.description ? e.description.slice(0, 500) : undefined,
      location: e.location,
      htmlLink: e.htmlLink,
    }));
    if (events.length === 0) {
      return JSON.stringify({ events: [], message: 'No calendar events found in that time range.' });
    }
    return JSON.stringify({ events });
  } catch (err: any) {
    return JSON.stringify({ error: `Calendar list error: ${err.message}` });
  }
}

const CALENDAR_TOOL_NAMES = new Set(['list_calendar_events']);

export async function executeCalendarTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  accessToken?: string
): Promise<string | null> {
  if (!CALENDAR_TOOL_NAMES.has(toolName)) return null;
  if (!accessToken) {
    return JSON.stringify({
      error: 'Google Calendar not connected. User needs to sign out and reconnect Google to grant Calendar access.',
    });
  }
  switch (toolName) {
    case 'list_calendar_events':
      return listCalendarEvents(
        accessToken,
        toolInput.query as string | undefined,
        toolInput.timeMin as string | undefined,
        toolInput.timeMax as string | undefined,
        (toolInput.maxResults as number) || 20
      );
    default:
      return null;
  }
}
