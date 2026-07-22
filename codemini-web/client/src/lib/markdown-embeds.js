const STANDALONE_URL_RE = /^https?:\/\/[^\s<>)\]"']+$/i;
const INLINE_URL_RE = /https?:\/\/[^\s<>)\]"']+/gi;
const MARKDOWN_LINK_RE = /(?<!!)\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/gi;
const STANDALONE_MARKDOWN_IMAGE_RE = /^!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)$/i;
const STANDALONE_LINKED_MARKDOWN_IMAGE_RE = /^\[!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)\]\((https?:\/\/[^\s)]+)\)$/i;
const AUTOLINK_RE = /<(https?:\/\/[^>\s]+)>/gi;
const IMAGE_PATH_EXT_RE = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)$/i;
/** HN-style list meta: "— 40 points · 7 comments domain · 1h ago" */
const LIST_ITEM_META_RE =
  /^(\s*(?:\d+\.|[-*+])\s+.+?)( — \d[\d,]*\s+points?\s+·\s+\d[\d,]*\s+comments?\b.*)$/gim;

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

/** Mute trailing "— N points · N comments …" on list lines for hierarchy. */
export function softenListItemMeta(text) {
  return String(text || '').replace(LIST_ITEM_META_RE, (full, head, meta) => {
    if (meta.includes('*') || meta.includes('`')) return full;
    return `${head} *${meta.trim()}*`;
  });
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

/** True when a URL's pathname ends with a common image extension (query/hash ignored). */
export function isImageUrl(value) {
  const text = trimUrlTrailingPunctuation(String(value || '').trim());
  if (!text) return false;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, '');
    return IMAGE_PATH_EXT_RE.test(pathname);
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
    if (isStandaloneUrl(trimmed)) {
      const url = trimUrlTrailingPunctuation(trimmed);
      // Image file URLs always become inline images, even when link embeds are off
      // (chat body uses includeLinks=false and shows non-image links in the banner).
      if (isImageUrl(url)) {
        flushMarkdown();
        parts.push({ type: 'image', alt: '', url });
        continue;
      }
      if (includeLinks) {
        flushMarkdown();
        parts.push({ type: 'embed', url });
        continue;
      }
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
    if (!url || seen.has(url) || isImageUrl(url)) return;
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

export function extractInlineImagesFromMarkdown(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return [];

  const images = [];
  for (const match of source.matchAll(MARKDOWN_IMAGE_RE)) {
    images.push({
      url: trimUrlTrailingPunctuation(match[2]),
      alt: match[1] || '',
    });
  }
  MARKDOWN_IMAGE_RE.lastIndex = 0;
  return images;
}

export function groupGalleryParts(parts) {
  const grouped = [];
  let images = [];

  const flushImages = () => {
    if (!images.length) return;
    grouped.push({
      type: images.length > 1 ? 'gallery' : 'image',
      images,
    });
    images = [];
  };

  for (const part of parts) {
    if (part.type === 'image') {
      images.push(part);
      continue;
    }
    flushImages();
    grouped.push(part);
  }

  flushImages();
  return grouped;
}

export function collectMessageImages(text, { includeLinks = true } = {}) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return [];

  const parts = splitMarkdownForEmbeds(source, { includeLinks });
  const groupedParts = groupGalleryParts(parts);
  const images = [];

  for (const part of groupedParts) {
    if (part.type === 'image' || part.type === 'gallery') {
      for (const image of part.images) {
        images.push({ url: image.url, alt: image.alt || '' });
      }
      continue;
    }
    if (part.type === 'markdown' && part.text) {
      images.push(...extractInlineImagesFromMarkdown(part.text));
    }
  }

  return images;
}

export function createGalleryIndexResolver(images) {
  const list = Array.isArray(images) ? images : [];
  const seen = new Map();

  return ({ src, alt }) => {
    const url = String(src || '').trim();
    const normalizedAlt = String(alt || '');
    const key = `${url}\0${normalizedAlt}`;
    const count = seen.get(key) || 0;
    seen.set(key, count + 1);

    let occurrence = 0;
    for (let index = 0; index < list.length; index += 1) {
      const item = list[index];
      if (item.url === url && (item.alt || '') === normalizedAlt) {
        if (occurrence === count) return index;
        occurrence += 1;
      }
    }
    return 0;
  };
}

function looksLikeTableRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|')) return false;
  if (/^```/.test(trimmed)) return false;
  const cells = trimmed.split('|').length - 1;
  return cells >= 1 && (trimmed.startsWith('|') || trimmed.endsWith('|') || cells >= 2);
}

function isTableSeparatorRow(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|') && !/-{3,}/.test(trimmed)) return false;
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = body.split('|').map((cell) => cell.trim());
  if (!cells.length) return false;
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function promoteImageUrlInTableCell(cell) {
  const trimmed = String(cell || '').trim();
  if (!trimmed) return cell;

  if (isStandaloneUrl(trimmed) && isImageUrl(trimmed)) {
    const url = trimUrlTrailingPunctuation(trimmed);
    return String(cell).replace(trimmed, `![](${url})`);
  }

  // Whole-cell markdown link to an image file: [label](https://…/a.jpg)
  const linkMatch = trimmed.match(/^\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)$/i);
  if (linkMatch && isImageUrl(linkMatch[2])) {
    const alt = linkMatch[1] || '';
    const url = trimUrlTrailingPunctuation(linkMatch[2]);
    return String(cell).replace(trimmed, `![${alt}](${url})`);
  }

  return cell;
}

/** Turn whole-cell bare image URLs inside markdown tables into `![](url)`. */
export function promoteTableCellImageUrls(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.includes('|')) return source;

  const lines = source.split('\n');
  let inFence = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        return line;
      }
      if (inFence || !looksLikeTableRow(line) || isTableSeparatorRow(line)) {
        return line;
      }
      return line
        .split('|')
        .map((cell) => promoteImageUrlInTableCell(cell))
        .join('|');
    })
    .join('\n');
}

/**
 * Convert bare image file URLs (including lines like `👉 https://…/a.jpg`)
 * into markdown images. Skips URLs already inside markdown links/images and
 * fenced code blocks.
 */
export function promoteBareImageUrls(text) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return source;

  const lines = source.split('\n');
  let inFence = false;

  return lines
    .map((line) => {
      const trimmed = line.trim();
      if (/^```/.test(trimmed)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;

      INLINE_URL_RE.lastIndex = 0;
      return line.replace(INLINE_URL_RE, (raw, offset) => {
        if (isMarkdownLinkedUrl(line, offset)) return raw;
        const url = trimUrlTrailingPunctuation(raw);
        if (!isImageUrl(url)) return raw;
        const trailing = raw.slice(url.length);
        return `![](${url})${trailing}`;
      });
    })
    .join('\n');
}

export function normalizeMarkdownForDisplay(text, { linkFallback = 'Link', imageFallback = 'Image' } = {}) {
  const source = typeof text === 'string' ? text : String(text || '');
  if (!source.trim()) return '';

  let normalized = promoteBareImageUrls(promoteTableCellImageUrls(source));
  normalized = softenListItemMeta(normalized);

  // Prefer inline images when a markdown link points at an image file.
  normalized = normalized.replace(MARKDOWN_LINK_RE, (_full, label, url) => {
    if (isImageUrl(url)) {
      const nextAlt = normalizeImageAlt(label, url, imageFallback);
      return `![${nextAlt}](${url})`;
    }
    const nextLabel = normalizeLinkLabel(label, url, linkFallback);
    return `[${nextLabel}](${url})`;
  });
  MARKDOWN_LINK_RE.lastIndex = 0;

  normalized = normalized.replace(MARKDOWN_IMAGE_RE, (_full, alt, url) => {
    const nextAlt = normalizeImageAlt(alt, url, imageFallback);
    return `![${nextAlt}](${url})`;
  });
  MARKDOWN_IMAGE_RE.lastIndex = 0;

  return normalized;
}
