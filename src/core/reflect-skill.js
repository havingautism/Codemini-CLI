import fs from 'node:fs/promises';
import path from 'node:path';
import { getProjectSkillsDir, getSkillsDir } from './paths.js';
import { createChatCompletion } from './provider/index.js';

const REFLECT_TIMEOUT_MS = 45000;

function slugifySkillName(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'reflected-success-workflow';
}

function escapeFrontmatter(value) {
  return String(value || '').replace(/\r?\n/g, ' ').replace(/"/g, '\\"').trim();
}

function hasFrontmatter(content) {
  return /^---\r?\n[\s\S]*?\r?\n---\r?\n/.test(String(content || '').trimStart());
}

function renderSkillContent({ name, description, content }) {
  const body = String(content || '').trim() || [
    '## Workflow',
    '',
    '1. Recreate the successful chain from the recent task.',
    '2. Preserve the key decision that made it work.',
    '3. Verify with the narrowest relevant check.',
    '',
    '## Boundaries',
    '',
    'Use this only when the current task matches the preserved workflow.'
  ].join('\n');
  if (hasFrontmatter(body)) return `${body.trim()}\n`;
  return [
    '---',
    `name: ${name}`,
    `description: ${escapeFrontmatter(description) || `Use when this reflected workflow applies.`}`,
    '---',
    '',
    body
  ].join('\n').trimEnd() + '\n';
}

export function normalizeReflectDraft(raw = {}) {
  const name = slugifySkillName(raw.name || raw.skillName || raw.title);
  const description = String(raw.description || raw.summary || `Use when the ${name} workflow applies.`).trim();
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence ?? 0.75)));
  return {
    id: Number(raw.id || 1),
    name,
    description,
    confidence,
    content: renderSkillContent({ name, description, content: raw.content || raw.markdown || raw.body })
  };
}

export function buildReflectTargetPath({ scope = 'project', name, workspaceRoot = process.cwd() } = {}) {
  const safeName = slugifySkillName(name);
  const baseDir = String(scope || '').toLowerCase() === 'global'
    ? getSkillsDir()
    : getProjectSkillsDir(workspaceRoot);
  return path.join(baseDir, safeName, 'SKILL.md');
}

export function parseReflectScope(args = []) {
  let scope = 'project';
  const requestParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--scope') {
      const next = String(args[index + 1] || '').toLowerCase();
      if (next === 'global' || next === 'project') {
        scope = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length).toLowerCase();
      if (value === 'global' || value === 'project') scope = value;
      continue;
    }
    requestParts.push(arg);
  }
  return { scope, request: requestParts.join(' ').trim() };
}

function parseModelDrafts(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(unfenced);
    if (Array.isArray(parsed?.candidates)) return parsed.candidates.map((item, index) => normalizeReflectDraft({ id: index + 1, ...item }));
    if (Array.isArray(parsed)) return parsed.map((item, index) => normalizeReflectDraft({ id: index + 1, ...item }));
    if (parsed && typeof parsed === 'object') return [normalizeReflectDraft(parsed)];
  } catch {
    // Fall back to wrapping plain markdown below.
  }
  return [normalizeReflectDraft({
    name: 'reflected-success-workflow',
    description: 'Use when the reflected successful workflow applies.',
    content: raw
  })];
}

function recentContext(session, limit = 10) {
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  return messages
    .slice(-limit)
    .map((message) => `${message.role}: ${String(message.content || '').slice(0, 1200)}`)
    .join('\n\n');
}

export async function buildReflectSkillDraft({
  request = '',
  scope = 'project',
  session,
  config = {},
  model,
  systemPrompt = '',
  previousDraft = null,
  feedback = ''
} = {}) {
  const mode = String(request || '').trim() ? 'directed' : 'exploratory';
  const prompt = [
    'Create a reusable Codex/CodeMini SKILL.md draft from a successful workflow.',
    `Mode: ${mode}`,
    `Target scope: ${scope}`,
    request ? `User reflection request:\n${request}` : 'No explicit request was supplied. Be conservative and return no candidates if the recent context does not show a reusable success pattern.',
    previousDraft ? `Existing draft to revise:\n${previousDraft.content || ''}` : '',
    feedback ? `User edit feedback:\n${feedback}` : '',
    'Recent session context:',
    recentContext(session),
    'Return valid JSON only, no markdown fences.',
    'Shape: {"candidates":[{"name":"kebab-case-name","description":"when to use this skill","confidence":0.0,"content":"full SKILL.md body or markdown body"}]}',
    'The content must include trigger conditions, workflow/toolchain, key decisions, pitfalls, verification, and boundaries.',
    'Do not write memory or inbox content. This is only a skill draft.'
  ].filter(Boolean).join('\n\n');

  const result = await createChatCompletion({
    sdkProvider: config?.sdk?.provider,
    baseUrl: config?.gateway?.base_url,
    apiKey: config?.gateway?.api_key,
    model: model || config?.model?.name,
    messages: [
      { role: 'system', content: systemPrompt || 'You draft concise, reusable coding workflow skills.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0,
    timeoutMs: REFLECT_TIMEOUT_MS
  });

  return parseModelDrafts(result?.text || '');
}

export function attachReflectTargets({ candidates = [], scope = 'project', workspaceRoot = process.cwd() } = {}) {
  return candidates.map((candidate, index) => {
    const draft = normalizeReflectDraft({ id: index + 1, ...candidate });
    return {
      ...draft,
      targetPath: buildReflectTargetPath({ scope, name: draft.name, workspaceRoot })
    };
  });
}

export async function writeReflectSkillDraft({ draft, scope = 'project', workspaceRoot = process.cwd() } = {}) {
  const normalized = normalizeReflectDraft(draft);
  const filePath = buildReflectTargetPath({ scope, name: normalized.name, workspaceRoot });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, normalized.content, 'utf8');
  return { filePath, draft: normalized };
}

