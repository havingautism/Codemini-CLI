import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWebRuntimeApi } from '../codemini-web/server.js';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, saveSessionGoal } from '../src/core/session-store.js';
import { beginGoalIteration, createGoalState } from '../src/core/goal-state.js';
import { updateGoalPlan } from '../src/core/goal-tasks.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { withCodeminiGlobalDir } from './helpers/codemini-global-dir.js';

test('Web 重开后可从会话库读取任务图，清除目标后按会话发送变更通知', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-web-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 }));
  await withCodeminiGlobalDir(dir, async () => {
    const handle = createWebRuntimeApi({ pool: {}, ensureSession: () => assert.fail('读取任务图不应启动运行时') });
    async function get(sessionId) {
      let body, status;
      const response = { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } };
      assert.equal(await handle({ method: 'GET', url: '/api/goal?sessionId=' + sessionId, headers: {} }, response), true);
      return { body, status };
    }
    let bridge;
    try {
      const session = await createSession(dir);
      const other = await createSession(dir);
      const goal = beginGoalIteration(createGoalState({ objective: '核对两个文件', criteria: ['核对完成'] }));
      const plan = updateGoalPlan(goal, [{ id: 'a', title: '甲' }, { id: 'b', title: '乙', depends_on: ['a'] }]);
      saveSessionGoal(session, plan);
      closeSqliteDatabasesForTests();
      assert.equal((await get('')).status, 400);
      assert.deepEqual(await get(other.id), { body: { goal: null }, status: 200 });
      const { body, status } = await get(session.id);
      assert.equal(status, 200);
      assert.deepEqual(body.goal.tasks.map(task => [task.id, task.dependsOn]), [['a', []], ['b', ['a']]]);
      assert.deepEqual(body.goal.criteria, [{ id: 'c1', text: '核对完成' }]);
      assert.equal('ownerToken' in body.goal, false);
      const runtime = await createChatRuntime({ session, workspaceRoot: dir, config: { model: { name: 'test' } } });
      const events = [];
      bridge = new RuntimeBridge(runtime, { sessionId: session.id, onEvent: e => events.push(e) });
      await bridge.handleGoalControl('/goal clear');
      assert.deepEqual(events.filter(e => e.type === 'goal:changed'), [{ type: 'goal:changed', sessionId: session.id }]);
      assert.deepEqual((await get(session.id)).body, { goal: null });
    } finally {
      await bridge?.dispose();
      closeSqliteDatabasesForTests();
    }
  });
});
