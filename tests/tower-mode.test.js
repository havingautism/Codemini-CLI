import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { runGit } from '../src/core/process-run.js';
import { getProjectHandoffsDir, getProjectTowerStatePath, getProjectTowerWorktreesDir } from '../src/core/paths.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createContinuationSession, createSession, loadSession, saveSession } from '../src/core/session-store.js';
import { saveSubAgentHandoff } from '../src/core/subagent-handoff-store.js';
import {
  buildTowerModePromptBlock,
  enterTowerMode,
  inspectTowerGit,
  listTowerWorkersFromState,
  parseTowerSlashCommand,
  normalizeTowerState
} from '../src/core/tower-store.js';
import {
  addTowerWorktree,
  allocateTowerWorkerId,
  removeTowerWorktrees,
  sanitizeTowerWorkerId,
} from '../src/core/tower-worktree.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

async function withTempDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-'));
  try {
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

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
      GIT_COMMITTER_EMAIL: 'tower@test.local'
    }
  });
}

async function initGitRepo(dir) {
  const template = path.join(dir, '.git-template');
  await fs.mkdir(template, { recursive: true });
  await git(dir, ['init', `--template=${template}`]);
}

async function initCleanGit(dir) {
  await initGitRepo(dir);
  await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
}

function baseConfig(port, mode = 'plan') {
  return {
    sdk: { provider: 'openai-compatible' },
    gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
    model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
    context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
    execution: { mode, approval_mode: 'auto' },
    memory: {
      enabled: false,
      bootstrap: { enabled: false },
      retrieval: { enabled: false },
      experience: { enabled: false },
      writeback: { enabled: false },
      background_review: { enabled: false }
    },
    ui: { language: 'en', reply_language: 'en' },
    soul: { preset: 'default' }
  };
}

async function waitForWorkerStatus(dir, workerId, status, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const raw = await fs.readFile(getProjectTowerStatePath(dir), 'utf8').catch(() => '');
    if (raw) {
      const worker = listTowerWorkersFromState(JSON.parse(raw)).find((item) => item.id === workerId);
      if (worker?.runStatus === status) return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${workerId} status=${status}`);
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

async function withRuntime({ mode = 'plan', gitRepo = true, firstCompletion } = {}, task) {
  closeSqliteDatabasesForTests();
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-rt-'));
  const dir = path.join(globalDir, 'workspace');
  await fs.mkdir(dir, { recursive: true });
  try {
    return await withCodeminiGlobalDir(globalDir, async () => {
      const bodies = [];
      const server = http.createServer(async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let body = null;
        try { body = JSON.parse(raw); } catch { body = null; }
        bodies.push(body);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const messages = Array.isArray(body?.messages) ? body.messages : [];
        const hasToolResult = messages.some((message) => message?.role === 'tool');
        const transcript = JSON.stringify(messages);
        if (firstCompletion && !hasToolResult && /使用子代理|使用并行任务/.test(transcript)) {
          res.end(firstCompletion);
          return;
        }
        res.end(sseText('ok'));
      });
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        if (gitRepo) await initCleanGit(dir);
        const port = server.address().port;
        const session = await createSession(dir);
        const runtime = await createChatRuntime({
          session,
          config: baseConfig(port, mode),
          model: 'test-model',
          systemPrompt: 'stable',
          workspaceRoot: dir
        });
        await task({ dir, bodies, runtime, session });
        await runtime.dispose?.();
      } finally {
        server.closeAllConnections?.();
        await new Promise((resolve) => server.close(resolve));
        closeSqliteDatabasesForTests();
      }
    });
  } finally {
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('parseTowerSlashCommand maps on/off variants', () => {
  assert.equal(parseTowerSlashCommand('/help'), null);
  assert.deepEqual(parseTowerSlashCommand('/tower'), { action: 'enter' });
  assert.deepEqual(parseTowerSlashCommand('/tower on'), { action: 'enter' });
  assert.deepEqual(parseTowerSlashCommand('/TOWER'), { action: 'enter' });
  assert.deepEqual(parseTowerSlashCommand('/tower off'), { action: 'exit' });
  assert.deepEqual(parseTowerSlashCommand('/tower teardown'), { action: 'exit' });
});

test('normalizeTowerState keeps only an active overlay with a base branch', () => {
  assert.equal(normalizeTowerState(null), null);
  assert.equal(normalizeTowerState({ active: false, base: 'main' }), null);
  assert.equal(normalizeTowerState({ active: true, base: 'HEAD' }), null);
  assert.deepEqual(normalizeTowerState({ active: true, base: 'dev-20260826', enteredAt: '2026-08-31T00:00:00.000Z' }), {
    active: true,
    base: 'dev-20260826',
    enteredAt: '2026-08-31T00:00:00.000Z'
  });
});

test('tower prompt is present only when the overlay is active', () => {
  assert.equal(buildTowerModePromptBlock(null), '');
  const prompt = buildTowerModePromptBlock({ active: true, base: 'main' });
  assert.match(prompt, /Tower Mode: on/);
  assert.match(prompt, /base branch: main/);
  assert.match(prompt, /Do not write product code/);
  assert.match(prompt, /run_subagent/);
  assert.match(prompt, /land_workers/);
  assert.match(prompt, /REBASE_REQUIRED/);
  assert.match(prompt, /merge tmp/);
  assert.match(prompt, /review set to that worker id/);
  assert.match(prompt, /inspect-only/);
  assert.match(prompt, /land_workers is the only merge path/);
  assert.match(prompt, /No idle workers yet/);
  const withRoster = buildTowerModePromptBlock({ active: true, base: 'main' }, [
    { id: 'alisa', branch: 'codemini-tower/alisa', worktreePath: '/tmp/alisa', paths: ['notes.md'] },
  ]);
  assert.match(withRoster, /Idle workers: alisa \(notes.md\)/);
  assert.match(withRoster, /resume: "<id>"/);
  const withTmp = buildTowerModePromptBlock({ active: true, base: 'main' }, [
    { id: 'alisa', branch: 'codemini-tower/alisa', worktreePath: '/tmp/alisa', paths: ['notes.md'] },
    { id: 'mia', branch: 'codemini-tower/mia', worktreePath: '/tmp/mia', paths: ['src/**'], integrated: true },
  ]);
  assert.match(withTmp, /Idle workers: alisa \(notes.md\)/);
  assert.match(withTmp, /On merge tmp: mia \(src\/\*\*\)/);
  assert.equal(withTmp.includes('Idle workers: alisa (notes.md); mia'), false);
});

test('inspectTowerGit refuses missing repo and empty history, but allows a dirty worktree', async () => {
  await withTempDir(async (dir) => {
    const missing = await inspectTowerGit(dir);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'NOT_GIT');

    await initGitRepo(dir);
    const empty = await inspectTowerGit(dir);
    assert.equal(empty.ok, false);
    assert.equal(empty.code, 'NO_COMMIT');

    await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', 'init']);
    await git(dir, ['branch', '-M', 'main']);
    const ready = await inspectTowerGit(dir);
    assert.equal(ready.ok, true);
    assert.equal(ready.base, 'main');

    await fs.writeFile(path.join(dir, 'dirty.txt'), 'x\n');
    const dirty = await inspectTowerGit(dir);
    assert.equal(dirty.ok, true);
    assert.equal(dirty.base, 'main');
  });
});

test('enterTowerMode writes .codemini/tower/state.json', async () => {
  await withTempDir(async (dir) => {
    await initCleanGit(dir);
    const result = await enterTowerMode({ cwd: dir, sessionId: 'sess-1' });
    assert.equal(result.ok, true);
    assert.equal(result.tower.base, 'main');
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(saved.active, true);
    assert.equal(saved.base, 'main');
    assert.equal(saved.sessionId, 'sess-1');
  });
});

test('sanitizeSession keeps tower overlay state', async () => {
  closeSqliteDatabasesForTests();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-sess-'));
  try {
    await withCodeminiGlobalDir(dir, async () => {
      try {
        const session = await createSession(dir);
        session.tower = { active: true, base: 'main', enteredAt: '2026-08-31T00:00:00.000Z' };
        await saveSession(session);
        const loaded = await loadSession(session.id);
        assert.equal(loaded.tower.active, true);
        assert.equal(loaded.tower.base, 'main');

        const continuation = await createContinuationSession(loaded, { messages: loaded.messages || [] });
        assert.notEqual(continuation.id, loaded.id);
        assert.equal(continuation.tower.active, true);
        assert.equal(continuation.tower.base, 'main');
      } finally {
        closeSqliteDatabasesForTests();
      }
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('setTowerMode refuses daily mode and allows a dirty coding worktree', async () => {
  await withRuntime({ mode: 'normal' }, async ({ runtime }) => {
    const refused = await runtime.setTowerMode(true);
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'NOT_CODING');
  });

  await withRuntime({ mode: 'plan' }, async ({ dir, runtime }) => {
    await fs.writeFile(path.join(dir, 'dirty.txt'), 'x\n');
    const entered = await runtime.setTowerMode(true);
    assert.equal(entered.ok, true);
    assert.equal(entered.tower.base, 'main');
  });
});

test('coding mode can enter tower, persist it, and daily mode closes it', async () => {
  await withRuntime({ mode: 'plan' }, async ({ dir, runtime, session, bodies }) => {
    const entered = await runtime.setTowerMode(true);
    assert.equal(entered.ok, true);
    assert.equal(entered.tower.base, 'main');
    assert.equal(runtime.getRuntimeState().towerActive, true);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(saved.active, true);
    const loaded = await loadSession(session.id);
    assert.equal(loaded.tower.active, true);

    const again = await runtime.setTowerMode(true);
    assert.equal(again.ok, true);

    delete session.tower;
    assert.equal(runtime.getRuntimeState().towerActive, true);
    const restored = await runtime.setTowerMode(true);
    assert.equal(restored.ok, true);
    const reattached = await loadSession(session.id);
    assert.equal(reattached.tower.active, true);

    await runtime.submitMessage({ text: 'hello tower' });
    const system = bodies.at(-1)?.messages?.[0]?.content || '';
    assert.match(system, /Tower Mode: on/);

    const switched = await runtime.setExecutionMode('normal');
    assert.equal(switched, true);
    assert.equal(runtime.getRuntimeState().towerActive, false);
    const after = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(after.active, false);
    const reloaded = await loadSession(session.id);
    assert.equal(reloaded.tower, undefined);
  });
});

test('sanitizeTowerWorkerId and allocateTowerWorkerId stay git-safe and unique', () => {
  assert.equal(sanitizeTowerWorkerId('Front End!'), 'front-end');
  assert.equal(sanitizeTowerWorkerId(''), 'worker');
  assert.equal(allocateTowerWorkerId({ taskId: 'm1', existingIds: [] }), 'm1');
  assert.equal(allocateTowerWorkerId({ taskId: 'm1', existingIds: ['m1'] }), 'm1-2');
  assert.equal(allocateTowerWorkerId({ name: 'Frontend', existingIds: [] }), 'frontend');
  assert.equal(allocateTowerWorkerId({ taskId: 'tmp', existingIds: [] }), 'tmp-2');
  assert.equal(allocateTowerWorkerId({ taskId: '_merge-tmp', existingIds: [] }), 'merge-tmp-2');
});

test('tower worktrees isolate workers, skip dirty remove, and keep parent handoffs', async () => {
  await withTempDir(async (dir) => {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'sess-wt' });
    const first = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'm1',
      callId: 'call-a',
      paths: ['worker-a.txt'],
    });
    const second = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      taskId: 'm2',
      callId: 'call-b',
      paths: ['worker-b.txt'],
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.notEqual(first.worker.worktreePath, second.worker.worktreePath);
    assert.match(first.worker.branch, /^codemini-tower\//);

    await fs.writeFile(path.join(first.worker.worktreePath, 'worker-a.txt'), 'a\n');
    await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
    const mainFiles = await fs.readdir(dir);
    assert.equal(mainFiles.includes('worker-a.txt'), false);

    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 2);
    assert.equal(saved.workers[0].id, 'm1');

    const handoff = await saveSubAgentHandoff({
      workspaceRoot: dir,
      sessionId: 'sess-wt',
      handoffId: 'call-a',
      name: 'frontend',
      task: 'frontend',
      text: 'worker a done',
    });
    assert.match(String(handoff?.path || ''), /handoffs/);
    await fs.access(path.join(dir, String(handoff.path).replace(/\//g, path.sep)));
    const workerHandoffs = path.join(first.worker.worktreePath, '.codemini', 'handoffs');
    await assert.rejects(fs.access(workerHandoffs));

    const removed = await removeTowerWorktrees({ cwd: dir });
    assert.equal(removed.removed.length, 1);
    assert.equal(removed.kept.length, 1);
    assert.equal(removed.kept[0].id, 'm1');
    assert.equal(await fs.access(second.worker.worktreePath).then(() => true, () => false), false);
    await fs.access(first.worker.worktreePath);

    await fs.rm(path.join(first.worker.worktreePath, 'worker-a.txt'));
    const cleaned = await removeTowerWorktrees({ cwd: dir });
    assert.equal(cleaned.kept.length, 0);
    assert.equal(await fs.access(first.worker.worktreePath).then(() => true, () => false), false);
  });
});

const twoSubagentCompletion = sseToolCalls([
  {
    id: 'call-m1',
    name: 'run_subagent',
    arguments: JSON.stringify({
      prompt: 'Implement frontend in isolation',
      name: 'm1',
      paths: ['frontend/**'],
    }),
  },
  {
    id: 'call-m2',
    name: 'run_subagent',
    arguments: JSON.stringify({
      prompt: 'Implement backend in isolation',
      name: 'm2',
      paths: ['backend/**'],
    }),
  },
]);

const forkTaskCompletion = sseToolCalls([
  {
    id: 'call-fork',
    name: 'fork_task',
    arguments: JSON.stringify({
      prompt: 'Inspect README only',
      name: 'inspect',
    }),
  },
]);

test('tower-on run_subagent creates two worktrees; session overlay has no workers', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: twoSubagentCompletion,
  }, async ({ dir, runtime, session }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用子代理分别实现 frontend 和 backend' });
    await waitForWorkerStatus(dir, 'm1', 'completed');
    await waitForWorkerStatus(dir, 'm2', 'completed');
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 2);
    const trees = await fs.readdir(getProjectTowerWorktreesDir(dir));
    assert.equal(trees.includes('m1'), true);
    assert.equal(trees.includes('m2'), true);
    const loaded = await loadSession(session.id);
    assert.equal(loaded.tower.active, true);
    assert.equal(loaded.tower.workers, undefined);
    const readme = await fs.readFile(path.join(dir, 'README.md'), 'utf8');
    assert.equal(readme, 'hello\n');
    const handoffRoot = getProjectHandoffsDir(dir, session.id);
    const handoffEntries = await fs.readdir(handoffRoot);
    assert.ok(handoffEntries.length >= 2);

    await runtime.setTowerMode(false);
    assert.equal(await fs.access(path.join(getProjectTowerWorktreesDir(dir), 'm1')).then(() => true, () => false), false);
    assert.equal(await fs.access(path.join(getProjectTowerWorktreesDir(dir), 'm2')).then(() => true, () => false), false);
  });
});

test('without tower, run_subagent does not create worktrees', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: twoSubagentCompletion,
  }, async ({ dir, runtime }) => {
    await runtime.submitMessage({ text: '使用子代理分别实现 frontend 和 backend' });
    const worktrees = getProjectTowerWorktreesDir(dir);
    assert.equal(await fs.access(worktrees).then(() => true, () => false), false);
  });
});

test('overlapping tower paths reject the second spawn', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: sseToolCalls([
      {
        id: 'call-m1',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Docs only',
          name: 'docs',
          paths: ['docs/**'],
        }),
      },
      {
        id: 'call-m2',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Docs again',
          name: 'docs-two',
          paths: ['docs/guide.md'],
        }),
      },
    ]),
  }, async ({ dir, runtime }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用子代理分别实现 frontend 和 backend' });
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    const workers = listTowerWorkersFromState(saved);
    assert.equal(workers.length, 1);
    assert.equal(['docs', 'docs-two'].includes(workers[0].id), true);
    await waitForWorkerStatus(dir, workers[0].id, 'completed');
    const trees = await fs.readdir(getProjectTowerWorktreesDir(dir));
    assert.deepEqual(trees.filter((name) => name !== '.DS_Store'), [workers[0].id]);
  });
});

test('fork_task does not spawn tower worktrees while tower is on', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: forkTaskCompletion,
  }, async ({ dir, runtime }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用并行任务检查 README' });
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 0);
    const worktrees = getProjectTowerWorktreesDir(dir);
    assert.equal(await fs.access(worktrees).then(() => true, () => false), false);
  });
});
