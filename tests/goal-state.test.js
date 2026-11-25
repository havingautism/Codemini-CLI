import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createGoalState, normalizeGoalState, beginGoalIteration, markGoalVerifying, pauseGoal, resumeGoal,
  recordGoalObservation, recordGoalDelegation, applyGoalVerdict, renderGoalContext,
} from '../src/core/goal-state.js';
import { createSession, createContinuationSession, loadSession, readSessionGoal, saveSession, saveSessionGoal } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

function newIteration(maxIterations = 2) {
  return beginGoalIteration(createGoalState({ objective: '修正导出', criteria: ['测试通过'], maxIterations }));
}

const success = {
  id: 'test-ok', kind: 'pass', criterionIds: ['c1'], summary: '退出码为 0',
  source: 'run', exitCode: 0, revision: 'rev-1', checkKey: '导出测试',
};
const verdict = {
  decision: 'completed', executorModel: '主模型', gatekeeperModel: '验收模型', currentRevision: 'rev-1',
  checks: [{ criterionId: 'c1', evidenceIds: [success.id] }], reason: '导出测试已通过。',
};
function review(goal, input = verdict) {
  return applyGoalVerdict(markGoalVerifying(goal, '已执行测试'), input);
}

test('目标要求可验证标准及有限预算', () => {
  assert.equal(createGoalState({ objective: '导出', criteria: ['能下载'] }).maxIterations, 5);
  assert.throws(() => createGoalState({ objective: '导出', criteria: [] }), /验收标准/);
  assert.throws(() => newIteration(101), /100/);
  assert.equal(normalizeGoalState(null), null);
  assert.equal(normalizeGoalState({ ...newIteration(), iteration: -1 }), null);
});

test('同一证据去重，逐项引用且模型独立才允许完成', () => {
  let goal = newIteration();
  assert.equal(review(goal).phase, 'ready');
  goal = recordGoalObservation(goal, success);
  assert.equal(recordGoalObservation(goal, success).observations.length, 1);
  assert.equal(review(goal, { ...verdict, gatekeeperModel: '主模型' }).status, 'paused');
  const two = beginGoalIteration(createGoalState({ objective: '导出', criteria: ['测试通过', '能下载'] }));
  assert.equal(review(recordGoalObservation(two, success)).status, 'active');
  const result = review(goal);
  assert.equal(result.status, 'completed');
  assert.equal(result.verdicts[0].observationCount, 1);
  assert.deepEqual(result.verdicts[0].checks, verdict.checks);
  assert.deepEqual(normalizeGoalState(JSON.parse(JSON.stringify(result))), result);
});

test('变更淘汰旧证据，版本未变可在后续轮次引用', () => {
  const first = recordGoalObservation(newIteration(), success);
  const second = beginGoalIteration(review(first, { ...verdict, decision: 'continue' }));
  assert.equal(review(second).status, 'completed');
  assert.equal(review(second, { ...verdict, currentRevision: 'rev-2' }).status, 'exhausted');
  const changed = recordGoalObservation(second, { id: '改写', kind: 'change', revision: 'rev-2', criterionIds: ['c1'] });
  assert.equal(review(changed).status, 'exhausted');
  assert.match(renderGoalContext(changed), /重新验证/);
});

test('无绑定证据仅作用于被引用的验收项，已知失败不能被无关测试掩盖', () => {
  let goal = beginGoalIteration(createGoalState({ objective: '导出和导入可用', criteria: ['能导出', '能导入'] }));
  goal = recordGoalObservation(goal, { ...success, criterionIds: [] });
  goal = recordGoalObservation(goal, { ...success, id: 'import-ok', checkKey: '导入测试', criterionIds: [] });
  const checks = [{ criterionId: 'c1', evidenceIds: ['test-ok'] }, { criterionId: 'c2', evidenceIds: ['import-ok'] }];
  assert.equal(review(goal, { ...verdict, checks }).status, 'completed');
  goal = recordGoalObservation(goal, { ...success, id: 'export-fail', kind: 'fail', criterionIds: [] });
  const more = beginGoalIteration(review(goal, { ...verdict, decision: 'continue',
    checks: [{ criterionId: 'c1', evidenceIds: ['export-fail'] }] }));
  const snapshot = renderGoalContext(more);
  assert.match(snapshot, /能导出（检查失败）/);
  assert.match(snapshot, /能导入（证据不足）/);
  assert.equal(review(more, { ...verdict, checks }).status, 'active');
  assert.equal(recordGoalObservation(more, { ...success, id: '未知绑定', criterionIds: ['无此标准'] }), more);
});

test('环境错误、断言失败和成功的无关检查分开处理', () => {
  let goal = recordGoalObservation(newIteration(), success);
  const bad = { ...success, id: 'test-fail', kind: 'fail', exitCode: 1 };
  goal = recordGoalObservation(goal, bad);
  goal = recordGoalObservation(goal, { ...success, id: '另一个测试', checkKey: '无关检查' });
  assert.equal(review(goal, { ...verdict, checks: [{ criterionId: 'c1', evidenceIds: ['另一个测试'] }] }).status, 'active');
  assert.match(renderGoalContext(goal), /证据冲突/);
  goal = recordGoalObservation(goal, { ...success, id: '网络错误', kind: 'environment_error' });
  assert.match(renderGoalContext(goal), /修复验证环境/);
  const skip = { ...verdict, decision: 'unreachable', checks: [{ criterionId: 'c1', evidenceIds: ['网络错误'] }] };
  assert.equal(review(goal, skip).status, 'active');
  goal = recordGoalObservation(goal, { ...success, id: 'test-fixed' });
  assert.equal(review(goal, { ...verdict, checks: [{ criterionId: 'c1', evidenceIds: ['test-fixed'] }] }).status, 'completed');
});

test('已暂停的验收保留原轮次，耗尽后仅在明确加轮时继续', () => {
  const verifying = markGoalVerifying(newIteration(1), '本轮产物已导出');
  const paused = pauseGoal(verifying, '用户暂停');
  assert.equal(paused.resumePhase, 'verifying');
  const resumed = resumeGoal(paused);
  assert.equal(resumed.phase, 'verifying');
  assert.equal(resumed.report, '本轮产物已导出');
  assert.equal(beginGoalIteration(resumed).iteration, 1);
  const exhausted = applyGoalVerdict(resumed, { ...verdict, decision: 'continue' });
  assert.equal(exhausted.status, 'exhausted');
  assert.throws(() => resumeGoal(exhausted), /增加/);
  assert.throws(() => resumeGoal(exhausted, { extraIterations: 100 }), /100/);
  const next = beginGoalIteration(resumeGoal(exhausted, { extraIterations: 1 }));
  assert.equal(next.iteration, 2);
  assert.equal(next.maxIterations, 2);
});

test('子任务交接可查询，子任务完成不替代目标验收', () => {
  let goal = recordGoalDelegation(newIteration(), { id: 'call-1', name: '实现代理', status: 'running' });
  goal = recordGoalDelegation(goal, { id: 'call-1', status: 'done', summary: '已生成文件', handoffPath: '记录.md' });
  assert.equal(goal.delegations.length, 1);
  assert.match(renderGoalContext(goal), /实现代理 已生成文件 记录.md/);
  assert.equal(review(goal).status, 'active');
  const paused = pauseGoal(recordGoalDelegation(goal, { id: 'call-2', status: 'running' }));
  assert.equal(paused.delegations[1].status, 'interrupted');
  assert.equal(recordGoalDelegation(paused, { id: 'call-2', status: 'done' }).delegations[1].status, 'interrupted');
  assert.match(renderGoalContext(paused), /状态：已暂停/);
  assert.match(renderGoalContext(paused), /已中断，待核对/);
});

test('目标随会话持久化，中止后的新会话仅显式继承，历史分叉隔离', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-state-'));
  const old = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    const session = await createSession(dir);
    assert.equal((await loadSession(session.id)).goalState, undefined);
    saveSessionGoal(session, markGoalVerifying(recordGoalObservation(newIteration(), success), '执行报告'));
    await saveSession(session);
    const loaded = await loadSession(session.id);
    assert.deepEqual(loaded.goalState, session.goalState);
    const continuation = await createContinuationSession(loaded, { carryGoal: true });
    const paused = (await loadSession(continuation.id)).goalState;
    assert.equal(paused.id, loaded.goalState.id);
    assert.equal(paused.status, 'paused');
    assert.equal(resumeGoal(paused).phase, 'verifying');
    assert.equal(paused.observations[0].id, success.id);
    const fork = await createContinuationSession(loaded);
    assert.equal(fork.goalState, undefined);

    // 两个独立进程从相同版本写入；旧会话的普通保存同时不得回滚目标。
    const compete = `
      import { loadSession, saveSessionGoal } from './src/core/session-store.js';
      const [id, expected] = process.argv.slice(1);
      const session = await loadSession(id);
      try {
        const next = { ...session.goalState, reason: '进程 ' + process.pid, ownerPid: process.pid, ownerToken: '归属标记' };
        saveSessionGoal(session, next, { expected: JSON.parse(expected) });
        process.stdout.write('成功');
      } catch (error) { process.stdout.write(error.code || error.message); }
    `;
    const child = () => promisify(execFile)(process.execPath, ['--input-type=module', '-e', compete, session.id,
      JSON.stringify({ id: session.goalState.id, version: session.goalState.version })]);
    const writes = await Promise.all([child(), child()]);
    assert.deepEqual(writes.map(result => result.stdout).sort(), ['GOAL_STATE_CONFLICT', '成功']);
    const latest = readSessionGoal(session.id);
    assert.equal(latest.version, session.goalState.version + 1);
    assert.equal(latest.ownerToken, '归属标记');
    await saveSession(session);
    assert.deepEqual(readSessionGoal(session.id), latest);
    const stopped = saveSessionGoal(session, pauseGoal(latest), { expected: latest });
    assert.equal(stopped.ownerPid, undefined);
    assert.equal(readSessionGoal(session.id).ownerToken, undefined);
  } finally {
    closeSqliteDatabasesForTests();
    if (old === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = old;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});
