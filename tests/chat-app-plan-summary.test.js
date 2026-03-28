import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAutoPlanSummaryMessage } from '../src/tui/chat-app.js';

test('parseAutoPlanSummaryMessage extracts structured fields from auto-plan summary text', () => {
  const parsed = parseAutoPlanSummaryMessage(`
Auto plan finished with warnings
File: E:\\repo\\.coder\\plans\\plan.md
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
    filePath: 'E:\\repo\\.coder\\plans\\plan.md',
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
