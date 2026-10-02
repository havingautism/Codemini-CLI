import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { formatCrewStatusSummary, readCrewStatusPayload } from '../src/core/crew-snapshot.js';
import {
  appendCrewEvent,
  buildCrewCompletionEvent,
  archiveCrewInbox,
  enterCrewMode,
  exitCrewMode,
  listCrewEventsFromState,
  listCrewInboxFromState,
  listUnreadCrewInbox,
  readCrewStateFile,
  writeCrewStateFile,
} from '../src/core/crew-store.js';
import { composeCrewResumeTask } from '../src/core/crew-worktree.js';
import { runGit } from '../src/core/process-run.js';

async function withTempDir(task) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-inbox-'));
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
      GIT_AUTHOR_EMAIL: 'crew@test.local',
      GIT_COMMITTER_NAME: 'Codemini Test',
      GIT_COMMITTER_EMAIL: 'crew@test.local',
    },
  });
}

async function initCrew(dir) {
  const template = path.join(dir, '.git-template');
  await fs.mkdir(template, { recursive: true });
  await git(dir, ['init', `--template=${template}`]);
  await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
  await git(dir, ['add', '.']);
  await git(dir, ['commit', '-m', 'init']);
  await git(dir, ['branch', '-M', 'main']);
  const entered = await enterCrewMode({ cwd: dir, sessionId: 's1' });
  assert.equal(entered.ok, true);
  await writeCrewStateFile(dir, {
    workers: [{
      id: 'ada',
      branch: 'codemini-crew/ada',
      worktreePath: path.join(dir, '.codemini', 'crew', 'worktrees', 'ada'),
      paths: ['web/**'],
      task: '收藏夹前端',
      runStatus: 'completed',
      dirty: false,
    }],
  });
}

function tools(dir, actor) {
  return getBuiltinTools({
    workspaceRoot: dir,
    crewActive: true,
    config: { runtime: { crew_actor: actor, crew_project_root: dir } },
  }).handlers;
}

test('crew_send stores the full body and does not mark it delivered', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    const sent = await tools(dir, 'coordinator').crew_send({
      to: 'ada',
      subject: 'api-shape',
      body: '返回 { id, createdAt }。',
    });
    assert.equal(sent.ok, true);
    assert.equal(sent.message.to, 'ada');
    assert.equal(sent.message.delivered, false);
    const file = await fs.readFile(path.join(dir, '.codemini', 'crew', sent.message.path), 'utf8');
    assert.match(file, /createdAt/);
    const state = await readCrewStateFile(dir);
    assert.equal(listCrewInboxFromState(state).length, 1);
    assert.equal(listCrewEventsFromState(state).length, 0);
  });
});

test('crew_send rejects self, unknown, integrated, and empty body', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    const self = await tools(dir, 'ada').crew_send({ to: 'ada', body: 'hi' });
    assert.equal(self.code, 'SELF');
    const missing = await tools(dir, 'coordinator').crew_send({ to: 'nobody', body: 'hi' });
    assert.equal(missing.code, 'UNKNOWN_RECIPIENT');
    const empty = await tools(dir, 'coordinator').crew_send({ to: 'ada', body: '  ' });
    assert.equal(empty.code, 'EMPTY');
    const state = await readCrewStateFile(dir);
    state.workers[0].integrated = true;
    await writeCrewStateFile(dir, { workers: state.workers });
    const landed = await tools(dir, 'coordinator').crew_send({ to: 'ada', body: 'late' });
    assert.equal(landed.code, 'INTEGRATED');
  });
});

test('worker inbox consumes its mail and the coordinator read does not', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    await tools(dir, 'coordinator').crew_send({ to: 'ada', subject: 'fields', body: 'id and createdAt' });
    const peeked = await tools(dir, 'coordinator').crew_inbox();
    assert.equal(peeked.count, 1);
    assert.match(peeked.text, /createdAt/);
    assert.equal((await readCrewStateFile(dir)).inbox[0].delivered, false);
    const read = await tools(dir, 'ada').crew_inbox();
    assert.equal(read.count, 1);
    assert.equal((await readCrewStateFile(dir)).inbox[0].delivered, true);
    const again = await tools(dir, 'ada').crew_inbox();
    assert.equal(again.count, 0);
  });
});

test('broadcast mail stays unread for the coordinator and other workers', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    await tools(dir, 'ada').crew_send({
      to: 'all',
      subject: 'contract',
      body: 'version is a string',
    });
    const first = await tools(dir, 'ben').crew_inbox();
    assert.equal(first.count, 1);
    const state = await readCrewStateFile(dir);
    assert.equal(state.inbox[0].delivered, false);
    assert.deepEqual(state.inbox[0].readBy, ['ben']);
    assert.equal((await tools(dir, 'ben').crew_inbox()).count, 0);
    assert.equal((await tools(dir, 'ada').crew_inbox()).count, 0);
    assert.equal((await tools(dir, 'coordinator').crew_inbox()).count, 1);
    assert.equal(listUnreadCrewInbox(await readCrewStateFile(dir), { to: 'cyra' }).length, 1);
  });
});

test('crew_status shows the roster task and unread inbox without dropping completion events', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    for (let i = 0; i < 51; i += 1) {
      await appendCrewEvent(dir, buildCrewCompletionEvent({
        workerId: 'ada',
        status: 'completed',
        summary: `note ${i}`,
      }));
    }
    await tools(dir, 'coordinator').crew_send({ to: 'ada', subject: 'api', body: 'keep me' });
    const state = await readCrewStateFile(dir);
    assert.equal(listCrewEventsFromState(state).length, 50);
    assert.equal(listCrewInboxFromState(state).length, 1);
    const payload = await readCrewStatusPayload(dir);
    const summary = formatCrewStatusSummary(payload);
    assert.match(summary, /task=收藏夹前端/);
    assert.match(summary, /coordinator -> ada: api/);
    assert.match(composeCrewResumeTask('continue', '', '', '', 'From coordinator to ada: api\nkeep me'), /Unread crew mail/);
  });
});

test('leaving Crew keeps unread mail; archiving drops it from unread and keeps the file', async () => {
  await withTempDir(async (dir) => {
    await initCrew(dir);
    await tools(dir, 'coordinator').crew_send({ to: 'ada', subject: 'api', body: 'old round' });
    await tools(dir, 'ada').crew_send({ to: 'coordinator', subject: 'ack', body: 'seen' });
    await exitCrewMode({ cwd: dir, sessionId: 's1' });
    const exited = await readCrewStateFile(dir);
    assert.equal(exited.active, false);
    assert.equal(listUnreadCrewInbox(exited, { to: 'coordinator' }).length, 2);
    const archived = await archiveCrewInbox(dir);
    assert.equal(archived.marked, 2);
    const state = await readCrewStateFile(dir);
    assert.equal(listCrewInboxFromState(state).every((item) => item.archived === true), true);
    assert.equal(listUnreadCrewInbox(state, { to: 'coordinator' }).length, 0);
    assert.equal((await fs.readdir(path.join(dir, '.codemini', 'crew', 'inbox'))).length, 2);
  });
});
