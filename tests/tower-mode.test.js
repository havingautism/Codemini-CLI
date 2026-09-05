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
  normalizeTowerState,
  patchTowerWorkerRecord,
  readTowerStateFile,
  writeTowerStateFile,
} from '../src/core/tower-store.js';
import {
  addTowerWorktree,
  allocateTowerWorkerId,
  removeTowerWorktrees,
  sanitizeTowerWorkerId,
  teardownTowerWorker,
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

function baseConfig(port, mode = 'plan', towerMaxWorkers = 4) {
  return {
    sdk: { provider: 'openai-compatible' },
    gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
    model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
    context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
    execution: { mode, approval_mode: 'auto' },
    tower: { max_workers: towerMaxWorkers },
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
  const finalRaw = await fs.readFile(getProjectTowerStatePath(dir), 'utf8').catch(() => '');
  throw new Error(`timed out waiting for ${workerId} status=${status}; state=${finalRaw}`);
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

async function withRuntime({ mode = 'plan', gitRepo = true, firstCompletion, workerDelays = {}, towerMaxWorkers = 4 } = {}, task) {
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
        for (const [marker, delayMs] of Object.entries(workerDelays)) {
          const userText = messages
            .filter((message) => message?.role === 'user')
            .map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
            .join('\n');
          if (userText.includes(marker)) {
            await new Promise((resolve) => setTimeout(resolve, Number(delayMs) || 0));
            break;
          }
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
          config: baseConfig(port, mode, towerMaxWorkers),
          model: 'test-model',
          systemPrompt: 'stable',
          workspaceRoot: dir
        });
        await task({ dir, bodies, runtime, session });
        await runtime.waitForTowerIdle?.().catch(() => {});
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
  assert.match(prompt, /Crew Mode: on/);
  assert.match(prompt, /base branch: main/);
  assert.match(prompt, /Dispatch implementation work with run_subagent/);
  assert.match(prompt, /status questions/);
  assert.match(prompt, /Crew notification/);
  assert.match(prompt, /role: "survey"/);
  assert.match(prompt, /run_subagent/);
  assert.match(prompt, /land_workers/);
  assert.match(prompt, /REBASE_REQUIRED/);
  assert.match(prompt, /git merge --no-ff/);
  assert.match(prompt, /review set to that worker id/);
  assert.match(prompt, /inspect-only/);
  assert.match(prompt, /fork_task is not available/);
  assert.match(prompt, /land_workers is the only merge path/);
  assert.match(prompt, /Call tower_status/);
  assert.match(prompt, /pending wakes/);
  assert.match(prompt, /Do not infer progress from this prompt/);
  const withRoster = buildTowerModePromptBlock({ active: true, base: 'main' }, [
    { id: 'alisa', branch: 'codemini-tower/alisa', worktreePath: '/tmp/alisa', paths: ['notes.md'] },
  ]);
  assert.equal(withRoster.includes('Crew roster snapshot'), false);
  assert.equal(withRoster.includes('alisa'), false);
  const withTmp = buildTowerModePromptBlock({ active: true, base: 'main' }, [
    { id: 'alisa', branch: 'codemini-tower/alisa', worktreePath: '/tmp/alisa', paths: ['notes.md'] },
    { id: 'mia', branch: 'codemini-tower/mia', worktreePath: '/tmp/mia', paths: ['src/**'], integrated: true },
  ]);
  assert.equal(withTmp.includes('On base: mia'), false);
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
    assert.equal(dirty.dirty, true);
    assert.equal(dirty.dirtyCount, 1);
    assert.match(dirty.warning, /^Git · Crew workers use HEAD/);
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

test('concurrent Tower worker patches preserve every worker update', async () => {
  await withTempDir(async (dir) => {
    const workers = [
      { id: 'a', branch: 'codemini-tower/a', worktreePath: path.join(dir, 'a') },
      { id: 'b', branch: 'codemini-tower/b', worktreePath: path.join(dir, 'b') },
    ];
    await writeTowerStateFile(dir, { active: true, base: 'main', workers });

    await Promise.all([
      patchTowerWorkerRecord(dir, 'a', { runStatus: 'completed' }),
      patchTowerWorkerRecord(dir, 'b', { runStatus: 'failed' }),
    ]);

    const saved = await readTowerStateFile(dir);
    assert.equal(saved.workers.find((worker) => worker.id === 'a').runStatus, 'completed');
    assert.equal(saved.workers.find((worker) => worker.id === 'b').runStatus, 'failed');
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

test('setTowerMode from daily switches into coding and allows a dirty worktree', async () => {
  await withRuntime({ mode: 'normal' }, async ({ runtime }) => {
    const entered = await runtime.setTowerMode(true);
    assert.equal(entered.ok, true);
    assert.equal(entered.tower.base, 'main');
    assert.equal(runtime.getRuntimeState().towerActive, true);
    assert.equal(runtime.getRuntimeState().mode, 'plan');
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
    assert.match(system, /Crew Mode: on/);

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

const dependentTowerCompletion = sseToolCalls([
  {
    id: 'call-upstream',
    name: 'run_subagent',
    arguments: JSON.stringify({
      prompt: 'Tower upstream marker',
      name: 'upstream',
      task_id: 'upstream',
      paths: ['frontend/**'],
    }),
  },
  {
    id: 'call-downstream',
    name: 'run_subagent',
    arguments: JSON.stringify({
      prompt: 'Tower downstream marker',
      name: 'downstream',
      task_id: 'downstream',
      depends_on: ['upstream'],
      paths: ['backend/**'],
    }),
  },
]);

function requestHasUserMarker(body, marker) {
  return (body?.messages || []).some((message) => (
    message?.role === 'user'
    && (typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).includes(marker)
  ));
}

async function waitForCondition(predicate, timeoutMs = 3000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition.');
}

test('tower depends_on waits for the upstream background worker to finish', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: dependentTowerCompletion,
    workerDelays: { 'Tower upstream marker': 300 },
  }, async ({ bodies, runtime }) => {
    await runtime.setTowerMode(true);
    const submitted = runtime.submitMessage({ text: '使用子代理实现有依赖的前后端任务' });
    await waitForCondition(() => bodies.some((body) => requestHasUserMarker(body, 'Tower upstream marker')));
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(bodies.some((body) => requestHasUserMarker(body, 'Tower downstream marker')), false);
    await submitted;
    await waitForCondition(() => bodies.some((body) => requestHasUserMarker(body, 'Tower downstream marker')));
  });
});

test('/crew is ordinary prompt text and does not enter Crew mode', async () => {
  await withRuntime({ mode: 'plan' }, async ({ runtime, bodies }) => {
    const result = await runtime.submitMessage({ text: '/crew 修复登录并补测试' });
    assert.equal(result.type, 'assistant');
    assert.equal(runtime.getRuntimeState().towerActive, false);
    const transcript = JSON.stringify(bodies.at(-1)?.messages || []);
    assert.match(transcript, /\/crew 修复登录并补测试/);
    assert.doesNotMatch(transcript, /Crew Mode: on/);
  });
});

test('runtime expands a project slash command but keeps the typed command in session history', async () => {
  await withRuntime({ mode: 'plan' }, async ({ dir, runtime, bodies }) => {
    const commandDir = path.join(dir, '.codemini', 'commands');
    await fs.mkdir(commandDir, { recursive: true });
    await fs.writeFile(path.join(commandDir, 'release.md'), 'Prepare {{1}} safely.\n');
    await runtime.reloadCommandsAndSkills();
    const catalog = runtime.getCommandCatalog();
    assert.equal(catalog.some((item) => item.name === 'release' && item.kind === 'command'), true);

    await runtime.submitMessage({ text: '/release web' });
    const transcript = JSON.stringify(bodies.at(-1)?.messages || []);
    assert.match(transcript, /Executing command: \/release/);
    assert.match(transcript, /Prepare web safely/);
    const visibleUser = runtime.getSessionMessages().findLast((message) => message.role === 'user');
    assert.equal(visibleUser.content, '/release web');
  });
});

test('Tower refuses to turn off while a background worker is running', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: sseToolCalls([{
      id: 'call-slow',
      name: 'run_subagent',
      arguments: JSON.stringify({
        prompt: 'Tower slow worker marker',
        name: 'slow',
        paths: ['slow/**'],
      }),
    }]),
    workerDelays: { 'Tower slow worker marker': 300 },
  }, async ({ dir, runtime }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用子代理执行慢任务' });
    const stoppedEarly = await runtime.setTowerMode(false);
    assert.equal(stoppedEarly.ok, false);
    assert.equal(stoppedEarly.code, 'WORKERS_IN_FLIGHT');
    await fs.access(path.join(getProjectTowerWorktreesDir(dir), 'slow'));

    await runtime.waitForTowerIdle();
    const stopped = await runtime.setTowerMode(false);
    assert.equal(stopped.ok, true);
  });
});

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

test('tower queues workers beyond tower.max_workers and exposes queued status', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: twoSubagentCompletion,
    towerMaxWorkers: 1,
    workerDelays: { 'Implement frontend in isolation': 250, 'Implement backend in isolation': 250 },
  }, async ({ dir, runtime }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用子代理分别实现 frontend 和 backend' });
    await waitForCondition(async () => {
      const state = await readTowerStateFile(dir);
      const statuses = listTowerWorkersFromState(state).map((worker) => worker.runStatus);
      return statuses.includes('running') && statuses.includes('queued');
    });
    await runtime.waitForTowerIdle();
    const completed = listTowerWorkersFromState(await readTowerStateFile(dir));
    assert.equal(completed.every((worker) => worker.runStatus === 'completed'), true);
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

test('teardown after abort frees scope for a new worker on the same paths', async () => {
  await withTempDir(async (dir) => {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'abort-teardown' });
    const first = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'noa',
      paths: ['docs/**'],
    });
    assert.equal(first.ok, true, first.error);
    const torn = await teardownTowerWorker({ cwd: dir, id: first.worker.id, force: true });
    assert.equal(torn.ok, true, torn.error);
    const second = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'nina',
      paths: ['docs/**'],
    });
    assert.equal(second.ok, true, second.error);
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    const workers = listTowerWorkersFromState(saved);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, 'nina');
    const trees = await fs.readdir(getProjectTowerWorktreesDir(dir));
    assert.equal(trees.includes('noa'), false);
    assert.equal(trees.includes('nina'), true);
  });
});

test('fork_task is unavailable while tower is on', async () => {
  await withRuntime({
    mode: 'plan',
    firstCompletion: forkTaskCompletion,
  }, async ({ dir, runtime, session }) => {
    await runtime.setTowerMode(true);
    await runtime.submitMessage({ text: '使用并行任务检查 README' });
    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    assert.equal(listTowerWorkersFromState(saved).length, 0);
    const worktrees = getProjectTowerWorktreesDir(dir);
    assert.equal(await fs.access(worktrees).then(() => true, () => false), false);
    const forkResult = session.messages.find((message) => message.tool_call_id === 'call-fork');
    assert.match(String(forkResult?.content || ''), /not available in this model turn/);
  });
});
