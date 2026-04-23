'use client';

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type Props = { content: string };

function CopyableCodeBlock({ children }: { children: React.ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const text = preRef.current?.innerText ?? '';
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="relative my-3 group/codeblock">
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-md bg-surface border border-border p-3 text-sm font-mono text-fg whitespace-pre-wrap"
      >
        {children}
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 opacity-0 group-hover/codeblock:opacity-100 transition-opacity px-2 py-1 text-xs rounded bg-elevated text-fg-muted hover:text-fg border border-border"
        aria-label="Copy code"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export default function MessageContent({ content }: Props) {
  return (
    <div className="text-fg leading-relaxed [overflow-wrap:anywhere]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          h1: (props) => (
            <h1 className="mt-4 mb-2 text-2xl font-bold text-fg" {...props} />
          ),
          h2: (props) => (
            <h2 className="mt-4 mb-2 text-xl font-bold text-fg" {...props} />
          ),
          h3: (props) => (
            <h3 className="mt-3 mb-2 text-lg font-semibold text-fg" {...props} />
          ),
          h4: (props) => (
            <h4 className="mt-3 mb-2 text-base font-semibold text-fg" {...props} />
          ),
          p: (props) => <p className="my-2 whitespace-pre-wrap" {...props} />,
          strong: (props) => <strong className="font-semibold text-fg" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          ul: (props) => (
            <ul className="my-2 list-disc pl-6 space-y-1" {...props} />
          ),
          ol: (props) => (
            <ol className="my-2 list-decimal pl-6 space-y-1" {...props} />
          ),
          li: (props) => <li className="leading-relaxed" {...props} />,
          blockquote: (props) => (
            <blockquote
              className="my-3 border-l-4 border-border-strong pl-4 italic text-fg-muted"
              {...props}
            />
          ),
          code: ({ className, children, ...props }) => {
            // fenced code blocks (with or without a language specifier) always
            // have their content end with \n; backtick inline code does not
            const isBlock =
              className?.includes('language-') ||
              (typeof children === 'string' && children.endsWith('\n'));
            if (isBlock) {
              return (
                <code
                  className={`${className ?? ''} block whitespace-pre-wrap`}
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="rounded bg-elevated px-1.5 py-0.5 font-mono text-[0.9em] text-fg"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre: ({ node: _node, ...props }) => (
            <CopyableCodeBlock>
              {props.children}
            </CopyableCodeBlock>
          ),
          a: ({ href, children, ...props }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent underline hover:text-accent-hover"
              {...props}
            >
              {children}
            </a>
          ),
          hr: (props) => <hr className="my-4 border-border" {...props} />,
          table: (props) => (
            <div className="my-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-sm" {...props} />
            </div>
          ),
          th: (props) => (
            <th
              className="border border-border bg-surface px-2 py-1 text-left font-semibold"
              {...props}
            />
          ),
          td: (props) => (
            <td className="border border-border px-2 py-1" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
