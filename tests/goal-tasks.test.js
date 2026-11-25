import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyGoalVerdict, beginGoalIteration, createGoalState, markGoalVerifying, normalizeGoalState, pauseGoal,
  recordGoalDelegation, recordGoalObservation, renderGoalContext, resumeGoal, verifyGoalTask,
} from '../src/core/goal-state.js';
import { finishGoalTask, recordGoalTaskModel, startGoalTask, updateGoalPlan } from '../src/core/goal-tasks.js';

const plan = [
  { id: 'first', title: '核对导出', criterion_ids: ['c1'] },
  { id: 'second', title: '核对导入', criterion_ids: ['c2'] },
  { id: 'report', title: '汇总结果', depends_on: ['first', 'second'] },
];
const build = () => beginGoalIteration(createGoalState({ objective: '核对导入和导出', criteria: ['导出有效', '导入有效'] }));
const check = (id, criterion = 'c1', revision = 'r1') => ({
  id, criterionIds: [criterion], kind: 'pass', source: 'run', checkKey: criterion, revision, summary: '相关用例全部通过',
});
const review = (id, criterion = 'c1', revision = 'r1') => ({
  decision: 'completed', reason: '已核对通过的用例。', executorModel: '执行模型', gatekeeperModel: '验收模型',
  currentRevision: revision, checks: [{ criterionId: criterion, evidenceIds: [id] }],
});

test('旧会话的任务计划为空，修改计划原子校验稳定标识、验收项和依赖', () => {
  const legacy = build();
  delete legacy.tasks;
  const empty = normalizeGoalState(legacy);
  assert.deepEqual(empty.tasks, []);
  assert.doesNotMatch(renderGoalContext(empty), /任务计划/);
  const goal = startGoalTask(updateGoalPlan(empty, plan), 'first', 'attempt-a', 'main');
  const snapshot = structuredClone(goal);
  assert.throws(() => updateGoalPlan(goal, plan.slice(1)), /执行记录/);
  assert.throws(() => updateGoalPlan(goal, [{ ...plan[0], title: '改写说明' }, ...plan.slice(1)]), /原标识/);
  assert.throws(() => updateGoalPlan(goal, [plan[0], plan[0]]), /唯一/);
  assert.throws(() => updateGoalPlan(goal, [plan[0], { ...plan[1], criterion_ids: ['fake'] }]), /验收条件/);
  assert.throws(() => updateGoalPlan(goal, [plan[0], { ...plan[1], depends_on: ['fake'] }]), /前置任务/);
  assert.throws(() => updateGoalPlan(goal, [plan[0], { ...plan[1], depends_on: ['report'] }, plan[2]]), /循环/);
  assert.deepEqual(goal, snapshot);
  assert.equal(updateGoalPlan(goal, [plan[0], { ...plan[1], title: '更新尚未开始的任务' }]).tasks.length, 2);
});

test('二项并行仅允许领取一次，已交付待验收，重开时只重派中断的尝试', () => {
  let goal = updateGoalPlan(build(), plan);
  goal = startGoalTask(goal, 'first', 'worker-A');
  goal = recordGoalTaskModel(goal, 'worker-A', '执行模型');
  assert.equal(startGoalTask(goal, 'first', 'worker-A'), goal);
  assert.throws(() => startGoalTask(goal, 'first', 'worker-B'), /正在执行/);
  assert.throws(() => startGoalTask(goal, 'second', 'worker-A'), /尝试标识/);
  goal = startGoalTask(goal, 'second', 'worker-B');
  goal = finishGoalTask(goal, 'first', 'worker-A', 'delivered');
  assert.equal(goal.tasks[0].status, 'delivered');
  assert.throws(() => startGoalTask(goal, 'report', 'main-report', 'main'), /first、second/);
  goal = recordGoalObservation(goal, check('exp'));
  goal = verifyGoalTask(goal, 'first', review('exp'));
  assert.equal(goal.tasks[0].status, 'verified');
  goal = recordGoalDelegation(goal, { id: 'worker-A', status: 'completed', handoffPath: 'first.md', goalTaskId: 'first' });
  for (let i = 0; i < 10; i++) goal = recordGoalDelegation(goal, { id: 'other-' + i, status: 'done' });
  const paused = pauseGoal(goal);
  goal = resumeGoal(normalizeGoalState(JSON.parse(JSON.stringify(paused))));
  assert.match(renderGoalContext(goal), /\[first\].*已验收.*证据 exp/);
  assert.match(renderGoalContext(goal), /\[first\].*交接 first\.md/);
  assert.match(renderGoalContext(goal), /\[second\].*已中断/);
  assert.throws(() => startGoalTask(goal, 'first', 'again'), /已经验收/);
  goal = startGoalTask(goal, 'second', 'worker-C', 'subagent', '执行模型');
  assert.equal(finishGoalTask(goal, 'second', 'worker-B', 'delivered'), goal);
  goal = finishGoalTask(goal, 'second', 'worker-C', 'delivered');
  goal = verifyGoalTask(recordGoalObservation(goal, check('imp', 'c2')), 'second', review('imp', 'c2'));
  assert.deepEqual(goal.tasks[1].attempts.map(a => a.status), ['interrupted', 'delivered']);
  goal = startGoalTask(goal, 'report', 'main-report', 'main');
  goal = finishGoalTask(goal, 'report', 'main-report', 'delivered');
  assert.equal(goal.status, 'active');
  assert.equal(goal.tasks[2].status, 'delivered');
});

test('任务的部分引用和执行者自验保留反馈，新反证或版本变化会撤回已验收状态', () => {
  let goal = updateGoalPlan(build(), plan);
  goal = finishGoalTask(startGoalTask(goal, 'first', 'w', 'subagent', '执行模型'), 'first', 'w', 'delivered');
  goal = recordGoalObservation(goal, check('ok'));
  goal = verifyGoalTask(goal, 'first', { ...review('ok'), decision: 'continue', reason: '缺少回归验证' });
  assert.equal(goal.tasks[0].status, 'delivered');
  assert.match(renderGoalContext(goal), /缺少回归验证/);
  goal = verifyGoalTask(goal, 'first', { ...review('ok'), gatekeeperModel: '执行模型' });
  assert.equal(goal.tasks[0].status, 'delivered');
  goal = verifyGoalTask(goal, 'first', review('ok'));
  const saved = normalizeGoalState(JSON.parse(JSON.stringify(goal)));
  assert.equal(saved.tasks[0].status, 'verified');
  assert.equal(saved.tasks[0].attempts[0].reviews.at(-1).checks[0].evidenceIds[0], 'ok');
  const failed = recordGoalObservation(saved, { ...check('fail'), kind: 'fail' });
  assert.equal(failed.tasks[0].status, 'delivered');
  assert.equal(verifyGoalTask(failed, 'first', review('ok')).tasks[0].status, 'delivered');
  const changed = recordGoalObservation(saved, { id: 'edit', kind: 'change', source: 'workspace', revision: 'r2' });
  assert.equal(changed.tasks[0].status, 'delivered');
  assert.equal(verifyGoalTask(changed, 'first', review('ok')).tasks[0].status, 'delivered');
});

test('主代理任务互斥，未绑定验收项的前置调研交付后可继续，独立总验收决定目标状态', () => {
  let goal = updateGoalPlan(build(), [
    { id: 'explore', title: '定位' }, { ...plan[0], title: '导出有效', depends_on: ['explore'] }, plan[1],
  ]);
  goal = startGoalTask(goal, 'explore', 'm1', 'main');
  assert.throws(() => startGoalTask(goal, 'second', 'm2', 'main'), /先交付/);
  goal = finishGoalTask(goal, 'explore', 'm1', 'delivered');
  goal = finishGoalTask(startGoalTask(goal, 'first', 'm2', 'main', '执行模型'), 'first', 'm2', 'delivered');
  goal = finishGoalTask(startGoalTask(goal, 'second', 'm3', 'main'), 'second', 'm3', 'delivered');
  goal = recordGoalObservation(recordGoalObservation(goal, check('exp')), check('imp', 'c2'));
  const total = { ...review('exp'), checks: [...review('exp').checks, ...review('imp', 'c2').checks] };
  goal = applyGoalVerdict(markGoalVerifying(goal, '已完成核对', '执行模型'), total);
  assert.equal(goal.status, 'completed');
  assert.equal(goal.tasks[0].status, 'delivered');
  assert.equal(goal.tasks[1].status, 'verified');
  assert.equal(goal.tasks[2].status, 'delivered');
});

test('纯正文交付可解锁后继，混合任务还须通过有效的工作区核对', () => {
  const goal = beginGoalIteration(createGoalState({ objective: '取证并编写摘要', criteria: [
    { id: 'c1', text: '摘要完整', evidence: 'reply' }, { id: 'c2', text: '文件内容正确', evidence: 'workspace' },
  ] }));
  for (const criterion_ids of [['c1'], ['c1', 'c2']]) {
    let planned = updateGoalPlan(goal, [
      { id: 'draft', title: '准备摘要', criterion_ids },
      { id: 'publish', title: '给出最终答复', depends_on: ['draft'] },
    ]);
    planned = finishGoalTask(startGoalTask(planned, 'draft', 'm', 'main', '执行模型'), 'draft', 'm', 'delivered');
    if (criterion_ids.includes('c2')) {
      assert.throws(() => startGoalTask(planned, 'publish', 'publish', 'main'), /前置/);
      planned = verifyGoalTask(recordGoalObservation(planned, check('file', 'c2')), 'draft',
        { ...review('file', 'c2'), workspaceOnly: true });
      assert.ok(planned.tasks[0].verification.workspaceOnly);
      const invalidated = recordGoalObservation(planned, { ...check('failed', 'c2'), kind: 'fail' });
      assert.throws(() => startGoalTask(invalidated, 'publish', 'publish', 'main'), /前置/);
    }
    const running = startGoalTask(planned, 'publish', 'publish', 'main');
    assert.deepEqual(running.tasks.map(task => task.status), ['delivered', 'running']);
  }
});

test('三层依赖跨越无需验收的交付时，祖先的新反证仍阻止领取和验收', () => {
  let goal = updateGoalPlan(build(), [
    plan[0], { id: 'middle', title: '交接方案', depends_on: ['first'] },
    { ...plan[1], depends_on: ['middle'] },
  ]);
  const deliver = (g, id) => finishGoalTask(startGoalTask(g, id, id, 'main', '执行模型'), id, id, 'delivered');
  goal = verifyGoalTask(recordGoalObservation(deliver(goal, 'first'), check('exp')), 'first', review('exp'));
  goal = deliver(goal, 'middle');
  const lost = recordGoalObservation(goal, { ...check('bad'), kind: 'fail' });
  assert.throws(() => startGoalTask(lost, 'second', 'w'), /前置/);
  goal = recordGoalObservation(deliver(goal, 'second'), check('imp', 'c2'));
  const blocked = recordGoalObservation(goal, { ...check('bad'), kind: 'fail' });
  assert.equal(verifyGoalTask(blocked, 'second', review('imp', 'c2')).tasks[2].status, 'delivered');
  goal = verifyGoalTask(goal, 'second', review('imp', 'c2'));
  assert.equal(goal.tasks[2].status, 'verified');
  assert.equal(startGoalTask(goal, 'middle', 'redo').tasks[2].status, 'delivered');
  assert.deepEqual(recordGoalObservation(goal, { ...check('bad'), kind: 'fail' }).tasks.map(task => task.status),
    ['delivered', 'delivered', 'delivered']);
});

test('验证以该尝试的实际模型为准，主代理名义模型、缺报和回退前的同模型均不能自验', () => {
  const ready = updateGoalPlan(build(), [{ ...plan[0], title: '导出有效' }]);
  const attempt = startGoalTask(ready, 'first', 'worker');
  const proof = { ...review('x'), executorModel: '主模型', gatekeeperModel: '子模型' };
  const deliver = g => recordGoalObservation(finishGoalTask(g, 'first', 'worker', 'delivered'), check('x'));
  const reported = recordGoalTaskModel(attempt, 'worker', '子模型');
  for (const g of [deliver(attempt), deliver(reported)]) {
    assert.equal(verifyGoalTask(g, 'first', proof).tasks[0].status, 'delivered');
    const total = applyGoalVerdict(markGoalVerifying(recordGoalObservation(g, check('y', 'c2')), '已完成', '主模型'),
      { ...proof, checks: [...proof.checks, ...review('y', 'c2').checks] });
    assert.equal(total.status, 'completed');
    assert.equal(total.tasks[0].status, 'delivered');
  }
  const fallback = deliver(recordGoalTaskModel(reported, 'worker', '主模型'));
  assert.equal(verifyGoalTask(fallback, 'first', proof).tasks[0].status, 'delivered');
  const checked = verifyGoalTask(fallback, 'first', { ...proof, gatekeeperModel: '第三模型' });
  const [task] = checked.tasks;
  assert.equal(task.status, 'verified');
  assert.equal(task.attempts[0].reviews.at(-1).executorModel, '主模型');
  assert.equal(task.attempts[0].reviews.at(-1).gatekeeperModel, '第三模型');
});
