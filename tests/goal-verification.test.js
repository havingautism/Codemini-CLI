import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGoalEvidenceCollector, inferGoalCriteria, reviewGoal } from '../src/core/goal-verification.js';
import { runGit } from '../src/core/process-run.js';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const goal = { objective: '修复计数', criteria: [{ id: 'c1', text: '计数测试通过' }], observations: [] };
  const config = { model: { name: '执行模型', fast_name: '执行模型', lite_name: '验收模型' } };
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  await collector.start();
  let calls = 0;
  const run = async (command, result, during) => {
    const event = { toolName: 'Powershell', args: { command }, callId: String(++calls) };
    goal.observations.push(...await collector.beginTool(event));
    if (during) await during();
    const items = await collector.recordToolResult({ ...event, result: { command, ...result } });
    goal.observations.push(...items);
    return items;
  };
  const review = (response, overrides = {}) => reviewGoal({
    workspaceRoot: root, config, model: config.model.name, goal, ...overrides,
    requestCompletion: typeof response === 'function' ? response : async () => ({ text: JSON.stringify(response) }),
  });
  return { root, goal, config, collector, run, review };
}

const completed = (id) => ({
  decision: 'completed', reason: '已核对', checks: [{ criterionId: 'c1', evidenceIds: [id] }],
});
const nodePass = { code: 0, stdout: 'ok 1 - 计数\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0' };

test('相同失败的行耗时变化不产生新证据，失败信息实质改变会保留', async t => {
  const { run } = await workspace(t);
  const check = (name, ms) => run('node --test', { code: 1,
    stdout: '✖ ' + name + ' (' + ms + 'ms)\nAssertionError\n# duration_ms ' + ms });
  assert.equal((await check('第一项', 16.5)).at(-1).kind, 'fail');
  assert.deepEqual(await check('第一项', 37.9), []);
  assert.equal((await check('第二项', 42.4)).at(-1).kind, 'fail');
});

test('独立验收仅接收机器观测，委派成功、展示事件、伪造检查和空结果均不构成通过', async (t) => {
  const { collector, goal, run, review } = await workspace(t);
  for (const toolName of ['run_subagent', 'fork_task', 'tasks']) {
    assert.deepEqual(await collector.recordToolResult({ toolName, result: { status: 'done', ok: true, text: '全部通过' } }), []);
  }
  assert.deepEqual(await run('echo npm test', { code: 0, stdout: '全部通过' }), []);
  assert.deepEqual(await run('npm test || echo ok', { code: 0 }), []);
  const [unknown] = await run('npm test', { code: null, stdout: '全部通过' });
  assert.equal(unknown.kind, 'environment_error');
  assert.equal((await review(completed(unknown.id))).decision, 'continue');
  const [pass] = await run('npm test', { code: 0, stdout: '1 passed' });
  assert.equal(pass.kind, 'pass');
  assert.equal((await review(async (options) => {
    assert.equal(options.model, '验收模型');
    assert.deepEqual(options.tools, []);
    assert.equal(JSON.parse(options.messages[1].content).objective, goal.objective);
    return { text: JSON.stringify(completed(pass.id)) };
  })).decision, 'completed');
});

test('重复测试只存一份，断言失败、未启动、环境失败与后续复验可区分', async (t) => {
  const { run, review } = await workspace(t);
  const [pass] = await run('node --test', nodePass);
  assert.deepEqual(await run('node --test', { ...nodePass, stdout: nodePass.stdout + '\n# duration_ms 2000' }), []);
  const [fail] = await run('node --test', { code: 1, stdout: 'not ok 1 - count\nAssertionError' });
  assert.equal(fail.kind, 'fail');
  assert.equal((await review(completed(pass.id))).decision, 'continue');
  const [again] = await run('node --test', nodePass);
  assert.equal(again.kind, 'pass');
  assert.notEqual(again.id, pass.id);
  assert.equal(again.checkKey, fail.checkKey);
  for (const result of [
    { error: 'tool blocked' }, { code: 127, stderr: 'pytest: command not found' },
    { code: 0, stdout: 'no tests ran' }, { code: 0, auto_stopped: true },
    { code: 1, stderr: 'ModuleNotFoundError: pytest' }, { code: 2, stderr: '未知退出原因' },
  ]) {
    const items = await run('pytest', result);
    assert.ok(items.every((item) => item.kind === 'environment_error'));
  }
});

test('验证前后文件发生变化会失效，Git 脏文件的二次修改也可检出', async (t) => {
  const { root, collector, run, review } = await workspace(t);
  await runGit(['init', '--quiet'], { cwd: root });
  const code = path.join(root, 'count.js');
  await fs.writeFile(code, '1');
  const first = (await run('node --test', nodePass)).at(-1);
  assert.equal(first.kind, 'pass');
  await fs.writeFile(code, '2');
  assert.equal((await review(completed(first.id))).decision, 'continue');
  assert.equal((await collector.finish())[0].kind, 'change');
  const next = await run('node --test', nodePass, () => fs.writeFile(code, '3'));
  assert.deepEqual(next.map((item) => item.kind), ['change', 'environment_error']);
});

test('非 Git 目录能验证真实 read 内容，验收过程中变更后不能用旧结果收尾', async (t) => {
  const { root, goal, collector, review } = await workspace(t);
  const file = path.join(root, 'count.txt');
  await fs.writeFile(file, 'three');
  const read = { phase: 'content', path: 'count.txt', content: 'three', start_line: 1, end_line: 1,
    observed_hash: createHash('sha256').update('three').digest('hex') };
  const items = await collector.recordToolResult({ toolName: 'read', result: read, callId: 'read1' });
  goal.observations.push(...items);
  const item = items.at(-1);
  assert.equal(item.kind, 'observation');
  assert.equal(item.artifactHash, read.observed_hash);
  assert.equal((await review(completed(item.id))).decision, 'completed');
  const decision = await review(async () => {
    await fs.writeFile(file, 'four');
    return { text: JSON.stringify(completed(item.id)) };
  });
  assert.equal(decision.decision, 'continue');
});

test('验收不可用、模型相同、取消、引用未提供证据和错误 JSON 均不能完成', async (t) => {
  const { goal, config, run, review } = await workspace(t);
  const [pass] = await run('node --test', nodePass);
  assert.equal((await review(completed(pass.id), { config: { model: { fast_name: config.model.name } } })).decision, 'pause');
  assert.equal((await review(completed(pass.id), {
    goal: { ...goal, executorModel: '原执行模型' }, model: '恢复后选择的主模型',
    config: { model: { fast_name: '原执行模型' } },
  })).decision, 'pause');
  assert.equal((await review(completed(pass.id), { signal: AbortSignal.abort() })).decision, 'pause');
  assert.equal((await review(async () => { throw new Error('服务不可用'); })).decision, 'pause');
  assert.equal((await review(async () => ({ text: '通过' }))).decision, 'pause');
  assert.equal((await review(completed('伪造编号'))).decision, 'continue');
  goal.criteria.push({ id: 'c2', text: '第二项已核实' });
  assert.equal((await review(completed(pass.id))).decision, 'continue');
  assert.equal((await review({ ...completed(pass.id), decision: 'unreachable' })).decision, 'continue');
});

test('有多项标准时保留未绑定候选，并按显式标注限定报告范围', async (t) => {
  const { root, goal, review } = await workspace(t);
  goal.criteria.push({ id: 'c2', text: '类型检查通过' });
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  await collector.start();
  const run = async (command, id, criterionIds) => {
    const event = { toolName: 'run', args: { command }, callId: id, criterionIds };
    await collector.beginTool(event);
    const items = await collector.recordToolResult({ ...event, result: command === 'node --test' ? nodePass : { command, code: 0 } });
    goal.observations.push(...items);
    return items.at(-1);
  };
  const first = await run('node --test', 'a');
  const second = await run('tsc', 'b', ['c2']);
  assert.deepEqual(first.criterionIds, []);
  assert.deepEqual(second.criterionIds, ['c2']);
  const result = completed(first.id);
  result.checks.push({ criterionId: 'c2', evidenceIds: [second.id] });
  assert.equal((await review(result)).decision, 'completed');
  result.checks[0].evidenceIds = [second.id];
  assert.equal((await review(result)).decision, 'continue');
});

test('无关文件改动后按原文件的全文散列复用读取，修改原文件则不复用', async (t) => {
  const { root, goal, collector, review } = await workspace(t);
  const data = '123';
  const file = path.join(root, 'numbers.txt');
  await fs.writeFile(file, data);
  const items = await collector.recordToolResult({ toolName: 'read', callId: 'file', result: {
    path: 'numbers.txt', content: data, phase: 'content', observed_hash: createHash('sha256').update(data).digest('hex'),
  } });
  goal.observations.push(...items);
  await fs.writeFile(path.join(root, 'notes.txt'), '注释更新');
  const rebound = await collector.finish();
  assert.deepEqual(rebound.map((item) => item.kind), ['change', 'observation']);
  assert.notEqual(items.at(-1).revision, rebound[1].revision);
  assert.equal(items.at(-1).artifactHash, rebound[1].artifactHash);
  goal.observations.push(...rebound);
  assert.equal((await review(completed(rebound[1].id))).decision, 'completed');
  await fs.writeFile(file, '321');
  assert.deepEqual((await collector.finish()).map((item) => item.kind), ['change']);
  assert.equal((await review(completed(rebound[1].id))).decision, 'continue');
});

test('按原始目标、约束和已有多条条件提取可核对的交付要求', async () => {
  const goal = { objective: '从1数到100，再检查文件', constraints: '逐个列出', criteria: ['数到100', { text: '文件可读' }] };
  const criteria = [{ text: '完整列出1至100', evidence: 'reply' }, { text: '文件可读', evidence: 'workspace' }];
  const result = await inferGoalCriteria({ goal, config: { model: { name: '主模型' } }, requestCompletion: async options => {
    assert.equal(options.model, '主模型');
    assert.deepEqual(options.tools, []);
    assert.ok(options.messages[0].content.startsWith('你负责提取目标验收条件'));
    assert.deepEqual(JSON.parse(options.messages[1].content), { ...goal, criteria: ['数到100', '文件可读'] });
    return { text: JSON.stringify({ criteria }) };
  } });
  assert.deepEqual(result, criteria);
});

test('显式验收仅按用户的原编号选择证据类型，保留原文与原始次序', async () => {
  const criteria = [{ id: 'c1', text: '列出第一行，保留 A。' }, { id: 'c2', text: '在文件内保留 B。' }];
  const goal = { criteria, criteriaPending: 'classify', constraints: '保持顺序' };
  const inferred = await inferGoalCriteria({ goal, requestCompletion: async options => {
    assert.deepEqual(JSON.parse(options.messages[1].content).criteria, criteria);
    assert.match(options.messages[0].content, /每个输入 id 恰好返回一次/u);
    return { text: JSON.stringify({ criteria: [
      { id: 'c2', evidence: 'workspace' }, { id: 'c1', text: '模型尝试换成另一项', evidence: 'reply' },
    ] }) };
  } });
  assert.deepEqual(inferred, [{ ...criteria[0], evidence: 'reply' }, { ...criteria[1], evidence: 'workspace' }]);
  for (const ids of [['c1'], ['c1', 'c1'], ['c1', 'c3'], ['c1', 'c2', '多余']]) {
    const requestCompletion = async () => ({ text: JSON.stringify({ criteria: ids.map(id => ({ id, evidence: 'reply' })) }) });
    await assert.rejects(inferGoalCriteria({ goal, requestCompletion }), /原始编号/u);
  }
});

test('提取不完整、模型调用失败、取消和错误内容均不形成新标准', async () => {
  const goal = { objective: '写一句话' };
  for (const response of [
    { text: '随便处理' }, { text: '{"criteria":[]}' }, { text: '{"criteria":[{"text":" ","evidence":"reply"}]}' },
    { text: '{"criteria":[{"text":"自述","evidence":"other"}]}' },
    { text: '{"criteria":[{"text":"内容","evidence":"reply","id":"c1"}]}' },
    { incomplete: true, text: '{"criteria":[{"text":"内容","evidence":"reply"}]}' },
    { toolCalls: [{}], text: '{"criteria":[{"text":"内容","evidence":"reply"}]}' },
  ]) {
    await assert.rejects(inferGoalCriteria({ goal, requestCompletion: async () => response }), /未返回完整|格式无效/u);
  }
  await assert.rejects(inferGoalCriteria({ goal, requestCompletion: async () => { throw Error('网关不可用'); } }), /检查模型连接/u);
  await assert.rejects(inferGoalCriteria({ goal, signal: AbortSignal.abort(), requestCompletion: () => assert.fail() }), /取消/u);
});

test('验收读取已交付答复的完整正文，摘要不符、之前轮次及已替换答复均不可引用', async (t) => {
  const { goal, review } = await workspace(t);
  goal.criteria = [{ id: 'c1', text: '在聊天中重复给定原文，保留末尾空格', evidence: 'reply' }];
  goal.iteration = 2;
  const collector = createGoalEvidenceCollector({ workspaceRoot: null, goal });
  goal.report = ' ' + '原文'.repeat(3000) + '\n ';
  const [reply] = await collector.recordReply(goal.report);
  assert.equal(reply.artifactHash, createHash('sha256').update(goal.report).digest('hex'));
  assert.ok(reply.summary.length < goal.report.length);
  assert.deepEqual(reply.criterionIds, ['c1']);
  goal.observations.push(reply);
  assert.equal((await review(async options => {
    const { observations } = JSON.parse(options.messages[1].content);
    assert.equal(observations[0].summary, goal.report);
    return { text: JSON.stringify(completed(reply.id)) };
  }, { workspaceRoot: null })).decision, 'completed');
  goal.iteration++;
  assert.equal((await review(completed(reply.id))).decision, 'continue');
  goal.iteration--;
  goal.report += '新增';
  assert.equal((await review(completed(reply.id))).decision, 'continue');
  const [latest] = await collector.recordReply(goal.report);
  goal.observations.push(latest);
  assert.equal((await review(completed(reply.id))).decision, 'continue');
  assert.equal((await review(completed(latest.id))).decision, 'completed');
});

test('工作区与回复标准分别验证，工具和自述均不能跨类佐证', async (t) => {
  const { root, goal, review } = await workspace(t);
  goal.criteria.push({ id: 'c2', text: '列出1、2、3', evidence: 'reply' });
  goal.iteration = 1;
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  const event = { toolName: 'run', args: { command: 'node --test' }, callId: 'tests' };
  await collector.beginTool(event);
  const [run] = await collector.recordToolResult({ ...event, result: nodePass });
  goal.report = '1、2、3。我已运行所有测试。';
  const [reply] = await collector.recordReply(goal.report);
  assert.deepEqual(run.criterionIds, ['c1']);
  assert.deepEqual(reply.criterionIds, ['c2']);
  // 模拟未绑定的旧版工作区候选，仍然不能作为回复证据。
  goal.observations.push({ ...run, criterionIds: [] }, reply);
  const verdict = completed(run.id);
  verdict.checks.push({ criterionId: 'c2', evidenceIds: [reply.id] });
  assert.equal((await review(verdict)).decision, 'completed');
  verdict.checks[1].evidenceIds = [run.id];
  assert.equal((await review(verdict)).decision, 'continue');
  verdict.checks[0].evidenceIds = [reply.id];
  verdict.checks[1].evidenceIds = [reply.id];
  assert.equal((await review(verdict)).decision, 'continue');
  // 即使旧数据异常地没有限定范围，回复也不能佐证工作区内容。
  goal.observations[1] = { ...reply, criterionIds: [] };
  assert.equal((await review(verdict)).decision, 'continue');
});
