import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPreToolNotice,
  formatPlanApprovalLines,
  formatDeleteApprovalLines,
  injectPlanStateMessage,
  normalizeDeleteApprovalRequest,
  parsePendingPlanApprovalMessage,
  parsePlanExecutionResult,
  parsePlanApprovalAnswer,
  parseDeleteApprovalAnswer,
  parseAutoPlanSummaryMessage,
  parsePlanProgressLine,
  stripPlanExecutionResult
} from '../src/tui/chat-app.js';
import { describeAutoSkillActivity, describeSkillActivity, formatAutoSkillBadge } from '../src/tui/skill-activity/index.js';
import { describeToolActivity } from '../src/tui/tool-activity/index.js';

test('parseAutoPlanSummaryMessage extracts structured fields from auto-plan summary text', () => {
  const parsed = parseAutoPlanSummaryMessage(`
Auto plan finished with warnings (waiting for /plan approve)
Plan File: E:\\repo\\.codemini\\plans\\plan.md
Plan Summary: 创建并执行测试计划
Final Summary: 测试计划已完成审查，但 staging 验证仍待执行。
Approval: pending
Steps: 5 total
Completed: 5
Warnings: 2
Failed: 0
Warning steps: planner:分析现有代码, tester:编写测试用例
  `);

  assert.deepEqual(parsed, {
    statusTitle: 'Auto plan finished with warnings (waiting for /plan approve)',
    filePath: 'E:\\repo\\.codemini\\plans\\plan.md',
    planSummary: '创建并执行测试计划',
    finalSummary: '测试计划已完成审查，但 staging 验证仍待执行。',
    approval: 'pending',
    stepsTotal: '5 total',
    completed: '5',
    warnings: '2',
    failed: '0',
    warningSteps: 'planner:分析现有代码, tester:编写测试用例',
    failedSteps: '',
    planSteps: []
  });
});

test('parseAutoPlanSummaryMessage returns null for non plan-summary system text', () => {
  assert.equal(parseAutoPlanSummaryMessage('Usage: /plan auto <goal>'), null);
});

test('parseAutoPlanSummaryMessage captures plan steps with role and task lines', () => {
  const parsed = parseAutoPlanSummaryMessage(`
Auto plan finished (waiting for /yes)
Plan File: /tmp/.codemini/plans/plan.md
Plan Summary: Improve README
Final Summary: Plan created and waiting for approval before implementation.
Approval: pending
Plan Steps:
  1. [planner] Inspect README structure
     - task: Review sections and identify weak spots
  2. [coder] Draft concrete rewrite suggestions
     - task: Provide prioritized edits with examples
Next: review the plan summary, then use /yes to execute.
  `);

  assert.equal(parsed?.planSteps?.length, 2);
  assert.deepEqual(parsed?.planSteps?.[0], {
    index: 1,
    role: 'planner',
    title: 'Inspect README structure',
    task: 'Review sections and identify weak spots',
    status: 'pending'
  });
  assert.deepEqual(parsed?.planSteps?.[1], {
    index: 2,
    role: 'coder',
    title: 'Draft concrete rewrite suggestions',
    task: 'Provide prioritized edits with examples',
    status: 'pending'
  });
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

test('parsePlanExecutionResult extracts status, verified, and next fields', () => {
  assert.deepEqual(
    parsePlanExecutionResult('Status: done\nVerified: inspected target files and checks\nNext: none'),
    {
      status: 'done',
      verified: 'inspected target files and checks',
      next: 'none'
    }
  );
  assert.equal(parsePlanExecutionResult('普通文本'), null);
});

test('stripPlanExecutionResult removes status lines from assistant text body', () => {
  const source = [
    '问题描述：',
    '- agent-loop.js 中存在同步 JSON 序列化用于 hash 计算',
    '',
    'Status: done',
    'Verified: 完整分析了 src/core/ 下 20+ 核心模块',
    'Next: 如需进一步深挖可以继续说明'
  ].join('\n');

  assert.equal(
    stripPlanExecutionResult(source),
    ['问题描述：', '- agent-loop.js 中存在同步 JSON 序列化用于 hash 计算'].join('\n')
  );
});

test('stripPlanExecutionResult also cleans a body that only contains trailing execution result lines', () => {
  const source = [
    '最值得优先处理的是 #1、#4 和 #7。',
    '',
    'Status: done',
    'Verified: 逐文件审查了 src/core、src/commands、src/tui 关键文件',
    'Next: none - 如需继续实施，可以继续'
  ].join('\n');

  assert.equal(stripPlanExecutionResult(source), '最值得优先处理的是 #1、#4 和 #7。');
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

test('injectPlanStateMessage hides the strip while a plan is waiting for approval', () => {
  const messages = [
    { id: 'user-1', label: 'you', text: '/plan auto 修复天气页' },
    { id: 'system-1', label: 'system', text: 'Auto plan finished (waiting for /plan approve)' }
  ];
  const injected = injectPlanStateMessage(
    messages,
    { current: 1, total: 4, role: 'planner', title: '分析项目', failed: false, steps: [], pendingApproval: true },
    'user-1',
    null
  );

  assert.equal(injected.some((message) => message.planStrip), false);
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
  assert.match(enNotice, /list the contents/i);
});

test('describeToolActivity uses more precise labels for list, glob, and grep', () => {
  const zhCopy = {
    toolActivity: {
      blocked: '工具被拦截',
      doneList: '已列出目录',
      doingList: '正在列出目录',
      doneDelete: '已删除目标',
      doingDelete: '正在等待删除确认',
      doneGlob: '已按模式查找文件',
      doingGlob: '正在按模式查找文件',
      doneGrep: '已搜索关键词',
      doingGrep: '正在搜索关键词',
      doneListBackgroundTasks: '已列出后台任务',
      doingListBackgroundTasks: '正在列出后台任务',
      doneBackgroundTaskStatus: '已查看后台任务',
      doingBackgroundTaskStatus: '正在查看后台任务',
      doneStopBackgroundTask: '已停止后台任务',
      doingStopBackgroundTask: '正在停止后台任务',
      doneProjectIndex: '已初始化项目索引',
      doingProjectIndex: '正在初始化项目索引',
      doneFileIndex: '已刷新文件索引',
      doingFileIndex: '正在刷新文件索引'
    }
  };

  assert.equal(describeToolActivity(zhCopy, 'list(src)', { done: true }), '已列出目录: src');
  assert.equal(describeToolActivity(zhCopy, 'delete(src/old.ts)'), '正在等待删除确认: src/old.ts');
  assert.equal(describeToolActivity(zhCopy, 'glob(src/**/*.ts)'), '正在按模式查找文件: src/**/*.ts');
  assert.equal(describeToolActivity(zhCopy, 'grep(loginUser)'), '正在搜索关键词: loginUser');
  assert.equal(describeToolActivity(zhCopy, 'list_background_tasks', { done: true }), '已列出后台任务: list_background_tasks');
  assert.equal(describeToolActivity(zhCopy, 'get_background_task(task-1)'), '正在查看后台任务: task-1');
  assert.equal(describeToolActivity(zhCopy, 'stop_background_task(task-1)', { done: true }), '已停止后台任务: task-1');
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

test('normalizeDeleteApprovalRequest and formatting support zh/en delete approval copy', () => {
  const request = {
    id: 'delete-1',
    name: 'delete',
    approvalDetails: {
      path: 'src/old.ts',
      name: 'old.ts',
      type: 'file'
    }
  };
  assert.deepEqual(normalizeDeleteApprovalRequest(request), {
    id: 'delete-1',
    toolName: 'delete',
    path: 'src/old.ts',
    name: 'old.ts',
    type: 'file'
  });

  const zhLines = formatDeleteApprovalLines(
    {
      deleteApproval: {
        title: '确认删除？',
        pathLabel: '路径',
        nameLabel: '名称',
        typeLabel: '类型',
        fileType: '文件',
        directoryType: '目录',
        prompt: '输入 yes 确认删除，输入 no 取消。'
      }
    },
    request
  );
  assert.deepEqual(zhLines, [
    '确认删除？',
    '路径: src/old.ts',
    '名称: old.ts',
    '类型: 文件',
    '输入 yes 确认删除，输入 no 取消。'
  ]);

  const enLines = formatDeleteApprovalLines(
    {
      deleteApproval: {
        title: 'Confirm deletion?',
        pathLabel: 'Path',
        nameLabel: 'Name',
        typeLabel: 'Type',
        fileType: 'file',
        directoryType: 'directory',
        prompt: 'Type yes to delete, or no to cancel.'
      }
    },
    request
  );
  assert.deepEqual(enLines, [
    'Confirm deletion?',
    'Path: src/old.ts',
    'Name: old.ts',
    'Type: file',
    'Type yes to delete, or no to cancel.'
  ]);
});

test('formatDeleteApprovalLines prefixes root-level files with ./ for clarity', () => {
  const lines = formatDeleteApprovalLines(
    {
      deleteApproval: {
        title: '确认删除？',
        pathLabel: '路径',
        nameLabel: '名称',
        typeLabel: '类型',
        fileType: '文件',
        directoryType: '目录',
        prompt: '输入 yes 确认删除，输入 no 取消。'
      }
    },
    {
      id: 'delete-root',
      name: 'delete',
      approvalDetails: {
        path: 'TEST_RELIABILITY_PLAN.md',
        name: 'TEST_RELIABILITY_PLAN.md',
        type: 'file'
      }
    }
  );

  assert.equal(lines[1], '路径: ./TEST_RELIABILITY_PLAN.md');
});

test('parseDeleteApprovalAnswer accepts only yes and no', () => {
  assert.equal(parseDeleteApprovalAnswer('yes'), 'approve');
  assert.equal(parseDeleteApprovalAnswer('  no  '), 'deny');
  assert.equal(parseDeleteApprovalAnswer('maybe'), 'invalid');
  assert.equal(parseDeleteApprovalAnswer(''), 'empty');
});

test('parsePlanApprovalAnswer accepts /yes, /reject, and /edit with feedback', () => {
  assert.deepEqual(parsePlanApprovalAnswer('/yes'), { action: 'approve', command: '/yes' });
  assert.deepEqual(parsePlanApprovalAnswer('reject'), { action: 'reject', command: '/reject' });
  assert.deepEqual(parsePlanApprovalAnswer('/edit tighten step 2'), {
    action: 'edit',
    feedback: 'tighten step 2',
    command: '/edit tighten step 2'
  });
  assert.deepEqual(parsePlanApprovalAnswer('/edit'), { action: 'missing_feedback', command: '' });
  assert.deepEqual(parsePlanApprovalAnswer('maybe'), { action: 'invalid', command: '' });
  assert.deepEqual(parsePlanApprovalAnswer(''), { action: 'empty', command: '' });
});

test('parsePendingPlanApprovalMessage extracts goal, summary, and file path', () => {
  const parsed = parsePendingPlanApprovalMessage(
    [
      'Plan approval is still pending.',
      'Goal: Improve README',
      'Plan File: /tmp/.codemini/plans/plan.md',
      'Summary: Focus on structure and examples',
      'Use /yes to execute this plan, /edit <feedback> to revise it, or /reject to discard it.'
    ].join('\n')
  );
  assert.deepEqual(parsed, {
    goal: 'Improve README',
    summary: 'Focus on structure and examples',
    filePath: '/tmp/.codemini/plans/plan.md'
  });
  assert.equal(parsePendingPlanApprovalMessage('random message'), null);
});

test('formatPlanApprovalLines keeps the plan approval panel concise', () => {
  const lines = formatPlanApprovalLines(
    {
      planApproval: {
        title: '确认执行计划？',
        goalLabel: '目标',
        summaryLabel: '摘要',
        fileLabel: '文件',
        prompt: '输入 /yes 执行，输入 /edit <反馈> 修改，输入 /reject 拒绝。'
      }
    },
    {
      goal: '审查当前 README 内容与项目结构',
      summary: 'Plan created and waiting for approval before implementation.',
      filePath: '/tmp/.codemini/plans/plan.md'
    }
  );

  assert.deepEqual(lines, ['确认执行计划？']);
});
