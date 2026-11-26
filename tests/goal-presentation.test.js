import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { projectGoalPresentation } from '../src/core/goal-presentation.js';
import { beginGoalIteration, createGoalState, normalizeGoalState, recordGoalObservation } from '../src/core/goal-state.js';
import { createGoalTaskRunner } from '../src/core/goal-task-runner.js';
import { startGoalTask, updateGoalPlan } from '../src/core/goal-tasks.js';
import { createGoalEvidenceCollector } from '../src/core/goal-verification.js';

test('同一文件由不同尝试读取：按工具开始时的归属持久化，重新核验文件指纹不增加执行次数', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-attempt-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, '版本.txt'), '就绪');
  const criteria = [{ id: 'c1', text: '文件可读', evidence: 'workspace' }];
  let goal = beginGoalIteration(createGoalState({ objective: '分别复读文件', criteria }));
  goal = updateGoalPlan(goal, ['甲', '乙'].map(id => ({ id, title: id, criterion_ids: ['c1'] })));
  goal = startGoalTask(goal, '甲', '主代理尝试', 'main', '主模型');
  goal = startGoalTask(goal, '乙', '子代理尝试', 'subagent');
  const runner = createGoalTaskRunner({ current: () => goal });
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  await collector.start();
  const result = { phase: 'content', path: '版本.txt', content: '就绪',
    observed_hash: createHash('sha256').update('就绪').digest('hex') };
  async function read(event) {
    await collector.beginTool(runner.evidenceEvent(event));
    // 模拟结果到达时，主代理已经换领另一项工作。
    const observations = await collector.recordToolResult({ ...event, result, attemptId: '新尝试', criterionIds: [] });
    goal = observations.reduce(recordGoalObservation, goal);
    return observations;
  }
  const main = { toolName: 'read', callId: '读甲', args: { criterion_ids: ['c1'] } };
  const child = { toolName: 'read', callId: '子代理尝试/读乙', parentDelegationId: '子代理尝试', args: {} };
  const [a] = await read(main);
  const [b] = await read(child);
  assert.equal(a.attemptId, '主代理尝试');
  assert.equal(b.attemptId, '子代理尝试');
  assert.deepEqual(a.criterionIds, ['c1']);
  assert.notEqual(a.id, b.id);
  assert.deepEqual(await read({ ...child, callId: '子代理尝试/同一份结果' }), []);
  await fs.writeFile(path.join(root, '另一个文件'), '新版本');
  const changes = await collector.finish();
  assert.ok(changes.some(o => o.revalidatedFrom === b.id));
  goal = changes.reduce(recordGoalObservation, goal);
  const projection = projectGoalPresentation(normalizeGoalState(JSON.parse(JSON.stringify(goal))));
  assert.deepEqual(projection.tasks.map(task => task.attempts[0].evidence.map(e => e.id)), [[a.id], [b.id]]);
});

test('旧会话只认明确的子代理编号或验收引用，保留中断和撤销后的历史', () => {
  const review = { decision: 'completed', gatekeeperModel: '验收者', reason: '曾经通过',
    checks: [{ criterionId: 'c1', evidenceIds: ['旧读取', '另一次的证据'] }] };
  const old = { id: '目标', objective: '核对两个文件', ownerToken: '不公开的运行凭据', report: '完整回复',
    tasks: [
      { id: '甲', dependsOn: [], status: 'delivered', reviewReason: '文件已改写',
        attempts: [{ id: 'child', owner: 'subagent', status: 'delivered', reviews: [review] }] },
      { id: '乙', dependsOn: ['甲'], attempts: [{ id: 'main', owner: 'main', status: 'interrupted' }] },
    ],
    delegations: [{ id: 'child', handoffPath: 'handoffs/甲.md', summary: '甲已读' }],
    observations: [
      { id: '旧读取', toolCallId: 'child/tool', summary: '子代理读文件', criterionIds: ['c1'] },
      { id: '另一次的证据', toolCallId: 'main/read', summary: '只知其被引用', criterionIds: ['c1'] },
      { id: '未知', iteration: 1, criterionIds: ['c1'], summary: '不能按轮数或验收项猜测归属' },
    ] };
  const projection = projectGoalPresentation(old);
  const [alpha, beta] = projection.tasks;
  assert.equal(projection.ownerToken, undefined);
  assert.equal(projection.report, undefined);
  assert.equal(alpha.hasCurrentProof, false);
  assert.equal(alpha.attempts[0].reviews[0].current, false);
  assert.deepEqual(alpha.attempts[0].evidence.map(e => e.id), ['旧读取']);
  assert.deepEqual(alpha.attempts[0].reviews[0].checks[0].evidence.map(e => e.id), ['旧读取', '另一次的证据']);
  assert.deepEqual(alpha.attempts[0].handoff, { path: 'handoffs/甲.md', summary: '甲已读' });
  assert.equal(beta.attempts[0].status, 'interrupted');
  assert.deepEqual(beta.attempts[0].evidence, []);
  assert.equal(projectGoalPresentation(null), null);
  assert.deepEqual(projectGoalPresentation({ id: '无计划' }).tasks, []);
});

test('旧版文件版本续用不会重复计为子代理读取，相同编号的真实重读仍可见', () => {
  const source = { id: 'ev-first', source: 'read', kind: 'observation', toolCallId: 'worker-one/read',
    checkKey: 'read-key', artifactPath: '版本.txt', criterionIds: ['c1'], revision: 'v1' };
  const epoch = 'change-test';
  const rebound = 'ev-' + createHash('sha256').update(JSON.stringify([epoch, source.id])).digest('hex').slice(0, 32);
  const checks = [{ criterionId: 'c1', evidenceIds: [rebound] }];
  const tasks = [{ id: '任务', attempts: [{ id: 'worker-one', owner: 'subagent', reviews: [{ checks }] }] }];
  const view = projectGoalPresentation({ id: '旧目标', tasks, observations: [
    source, { id: epoch, kind: 'change' }, { ...source, id: rebound, revision: 'v2' },
    { ...source, id: 'ev-second-read', revision: 'v3' },
  ] });
  const attempt = view.tasks[0].attempts[0];
  assert.deepEqual(attempt.evidence.map(item => item.id), [source.id, 'ev-second-read']);
  assert.equal(attempt.reviews[0].checks[0].evidence[0].revalidatedFrom, source.id);
});
