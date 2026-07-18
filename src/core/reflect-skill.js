import fs from 'node:fs/promises';
import path from 'node:path';
import { getSkillsDir } from './paths.js';
import { computeFileSha256, upsertSkillRegistryEntry } from './skill-registry.js';
import { createChatCompletion } from './provider/index.js';
import { appendStructuredOutputLanguageRule } from './reply-language.js';

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

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*]|\d+\.)\s+/, '').trim())
    .filter(Boolean);
}

function renderSection(title, items) {
  const normalized = normalizeList(items);
  if (normalized.length === 0) return '';
  return [`## ${title}`, '', ...normalized.map((item, index) => `${index + 1}. ${item}`)].join('\n');
}

function renderStructuredSkillBody(raw = {}) {
  const sections = [
    renderSection('Trigger Conditions', raw.trigger_conditions || raw.triggers),
    renderSection('Workflow', raw.workflow),
    renderSection('Key Decisions', raw.key_decisions || raw.decisions),
    renderSection('Pitfalls', raw.pitfalls),
    renderSection('Verification', raw.verification),
    renderSection('Boundaries', raw.boundaries)
  ].filter(Boolean);
  return sections.join('\n\n').trim();
}

function hasReflectDraftSignal(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const textFields = ['name', 'skillName', 'title', 'description', 'summary', 'content', 'markdown', 'body'];
  if (textFields.some((field) => String(raw[field] || '').trim())) return true;
  const listFields = [
    'trigger_conditions',
    'triggers',
    'workflow',
    'key_decisions',
    'decisions',
    'pitfalls',
    'verification',
    'boundaries'
  ];
  return listFields.some((field) => normalizeList(raw[field]).length > 0);
}

function normalizeReflectContext(value) {
  return ['global', 'coding', 'daily'].includes(value) ? value : 'global';
}

export function normalizeReflectDraft(raw = {}) {
  const name = slugifySkillName(raw.name || raw.skillName || raw.title);
  const description = String(raw.description || raw.summary || `Use when the ${name} workflow applies.`).trim();
  const confidence = Math.min(1, Math.max(0, Number(raw.confidence ?? 0.75)));
  const structuredBody = renderStructuredSkillBody(raw);
  return {
    id: Number(raw.id || 1),
    name,
    description,
    confidence,
    context: normalizeReflectContext(raw.context),
    content: renderSkillContent({ name, description, content: raw.content || raw.markdown || raw.body || structuredBody })
  };
}

export function buildReflectTargetPath({ name } = {}) {
  const safeName = slugifySkillName(name);
  return path.join(getSkillsDir(), safeName, 'SKILL.md');
}

export function parseReflectScope(args = []) {
  const requestParts = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = String(args[index] || '');
    if (arg === '--scope') {
      const next = String(args[index + 1] || '').toLowerCase();
      if (next === 'global' || next === 'project') {
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--scope=')) {
      const value = arg.slice('--scope='.length).toLowerCase();
      if (value === 'global' || value === 'project') continue;
      continue;
    }
    requestParts.push(arg);
  }
  return { scope: 'global', request: requestParts.join(' ').trim() };
}

function parseJsonObject(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return null;
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(unfenced);
  } catch {}
  const first = unfenced.indexOf('{');
  const last = unfenced.lastIndexOf('}');
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(unfenced.slice(first, last + 1));
    } catch {}
  }
  return null;
}

function normalizeDraftList(parsed) {
  if (Array.isArray(parsed?.candidates)) {
    return parsed.candidates
      .filter(hasReflectDraftSignal)
      .map((item, index) => normalizeReflectDraft({ id: index + 1, ...item }));
  }
  if (Array.isArray(parsed)) {
    return parsed
      .filter(hasReflectDraftSignal)
      .map((item, index) => normalizeReflectDraft({ id: index + 1, ...item }));
  }
  if (hasReflectDraftSignal(parsed)) return [normalizeReflectDraft(parsed)];
  return [];
}

export function parseReflectModelDrafts(text) {
  return normalizeDraftList(parseJsonObject(text));
}

function parseToolDrafts(toolCalls = []) {
  const call = (Array.isArray(toolCalls) ? toolCalls : []).find((tc) => tc?.name === 'submit_reflect_candidates');
  return call ? normalizeDraftList(parseJsonObject(call.arguments)) : null;
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
  scope = 'global',
  session,
  config = {},
  model,
  systemPrompt = '',
  previousDraft = null,
  feedback = ''
} = {}) {
  const reflectTool = {
    type: 'function',
    function: {
      name: 'submit_reflect_candidates',
      description: 'Submit structured reusable skill draft candidates for local SKILL.md rendering.',
      parameters: {
        type: 'object',
        properties: {
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Kebab-case skill name' },
                description: { type: 'string', description: 'Use-when trigger description' },
                confidence: { type: 'number' },
                trigger_conditions: { type: 'array', items: { type: 'string' } },
                workflow: { type: 'array', items: { type: 'string' } },
                key_decisions: { type: 'array', items: { type: 'string' } },
                pitfalls: { type: 'array', items: { type: 'string' } },
                verification: { type: 'array', items: { type: 'string' } },
                boundaries: { type: 'array', items: { type: 'string' } }
              },
              required: ['name', 'description', 'confidence', 'trigger_conditions', 'workflow', 'key_decisions', 'pitfalls', 'verification', 'boundaries']
            }
          }
        },
        required: ['candidates']
      }
    }
  };
  const mode = String(request || '').trim() ? 'directed' : 'exploratory';
  const prompt = [
    'Create a reusable Codex/Codemini SKILL.md draft from a successful workflow.',
    `Mode: ${mode}`,
    `Target scope: ${scope}`,
    request ? `User reflection request:\n${request}` : 'No explicit request was supplied. Be conservative and return no candidates if the recent context does not show a reusable success pattern.',
    previousDraft ? `Existing draft to revise:\n${previousDraft.content || ''}` : '',
    feedback ? `User edit feedback:\n${feedback}` : '',
    'Recent session context:',
    recentContext(session),
    'You must call submit_reflect_candidates with structured fields. If there is no reusable success pattern, submit {"candidates":[]}.',
    'Do not write markdown directly.',
    'Each candidate must include trigger conditions, workflow/toolchain, key decisions, pitfalls, verification, and boundaries.',
    'Do not write memory or inbox content. This is only a skill draft.'
  ].filter(Boolean).join('\n\n');

  const result = await createChatCompletion({
    sdkProvider: config?.sdk?.provider,
    baseUrl: config?.gateway?.base_url,
    apiKey: config?.gateway?.api_key,
    model: model || config?.model?.name,
    messages: [
      {
        role: 'system',
        content: appendStructuredOutputLanguageRule(
          systemPrompt || 'You draft concise, reusable coding workflow skills.',
          config,
          { fields: 'description, trigger_conditions, workflow, key_decisions, pitfalls, verification, and boundaries' }
        )
      },
      { role: 'user', content: prompt }
    ],
    tools: [reflectTool],
    temperature: 0,
    timeoutMs: REFLECT_TIMEOUT_MS
  });

  return parseToolDrafts(result?.toolCalls) ?? parseReflectModelDrafts(result?.text || '');
}

export function attachReflectTargets({ candidates = [] } = {}) {
  return candidates.map((candidate, index) => {
    const draft = normalizeReflectDraft({ id: index + 1, ...candidate });
    return {
      ...draft,
      targetPath: buildReflectTargetPath({ name: draft.name })
    };
  });
}

export async function writeReflectSkillDraft({ draft } = {}) {
  const normalized = normalizeReflectDraft(draft);
  const filePath = buildReflectTargetPath({ name: normalized.name });
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, normalized.content, 'utf8');
  await upsertSkillRegistryEntry(undefined, {
    name: normalized.name,
    version: '0.0.0',
    description: normalized.description,
    enabled: true,
    source: 'reflect',
    entryFile: 'SKILL.md',
    sha256: await computeFileSha256(filePath),
    installedAt: new Date().toISOString()
  });
  return { filePath, draft: normalized };
}

