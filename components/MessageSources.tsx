'use client';

import { useState } from 'react';

export type SourceRef = {
  id: string;
  title: string;
  snippet: string;
};

type Props = {
  sources: SourceRef[] | undefined;
};

export default function MessageSources({ sources }: Props) {
  const [open, setOpen] = useState(false);

  const hasKbSources = Array.isArray(sources) && sources.length > 0;
  if (!hasKbSources) return null;
  const count = sources!.length;

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-fg-subtle hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <svg
          aria-hidden="true"
          className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span>Sources ({count})</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-2 border-l border-border pl-3">
          {sources!.map((s) => (
            <li key={s.id} className="space-y-0.5">
              <p className="font-medium text-fg">{s.title}</p>
              {s.snippet && (
                <p className="text-fg-muted">{s.snippet}</p>
              )}
              <p className="text-[10px] uppercase tracking-wide text-fg-subtle">
                KB · {s.id.slice(0, 8)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
