import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fileMatchesTowerGlob,
  findOverlappingTowerWorker,
  normalizeTowerPaths,
  orderTowerWorkersForLand,
  towerGlobsOverlap,
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
  assert.deepEqual(sub?.function?.parameters?.required || [], []);
});

test('tower getBuiltinTools exposes paths and resume, and registers land_workers', () => {
  const { definitions, handlers } = getBuiltinTools({
    towerActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true, message: 'landed' }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  const sub = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(names.includes('land_workers'), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.paths), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.resume), true);
  assert.deepEqual(sub?.function?.parameters?.required || [], []);
  assert.match(String(sub?.function?.description || ''), /resume/i);
  assert.equal(typeof handlers.land_workers, 'function');
});

test('applyTowerParentToolPolicy strips mutation tools only when tower is on', () => {
  const coding = ['read', 'write', 'edit', 'run_subagent'];
  assert.deepEqual(applyTowerParentToolPolicy(coding, { towerActive: false }), coding);
  const tower = applyTowerParentToolPolicy(coding, { towerActive: true });
  assert.equal(tower.includes('write'), false);
  assert.equal(tower.includes('edit'), false);
  assert.equal(tower.includes('run_subagent'), true);
  assert.equal(tower.includes('land_workers'), true);
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
  assert.equal(
    compactSubAgentResultForParent({ text: 'done', dirty: false }).includes('Worker id:'),
    false,
  );
});
