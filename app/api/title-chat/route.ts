import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const TITLE_SYSTEM_PROMPT =
  'Generate a 3-5 word title for this sales conversation. If a specific company/account is mentioned, lead with the account name. No quotes, no punctuation.';

export async function POST(req: Request) {
  try {
    const { user, assistant } = await req.json();
    if (typeof user !== 'string' || typeof assistant !== 'string' || !user.trim() || !assistant.trim()) {
      return NextResponse.json({ error: 'Missing user or assistant content' }, { status: 400 });
    }

    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      system: TITLE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User: ${user.slice(0, 2000)}\n\nAssistant: ${assistant.slice(0, 2000)}`,
        },
      ],
    });

    const textBlock = resp.content.find((b) => b.type === 'text');
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '';
    const title = raw.trim().replace(/^["'`]+|["'`.!?]+$/g, '').trim();

    if (!title) return NextResponse.json({ title: null });
    return NextResponse.json({ title });
  } catch (err) {
    console.error('title-chat error', err);
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 });
  }
}
