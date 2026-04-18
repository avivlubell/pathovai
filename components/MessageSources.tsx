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
  // Count includes the generic fallback line when no KB records were used.
  const count = hasKbSources ? sources!.length : 1;

  return (
    <div className="mt-1 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded text-slate-500 hover:text-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
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
        <ul className="mt-2 space-y-2 border-l border-slate-800 pl-3">
          {hasKbSources &&
            sources!.map((s) => (
              <li key={s.id} className="space-y-0.5">
                <p className="font-medium text-slate-300">{s.title}</p>
                {s.snippet && (
                  <p className="text-slate-500">{s.snippet}</p>
                )}
                <p className="text-[10px] uppercase tracking-wide text-slate-600">
                  KB · {s.id.slice(0, 8)}
                </p>
              </li>
            ))}
          {!hasKbSources && (
            <li className="text-slate-500">General medtech industry knowledge</li>
          )}
        </ul>
      )}
    </div>
  );
}
