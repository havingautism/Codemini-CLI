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
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';
import {
  enterTowerMode,
  listTowerWorkersFromState,
  nextTowerReviewLoopState,
  patchTowerWorkerRecord,
  readTowerStateFile,
  towerReviewFindingsKey,
  towerReviewPassedFromText,
  workerReviewMatchesCommit,
} from '../src/core/tower-store.js';
import {
  addTowerWorktree,
  composeTowerResumeTask,
  composeTowerReviewTask,
  resolveTowerReviewTarget,
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-review-'));
  try {
    await initCleanGit(dir);
    await enterTowerMode({ cwd: dir, sessionId: 'review' });
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('towerReviewPassedFromText requires Findings: none', () => {
  assert.equal(towerReviewPassedFromText('Findings:\n- none'), true);
  assert.equal(towerReviewPassedFromText('Findings: none'), true);
  assert.equal(towerReviewPassedFromText('Findings:\n- missing tests'), false);
  assert.equal(towerReviewPassedFromText('looks good'), false);
  assert.equal(towerReviewPassedFromText(''), false);
});

test('towerReviewFindingsKey fingerprints Findings bullets', () => {
  assert.equal(towerReviewFindingsKey('Findings:\n- missing tests'), 'missing tests');
  assert.equal(
    towerReviewFindingsKey('Findings:\n- Missing   Tests\n- no changelog'),
    'missing tests\nno changelog',
  );
  assert.equal(towerReviewFindingsKey('Findings: none'), 'none');
  assert.equal(towerReviewFindingsKey('looks good'), '');
});

test('nextTowerReviewLoopState stops after five failed rounds or two identical findings', () => {
  let state = {};
  for (let index = 0; index < 4; index += 1) {
    state = nextTowerReviewLoopState(state, {
      passed: false,
      text: `Findings:\n- issue ${index}`,
    });
  }
  assert.equal(state.reviewRound, 4);
  assert.equal(state.reviewLoopStopped, false);

  state = nextTowerReviewLoopState(state, { passed: false, text: 'Findings:\n- issue 4' });
  assert.equal(state.reviewRound, 5);
  assert.equal(state.reviewLoopStopped, true);

  const first = nextTowerReviewLoopState({}, { passed: false, text: 'Findings:\n- missing tests' });
  assert.equal(first.reviewRound, 1);
  assert.equal(first.reviewLoopStopped, false);
  const second = nextTowerReviewLoopState(first, { passed: false, text: 'Findings:\n- Missing Tests' });
  assert.equal(second.reviewRound, 2);
  assert.equal(second.reviewLoopStopped, true);

  const reset = nextTowerReviewLoopState(second, { passed: true, text: 'Findings:\n- none' });
  assert.equal(reset.reviewRound, 0);
  assert.equal(reset.reviewLoopStopped, false);
  assert.equal(reset.lastFindingsKey, '');
});

test('workerReviewMatchesCommit requires the same commit and a pass', () => {
  const worker = { reviewPassed: true, reviewedCommit: 'abc' };
  assert.equal(workerReviewMatchesCommit(worker, 'abc'), true);
  assert.equal(workerReviewMatchesCommit(worker, 'def'), false);
  assert.equal(workerReviewMatchesCommit({ reviewPassed: false, reviewedCommit: 'abc' }, 'abc'), false);
  assert.equal(workerReviewMatchesCommit({}, 'abc'), false);
});

test('composeTowerResumeTask can append review findings after the handoff', () => {
  const composed = composeTowerResumeTask('Fix the types', '# handoff', 'Findings:\n- missing tests');
  assert.ok(composed.startsWith('Fix the types'));
  assert.match(composed, /Previous shift handoff/);
  assert.match(composed, /Latest review/);
  assert.match(composed, /missing tests/);
});

test('composeTowerResumeTask injects rebase onto after a failed land', () => {
  const composed = composeTowerResumeTask('Continue', '# handoff', '', 'aaa111');
  assert.match(composed, /Previous shift handoff/);
  assert.match(composed, /git rebase aaa111/);
});

test('composeTowerReviewTask names the worker and commit', () => {
  const text = composeTowerReviewTask('Check notes.md', {
    workerId: 'alisa',
    commit: 'abc123',
    paths: ['notes.md'],
    diff: 'diff --git a/notes.md',
    base: 'main',
  });
  assert.match(text, /alisa/);
  assert.match(text, /abc123/);
  assert.match(text, /notes\.md/);
  assert.match(text, /diff --git/);
});

test('resolveTowerReviewTarget reuses the author worktree and does not add a worker', async () => {
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

    const missing = await resolveTowerReviewTarget({ cwd: dir, base: 'main', review: '' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'REVIEW_TARGET_REQUIRED');

    const withResume = await resolveTowerReviewTarget({
      cwd: dir,
      base: 'main',
      review: 'alisa',
      resume: 'alisa',
    });
    assert.equal(withResume.ok, false);
    assert.equal(withResume.code, 'REVIEW_RESUME_CONFLICT');

    const unknown = await resolveTowerReviewTarget({ cwd: dir, base: 'main', review: 'bella' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'REVIEW_UNKNOWN');

    const reviewed = await resolveTowerReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
    assert.equal(reviewed.ok, true, reviewed.error);
    assert.equal(reviewed.review, true);
    assert.equal(reviewed.worker.id, 'alisa');
    assert.equal(reviewed.worker.worktreePath, spawned.worker.worktreePath);
    assert.equal(reviewed.commit.length > 10, true);
    assert.match(reviewed.diff, /hello/);

    const saved = await readTowerStateFile(dir);
    assert.equal(listTowerWorkersFromState(saved).length, 1);
    assert.deepEqual(await fs.readdir(getProjectTowerWorktreesDir(dir)), ['alisa']);
  });
});

test('resolveTowerSubagentWorkspace still resumes after the review loop stops', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await patchTowerWorkerRecord(dir, spawned.worker.id, {
      reviewPassed: false,
      reviewText: 'Findings:\n- missing tests',
      reviewRound: 2,
      lastFindingsKey: 'missing tests',
      reviewLoopStopped: true,
    });
    const resumed = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'alisa',
    });
    assert.equal(resumed.ok, true, resumed.error);
    assert.equal(resumed.resume, true);
    assert.equal(resumed.worker.reviewLoopStopped, true);

    const narrowed = await resolveTowerSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'alisa',
      paths: ['notes.md', 'extra.md'],
    });
    assert.equal(narrowed.ok, true, narrowed.error);
    assert.equal(narrowed.pathsChanged, true);
    assert.deepEqual(narrowed.worker.paths, ['notes.md', 'extra.md']);
    assert.equal(narrowed.worker.reviewLoopStopped, undefined);
  });
});

test('resolveTowerReviewTarget refuses a worker already on the merge tmp', async () => {
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
    await patchTowerWorkerRecord(dir, spawned.worker.id, { integrated: true });
    const reviewed = await resolveTowerReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.code, 'WORKER_INTEGRATED');
  });
});

test('resolveTowerReviewTarget refuses a dirty author worktree', async () => {
  await withRepo(async (dir) => {
    const spawned = await addTowerWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'notes.md'), 'draft\n');
    const reviewed = await resolveTowerReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.code, 'DIRTY_WORKTREE');
  });
});

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
  if (text.includes('\nTask:') || text.includes('Previous shift handoff') || text.includes('You are reviewing tower worker') || /<task>\s*\[tower\]/.test(text) || text.trimStart().startsWith('[tower]')) {
    return false;
  }
  return true;
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

async function withReviewRuntime({ tower = true } = {}, respond, task) {
  closeSqliteDatabasesForTests();
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tower-review-rt-'));
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
        if (tower) await runtime.setTowerMode(true);
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

async function waitForWorkerField(dir, workerId, predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const raw = await fs.readFile(getProjectTowerStatePath(dir), 'utf8').catch(() => '');
    if (raw) {
      const worker = listTowerWorkersFromState(JSON.parse(raw)).find((item) => item.id === workerId);
      if (worker && predicate(worker)) return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${workerId} field`);
}

async function waitForSessionMatch(session, needle, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const blob = (session.messages || []).map((message) => (
      typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content || '')
    )).join('\n');
    if (needle.test(blob)) return blob;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const preview = (session.messages || []).map((message) => String(message?.content || '')).join('\n---\n');
  throw new Error(`timed out waiting for session ${needle}\n${preview}`);
}

async function waitUntilBodies(bodies, predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (bodies.some((item) => predicate(messageBlob(item)))) return;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('timed out waiting for model body');
}

async function sealWorkerNotes(dir) {
  const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
  const [worker] = listTowerWorkersFromState(saved);
  await fs.writeFile(path.join(worker.worktreePath, 'notes.md'), 'hello\n');
  await git(worker.worktreePath, ['add', 'notes.md']);
  await git(worker.worktreePath, ['commit', '-m', 'notes']);
  const sha = String((await git(worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
  return { worker, sha };
}

test('tower reviewer reuses the author worktree, stays off the roster, and records the commit', async () => {
  await withReviewRuntime({}, async (body, blob) => {
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
    if (isParentUserTurn(body, /REVIEW_ALISA/)) {
      return sseToolCalls([{
        id: 'call-review',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review alisa',
          role: 'reviewer',
          review: 'alisa',
        }),
      }]);
    }
    if (blob.includes('You are reviewing tower worker')) {
      return sseText('Findings:\n- none');
    }
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, bodies, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    const { worker, sha } = await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const reviewed = await waitForWorkerField(dir, 'alisa', (item) => item.reviewPassed === true);

    const saved = JSON.parse(await fs.readFile(getProjectTowerStatePath(dir), 'utf8'));
    const workers = listTowerWorkersFromState(saved);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, 'alisa');
    assert.equal(workers[0].worktreePath, worker.worktreePath);
    assert.equal(reviewed.reviewedCommit, sha);
    assert.equal(reviewed.reviewPassed, true);
    assert.equal(reviewed.reviewLoopStopped, undefined);
    assert.equal(reviewed.reviewRound, undefined);
    assert.match(String(reviewed.reviewText || ''), /Findings:\n- none/);
    assert.deepEqual(await fs.readdir(getProjectTowerWorktreesDir(dir)), ['alisa']);

    const reviewPrompt = bodies.map((item) => messageBlob(item)).find((text) => text.includes('You are reviewing tower worker'));
    assert.ok(reviewPrompt);
    assert.match(reviewPrompt, /alisa/);
    assert.match(reviewPrompt, /Do not edit files/);
    assert.equal(reviewPrompt.includes('Worker id:'), false);

    const reviewResult = session.messages.find((message) => message.tool_call_id === 'call-review');
    assert.match(String(reviewResult?.content || ''), /Review of "alisa" passed/);
    assert.equal(String(reviewResult?.content || '').includes('Worker id:'), false);
    const spawnResult = session.messages.find((message) => message.tool_call_id === 'call-spawn');
    assert.match(String(spawnResult?.content || ''), /alisa/);

    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
  });
});

test('failed review stays bound to that commit; resume injects the findings', async () => {
  await withReviewRuntime({}, async (body, blob) => {
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
    if (isParentUserTurn(body, /REVIEW_ALISA/)) {
      return sseToolCalls([{
        id: 'call-review',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review alisa',
          role: 'reviewer',
          review: 'alisa',
        }),
      }]);
    }
    if (isParentUserTurn(body, /RESUME_ALISA/)) {
      return sseToolCalls([{
        id: 'call-resume',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Fix the review',
          resume: 'alisa',
        }),
      }]);
    }
    if (blob.includes('You are reviewing tower worker')) {
      return sseText('Findings:\n- missing tests');
    }
    if (blob.includes('Latest review')) return sseText('fixed-ok');
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, bodies, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    const { sha } = await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const reviewed = await waitForWorkerField(dir, 'alisa', (item) => item.reviewPassed === false && item.reviewRound === 1);

    assert.equal(reviewed.reviewedCommit, sha);
    assert.equal(reviewed.reviewPassed, false);
    assert.equal(reviewed.reviewRound, 1);
    assert.equal(reviewed.reviewLoopStopped, undefined);
    assert.deepEqual(await fs.readdir(getProjectTowerWorktreesDir(dir)), ['alisa']);

    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_FAILED');

    await runtime.submitMessage({ text: 'RESUME_ALISA' });
    await waitUntilBodies(bodies, (text) => text.includes('Latest review'));
    const resumePrompt = bodies.map((item) => messageBlob(item)).find((text) => text.includes('Latest review'));
    assert.ok(resumePrompt);
    assert.match(resumePrompt, /missing tests/);
    await waitForSessionMatch(session, /Resume "alisa"/);
  });
});

test('identical failed reviews stop the loop and allow a redirected resume', async () => {
  await withReviewRuntime({}, async (body, blob) => {
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
    if (isParentUserTurn(body, /REVIEW_ONCE/)) {
      return sseToolCalls([{
        id: 'call-review-1',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review alisa',
          role: 'reviewer',
          review: 'alisa',
        }),
      }]);
    }
    if (isParentUserTurn(body, /REVIEW_AGAIN/)) {
      return sseToolCalls([{
        id: 'call-review-2',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review alisa again',
          role: 'reviewer',
          review: 'alisa',
        }),
      }]);
    }
    if (isParentUserTurn(body, /RESUME_ALISA/)) {
      return sseToolCalls([{
        id: 'call-resume',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Fix the review',
          resume: 'alisa',
        }),
      }]);
    }
    if (blob.includes('You are reviewing tower worker')) {
      return sseText('Findings:\n- missing tests');
    }
    if (blob.includes('Latest review')) return sseText('should-not-inject-findings');
    return sseText('REDIRECTED_SHIFT');
  }, async ({ dir, bodies, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ONCE' });
    await waitForWorkerField(dir, 'alisa', (item) => item.reviewRound === 1);
    await runtime.submitMessage({ text: 'REVIEW_AGAIN' });
    const worker = await waitForWorkerField(dir, 'alisa', (item) => item.reviewLoopStopped === true);

    assert.equal(worker.reviewPassed, false);
    assert.equal(worker.reviewRound, 2);
    assert.equal(worker.reviewLoopStopped, true);
    assert.equal(worker.lastFindingsKey, 'missing tests');

    const landed = await landTowerWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_FAILED');

    await waitForSessionMatch(session, /Resume "alisa"/);
    await waitForSessionMatch(session, /loop stopped/);

    await runtime.submitMessage({ text: 'RESUME_ALISA' });
    await waitUntilBodies(bodies, (text) => text.includes('Fix the review'));
    const resumePrompt = bodies.map((item) => messageBlob(item)).find((text) => text.includes('Fix the review'));
    assert.ok(resumePrompt);
    assert.equal(resumePrompt.includes('Latest review'), false);
    await waitForSessionMatch(session, /REDIRECTED_SHIFT/);
  });
});

test('review with paths is rejected; coding reviewer still runs without a tower roster', async () => {
  await withReviewRuntime({}, async (body) => {
    if (isParentUserTurn(body, /BAD_REVIEW/)) {
      return sseToolCalls([{
        id: 'call-bad',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review alisa',
          role: 'reviewer',
          review: 'alisa',
          paths: ['notes.md'],
        }),
      }]);
    }
    return sseText('ok');
  }, async ({ runtime, session }) => {
    await runtime.submitMessage({ text: 'BAD_REVIEW' });
    const badResult = session.messages.find((message) => message.tool_call_id === 'call-bad');
    assert.match(String(badResult?.content || ''), /review does not take paths/);
  });

  await withReviewRuntime({ tower: false }, async (body, blob) => {
    if (isParentUserTurn(body, /使用子代理/)) {
      return sseToolCalls([{
        id: 'call-coding',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review the latest change',
          role: 'reviewer',
        }),
      }]);
    }
    if (blob.includes('Review the latest change')) return sseText('Findings:\n- none');
    return sseText('ok');
  }, async ({ dir, runtime, session }) => {
    await runtime.submitMessage({ text: '使用子代理审查最新改动' });
    const codingResult = session.messages.find((message) => message.tool_call_id === 'call-coding');
    assert.match(String(codingResult?.content || ''), /Findings:/);
    assert.equal(String(codingResult?.content || '').includes('REVIEW_TARGET'), false);
    assert.equal(String(codingResult?.content || '').includes('review is only valid'), false);
    assert.equal(await fs.access(getProjectTowerWorktreesDir(dir)).then(() => true, () => false), false);
  });
});
