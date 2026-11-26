import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createGoalEvidenceCollector, inferGoalCriteria, reviewGoal } from '../src/core/goal-verification.js';
import { runGit } from '../src/core/process-run.js';
import { applyGoalVerdict } from '../src/core/goal-state.js';
import { estimateMessagesTokens } from '../src/core/context-compact.js';
import { createChatCompletionStream } from '../src/core/provider/openai-compatible.js';

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

test('真实网关响应流停在半途时可重试验收，主动暂停及普通网关错误不显示重试', async t => {
  const { config, run, review } = await workspace(t);
  await run('node --test', nodePass);
  let streamed = false;
  const gateway = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': 已收到请求\n\n');
    streamed = true;
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { gateway.close(resolve); gateway.closeAllConnections(); }));
  const result = await review(createChatCompletionStream, { config: { ...config,
    gateway: { base_url: 'http://127.0.0.1:' + gateway.address().port, timeout_ms: 700, max_retries: 0 } } });
  assert.ok(streamed);
  assert.equal(result.decision, 'pause');
  assert.equal(result.failureKind, 'timeout');
  const auth = await review(() => { throw new Error('Gateway error 401: 权限不足'); });
  assert.equal(auth.failureKind, undefined);
  const cancel = await review(() => { throw new Error('请求已取消'); }, { signal: AbortSignal.abort() });
  assert.equal(cancel.failureKind, undefined);
});

function approvePacket(packet) {
  return { text: JSON.stringify({ decision: 'completed', reason: '逐项核对',
    checks: packet.criteria.map(c => ({ criterionId: c.id, evidenceIds: [
      packet.observations.find(item => item.criterionIds.includes(c.id) && item.kind === 'pass')?.id,
    ] })) }) };
}

test('短答可在 4k 上下文验收，缩小输出预算后仍能核对；放不下的原文不会被截断', async t => {
  const { goal, config, review } = await workspace(t);
  goal.objective = '用中文问好';
  goal.criteria = [{ id: 'c1', text: '用中文问好', evidence: 'reply' }];
  goal.iteration = 1;
  const collector = createGoalEvidenceCollector({ workspaceRoot: null, goal });
  for (const [context, text, expected] of [
    [4096, '你好', 'completed'], [1800, '你好', 'completed'],
    [64, '你好', 'pause'], [4096, '这是很长的实际正文。'.repeat(2000), 'pause'],
  ]) {
    goal.report = text;
    goal.observations = await collector.recordReply(text);
    let calls = 0;
    const result = await review(async ({ messages, maxTokens }) => {
      calls++;
      assert.equal(JSON.parse(messages[1].content).observations[0].summary, text);
      assert.ok(estimateMessagesTokens(messages) + maxTokens <= context);
      if (context === 1800) assert.ok(maxTokens < 1500);
      return { text: JSON.stringify(completed(goal.observations[0].id)) };
    }, { config: { model: { ...config.model, max_context_tokens: context } } });
    assert.equal(result.decision, expected, result.reason);
    assert.equal(calls, expected === 'pause' ? 0 : 1);
    if (expected === 'pause') assert.match(result.reason, /超出模型上下文/);
  }
});

test('九名子代理的交接和对应原始证据都可供同一次验收核对', async t => {
  const { goal, run, review } = await workspace(t);
  goal.objective = '委派九名子代理分别完成并核对交付清单';
  const [sample] = await run('node --test', nodePass);
  goal.delegations = Array.from({ length: 9 }, (_, index) => ({ id: 'worker-' + index, status: 'completed',
    handoffPath: 'handoff/' + index, summary: '交付清单第 ' + index + ' 项已核对', iteration: 1 }));
  goal.observations = goal.delegations.map(({ id }) => ({ ...sample, id: '证据-' + id, toolCallId: id + '/run', checkKey: id }));
  const result = await review(async ({ messages }) => {
    const packet = JSON.parse(messages[1].content);
    assert.deepEqual(packet.delegations.map(task => task.id), goal.delegations.map(task => task.id));
    for (const task of packet.delegations) assert.deepEqual(task.observationIds, ['证据-' + task.id]);
    return { text: JSON.stringify({ decision: 'completed', reason: '已核对九份交接及对应观测',
      checks: [{ criterionId: 'c1', evidenceIds: packet.delegations.flatMap(task => task.observationIds) }] }) };
  });
  assert.equal(result.decision, 'completed', result.reason);
  assert.equal(result.checks[0].evidenceIds.length, 9);
});

for (const count of [60, 61, 120]) {
  test('按项分批保留 ' + count + ' 项的独有证据和原始目标', async t => {
    const { goal, run, review } = await workspace(t);
    const [sample] = await run('node --test', nodePass);
    goal.criteria = Array.from({ length: count }, (_, index) => ({ id: 'c' + index, text: '验收第 ' + index + ' 项' }));
    goal.observations = goal.criteria.map(({ id }) => ({ ...sample, criterionIds: [id], id: '证据' + id, checkKey: id }));
    const batches = [];
    const result = await review(async options => {
      const packet = JSON.parse(options.messages[1].content);
      assert.deepEqual(packet.allCriteria, goal.criteria);
      assert.equal(packet.objective, goal.objective);
      assert.ok(packet.observations.every(item => packet.criteria.some(c => item.criterionIds.includes(c.id))));
      batches.push(packet.criteria.length);
      return approvePacket(packet);
    });
    assert.ok(batches.length > 1);
    assert.equal(result.decision, 'completed', result.reason);
    assert.equal(result.checks.length, count);
    assert.deepEqual(result.checks.map(check => check.criterionId), goal.criteria.map(c => c.id));
  });
}

test('跨批的最后一项拒绝、伪造引用或工作区变化均阻止整体验收', async t => {
  const { goal, run, review, root } = await workspace(t);
  const [sample] = await run('node --test', nodePass);
  goal.criteria = Array.from({ length: 24 }, (_, i) => ({ id: 'c' + i, text: '核对此项目' }));
  goal.observations = goal.criteria.map(({ id }) => ({ ...sample, criterionIds: [id], id: 'ev-' + id, checkKey: id }));
  for (const mode of ['拒绝', '跨批引用', '版本变化']) {
    let batches = 0;
    const result = await review(async options => {
      const packet = JSON.parse(options.messages[1].content);
      const result = approvePacket(packet);
      if (++batches === 1) return result;
      if (mode === '版本变化') await fs.writeFile(path.join(root, 'changed'), '新的工作区版本');
      const verdict = JSON.parse(result.text);
      if (mode === '拒绝') verdict.decision = 'continue';
      if (mode === '跨批引用') verdict.checks[0].evidenceIds = ['ev-c0'];
      return { text: JSON.stringify(verdict) };
    });
    assert.equal(batches, 2);
    assert.equal(result.decision, 'continue', mode);
  }
});

test('早期唯一证据经过大量无关记录及跨页筛选后仍可使用，后页反证阻止完成', async t => {
  const { goal, run, review, config } = await workspace(t);
  const [pass] = await run('node --test', nodePass);
  const proof = { ...pass, criterionIds: [], id: '唯一证据' };
  const noise = Array.from({ length: 120 }, (_, i) => ({ ...pass, criterionIds: [], id: '噪声' + i,
    checkKey: '其他' + i, summary: '不相关的检查'.repeat(40) }));
  const refutation = { ...pass, id: '反证', criterionIds: [], checkKey: '相反结果', kind: 'fail' };
  for (const failed of [false, true]) {
    goal.observations = [proof, ...noise, ...(failed ? [refutation] : [])];
    const visits = [];
    const result = await review(async options => {
      const { observations } = JSON.parse(options.messages[1].content);
      const ids = observations.map(item => item.id);
      if (options.messages[0].content.includes('分页筛选')) {
        visits.push(...ids);
        return { text: JSON.stringify({ evidenceIds: ids.filter(id => id === proof.id),
          counterevidenceIds: ids.filter(id => id === refutation.id) }) };
      }
      assert.deepEqual(ids, failed ? [proof.id, refutation.id] : [proof.id]);
      // 即使终审模型粗心地只引用通过项，已识别的反证也不能被抹掉。
      return { text: JSON.stringify(completed(proof.id)) };
    }, { config: { model: { ...config.model, max_context_tokens: 12000 } } });
    assert.deepEqual(visits, goal.observations.map(item => item.id));
    assert.equal(result.decision, failed ? 'continue' : 'completed', result.reason);
    if (failed) {
      assert.deepEqual(result.checks[0].evidenceIds, [proof.id, refutation.id]);
      goal.verdicts = [result];
      const retried = await review(completed(proof.id), { config: { model: { ...config.model, max_context_tokens: 200000 } } });
      assert.equal(retried.decision, 'continue', '已绑定的反证在下一轮仍有效');
    }
  }
  // 明确绑定的旧失败在 60 条窗口之外仍能阻止同版本的误判。
  goal.observations = [{ ...refutation, criterionIds: ['c1'] }, proof, ...noise];
  const result = await review(completed(proof.id), { config: { model: { ...config.model, max_context_tokens: 200000 } } });
  assert.equal(result.decision, 'continue');
});

test('单模型本地复核数列完整性、来源和状态机结果，附加要求仍需独立模型', async t => {
  const { root, review } = await workspace(t);
  const goal = { id: '计数', objective: '从1数到5，直到结束', constraints: '', iteration: 1, status: 'active', phase: 'verifying',
    maxIterations: 3, criteria: [{ id: 'c1', text: '在聊天中列出所有数字', evidence: 'reply' }], observations: [], verdicts: [], delegations: [] };
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  const submit = () => review(() => assert.fail('本地验收不调用模型'), { goal, config: { model: { name: '单模型' } } });
  for (const report of ['已经从1数到5。', '1、2、4、5', '1、2、3、3、4、5', '1、3、2、4、5', '1…5', '1、2、3、4、5、6', '1\n2\n3\n4\n5']) {
    goal.report = report;
    goal.observations = await collector.recordReply(report);
    const result = await submit();
    assert.equal(result.decision, report.includes('\n') ? 'completed' : 'continue', report);
    assert.equal(result.verifierKind, 'integer_sequence');
    assert.equal(applyGoalVerdict(goal, result).verdicts.at(-1).accepted, result.decision);
  }
  const valid = await submit();
  goal.report = '这是伪造的完成声明';
  assert.equal((await submit()).decision, 'continue');
  assert.equal(applyGoalVerdict(goal, valid).status, 'paused');
  goal.report = '1\n2\n3\n4\n5';
  goal.constraints = '每个数写在同一行，并解释奇偶性';
  assert.equal((await submit()).decision, 'pause');
  assert.equal(applyGoalVerdict(goal, valid).status, 'paused');
  goal.constraints = '';
  goal.criteria[0].text += '，并解释每个数';
  assert.equal((await submit()).decision, 'pause');
  goal.criteria[0].text = '在聊天中列出所有数字';
  goal.objective += '，并保存文件';
  assert.equal((await submit()).decision, 'pause');
});

test('真实回复末尾的范围说明可以保留，说明中的数字不能补入或扩展数列', async t => {
  const { root, review } = await workspace(t);
  const goal = { id: '尾注', objective: '从1数到100，直到结束', iteration: 1,
    criteria: [{ id: 'c1', text: '从1数到100', evidence: 'reply' }] };
  const collector = createGoalEvidenceCollector({ workspaceRoot: root, goal });
  const numbers = Array.from({ length: 100 }, (_, i) => String(i + 1));
  const body = numbers.join('、');
  for (const [text, accepted] of [
    [body + '\n\n1→100 全数交付，结束。', true],
    [numbers.slice(0, 50).join('、') + '\n \n' + numbers.slice(50).join('、'), true],
    [numbers.slice(0, 50).join('、') + '\n\n' + numbers.slice(51).join('、'), false],
    [body + '\n\n[c1] 交付：1 到 100 逐个列出，完整无缺漏。', true],
    ['以下是从 1 到 100 的数列：\n' + numbers.join('\n') + '\n结束。', true],
    [numbers.slice(0, -1).join('、') + '\n1→100 全数交付，结束。', false],
    [numbers.slice(0, 50).join('、') + '\n后半段如下\n' + numbers.slice(50).join('、'), false],
    [body + '\n101、102', false], [body + '\n另外算上101。', false],
  ]) {
    goal.report = text;
    goal.observations = await collector.recordReply(text);
    const result = await review(() => assert.fail('本地验收不调用模型'), { goal, config: { model: { name: '单模型' } } });
    assert.equal(result.decision, accepted ? 'completed' : 'continue', result.reason);
  }
});

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
