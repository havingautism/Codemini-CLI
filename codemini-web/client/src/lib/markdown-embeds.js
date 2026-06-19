const STANDALONE_URL_RE = /^https?:\/\/[^\s<>)\]"']+$/i;
const INLINE_URL_RE = /https?:\/\/[^\s<>)\]"']+/gi;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const STANDALONE_MARKDOWN_IMAGE_RE = /^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)$/i;
const STANDALONE_LINKED_MARKDOWN_IMAGE_RE = /^\[!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)\]\((https?:\/\/[^\s)]+)\)$/i;
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

function flattenMarkdownParts(parts, { includeLinks = true } = {}) {
  const flattened = [];
  for (const part of parts) {
    if (part.type === 'embed' || part.type === 'image') {
      flattened.push(part);
      continue;
    }
    if (!part.text?.trim()) continue;
    if (includeLinks) flattened.push(...splitInlineUrls(part.text));
    else flattened.push(part);
  }
  return flattened;
}

export function splitMarkdownForEmbeds(text, { includeLinks = true } = {}) {
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
    if (includeLinks && isStandaloneUrl(trimmed)) {
      flushMarkdown();
      parts.push({ type: 'embed', url: trimmed });
      continue;
    }
    const linkedImageMatch = trimmed.match(STANDALONE_LINKED_MARKDOWN_IMAGE_RE);
    if (linkedImageMatch) {
      flushMarkdown();
      parts.push({
        type: 'image',
        alt: linkedImageMatch[1] || '',
        url: trimUrlTrailingPunctuation(linkedImageMatch[2]),
        href: trimUrlTrailingPunctuation(linkedImageMatch[3]),
      });
      continue;
    }
    const imageMatch = trimmed.match(STANDALONE_MARKDOWN_IMAGE_RE);
    if (imageMatch) {
      flushMarkdown();
      parts.push({
        type: 'image',
        alt: imageMatch[1] || '',
        url: trimUrlTrailingPunctuation(imageMatch[2]),
      });
      continue;
    }
    buffer.push(line);
  }

  flushMarkdown();
  const withInline = flattenMarkdownParts(parts.length ? parts : [{ type: 'markdown', text: source }], { includeLinks });
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

function linkDisplayLabel(url, fallback = 'Link') {
  const cleaned = trimUrlTrailingPunctuation(String(url || '').trim());
  if (!cleaned) return fallback;
  try {
    const parsed = new URL(cleaned);
    const display = `${parsed.hostname}${parsed.pathname}${parsed.search}`;
    if (display.length <= 52) return display;
    return `${display.slice(0, 49).trimEnd()}...`;
  } catch {
    return cleaned.length <= 52 ? cleaned : `${cleaned.slice(0, 49).trimEnd()}...`;
  }
}

function isPlaceholderLinkLabel(label) {
  const value = String(label || '').trim().toLowerCase();
  if (!value) return true;
  return [
    'link',
    'url',
    '链接',
    'thumbnail',
    '缩略图',
    '!thumbnail',
    'image',
    '图片',
  ].includes(value);
}

function normalizeLinkLabel(label, url, fallback = 'Link') {
  const trimmed = String(label || '').trim();
  if (isPlaceholderLinkLabel(trimmed)) {
    return linkDisplayLabel(url, fallback);
  }
  return trimmed;
}

function normalizeImageAlt(alt, url, fallback = 'Image') {
  const trimmed = String(alt || '').trim();
  if (isPlaceholderLinkLabel(trimmed)) {
    return fallback;
  }
  return trimmed || fallback;
}

export function normalizeMarkdownForDisplay(text, { linkFallback = 'Link', imageFallback = 'Image' } = {}) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return '';

  let normalized = source.replace(MARKDOWN_IMAGE_RE, (_full, alt, url) => {
    const nextAlt = normalizeImageAlt(alt, url, imageFallback);
    return `![${nextAlt}](${url})`;
  });
  MARKDOWN_IMAGE_RE.lastIndex = 0;

  normalized = normalized.replace(MARKDOWN_LINK_RE, (_full, label, url) => {
    const nextLabel = normalizeLinkLabel(label, url, linkFallback);
    return `[${nextLabel}](${url})`;
  });
  MARKDOWN_LINK_RE.lastIndex = 0;

  return normalized;
}
