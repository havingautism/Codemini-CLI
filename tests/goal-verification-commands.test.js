import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createGoalEvidenceCollector, reviewGoal } from '../src/core/goal-verification.js';

async function fixture(t, criteria = [{ id: 'c1', text: '目标测试通过' }]) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-command-'));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const goal = { objective: '核对测试结果', criteria, observations: [] };
  return { workspaceRoot, goal };
}

async function runTests(context, callId, options = [], criterionIds) {
  const collector = createGoalEvidenceCollector(context);
  const args = ['--test', ...options];
  const call = { toolName: 'run', args: { command: ['node', ...args].join(' ') }, criterionIds, callId };
  context.goal.observations.push(...await collector.beginTool(call));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = spawnSync(process.execPath, args, { cwd: context.workspaceRoot, env, encoding: 'utf8', windowsHide: true });
  assert.ifError(child.error);
  const result = { stdout: child.stdout, stderr: child.stderr, code: child.status };
  const records = await collector.recordToolResult({ ...call, result });
  context.goal.observations.push(...records);
  return { records, result, call, collector };
}

function review(context, checks) {
  return reviewGoal({ ...context, config: { model: { name: 'executor', fast_name: 'reviewer' } },
    requestCompletion: async () => ({ text: JSON.stringify({ decision: 'completed', reason: '已核对', checks }) }),
  });
}

test('真实 Node 测试中零个用例、全部跳过和全部待办均不能支持完成', async (t) => {
  const context = await fixture(t);
  const empty = await runTests(context, 'empty');
  assert.equal(empty.result.code, 0);
  assert.equal(empty.records.at(-1).kind, 'environment_error');
  for (const mode of ['skip', 'todo']) {
    await fs.writeFile(path.join(context.workspaceRoot, 'case.test.cjs'), "require('node:test')." + mode + "('待验证功能', () => {});");
    const run = await runTests(context, mode, ['--test-reporter=tap', 'case.test.cjs']);
    assert.equal(run.result.code, 0);
    const observation = run.records.at(-1);
    assert.equal(observation.kind, 'environment_error', mode);
    assert.equal((await review(context, [{ criterionId: 'c1', evidenceIds: [observation.id] }])).decision, 'continue');
  }
});

test('名称过滤器无匹配时不把测试文件载入成功算作测试通过', async (t) => {
  const context = await fixture(t);
  await fs.writeFile(path.join(context.workspaceRoot, 'case.test.cjs'), "require('node:test')('目标用例', () => {});");
  for (const reporter of ['tap', 'spec']) {
    const run = await runTests(context, reporter, ['--test-reporter=' + reporter, '--test-name-pattern=未选中', 'case.test.cjs']);
    assert.equal(run.result.code, 0);
    assert.equal(run.records.at(-1).kind, 'environment_error');
    const match = await runTests(context, reporter + '-matched', ['--test-reporter=' + reporter, '--test-name-pattern=目标用例', 'case.test.cjs']);
    assert.equal(match.records.at(-1).kind, 'pass');
  }
});

test('dot 报告未提供计数时，全部跳过即使退出零也不能完成', async (t) => {
  const context = await fixture(t);
  await fs.writeFile(path.join(context.workspaceRoot, 'case.test.cjs'), "require('node:test').skip('未运行', () => {});");
  const run = await runTests(context, 'dot', ['--test-reporter=dot', 'case.test.cjs']);
  assert.equal(run.result.code, 0);
  assert.equal(run.records.at(-1).kind, 'environment_error');
});

test('处理 ENOENT 和 AssertionError 的测试真实通过时能验收，明确绑定的证据不能跨项引用', async (t) => {
  const context = await fixture(t, [{ id: 'c1', text: '正确处理 ENOENT' }, { id: 'c2', text: '导出 CSV' }]);
  await fs.writeFile(path.join(context.workspaceRoot, 'case.test.cjs'),
    "require('node:test')('处理 ENOENT 和 AssertionError', () => require('node:assert/strict').equal(1, 1));");
  const run = await runTests(context, 'valid', ['--test-reporter=spec', 'case.test.cjs'], ['c1']);
  assert.equal(run.result.code, 0);
  const observation = run.records.at(-1);
  assert.equal(observation.kind, 'pass');
  const checks = context.goal.criteria.map(({ id }) => ({ criterionId: id, evidenceIds: [observation.id] }));
  assert.equal((await review(context, checks)).decision, 'continue');
});

test('指定了不存在的验收项时，真实的成功结果不能被改挂到目标的其他项', async (t) => {
  const context = await fixture(t);
  await fs.writeFile(path.join(context.workspaceRoot, 'other.test.cjs'), "require('node:test')('无关功能', () => {});");
  const run = await runTests(context, 'unrelated', ['other.test.cjs'], ['other-id']);
  assert.equal(run.result.code, 0);
  assert.deepEqual(run.records, []);
});

test('文件变更使旧的真实测试结果失效，重放不产生证据，重新运行后才恢复', async (t) => {
  const context = await fixture(t);
  const file = path.join(context.workspaceRoot, 'case.test.cjs');
  const source = "require('node:test')('目标用例', () => require('node:assert/strict').equal(1, 1));";
  await fs.writeFile(file, source);
  const first = await runTests(context, 'original', ['case.test.cjs']);
  const original = first.records.at(-1);
  assert.equal(original.kind, 'pass');
  await fs.writeFile(file, source.replace('equal(1, 1)', 'equal(1, 2)'));
  const failed = await runTests(context, 'broken', ['case.test.cjs']);
  assert.equal(failed.result.code, 1);
  assert.equal(failed.records.at(-1).kind, 'fail');
  const replay = createGoalEvidenceCollector(context);
  assert.deepEqual(await replay.recordToolResult({ ...first.call, result: first.result }), []);
  const cite = (item) => [{ criterionId: 'c1', evidenceIds: [item.id] }];
  assert.equal((await review(context, cite(original))).decision, 'continue');
  await fs.writeFile(file, source);
  context.goal.observations.push(...await replay.finish());
  assert.equal((await review(context, cite(original))).decision, 'continue');
  const fresh = (await runTests(context, 'fresh', ['case.test.cjs'])).records.at(-1);
  assert.equal(fresh.kind, 'pass');
  assert.notEqual(fresh.id, original.id);
  assert.equal((await review(context, cite(fresh))).decision, 'completed');
});

test('恢复后可用历史调用编号重新发起测试，同一次结果回调只登记一次', async (t) => {
  const context = await fixture(t);
  const file = path.join(context.workspaceRoot, 'case.test.cjs');
  const source = "require('node:test')('目标用例', () => require('node:assert/strict').equal(1, 1));";
  await fs.writeFile(file, source);
  const original = await runTests(context, 'call_1', ['case.test.cjs']);
  assert.equal(original.records.at(-1).kind, 'pass');
  await fs.writeFile(file, source.replace('equal(1, 1)', 'equal(1, 2)'));
  const current = await runTests(context, 'call_1', ['case.test.cjs']);
  assert.equal(current.result.code, 1);
  assert.equal(current.records.at(-1)?.kind, 'fail');
  assert.deepEqual(await current.collector.recordToolResult({ ...current.call, result: current.result }), []);
});
