'use client';

import { useState } from 'react';
import MessageContent from '../../../components/MessageContent';
import Logo from '../../../components/Logo';
import type { SharedMessage } from '../../../lib/sharedChats';

type Props = {
  title: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
  messages: SharedMessage[];
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function SharedChatView({
  title,
  ownerDisplayName,
  createdAt,
  messages,
}: Props) {
  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col">
      {/* Banner: makes it unmistakable that this is a read-only shared
          view, and surfaces who shared it. */}
      <div className="bg-warning-bg border-b border-warning/30 px-4 py-2 text-xs text-warning">
        <div className="mx-auto max-w-3xl flex flex-wrap items-center justify-between gap-2">
          <span>
            Shared by{' '}
            <span className="font-medium">
              {ownerDisplayName || 'a PathovAI user'}
            </span>{' '}
            · {formatDate(createdAt)}
          </span>
          <span className="rounded-full border border-warning/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
            Read-only
          </span>
        </div>
      </div>

      <header className="px-4 py-3 border-b border-border">
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          <Logo size={32} />
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle leading-none">PathovAI</p>
            <h1 className="truncate text-sm font-semibold text-fg">
              {title || 'Shared chat'}
            </h1>
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-3xl space-y-5">
          {messages.length === 0 && (
            <p className="text-fg-subtle text-center mt-12">
              This chat has no messages yet.
            </p>
          )}
          {messages.map((m) => (
            <SharedMessageRow key={m.id} message={m} />
          ))}
        </div>
      </main>

      <footer className="px-4 py-4 border-t border-border text-center text-[11px] text-fg-subtle">
        This is a read-only view. The viewer cannot send messages or see other
        chats.
      </footer>
    </div>
  );
}

function SharedMessageRow({ message }: { message: SharedMessage }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent fail; not worth a toast on a read-only view.
    }
  }

  return (
    <div
      className={`min-w-0 [overflow-wrap:anywhere] ${
        message.role === 'user' ? 'text-accent-hover' : 'text-fg'
      }`}
    >
      <p className="text-xs font-semibold mb-1 text-fg-muted">
        {message.role === 'user' ? 'User' : 'PathovAI'}
      </p>
      {message.role === 'assistant' ? (
        <MessageContent content={message.content} />
      ) : (
        <p className="whitespace-pre-wrap">{message.content}</p>
      )}
      <button
        onClick={copy}
        aria-label="Copy message"
        className="mt-2 text-xs text-fg-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}
