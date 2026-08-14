import fs from 'node:fs/promises';
import path from 'node:path';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.js';
import { getProjectHandoffsDir } from './paths.js';
import { trimInline } from './string-utils.js';

const DEFAULT_HANDOFF_FILE = 'handoff.md';
const CATALOG_LIMIT = 20;

function safeSegment(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return cleaned || fallback;
}

function relativePath(workspaceRoot, filePath) {
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function handoffFilename(summary) {
  const label = Array.from(String(summary || '')
    .normalize('NFKC')
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[. -]+|[. -]+$/g, ''))
    .slice(0, 48)
    .join('')
    .replace(/[. -]+$/g, '');
  return label ? `handoff-${label}.md` : DEFAULT_HANDOFF_FILE;
}

async function findHandoffFile(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && /^handoff(?:-.+)?\.md$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
  const filename = files.find((item) => item === DEFAULT_HANDOFF_FILE) || files[0];
  return filename ? path.join(dir, filename) : '';
}

export async function saveSubAgentHandoff({
  workspaceRoot,
  sessionId,
  handoffId,
  name,
  task,
  summary,
  text,
  artifactPaths = [],
  createdAt = new Date().toISOString(),
} = {}) {
  const handoffText = String(text || '').trim();
  if (!workspaceRoot || !sessionId || !handoffText) return null;
  const persona = trimInline(name || 'Subagent', 80);
  const id = safeSegment(
    handoffId,
    `${createdAt.replace(/\D/g, '').slice(0, 17)}-${safeSegment(persona, 'subagent')}`,
  );
  const dir = path.join(
    getProjectHandoffsDir(workspaceRoot, safeSegment(sessionId, 'session')),
    id,
  );
  const filePath = path.join(dir, handoffFilename(summary));
  const displayPath = relativePath(workspaceRoot, filePath);
  const compactSummary = trimInline(summary || handoffText, 240);
  const body = [
    `[已复用 ${persona} handoff: ${displayPath}]`,
    '',
    `# ${persona} handoff`,
    '',
    '## Task',
    String(task || '').trim() || '-',
    '',
    '## Handoff',
    handoffText,
  ];
  const artifacts = [...new Set(
    (Array.isArray(artifactPaths) ? artifactPaths : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
  )];
  if (artifacts.length) {
    body.push('', '## Artifacts', ...artifacts.map((item) => `- ${item}`));
  }
  const markdown = serializeFrontmatter(
    {
      id,
      sessionId: String(sessionId),
      name: persona,
      summary: compactSummary,
      createdAt,
    },
    `${body.join('\n')}\n`,
  );
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, markdown, 'utf8');
  return { id, name: persona, summary: compactSummary, path: displayPath, createdAt };
}

export async function listSubAgentHandoffs({ workspaceRoot, sessionId } = {}) {
  if (!workspaceRoot || !sessionId) return [];
  const root = getProjectHandoffsDir(workspaceRoot, safeSegment(sessionId, 'session'));
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const handoffs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        try {
          const filePath = await findHandoffFile(path.join(root, entry.name));
          if (!filePath) return null;
          const { metadata } = parseFrontmatter(await fs.readFile(filePath, 'utf8'));
          if (String(metadata.sessionId || '') !== String(sessionId)) return null;
          return {
            id: String(metadata.id || entry.name),
            name: trimInline(metadata.name || 'Subagent', 80),
            summary: trimInline(metadata.summary || '', 240),
            path: relativePath(workspaceRoot, filePath),
            createdAt: String(metadata.createdAt || ''),
          };
        } catch {
          return null;
        }
      }),
  );
  return handoffs
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, CATALOG_LIMIT);
}

export function buildSubAgentHandoffCatalog(handoffs = []) {
  const items = Array.isArray(handoffs) ? handoffs.filter(Boolean) : [];
  if (!items.length) return '';
  return [
    '<session_handoffs>',
    'Decide whether one is relevant; if so, read its exact handoff path before broad exploration and verify stale claims.',
    ...items.map((item) => `- ${item.name}: ${item.summary || '(no summary)'} | ${item.path}`),
    '</session_handoffs>',
  ].join('\n');
}
