import { extractLinksFromMarkdownText, stripLinksFromMarkdownText } from '@/lib/markdown-embeds.js';

function extractToolName(name) {
  const match = String(name || '').match(/^(\w+)/);
  return match ? match[1] : name;
}

function parseMaybeJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function getWebEmbedMeta(card, toolName) {
  const meta = card?.resultMeta;
  if (meta?.embedType === 'search_results' && Array.isArray(meta.items) && meta.items.length) {
    return { query: meta.query || '', items: meta.items };
  }
  if (meta?.embedType === 'link' && Array.isArray(meta.items) && meta.items.length) {
    return { items: meta.items };
  }
  if (!['web_search', 'web_fetch'].includes(toolName)) return null;

  const parsed = parseMaybeJson(card?.result);
  if (!parsed || typeof parsed !== 'object') return null;

  if (toolName === 'web_search' && Array.isArray(parsed.results) && parsed.results.length) {
    const items = parsed.results
      .slice(0, 8)
      .map((item) => ({
        type: 'link',
        url: String(item?.url || '').trim(),
        title: String(item?.title || '').trim(),
        description: String(item?.description || '').trim(),
        siteName: String(item?.hostname || '').trim(),
      }))
      .filter((item) => item.url);
    if (!items.length) return null;
    return { query: String(parsed.query || '').trim(), items };
  }

  if (toolName === 'web_fetch') {
    const url = String(parsed.final_url || parsed.url || '').trim();
    if (!url) return null;
    return {
      items: [{
        type: 'link',
        url,
        title: String(parsed.title || url).trim(),
        description: String(parsed.description || '').trim(),
      }],
    };
  }

  return null;
}

export function collectMessageEmbeds(segments = []) {
  const items = [];
  const seen = new Set();

  const addItem = (item) => {
    const url = String(item?.url || '').trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    items.push(item);
  };

  for (const seg of segments) {
    if (seg?.type === 'tools' && Array.isArray(seg.cards)) {
      for (const card of seg.cards) {
        if (card?.status === 'running') continue;
        const toolName = extractToolName(card.name);
        const webEmbed = getWebEmbedMeta(card, toolName);
        if (!webEmbed?.items?.length) continue;
        for (const item of webEmbed.items) addItem(item);
      }
    }

    if (seg?.type === 'text' && seg.text) {
      for (const item of extractLinksFromMarkdownText(seg.text)) {
        addItem(item);
      }
    }
  }

  return items;
}

export function markdownWithoutEmbeds(text) {
  return stripLinksFromMarkdownText(text);
}
