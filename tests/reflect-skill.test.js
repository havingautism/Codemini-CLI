import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildReflectTargetPath,
  normalizeReflectDraft,
  writeReflectSkillDraft
} from '../src/core/reflect-skill.js';

test('normalizeReflectDraft creates a reusable skill draft from model JSON', () => {
  const draft = normalizeReflectDraft({
    name: 'Runtime Routing Bugfix!',
    description: 'Use after a runtime routing fix succeeds.',
    content: '## Workflow\n\n1. Search routes.\n2. Patch.\n3. Run focused tests.',
    confidence: 0.78
  });

  assert.equal(draft.name, 'runtime-routing-bugfix');
  assert.equal(draft.confidence, 0.78);
  assert.match(draft.content, /^---\nname: runtime-routing-bugfix\n/);
  assert.match(draft.content, /description: Use after a runtime routing fix succeeds\./);
  assert.match(draft.content, /## Workflow/);
});

test('buildReflectTargetPath defaults to project skills and supports global skills', async () => {
  const previousCwd = process.cwd();
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-reflect-paths-'));
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-reflect-global-'));
  const prevGlobal = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = globalDir;

  try {
    process.chdir(workspace);
    assert.equal(
      buildReflectTargetPath({ scope: 'project', name: 'demo-skill', workspaceRoot: workspace }),
      path.join(workspace, '.codemini', 'skills', 'demo-skill', 'SKILL.md')
    );
    assert.equal(
      buildReflectTargetPath({ scope: 'global', name: 'demo-skill', workspaceRoot: workspace }),
      path.join(globalDir, 'skills', 'demo-skill', 'SKILL.md')
    );
  } finally {
    process.chdir(previousCwd);
    if (prevGlobal === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = prevGlobal;
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(globalDir, { recursive: true, force: true });
  }
});

test('writeReflectSkillDraft writes SKILL.md without touching inbox', async () => {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-reflect-write-'));
  try {
    const draft = normalizeReflectDraft({
      name: 'focused-test-loop',
      description: 'Use when preserving a focused test loop.',
      content: '## Workflow\n\nRun the narrowest test after the patch.'
    });
    const written = await writeReflectSkillDraft({
      draft,
      scope: 'project',
      workspaceRoot: workspace
    });

    assert.equal(written.filePath, path.join(workspace, '.codemini', 'skills', 'focused-test-loop', 'SKILL.md'));
    assert.match(await fs.readFile(written.filePath, 'utf8'), /focused-test-loop/);
    await assert.rejects(
      () => fs.access(path.join(workspace, 'memory', 'inbox')),
      /ENOENT/
    );
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
});
