'use client';

import { useState, useRef, useEffect } from 'react';

import Image from 'next/image';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
};

export default function HomePage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('pathovai-history');
    if (saved) setChatHistory(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('pathovai-history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  function handleNewChat() {
    if (messages.length > 0) {
      const session: ChatSession = {
        id: activeChatId || crypto.randomUUID(),
        title: messages[0].content.slice(0, 40),
        messages,
        createdAt: Date.now(),
      };
      setChatHistory((prev) => {
        const filtered = prev.filter((s) => s.id !== session.id);
        return [session, ...filtered];
      });
    }
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setActiveChatId(null);
  }

  function loadChat(session: ChatSession) {
    if (messages.length > 0) {
      const current: ChatSession = {
        id: activeChatId || crypto.randomUUID(),
        title: messages[0].content.slice(0, 40),
        messages,
        createdAt: Date.now(),
      };
      setChatHistory((prev) => {
        const filtered = prev.filter((s) => s.id !== current.id);
        return [current, ...filtered];
      });
    }
    setMessages(session.messages);
    setActiveChatId(session.id);
  }

  function clearHistory() {
    setChatHistory([]);
    localStorage.removeItem('pathovai-history');
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
    <main className="flex min-h-screen bg-slate-950 text-slate-50">
      {/* Sidebar */}
      <aside className="w-64 border-r border-slate-800 flex flex-col p-4 bg-slate-900/40">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-300">Chat History</h2>
          {chatHistory.length > 0 && (
            <button
              onClick={clearHistory}
              className="text-xs text-slate-500 hover:text-red-400"
            >
              Clear All
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {chatHistory.map((session) => (
            <button
              key={session.id}
              onClick={() => loadChat(session)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
                activeChatId === session.id
                  ? 'bg-slate-700 text-slate-100'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
            >
              {session.title}
            </button>
          ))}
          {chatHistory.length === 0 && (
            <div className="text-xs text-slate-500">No previous chats</div>
          )}
        </div>
      </aside>
      {/* Main Chat */}
      <div className="flex-1 max-w-2xl mx-auto flex flex-col py-6 px-4 gap-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <Image src="/PATHOVA_LOGO1_edited_edited_edited.png" alt="PathovaAI logo" width={32} height={32} />
            <h1 className="text-lg font-semibold">
              PathovaAI
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
              Start chatting with your Claude main agent...
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
                {m.role === 'user' ? 'You' : 'PathovaAI'}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}

          {isLoading && (
            <div className="text-sm text-slate-400">Thinking...</div>
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
              placeholder="Ask your PathovaAI agent anything about a prospect..."
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
