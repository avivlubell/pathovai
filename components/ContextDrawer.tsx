'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type Attachment = {
  id: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  has_text: boolean;
  created_at: string;
};

type Props = {
  open: boolean;
  chatId: string | null;
  userId: string | null;
  onClose: () => void;
  onCountChange: (count: number) => void;
};

const ACCEPT =
  'application/pdf,.pdf,.docx,.txt,.md,.markdown,image/jpeg,image/png,.jpg,.jpeg,.png';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ContextDrawer({
  open,
  chatId,
  userId,
  onClose,
  onCountChange,
}: Props) {
  const [notes, setNotes] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle'
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const countFor = useCallback((n: string, atts: Attachment[]) => {
    return (n.trim() ? 1 : 0) + atts.length;
  }, []);

  const loadContext = useCallback(async () => {
    if (!chatId) {
      setNotes('');
      setAttachments([]);
      onCountChange(0);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/context?chat_id=${encodeURIComponent(chatId)}`
      );
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      const nextNotes = data.notes ?? '';
      const nextAtts: Attachment[] = data.attachments ?? [];
      setNotes(nextNotes);
      setAttachments(nextAtts);
      onCountChange(countFor(nextNotes, nextAtts));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [chatId, onCountChange, countFor]);

  useEffect(() => {
    if (!open) return;
    loadContext();
  }, [open, loadContext]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  async function saveNotes() {
    if (!chatId) return;
    setSaving('saving');
    try {
      const res = await fetch('/api/context', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, user_id: userId, notes }),
      });
      if (!res.ok) throw new Error('save failed');
      setSaving('saved');
      onCountChange(countFor(notes, attachments));
      window.setTimeout(() => setSaving('idle'), 1500);
    } catch (err) {
      console.error(err);
      setSaving('error');
    }
  }

  async function clearAll() {
    if (!chatId) return;
    const ok = window.confirm('Remove all notes and attachments for this chat?');
    if (!ok) return;
    try {
      const res = await fetch(
        `/api/context?chat_id=${encodeURIComponent(chatId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('clear failed');
      setNotes('');
      setAttachments([]);
      onCountChange(0);
    } catch (err) {
      console.error(err);
    }
  }

  async function uploadFiles(files: FileList | File[]) {
    if (!chatId) return;
    setUploadError(null);
    setUploading(true);
    try {
      const list = Array.from(files);
      for (const file of list) {
        const form = new FormData();
        form.append('chat_id', chatId);
        if (userId) form.append('user_id', userId);
        form.append('file', file);
        const res = await fetch('/api/context/attachments', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setUploadError(body.error || `Upload failed: ${file.name}`);
          continue;
        }
        const data = await res.json();
        const att: Attachment = data.attachment;
        setAttachments((prev) => {
          const next = [...prev, att];
          onCountChange(countFor(notes, next));
          return next;
        });
      }
    } finally {
      setUploading(false);
    }
  }

  async function removeAttachment(id: string) {
    try {
      const res = await fetch(`/api/context/attachments?id=${id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('delete failed');
      setAttachments((prev) => {
        const next = prev.filter((a) => a.id !== id);
        onCountChange(countFor(notes, next));
        return next;
      });
    } catch (err) {
      console.error(err);
    }
  }

  if (!open) return null;

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/50"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Conversation context"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-surface shadow-xl md:max-w-lg"
      >
        <header className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-base font-semibold text-fg">
            Conversation context
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close context"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-fg-muted hover:bg-elevated hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
          {!chatId && (
            <p className="rounded-md border border-border bg-elevated p-3 text-xs text-fg-muted">
              Start a new chat and send a message — or reopen this drawer —
              to attach context.
            </p>
          )}

          {/* Notes */}
          <section className="space-y-2">
            <label
              htmlFor="context-notes"
              className="block text-sm font-semibold text-fg"
            >
              Notes
            </label>
            <p className="text-xs text-fg-subtle">
              Anything Pathov should keep in mind for this conversation? e.g.,
              the prospect&apos;s recent press release, a competitor angle, a
              specific stakeholder note.
            </p>
            <textarea
              id="context-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={6}
              disabled={!chatId || loading}
              className="w-full resize-y rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent placeholder:text-fg-subtle disabled:opacity-50"
              placeholder="Type notes that should inform this chat only..."
            />
          </section>

          {/* Attachments */}
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-fg">Attachments</h3>
            <p className="text-xs text-fg-subtle">
              PDF, DOCX, TXT, MD, or images (jpg/png). Up to 15 MB each.
            </p>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (e.dataTransfer.files?.length) {
                  uploadFiles(e.dataTransfer.files);
                }
              }}
              className={`rounded-md border border-dashed px-4 py-6 text-center text-xs transition ${
                dragOver
                  ? 'border-accent bg-info-bg text-info'
                  : 'border-border text-fg-subtle hover:border-border-strong'
              } ${!chatId ? 'opacity-50 pointer-events-none' : ''}`}
            >
              <p>
                Drop files here or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="font-semibold text-accent underline hover:text-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
                >
                  browse
                </button>
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) uploadFiles(e.target.files);
                  e.target.value = '';
                }}
              />
              {uploading && (
                <p className="mt-2 text-accent-hover">Uploading…</p>
              )}
              {uploadError && (
                <p className="mt-2 text-danger">{uploadError}</p>
              )}
            </div>

            {attachments.length > 0 && (
              <ul className="mt-2 space-y-1">
                {attachments.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center gap-2 rounded-md border border-border bg-elevated px-3 py-2 text-sm"
                  >
                    <span className="flex-1 truncate text-fg" title={a.file_name}>
                      {a.file_name}
                    </span>
                    <span className="text-xs text-fg-subtle">
                      {formatBytes(a.file_size)}
                    </span>
                    {!a.has_text && (
                      <span
                        className="rounded bg-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-fg-muted"
                        title="No text was extracted from this file; it will not influence the LLM"
                      >
                        no text
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => removeAttachment(a.id)}
                      aria-label={`Remove ${a.file_name}`}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-fg-subtle hover:bg-border hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 6 6 18" />
                        <path d="m6 6 12 12" />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={clearAll}
            disabled={
              !chatId || (!notes.trim() && attachments.length === 0)
            }
            className="text-xs text-fg-subtle hover:text-danger disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
          >
            Clear context
          </button>
          <div className="flex items-center gap-2">
            {saving === 'saved' && (
              <span className="text-xs text-success">Saved</span>
            )}
            {saving === 'error' && (
              <span className="text-xs text-danger">Save failed</span>
            )}
            <button
              type="button"
              onClick={saveNotes}
              disabled={!chatId || saving === 'saving'}
              className="rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-accent-fg hover:bg-accent-hover disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              {saving === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </footer>
      </aside>
    </>
  );
}
