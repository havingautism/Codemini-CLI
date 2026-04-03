import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPreToolNotice,
  injectPlanStateMessage,
  parseAutoPlanSummaryMessage,
  parsePlanProgressLine
} from '../src/tui/chat-app.js';
import { describeAutoSkillActivity, describeSkillActivity, formatAutoSkillBadge } from '../src/tui/skill-activity/index.js';

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

test('buildPreToolNotice gives the user a visible pre-tool progress hint', () => {
  const zhNotice = buildPreToolNotice('read(src/auth.ts)', {
    roleLabels: { you: '你', coder: 'CODER' },
    toolActivity: { doingRead: '正在读取文件', doingList: '正在查看目录', doingCommand: '正在执行命令' }
  });
  assert.match(zhNotice, /我先/);
  assert.match(zhNotice, /src\/auth\.ts|文件/);

  const enNotice = buildPreToolNotice('list(src)', {
    roleLabels: { you: 'YOU', coder: 'CODER' },
    toolActivity: { doingRead: 'Reading file', doingList: 'Inspecting directory', doingCommand: 'Running command' }
  });
  assert.match(enNotice, /I'll/i);
  assert.match(enNotice, /directory/i);
});

test('skill activity helpers produce concise skill status text', () => {
  const zhCopy = {
    runtime: { skillFailed: '技能执行失败', autoSkillInjected: (names) => `自动启用技能: ${names.map((name) => `/${name}`).join(', ')}` },
    toolActivity: { doingSkill: '正在执行技能', doneSkill: '已完成技能' },
    roleLabels: { system: '系统' }
  };
  assert.equal(describeSkillActivity(zhCopy, 'brainstorm'), '正在执行技能: /brainstorm');
  assert.equal(describeSkillActivity(zhCopy, 'brainstorm', { done: true }), '已完成技能: /brainstorm');
  assert.equal(describeAutoSkillActivity(zhCopy, ['superpowers-lite', 'brainstorm']), '自动启用技能: /superpowers-lite, /brainstorm');
  assert.equal(formatAutoSkillBadge(zhCopy, ['superpowers-lite', 'brainstorm']), '自动 /superpowers-lite +1');

  const enCopy = {
    runtime: { skillFailed: 'skill failed', autoSkillInjected: (names) => `auto-enabled skills: ${names.map((name) => `/${name}`).join(', ')}` },
    toolActivity: { doingSkill: 'running skill', doneSkill: 'completed skill' },
    roleLabels: { system: 'SYSTEM' }
  };
  assert.equal(formatAutoSkillBadge(enCopy, ['superpowers-lite']), 'AUTO /superpowers-lite');
});
