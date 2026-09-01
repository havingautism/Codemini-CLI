import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { landTowerWorkers } from '../src/core/tower-land.js';
import { runGit } from '../src/core/process-run.js';
import { getProjectTowerStatePath, getProjectTowerWorktreesDir } from '../src/core/paths.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession } from '../src/core/session-store.js';
import {
  enterTowerMode,
  listTowerWorkersFromState,
  patchTowerWorkerRecord,
} from '../src/core/tower-store.js';
import {
  addTowerWorktree,
  composeTowerResumeTask,
  findTowerWorker,
  resolveTowerSubagentWorkspace,
} from '../src/core/tower-worktree.js';

async function git(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'tower@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'tower@test.local',
    },
  });
}

async function initCleanGit(dir) {
  const template = path.join(dir, '.git-template');
  await fs.mkdir(template, { recursive: true });
  await git(dir, ['init', `--template=${template}`]);
  await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
}

async function withRepo(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-resume-'));
  try {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'resume' });
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

async function listTowerBranches(cwd) {
  const result = await git(cwd, ['branch', '--list', 'codemini-tower/*']);
  return String(result.stdout || '')
    .split('\n')
    .map((line) => line.replace(/^[+*]?\s+/, '').trim())
    .filter(Boolean);
}

function sseText(content = 'ok') {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

function sseToolCalls(calls) {
  const chunks = calls.map((call, index) => `data: ${JSON.stringify({
    choices: [{
      delta: {
        tool_calls: [{
          index,
          id: call.id,
          function: { name: call.name, arguments: call.arguments },
        }],
      },
      finish_reason: null,
    }],
  })}\n\n`);
  chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })}\n\n`);
  chunks.push('data: [DONE]\n\n');
  return chunks.join('');
}

function messageBlob(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return messages.map((message) => {
    if (typeof message?.content === 'string') return message.content;
    return JSON.stringify(message?.content || '');
  }).join('\n');
}

function baseConfig(port) {
  return {
    sdk: { provider: 'openai-compatible' },
    gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
    model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
    context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
    execution: { mode: 'plan', approval_mode: 'auto' },
    memory: {
      enabled: false,
      bootstrap: { enabled: false },
      retrieval: { enabled: false },
      experience: { enabled: false },
      writeback: { enabled: false },
      background_review: { enabled: false },
    },
    ui: { language: 'en', reply_language: 'en' },
    soul: { preset: 'default' },
  };
}

async function withResumeRuntime(respond, task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-resume-rt-'));
  const dir = path.join(globalDir, 'workspace');
  await fs.mkdir(dir, { recursive: true });
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    let body = null;
    try { body = JSON.parse(raw); } catch { body = null; }
    bodies.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const payload = await respond(body, messageBlob(body));
    res.end(payload || sseText('ok'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await initCleanGit(dir);
    const port = server.address().port;
    const session = await createSession(dir);
    const runtime = await createChatRuntime({
      session,
      config: baseConfig(port),
      model: 'test-model',
      systemPrompt: 'stable',
      workspaceRoot: dir,
    });
    await runtime.setTowerMode(true);
    await task({ dir, bodies, runtime, session });
    await runtime.dispose?.();
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') continue;
    const content = messages[index].content;
    return typeof content === 'string' ? content : JSON.stringify(content || '');
  }
  return '';
}

function isParentUserTurn(body, needle) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages[messages.length - 1]?.role !== 'user') return false;
  const text = lastUserText(body);
  if (!needle.test(text)) return false;
  if (text.includes('\nTask:') || text.includes('Previous shift handoff')) return false;
  return true;
}

test('composeTowerResumeTask puts the new task before the previous handoff', () => {
  const composed = composeTowerResumeTask('Fix the types', '# Alisa handoff\n\nshipped notes.md');
  assert.ok(composed.startsWith('Fix the types'));
  assert.match(composed, /Previous shift handoff/);
  assert.match(composed, /shipped notes\.md/);
  assert.ok(composed.indexOf('Fix the types') < composed.indexOf('Previous shift handoff'));
  assert.equal(composeTowerResumeTask('only', ''), 'only');
});

test('findTowerWorker matches resume id first, then sanitized name', () => {
  const workers = [
    { id: 'alisa', branch: 'codemini-tower/alisa', worktreePath: '/tmp/alisa', callId: 'call_00_tWNGO08jqp3XgQaRowSz2051' },
    { id: 'ben', branch: 'codemini-tower/ben', worktreePath: '/tmp/ben' },
  ];
  assert.equal(findTowerWorker(workers, { resume: 'Alisa' }).id, 'alisa');
  assert.equal(findTowerWorker(workers, { name: 'Ben' }).id, 'ben');
  assert.equal(findTowerWorker(workers, { resume: 'missing' }), null);
  assert.equal(
    findTowerWorker(workers, { resume: 'call_00_tWNGO08jqp3XgQaRowSz2051' }).id,
    'alisa',
  );
});

test('resume reuses the same worktree; same name without resume is rejected', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    assert.equal(spawned.ok, true);
    const resumed = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'alisa',
    });
    assert.equal(resumed.ok, true, resumed.error);
    assert.equal(resumed.resume, true);
    assert.equal(resumed.worker.worktreePath, spawned.worker.worktreePath);
    assert.equal(resumed.worker.branch, spawned.worker.branch);
    assert.deepEqual(resumed.worker.paths, ['notes.md']);

    const mismatch = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'alisa',
      paths: ['other.md'],
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.code, 'PATHS_MISMATCH');

    const dup = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['other.md'],
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, 'WORKER_EXISTS');
    assert.deepEqual(await listTowerBranches(dir), ['codemini-tower/alisa']);
    const trees = await fs.readdir(getProjectTowerWorktreesDir(dir));
    assert.deepEqual(trees, ['alisa']);

    const wrongResume = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'twngo08jqp3xgqarowsz2051',
      name: 'Alisa',
    });
    assert.equal(wrongResume.ok, false);
    assert.equal(wrongResume.code, 'RESUME_UNKNOWN');
    assert.match(wrongResume.error, /resume: "alisa"/);
    assert.deepEqual(await fs.readdir(getProjectTowerWorktreesDir(dir)), ['alisa']);
  });
});

test('after land, the same name is a new worker and needs paths', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'notes.md'), 'hello\n');
    await git(spawned.worker.worktreePath, ['add', 'notes.md']);
    await git(spawned.worker.worktreePath, ['commit', '-m', 'notes']);
    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 0);

    const missingPaths = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
    });
    assert.equal(missingPaths.ok, false);
    assert.equal(missingPaths.code, 'PATHS_REQUIRED');

    const again = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    assert.equal(again.ok, true, again.error);
    assert.equal(Boolean(again.resume), false);
    assert.equal(again.worker.id, 'alisa');
  });
});

test('spawn then resume injects the last handoff into the new prompt', async () => {
  await withResumeRuntime(async (body, blob) => {
    if (isParentUserTurn(body, /SPAWN_ALISA/)) {
      return sseToolCalls([{
        id: 'call-spawn',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'First shift on notes.md',
          name: 'Alisa',
          paths: ['notes.md'],
        }),
      }]);
    }
    if (isParentUserTurn(body, /RESUME_ALISA/)) {
      return sseToolCalls([{
        id: 'call-resume',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Next shift on notes.md',
          resume: 'alisa',
        }),
      }]);
    }
    if (blob.includes('Previous shift handoff')) return sseText('resumed-ok');
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, bodies, runtime }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    const afterSpawn = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    const [worker] = listTowerWorkersFromState(afterSpawn);
    assert.equal(worker.id, 'alisa');
    assert.match(String(worker.lastHandoffPath || ''), /handoffs/);

    await runtime.submitMessage({ text: 'RESUME_ALISA' });
    const afterResume = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(afterResume).length, 1);
    assert.deepEqual(await fs.readdir(getProjectTowerWorktreesDir(dir)), ['alisa']);
    assert.deepEqual(await listTowerBranches(dir), ['codemini-tower/alisa']);

    const resumePrompt = bodies
      .map((item) => messageBlob(item))
      .find((blob) => blob.includes('Previous shift handoff'));
    assert.ok(resumePrompt);
    assert.ok(resumePrompt.indexOf('Next shift on notes.md') < resumePrompt.indexOf('Previous shift handoff'));
    assert.match(resumePrompt, /FIRST_SHIFT_BODY/);
    const firstPrompt = bodies
      .map((item) => messageBlob(item))
      .find((blob) => blob.includes('First shift on notes.md') && blob.includes('\nTask:\n'));
    assert.ok(firstPrompt);
    assert.equal(firstPrompt.includes('Previous shift handoff'), false);
  });
});

test('in-flight resume of the same worker is rejected', async () => {
  await withResumeRuntime(async (body, blob) => {
    if (isParentUserTurn(body, /SPAWN_ALISA/)) {
      return sseToolCalls([{
        id: 'call-spawn',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'First shift on notes.md',
          name: 'Alisa',
          paths: ['notes.md'],
        }),
      }]);
    }
    if (isParentUserTurn(body, /DOUBLE_RESUME/)) {
      return sseToolCalls([
        {
          id: 'call-slow',
          name: 'run_subagent',
          arguments: JSON.stringify({ prompt: 'SLOW_SHIFT', resume: 'alisa' }),
        },
        {
          id: 'call-fast',
          name: 'run_subagent',
          arguments: JSON.stringify({ prompt: 'FAST_SHIFT', resume: 'alisa' }),
        },
      ]);
    }
    if (blob.includes('SLOW_SHIFT') || blob.includes('FAST_SHIFT')) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      return sseText('shift-done');
    }
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await runtime.submitMessage({ text: 'DOUBLE_RESUME' });
    const transcript = JSON.stringify(session.messages);
    assert.match(transcript, /still running/);
    const trees = await fs.readdir(getProjectTowerWorktreesDir(dir));
    assert.deepEqual(trees, ['alisa']);
  });
});

test('patchTowerWorkerRecord stores lastHandoffPath', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    const patched = await patchTowerWorkerRecord(dir, spawned.worker.id, {
      lastHandoffPath: '.codemini/handoffs/sess/call-a/handoff.md',
    });
    assert.equal(patched.ok, true);
    assert.equal(patched.worker.lastHandoffPath, '.codemini/handoffs/sess/call-a/handoff.md');
  });
});
