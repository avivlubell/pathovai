'use client';

import { useRef, useState } from 'react';
import { markdownToEmail } from '../lib/markdownToEmail';

type Props = {
  messageId: string;
  chatId: string | null;
  userId: string | null;
  content: string;
  renderedRef: React.RefObject<HTMLElement | null>;
  isStreaming: boolean;
  onRegenerate: () => void;
  onDownload: () => void;
};

type Rating = 'up' | 'down' | null;

export default function MessageActions({
  messageId,
  chatId,
  userId,
  content,
  renderedRef,
  isStreaming,
  onRegenerate,
  onDownload,
}: Props) {
  const [copiedKind, setCopiedKind] = useState<null | 'plain' | 'email'>(null);
  const [rating, setRating] = useState<Rating>(null);
  const [showReason, setShowReason] = useState(false);
  const [reasonDraft, setReasonDraft] = useState('');
  const [feedbackState, setFeedbackState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const copyTimeoutRef = useRef<number | null>(null);

  function flashCopied(kind: 'plain' | 'email') {
    setCopiedKind(kind);
    if (copyTimeoutRef.current) window.clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = window.setTimeout(() => setCopiedKind(null), 1500);
  }

  async function handleCopyPlain() {
    const text =
      (renderedRef.current && renderedRef.current.innerText) || content;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied('plain');
    } catch (err) {
      console.error('Copy failed', err);
    }
  }

  async function handleCopyEmail() {
    const text = markdownToEmail(content);
    try {
      await navigator.clipboard.writeText(text);
      flashCopied('email');
    } catch (err) {
      console.error('Copy-as-email failed', err);
    }
  }

  async function sendFeedback(next: 'up' | 'down', reason?: string) {
    setFeedbackState('saving');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          chat_id: chatId,
          user_id: userId,
          rating: next,
          reason: reason ?? null,
        }),
      });
      if (!res.ok) throw new Error('feedback failed');
      setFeedbackState('saved');
      window.setTimeout(() => setFeedbackState('idle'), 2000);
    } catch (err) {
      console.error(err);
      setFeedbackState('error');
    }
  }

  function handleThumbsUp() {
    setRating('up');
    setShowReason(false);
    sendFeedback('up');
  }

  function handleThumbsDown() {
    setRating('down');
    setShowReason(true);
    sendFeedback('down');
  }

  function handleReasonSubmit() {
    const reason = reasonDraft.trim();
    setShowReason(false);
    sendFeedback('down', reason || undefined);
  }

  const btnClass =
    'inline-flex h-10 w-10 sm:h-8 sm:w-8 items-center justify-center rounded text-fg-subtle hover:bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="mt-2">
      <div
        className="flex items-center gap-1"
        role="toolbar"
        aria-label="Message actions"
      >
        <button
          type="button"
          onClick={handleCopyPlain}
          aria-label="Copy message"
          title={copiedKind === 'plain' ? 'Copied' : 'Copy message'}
          className={btnClass}
        >
          {copiedKind === 'plain' ? (
            <CheckIcon />
          ) : (
            <CopyIcon />
          )}
        </button>

        <button
          type="button"
          onClick={handleCopyEmail}
          aria-label="Copy as email"
          title={copiedKind === 'email' ? 'Copied' : 'Copy as email'}
          className={btnClass}
        >
          {copiedKind === 'email' ? <CheckIcon /> : <MailIcon />}
        </button>

        <button
          type="button"
          onClick={onRegenerate}
          disabled={isStreaming}
          aria-label="Regenerate response"
          title="Regenerate response"
          className={btnClass}
        >
          <RefreshIcon />
        </button>

        <button
          type="button"
          onClick={onDownload}
          aria-label="Download as markdown"
          title="Download as markdown"
          className={btnClass}
        >
          <DownloadIcon />
        </button>

        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        <button
          type="button"
          onClick={handleThumbsUp}
          aria-label="Good response"
          aria-pressed={rating === 'up'}
          title="Good response"
          className={`${btnClass} ${rating === 'up' ? 'text-success' : ''}`}
        >
          <ThumbsUpIcon />
        </button>

        <button
          type="button"
          onClick={handleThumbsDown}
          aria-label="Bad response"
          aria-pressed={rating === 'down'}
          title="Bad response"
          className={`${btnClass} ${rating === 'down' ? 'text-danger' : ''}`}
        >
          <ThumbsDownIcon />
        </button>

        {feedbackState === 'saving' && (
          <span className="ml-1 text-xs text-fg-subtle">Saving…</span>
        )}
        {feedbackState === 'saved' && (
          <span
            role="status"
            aria-live="polite"
            className="ml-1 inline-flex items-center gap-1 rounded bg-success-bg px-2 py-0.5 text-xs text-success"
          >
            Thanks
          </span>
        )}
        {feedbackState === 'error' && (
          <span className="ml-1 text-xs text-danger">
            Couldn&apos;t save
          </span>
        )}
      </div>

      {showReason && rating === 'down' && (
        <div className="mt-2 flex items-start gap-2">
          <textarea
            value={reasonDraft}
            onChange={(e) => setReasonDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleReasonSubmit();
              }
            }}
            placeholder="What was wrong? (optional)"
            aria-label="Reason for thumbs down"
            rows={2}
            className="flex-1 resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent placeholder:text-fg-subtle"
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleReasonSubmit}
              className="rounded-md bg-accent px-2 py-1 text-xs text-accent-fg hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowReason(false)}
              className="rounded-md border border-border-strong px-2 py-1 text-xs text-fg-muted hover:bg-elevated focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CopyIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function ThumbsUpIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 10v11" />
      <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.99 2.2l-.8 8A2 2 0 0 1 19.03 22H7V10l5-8a2 2 0 0 1 3 2.88Z" />
    </svg>
  );
}

function ThumbsDownIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 14V3" />
      <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.99-2.2l.8-8A2 2 0 0 1 4.97 2H17v12l-5 8a2 2 0 0 1-3-2.88Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
