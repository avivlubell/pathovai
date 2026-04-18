'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import MessageContent from '../components/MessageContent';

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
  const { data: session } = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatSession[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const TEXTAREA_MAX_HEIGHT = 200;

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT);
    el.style.height = nextHeight + 'px';
    el.style.overflowY =
      el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [input, resizeTextarea]);

  useEffect(() => {
    const saved = localStorage.getItem('pathovai-history');
    if (saved) setChatHistory(JSON.parse(saved));
  }, []);

  useEffect(() => {
    localStorage.setItem('pathovai-history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveCurrentChat = useCallback((msgs: ChatMessage[]) => {
    if (msgs.length < 2) return;
    const id = activeChatId || crypto.randomUUID();
    const chatSession: ChatSession = {
      id,
      title: msgs[0].content.slice(0, 40),
      messages: msgs,
      createdAt: Date.now(),
    };
    setChatHistory((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      return [chatSession, ...filtered];
    });
    if (!activeChatId) setActiveChatId(id);
  }, [activeChatId]);

  function handleNewChat() {
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setActiveChatId(null);
  }

  function loadChat(chatSession: ChatSession) {
    setMessages(chatSession.messages);
    setActiveChatId(chatSession.id);
  }

  function clearHistory() {
    setChatHistory([]);
    localStorage.removeItem('pathovai-history');
  }

  function downloadAsMarkdown(content: string) {
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pathovai-document-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error('Chat error', errorData);
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `\u26a0\ufe0f Error: ${errorData?.error || errorData?.details || 'Server error. Check Vercel logs.'}`,
        };
        const withError = [...nextMessages, errorMessage];
        setMessages(withError);
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
      const updatedMessages = [...nextMessages, assistantMessage];
      setMessages(updatedMessages);
      saveCurrentChat(updatedMessages);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // User hit Stop; nothing to log.
      } else {
        console.error('Network error', err);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
  }

  if (!session) {
    return (
      <div className="flex h-screen bg-slate-950 text-slate-100 items-center justify-center">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm px-6">
          <img src="/PATHOVA_LOGO1_edited_edited_edited.png" alt="PathovAI logo" className="h-14 w-14 rounded" />
          <h1 className="text-2xl font-bold">PathovAI</h1>
          <p className="text-slate-400 text-sm text-center">Sign in to continue</p>
          <button
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md border border-slate-700 hover:bg-slate-800 text-sm font-medium"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>

        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100">
      {/* Sidebar */}
      {sidebarOpen && (
      <div className="w-56 border-r border-slate-800 p-4 flex flex-col gap-2 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-slate-300">Chat History</h2>
          {chatHistory.length > 0 && (
            <button onClick={clearHistory} className="text-xs text-slate-500 hover:text-red-400">
              Clear All
            </button>
          )}
        </div>
        {chatHistory.map((s) => (
          <button
            key={s.id}
            onClick={() => loadChat(s)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm truncate ${
              activeChatId === s.id
                ? 'bg-slate-700 text-slate-100'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {s.title}
          </button>
        ))}
        {chatHistory.length === 0 && (
          <p className="text-xs text-slate-600 mt-2">No previous chats</p>
        )}
      </div>
      )}

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center sticky top-0 z-10 bg-slate-950 justify-between px-6 py-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen((o) => !o)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded"
              title={sidebarOpen ? 'Hide history' : 'Show history'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <img src="/PATHOVA_LOGO1_edited_edited_edited.png" alt="PathovAI logo" className="h-8 w-8 rounded" />
            <h1 className="text-lg font-bold">PathovAI</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewChat}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:bg-slate-800"
            >
              + New Chat
            </button>
            <button
              onClick={() => signOut()}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:bg-slate-800 text-slate-400 hover:text-slate-200"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-slate-500 text-center mt-20">
              Name a company or tell me what we're working on.
            </p>
          )}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`mx-auto w-full max-w-[min(768px,100%)] min-w-0 [overflow-wrap:anywhere] ${m.role === 'user' ? 'text-sky-300' : 'text-slate-200'}`}
            >
              <p className="text-xs font-semibold mb-1 text-slate-400">
                {m.role === 'user' ? 'You' : 'PathovAI'}
              </p>
              {m.role === 'assistant' ? (
                <MessageContent content={m.content} />
              ) : (
                <p className="whitespace-pre-wrap">{m.content}</p>
              )}
              {m.role === 'assistant' && (
                <button
                  onClick={() => downloadAsMarkdown(m.content)}
                  className="mt-2 text-xs text-slate-500 hover:text-slate-300 underline"
                >
                  Download as .md
                </button>
              )}
            </div>
          ))}
          {isLoading && (
            <div className="mx-auto w-full max-w-[min(768px,100%)] min-w-0">
              <p className="text-slate-500 animate-pulse">Thinking...</p>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="relative bg-slate-950">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-slate-950 to-transparent"
          />
          <form onSubmit={handleSubmit} className="px-6 pt-2 pb-4">
            <div className="relative mx-auto w-full max-w-[min(768px,100%)] min-w-0">
              <textarea
                ref={textareaRef}
                aria-label="Message PathovAI"
                className="block w-full rounded-xl border border-slate-700 bg-slate-900 pl-4 pr-14 py-3 text-sm outline-none focus:border-sky-500 resize-none overflow-y-hidden leading-6 placeholder:text-slate-500"
                style={{ maxHeight: `${TEXTAREA_MAX_HEIGHT}px` }}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!isLoading && input.trim()) handleSubmit(e);
                  }
                }}
                placeholder="Let's make some money. What's on tap..."
              />
              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop generating"
                  title="Stop generating"
                  className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-700 text-slate-100 hover:bg-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <span className="sr-only">Stop generating</span>
                  <svg
                    aria-hidden="true"
                    className="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <rect x="3" y="3" width="10" height="10" rx="1.5" />
                  </svg>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="Send message"
                  title="Send message"
                  className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-sky-600 text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                >
                  <span className="sr-only">Send message</span>
                  <svg
                    aria-hidden="true"
                    className="h-4 w-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 2 11 13" />
                    <path d="M22 2 15 22l-4-9-9-4z" />
                  </svg>
                </button>
              )}
            </div>
            <p className="mx-auto mt-2 w-full max-w-[min(768px,100%)] text-center text-xs text-slate-500">
              Enter to send · Shift+Enter for newline
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
