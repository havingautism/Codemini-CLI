import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, saveSession } from '../src/core/session-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

function stream(delta, finish_reason = 'stop') {
  const chunk = { choices: [{ index: 0, delta, finish_reason }] };
  return new Response('data: ' + JSON.stringify(chunk) + '\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } });
}

function tools(...calls) {
  return stream({ tool_calls: calls.map(([id, name, args], index) =>
    ({ id, index, type: 'function', function: { name, arguments: JSON.stringify(args) } })) }, 'tool_calls');
}

async function withRuntime(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-task-recovery-'));
  const workspace = path.join(dir, 'project');
  await fs.mkdir(workspace);
  try {
    await withCodeminiGlobalDir(path.join(dir, 'global'), async () => {
      const originalFetch = globalThis.fetch;
      let runtime;
      const open = async session => runtime = await createChatRuntime({
        session, workspaceRoot: workspace, systemPrompt: '请在当前目录核对交付。',
        config: {
          sdk: { provider: 'openai-compatible' },
          gateway: { base_url: 'http://goal.invalid/v1', api_key: 'test', timeout_ms: 8000, max_retries: 0 },
          model: { name: 'parent', fast_name: 'worker' },
          context: { project_context_enabled: false, project_instructions_enabled: false },
          execution: { mode: 'normal', approval_mode: 'auto' },
          tools: { max_parallel_calls: 2 },
          memory: { enabled: false, background_review: { enabled: false, after_turn: false } },
        },
        model: 'parent',
      });
      const close = async () => {
        await runtime?.dispose();
        runtime = null;
        closeSqliteDatabasesForTests();
      };
      const session = await createSession(workspace);
      session.title = '核对两个发布清单';
      try { await run({ workspace, session, open, close }); }
      finally { globalThis.fetch = originalFetch; await close(); }
    });
  } finally { await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }); }
}

const tasks = [
  { id: 'alpha', title: '核对甲清单', criterion_ids: ['c1'] },
  { id: 'beta', title: '核对乙清单', criterion_ids: ['c2'] },
];
const marker = { alpha: 'ALPHA-CHECKED', beta: 'BETA-CHECKED' };
function delegate(id, task) {
  return [id, 'run_subagent', { goal_task_id: task, name: task,
    prompt: '仅检查指定文件 ' + task + '.txt', tools: ['read'] }];
}

test('并发子任务跨三次压缩和 SQLite 重开，已验收任务不重派，中断任务取得新的交接和证据', { timeout: 30000 }, async () => {
  await withRuntime(async ({ workspace, session, open, close }) => {
    for (const [key, value] of Object.entries(marker)) await fs.writeFile(path.join(workspace, key + '.txt'), value);
    for (let i = 0; i < 32; i++) session.messages.push({ role: i % 2 ? 'assistant' : 'user', content: '旧会话背景 ' + i });
    await saveSession(session);
    let runtime = await open(session);
    let resumed = false;
    const childStarts = [];
    const reviews = [];
    const parentPrompts = [];
    const betaStarted = Promise.withResolvers();
    const mockError = Promise.withResolvers();
    const problems = [];
    globalThis.fetch = async (_url, init) => {
      try {
        const { messages, model, tools: available, stream: streaming } = JSON.parse(init.body);
        const last = messages.at(-1);
        const system = String(messages[0].content);
        if (!streaming) return Response.json({ choices: [{ message: { content: '此前消息已压缩。', role: 'assistant' }, finish_reason: 'stop' }] });
        if (!available?.length && system.includes('验收条件的证据类型')) {
          const { criteria } = JSON.parse(last.content);
          return stream({ content: JSON.stringify({ criteria: criteria.map(({ id }) => ({ id, evidence: 'workspace' })) }) });
        }
        if (!available?.length && system.includes('目标验收员')) {
          const packet = JSON.parse(last.content);
          assert.equal(model, packet.parentObjective ? 'parent' : 'worker');
          const checks = packet.criteria.map(({ id }) => {
            const key = id === 'c1' ? 'alpha' : 'beta';
            const evidence = packet.observations.find(obs => obs.artifactPath === key + '.txt' && obs.summary.includes(marker[key]));
            return { criterionId: id, evidenceIds: evidence ? [evidence.id] : [] };
          });
          reviews.push(checks);
          return stream({ content: JSON.stringify({ decision: checks.every(c => c.evidenceIds.length) ? 'completed' : 'continue',
            reason: '核对本次收到的原始文件证据。', checks }) });
        }
        if (model === 'worker') {
          assert.ok(!available.some(tool => tool.function.name === 'update_goal_plan'), '子代理不能修改主代理的持久计划');
          if (last.role === 'tool') return stream({ content: '已核对：' + last.content });
          const workerTask = String(last.content).split('Task:').at(-1);
          const [, key] = workerTask.match(/仅检查指定文件 (alpha|beta)\.txt/) || [];
          assert.ok(key, '子代理收到明确的工作范围');
          childStarts.push(key);
          if (!resumed && key === 'beta') {
            betaStarted.resolve();
            return new Promise((_, reject) => {
              const abort = () => reject(new DOMException('暂停了乙任务', 'AbortError'));
              if (init.signal.aborted) abort();
              else init.signal.addEventListener('abort', abort, { once: true });
            });
          }
          if (key === 'alpha') await betaStarted.promise;
          return tools(['read-' + key, 'read', { path: key + '.txt' }]);
        }
        assert.equal(model, 'parent');
        if (last.role === 'tool') {
          if (last.tool_call_id === 'publish-plan') return tools(delegate('first-alpha', 'alpha'), delegate('first-beta', 'beta'));
          if (last.tool_call_id === 'repeat-alpha') {
            assert.match(String(last.content), /已经验收/);
            return tools(delegate('second-beta', 'beta'));
          }
          if (last.tool_call_id === 'second-beta') return stream({ content: '两份文件均完成核对。' });
          throw new Error('主代理收到意外结果 ' + last.tool_call_id);
        }
        parentPrompts.push({ resumed, text: JSON.stringify(messages) });
        assert.ok(available.some(tool => tool.function.name === 'update_goal_plan'), '主代理可以建立任务计划');
        return resumed ? tools(delegate('repeat-alpha', 'alpha')) : tools(['publish-plan', 'update_goal_plan', { tasks }]);
      } catch (error) {
        mockError.resolve(error);
        problems.push(error.message);
        throw error;
      }
    };

    const command = '/goal 请并行委派两人核对发布清单\n验收：alpha.txt 含 ALPHA-CHECKED；beta.txt 含 BETA-CHECKED\n轮数：2';
    const running = runtime.submitMessage({ text: command });
    const watch = new AbortController();
    const limit = AbortSignal.any([watch.signal, AbortSignal.timeout(6500)]);
    const waitForCheckpoint = async () => {
      while (!limit.aborted) {
        const state = (await loadSession(session.id)).goalState;
        if (state?.tasks?.find(task => task.id === 'alpha')?.status === 'verified') return;
        await delay(15);
      }
      if (!watch.signal.aborted) throw new Error('未在并发期间保存甲任务的独立验收：' + JSON.stringify(runtime.getSession().goalState));
    };
    try {
      await Promise.race([waitForCheckpoint(), mockError.promise.then(e => { throw e; }),
        running.then(result => { throw new Error('目标提前结束：' + result.text); })]);
    } finally {
      watch.abort();
      betaStarted.resolve();
      await runtime.submitGoalControl('/goal pause');
      await running;
    }
    const paused = (await loadSession(session.id)).goalState;
    assert.equal(paused.status, 'paused');
    assert.deepEqual(childStarts.slice().sort(), ['alpha', 'beta']);
    assert.ok(reviews.some(checks => checks.length === 1 && checks[0].criterionId === 'c1' && checks[0].evidenceIds.length));
    assert.deepEqual(paused.delegations.map(d => [d.id, d.status]).sort(),
      [['first-alpha', 'completed'], ['first-beta', 'interrupted']]);
    assert.deepEqual(paused.tasks.map(task => [task.id, task.status]), [['alpha', 'verified'], ['beta', 'interrupted']]);
    assert.ok(paused.delegations.find(d => d.id === 'first-alpha').handoffPath);
    let length = runtime.getSession().messages.length;
    for (const mode of ['--conservative', '--default', '--aggressive']) {
      await runtime.dispatchAction({ name: 'compact', payload: { args: [mode] } });
      const compacted = await loadSession(session.id);
      assert.ok(compacted.compact.view.length < length);
      assert.deepEqual(compacted.goalState.tasks, paused.tasks);
      length = compacted.compact.view.length;
    }
    await close();
    const restored = await loadSession(session.id);
    assert.deepEqual(restored.goalState, paused);
    runtime = await open(restored);
    resumed = true;
    const result = await runtime.submitMessage({ text: '/goal resume' });
    assert.deepEqual(problems, []);
    const done = (await loadSession(session.id)).goalState;
    assert.equal(done.status, 'completed', result.text);
    assert.deepEqual(childStarts.filter(id => id === 'alpha'), ['alpha']);
    assert.equal(childStarts.filter(id => id === 'beta').length, 2);
    assert.deepEqual(done.tasks.map(task => [task.id, task.status]), [['alpha', 'verified'], ['beta', 'verified']]);
    assert.deepEqual(done.tasks.map(task => task.attempts.map(attempt => [attempt.id, attempt.owner, attempt.status])), [
      [['first-alpha', 'subagent', 'delivered']], [['first-beta', 'subagent', 'interrupted'], ['second-beta', 'subagent', 'delivered']],
    ]);
    const delegated = done.delegations.find(d => d.id === 'second-beta');
    assert.ok(delegated?.handoffPath && delegated.status === 'completed');
    assert.equal(delegated.goalTaskId, 'beta');
    assert.ok(!done.delegations.some(d => d.id === 'repeat-alpha'));
    const finalReview = reviews.at(-1);
    assert.deepEqual(finalReview.map(c => c.criterionId), ['c1', 'c2']);
    for (const [index, callId] of ['first-alpha', 'second-beta'].entries()) {
      const attempt = done.tasks[index].attempts.at(-1);
      assert.equal(attempt.model, 'worker');
      assert.equal(attempt.reviews.at(-1).executorModel, 'worker');
      assert.equal(attempt.reviews.at(-1).gatekeeperModel, 'parent');
      const artifact = done.observations.find(o => o.id === finalReview[index].evidenceIds[0]);
      assert.ok(artifact.toolCallId.startsWith(callId + '/'));
      assert.deepEqual(artifact.criterionIds, tasks[index].criterion_ids);
      assert.ok(done.tasks[index].verification.checks.some(check => check.evidenceIds.includes(artifact.id)));
    }
    const recoveryPrompt = parentPrompts.find(p => p.resumed).text;
    assert.match(recoveryPrompt, /\[alpha\][^\n]*(已验收)/);
    assert.match(recoveryPrompt, /\[beta\][^\n]*(已中断)/);
  });
});

test('一个步骤即可验收的自然目标直接完成，无需创建计划或委派', async () => {
  await withRuntime(async ({ session, open }) => {
    const runtime = await open(session);
    const calls = [];
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (!body.stream) return Response.json({ choices: [{ message: { role: 'assistant', content: '数到三' } }] });
      calls.push(body.model);
      return stream({ content: '1、2、3' });
    };
    const result = await runtime.submitMessage({ text: '/goal 从1数到3' });
    const goal = (await loadSession(session.id)).goalState;
    assert.equal(goal.status, 'completed', result.text);
    assert.deepEqual(goal.tasks ?? [], []);
    assert.deepEqual(goal.delegations, []);
    assert.deepEqual(calls, ['parent']);
  });
});
