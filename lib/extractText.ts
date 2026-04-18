// Extract plain text from uploaded files. Unsupported types (images)
// return null so the upload still succeeds but contributes no text to
// the LLM context.
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<string | null> {
  const lowerName = fileName.toLowerCase();
  const type = (mimeType || '').toLowerCase();

  if (type === 'application/pdf' || lowerName.endsWith('.pdf')) {
    try {
      // pdf-parse ships no types; import subpath to avoid its debug-mode
      // top-level file read.
      // @ts-expect-error no type declarations for pdf-parse/lib/pdf-parse.js
      const mod = await import('pdf-parse/lib/pdf-parse.js');
      const parse = (mod as { default: (b: Buffer) => Promise<{ text: string }> }).default;
      const parsed = await parse(buffer);
      return parsed.text?.trim() || null;
    } catch (err) {
      console.error('pdf-parse failed', err);
      return null;
    }
  }

  if (
    type ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerName.endsWith('.docx')
  ) {
    try {
      const mammoth = await import('mammoth');
      const parseFn =
        (mammoth as unknown as { extractRawText?: (opts: { buffer: Buffer }) => Promise<{ value: string }> })
          .extractRawText ??
        (mammoth as unknown as { default: { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> } })
          .default.extractRawText;
      const result = await parseFn({ buffer });
      return result.value?.trim() || null;
    } catch (err) {
      console.error('mammoth failed', err);
      return null;
    }
  }

  if (
    type.startsWith('text/') ||
    lowerName.endsWith('.txt') ||
    lowerName.endsWith('.md') ||
    lowerName.endsWith('.markdown')
  ) {
    try {
      return buffer.toString('utf-8').trim() || null;
    } catch {
      return null;
    }
  }

  return null;
}
