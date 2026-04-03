import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPreToolNotice,
  injectPlanStateMessage,
  parseAutoPlanSummaryMessage,
  parsePlanProgressLine
} from '../src/tui/chat-app.js';
import { describeAutoSkillActivity, describeSkillActivity, formatAutoSkillBadge } from '../src/tui/skill-activity/index.js';
import { describeToolActivity } from '../src/tui/tool-activity/index.js';

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

test('describeToolActivity uses more precise labels for list, glob, and grep', () => {
  const zhCopy = {
    toolActivity: {
      blocked: '工具被拦截',
      doneList: '已列出目录',
      doingList: '正在列出目录',
      doneGlob: '已按模式查找文件',
      doingGlob: '正在按模式查找文件',
      doneGrep: '已搜索关键词',
      doingGrep: '正在搜索关键词',
      doneListServices: '已列出服务',
      doingListServices: '正在列出服务',
      doneServiceStatus: '已查看服务状态',
      doingServiceStatus: '正在查看服务状态',
      doneServiceLogs: '已查看服务日志',
      doingServiceLogs: '正在查看服务日志',
      doneStopService: '已停止服务',
      doingStopService: '正在停止服务',
      doneProjectIndex: '已初始化项目索引',
      doingProjectIndex: '正在初始化项目索引',
      doneFileIndex: '已刷新文件索引',
      doingFileIndex: '正在刷新文件索引'
    }
  };

  assert.equal(describeToolActivity(zhCopy, 'list(src)', { done: true }), '已列出目录: src');
  assert.equal(describeToolActivity(zhCopy, 'glob(src/**/*.ts)'), '正在按模式查找文件: src/**/*.ts');
  assert.equal(describeToolActivity(zhCopy, 'grep(loginUser)'), '正在搜索关键词: loginUser');
  assert.equal(describeToolActivity(zhCopy, 'list_services', { done: true }), '已列出服务: list_services');
  assert.equal(describeToolActivity(zhCopy, 'get_service_status(task-1)'), '正在查看服务状态: task-1');
  assert.equal(describeToolActivity(zhCopy, 'get_service_logs(task-1)'), '正在查看服务日志: task-1');
  assert.equal(describeToolActivity(zhCopy, 'stop_service(task-1)', { done: true }), '已停止服务: task-1');
  assert.equal(describeToolActivity(zhCopy, 'project_index', { done: true }), '已初始化项目索引');
  assert.equal(describeToolActivity(zhCopy, 'file_index(src/app.ts)'), '正在刷新文件索引: src/app.ts');
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
