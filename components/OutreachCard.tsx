'use client';

import { useState } from 'react';

export type OutreachEvidence = { id: string; claim: string; source: string; date?: string };

type OutreachTouch = {
  subject?: string | null;
  body: string;
  cta: string;
  references: Array<{ pic_section: string; evidence_id: string }>;
};

type QaCheck = {
  passed: boolean;
  found?: string[];
  matched_pattern?: string;
  violations?: string[];
  dangling_references?: string[];
};

type QaPerTouch = {
  banned_phrases: QaCheck;
  generic_opener: QaCheck;
  channel_constraints: QaCheck;
  evidence_cited: QaCheck;
};

export type OutreachDraft = {
  pic: {
    account: { name: string; segment?: string };
    evidence: OutreachEvidence[];
    problem_diagnosis: { cost_of_inaction: string; why_now: string; likely_root_cause: string };
    hypothesis: { gap: string };
    confidence: 'high' | 'medium' | 'low';
  };
  target: { name: string; title: string; why_this_person: string };
  sequence: {
    linkedin_request: OutreachTouch;
    email_1: OutreachTouch;
    email_2: OutreachTouch;
  };
  messaging_strategy: { primary_hook: string; personalization_notes: string };
  qa?: {
    passed: boolean;
    per_touch?: Record<string, QaPerTouch>;
    failures?: string[];
    retried?: boolean;
  };
};

type TouchKey = 'linkedin_request' | 'email_1' | 'email_2';

const TABS: { key: TouchKey; label: string; channel: 'linkedin' | 'email' }[] = [
  { key: 'linkedin_request', label: 'LinkedIn', channel: 'linkedin' },
  { key: 'email_1', label: 'Email 1', channel: 'email' },
  { key: 'email_2', label: 'Email 2', channel: 'email' },
];

const BANNED = [
  'just checking in', 'hope this finds you', 'touching base',
  'circling back', 'quick question', "hope you're doing well", 'i wanted to reach out',
];

function wordCount(t: string) { return t.trim().split(/\s+/).filter(Boolean).length; }
function hasBanned(t: string) { const l = t.toLowerCase(); return BANNED.some(p => l.includes(p)); }
function bannedIn(t: string) { const l = t.toLowerCase(); return BANNED.find(p => l.includes(p)) ?? null; }

export default function OutreachCard({ draft }: { draft: OutreachDraft }) {
  const [activeTab, setActiveTab] = useState<TouchKey>('email_1');
  const [subjectEdits, setSubjectEdits] = useState<Record<string, string>>({});
  const [rubricOpen, setRubricOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [gmailOpened, setGmailOpened] = useState(false);

  const tabInfo = TABS.find(t => t.key === activeTab)!;
  const touch = draft.sequence[activeTab];
  const qaForTouch = draft.qa?.per_touch?.[activeTab];
  const channel = tabInfo.channel;

  const subject = subjectEdits[activeTab] ?? touch.subject ?? '';
  const body = touch.body ?? '';

  const subjectWordCount = wordCount(subject);
  const subjectBanned = hasBanned(subject);
  const subjectOver = channel === 'email' && subjectWordCount > 8;

  const bodyWordCount = wordCount(body);
  const bodyCharCount = body.length;
  const bodyValue = channel === 'email' ? bodyWordCount : bodyCharCount;
  const bodyLimit = channel === 'email' ? 120 : 300;
  const bodyUnit = channel === 'email' ? 'w' : 'c';
  const bodyOver = bodyValue > bodyLimit;

  const checks = [
    ...(channel === 'email' ? [
      {
        label: 'Subject ≤ 8 words',
        pass: !subjectOver,
        detail: `${subjectWordCount} words`,
        live: true,
      },
      {
        label: 'No banned phrases in subject',
        pass: !subjectBanned,
        detail: subjectBanned ? `"${bannedIn(subject)}"` : 'Clean',
        live: true,
      },
    ] : []),
    {
      label: `Body ≤ ${bodyLimit}${bodyUnit}`,
      pass: !bodyOver,
      detail: `${bodyValue} / ${bodyLimit}`,
      live: false,
    },
    {
      label: 'No banned phrases in body',
      pass: qaForTouch?.banned_phrases?.passed ?? true,
      detail: !(qaForTouch?.banned_phrases?.passed ?? true)
        ? (qaForTouch?.banned_phrases?.found?.join(', ') ?? 'Failed')
        : 'Clean',
      live: false,
    },
    {
      label: 'No generic opener',
      pass: qaForTouch?.generic_opener?.passed ?? true,
      detail: !(qaForTouch?.generic_opener?.passed ?? true)
        ? (qaForTouch?.generic_opener?.matched_pattern ?? 'Failed')
        : 'Clean',
      live: false,
    },
    {
      label: 'Evidence cited',
      pass: qaForTouch?.evidence_cited?.passed ?? touch.references.length > 0,
      detail: touch.references.length > 0
        ? `${touch.references.length} ref${touch.references.length !== 1 ? 's' : ''}`
        : 'No references',
      live: false,
    },
  ];

  const passing = checks.filter(c => c.pass).length;
  const total = checks.length;
  const codeFails = checks.filter(c => c.live && !c.pass).length;
  const staticFails = checks.filter(c => !c.live && !c.pass).length;
  const chipColor = codeFails > 0 ? 'text-danger' : staticFails > 0 ? 'text-warning' : 'text-success';

  const evidenceIds = new Set(touch.references.map(r => r.evidence_id));
  const touchEvidence = draft.pic.evidence.filter(e => evidenceIds.has(e.id));

  async function copyTouch() {
    const parts: string[] = [];
    if (channel === 'email' && subject) parts.push(`Subject: ${subject}`);
    parts.push(body);
    if (touch.cta) parts.push(`\n${touch.cta}`);
    await navigator.clipboard.writeText(parts.join('\n')).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function openInGmail() {
    const url =
      'https://mail.google.com/mail/?view=cm&fs=1' +
      (subject ? `&su=${encodeURIComponent(subject)}` : '') +
      `&body=${encodeURIComponent(body)}`;
    window.open(url, 'gmail-compose', 'width=900,height=700,resizable=yes,scrollbars=yes');
    setGmailOpened(true);
    setTimeout(() => setGmailOpened(false), 2000);
  }

  const confidenceColor =
    draft.pic.confidence === 'high' ? 'text-success border-success/30 bg-success/5' :
    draft.pic.confidence === 'low'  ? 'text-warning border-warning/30 bg-warning/5' :
    'text-fg-muted border-border';

  return (
    <div className="mt-3 rounded-xl border border-border bg-surface overflow-hidden text-sm">
      {/* Tab row */}
      <div className="flex items-center border-b border-border px-4 pt-2.5">
        {TABS.map(tab => {
          const tqa = draft.qa?.per_touch?.[tab.key];
          const hasFail = tqa
            ? !tqa.banned_phrases.passed || !tqa.generic_opener.passed || !tqa.channel_constraints.passed
            : false;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent text-fg font-medium'
                  : 'border-transparent text-fg-muted hover:text-fg'
              }`}
            >
              {tab.label}
              {hasFail && <span className="text-danger text-[9px]" aria-label="QA issue">●</span>}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2 pb-1.5">
          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${confidenceColor}`}>
            {draft.pic.confidence} confidence
          </span>
          {channel === 'email' && (
            <button
              type="button"
              onClick={openInGmail}
              className="text-[10px] px-2 py-0.5 rounded border border-border-strong text-fg-muted hover:text-fg hover:bg-elevated transition-colors"
            >
              {gmailOpened ? 'Opened!' : 'Gmail'}
            </button>
          )}
          <button
            type="button"
            onClick={copyTouch}
            className="text-[10px] px-2 py-0.5 rounded border border-border-strong text-fg-muted hover:text-fg hover:bg-elevated transition-colors"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Body + evidence */}
      <div className="flex">
        <div className="flex-1 min-w-0 px-4 py-3 space-y-3">

          {/* Subject */}
          {channel === 'email' && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wide text-fg-subtle font-medium w-12 flex-shrink-0">Subject</span>
              <input
                type="text"
                value={subject}
                onChange={e => setSubjectEdits(prev => ({ ...prev, [activeTab]: e.target.value }))}
                aria-label="Email subject"
                className={`flex-1 px-2 py-0.5 rounded border bg-elevated text-fg text-xs transition-colors focus:outline-none focus:border-accent ${
                  subjectOver || subjectBanned ? 'border-danger' : 'border-transparent hover:border-border'
                }`}
              />
              <span className={`text-[10px] tabular-nums flex-shrink-0 ${subjectOver || subjectBanned ? 'text-danger' : 'text-fg-muted'}`}>
                {subjectWordCount}w
              </span>
            </div>
          )}

          {/* Rubric chip */}
          <div>
            <button
              type="button"
              onClick={() => setRubricOpen(o => !o)}
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-border bg-elevated text-[11px] hover:bg-border transition-colors"
            >
              <span className={`font-bold ${chipColor}`}>
                {passing === total ? '✓' : `${passing}/${total}`}
              </span>
              <span className="text-fg-muted">
                {passing === total ? 'All checks pass' : `${passing} / ${total} pass`}
              </span>
              <svg
                className={`w-3 h-3 text-fg-subtle transition-transform ${rubricOpen ? 'rotate-180' : ''}`}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6"/>
              </svg>
            </button>
            {rubricOpen && (
              <div className="mt-2 space-y-1.5 pl-1">
                {checks.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5">
                    <span className={`text-xs font-bold mt-0.5 flex-shrink-0 w-3 ${c.pass ? 'text-success' : 'text-danger'}`}>
                      {c.pass ? '✓' : '✗'}
                    </span>
                    <div>
                      <span className="text-xs text-fg">{c.label}</span>
                      {c.live && (
                        <span className="ml-1.5 text-[9px] uppercase tracking-wide text-fg-subtle border border-border rounded px-1">live</span>
                      )}
                      <p className="text-[11px] text-fg-muted">{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-fg-subtle font-medium">Body</span>
              <span className={`text-[10px] tabular-nums ${bodyOver ? 'text-danger' : 'text-fg-muted'}`}>
                {bodyValue} / {bodyLimit}{bodyUnit}
              </span>
            </div>
            <p className="text-sm text-fg leading-relaxed whitespace-pre-wrap">{body}</p>
          </div>

          {/* CTA */}
          {touch.cta && (
            <div className="flex items-baseline gap-2 pt-0.5">
              <span className="text-[10px] uppercase tracking-wide text-fg-subtle font-medium flex-shrink-0 w-12">CTA</span>
              <p className="text-xs text-fg-muted italic">{touch.cta}</p>
            </div>
          )}
        </div>

        {/* Evidence rail */}
        {touchEvidence.length > 0 && (
          <div className="w-52 flex-shrink-0 border-l border-border p-3 space-y-2">
            <p className="text-[10px] uppercase tracking-wide text-fg-subtle font-medium mb-1">Evidence used</p>
            {touchEvidence.map(ev => (
              <div key={ev.id} className="rounded-lg border border-border bg-bg/50 p-2.5">
                <p className="text-[10px] font-semibold text-fg-muted uppercase tracking-wide">
                  <span className="text-accent mr-0.5">{ev.id}</span>
                  {ev.source}
                </p>
                <p className="text-[11px] text-fg mt-1 leading-relaxed">{ev.claim}</p>
                {ev.date && <p className="text-[10px] text-fg-subtle mt-0.5">{ev.date}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
