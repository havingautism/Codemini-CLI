import yaml from 'yaml';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---(?:\n|$)/;

export function parseFrontmatter(raw = '') {
  const normalized = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = normalized.match(FRONTMATTER_RE);
  if (!match) return { metadata: {}, content: normalized };
  try {
    const parsed = yaml.parse(match[1]);
    return {
      metadata: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
      content: normalized.slice(match[0].length).trim(),
    };
  } catch {
    return { metadata: {}, content: normalized };
  }
}

export function serializeFrontmatter(metadata = {}, content = '') {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== '');
  if (entries.length === 0) return String(content || '').trimStart();
  return `---\n${yaml.stringify(Object.fromEntries(entries), { lineWidth: 0 }).trimEnd()}\n---\n\n${String(content || '').trimStart()}`;
}
