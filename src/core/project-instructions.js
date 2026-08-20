import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_CHARS = 12000;
const CANDIDATE_FILES = [
  'AGENTS.md',
  path.join('.agents', 'AGENTS.md'),
  path.join('.agents', 'agents.md'),
  path.join('.codemini', 'AGENTS.md'),
  'CLAUDE.md'
];

function trimProjectInstructions(value, maxChars = DEFAULT_MAX_CHARS) {
  const text = String(value || '').trim();
  if (!text) return '';
  const limit = Math.max(1000, Number(maxChars) || DEFAULT_MAX_CHARS);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 120).trimEnd()}\n\n[Project instructions truncated: keep AGENTS.md concise or move details into linked docs.]`;
}

async function readFirstExistingFile(cwd, candidates = CANDIDATE_FILES) {
  let current = path.resolve(cwd);
  while (true) {
    for (const candidate of candidates) {
      const absolutePath = path.resolve(current, candidate);
      let stat;
      try {
        stat = await fs.stat(absolutePath);
      } catch {
        continue;
      }
      if (!stat?.isFile()) continue;
      const content = await fs.readFile(absolutePath, 'utf8');
      const relativePath = path.relative(cwd, absolutePath) || candidate;
      return {
        path: absolutePath,
        relativePath: relativePath.split(path.sep).join('/'),
        content
      };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

export async function loadProjectInstructions({
  cwd = process.cwd(),
  config = {},
  maxChars = config?.context?.project_instructions_max_chars
} = {}) {
  const enabled = config?.context?.project_instructions_enabled !== false;
  if (!enabled) return '';

  const found = await readFirstExistingFile(cwd);
  if (!found) return '';

  const body = trimProjectInstructions(found.content, maxChars);
  if (!body) return '';

  return [
    '<project_instructions>',
    `Source: ${found.relativePath}`,
    body,
    '</project_instructions>'
  ].join('\n');
}

export function buildDefaultAgentsMd() {
  return `# AGENTS.md

This file gives coding agents stable project instructions. Keep it short and use it as a map, not as full documentation.

## Project

- Describe what this repository is and the main runtime or product surface.
- Note required runtime versions and package managers.

## Commands

- Install: \`npm install\`
- Test: \`npm test\`
- Build: add the project build command here.

## Task Routing

- CLI or command behavior: list the entry files here.
- Runtime behavior: list the core runtime files here.
- Web UI behavior: list the server, state, and component roots here.
- Tests: list focused test files for common changes.

## Rules

- Use project/file indexes for orientation, then inspect real source files before editing.
- Keep generated output and build artifacts out of manual edits.
- Put reusable workflows in skills; put always-needed project facts and routing rules here.
`;
}
