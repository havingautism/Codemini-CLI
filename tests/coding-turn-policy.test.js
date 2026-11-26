import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodingTurnPolicy, isCodingTurnToolAllowed, buildCodingTurnPolicyBlock } from '../src/core/coding-turn-policy.js';
import { applyCrewParentToolPolicy, EXECUTION_MODE_TOOL_POLICY } from '../src/core/chat-runtime.js';

test('区分分别委派、禁止委派，以及禁止范围内的举例', () => {
  for (const text of ['不要更改文件，分别委派一名只读子代理', '这部分分别请两个子代理核对']) {
    assert.equal(createCodingTurnPolicy({ text }).allowSubagent, true, text);
  }
  for (const text of ['请别委派子代理', '不要让任何助手，包括子代理，参与审查', '这部分别委派给子代理，主代理自己做', '这部分不要分别委派']) {
    assert.equal(createCodingTurnPolicy({ text }).allowSubagent, false, text);
  }
  assert.equal(createCodingTurnPolicy({ text: '分别并行执行两个分支任务' }).allowFork, true);
  assert.equal(createCodingTurnPolicy({ text: '这部分别并行' }).allowFork, false);
});

test('ordinary coding leaves planning and delegation available without permitting memory writes', () => {
  for (const text of ['继续', '改一个按钮文案', '解释刚才的结果', '修复多个文件并验证']) {
    const policy = createCodingTurnPolicy({ text });
    for (const tool of ['tasks', 'load_skill', 'request_user_input', 'run_subagent', 'fork_task']) {
      assert.equal(isCodingTurnToolAllowed(policy, tool), true, `${text}: ${tool}`);
    }
    assert.equal(isCodingTurnToolAllowed(policy, 'save_memory'), false);
    assert.equal(isCodingTurnToolAllowed(policy, 'land_workers'), false);
    assert.equal(isCodingTurnToolAllowed(policy, 'crew_plan'), false);
    assert.equal(isCodingTurnToolAllowed(policy, 'crew_finish'), false);
    assert.equal(buildCodingTurnPolicyBlock(policy), '');
  }
});

test('explicit delegation restrictions apply independently of task difficulty', () => {
  for (const text of ['不要子代理', "don't use subagents", '不要委派', '不要并行']) {
    assert.equal(createCodingTurnPolicy({ text }).allowSubagent, false, text);
  }
  for (const text of ['不要并行分支', 'do not use forks', '不要委派']) {
    assert.equal(createCodingTurnPolicy({ text }).allowFork, false, text);
  }
});

test('Crew keeps parent restrictions even when the user disables delegation', () => {
  for (const text of ['修复问题', '不要子代理']) {
    const policy = createCodingTurnPolicy({ text, crewActive: true });
    const tools = applyCrewParentToolPolicy(
      ['read', 'edit', 'write', 'run', 'run_subagent', 'fork_task', 'crew_status', 'land_workers']
        .filter((tool) => isCodingTurnToolAllowed(policy, tool)),
      { crewActive: true },
    );
    for (const tool of ['edit', 'write', 'fork_task']) assert.equal(tools.includes(tool), false);
    assert.equal(tools.includes('run_subagent'), text !== '不要子代理');
    assert.match(buildCodingTurnPolicyBlock(policy), /Do not implement in the parent/);
  }
});

test('Crew parent turn allow list includes plan and finish', () => {
  const policy = createCodingTurnPolicy({ text: '给随手记加稍后读', crewActive: true });
  const tools = applyCrewParentToolPolicy(
    EXECUTION_MODE_TOOL_POLICY.plan.filter((toolName) => isCodingTurnToolAllowed(policy, toolName)),
    { crewActive: true },
  );
  assert.equal(tools.includes('crew_plan'), true);
  assert.equal(tools.includes('crew_finish'), true);
  assert.equal(tools.includes('crew_status'), true);
  assert.equal(tools.includes('run_subagent'), true);
  assert.equal(tools.includes('write'), false);
  assert.equal(tools.includes('edit'), false);
});

test('explicit durable memory remains available and secrets remain blocked', () => {
  assert.equal(createCodingTurnPolicy({ text: '请记住，我偏好中文回复' }).allowSaveMemory, true);
  assert.equal(createCodingTurnPolicy({ text: '请记住 API key: sk-1234567890abcdefghijklmnopqrstuvwxyz' }).allowSaveMemory, false);
});
