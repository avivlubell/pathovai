'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import MessageContent from '../components/MessageContent';
import MessageActions from '../components/MessageActions';
import MessageSources, { type SourceRef } from '../components/MessageSources';
import ContextDrawer from '../components/ContextDrawer';
import KbFreshness from '../components/KbFreshness';
import ShareChatModal from '../components/ShareChatModal';
import Logo from '../components/Logo';
import { openReconnectPopup } from '../lib/openReconnectPopup';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceRef[];
};

type ChatSession = {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
};

export default function HomePage() {
  const { data: session, update: refreshSession } = useSession();
  const gmailConnected = Boolean((session as any)?.accessToken);
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
  const [activeAccount, setActiveAccount] = useState<string | null>(null);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  // Maps localStorage chat ids to their server-side shared_chats row id
  // so we can PATCH the snapshot after each new turn in a shared chat.
  // Persisted so the mapping survives reloads.
  const [sharedSnapshotMap, setSharedSnapshotMap] = useState<Record<string, string>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

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
    const sharedRaw = localStorage.getItem('pathovai-shared-map');
    if (sharedRaw) {
      try {
        const parsed = JSON.parse(sharedRaw);
        if (parsed && typeof parsed === 'object') setSharedSnapshotMap(parsed);
      } catch {
        // Ignore corrupted entries; user can re-share.
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('pathovai-history', JSON.stringify(chatHistory));
  }, [chatHistory]);

  useEffect(() => {
    localStorage.setItem('pathovai-shared-map', JSON.stringify(sharedSnapshotMap));
  }, [sharedSnapshotMap]);

  useEffect(() => {
    if (showJumpButton) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, showJumpButton]);

  // On mobile, sidebar starts hidden. On desktop (>=768px), keeps the default.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(max-width: 767px)').matches) {
      setSidebarOpen(false);
    }
  }, []);

  function handleMessagesScroll() {
    const el = messagesContainerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setShowJumpButton(distanceFromBottom > 120);
  }

  function scrollToLatest() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowJumpButton(false);
  }

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
    setActiveAccount(null);
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
        setActiveAccount(
          typeof data.active_account === 'string' && data.active_account.trim()
            ? data.active_account
            : null
        );
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
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(max-width: 767px)').matches
    ) {
      setSidebarOpen(false);
    }
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

  async function persistActiveAccount(
    chatId: string,
    next: string | null
  ) {
    try {
      await fetch('/api/context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          user_id: session?.user?.email ?? null,
          active_account: next,
        }),
      });
    } catch (err) {
      console.error('persist active_account', err);
    }
  }

  async function maybeExtractAccount(
    chatId: string,
    userText: string,
    assistantText: string,
    current: string | null
  ) {
    try {
      const res = await fetch('/api/extract-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: userText,
          assistant: assistantText,
          current,
        }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const next: string | null =
        typeof data?.account === 'string' && data.account.trim()
          ? data.account.trim()
          : null;
      if (!next) return;
      if ((current ?? '').trim().toLowerCase() === next.toLowerCase()) return;
      setActiveAccount(next);
      persistActiveAccount(chatId, next);
    } catch (err) {
      console.error('extract-account', err);
    }
  }

  function clearActiveAccount() {
    if (!activeChatId) return;
    setActiveAccount(null);
    persistActiveAccount(activeChatId, null);
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
      const replySources: SourceRef[] = Array.isArray(data.sources)
        ? data.sources
        : [];
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
        sources: replySources,
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
      const extractChatId = chatId ?? activeChatId;
      if (extractChatId && replyText) {
        maybeExtractAccount(
          extractChatId,
          userMessage.content,
          replyText,
          activeAccount
        );
      }
      // Keep the shared snapshot current so a manager opening the link
      // immediately after this turn lands sees the latest state.
      const chatIdForShareSync = chatId ?? activeChatId;
      const shareId = chatIdForShareSync
        ? sharedSnapshotMap[chatIdForShareSync]
        : null;
      if (shareId) {
        fetch(`/api/shared-chats/${shareId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: updatedMessages }),
        }).catch(() => {
          // Best-effort sync; we'll catch up next turn or when the
          // owner reopens the share modal.
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
      const replySources: SourceRef[] = Array.isArray(data.sources)
        ? data.sources
        : [];
      const newAssistant: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: replyText,
        sources: replySources,
      };
      const updated = [...priorMessages, newAssistant];
      setMessages(updated);
      const savedId = saveCurrentChat(updated);
      const chatIdForShareSync = savedId ?? activeChatId;
      const shareId = chatIdForShareSync
        ? sharedSnapshotMap[chatIdForShareSync]
        : null;
      if (shareId) {
        fetch(`/api/shared-chats/${shareId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: updated }),
        }).catch(() => {
          // Best-effort sync.
        });
      }
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
      <div className="flex h-[100dvh] bg-bg text-fg items-center justify-center">
        <div className="flex flex-col items-center gap-6 w-full max-w-sm px-6">
          <Logo size={56} priority />
          <h1 className="text-2xl font-bold">PathovAI</h1>
          <p className="text-fg-muted text-sm text-center">Sign in to continue</p>
          <button
            type="button"
            onClick={() => signIn('google')}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-md border border-border-strong hover:bg-elevated text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path style={{ fill: 'var(--brand-google-blue)' }} d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path style={{ fill: 'var(--brand-google-green)' }} d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path style={{ fill: 'var(--brand-google-yellow)' }} d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path style={{ fill: 'var(--brand-google-red)' }} d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>

        </div>
      </div>
    );
  }

  const userInitial = (() => {
    const src = session?.user?.name || session?.user?.email || 'You';
    return src.trim().charAt(0).toUpperCase() || 'Y';
  })();

  return (
    <div className="flex h-[100dvh] bg-bg text-fg">
      <a
        href="#conversation"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[60] focus:rounded focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:text-accent-fg focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-bg"
      >
        Skip to conversation
      </a>
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}
      {/* Sidebar */}
      {sidebarOpen && (
        <nav
          id="chat-history-nav"
          ref={sidebarRef}
          aria-label="Chat history"
          className="fixed inset-y-0 left-0 z-40 flex w-72 max-w-[80vw] flex-col gap-2 overflow-y-auto border-r border-border bg-surface p-3 md:static md:z-0 md:w-60 md:max-w-none"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-fg">Chat History</h2>
            {chatHistory.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs text-fg-subtle hover:text-danger focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
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
            className="rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-subtle outline-none focus:border-accent"
          />
          {chatHistory.length === 0 && (
            <p className="text-xs text-fg-subtle mt-2">No previous chats</p>
          )}
          {chatHistory.length > 0 && filteredChats.length === 0 && (
            <p className="text-xs text-fg-subtle mt-2">No matches</p>
          )}
          {BUCKET_ORDER.map((bucket) => {
            const items = groupedChats[bucket];
            if (items.length === 0) return null;
            return (
              <div key={bucket} className="flex flex-col gap-1 mt-2">
                <h3 className="px-1 text-[10px] font-semibold uppercase tracking-wide text-fg-subtle">
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
                          ? 'bg-elevated text-fg'
                          : 'text-fg-muted hover:bg-elevated hover:text-fg'
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
                          className="w-full rounded-md border border-accent bg-bg px-2 py-1.5 text-sm text-fg outline-none"
                        />
                      ) : isConfirmingDelete ? (
                        <div className="flex items-center gap-1 px-2 py-1.5">
                          <span className="flex-1 truncate text-xs text-fg-muted">
                            Delete this chat?
                          </span>
                          <button
                            type="button"
                            onClick={() => setDeletingId(null)}
                            className="rounded px-1.5 py-0.5 text-xs text-fg-muted hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteChat(s.id)}
                            className="rounded bg-danger px-1.5 py-0.5 text-xs text-bg hover:bg-danger/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                          >
                            Delete
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => loadChat(s)}
                            className="w-full truncate px-3 py-2 pr-8 text-left text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-md"
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
                            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-6 w-6 items-center justify-center rounded text-fg-muted opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-border-strong hover:text-fg focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent"
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
                              className="absolute right-1 top-9 z-20 w-32 overflow-hidden rounded-md border border-border-strong bg-elevated shadow-lg"
                            >
                              <button
                                role="menuitem"
                                type="button"
                                onClick={() => startRename(s)}
                                className="block w-full px-3 py-1.5 text-left text-xs text-fg hover:bg-border focus:outline-none focus:bg-border"
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
                                className="block w-full px-3 py-1.5 text-left text-xs text-danger hover:bg-border focus:outline-none focus:bg-border"
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
        </nav>
      )}

      {/* Main Chat */}
      <main id="conversation" className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center sticky top-0 z-10 bg-surface justify-between px-4 sm:px-6 py-3 border-b border-border gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen((o) => !o)}
              aria-label="Toggle chat history"
              aria-expanded={sidebarOpen}
              aria-controls="chat-history-nav"
              className="text-fg-muted hover:text-fg p-1 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              title={sidebarOpen ? 'Hide history' : 'Show history'}
            >
              <svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <Logo size={32} priority className="flex-shrink-0" />
            <h1 className="hidden sm:block text-lg font-bold">PathovAI</h1>
            <KbFreshness />
            {activeAccount && (
              <span
                className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border-strong bg-info-bg px-2.5 py-1 text-xs text-info"
                title={`Primary account for this chat: ${activeAccount}`}
              >
                <span className="hidden sm:inline text-fg-muted">Account:</span>
                <span className="truncate font-medium">{activeAccount}</span>
                <button
                  type="button"
                  onClick={clearActiveAccount}
                  aria-label={`Clear active account ${activeAccount}`}
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full text-info hover:bg-info-bg hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <svg
                    aria-hidden="true"
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                openReconnectPopup(
                  () => {
                    refreshSession?.();
                  },
                  (err) => {
                    console.error('Gmail connect error', err);
                  }
                )
              }
              aria-label={
                gmailConnected
                  ? 'Gmail connected — click to reconnect'
                  : 'Connect Gmail'
              }
              title={
                gmailConnected
                  ? 'Gmail connected. Click to reconnect if search stops working.'
                  : 'Connect Gmail so the agent can verify sent and received email'
              }
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm rounded-md border border-border-strong hover:bg-elevated text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <path d="m2 7 10 7 10-7" />
              </svg>
              <span className="hidden sm:inline">
                {gmailConnected ? 'Gmail' : 'Connect Gmail'}
              </span>
              {gmailConnected && (
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 rounded-full bg-success"
                />
              )}
            </button>
            <button
              type="button"
              onClick={() => setContextOpen(true)}
              aria-label={
                contextCount > 0
                  ? `Open conversation context (${contextCount})`
                  : 'Open conversation context'
              }
              title="Conversation context"
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm rounded-md border border-border-strong hover:bg-elevated text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
              <span className="hidden sm:inline">Context</span>
              {contextCount > 0 && (
                <span className="ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-fg">
                  {contextCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!activeChatId && messages.length >= 2) {
                  // Persist the chat first so we have a stable id to
                  // attach the share to.
                  saveCurrentChat(messages);
                }
                setShareModalOpen(true);
              }}
              disabled={messages.length < 2}
              aria-label="Share this chat"
              title={
                messages.length < 2
                  ? 'Send a message first, then you can share this chat'
                  : 'Share this chat'
              }
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-sm rounded-md border border-border-strong hover:bg-elevated text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed disabled:opacity-50"
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
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <path d="M8.59 13.51l6.83 3.98" />
                <path d="M15.41 6.51l-6.82 3.98" />
              </svg>
              <span className="hidden sm:inline">Share</span>
            </button>
            <button
              type="button"
              onClick={handleNewChat}
              aria-label="Start new chat"
              title="New chat"
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 text-sm rounded-md border border-border-strong hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                <path d="M12 5v14" />
                <path d="M5 12h14" />
              </svg>
              <span className="hidden sm:inline">New Chat</span>
            </button>
            <button
              type="button"
              onClick={() => signOut()}
              aria-label="Sign out"
              className="hidden sm:inline-flex items-center px-3 py-1.5 text-sm rounded-md border border-border-strong hover:bg-elevated text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="relative flex-1 min-h-0">
        <div
          ref={messagesContainerRef}
          onScroll={handleMessagesScroll}
          className="absolute inset-0 overflow-y-auto px-4 py-4 sm:px-6 space-y-4"
        >
          {messages.length === 0 && (
            <div className="flex h-full min-h-[60vh] w-full items-center justify-center">
              <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-2 text-center">
                <Logo size={48} />
                <div className="space-y-2">
                  <h2 className="text-2xl font-semibold text-fg">
                    What are we working on?
                  </h2>
                  <p className="text-sm text-fg-muted">
                    Ask about an account, a contact, or an opportunity.
                  </p>
                </div>
                <div className="mt-2 grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => prefillFromStarter(prompt)}
                      className="rounded-lg border border-border bg-surface px-4 py-3 text-left text-sm text-fg-muted transition hover:border-border-strong hover:bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                sources={m.sources}
                onRegenerate={() => handleRegenerate(idx)}
                onDownload={() => downloadAsMarkdown(m.content)}
              />
            ) : (
              <UserMessageRow
                key={m.id}
                content={m.content}
                initial={userInitial}
              />
            )
          )}
          {isLoading && <PendingAssistantRow />}
          <div ref={messagesEndRef} />
        </div>
        {showJumpButton && (
          <button
            type="button"
            onClick={scrollToLatest}
            aria-label="Jump to latest message"
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-elevated/90 px-3 py-1.5 text-xs text-fg shadow-lg backdrop-blur hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <span>Jump to latest</span>
            <svg
              aria-hidden="true"
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 5v14" />
              <path d="m19 12-7 7-7-7" />
            </svg>
          </button>
        )}
        </div>

        {/* Input Area */}
        <div
          className="relative bg-bg"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 -top-6 h-6 bg-gradient-to-t from-bg to-transparent"
          />
          <form onSubmit={handleSubmit} className="px-4 sm:px-6 pt-2 pb-4">
            <div className="relative mx-auto w-full max-w-[min(768px,100%)] min-w-0">
              <textarea
                ref={textareaRef}
                aria-label="Message PathovAI"
                className="block w-full rounded-xl border border-border-strong bg-surface pl-4 pr-14 py-3 text-sm text-fg outline-none focus:border-accent resize-none overflow-y-hidden leading-6 placeholder:text-fg-subtle"
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
                  className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-border-strong text-fg hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                  className="absolute right-2 bottom-2 inline-flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-fg hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-border-strong disabled:text-fg-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
            <p className="mx-auto mt-2 w-full max-w-[min(768px,100%)] text-center text-xs text-fg-subtle">
              Enter to send · Shift+Enter for newline
            </p>
          </form>
        </div>
      </main>
      <ContextDrawer
        open={contextOpen}
        chatId={activeChatId}
        userId={session?.user?.email ?? null}
        onClose={() => setContextOpen(false)}
        onCountChange={setContextCount}
      />
      <ShareChatModal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        chatId={activeChatId}
        title={messages[0]?.content?.slice(0, 80) || null}
        messages={messages}
        onShareChange={(chatId, shareId) => {
          setSharedSnapshotMap((prev) => {
            const next = { ...prev };
            if (shareId) next[chatId] = shareId;
            else delete next[chatId];
            return next;
          });
        }}
      />
    </div>
  );
}

type AssistantMessageRowProps = {
  message: ChatMessage;
  chatId: string | null;
  userId: string | null;
  isStreaming: boolean;
  sources: SourceRef[] | undefined;
  onRegenerate: () => void;
  onDownload: () => void;
};

function AssistantMessageRow({
  message,
  chatId,
  userId,
  isStreaming,
  sources,
  onRegenerate,
  onDownload,
}: AssistantMessageRowProps) {
  const renderedRef = useRef<HTMLDivElement>(null);
  return (
    <article
      tabIndex={0}
      aria-label="PathovAI response"
      className="group mx-auto flex w-full max-w-[min(768px,100%)] min-w-0 gap-2 sm:gap-3 [overflow-wrap:anywhere] text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded-lg"
    >
      <div
        aria-hidden
        className="mt-1 flex aspect-square h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated"
      >
        <Logo size={28} alt="" />
      </div>
      <div className="min-w-0 flex-1">
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
        <MessagesSourcesOrNothing sources={sources} isStreaming={isStreaming} />
      </div>
    </article>
  );
}

function MessagesSourcesOrNothing({
  sources,
  isStreaming,
}: {
  sources: SourceRef[] | undefined;
  isStreaming: boolean;
}) {
  if (isStreaming) return null;
  return <MessageSources sources={sources} />;
}

function UserMessageRow({
  content,
  initial,
}: {
  content: string;
  initial: string;
}) {
  return (
    <article
      aria-label="Your message"
      className="mx-auto flex w-full max-w-[min(768px,100%)] min-w-0 justify-end gap-2 sm:gap-3"
    >
      <div className="min-w-0 max-w-[85%] rounded-2xl rounded-br-md bg-elevated px-4 py-2.5 text-sm text-fg [overflow-wrap:anywhere] whitespace-pre-wrap">
        {content}
      </div>
      <div
        aria-hidden
        className="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-fg"
      >
        {initial}
      </div>
    </article>
  );
}

function PendingAssistantRow() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-[min(768px,100%)] min-w-0 gap-2 sm:gap-3"
    >
      <div
        aria-hidden
        className="mt-1 flex aspect-square h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-elevated"
      >
        <Logo size={28} alt="" />
      </div>
      <div className="flex items-center gap-1.5 pt-2">
        <span className="sr-only">PathovAI is thinking</span>
        <span className="h-2 w-2 animate-pulse rounded-full bg-fg-subtle [animation-delay:0ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-fg-subtle [animation-delay:150ms]" />
        <span className="h-2 w-2 animate-pulse rounded-full bg-fg-subtle [animation-delay:300ms]" />
      </div>
    </div>
  );
}
