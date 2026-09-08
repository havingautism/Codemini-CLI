import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fileMatchesCrewGlob,
  findOverlappingCrewWorker,
  normalizeCrewPaths,
  orderCrewWorkersForLand,
  crewGlobsOverlap,
  crewWorkerBlocksSpawn,
  workerHoldsCrewScope,
} from '../src/core/crew-scope.js';
import { applyCrewParentToolPolicy, compactSubAgentResultForParent } from '../src/core/chat-runtime.js';
import { getBuiltinTools } from '../src/core/tools.js';

test('normalizeCrewPaths drops empties, dots, and absolute globs', () => {
  assert.deepEqual(normalizeCrewPaths(['docs/**', './src/foo.ts', 'docs/**', '/etc/passwd', '../secret']), [
    'docs/**',
    'src/foo.ts',
  ]);
});

test('crew globs overlap on nested and identical scopes, not sibling dirs', () => {
  assert.equal(crewGlobsOverlap('docs/**', 'docs/api/**'), true);
  assert.equal(crewGlobsOverlap('src/foo.ts', 'src/foo.ts'), true);
  assert.equal(crewGlobsOverlap('src/**', 'src/a.ts'), true);
  assert.equal(crewGlobsOverlap('frontend/**', 'backend/**'), false);
  assert.equal(crewGlobsOverlap('src/a.ts', 'src/b.ts'), false);
});

test('fileMatchesCrewGlob understands ** and exact files', () => {
  assert.equal(fileMatchesCrewGlob('docs/a.md', 'docs/**'), true);
  assert.equal(fileMatchesCrewGlob('src/foo.ts', 'src/foo.ts'), true);
  assert.equal(fileMatchesCrewGlob('src/bar.ts', 'src/foo.ts'), false);
  assert.equal(fileMatchesCrewGlob('backend/x.ts', 'frontend/**'), false);
});

test('findOverlappingCrewWorker reports the colliding glob', () => {
  const hit = findOverlappingCrewWorker(['docs/guide.md'], [
    { id: 'anna', paths: ['docs/**'] },
  ]);
  assert.equal(hit.worker.id, 'anna');
  assert.equal(hit.existing, 'docs/**');
  assert.equal(findOverlappingCrewWorker(['backend/**'], [{ id: 'anna', paths: ['docs/**'] }]), null);
  assert.equal(
    findOverlappingCrewWorker(['docs/guide.md'], [
      { id: 'anna', paths: ['docs/**'], integrated: true },
    ]),
    null,
  );
  assert.equal(
    findOverlappingCrewWorker(['other.md'], [
      { id: 'anna', paths: ['notes.md'] },
    ], { exceptId: 'anna' }),
    null,
  );
});

test('integrated workers do not hold scope; active workers block overlapping spawn', () => {
  const integrated = { id: 'anna', paths: ['docs/**'], integrated: true };
  const active = { id: 'mira', paths: ['backend/**'] };
  assert.equal(workerHoldsCrewScope(integrated), false);
  assert.equal(crewWorkerBlocksSpawn(integrated), true);
  assert.equal(workerHoldsCrewScope(active), true);
  assert.equal(crewWorkerBlocksSpawn(active), true);
  assert.equal(findOverlappingCrewWorker(['docs/**'], [integrated]), null);
  assert.equal(findOverlappingCrewWorker(['backend/**'], [active])?.worker?.id, 'mira');
  assert.ok(findOverlappingCrewWorker(['docs/**'], [{ id: 'busy', paths: ['docs/**'] }]));
});

test('orderCrewWorkersForLand follows dependsOn then spawn order', () => {
  const ordered = orderCrewWorkersForLand([
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

test('crew parent run is inspect-only; coding run is unchanged', async () => {
  const crew = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  const crewRun = shellTool(crew);
  assert.match(String(crewRun.def?.function?.description || ''), /inspect-only/i);
  assert.equal(typeof crewRun.handler, 'function');
  await assert.rejects(
    () => crewRun.handler({ command: 'git merge feature' }),
    /inspect-only/,
  );
  await assert.rejects(
    () => crewRun.handler({ command: 'cp notes.md /tmp/notes.md' }),
    /inspect-only/,
  );

  const coding = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true }),
  });
  const codingRun = shellTool(coding);
  assert.equal(String(codingRun.def?.function?.description || '').includes('inspect-only'), false);
  assert.equal(typeof codingRun.handler, 'function');
});

test('crew getBuiltinTools exposes paths and resume, and registers land_workers', () => {
  const { definitions, handlers } = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onForkTask: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true, message: 'landed' }),
  });
  const names = definitions.map((item) => item.function?.name || item.name);
  const sub = definitions.find((item) => item.function?.name === 'run_subagent');
  assert.equal(names.includes('land_workers'), true);
  assert.equal(names.includes('cancel_worker'), false);
  assert.equal(names.includes('fork_task'), false);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.paths), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.resume), true);
  assert.equal(Boolean(sub?.function?.parameters?.properties?.review), true);
  assert.deepEqual(sub?.function?.parameters?.required || [], []);
  assert.match(String(sub?.function?.description || ''), /resume/i);
  assert.equal(typeof handlers.land_workers, 'function');
});

test('cancel_worker is Crew-only and removes via the wired callback', async () => {
  const hidden = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  assert.equal(
    hidden.definitions.some((item) => item.function?.name === 'cancel_worker'),
    false,
  );
  const missing = getBuiltinTools({
    onRunSubAgent: async () => ({ ok: true }),
  });
  assert.equal(
    missing.definitions.some((item) => item.function?.name === 'cancel_worker'),
    false,
  );

  let seen = '';
  const { definitions, handlers } = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
    onCancelWorker: async ({ workerId }) => {
      seen = workerId;
      return { ok: true, cancelled: 'worker', workerId, message: `Cancelled Crew worker "${workerId}" and removed its worktree.` };
    },
  });
  assert.equal(definitions.some((item) => item.function?.name === 'cancel_worker'), true);
  const result = await handlers.cancel_worker({ worker_id: 'alice' });
  assert.equal(seen, 'alice');
  assert.equal(result.ok, true);
  assert.match(String(result.message || ''), /alice/);
  const missingId = await handlers.cancel_worker({});
  assert.equal(missingId.ok, false);
  assert.equal(missingId.code, 'MISSING_ID');
});


test('applyCrewParentToolPolicy strips mutation tools only when crew is on', () => {
  const coding = ['read', 'write', 'edit', 'run', 'run_subagent', 'fork_task'];
  assert.deepEqual(applyCrewParentToolPolicy(coding, { crewActive: false }), coding);
  const crew = applyCrewParentToolPolicy(coding, { crewActive: true });
  assert.equal(crew.includes('write'), false);
  assert.equal(crew.includes('edit'), false);
  assert.equal(crew.includes('fork_task'), false);
  assert.equal(crew.includes('run_subagent'), true);
  assert.equal(crew.includes('land_workers'), true);
  assert.equal(crew.includes('cancel_worker'), true);
  assert.equal(crew.includes('crew_status'), true);
  assert.equal(crew.includes('run'), true);
});

test('crew workers keep crew_status without parent inspect-only shell', async () => {
  const bundle = getBuiltinTools({
    crewActive: false,
    onRunSubAgent: async () => ({ ok: true }),
    config: { runtime: { crew_session: true } },
  });
  const names = bundle.definitions.map((item) => item.function?.name || item.name);
  assert.equal(names.includes('crew_status'), true);
  const run = shellTool(bundle);
  assert.equal(String(run.def?.function?.description || '').includes('inspect-only'), false);
});

test('tool_search for crew_status says the tool is already available', async () => {
  const { handlers } = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  const result = handlers.tool_search({ query: 'crew_status' });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.loaded, ['crew_status']);
  assert.match(String(result.message || ''), /already in your current tool list/i);
});

test('crew_status is exposed for Crew sessions and reads fresh state', async () => {
  const hidden = getBuiltinTools({
    crewActive: false,
    onRunSubAgent: async () => ({ ok: true }),
  });
  assert.equal(
    hidden.definitions.some((item) => item.function?.name === 'crew_status'),
    false,
  );

  const { definitions, handlers } = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
    config: {
      runtime: {
        crew_session: true,
        crew_project_root: process.cwd(),
        getCrewInFlightWorkers: () => ['worker-a'],
        getCrewPendingWakes: () => 2,
      },
    },
  });
  assert.equal(
    definitions.some((item) => item.function?.name === 'crew_status'),
    true,
  );
  const result = await handlers.crew_status();
  assert.equal(result.ok, false);
  assert.match(String(result.error || ''), /not active/i);
});

test('submit_crew_review is only exposed when a verdict callback is wired', async () => {
  const hidden = getBuiltinTools({
    crewActive: true,
    onRunSubAgent: async () => ({ ok: true }),
    onLandWorkers: async () => ({ ok: true }),
  });
  assert.equal(
    hidden.definitions.some((item) => item.function?.name === 'submit_crew_review'),
    false,
  );

  let seen = null;
  const { definitions, handlers } = getBuiltinTools({
    config: {
      runtime: {
        onCrewReviewVerdict: (verdict) => {
          seen = verdict;
        },
      },
    },
  });
  assert.equal(
    definitions.some((item) => item.function?.name === 'submit_crew_review'),
    true,
  );
  const ok = await handlers.submit_crew_review({ passed: true, findings: [] });
  assert.equal(ok.ok, true);
  assert.deepEqual(seen, { passed: true, findings: [] });
  const stripped = await handlers.submit_crew_review({ passed: true, findings: ['none'] });
  assert.equal(stripped.ok, true);
  assert.deepEqual(seen, { passed: true, findings: [] });
  const rejected = await handlers.submit_crew_review({ passed: true, findings: ['real issue'] });
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
      text: 'Still checking the diff.',
      reviewOf: 'alisa',
      reviewIncomplete: true,
    }),
    /incomplete — not a failed review/,
  );
  assert.match(
    compactSubAgentResultForParent({
      text: 'Still checking the diff.',
      reviewOf: 'alisa',
      reviewIncomplete: true,
    }),
    /resume "alisa" and rebase/,
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
