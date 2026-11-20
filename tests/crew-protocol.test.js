import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { evaluateCrewParentCommand } from '../src/core/crew-shell.js';
import { classifyCommandRisk } from '../src/core/command-risk.js';
import { finishCrewMissions, planCrewMissions } from '../src/core/crew-missions.js';
import { landCrewWorkers } from '../src/core/crew-land.js';
import { enterCrewMode, readCrewStateFile } from '../src/core/crew-store.js';
import { formatCrewStatusSummary, readCrewStatusPayload } from '../src/core/crew-snapshot.js';
import { resolveCrewSubagentWorkspace, addCrewWorktree } from '../src/core/crew-worktree.js';
import { runGit } from '../src/core/process-run.js';

test('coding mode tool list does not gain crew mission tools', () => {
  const tools = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { runtime: {} },
    crewActive: false,
    onRunSubAgent: async () => ({ ok: true }),
  });
  const names = tools.definitions
    .map((item) => item?.function?.name || item?.name)
    .filter(Boolean);
  assert.equal(names.includes('crew_plan'), false);
  assert.equal(names.includes('crew_complete'), false);
  assert.equal(names.includes('crew_finish'), false);
  const run = tools.definitions.find((item) => (item?.function?.name || item?.name) === 'run_subagent');
  assert.ok(run);
  const properties = run.function?.parameters?.properties || run.parameters?.properties;
  assert.equal(properties.mission_id, undefined);
});

test('crew_finish tool description deletes finished ledger records', () => {
  const tools = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { runtime: {} },
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
  });
  const finish = tools.definitions.find((item) => (item?.function?.name || item?.name) === 'crew_finish');
  assert.ok(finish);
  const description = finish.function?.description || finish.description || '';
  assert.match(description, /delete those finished mission and worker records/);
  assert.doesNotMatch(description, /does not delete the ledger/);
  assert.match(description, /already clean/);
});

test('crew parent shell blocks ledger writes without changing command risk classes', () => {
  const command = 'rm -rf .codemini/crew/state.json';
  const risk = classifyCommandRisk(command, 'bash', process.platform);
  assert.notEqual(risk, 'read-only');
  const crew = evaluateCrewParentCommand(command, process.platform);
  assert.equal(crew.allowed, false);
  assert.match(crew.reason, /crew_plan/);
  const status = evaluateCrewParentCommand('git status', process.platform);
  assert.equal(status.allowed, true);
});

test('crew_plan rejects overlap and crew_finish rejects an open mission', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-plan-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'global');
  try {
    await enterCrewMode({ cwd: dir, sessionId: 'plan' }).catch(() => null);
    await fs.mkdir(path.join(dir, '.codemini', 'crew'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codemini', 'crew', 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
      missions: [],
    }));
    const overlap = await planCrewMissions(dir, {
      missions: [
        { title: 'List', kind: 'build', paths: ['frontend/src/**'] },
        { title: 'Detail', kind: 'build', paths: ['frontend/src/views/**'] },
      ],
    });
    assert.equal(overlap.ok, false);
    assert.equal(overlap.code, 'SCOPE_OVERLAP');
    const planned = await planCrewMissions(dir, {
      missions: [
        { title: 'Data', kind: 'build', paths: ['backend/**'] },
        { title: 'List', kind: 'build', paths: ['frontend/src/views/**'] },
        { title: 'Detail', kind: 'build', paths: ['frontend/src/components/**'] },
      ],
    });
    assert.equal(planned.ok, true, planned.error);
    assert.equal(planned.created.length, 3);
    const finish = await finishCrewMissions({ cwd: dir, inFlight: [] });
    assert.equal(finish.ok, false);
    assert.equal(finish.code, 'MISSIONS_OPEN');
    const state = await readCrewStateFile(dir);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('crew_finish refuses completed build missions that are not merged yet', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-finish-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'global');
  try {
    await enterCrewMode({ cwd: dir, sessionId: 'finish' }).catch(() => null);
    await fs.mkdir(path.join(dir, '.codemini', 'crew'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codemini', 'crew', 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [{ id: 'w1', branch: 'codemini-crew/w1', worktreePath: '/tmp/w1', missionId: 'm1' }],
      missions: [{ id: 'm1', title: 'Build', kind: 'build', status: 'completed', paths: ['src/**'], workerId: 'w1' }],
    }));
    const finish = await finishCrewMissions({ cwd: dir, inFlight: [] });
    assert.equal(finish.ok, false);
    assert.equal(finish.code, 'MISSIONS_OPEN');
    assert.match(finish.error, /not terminal/i);
    assert.match(finish.error, /m1 \(completed\)/);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

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

test('landing one mission leaves the others dispatchable', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-one-land-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'global');
  try {
    const template = path.join(dir, '.git-template');
    await fs.mkdir(template, { recursive: true });
    await git(dir, ['init', `--template=${template}`]);
    await fs.writeFile(path.join(dir, '.gitignore'), '.codemini/\n');
    await fs.writeFile(path.join(dir, 'README.md'), 'hello\n');
    await git(dir, ['add', '.']);
    await git(dir, ['commit', '-m', 'init']);
    await git(dir, ['branch', '-M', 'main']);
    await enterCrewMode({ cwd: dir, sessionId: 'land-one' });
    const planned = await planCrewMissions(dir, {
      missions: [
        { title: 'Data', kind: 'build', paths: ['backend/**'] },
        { title: 'List', kind: 'build', paths: ['frontend/list/**'] },
        { title: 'Detail', kind: 'build', paths: ['frontend/detail/**'] },
      ],
    });
    assert.equal(planned.ok, true, planned.error);
    const data = planned.created.find((mission) => mission.title === 'Data');
    const list = planned.created.find((mission) => mission.title === 'List');
    const refused = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'Nobody',
      paths: ['backend/**'],
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.code, 'MISSION_REQUIRED');
    const spawned = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'Data',
      paths: ['backend/**'],
      missionId: data.id,
    });
    assert.equal(spawned.ok, true, spawned.error);
    await fs.mkdir(path.join(spawned.worker.worktreePath, 'backend'), { recursive: true });
    await fs.writeFile(path.join(spawned.worker.worktreePath, 'backend', 'api.js'), 'export const readLater = true\n');
    await git(spawned.worker.worktreePath, ['add', 'backend/api.js']);
    await git(spawned.worker.worktreePath, ['commit', '-m', 'data']);
    const sha = String((await git(spawned.worker.worktreePath, ['rev-parse', 'HEAD'])).stdout || '').trim();
    const { patchCrewWorkerRecord } = await import('../src/core/crew-store.js');
    const { setCrewMissionStatus } = await import('../src/core/crew-missions.js');
    await patchCrewWorkerRecord(dir, spawned.worker.id, { reviewedCommit: sha, reviewPassed: true });
    await setCrewMissionStatus(dir, data.id, 'completed');
    const landed = await landCrewWorkers({ cwd: dir, base: 'main', missionId: data.id });
    assert.equal(landed.ok, true, landed.error);
    assert.match(landed.message, new RegExp(list.id));
    const again = await resolveCrewSubagentWorkspace({
      cwd: dir,
      base: 'main',
      name: 'List',
      paths: ['frontend/list/**'],
      missionId: list.id,
    });
    assert.equal(again.ok, true, again.error);
    const state = await readCrewStateFile(dir);
    assert.equal(state.batchClosed, undefined);
    assert.equal(state.active, true);
    const tooSoon = await finishCrewMissions({ cwd: dir });
    assert.equal(tooSoon.ok, false);
    assert.equal(tooSoon.code, 'MISSIONS_OPEN');
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('spawn still works without mission_id outside the crew resolver', () => {
  assert.equal(typeof addCrewWorktree, 'function');
});

test('crew_status keeps open missions and the latest eight finished ones', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-status-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'global');
  try {
    const missions = [];
    const workers = [];
    for (let index = 1; index <= 12; index += 1) {
      const id = `m${index}`;
      const workerId = `w${index}`;
      missions.push({
        id,
        title: `Done ${index}`,
        kind: 'build',
        status: 'merged',
        paths: [`f${index}.md`],
        workerId,
      });
      workers.push({
        id: workerId,
        branch: `codemini-crew/${workerId}`,
        worktreePath: `/tmp/${workerId}`,
        missionId: id,
        name: `N${index}`,
      });
    }
    missions.push({
      id: 'm13',
      title: 'Still open',
      kind: 'build',
      status: 'planned',
      paths: ['open.md'],
    });
    await fs.mkdir(path.join(dir, '.codemini', 'crew'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codemini', 'crew', 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      missions,
      workers,
    }));
    const payload = await readCrewStatusPayload(dir, { limit: 8 });
    assert.match(payload.suggestedNext, /crew_plan|Dispatch/);
    assert.equal(payload.missions.some((mission) => mission.id === 'm13'), true);
    assert.equal(payload.missions.some((mission) => mission.id === 'm1'), false);
    assert.equal(payload.missions.some((mission) => mission.id === 'm12'), true);
    assert.equal(payload.counts.omittedMissions, 4);
    const summary = formatCrewStatusSummary(payload);
    assert.match(summary, /^Next:/);
    const wider = await readCrewStatusPayload(dir, { limit: 20 });
    assert.equal(wider.missions.some((mission) => mission.id === 'm1'), true);
    assert.match(summary, /mission m13 \| planned \| build \| Still open/);
    assert.match(summary, /Paths: open\.md/);
    assert.match(summary, /Depends on: \(none\)/);
    assert.doesNotMatch(summary, /Paths: f12\.md/);
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('crew_plan returns ledger fields and status expands only undispatched missions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-crew-plan-fields-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = path.join(dir, 'global');
  try {
    await enterCrewMode({ cwd: dir, sessionId: 'plan-fields' }).catch(() => null);
    await fs.mkdir(path.join(dir, '.codemini', 'crew'), { recursive: true });
    await fs.writeFile(path.join(dir, '.codemini', 'crew', 'state.json'), JSON.stringify({
      version: 1,
      active: true,
      base: 'main',
      workers: [],
      missions: [],
    }));
    const planned = await planCrewMissions(dir, {
      missions: [
        { title: 'API', kind: 'build', paths: ['backend/**'], context: 'add the flag' },
        { title: 'UI', kind: 'build', paths: ['frontend/**'], depends_on: ['m1'], context: 'wait for the flag' },
      ],
    });
    assert.equal(planned.ok, true, planned.error);
    assert.match(planned.message, /Planned m1 \(API\), m2 \(UI\)/);
    assert.match(planned.message, /m1 \| build \| API/);
    assert.match(planned.message, /Paths: backend\/\*\*/);
    assert.match(planned.message, /Depends on: \(none\)/);
    assert.match(planned.message, /Context: add the flag/);
    assert.match(planned.message, /m2 \| build \| UI/);
    assert.match(planned.message, /Paths: frontend\/\*\*/);
    assert.match(planned.message, /Depends on: m1/);
    assert.match(planned.message, /Context: wait for the flag/);
    const summary = formatCrewStatusSummary({
      ok: true,
      suggestedNext: 'Dispatch with run_subagent mission_id for: m1.',
      base: 'main',
      fetchedAt: 't',
      counts: {},
      missions: [
        { id: 'm1', status: 'active', kind: 'build', title: 'API', paths: ['backend/**'], context: 'add the flag' },
        { id: 'm2', status: 'planned', kind: 'build', title: 'UI', paths: ['frontend/**'], dependsOn: ['m1'], context: 'wait for the flag' },
      ],
    });
    assert.match(summary, /- mission m1 \| active \| build \| API/);
    assert.doesNotMatch(summary, /add the flag/);
    assert.match(summary, /- mission m2 \| planned \| build \| UI/);
    assert.match(summary, /Paths: frontend\/\*\*/);
    assert.match(summary, /Depends on: m1/);
    assert.match(summary, /Context: wait for the flag/);
    const long = '约'.repeat(400);
    const wrapped = formatCrewStatusSummary({
      ok: true,
      base: 'main',
      fetchedAt: 't',
      counts: {},
      missions: [{ id: 'm9', status: 'planned', kind: 'build', title: 'Long', paths: ['a.ts'], context: long }],
    });
    assert.equal(wrapped.replace(/Context: /, '').replace(/\n {2}/g, '').includes(long), true);
    for (const line of wrapped.split('\n')) {
      assert.ok(line.length <= 220, line.length);
    }
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
