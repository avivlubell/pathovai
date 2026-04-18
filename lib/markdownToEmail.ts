// Strip markdown to a plain-text email body while preserving paragraph
// breaks and list structure.
export function markdownToEmail(md: string): string {
  let text = md;

  // Fenced code blocks -> keep the inner text, drop the fences.
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, (_m, code) =>
    String(code).replace(/\n+$/, '')
  );

  // Images: ![alt](url) -> alt
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');

  // Links: [text](url) -> text (url); keep URL inline so it's still usable.
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // Inline code: `code` -> code
  text = text.replace(/`([^`]+)`/g, '$1');

  // Bold + italic (handle ** and __ and * and _).
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1');
  text = text.replace(/__([^_]+)__/g, '$1');
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  text = text.replace(/(^|[^_])_([^_\n]+)_/g, '$1$2');

  // Blockquote markers.
  text = text.replace(/^\s{0,3}>\s?/gm, '');

  // Headings: strip leading #'s but keep the text.
  text = text.replace(/^\s{0,3}#{1,6}\s+/gm, '');

  // Unordered list markers: "- ", "* ", "+ " -> "- "
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1- ');

  // Ordered list markers: keep the "1. " style.
  // (no-op — already readable)

  // Horizontal rules -> blank line.
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, '');

  // Collapse 3+ consecutive newlines into 2 (standard paragraph break).
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}
