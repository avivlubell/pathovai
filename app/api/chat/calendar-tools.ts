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
  {
    name: 'create_calendar_event',
    description:
      'Create a Google Calendar event with a Google Meet link and send invites to attendees. Use when the user wants to schedule a call or meeting with a prospect or contact. Always confirm the details with the user before calling this tool. Returns the event link and Meet URL.',
    input_schema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description: 'Event title (e.g. "Intro call — Pathovai x Riverbend Heart")',
        },
        startDateTime: {
          type: 'string',
          description: 'Start time as ISO 8601 with UTC offset (e.g. "2026-05-10T10:00:00-05:00")',
        },
        endDateTime: {
          type: 'string',
          description: 'End time as ISO 8601 with UTC offset (e.g. "2026-05-10T10:30:00-05:00")',
        },
        timeZone: {
          type: 'string',
          description: 'IANA timezone name (e.g. "America/New_York", "America/Chicago"). Required.',
        },
        attendeeEmails: {
          type: 'array',
          items: { type: 'string' },
          description: 'Email addresses of attendees to invite (include the prospect and any internal team members)',
        },
        description: {
          type: 'string',
          description: 'Optional agenda or notes to include in the invite body',
        },
      },
      required: ['summary', 'startDateTime', 'endDateTime', 'timeZone', 'attendeeEmails'],
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

async function createCalendarEvent(
  accessToken: string,
  summary: string,
  startDateTime: string,
  endDateTime: string,
  timeZone: string,
  attendeeEmails: string[],
  description: string | undefined
): Promise<string> {
  try {
    const requestId = `pathovai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const body: Record<string, unknown> = {
      summary,
      start: { dateTime: startDateTime, timeZone },
      end: { dateTime: endDateTime, timeZone },
      attendees: attendeeEmails.map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      },
    };
    if (description) body.description = description;

    const res = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const errText = await res.text();
      return JSON.stringify({
        error: `Calendar create failed (${res.status}). User may need to sign out and reconnect Google to grant Calendar access.`,
        details: errText.slice(0, 300),
      });
    }
    const event = await res.json();
    const meetLink = (event.conferenceData?.entryPoints || []).find(
      (ep: any) => ep.entryPointType === 'video'
    )?.uri;
    return JSON.stringify({
      success: true,
      eventId: event.id,
      summary: event.summary,
      start: event.start?.dateTime,
      end: event.end?.dateTime,
      attendees: (event.attendees || []).map((a: any) => a.email),
      meetLink: meetLink || null,
      htmlLink: event.htmlLink,
    });
  } catch (err: any) {
    return JSON.stringify({ error: `Calendar create error: ${err.message}` });
  }
}

const CALENDAR_TOOL_NAMES = new Set(['list_calendar_events', 'create_calendar_event']);

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
    case 'create_calendar_event':
      return createCalendarEvent(
        accessToken,
        toolInput.summary as string,
        toolInput.startDateTime as string,
        toolInput.endDateTime as string,
        toolInput.timeZone as string,
        toolInput.attendeeEmails as string[],
        toolInput.description as string | undefined
      );
    default:
      return null;
  }
}
