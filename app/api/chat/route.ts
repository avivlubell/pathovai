import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const runtime = 'edge'; // if this causes issues, change to 'nodejs'

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Expecting: { messages: [{ role: 'user' | 'assistant', content: string }[] }
    const messages = body?.messages;
    if (!Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Invalid payload: messages must be an array' },
        { status: 400 }
      );
    }

    const userContent = messages
      .filter((m: any) => m.role === 'user')
      .map((m: any) => m.content)
      .join('\n\n');

    if (!userContent) {
      return NextResponse.json(
        { error: 'No user message found' },
        { status: 400 }
      );
    }

    // TEMP: simple model call; we will swap this to your project main agent call later.
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20240620', // placeholder
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    const text =
      typeof response.content?.[0]?.text === 'string'
        ? response.content[0].text
        : '';

    return NextResponse.json({ reply: text });
  } catch (err: any) {
    console.error('Claude error', err);
    return NextResponse.json(
      { error: 'Server error', details: err?.message ?? String(err) },
      { status: 500 }
    );
  }
}
