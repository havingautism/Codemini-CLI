import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, saveSession } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';

const primary = 'goal-primary';
const secondary = 'goal-fast';
const objective = '核对交付清单';
const criterion = 'release.txt 中包含交付编号';
const constraint = '保持交付清单原文';
const file = 'release.txt';
const marker = 'release-id=2026-CURRENT';

function streaming(delta, finish_reason) {
  const chunk = JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] });
  return new Response('data: ' + chunk + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
function reply(content) {
  return streaming({ content }, 'stop');
}
function toolCall(id, name, args) {
  return streaming({ tool_calls: [{ id, index: 0, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, 'tool_calls');
}

async function fixture(t, { approvalMode = 'auto', context = {} } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-e2e-'));
  const workspace = path.join(root, 'project');
  const globalDir = path.join(root, 'global');
  await fs.mkdir(workspace);
  await fs.writeFile(path.join(workspace, file), marker + '\n');
  const originalDir = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const originalFetch = globalThis.fetch;
  let runtime;
  t.after(async () => {
    try { await runtime?.dispose(); } finally {
      globalThis.fetch = originalFetch;
      closeSqliteDatabasesForTests();
      if (originalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
      else process.env.CODEMINI_GLOBAL_DIR = originalDir;
      await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });
  const config = {
    sdk: { provider: 'openai-compatible' },
    gateway: { base_url: 'http://goal.invalid/v1', api_key: 'test', timeout_ms: 5000, max_retries: 0 },
    model: { name: primary, fast_name: secondary, reasoning_enabled: false },
    context: { project_context_enabled: false, project_instructions_enabled: false, preflight_trigger_pct: 95, microcompact_enabled: false, ...context },
    execution: { mode: 'normal', approval_mode: approvalMode },
    tools: { max_parallel_calls: 1 },
    memory: { enabled: false, background_review: { enabled: false, after_turn: false } },
    ui: { language: 'zh', reply_language: 'zh' },
  };
  return {
    workspace,
    async open(session) {
      runtime = await createChatRuntime({ session, config, model: primary, systemPrompt: '协助核对交付清单。', workspaceRoot: workspace });
      return runtime;
    },
    async close() {
      await runtime.dispose();
      runtime = null;
      closeSqliteDatabasesForTests();
    },
  };
}

test('普通模式真实委派在暂停、三次压缩和 SQLite 重载后继续，并由独立模型验收', { timeout: 30000 }, async (t) => {
  const { workspace, open, close } = await fixture(t);
  const session = await createSession(workspace);
  session.title = '交付核对';
  for (let i = 0; i < 24; i++) {
    session.messages.push({ role: i % 2 ? 'assistant' : 'user', content: '早先的背景资料 ' + i, at: new Date().toISOString() });
  }
  await saveSession(session);
  let runtime = await open(session);
  const command = '/goal ' + objective + '\n验收：' + criterion + '\n约束：' + constraint + '\n轮数：3';
  const reachedPause = Promise.withResolvers();
  const parentRequests = [];
  const childFileResults = [];
  const reviews = [];
  let resumed = false;
  let childCount = 0;
  const failures = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const tail = body.messages.at(-1);
    const tools = (body.tools || []).map((tool) => tool.function.name);
    const check = (pass, message) => { if (!pass) failures.push(message); };
    if (!tools.length && String(body.messages[0].content).includes('独立、只读的目标验收员')) {
      const packet = JSON.parse(tail.content);
      reviews.push({ model: body.model, packet, tools });
      const evidence = packet.observations.find((item) => item.kind === 'observation' && item.summary.includes(marker));
      return reply(JSON.stringify({ decision: 'completed', reason: '实际文件中存在交付编号。',
        checks: [{ criterionId: 'c1', evidenceIds: evidence ? [evidence.id] : [] }] }));
    }
    if (body.model === secondary && tools.length) {
      check(!tools.includes('run_subagent'), '子代理不应能继续委派');
      if (tail.role === 'tool') {
        childFileResults.push(String(tail.content));
        return reply('核对完成，读取到 ' + marker);
      }
      return toolCall('child-read-' + (++childCount), 'read', { path: file });
    }
    if (body.model === primary && tools.length) {
      parentRequests.push({ tools, messages: body.messages, resumed });
      if (tail.role === 'user') {
        const index = resumed ? 2 : 1;
        return toolCall('delegate-' + index, 'run_subagent', { name: '核对员' + index, prompt: '读取 release.txt 并报告交付编号', tools: ['read'] });
      }
      if (tail.tool_call_id === 'delegate-1' && !resumed) {
        reachedPause.resolve();
        return new Promise((_, reject) => {
          const abort = () => reject(new DOMException('已暂停', 'AbortError'));
          if (init.signal.aborted) abort();
          else init.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (tail.tool_call_id === 'delegate-2') return toolCall('verify-read', 'read', { path: file, criterion_ids: ['c1'] });
      if (tail.tool_call_id === 'verify-read') return reply('已亲自读取并核对本次交付的编号。');
      failures.push('无法识别执行器的工具回合 ' + tail.tool_call_id);
      return reply('等待核对。');
    }
    // 标题和压缩使用普通非流式接口。
    return Response.json({ choices: [{ message: { role: 'assistant', content: '此前的对话摘要' }, finish_reason: 'stop' }] });
  };
  const events = [];
  const running = runtime.submitMessage({ text: command }, (event) => events.push(event));
  await Promise.race([reachedPause.promise, running.then((result) => {
    throw new Error('未进入预期的父模型请求：' + result.text + '，请求记录 ' + JSON.stringify(parentRequests.map((item) => item.messages.at(-1).role)));
  })]);
  assert.equal(runtime.getSession().goalState.delegations[0].status, 'completed');
  await runtime.submitGoalControl('/goal pause');
  await running;
  const paused = (await loadSession(session.id)).goalState;
  assert.equal(paused.status, 'paused');
  assert.equal(paused.iteration, 1);
  assert.equal(paused.maxIterations, 3);
  assert.equal(paused.delegations[0].id, 'delegate-1');
  assert.ok(paused.delegations[0].handoffPath);
  let previousLength = runtime.getSession().messages.length;
  for (const mode of ['--conservative', '--default', '--aggressive']) {
    const result = await runtime.dispatchAction({ name: 'compact', payload: { args: [mode] } });
    assert.match(result.text, /Compact applied:/);
    const saved = await loadSession(session.id);
    assert.ok(saved.compact.view.length < previousLength, '缩短了真实模型视图');
    previousLength = saved.compact.view.length;
    assert.deepEqual(saved.goalState, paused);
  }
  await close();
  const reloaded = await loadSession(session.id);
  assert.deepEqual(reloaded.goalState, paused);
  runtime = await open(reloaded);
  resumed = true;
  const result = await runtime.submitMessage({ text: '/goal resume' }, (event) => events.push(event));
  const goal = (await loadSession(session.id)).goalState;
  assert.equal(goal.status, 'completed', result.text);
  assert.equal(goal.iteration, 1, '恢复被中断的一轮时保持已记账的轮次');
  assert.equal(goal.maxIterations, 3);
  assert.deepEqual(goal.delegations.map((entry) => [entry.id, entry.status]), [['delegate-1', 'completed'], ['delegate-2', 'completed']]);
  assert.equal(childFileResults.length, 2);
  for (const content of childFileResults) assert.match(content, /release-id=2026-CURRENT/);
  assert.ok(events.some((event) => event.type === 'plan:step_done' && event.toolCallId === 'delegate-2'));
  assert.equal(reviews.length, 1);
  assert.equal(reviews[0].model, secondary);
  assert.deepEqual(reviews[0].tools, []);
  assert.equal(reviews[0].packet.constraints, constraint);
  assert.ok(goal.observations.some((item) => item.artifactPath === file && item.summary.includes(marker)));
  for (const request of parentRequests) {
    assert.ok(request.tools.includes('run_subagent'));
    const prompt = JSON.stringify(request.messages);
    for (const expected of [objective, criterion, constraint]) assert.ok(prompt.includes(expected));
    if (request.resumed) {
      assert.ok(prompt.includes('delegate-1'), '压缩后的恢复请求包含此前的真实委派记录');
      assert.ok(prompt.includes('1/3'), '模型可见实际使用的轮次预算');
    }
  }
  assert.deepEqual(failures, []);
});

test('普通聊天保持工具范围，禁止委派的目标在缺证时预算耗尽，追加预算后才会继续', { timeout: 15000 }, async (t) => {
  const { workspace, open } = await fixture(t);
  const session = await createSession(workspace);
  session.title = '核对委派限制';
  const runtime = await open(session);
  const requests = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.stream) {
      requests.push({ model: body.model, tools: (body.tools || []).map((tool) => tool.function.name) });
      return reply('我认为一切已完成。');
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: '清单' }, finish_reason: 'stop' }] });
  };
  await runtime.submitMessage({ text: '介绍一下这里的工作流程' });
  assert.equal(requests.length, 1);
  assert.ok(!requests[0].tools.includes('run_subagent'));
  const text = '/goal 核对记录 验收：有文件读取证据 约束：不要委派 轮数：1';
  await runtime.submitMessage({ text });
  let goal = (await loadSession(session.id)).goalState;
  assert.equal(goal.status, 'exhausted');
  assert.equal(goal.iteration, 1);
  assert.deepEqual(goal.delegations, []);
  assert.deepEqual(goal.observations, []);
  const before = requests.length;
  const noBudget = await runtime.submitMessage({ text: '/goal resume' });
  assert.match(noBudget.text, /预算/);
  assert.equal(requests.length, before);
  await runtime.submitMessage({ text: '/goal resume +1' });
  goal = (await loadSession(session.id)).goalState;
  assert.equal(goal.status, 'exhausted');
  assert.equal(goal.iteration, 2);
  assert.equal(goal.maxIterations, 2);
  assert.equal(requests.length, before + 1);
  for (const request of requests) {
    assert.equal(request.model, primary);
    assert.ok(!request.tools.includes('run_subagent'));
  }
});

test('暂停真实目标会清理待审批或待答表单，普通聊天的审批仍可处理', { timeout: 15000 }, async (t) => {
  const { workspace, open } = await fixture(t, { approvalMode: 'review' });
  const session = await createSession(workspace);
  session.title = '审批中暂停';
  const runtime = await open(session);
  let mode = 'approval';
  let waiting = Promise.withResolvers();
  const events = [];
  const bridge = new RuntimeBridge(runtime, { sessionId: session.id, onEvent(event) {
    events.push(event);
    if (event.type === 'approval:request' || event.type === 'user-input:request') waiting.resolve(event);
  } });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: '核对' } }] });
    if (body.messages.at(-1).role === 'tool') return reply('保持现有文件。');
    return mode === 'input'
      ? toolCall('form', 'request_user_input', { questions: [{ id: 'choice', question: '确认验收环境？' }] })
      : toolCall(mode, 'delete', { path: file });
  };
  async function waitForRequest(running) {
    return Promise.race([waiting.promise, running.then((result) => { throw new Error('尚未申请交互即结束：' + result.text); })]);
  }
  const goal = runtime.submitMessage({ text: '/goal 确认交付编号 验收：读取实际文件' });
  const approval = await waitForRequest(goal);
  assert.equal(approval.goalControl, true);
  assert.ok(bridge.hasPendingApproval(approval.id));
  await bridge.handleGoalControl('/goal pause');
  await goal;
  assert.equal(bridge.hasPendingApproval(approval.id), false);
  assert.equal(bridge.handleApproval(approval.id, true), false);
  assert.ok(events.some((event) => event.type === 'approval:resolved' && event.approved === false));
  assert.equal(await fs.readFile(path.join(workspace, file), 'utf8'), marker + '\n');

  waiting = Promise.withResolvers();
  mode = 'input';
  const resumed = runtime.submitMessage({ text: '/goal resume' });
  const form = (await waitForRequest(resumed)).request;
  assert.ok(bridge.hasPendingUserInput(form.id));
  await bridge.handleGoalControl('/goal pause');
  await resumed;
  assert.ok(!bridge.hasPendingUserInput(form.id));
  assert.equal(bridge.handleUserInput(form.id, { answers: { choice: '旧答案' } }), false);
  assert.ok(events.some((event) => event.type === 'user-input:resolved' && event.id === form.id));
  assert.equal((await loadSession(session.id)).goalState.status, 'paused');

  waiting = Promise.withResolvers();
  mode = 'ordinary';
  const ordinary = runtime.submitMessage({ text: '处理普通审批' });
  const normal = await waitForRequest(ordinary);
  assert.equal(normal.goalControl, undefined);
  await bridge.handleGoalControl('/goal pause');
  assert.ok(bridge.hasPendingApproval(normal.id));
  assert.equal(bridge.handleApproval(normal.id, false), true);
  await ordinary;
  await bridge.dispose();
});

test('目标连续八轮自动压缩，验收异常后重开会话只重试验收', { timeout: 30000 }, async (t) => {
  const roundBudget = 8;
  const { workspace, open, close } = await fixture(t, { context: { preflight_trigger_pct: 1, max_tokens: 32000 } });
  const session = await createSession(workspace);
  session.title = '自动压缩回归';
  // 首轮压缩保留的最近消息也超过阈值，下一轮会再次进入真实的自动压缩路径。
  for (let i = 0; i < 28; i++) {
    session.messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `历史资料 ${i}：` + '上一项交付的讨论。'.repeat(45) });
  }
  await saveSession(session);
  let runtime = await open(session);
  const compactions = [];
  const requests = [];
  const reviews = [];
  const onEvent = event => {
    if (event.type !== 'compact:auto') return;
    const live = runtime.getSession();
    compactions.push({ iteration: live.goalState.iteration, mode: event.mode,
      boundary: live.compact?.boundaryIndex, sourceLength: live.messages.length, viewLength: live.compact?.view.length });
  };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: '已整理历史资料。' }, finish_reason: 'stop' }] });
    const tail = body.messages.at(-1);
    if (!body.tools?.length && String(body.messages[0]?.content).includes('独立、只读的目标验收员')) {
      const packet = JSON.parse(tail.content);
      reviews.push({ model: body.model, packet });
      const evidenceIds = packet.observations.filter(item => item.kind === 'observation' && item.summary.includes(marker)).map(item => item.id);
      if (reviews.length === roundBudget) return reply('暂时无法返回判定');
      const needsAnotherRound = reviews.length < roundBudget;
      return reply(JSON.stringify({ decision: needsAnotherRound ? 'continue' : 'completed',
        reason: needsAnotherRound ? '请再核对文件内容。' : '再次读取确认了交付编号。',
        checks: [{ criterionId: 'c1', evidenceIds }] }));
    }
    const round = runtime.getSession().goalState.iteration;
    requests.push({ round, messages: body.messages });
    return tail.role === 'tool'
      ? reply('已读取交付清单并核对编号。'.repeat(75))
      : toolCall('round-' + round + '-read', 'read', { path: file });
  };
  await runtime.submitMessage({ text: '/goal ' + objective + '\n验收：' + criterion + '\n约束：' + constraint + '\n轮数：' + roundBudget }, onEvent);
  const saved = await loadSession(session.id);
  const rounds = Array.from({ length: roundBudget }, (_, index) => index + 1);
  assert.deepEqual(compactions.map(item => item.iteration), rounds);
  for (const item of compactions) {
    assert.ok(['conservative', 'aggressive'].includes(item.mode));
    assert.ok(item.boundary > 0 && item.viewLength < item.sourceLength, '自动压缩确实缩短了模型视图');
  }
  assert.deepEqual(requests.map(item => item.round), rounds.flatMap(round => [round, round]));
  for (const { round, messages } of requests) {
    const userText = JSON.stringify(messages.findLast(item => item.role === 'user')?.content);
    for (const expected of [objective, criterion, constraint, `${round}/${roundBudget}`]) assert.ok(userText.includes(expected));
  }
  const paused = saved.goalState;
  assert.equal(paused.status, 'paused');
  assert.equal(paused.resumePhase, 'verifying');
  assert.equal(paused.maxIterations, roundBudget);
  assert.equal(paused.iteration, roundBudget);
  const expectedVerdicts = [...Array(roundBudget - 1).fill('continue'), 'pause'];
  assert.deepEqual(paused.verdicts.map(item => item.accepted), expectedVerdicts);
  assert.ok(paused.report.includes('交付清单'));
  const evidenceIds = paused.observations.map(item => item.id);
  await close();
  runtime = await open(await loadSession(session.id));
  const result = await runtime.submitMessage({ text: '/goal resume' }, onEvent);
  const finished = (await loadSession(session.id)).goalState;
  assert.equal(finished.status, 'completed', result.text);
  assert.equal(finished.iteration, roundBudget);
  assert.equal(finished.maxIterations, roundBudget);
  assert.deepEqual(finished.observations.map(item => item.id), evidenceIds);
  assert.deepEqual(finished.verdicts.map(item => item.accepted), [...expectedVerdicts, 'completed']);
  assert.equal(requests.length, 2 * roundBudget, '验收恢复没有再次调用执行模型');
  assert.equal(compactions.length, roundBudget);
  assert.equal(reviews.length, roundBudget + 1);
  for (const { packet, model } of reviews) {
    assert.equal(model, secondary);
    assert.equal(packet.objective, objective);
    assert.equal(packet.constraints, constraint);
    assert.equal(packet.criteria[0].text, criterion);
    assert.ok(packet.observations.some(item => item.artifactPath === file && item.summary.includes(marker)));
  }
});

test('子代理仍在执行时暂停并立即恢复，复用调用编号可保留交接并完成原轮次', { timeout: 30000 }, async (t) => {
  const { workspace, open } = await fixture(t);
  const session = await createSession(workspace);
  session.title = '委派中断恢复';
  await saveSession(session);
  const runtime = await open(session);
  await fs.writeFile(path.join(workspace, file), '待更新的交付编号\n');
  const childStarted = Promise.withResolvers();
  const releaseChild = Promise.withResolvers();
  // 恢复后先重试被中断的委派，再用原编号复核暂停期间更新的文件。
  const calls = ['finished-call', 'pending-call', 'pending-call', 'finished-call'];
  let dispatched = 0;
  let pendingSignal;
  let childRead = '';
  let reviews = 0;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const tail = body.messages.at(-1);
    if (!body.tools?.length && String(body.messages[0].content).includes('目标验收员')) {
      reviews++;
      const evidence = JSON.parse(tail.content).observations.find((item) => item.summary.includes(marker));
      return reply(JSON.stringify({ decision: 'completed', reason: '已读取交付编号',
        checks: [{ criterionId: 'c1', evidenceIds: evidence ? [evidence.id] : [] }] }));
    }
    if (body.model === secondary && body.tools?.length) {
      if (dispatched === 1) {
        if (tail.role !== 'tool') return toolCall('child-read', 'read', { path: file });
        return reply('首次核对交接');
      }
      if (dispatched === 2) {
        pendingSignal = init.signal;
        childStarted.resolve();
        await releaseChild.promise;
        throw new DOMException('子代理请求已中断', 'AbortError');
      }
      if (dispatched === 3) return reply('已接续中断的核对工作');
      if (tail.role !== 'tool') return toolCall('child-read', 'read', { path: file });
      childRead = String(tail.content);
      return reply('再次核对交接，已读取 ' + marker);
    }
    if (body.model === primary && body.tools?.length) {
      if (dispatched === calls.length) return reply('子代理已经核对交付编号。');
      return toolCall(calls[dispatched++], 'run_subagent', {
        name: '核对员', prompt: '读取 release.txt 核对交付编号', summary: '核对编号', tools: ['read'],
      });
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: '交付核对' }, finish_reason: 'stop' }] });
  };

  const run = runtime.submitMessage({ text: '/goal ' + objective + '\n验收：' + criterion + '\n轮数：1' });
  await Promise.race([childStarted.promise, run.then(result => { throw new Error('未到达子代理暂停点：' + result.text); })]);
  let paused;
  let firstHandoff;
  let resumed;
  try {
    await runtime.submitGoalControl('/goal pause');
    paused = (await loadSession(session.id)).goalState;
    assert.equal(pendingSignal.aborted, true);
    assert.equal(paused.status, 'paused');
    assert.ok(paused.observations.some(item => item.artifactPath === file && item.summary.includes('待更新的交付编号')));
    assert.deepEqual(paused.delegations.map(item => [item.id, item.status]),
      [['finished-call', 'completed'], ['pending-call', 'interrupted']]);
    firstHandoff = await fs.readFile(path.join(workspace, paused.delegations[0].handoffPath), 'utf8');
    assert.match(firstHandoff, /首次核对交接/);
    await fs.writeFile(path.join(workspace, file), marker + '\n');
    resumed = runtime.submitMessage({ text: '/goal resume' });
  } finally {
    releaseChild.resolve();
  }
  const [, result] = await Promise.all([run, resumed]);
  const goal = (await loadSession(session.id)).goalState;
  assert.equal(goal.status, 'completed', result.text);
  assert.equal(goal.iteration, 1);
  assert.equal(goal.maxIterations, 1);
  assert.equal(dispatched, calls.length);
  assert.equal(reviews, 1);
  assert.ok(childRead.includes(marker));
  assert.ok(goal.observations.some(item => item.artifactPath === file && item.summary.includes(marker)));
  assert.deepEqual(goal.delegations.slice(0, 2), paused.delegations);
  assert.deepEqual(goal.delegations.slice(2).map(item => item.status), ['completed', 'completed']);
  assert.equal(new Set(goal.delegations.map(item => item.id)).size, 4);
  assert.equal(await fs.readFile(path.join(workspace, goal.delegations[0].handoffPath), 'utf8'), firstHandoff);
  for (const [item, expected] of [[goal.delegations[2], '已接续中断'], [goal.delegations[3], '再次核对交接']]) {
    assert.equal(path.basename(path.dirname(item.handoffPath)), item.id);
    assert.ok((await fs.readFile(path.join(workspace, item.handoffPath), 'utf8')).includes(expected));
  }
});
