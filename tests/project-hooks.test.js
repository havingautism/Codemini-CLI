import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  loadProjectHooks,
  mergeWorkspaceHookLayers,
  saveProjectHooks,
  workspaceHooksArmEntry,
} from '../src/core/project-hooks.js';
import { createSkillHooksSession, armSkillHooks, listArmedHandlers } from '../src/core/skill-hooks-session.js';

test('save and load project hooks', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-hooks-'));
  try {
    await saveProjectHooks(root, {
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'node check.mjs' }] }],
    });
    const loaded = await loadProjectHooks(root, { rewriteMatchers: true });
    assert.ok(loaded.hooks.PreToolUse);
    assert.match(String(loaded.hooks.PreToolUse[0].matcher), /run|Bash/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace hooks arm as __project__ and list handlers', () => {
  const session = createSkillHooksSession();
  const merged = mergeWorkspaceHookLayers(
    {},
    {
      Stop: [{ hooks: [{ type: 'command', command: 'node stop.mjs' }] }],
    },
  );
  armSkillHooks(session, workspaceHooksArmEntry(merged, '/tmp/ws'));
  const handlers = listArmedHandlers(session, 'Stop');
  assert.equal(handlers.length, 1);
  assert.equal(handlers[0].source, 'project');
  assert.equal(handlers[0].skillName, '__project__');
});

test('coding and daily project hooks are stored independently', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-project-hooks-contexts-'));
  try {
    await saveProjectHooks(root, {
      Stop: [{ hooks: [{ type: 'command', command: 'coding.mjs' }] }],
    }, 'coding');
    await saveProjectHooks(root, {
      Stop: [{ hooks: [{ type: 'command', command: 'daily.mjs' }] }],
    }, 'daily');

    const coding = await loadProjectHooks(root, { context: 'coding' });
    const daily = await loadProjectHooks(root, { context: 'daily' });
    assert.equal(coding.hooks.Stop[0].hooks[0].command, 'coding.mjs');
    assert.equal(daily.hooks.Stop[0].hooks[0].command, 'daily.mjs');
    assert.match(coding.filePath, /hooks\.json$/);
    assert.match(daily.filePath, /hooks\.daily\.json$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('workspace hook layers concatenate handlers for the same event', () => {
  const merged = mergeWorkspaceHookLayers(
    { PreToolUse: [{ hooks: [{ type: 'command', command: 'global.mjs' }] }] },
    { PreToolUse: [{ hooks: [{ type: 'command', command: 'project.mjs' }] }] },
  );
  assert.deepEqual(
    merged.PreToolUse.map((group) => group.hooks[0].command),
    ['global.mjs', 'project.mjs'],
  );
});
