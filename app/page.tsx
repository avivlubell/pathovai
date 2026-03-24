'use client';

import { useState, useRef } from 'react';

import Image from 'next/image';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

    function handleNewChat() {
    setMessages([]);
    setInput('');
    setIsLoading(false);
  }

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
                          <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <Image src="/PATHOVA_LOGO1_edited_edited_edited.png" alt="PathovAI logo" width={32} height={32} />
                <h1 className="text-lg font-semibold">
                  PathovAI – Main Agent Chat
                </h1>
              </div>

          <button
            onClick={handleNewChat}
            className="px-3 py-1.5 rounded-md bg-slate-800 border border-slate-700 text-sm font-medium hover:bg-slate-700 transition-colors"
          >
            + New Chat
          </button>
        </div>


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

               <form onSubmit={handleSubmit} className="mt-2 flex flex-col gap-2">
          {files.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {files.map((file, i) => (
                <div key={i} className="flex items-center gap-1 bg-slate-800 rounded px-2 py-1 text-xs text-slate-300">
                  <span>{file.name}</span>
                  <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-slate-500 hover:text-slate-200">✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-2 rounded-md border border-slate-700 bg-slate-900 text-sm hover:bg-slate-800"
              title="Attach files"
            >
              📎
            </button>
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
          </div>
        </form>

      </div>
    </main>
  );
}
