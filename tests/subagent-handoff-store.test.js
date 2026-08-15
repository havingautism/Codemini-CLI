import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildSubAgentHandoffCatalog,
  listSubAgentHandoffs,
  saveSubAgentHandoff,
} from '../src/core/subagent-handoff-store.js';

test('subagent handoffs persist by session and advertise an explicit reuse marker', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-handoff-'));
  try {
    const saved = await saveSubAgentHandoff({
      workspaceRoot,
      sessionId: 'session-a',
      handoffId: 'call-1',
      name: 'Mira',
      task: 'Inspect the project architecture',
      summary: 'Project architecture overview',
      text: 'The runtime starts in src/core/chat-runtime.js.',
      artifactPaths: ['docs/architecture.md'],
      createdAt: '2026-08-09T10:00:00.000Z',
    });

    assert.equal(
      saved.path,
      '.codemini/handoffs/session-a/call-1/handoff-Project-architecture-overview.md',
    );
    const markdown = await fs.readFile(path.join(workspaceRoot, saved.path), 'utf8');
    assert.match(
      markdown,
      /\[已复用 Mira handoff: \.codemini\/handoffs\/session-a\/call-1\/handoff-Project-architecture-overview\.md\]/,
    );
    assert.match(markdown, /Inspect the project architecture/);
    assert.match(markdown, /The runtime starts in src\/core\/chat-runtime\.js\./);
    assert.match(markdown, /- docs\/architecture\.md/);

    const handoffs = await listSubAgentHandoffs({ workspaceRoot, sessionId: 'session-a' });
    assert.deepEqual(handoffs, [saved]);
    assert.deepEqual(
      await listSubAgentHandoffs({ workspaceRoot, sessionId: 'session-b' }),
      [],
    );

    const catalog = buildSubAgentHandoffCatalog(handoffs);
    assert.match(catalog, /Decide whether one is relevant/);
    assert.match(catalog, /read its exact handoff path before broad exploration/);
    assert.match(catalog, /Project architecture overview/);
    assert.match(
      catalog,
      /\.codemini\/handoffs\/session-a\/call-1\/handoff-Project-architecture-overview\.md/,
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('handoff filenames keep Chinese summaries safe on Windows and fall back when empty', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-handoff-name-'));
  try {
    const named = await saveSubAgentHandoff({
      workspaceRoot,
      sessionId: 'session-a',
      handoffId: 'call-1',
      summary: '项目总览：前端/后端？',
      text: 'Overview',
    });
    const unnamed = await saveSubAgentHandoff({
      workspaceRoot,
      sessionId: 'session-a',
      handoffId: 'call-2',
      summary: '',
      text: 'Details',
    });

    assert.equal(
      named.path,
      '.codemini/handoffs/session-a/call-1/handoff-项目总览-前端-后端.md',
    );
    assert.equal(unnamed.path, '.codemini/handoffs/session-a/call-2/handoff.md');
    assert.equal(
      (await listSubAgentHandoffs({ workspaceRoot, sessionId: 'session-a' })).length,
      2,
    );
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('chat runtime keeps growing handoff catalogs out of system prompts', async () => {
  const runtime = await fs.readFile(
    new URL('../src/core/chat-runtime.js', import.meta.url),
    'utf8',
  );

  assert.match(runtime, /skillsPrompt:\s*SUBAGENT_STABLE_SKILLS_PROMPT/);
  assert.doesNotMatch(
    runtime,
    /skillsPrompt:\s*\[rolePrompt, extraRolePrompt, handoffCatalogPrompt\]/,
  );
  assert.doesNotMatch(runtime, /alwaysSkillPrompt,\s*handoffCatalogPrompt,/);
  assert.match(runtime, /handoffCatalogPrompt,/);
  assert.match(runtime, /saveSubAgentHandoff\(\{/);
  assert.match(runtime, /handoffPath: savedHandoff\.path/);
  assert.match(runtime, /inheritParentContext = false/);
});
