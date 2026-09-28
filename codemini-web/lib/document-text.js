import { toMarkdownBytes } from '@firecrawl/anydoc';

export async function extractDocumentText(buffer) {
  return String(await toMarkdownBytes(buffer, null, { ocr: 'reject' })).trim();
}
