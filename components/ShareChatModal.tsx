'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type SharePublic = {
  id: string;
  token: string;
  url: string;
  title: string | null;
  owner_display_name: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
  require_auth: boolean;
  include_context: boolean;
  view_count: number;
};

type Message = { id: string; role: 'user' | 'assistant'; content: string };

type Props = {
  open: boolean;
  onClose: () => void;
  chatId: string | null;
  title: string | null;
  messages: Message[];
  // Notifies the parent when this chat has an active share (and what
  // its row id is) so the parent can keep the snapshot in sync after
  // future turns. `shareId` is null when sharing is off / revoked.
  onShareChange?: (chatId: string, shareId: string | null) => void;
};

// Persist current settings between create/revoke cycles so the user
// doesn't have to re-toggle every time.
type Defaults = { require_auth: boolean; include_context: boolean };
const DEFAULTS_KEY = 'pathovai-share-defaults';

function loadDefaults(): Defaults {
  if (typeof window === 'undefined') return { require_auth: true, include_context: false };
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return { require_auth: true, include_context: false };
    const parsed = JSON.parse(raw);
    return {
      require_auth: typeof parsed.require_auth === 'boolean' ? parsed.require_auth : true,
      include_context:
        typeof parsed.include_context === 'boolean' ? parsed.include_context : false,
    };
  } catch {
    return { require_auth: true, include_context: false };
  }
}

function saveDefaults(d: Defaults) {
  try {
    localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

export default function ShareChatModal({
  open,
  onClose,
  chatId,
  title,
  messages,
  onShareChange,
}: Props) {
  const [share, setShare] = useState<SharePublic | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Defaults>({
    require_auth: true,
    include_context: false,
  });
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    setDefaults(loadDefaults());
  }, [open]);

  // Look up an existing share for this chat each time the modal opens
  // so the toggles + URL reflect server state, not stale local state.
  useEffect(() => {
    if (!open || !chatId) {
      setShare(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/shared-chats?chat_id=${encodeURIComponent(chatId)}`)
      .then((r) => r.json().then((j) => ({ ok: r.ok, body: j })))
      .then(({ ok, body }) => {
        if (cancelled) return;
        if (!ok) {
          setError(body?.error || 'Could not load sharing state');
          setShare(null);
          if (chatId) onShareChange?.(chatId, null);
        } else {
          const next = body.share || null;
          setShare(next);
          if (chatId) onShareChange?.(chatId, next?.id || null);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setError('Network error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // onShareChange is intentionally excluded -- parents pass an inline
    // callback, so including it would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId]);

  // Esc to close, focus management.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(id);
  }, [toast]);

  const enableSharing = useCallback(async () => {
    if (!chatId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/shared-chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          title,
          messages,
          require_auth: defaults.require_auth,
          include_context: defaults.include_context,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || 'Could not create share link');
      } else {
        setShare(body.share);
        onShareChange?.(chatId, body.share?.id || null);
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }, [chatId, title, messages, defaults, onShareChange]);

  const stopSharing = useCallback(async () => {
    if (!share) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/shared-chats/${share.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.error || 'Could not revoke share link');
      } else {
        setShare(null);
        setToast('Sharing stopped');
        if (chatId) onShareChange?.(chatId, null);
      }
    } catch {
      setError('Network error');
    } finally {
      setBusy(false);
    }
  }, [share, chatId, onShareChange]);

  const updateSetting = useCallback(
    async (patch: Partial<Pick<SharePublic, 'require_auth' | 'include_context'>>) => {
      // Optimistic update so toggles feel instant.
      const previous = share;
      const nextDefaults = { ...defaults, ...patch };
      setDefaults(nextDefaults);
      saveDefaults(nextDefaults);
      if (!share) return;
      setShare({ ...share, ...patch });
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/shared-chats/${share.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const body = await res.json();
        if (!res.ok) {
          setError(body?.error || 'Could not update settings');
          setShare(previous);
        } else {
          setShare(body.share);
        }
      } catch {
        setError('Network error');
        setShare(previous);
      } finally {
        setBusy(false);
      }
    },
    [share, defaults]
  );

  const copyLink = useCallback(async () => {
    if (!share) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setToast('Link copied');
    } catch {
      // Fallback for older browsers / restricted contexts.
      const ta = document.createElement('textarea');
      ta.value = share.url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        setToast('Link copied');
      } catch {
        setError('Copy failed -- select the link and copy manually');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [share]);

  if (!open) return null;

  const sharingOn = !!share;
  const requireAuth = sharingOn ? share!.require_auth : defaults.require_auth;
  const includeContext = sharingOn ? share!.include_context : defaults.include_context;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg/70 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border-strong bg-elevated shadow-2xl">
        <div className="flex items-start justify-between px-5 pt-4 pb-3 border-b border-border">
          <h2 id="share-modal-title" className="text-base font-semibold text-fg">
            Share this chat
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label="Close share dialog"
            className="text-fg-muted hover:text-fg -mt-1 -mr-1 p-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg rounded"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {loading ? (
            <p className="text-sm text-fg-muted">Loading…</p>
          ) : (
            <>
              <ToggleRow
                id="share-toggle-enabled"
                label="Sharing enabled"
                checked={sharingOn}
                disabled={busy || !chatId}
                onChange={(next) => (next ? enableSharing() : stopSharing())}
              />

              {sharingOn && share && (
                <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
                  <div>
                    <label
                      htmlFor="share-link"
                      className="block text-xs font-medium text-fg-muted mb-1"
                    >
                      Share link
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="share-link"
                        type="text"
                        readOnly
                        value={share.url}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 rounded-md border border-border-strong bg-bg px-2 py-1.5 text-xs text-fg outline-none focus:border-accent"
                      />
                      <button
                        onClick={copyLink}
                        className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                      >
                        Copy link
                      </button>
                    </div>
                  </div>

                  <ToggleRow
                    id="share-require-auth"
                    label="Require sign-in to view"
                    description={
                      requireAuth
                        ? 'Only signed-in PathovAI users can open this link.'
                        : 'Anyone with the link can view.'
                    }
                    checked={requireAuth}
                    disabled={busy}
                    onChange={(next) => updateSetting({ require_auth: next })}
                  />

                  <ToggleRow
                    id="share-include-context"
                    label="Include conversation context"
                    description="Show pinned notes and attachment text on the shared view."
                    checked={includeContext}
                    disabled={busy}
                    onChange={(next) => updateSetting({ include_context: next })}
                  />

                  <p className="text-xs text-fg-subtle">
                    {share.view_count === 0
                      ? 'Not viewed yet.'
                      : `Viewed ${share.view_count} time${share.view_count === 1 ? '' : 's'}.`}
                  </p>

                  <button
                    onClick={stopSharing}
                    disabled={busy}
                    className="w-full rounded-md border border-danger/40 bg-danger-bg px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-danger focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                  >
                    Stop sharing
                  </button>
                </div>
              )}

              {!sharingOn && (
                <div className="space-y-3 rounded-lg border border-border bg-surface p-3 opacity-70">
                  <ToggleRow
                    id="share-require-auth-pre"
                    label="Require sign-in to view"
                    description="Default for new share links."
                    checked={requireAuth}
                    disabled={busy}
                    onChange={(next) => {
                      const d = { ...defaults, require_auth: next };
                      setDefaults(d);
                      saveDefaults(d);
                    }}
                  />
                  <ToggleRow
                    id="share-include-context-pre"
                    label="Include conversation context"
                    description="Default for new share links."
                    checked={includeContext}
                    disabled={busy}
                    onChange={(next) => {
                      const d = { ...defaults, include_context: next };
                      setDefaults(d);
                      saveDefaults(d);
                    }}
                  />
                </div>
              )}

              {error && <p className="text-xs text-danger">{error}</p>}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border text-xs text-fg-subtle space-y-1">
          <p>
            Shared chats are read-only. The viewer cannot send messages or see
            other chats.
          </p>
          <p>Shared views always show the latest version of this chat.</p>
        </div>

        {toast && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-elevated border border-border-strong px-3 py-1.5 text-xs text-fg shadow-lg"
          >
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
          checked ? 'bg-accent' : 'bg-border-strong'
        } disabled:opacity-60`}
      >
        <span
          aria-hidden
          className={`inline-block h-4 w-4 transform rounded-full bg-fg transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
      <label htmlFor={id} className="flex-1 cursor-pointer select-none">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description && (
          <span className="block text-xs text-fg-subtle mt-0.5">{description}</span>
        )}
      </label>
    </div>
  );
}
