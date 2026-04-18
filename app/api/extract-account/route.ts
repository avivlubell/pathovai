import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const EXTRACT_SYSTEM_PROMPT = `You identify the primary account (company/prospect) the rep is working on in a sales conversation. Output ONLY JSON: {"account": "<name>"} or {"account": null}.

Rules:
- Return the company/organization name the conversation is primarily about, not a person.
- If the rep is talking about multiple accounts or the conversation is generic, return null.
- Do not invent an account; only return one that is explicitly mentioned or clearly implied.
- Normalize the name (e.g., "AMPA" -> "AMPA Health" if "AMPA Health" was named earlier; strip trailing punctuation).
- No prose, no markdown, no code fences. JSON only.`;

export async function POST(req: Request) {
  try {
    const { user, assistant, current } = await req.json();
    if (typeof user !== 'string' || !user.trim()) {
      return NextResponse.json({ error: 'user is required' }, { status: 400 });
    }

    const assistantText =
      typeof assistant === 'string' ? assistant.slice(0, 2000) : '';
    const currentLine =
      typeof current === 'string' && current.trim()
        ? `\n\nCurrent active account: ${current.trim()}`
        : '';

    const resp = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: EXTRACT_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `User turn: ${user.slice(0, 2000)}\n\nAssistant turn: ${assistantText}${currentLine}`,
        },
      ],
    });

    const textBlock = resp.content.find((b) => b.type === 'text');
    const raw = textBlock && textBlock.type === 'text' ? textBlock.text : '';

    let account: string | null = null;
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (typeof parsed.account === 'string' && parsed.account.trim()) {
          account = parsed.account.trim();
        }
      }
    } catch {
      account = null;
    }

    return NextResponse.json({ account });
  } catch (err) {
    console.error('extract-account error', err);
    return NextResponse.json({ error: 'Failed to extract account' }, { status: 500 });
  }
}
