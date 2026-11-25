import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RuntimeBridge } from '../codemini-web/lib/runtime-bridge.js';
import { goalVerdictMessage } from '../codemini-web/shared/transcript-segments.js';
import { applyGoalVerdict, beginGoalIteration, createGoalState, goalVerdictEvent,
  markGoalVerifying, recordGoalObservation } from '../src/core/goal-state.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

test('聊天记录保留实际验收决定、分项证据和累计用量，刷新后仍能查看', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-goal-transcript-'));
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = dir;
  t.after(async () => {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });
  let goal = beginGoalIteration(createGoalState({ objective: '核对两个文件', criteria: ['甲存在', '乙存在'] }));
  goal = recordGoalObservation(goal, { id: 'read-1', kind: 'observation', source: 'read',
    revision: 'r1', criterionIds: ['c1'], summary: '已读取甲' });
  goal = markGoalVerifying(goal, '已完成', 'executor');
  goal = applyGoalVerdict(goal, { decision: 'completed', reason: '全部完成', executorModel: 'executor',
    gatekeeperModel: 'reviewer', currentRevision: 'r1', checks: [{ criterionId: 'c1', evidenceIds: ['read-1'] }] });
  const event = goalVerdictEvent(goal);
  assert.match(event.name, /继续执行/);
  assert.equal(event.summary, goal.reason);
  assert.notEqual(event.summary, '全部完成');
  assert.deepEqual(event.criteria.map(c => c.evidence), [[{ id: 'read-1', summary: '已读取甲' }], []]);
  const sessionId = 'goal-verdict-session';
  const runtime = {
    getCurrentSessionId: () => sessionId, getRuntimeState: () => ({ sessionId }), getLastSystemPrompt: () => '',
    setRequestToolApproval() {}, setRequestUserInput() {}, setOnTitleUpdate() {}, setOnTitleStatus() {},
    async submitMessage(_message, onEvent) { onEvent(event); return { type: 'system', text: '目标已暂停' }; },
  };
  const done = Promise.withResolvers();
  let live;
  const bridge = new RuntimeBridge(runtime, { sessionId, onEvent(e) {
    if (e.type === 'goal:verdict') live = e;
    if (e.type === 'submit:done') done.resolve();
  } });
  try {
    bridge.handleSubmitMessage({ text: '/goal 核对两个文件' });
    await done.promise;
    assert.equal(live.messageId, event.id);
  } finally { await bridge.dispose(); }
  const restored = new RuntimeBridge(runtime, { sessionId });
  try {
    const matching = (await restored.getUiMessages()).filter(m => m.dividerType === 'goal-verdict');
    assert.equal(matching.length, 1);
    for (const [key, value] of Object.entries(goalVerdictMessage(live))) assert.deepEqual(matching[0][key], value);
  } finally { await restored.dispose(); }
});
