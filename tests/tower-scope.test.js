import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fileMatchesTowerGlob,
  findOverlappingTowerWorker,
  normalizeTowerPaths,
  orderTowerWorkersForLand,
  towerGlobsOverlap,
  towerWorkerBlocksSpawn,
  workerHoldsTowerScope,
} from '../src/core/tower-scope.js';
import { applyTowerParentToolPolicy, compactSubAgentResultForParent } from '../src/core/chat-runtime.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('normalizeTowerPaths drops empties, dots, and absolute globs', () => {
  assert.deepEqual(normalizeTowerPaths(['docs/**', './src/foo.ts', 'docs/**', '/etc/passwd', '../secret']), [
    'docs/**',
    'src/foo.ts',
  ]);
});

test('tower globs overlap on nested and identical scopes, not sibling dirs', () => {
  assert.equal(towerGlobsOverlap('docs/**', 'docs/api/**'), true);
  assert.equal(towerGlobsOverlap('src/foo.ts', 'src/foo.ts'), true);
  assert.equal(towerGlobsOverlap('src/**', 'src/a.ts'), true);
  assert.equal(towerGlobsOverlap('frontend/**', 'backend/**'), false);
  assert.equal(towerGlobsOverlap('src/a.ts', 'src/b.ts'), false);
});

test('fileMatchesTowerGlob understands ** and exact files', () => {
  assert.equal(fileMatchesTowerGlob('docs/a.md', 'docs/**'), true);
  assert.equal(fileMatchesTowerGlob('src/foo.ts', 'src/foo.ts'), true);
  assert.equal(fileMatchesTowerGlob('src/bar.ts', 'src/foo.ts'), false);
  assert.equal(fileMatchesTowerGlob('backend/x.ts', 'frontend/**'), false);
});

test('findOverlappingTowerWorker reports the colliding glob', () => {
  const hit = findOverlappingTowerWorker(['docs/guide.md'], [
    { id: 'anna', paths: ['docs/**'] },
  ]);
  assert.equal(hit.worker.id, 'anna');
  assert.equal(hit.existing, 'docs/**');
  assert.equal(findOverlappingTowerWorker(['backend/**'], [{ id: 'anna', paths: ['docs/**'] }]), null);
  assert.equal(
    findOverlappingTowerWorker(['docs/guide.md'], [
      { id: 'anna', paths: ['docs/**'], integrated: true },
    ]),
    null,
  );
  assert.equal(
    findOverlappingTowerWorker(['other.md'], [
      { id: 'anna', paths: ['notes.md'] },
    ], { exceptId: 'anna' }),
    null,
  );
});

test('integrated workers do not hold scope; active workers block overlapping spawn', () => {
  const integrated = { id: 'anna', paths: ['docs/**'], integrated: true };
  const active = { id: 'mira', paths: ['backend/**'] };
  assert.equal(workerHoldsTowerScope(integrated), false);
  assert.equal(towerWorkerBlocksSpawn(integrated), true);
  assert.equal(workerHoldsTowerScope(active), true);
  assert.equal(towerWorkerBlocksSpawn(active), true);
  assert.equal(findOverlappingTowerWorker(['docs/**'], [integrated]), null);
  assert.equal(findOverlappingTowerWorker(['backend/**'], [active])?.worker?.id, 'mira');
  assert.ok(findOverlappingTowerWorker(['docs/**'], [{ id: 'busy', paths: ['docs/**'] }]));
});

test('orderTowerWorkersForLand follows dependsOn then spawn order', () => {
  const ordered = orderTowerWorkersForLand([
    { id: 'b', taskId: 'b', dependsOn: ['a'] },
    { id: 'a', taskId: 'a', dependsOn: [] },
    { id: 'c', taskId: 'c' },
  ]);
  assert.equal(ordered[0].id, 'a');
  assert.equal(ordered[1].id, 'b');
  assert.equal(ordered[2].id, 'c');
});

test('coding getBuiltinTools has no paths and no land_workers', () => {
  const { definitions } = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true }),
    onForkTask: async () => ({ ok: true }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  const sub = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(names.includes('land_workers'), false);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.paths), false);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.resume), false);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.review), false);
  assert.deepEqual(sub?.function?.parameters?.required || [], []);
});

function shellTool(bundle) {
  const def = bundle.definitions.find((item) => ['run', 'Bash', 'Powershell'].includes(item.function?.name));
  const name = def?.function?.name;
  return { name, def, handler: name ? bundle.handlers[name] : undefined };
}

test('tower parent run is inspect-only; coding run is unchanged', async () => {
  const tower = getBuiltinTools({
    towerActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  const towerRun = shellTool(tower);
  assert.match(String(towerRun.def?.function?.description || ''), /inspect-only/i);
  assert.equal(typeof towerRun.handler, 'function');
  await assert.rejects(
    () => towerRun.handler({ command: 'git merge feature' }),
    /inspect-only/,
  );
  await assert.rejects(
    () => towerRun.handler({ command: 'cp notes.md /tmp/notes.md' }),
    /inspect-only/,
  );

  const coding = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true }),
  });
  const codingRun = shellTool(coding);
  assert.equal(String(codingRun.def?.function?.description || '').includes('inspect-only'), false);
  assert.equal(typeof codingRun.handler, 'function');
});

test('tower getBuiltinTools exposes paths and resume, and registers land_workers', () => {
  const { definitions, handlers } = getBuiltinTools({
    towerActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onForkTask: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true, message: 'landed' }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  const sub = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(names.includes('land_workers'), true);
  assert.equal(names.includes('fork_task'), false);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.paths), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.resume), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.review), true);
  assert.deepEqual(sub?.function?.parameters?.required || [], []);
  assert.match(String(sub?.function?.description || ''), /resume/i);
  assert.equal(typeof handlers.land_workers, 'function');
});

test('applyTowerParentToolPolicy strips mutation tools only when tower is on', () => {
  const coding = ['read', 'write', 'edit', 'run', 'run_subagent', 'fork_task'];
  assert.deepEqual(applyTowerParentToolPolicy(coding, { towerActive: false }), coding);
  const tower = applyTowerParentToolPolicy(coding, { towerActive: true });
  assert.equal(tower.includes('write'), false);
  assert.equal(tower.includes('edit'), false);
  assert.equal(tower.includes('fork_task'), false);
  assert.equal(tower.includes('run_subagent'), true);
  assert.equal(tower.includes('land_workers'), true);
  assert.equal(tower.includes('run'), true);
});

test('submit_tower_review is only exposed when a verdict callback is wired', async () => {
  const hidden = getBuiltinTools({
    towerActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  assert.equal(
    hidden.definitions.some((item) => item.function?.name === 'submit_tower_review'),
    false,
  );

  let seen = null;
  const { definitions, handlers } = getBuiltinTools({
    config: {
      runtime: {
        onTowerReviewVerdict: (verdict) => {
          seen = verdict;
        },
      },
    },
  });
  assert.equal(
    definitions.some((item) => item.function?.name === 'submit_tower_review'),
    true,
  );
  const ok = await handlers.submit_tower_review({ passed: true, findings: [] });
  assert.equal(ok.ok, true);
  assert.deepEqual(seen, { passed: true, findings: [] });
  const rejected = await handlers.submit_tower_review({ passed: true, findings: ['none'] });
  assert.equal(rejected.ok, false);
  assert.deepEqual(seen, { passed: true, findings: [] });
});

test('compactSubAgentResultForParent reports dirty vs sealed worktrees', () => {
  assert.match(
    compactSubAgentResultForParent({ text: 'blocked on types', dirty: true }),
    /not sealed/,
  );
  assert.match(
    compactSubAgentResultForParent({ text: 'done', dirty: false }),
    /Worktree: sealed/,
  );
  assert.equal(
    compactSubAgentResultForParent({ text: 'done' }).includes('Worktree:'),
    false,
  );
  assert.match(
    compactSubAgentResultForParent({ text: 'done', dirty: false, workerId: 'alisa' }),
    /resume: "alisa"/,
  );
  assert.match(
    compactSubAgentResultForParent({ text: 'done', dirty: false, workerId: 'alisa' }),
    /Omit paths to keep the stored scope/,
  );
  assert.equal(
    compactSubAgentResultForParent({ text: 'done', dirty: false }).includes('Worker id:'),
    false,
  );
  assert.match(
    compactSubAgentResultForParent({ text: 'Findings:\n- none', reviewOf: 'alisa', reviewPassed: true }),
    /Review of "alisa" passed/,
  );
  assert.match(
    compactSubAgentResultForParent({ text: 'Findings:\n- missing tests', reviewOf: 'alisa', reviewPassed: false }),
    /Resume "alisa"/,
  );
  assert.match(
    compactSubAgentResultForParent({
      text: 'Findings:\n- missing tests',
      reviewOf: 'alisa',
      reviewPassed: false,
      reviewLoopStopped: true,
      reviewRound: 2,
    }),
    /loop stopped after 2 rounds/,
  );
  assert.match(
    compactSubAgentResultForParent({
      text: 'Findings:\n- missing tests',
      reviewOf: 'alisa',
      reviewPassed: false,
      reviewLoopStopped: true,
      reviewRound: 2,
    }),
    /Resume "alisa" with a new task or paths/,
  );
});
