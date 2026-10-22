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
    assert.equal(state.batchClosed, undefined);
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
