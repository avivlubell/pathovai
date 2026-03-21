'use client';

import { useState } from 'react';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

  if (!res.ok) {
  const errorData = await res.json().catch(() => ({}));
  console.error('Chat error', errorData);
  const errorMessage: ChatMessage = {
    id: crypto.randomUUID(),
    role: 'assistant',
    content: `⚠️ Error: ${errorData?.error || errorData?.details || 'Server error. Check Vercel logs.'}`,
  };
  setMessages((prev) => [...prev, errorMessage]);
  setIsLoading(false);
  return;
}


      const data = await res.json();
      const replyText = data.reply ?? '';

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error('Network error', err);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-50">
      <div className="flex-1 max-w-2xl w-full mx-auto flex flex-col py-6 px-4 gap-4">
        <h1 className="text-lg font-semibold mb-2">
          PathovAI – Main Agent Chat
        </h1>

        <div className="flex-1 border border-slate-800 rounded-lg p-3 overflow-y-auto bg-slate-900/60">
          {messages.length === 0 && (
            <div className="text-sm text-slate-400">
              Start chatting with your Claude main agent…
            </div>
          )}

          {messages.map((m) => (
            <div
              key={m.id}
              className={`mb-3 text-sm ${
                m.role === 'user' ? 'text-sky-300' : 'text-slate-100'
              }`}
            >
              <div className="font-medium">
                {m.role === 'user' ? 'You' : 'PathovAI'}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}

          {isLoading && (
            <div className="text-sm text-slate-400">Thinking…</div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="mt-2 flex gap-2">
          <input
            className="flex-1 rounded-md border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-500"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your PathovAI agent anything about a prospect..."
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-md bg-sky-600 text-sm font-medium hover:bg-sky-500 disabled:opacity-50"
            disabled={isLoading}
          >
            Send
          </button>
        </form>
      </div>
    </main>
  );
}
