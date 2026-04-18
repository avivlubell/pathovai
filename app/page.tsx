'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import MessageContent from '../components/MessageContent';
import MessageActions from '../components/MessageActions';
import ContextDrawer from '../components/ContextDrawer';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [openMenuForId, setOpenMenuForId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const [contextCount, setContextCount] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

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

  const saveCurrentChat = useCallback(
    (msgs: ChatMessage[]): string | null => {
      if (msgs.length < 2) return null;
      const id = activeChatId || crypto.randomUUID();
      setChatHistory((prev) => {
        const existing = prev.find((s) => s.id === id);
        const chatSession: ChatSession = {
          id,
          title: existing?.title ?? msgs[0].content.slice(0, 40),
          messages: msgs,
          createdAt: existing?.createdAt ?? Date.now(),
        };
        const filtered = prev.filter((s) => s.id !== id);
        return [chatSession, ...filtered];
      });
      if (!activeChatId) setActiveChatId(id);
      return id;
    },
    [activeChatId]
  );

  function updateChatTitle(id: string, title: string) {
    setChatHistory((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title } : s))
    );
  }

  function deleteChat(id: string) {
    setChatHistory((prev) => prev.filter((s) => s.id !== id));
    setDeletingId(null);
    setOpenMenuForId(null);
    if (activeChatId === id) {
      handleNewChat();
    }
  }

  async function generateTitle(
    userMsg: string,
    assistantMsg: string
  ): Promise<string | null> {
    try {
      const res = await fetch('/api/title-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: userMsg, assistant: assistantMsg }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return typeof data.title === 'string' && data.title ? data.title : null;
    } catch {
      return null;
    }
  }

  function handleNewChat() {
    setMessages([]);
    setInput('');
    setIsLoading(false);
    setActiveChatId(crypto.randomUUID());
    setContextCount(0);
  }

  useEffect(() => {
    if (!activeChatId) setActiveChatId(crypto.randomUUID());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeChatId) return;
    let cancelled = false;
    fetch(`/api/context?chat_id=${encodeURIComponent(activeChatId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const hasNotes = typeof data.notes === 'string' && data.notes.trim();
        const attCount = Array.isArray(data.attachments) ? data.attachments.length : 0;
        setContextCount((hasNotes ? 1 : 0) + attCount);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeChatId]);

  const STARTER_PROMPTS = [
    'Is [Account] an ICP fit?',
    'Who at [Account] should I reach out to and why?',
    'Draft an outreach email to [Contact] at [Account].',
    'How do I move the [Account] opportunity forward?',
  ];

  function prefillFromStarter(prompt: string) {
    setInput(prompt);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const match = /\[[^\]]+\]/.exec(prompt);
      if (match) {
        el.setSelectionRange(match.index, match.index + match[0].length);
      } else {
        el.setSelectionRange(prompt.length, prompt.length);
      }
    });
  }

  function loadChat(chatSession: ChatSession) {
    setMessages(chatSession.messages);
    setActiveChatId(chatSession.id);
  }

  function clearHistory() {
    const count = chatHistory.length;
    if (count === 0) return;
    const ok = window.confirm(
      `Delete all ${count} chat${count === 1 ? '' : 's'}? This can't be undone.`
    );
    if (!ok) return;
    setChatHistory([]);
    localStorage.removeItem('pathovai-history');
    handleNewChat();
  }

  function startRename(chat: ChatSession) {
    setRenamingId(chat.id);
    setRenameDraft(chat.title);
    setOpenMenuForId(null);
  }

  function finishRename(id: string) {
    const trimmed = renameDraft.trim();
    if (trimmed) updateChatTitle(id, trimmed.slice(0, 80));
    setRenamingId(null);
    setRenameDraft('');
  }

  function cancelRename() {
    setRenamingId(null);
    setRenameDraft('');
  }

  type Bucket = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
  const BUCKET_ORDER: Bucket[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

  function bucketFor(ts: number): Bucket {
    const now = new Date();
    const startOfToday = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();
    const msPerDay = 86400000;
    if (ts >= startOfToday) return 'Today';
    if (ts >= startOfToday - msPerDay) return 'Yesterday';
    if (ts >= startOfToday - 7 * msPerDay) return 'Previous 7 days';
    return 'Older';
  }

  const filteredChats = searchQuery.trim()
    ? chatHistory.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : chatHistory;

  const groupedChats: Record<Bucket, ChatSession[]> = {
    Today: [],
    Yesterday: [],
    'Previous 7 days': [],
    Older: [],
  };
  for (const c of filteredChats) groupedChats[bucketFor(c.createdAt)].push(c);

  useEffect(() => {
    if (!openMenuForId) return;
    function onClickAway(e: MouseEvent) {
      const sidebar = sidebarRef.current;
      if (sidebar && !sidebar.contains(e.target as Node)) {
        setOpenMenuForId(null);
        return;
      }
      const target = e.target as HTMLElement | null;
      if (!target?.closest('[data-chat-row]')) {
        setOpenMenuForId(null);
      }
    }
    const id = window.setTimeout(
      () => document.addEventListener('click', onClickAway),
      0
    );
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('click', onClickAway);
    };
  }, [openMenuForId]);

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
          chat_id: activeChatId,
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
      const chatId = saveCurrentChat(updatedMessages);
      const isFirstExchange = nextMessages.length === 1;
      if (chatId && isFirstExchange && replyText) {
        generateTitle(userMessage.content, replyText).then((title) => {
          if (title) updateChatTitle(chatId, title);
        });
      }
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

  async function handleRegenerate(assistantIdx: number) {
    if (isLoading) return;
    const assistantMsg = messages[assistantIdx];
    const prevUser = messages[assistantIdx - 1];
    if (!assistantMsg || assistantMsg.role !== 'assistant') return;
    if (!prevUser || prevUser.role !== 'user') return;

    const priorMessages = messages.slice(0, assistantIdx);
    setMessages(priorMessages);
    setIsLoading(true);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: activeChatId,
          messages: priorMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: `\u26a0\ufe0f Error: ${errorData?.error || errorData?.details || 'Server error.'}`,
        };
        setMessages([...priorMessages, errorMessage]);
        return;
      }
      const data = await res.json();
      const replyText = data.reply ?? '';
      const newAssistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
      };
      const updated = [...priorMessages, newAssistant];
      setMessages(updated);
      saveCurrentChat(updated);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('Regenerate error', err);
      }
    } finally {
      abortControllerRef.current = null;
      setIsLoading(false);
    }
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
        <div
          ref={sidebarRef}
          className="w-60 border-r border-slate-800 p-3 flex flex-col gap-2 overflow-y-auto"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-300">Chat History</h2>
            {chatHistory.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs text-slate-500 hover:text-red-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
              >
                Clear All
              </button>
            )}
          </div>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            aria-label="Search chat history"
            className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 outline-none focus:border-sky-500"
          />
          {chatHistory.length === 0 && (
            <p className="text-xs text-slate-600 mt-2">No previous chats</p>
          )}
          {chatHistory.length > 0 && filteredChats.length === 0 && (
            <p className="text-xs text-slate-600 mt-2">No matches</p>
          )}
          {BUCKET_ORDER.map((bucket) => {
            const items = groupedChats[bucket];
            if (items.length === 0) return null;
            return (
              <div key={bucket} className="flex flex-col gap-1 mt-2">
                <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {bucket}
                </h3>
                {items.map((s) => {
                  const isActive = activeChatId === s.id;
                  const isRenaming = renamingId === s.id;
                  const isConfirmingDelete = deletingId === s.id;
                  const isMenuOpen = openMenuForId === s.id;
                  return (
                    <div
                      key={s.id}
                      data-chat-row
                      className={`group relative rounded-md ${
                        isActive
                          ? 'bg-slate-700/80 text-slate-100'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onBlur={() => finishRename(s.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              finishRename(s.id);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelRename();
                            }
                          }}
                          aria-label="Rename chat"
                          className="w-full rounded-md border border-sky-500 bg-slate-900 px-2 py-1.5 text-sm text-slate-100 outline-none"
                        />
                      ) : isConfirmingDelete ? (
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <span className="flex-1 truncate text-xs text-slate-300">
                            Delete this chat?
                          </span>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteChat(s.id)}
                            className="rounded bg-red-600 px-1.5 py-0.5 text-xs text-white hover:bg-red-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => loadChat(s)}
                            className="w-full truncate px-3 py-2 pr-8 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-md"
                          >
                            {s.title}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuForId((prev) =>
                                prev === s.id ? null : s.id
                              );
                            }}
                            aria-label="Chat actions"
                            aria-haspopup="menu"
                            aria-expanded={isMenuOpen}
                            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-slate-400 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-slate-700 hover:text-slate-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-500"
                          >
                            <svg
                              aria-hidden="true"
                              className="h-4 w-4"
                              viewBox="0 0 24 24"
                              fill="currentColor"
                            >
                              <circle cx="5" cy="12" r="1.5" />
                              <circle cx="12" cy="12" r="1.5" />
                              <circle cx="19" cy="12" r="1.5" />
                            </svg>
                          </button>
                          {isMenuOpen && (
                            <div
                              role="menu"
                              className="absolute right-1 top-9 z-20 w-32 overflow-hidden rounded-md border border-slate-700 bg-slate-900 shadow-lg"
                            >
                              <button
                                role="menuitem"
                                type="button"
                                onClick={() => startRename(s)}
                                className="block w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-slate-800 focus:outline-none focus:bg-slate-800"
                              >
                                Rename
                              </button>
                              <button
                                role="menuitem"
                                type="button"
                                onClick={() => {
                                  setDeletingId(s.id);
                                  setOpenMenuForId(null);
                                }}
                                className="block w-full px-3 py-1.5 text-left text-xs text-red-400 hover:bg-slate-800 focus:outline-none focus:bg-slate-800"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
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
              type="button"
              onClick={() => setContextOpen(true)}
              aria-label="Open conversation context"
              title="Conversation context"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            >
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
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span>Context</span>
              {contextCount > 0 && (
                <span className="ml-1 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {contextCount}
                </span>
              )}
            </button>
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
            <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
              <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-2 text-center">
                <img
                  src="/PATHOVA_LOGO1_edited_edited_edited.png"
                  alt="PathovAI logo"
                  className="h-12 w-12 rounded"
                />
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-slate-100">
                    What are we working on?
                  </h2>
                  <p className="text-sm text-slate-400">
                    Ask about an account, a contact, or an opportunity.
                  </p>
                </div>
                <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => prefillFromStarter(prompt)}
                      className="rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-3 text-left text-sm text-slate-300 transition hover:border-slate-700 hover:bg-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {messages.map((m, idx) =>
            m.role === 'assistant' ? (
              <AssistantMessageRow
                key={m.id}
                message={m}
                chatId={activeChatId}
                userId={session?.user?.email ?? null}
                isStreaming={isLoading}
                onRegenerate={() => handleRegenerate(idx)}
                onDownload={() => downloadAsMarkdown(m.content)}
              />
            ) : (
              <div
                key={m.id}
                className="mx-auto w-full max-w-[min(768px,100%)] min-w-0 [overflow-wrap:anywhere] text-sky-300"
              >
                <p className="text-xs font-semibold mb-1 text-slate-400">You</p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            )
          )}
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
      <ContextDrawer
        open={contextOpen}
        chatId={activeChatId}
        userId={session?.user?.email ?? null}
        onClose={() => setContextOpen(false)}
        onCountChange={setContextCount}
      />
    </div>
  );
}

type AssistantMessageRowProps = {
  message: ChatMessage;
  chatId: string | null;
  userId: string | null;
  isStreaming: boolean;
  onRegenerate: () => void;
  onDownload: () => void;
};

function AssistantMessageRow({
  message,
  chatId,
  userId,
  isStreaming,
  onRegenerate,
  onDownload,
}: AssistantMessageRowProps) {
  const renderedRef = useRef<HTMLDivElement>(null);
  return (
    <div
      tabIndex={0}
      className="group mx-auto w-full max-w-[min(768px,100%)] min-w-0 [overflow-wrap:anywhere] text-slate-200 focus:outline-none"
    >
      <p className="text-xs font-semibold mb-1 text-slate-400">PathovAI</p>
      <div ref={renderedRef}>
        <MessageContent content={message.content} />
      </div>
      <MessageActions
        messageId={message.id}
        chatId={chatId}
        userId={userId}
        content={message.content}
        renderedRef={renderedRef}
        isStreaming={isStreaming}
        onRegenerate={onRegenerate}
        onDownload={onDownload}
      />
    </div>
  );
}
