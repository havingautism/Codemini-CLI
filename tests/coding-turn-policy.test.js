import test from 'node:test';
import assert from 'node:assert/strict';
import { createCodingTurnPolicy, isCodingTurnToolAllowed, buildCodingTurnPolicyBlock } from '../src/core/coding-turn-policy.js';
import { applyCrewParentToolPolicy } from '../src/core/chat-runtime.js';

test('ordinary coding leaves planning and delegation available without permitting memory writes', () => {
  for (const text of ['继续', '改一个按钮文案', '解释刚才的结果', '修复多个文件并验证']) {
    const policy = createCodingTurnPolicy({ text });
    for (const tool of ['tasks', 'load_skill', 'request_user_input', 'run_subagent', 'fork_task']) {
      assert.equal(isCodingTurnToolAllowed(policy, tool), true, `${text}: ${tool}`);
    }
    assert.equal(isCodingTurnToolAllowed(policy, 'save_memory'), false);
    assert.equal(isCodingTurnToolAllowed(policy, 'land_workers'), false);
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

test('explicit durable memory remains available and secrets remain blocked', () => {
  assert.equal(createCodingTurnPolicy({ text: '请记住，我偏好中文回复' }).allowSaveMemory, true);
  assert.equal(createCodingTurnPolicy({ text: '请记住 API key: sk-1234567890abcdefghijklmnopqrstuvwxyz' }).allowSaveMemory, false);
});
