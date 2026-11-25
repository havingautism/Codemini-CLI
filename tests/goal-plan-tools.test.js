import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { FORK_FORBIDDEN_TOOLS, resolveSubAgentToolAllowList, runSubAgentTask } from '../src/core/chat-runtime.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

const plan = { tasks: [{ id: 'inspect', title: '核对导出结果', criterion_ids: ['c1'] }] };

test('目标主代理可以更新任务计划，普通会话和子代理没有计划修改权', async t => {
  const bundle = options => {
    const tools = getBuiltinTools({ config: {}, onRunSubAgent: async () => ({ ok: true }), ...options });
    t.after(() => tools.dispose?.());
    return tools;
  };
  const ordinary = bundle({});
  const active = bundle({ onGoalPlanUpdate: args => args });
  const spec = (tools, name) => tools.definitions.find(def => def.function.name === name)?.function;
  assert.equal(spec(ordinary, 'update_goal_plan'), undefined);
  assert.equal(spec(ordinary, 'run_subagent').parameters.properties.goal_task_id, undefined);
  assert.ok(spec(active, 'update_goal_plan').parameters.properties.main_task);
  assert.ok(spec(active, 'run_subagent').parameters.properties.goal_task_id);
  assert.deepEqual(await active.handlers.update_goal_plan(plan), plan);
  await assert.rejects(ordinary.handlers.update_goal_plan(plan), /仅运行目标的主代理/);
  assert.deepEqual(resolveSubAgentToolAllowList({ role: 'coder', tools: ['update_goal_plan'] }), ['tasks']);
  assert.ok(FORK_FORBIDDEN_TOOLS.includes('update_goal_plan'));
});

test('同批并行重复领取时只分发一次，被拒的调用可以由模型纠正', async t => {
  const dispatched = [];
  const results = [];
  const owned = new Set();
  const tools = getBuiltinTools({ config: {}, onGoalPlanUpdate: args => args,
    onRunSubAgent: async ({ toolCallId, goalTaskId }) => { dispatched.push([toolCallId, goalTaskId]); return { ok: true }; } });
  t.after(() => tools.dispose?.());
  let round = 0;
  await runAgentLoop({ systemPrompt: '测试', userPrompt: '分配核对任务', model: 'test', approvalMode: 'full_access',
    skipAnalysisNudge: true, config: { memory: { enabled: false } }, toolDefinitions: tools.definitions,
    toolHandlers: tools.handlers, toolFormatters: tools.formatters,
    onToolStarted({ args }) {
      if (owned.has(args.goal_task_id)) throw new Error('该任务已被领取');
      owned.add(args.goal_task_id);
    },
    onRawToolResult({ callId }) { results.push(callId); },
    requestCompletion: async ({ messages }) => {
      if (++round === 1) return {
        text: '', toolCalls: ['worker-1', 'worker-2'].map(id => ({
          id, name: 'run_subagent', arguments: JSON.stringify({ prompt: '核对导出结果', goal_task_id: 'inspect' }),
        })),
      };
      assert.match(messages.find(m => m.tool_call_id === 'worker-2').content, /该任务已被领取/);
      return { text: '已取得一份交接', toolCalls: [] };
    },
  });
  assert.deepEqual(dispatched, [['worker-1', 'inspect']]);
  assert.deepEqual(results, ['worker-1']);
});

test('普通和 Crew 子代理先登记最终选定的模型，再向网关发出相同模型的请求', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-worker-model-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  await withCodeminiGlobalDir(path.join(root, 'global'), async () => {
    const originalFetch = globalThis.fetch;
    const timeline = [];
    globalThis.fetch = async (_url, init) => {
      timeline.push(['请求', JSON.parse(init.body).model]);
      return new Response('data: {"choices":[{"delta":{"content":"核对完成"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } });
    };
    try {
      for (const crew of [false, true]) {
        const selected = crew ? 'lite-worker' : 'fast-worker';
        await runSubAgentTask({
          task: '查看任务说明', role: crew ? 'crew_survey' : 'explorer', model: 'parent',
          tools: ['read'], workspaceRoot: root, parentSession: { id: 'parent', messages: [] },
          config: {
            model: { name: 'main', lite_name: 'lite-worker', ...(crew ? {} : { fast_name: 'fast-worker' }) },
            gateway: { base_url: 'http://goal.invalid/v1', api_key: 'test', timeout_ms: 4000, max_retries: 0 },
            sdk: { provider: 'openai-compatible' }, runtime: { crew_session: crew },
            context: { project_context_enabled: false }, memory: { enabled: false },
          },
          async onModelSelected(model) { await Promise.resolve(); timeline.push(['登记', model]); },
        });
        assert.deepEqual(timeline.splice(0), [['登记', selected], ['请求', selected]]);
      }
    } finally {
      globalThis.fetch = originalFetch;
      closeSqliteDatabasesForTests();
    }
  });
});
