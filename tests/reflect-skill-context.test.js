import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeReflectDraft, writeReflectSkillDraft } from '../src/core/reflect-skill.js';
import { buildSkillIndexPreview } from '../src/core/command-loader.js';

test('reflect drafts normalize to global/coding/daily index contexts', () => {
  assert.equal(normalizeReflectDraft({ name: 'a' }).context, 'global');
  assert.equal(normalizeReflectDraft({ name: 'a', context: 'coding' }).context, 'coding');
  assert.equal(normalizeReflectDraft({ name: 'a', context: 'daily' }).context, 'daily');
  assert.equal(normalizeReflectDraft({ name: 'a', context: 'project' }).context, 'global');
});

test('writing a reflected skill registers it for the selected agent-requested index', async () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-reflect-context-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    await writeReflectSkillDraft({
      draft: {
        name: 'reflected-coding',
        description: 'Reflected coding workflow',
        context: 'coding',
        content: '# Reflected coding workflow',
      },
    });
    const preview = await buildSkillIndexPreview(process.cwd(), {
      skills: {
        enabled: { 'reflected-coding': true },
        contexts: { 'reflected-coding': ['coding'] },
      },
    });
    assert.equal(preview.coding.skills.some((skill) => skill.name === 'reflected-coding'), true);
    assert.equal(preview.daily.skills.some((skill) => skill.name === 'reflected-coding'), false);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(globalDir, { recursive: true, force: true });
  }
});
