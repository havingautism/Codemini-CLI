import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { landCrewWorkers } from '../src/core/crew-land.js';
import { runGit } from '../src/core/process-run.js';
import { getProjectCrewStatePath, getProjectCrewWorktreesDir } from '../src/core/paths.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession } from '../src/core/session-store.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';
import {
  enterCrewMode,
  formatCrewReviewText,
  listCrewWorkersFromState,
  nextCrewReviewLoopState,
  normalizeCrewReviewVerdict,
  patchCrewWorkerRecord,
  readCrewStateFile,
  crewReviewFindingsKey,
  workerReviewMatchesCommit,
} from '../src/core/crew-store.js';
import {
  addCrewWorktree,
  composeCrewResumeTask,
  composeCrewReviewTask,
  resolveCrewReviewTarget,
  resolveCrewSubagentWorkspace,
} from '../src/core/crew-worktree.js';

async function git(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'crew@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'crew@test.local',
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-review-'));
  try {
    await initCleanGit(dir);
    await enterCrewMode({ cwd: dir, sessionId: 'review' });
    return await task(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('normalizeCrewReviewVerdict is the review gate, not free text', () => {
  assert.deepEqual(normalizeCrewReviewVerdict({ passed: true, findings: [] }), {
    ok: true,
    passed: true,
    findings: [],
  });
  assert.deepEqual(normalizeCrewReviewVerdict({ passed: true, findings: ['none'] }), {
    ok: true,
    passed: true,
    findings: [],
  });
  assert.equal(normalizeCrewReviewVerdict({ passed: false, findings: [] }).ok, false);
  assert.deepEqual(normalizeCrewReviewVerdict({ passed: false, findings: ['missing tests'] }), {
    ok: true,
    passed: false,
    findings: ['missing tests'],
  });
  assert.equal(normalizeCrewReviewVerdict({}).ok, false);
  assert.equal(normalizeCrewReviewVerdict({ passed: 'yes' }).ok, false);
  assert.equal(formatCrewReviewText({ passed: true, findings: [] }), '');
  assert.equal(formatCrewReviewText({ passed: false, findings: ['missing tests'] }), '- missing tests');
});

test('crewReviewFindingsKey fingerprints finding items', () => {
  assert.equal(crewReviewFindingsKey(['missing tests']), 'missing tests');
  assert.equal(
    crewReviewFindingsKey(['Missing   Tests', 'no changelog']),
    'missing tests\nno changelog',
  );
  assert.equal(crewReviewFindingsKey([]), '');
  assert.equal(crewReviewFindingsKey(undefined), '');
});

test('nextCrewReviewLoopState stops after five failed rounds or two identical findings', () => {
  let state = {};
  for (let index = 0; index < 4; index += 1) {
    state = nextCrewReviewLoopState(state, {
      passed: false,
      findings: [`issue ${index}`],
    });
  }
  assert.equal(state.reviewRound, 4);
  assert.equal(state.reviewLoopStopped, false);

  state = nextCrewReviewLoopState(state, { passed: false, findings: ['issue 4'] });
  assert.equal(state.reviewRound, 5);
  assert.equal(state.reviewLoopStopped, true);

  const first = nextCrewReviewLoopState({}, { passed: false, findings: ['missing tests'] });
  assert.equal(first.reviewRound, 1);
  assert.equal(first.reviewLoopStopped, false);
  const second = nextCrewReviewLoopState(first, { passed: false, findings: ['Missing Tests'] });
  assert.equal(second.reviewRound, 2);
  assert.equal(second.reviewLoopStopped, true);

  const reset = nextCrewReviewLoopState(second, { passed: true, findings: [] });
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

test('composeCrewResumeTask can append review findings after the handoff', () => {
  const composed = composeCrewResumeTask('Fix the types', '# handoff', 'Findings:\n- missing tests');
  assert.ok(composed.startsWith('Fix the types'));
  assert.match(composed, /Previous shift handoff/);
  assert.match(composed, /Latest review/);
  assert.match(composed, /missing tests/);
});

test('composeCrewResumeTask injects rebase onto after a failed land', () => {
  const composed = composeCrewResumeTask('Continue', '# handoff', '', 'aaa111');
  assert.match(composed, /Previous shift handoff/);
  assert.match(composed, /git rebase aaa111/);
});

test('composeCrewReviewTask names the worker and commit', () => {
  const text = composeCrewReviewTask('Check notes.md', {
    workerId: 'alisa',
    commit: 'abc123',
    paths: ['notes.md'],
    diff: 'diff --git a/notes.md',
    base: 'main',
  });
  assert.match(text, /alisa/);
  assert.match(text, /abc123/);
  assert.match(text, /notes\.md/);
  assert.match(text, /submit_crew_review/);
  assert.match(text, /Prose under Findings:/);
  assert.match(text, /diff --git/);
});

test('resolveCrewReviewTarget reuses the author worktree and does not add a worker', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'notes.md'), 'hello\n');
    await git(spawned.worker.worktreePath, ['add', 'notes.md']);
    await git(spawned.worker.worktreePath, ['commit', '-m', 'notes']);

    const missing = await resolveCrewReviewTarget({ cwd: dir, base: 'main', review: '' });
    assert.equal(missing.ok, false);
    assert.equal(missing.code, 'REVIEW_TARGET_REQUIRED');

    const withResume = await resolveCrewReviewTarget({
      cwd: dir,
      base: 'main',
      review: 'alisa',
      resume: 'alisa',
    });
    assert.equal(withResume.ok, false);
    assert.equal(withResume.code, 'REVIEW_RESUME_CONFLICT');

    const unknown = await resolveCrewReviewTarget({ cwd: dir, base: 'main', review: 'bella' });
    assert.equal(unknown.ok, false);
    assert.equal(unknown.code, 'REVIEW_UNKNOWN');

    const reviewed = await resolveCrewReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
    assert.equal(reviewed.ok, true, reviewed.error);
    assert.equal(reviewed.review, true);
    assert.equal(reviewed.worker.id, 'alisa');
    assert.equal(reviewed.worker.worktreePath, spawned.worker.worktreePath);
    assert.equal(reviewed.commit.length > 10, true);
    assert.match(reviewed.diff, /hello/);

    const saved = await readCrewStateFile(dir);
    assert.equal(listCrewWorkersFromState(saved).length, 1);
    assert.deepEqual(await fs.readdir(getProjectCrewWorktreesDir(dir)), ['alisa']);
  });
});

test('resolveCrewSubagentWorkspace still resumes after the review loop stops', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await patchCrewWorkerRecord(dir, spawned.worker.id, {
      reviewPassed: false,
      reviewText: 'Findings:\n- missing tests',
      reviewRound: 2,
      lastFindingsKey: 'missing tests',
      reviewLoopStopped: true,
    });
    const resumed = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      resume: 'alisa',
    });
    assert.equal(resumed.ok, true, resumed.error);
    assert.equal(resumed.resume, true);
    assert.equal(resumed.worker.reviewLoopStopped, true);

    const narrowed = await resolveCrewSubagentWorkspace({
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

test('resolveCrewReviewTarget refuses a worker already on the merge tmp', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'notes.md'), 'hello\n');
    await git(spawned.worker.worktreePath, ['add', 'notes.md']);
    await git(spawned.worker.worktreePath, ['commit', '-m', 'notes']);
    await patchCrewWorkerRecord(dir, spawned.worker.id, { integrated: true });
    const reviewed = await resolveCrewReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
    assert.equal(reviewed.ok, false);
    assert.equal(reviewed.code, 'WORKER_INTEGRATED');
  });
});

test('resolveCrewReviewTarget refuses a dirty author worktree', async () => {
  await withRepo(async (dir) => {
    const spawned = await addCrewWorktree({
      cwd: dir,
      base: 'main',
      name: 'Alisa',
      paths: ['notes.md'],
    });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'notes.md'), 'draft\n');
    const reviewed = await resolveCrewReviewTarget({ cwd: dir, base: 'main', review: 'alisa' });
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

function reviewerVerdict(body, blob, verdict) {
  if (!blob.includes('You are reviewing Crew worker')) return null;
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (messages.some((message) => message?.role === 'tool')) return sseText('reviewed');
  return sseToolCalls([{
    id: 'call-verdict',
    name: 'submit_crew_review',
    arguments: JSON.stringify(verdict),
  }]);
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
  if (text.includes('\nTask:') || text.includes('Previous shift handoff') || text.includes('You are reviewing Crew worker') || /<task>\s*\[crew\]/.test(text) || text.trimStart().startsWith('[crew]')) {
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

async function withReviewRuntime({ crew = true } = {}, respond, task) {
  closeSqliteDatabasesForTests();
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-review-rt-'));
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
        res.on('error', () => {});
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        try {
          const payload = await respond(body, messageBlob(body));
          if (!res.writableEnded) res.end(payload || sseText('ok'));
        } catch {
          if (!res.writableEnded) {
            try { res.end(); } catch { /* connection already closed */ }
          }
        }
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
        if (crew) await runtime.setCrewMode(true);
        await task({ dir, bodies, runtime, session });
        await runtime.waitForCrewIdle?.().catch(() => {});
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
    const raw = await fs.readFile(getProjectCrewStatePath(dir), 'utf8').catch(() => '');
    if (raw) {
      const worker = listCrewWorkersFromState(JSON.parse(raw)).find((item) => item.id === workerId);
      if (worker?.runStatus === status) return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${workerId} status=${status}`);
}

async function waitForWorkerField(dir, workerId, predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const raw = await fs.readFile(getProjectCrewStatePath(dir), 'utf8').catch(() => '');
    if (raw) {
      const worker = listCrewWorkersFromState(JSON.parse(raw)).find((item) => item.id === workerId);
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
  const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
  const [worker] = listCrewWorkersFromState(saved);
  await fs.writeFile(path.join(worker.worktreePath, 'notes.md'), 'hello\n');
  await git(worker.worktreePath, ['add', 'notes.md']);
  await git(worker.worktreePath, ['commit', '-m', 'notes']);
  const sha = String((await git(worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
  return { worker, sha };
}

test('crew reviewer reuses the author worktree, stays off the roster, and records the commit', async () => {
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
    const submitted = reviewerVerdict(body, blob, { passed: true, findings: [] });
    if (submitted) return submitted;
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, bodies, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    const { worker, sha } = await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const reviewed = await waitForWorkerField(dir, 'alisa', (item) => item.reviewPassed === true);

    const saved = JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8'));
    const workers = listCrewWorkersFromState(saved);
    assert.equal(workers.length, 1);
    assert.equal(workers[0].id, 'alisa');
    assert.equal(workers[0].worktreePath, worker.worktreePath);
    assert.equal(reviewed.reviewedCommit, sha);
    assert.equal(reviewed.reviewPassed, true);
    assert.equal(reviewed.runStatus, 'completed');
    assert.equal(reviewed.reviewLoopStopped, undefined);
    assert.equal(reviewed.reviewRound, undefined);
    assert.equal(String(reviewed.reviewText || ''), '');
    assert.deepEqual(await fs.readdir(getProjectCrewWorktreesDir(dir)), ['alisa']);

    const reviewPrompt = bodies.map((item) => messageBlob(item)).find((text) => text.includes('You are reviewing Crew worker'));
    assert.ok(reviewPrompt);
    assert.match(reviewPrompt, /alisa/);
    assert.match(reviewPrompt, /Do not edit files/);
    assert.equal(reviewPrompt.includes('Worker id:'), false);

    const reviewResult = session.messages.find((message) => message.tool_call_id === 'call-review');
    assert.match(String(reviewResult?.content || ''), /Crew review of "alisa" started \(running\)/);
    assert.equal(String(reviewResult?.content || '').includes('Worker id:'), false);
    const spawnResult = session.messages.find((message) => message.tool_call_id === 'call-spawn');
    assert.match(String(spawnResult?.content || ''), /spawned \(running\)|background/i);

    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
  });
});

test('crew review prose with no findings and pass language infers pass without submit_crew_review', async () => {
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
    if (blob.includes('You are reviewing Crew worker')) {
      return sseText([
        'Findings:',
        '- none',
        '',
        'Verified:',
        '- notes.md matches the diff.',
        '',
        'Handoff:',
        '- clean to land; pass.',
      ].join('\n'));
    }
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, runtime }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const reviewed = await waitForWorkerField(dir, 'alisa', (item) => item.reviewPassed === true);
    assert.equal(reviewed.reviewPassed, true);
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, true, landed.error);
  });
});

test('crew review without submit_crew_review or pass prose stays incomplete', async () => {
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
    if (blob.includes('You are reviewing Crew worker')) {
      return sseText('Still checking the diff.');
    }
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, runtime }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const worker = await waitForWorkerField(dir, 'alisa', (item) => String(item.reviewText || '').includes('Still checking'));
    assert.equal(worker.reviewPassed, undefined);
    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
    assert.equal(landed.ok, false);
    assert.equal(landed.code, 'REVIEW_REQUIRED');
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
    const submitted = reviewerVerdict(body, blob, { passed: false, findings: ['missing tests'] });
    if (submitted) return submitted;
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
    assert.deepEqual(await fs.readdir(getProjectCrewWorktreesDir(dir)), ['alisa']);

    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
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
    const submitted = reviewerVerdict(body, blob, { passed: false, findings: ['missing tests'] });
    if (submitted) return submitted;
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

    const landed = await landCrewWorkers({ cwd: dir, base: 'main' });
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

test('review with paths is rejected; coding reviewer still runs without a crew roster', async () => {
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

  await withReviewRuntime({ crew: false }, async (body, blob) => {
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
    assert.equal(await fs.access(getProjectCrewWorktreesDir(dir)).then(() => true, () => false), false);
  });
});

test('cancel_worker aborts an in-flight review and keeps the author worktree', async () => {
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
    if (isParentUserTurn(body, /CANCEL_REVIEW/)) {
      return sseToolCalls([{
        id: 'call-cancel-review',
        name: 'cancel_worker',
        arguments: JSON.stringify({ worker_id: 'alisa' }),
      }]);
    }
    if (isParentUserTurn(body, /REMOVE_ALISA/)) {
      return sseToolCalls([{
        id: 'call-cancel-author',
        name: 'cancel_worker',
        arguments: JSON.stringify({ worker_id: 'alisa' }),
      }]);
    }
    if (blob.includes('You are reviewing Crew worker')) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const submitted = reviewerVerdict(body, blob, { passed: true, findings: [] });
      if (submitted) return submitted;
      return sseText('reviewed');
    }
    return sseText('FIRST_SHIFT_BODY');
  }, async ({ dir, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_ALISA' });
    await waitForWorkerStatus(dir, 'alisa', 'completed');
    await sealWorkerNotes(dir);
    await runtime.submitMessage({ text: 'REVIEW_ALISA' });
    const started = Date.now();
    while (Date.now() - started < 3000 && runtime.getCrewWorkersInFlight() === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(runtime.getCrewWorkersInFlight() > 0, 'reviewer should be in flight');
    await runtime.submitMessage({ text: 'CANCEL_REVIEW' });
    const cancelResult = session.messages.find((message) => message.tool_call_id === 'call-cancel-review');
    assert.ok(cancelResult, `missing cancel_worker result; ids=${session.messages.map((m) => m.tool_call_id).filter(Boolean).join(',')}`);
    assert.match(String(cancelResult.content || ''), /in-flight review of "alisa"/);
    assert.match(String(cancelResult.content || ''), /worktree was kept/);
    const afterReview = listCrewWorkersFromState(JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8')));
    assert.equal(afterReview.some((item) => item.id === 'alisa'), true);
    assert.equal(await fs.access(path.join(getProjectCrewWorktreesDir(dir), 'alisa')).then(() => true, () => false), true);
    assert.equal(runtime.getCrewWorkersInFlight(), 0);

    await runtime.submitMessage({ text: 'REMOVE_ALISA' });
    const removeResult = session.messages.find((message) => message.tool_call_id === 'call-cancel-author');
    assert.ok(removeResult, `missing second cancel_worker result; ids=${session.messages.map((m) => m.tool_call_id).filter(Boolean).join(',')}`);
    assert.match(String(removeResult.content || ''), /Cancelled Crew worker "alisa"/);
    const afterRemove = listCrewWorkersFromState(JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8')));
    assert.equal(afterRemove.some((item) => item.id === 'alisa'), false);
    assert.equal(await fs.access(path.join(getProjectCrewWorktreesDir(dir), 'alisa')).then(() => true, () => false), false);
  });
});

async function commitWorkerFile(worktreePath, relative, content) {
  const full = path.join(worktreePath, relative);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
  await git(worktreePath, ['add', relative]);
  await git(worktreePath, ['commit', '-m', `add ${relative}`]);
}

async function markCleanReview(dir, worker) {
  const sha = String((await git(worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
  await patchCrewWorkerRecord(dir, worker.id, {
    reviewedCommit: sha,
    reviewPassed: true,
    reviewText: 'Findings:\n- none',
  });
}

async function rebaseNoahWorktree(worktreePath, onto) {
  const rebase = await runGit(['rebase', onto], {
    cwd: worktreePath,
    allowFailure: true,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'crew@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'crew@test.local',
    },
  });
  assert.notEqual(rebase.code, 0);
  await fs.writeFile(path.join(worktreePath, 'README.md'), 'from-noah-rebased\n');
  await git(worktreePath, ['add', 'README.md']);
  await runGit(['-c', 'core.editor=true', 'rebase', '--continue'], {
    cwd: worktreePath,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_EDITOR: 'true',
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'crew@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'crew@test.local',
    },
  });
}

test('runtime resumes a conflicted worker, then reviews and lands after rebase', async () => {
  await withReviewRuntime({}, async (body, blob) => {
    if (isParentUserTurn(body, /SPAWN_PAIR/)) {
      return sseToolCalls([
        {
          id: 'call-mia',
          name: 'run_subagent',
          arguments: JSON.stringify({
            prompt: 'Docs worker',
            name: 'Mia',
            paths: ['docs/**'],
          }),
        },
        {
          id: 'call-noah',
          name: 'run_subagent',
          arguments: JSON.stringify({
            prompt: 'Src worker',
            name: 'Noah',
            paths: ['src/**'],
          }),
        },
      ]);
    }
    if (isParentUserTurn(body, /LAND_NOW|LAND_AGAIN/)) {
      return sseToolCalls([{
        id: /LAND_AGAIN/.test(lastUserText(body)) ? 'call-land-2' : 'call-land-1',
        name: 'land_workers',
        arguments: '{}',
      }]);
    }
    if (isParentUserTurn(body, /RESUME_NOAH/)) {
      return sseToolCalls([{
        id: 'call-resume-noah',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Resolve the README conflict after mia landed',
          resume: 'noah',
        }),
      }]);
    }
    if (isParentUserTurn(body, /REVIEW_NOAH/)) {
      return sseToolCalls([{
        id: 'call-review-noah',
        name: 'run_subagent',
        arguments: JSON.stringify({
          prompt: 'Review noah after rebase',
          role: 'reviewer',
          review: 'noah',
        }),
      }]);
    }
    const submitted = reviewerVerdict(body, blob, { passed: true, findings: [] });
    if (submitted) return submitted;
    return sseText('WORKER_BODY');
  }, async ({ dir, bodies, runtime, session }) => {
    await runtime.submitMessage({ text: 'SPAWN_PAIR' });
    await waitForWorkerStatus(dir, 'mia', 'completed');
    await waitForWorkerStatus(dir, 'noah', 'completed');
    const spawned = listCrewWorkersFromState(JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8')));
    const mia = spawned.find((item) => item.id === 'mia');
    const noah = spawned.find((item) => item.id === 'noah');
    await commitWorkerFile(mia.worktreePath, path.join('docs', 'a.md'), 'mia\n');
    await commitWorkerFile(noah.worktreePath, path.join('src', 'a.ts'), 'export {}\n');
    await commitWorkerFile(mia.worktreePath, 'README.md', 'from-mia\n');
    await commitWorkerFile(noah.worktreePath, 'README.md', 'from-noah\n');
    await patchCrewWorkerRecord(dir, 'mia', { paths: ['docs/**', 'README.md'] });
    await patchCrewWorkerRecord(dir, 'noah', { paths: ['src/**', 'README.md'] });
    await markCleanReview(dir, mia);
    await markCleanReview(dir, noah);

    await runtime.submitMessage({ text: 'LAND_NOW' });
    const landFail = session.messages.find((message) => message.tool_call_id === 'call-land-1');
    assert.ok(landFail, `missing first land_workers result; ids=${session.messages.map((m) => m.tool_call_id).filter(Boolean).join(',')}`);
    assert.match(String(landFail.content || ''), /REBASE_REQUIRED|conflicts with the current base tip/);
    const afterConflict = listCrewWorkersFromState(JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8')));
    const noahState = afterConflict.find((item) => item.id === 'noah');
    assert.equal(afterConflict.find((item) => item.id === 'mia')?.integrated, true);
    assert.ok(String(noahState.rebaseOnto || '').trim());
    assert.notEqual(noahState.reviewPassed, true);

    await runtime.submitMessage({ text: 'RESUME_NOAH' });
    await waitUntilBodies(bodies, (text) => text.includes('Do not merge into the user branch') && text.includes(noahState.rebaseOnto));
    const resumePrompt = bodies
      .map((item) => messageBlob(item))
      .find((text) => text.includes('Do not merge into the user branch'));
    assert.ok(resumePrompt);
    assert.match(resumePrompt, new RegExp(noahState.rebaseOnto));
    await waitForWorkerStatus(dir, 'noah', 'completed');
    await rebaseNoahWorktree(noah.worktreePath, noahState.rebaseOnto);

    await runtime.submitMessage({ text: 'REVIEW_NOAH' });
    await waitForWorkerField(dir, 'noah', (item) => item.reviewPassed === true);

    await runtime.submitMessage({ text: 'LAND_AGAIN' });
    const landOk = session.messages.find((message) => message.tool_call_id === 'call-land-2');
    assert.ok(landOk, `missing second land_workers result; ids=${session.messages.map((m) => m.tool_call_id).filter(Boolean).join(',')}`);
    assert.match(String(landOk.content || ''), /Landed|onto the current branch/);
    assert.equal(await fs.readFile(path.join(dir, 'README.md'), 'utf8'), 'from-noah-rebased\n');
    const saved = listCrewWorkersFromState(JSON.parse(await fs.readFile(getProjectCrewStatePath(dir), 'utf8')));
    assert.equal(saved.length, 0);
  });
});
