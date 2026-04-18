'use client';

import { useEffect, useRef, useState } from 'react';

type Freshness = {
  last_updated_at: string | null;
  record_count: number;
};

type CacheEntry = {
  fetchedAt: number;
  data: Freshness;
};

// Module-level cache shared across mounts; avoids refetching on every
// route change within a 60s window.
const CACHE_TTL_MS = 60_000;
let cache: CacheEntry | null = null;

async function fetchFreshness(): Promise<Freshness | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.data;
  }
  try {
    const res = await fetch('/api/kb-freshness', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Freshness;
    cache = { fetchedAt: Date.now(), data };
    return data;
  } catch {
    return null;
  }
}

function diffHours(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

function relativeTime(iso: string): string {
  const hours = diffHours(iso);
  if (hours < 1) {
    const mins = Math.max(1, Math.round(hours * 60));
    return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  }
  if (hours < 24) {
    const h = Math.round(hours);
    return `${h} hour${h === 1 ? '' : 's'} ago`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const w = Math.floor(days / 7);
    return `${w} week${w === 1 ? '' : 's'} ago`;
  }
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}

function compactTime(iso: string): string {
  const hours = diffHours(iso);
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  return `${Math.floor(days / 30)}mo`;
}

function dotColorFor(iso: string | null): {
  color: string;
  stale: boolean;
  tone: 'fresh' | 'warn' | 'stale';
} {
  if (!iso) return { color: 'bg-border-strong', stale: false, tone: 'stale' };
  const hours = diffHours(iso);
  if (hours < 24) return { color: 'bg-success', stale: false, tone: 'fresh' };
  if (hours < 24 * 7) return { color: 'bg-warning', stale: false, tone: 'warn' };
  return { color: 'bg-danger', stale: true, tone: 'stale' };
}

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${date} · ${time}`;
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

export default function KbFreshness() {
  const [data, setData] = useState<Freshness | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFreshness().then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    function onClickAway(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false);
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
  }, [mobileOpen]);

  if (!data) return null;

  const { last_updated_at, record_count } = data;
  const dot = dotColorFor(last_updated_at);
  const relative = last_updated_at ? relativeTime(last_updated_at) : 'unknown';
  const compact = last_updated_at ? compactTime(last_updated_at) : '—';
  const absolute = last_updated_at ? formatAbsolute(last_updated_at) : null;
  const staleLabel = dot.stale ? ' · Stale' : '';
  const tooltipText = [
    absolute ? `Last sync: ${absolute}` : 'Last sync: unknown',
    `${formatCount(record_count)} records`,
  ].join(' · ');
  const ariaLabel = `Knowledge base updated ${relative}${staleLabel}. ${tooltipText}.`;

  return (
    <div ref={containerRef} className="group relative inline-flex min-w-0">
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setMobileOpen((o) => !o)}
        className="inline-flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-fg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <span
          aria-hidden
          className={`h-2 w-2 flex-shrink-0 rounded-full ${dot.color}`}
        />
        <span className="truncate">
          <span className="hidden md:inline">KB updated {relative}</span>
          <span className="md:hidden">{compact}</span>
          {dot.stale && (
            <span className="ml-1 font-medium text-danger">Stale</span>
          )}
        </span>
      </button>
      <div
        role="tooltip"
        className={`absolute left-0 top-full z-30 mt-1 w-max max-w-xs rounded-md border border-border-strong bg-elevated px-3 py-2 text-xs text-fg shadow-lg transition ${
          mobileOpen
            ? 'opacity-100'
            : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'
        }`}
      >
        {absolute ? (
          <p>
            <span className="text-fg-muted">Last sync:</span> {absolute}
          </p>
        ) : (
          <p className="text-fg-muted">Last sync unknown</p>
        )}
        <p>
          <span className="text-fg-muted">Records:</span>{' '}
          {formatCount(record_count)}
        </p>
      </div>
    </div>
  );
}
