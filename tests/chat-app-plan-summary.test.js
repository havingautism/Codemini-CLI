import test from 'node:test';
import assert from 'node:assert/strict';

import {
  injectPlanStateMessage,
  parseAutoPlanSummaryMessage,
  parsePlanProgressLine
} from '../src/tui/chat-app.js';

test('parseAutoPlanSummaryMessage extracts structured fields from auto-plan summary text', () => {
  const parsed = parseAutoPlanSummaryMessage(`
Auto plan finished with warnings
File: E:\\repo\\.codemini\\plans\\plan.md
Plan Summary: 创建并执行测试计划
Final Summary: 测试计划已完成审查，但 staging 验证仍待执行。
Steps: 5 total
Completed: 5
Warnings: 2
Failed: 0
Warning steps: planner:分析现有代码, tester:编写测试用例
  `);

  assert.deepEqual(parsed, {
    statusTitle: 'Auto plan finished with warnings',
    filePath: 'E:\\repo\\.codemini\\plans\\plan.md',
    planSummary: '创建并执行测试计划',
    finalSummary: '测试计划已完成审查，但 staging 验证仍待执行。',
    stepsTotal: '5 total',
    completed: '5',
    warnings: '2',
    failed: '0',
    warningSteps: 'planner:分析现有代码, tester:编写测试用例',
    failedSteps: ''
  });
});

test('parseAutoPlanSummaryMessage returns null for non plan-summary system text', () => {
  assert.equal(parseAutoPlanSummaryMessage('Usage: /plan auto <goal>'), null);
});

test('parsePlanProgressLine extracts plan step metadata from streamed text', () => {
  assert.deepEqual(parsePlanProgressLine('[plan] Step 2/5 -> tester: 运行天气页面测试'), {
    current: 2,
    total: 5,
    role: 'tester',
    title: '运行天气页面测试'
  });
  assert.equal(parsePlanProgressLine('普通文本'), null);
});

test('injectPlanStateMessage anchors plan strip after the active user message', () => {
  const messages = [
    { id: 'sys-1', label: 'system', text: 'startup' },
    { id: 'user-1', label: 'you', text: '/plan auto 修复天气页' },
    { id: 'coder-1', label: 'coder', text: '我先检查一下项目结构。' }
  ];
  const injected = injectPlanStateMessage(
    messages,
    { current: 1, total: 5, role: 'planner', title: '分析项目', failed: false, steps: [] },
    'user-1',
    'coder-1'
  );

  assert.equal(injected[1].id, 'user-1');
  assert.equal(injected[2].planStrip, true);
  assert.equal(injected[3].id, 'coder-1');
});
