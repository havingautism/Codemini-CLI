const STANDALONE_URL_RE = /^https?:\/\/[^\s<>)\]"']+$/i;
const INLINE_URL_RE = /https?:\/\/[^\s<>)\]"']+/gi;
const MARKDOWN_LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/gi;
const AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/gi;

function trimUrlTrailingPunctuation(url) {
  return String(url || '').replace(/[.,;:!?)]+$/g, '');
}

function cleanupMarkdownText(text) {
  return String(text || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function isMarkdownLinkedUrl(text, startIndex) {
  if (startIndex >= 2 && text.slice(startIndex - 2, startIndex) === '](') return true;
  if (startIndex > 0 && text[startIndex - 1] === '(') return true;
  return false;
}

export function isStandaloneUrl(value) {
  const text = String(value || '').trim();
  if (!text || !STANDALONE_URL_RE.test(text)) return false;
  try {
    const parsed = new URL(text);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function splitInlineUrls(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return [];

  const parts = [];
  let lastIndex = 0;
  let match = INLINE_URL_RE.exec(source);

  while (match) {
    const rawUrl = match[0];
    const start = match.index;
    if (!isMarkdownLinkedUrl(source, start)) {
      const url = trimUrlTrailingPunctuation(rawUrl);
      if (start > lastIndex) {
        parts.push({ type: 'markdown', text: source.slice(lastIndex, start) });
      }
      parts.push({ type: 'embed', url });
      lastIndex = start + rawUrl.length;
    }
    match = INLINE_URL_RE.exec(source);
  }

  INLINE_URL_RE.lastIndex = 0;

  if (lastIndex < source.length) {
    parts.push({ type: 'markdown', text: source.slice(lastIndex) });
  }

  return parts.length ? parts : [{ type: 'markdown', text: source }];
}

function flattenMarkdownParts(parts) {
  const flattened = [];
  for (const part of parts) {
    if (part.type === 'embed') {
      flattened.push(part);
      continue;
    }
    if (!part.text?.trim()) continue;
    flattened.push(...splitInlineUrls(part.text));
  }
  return flattened;
}

export function splitMarkdownForEmbeds(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return [];

  const lines = source.split('\n');
  const parts = [];
  let buffer = [];

  const flushMarkdown = () => {
    if (!buffer.length) return;
    const chunk = buffer.join('\n');
    buffer = [];
    if (chunk.trim()) parts.push({ type: 'markdown', text: chunk });
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (isStandaloneUrl(trimmed)) {
      flushMarkdown();
      parts.push({ type: 'embed', url: trimmed });
      continue;
    }
    buffer.push(line);
  }

  flushMarkdown();
  const withInline = flattenMarkdownParts(parts.length ? parts : [{ type: 'markdown', text: source }]);
  return withInline.length ? withInline : [{ type: 'markdown', text: source }];
}

export function extractLinksFromMarkdownText(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return [];

  const items = [];
  const seen = new Set();
  const addItem = (item) => {
    const url = trimUrlTrailingPunctuation(String(item?.url || '').trim());
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push({
      type: item.type || 'link',
      url,
      ...(item.title ? { title: String(item.title).trim() } : {}),
      ...(item.description ? { description: String(item.description).trim() } : {}),
      ...(item.siteName ? { siteName: String(item.siteName).trim() } : {}),
    });
  };

  for (const match of source.matchAll(MARKDOWN_LINK_RE)) {
    addItem({ type: 'link', url: match[2], title: match[1] });
  }
  MARKDOWN_LINK_RE.lastIndex = 0;

  for (const match of source.matchAll(AUTOLINK_RE)) {
    addItem({ type: 'link', url: match[1] });
  }
  AUTOLINK_RE.lastIndex = 0;

  for (const part of splitMarkdownForEmbeds(source)) {
    if (part.type === 'embed') addItem({ type: 'link', url: part.url });
  }

  return items;
}

export function stripLinksFromMarkdownText(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return '';

  let stripped = source
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(AUTOLINK_RE, '');
  MARKDOWN_LINK_RE.lastIndex = 0;
  AUTOLINK_RE.lastIndex = 0;

  const parts = splitMarkdownForEmbeds(stripped);
  if (parts.length === 1 && parts[0].type === 'markdown') {
    return cleanupMarkdownText(parts[0].text);
  }
  return cleanupMarkdownText(
    parts
      .filter((part) => part.type === 'markdown')
      .map((part) => part.text)
      .join(''),
  );
}
