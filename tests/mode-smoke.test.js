/**
 * Post-merge smoke: normal / plan (coding) / crew each get one runtime turn with a mock model.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { createChatRuntime } from '../src/core/chat-runtime.js';
import { runGit } from '../src/core/process-run.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { createSession } from '../src/core/session-store.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

function sseText(content = 'ok') {
  return [
    `data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
}

function toolNames(body) {
  return (Array.isArray(body?.tools) ? body.tools : [])
    .map((item) => item?.function?.name || item?.name)
    .filter(Boolean);
}

async function git(cwd, args) {
  return runGit(args, {
    cwd,
    allowFailure: false,
    timeoutMs: 15_000,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Codemini Test',
      GIT_AUTHOR_EMAIL: 'smoke@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'smoke@test.local',
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

async function withSmokeRuntime(mode, task, { gitRepo = false } = {}) {
  closeSqliteDatabasesForTests();
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-mode-smoke-'));
  const dir = path.join(globalDir, 'workspace');
  await fs.mkdir(dir, { recursive: true });
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    try {
      bodies.push(JSON.parse(raw));
    } catch {
      bodies.push(null);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(sseText('smoke-ok'));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await withCodeminiGlobalDir(globalDir, async () => {
      if (gitRepo) await initCleanGit(dir);
      const port = server.address().port;
      const config = {
        sdk: { provider: 'openai-compatible' },
        gateway: { base_url: `http://127.0.0.1:${port}/v1`, api_key: 'test', max_retries: 0 },
        model: { name: 'test-model', reasoning_enabled: false, reasoning_effort: 'off' },
        context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 99 },
        execution: { mode, approval_mode: 'auto' },
        crew: { max_workers: 4 },
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
      const session = await createSession(dir);
      const runtime = await createChatRuntime({
        session,
        config,
        model: 'test-model',
        systemPrompt: 'stable',
        workspaceRoot: dir,
      });
      await task({ dir, bodies, runtime });
      await runtime.dispose?.();
    });
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    closeSqliteDatabasesForTests();
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
}

test('smoke: normal mode turn exposes daily tools, not crew parent tools', async () => {
  await withSmokeRuntime('normal', async ({ bodies, runtime }) => {
    assert.equal(runtime.getRuntimeState().mode, 'normal');
    assert.equal(runtime.getRuntimeState().crewActive, false);
    const result = await runtime.submitMessage({ text: 'hello normal smoke' });
    assert.equal(result?.text, 'smoke-ok');
    assert.equal(bodies.length, 1);
    const names = toolNames(bodies[0]);
    assert.equal(names.includes('write') || names.includes('edit'), true);
    assert.equal(names.includes('crew_plan'), false);
    assert.equal(names.includes('land_workers'), false);
  });
});

test('smoke: plan (coding) mode turn exposes coding tools, not crew parent tools', async () => {
  await withSmokeRuntime('plan', async ({ bodies, runtime }) => {
    assert.equal(runtime.getRuntimeState().mode, 'plan');
    assert.equal(runtime.getRuntimeState().crewActive, false);
    const result = await runtime.submitMessage({ text: 'hello coding smoke' });
    assert.equal(result?.text, 'smoke-ok');
    const names = toolNames(bodies[0]);
    assert.equal(names.includes('run_subagent'), true);
    assert.equal(names.includes('crew_plan'), false);
    assert.equal(names.includes('land_workers'), false);
  });
});

test('smoke: crew mode parent turn exposes crew_plan and blocks parent write', async () => {
  await withSmokeRuntime('plan', async ({ bodies, runtime }) => {
    const entered = await runtime.setCrewMode(true);
    assert.equal(entered.ok, true);
    assert.equal(runtime.getRuntimeState().mode, 'crew');
    assert.equal(runtime.getRuntimeState().crewActive, true);
    const result = await runtime.submitMessage({ text: 'hello crew smoke' });
    assert.equal(result?.text, 'smoke-ok');
    const system = bodies.at(-1)?.messages?.[0]?.content || '';
    assert.match(String(system), /Crew Mode: on/);
    const names = toolNames(bodies.at(-1));
    assert.equal(names.includes('crew_plan'), true);
    assert.equal(names.includes('crew_status'), true);
    assert.equal(names.includes('land_workers'), true);
    assert.equal(names.includes('crew_finish'), true);
    assert.equal(names.includes('run_subagent'), true);
    assert.equal(names.includes('write'), false);
    assert.equal(names.includes('edit'), false);
  }, { gitRepo: true });
});

test('smoke: leaving crew restores plan tools and drops crew parent tools', async () => {
  await withSmokeRuntime('plan', async ({ bodies, runtime }) => {
    const entered = await runtime.setCrewMode(true);
    assert.equal(entered.ok, true);
    await runtime.submitMessage({ text: 'enter crew' });
    const left = await runtime.setCrewMode(false);
    assert.equal(left.ok, true);
    assert.equal(runtime.getRuntimeState().crewActive, false);
    assert.equal(runtime.getRuntimeState().mode, 'plan');
    const result = await runtime.submitMessage({ text: 'back to coding' });
    assert.equal(result?.text, 'smoke-ok');
    const names = toolNames(bodies.at(-1));
    assert.equal(names.includes('crew_plan'), false);
    assert.equal(names.includes('land_workers'), false);
    assert.equal(names.includes('crew_finish'), false);
    assert.equal(names.includes('run_subagent'), true);
    assert.equal(names.includes('write') || names.includes('edit'), true);
  }, { gitRepo: true });
});

test('smoke: coding alias normalizes to plan with coding tools', async () => {
  await withSmokeRuntime('coding', async ({ bodies, runtime }) => {
    assert.equal(runtime.getRuntimeState().mode, 'plan');
    assert.equal(runtime.getRuntimeState().crewActive, false);
    const result = await runtime.submitMessage({ text: 'hello coding alias' });
    assert.equal(result?.text, 'smoke-ok');
    const names = toolNames(bodies[0]);
    assert.equal(names.includes('run_subagent'), true);
    assert.equal(names.includes('crew_plan'), false);
  });
});
