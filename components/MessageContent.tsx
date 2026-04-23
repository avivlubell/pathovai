'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

type Props = { content: string };

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
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code
                  className={`${className ?? ''} block`}
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
          pre: (props) => (
            <pre
              className="my-3 overflow-x-auto rounded-md bg-surface border border-border p-3 text-sm font-mono text-fg whitespace-pre-wrap"
              {...props}
            />
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
