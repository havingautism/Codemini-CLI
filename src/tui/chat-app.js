import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { shouldCaptureEscapeSequence } from './input-escape.js';
import { classifyCommandIntent } from '../core/shell.js';
import { formatToolLabel } from '../core/tool-display.js';
import {
  buildInterToolNotice as buildRegisteredInterToolNotice,
  buildPreToolNotice as buildRegisteredPreToolNotice,
  buildSyntheticCompletionText as buildRegisteredSyntheticCompletionText
} from './tool-narration.js';
import {
  describeToolActivity as describeRegisteredToolActivity,
  isCodeGenerationActivityName
} from './tool-activity/index.js';
import {
  describeAutoSkillActivity as describeRegisteredAutoSkillActivity,
  describeSkillActivity as describeRegisteredSkillActivity,
  formatAutoSkillBadge as formatRegisteredAutoSkillBadge
} from './skill-activity/index.js';

const h = React.createElement;
const SUGGESTION_PAGE_SIZE = 8;
const BANNER = [
  ' ██████  ██████  ██████  ███████ ███    ███ ██ ███    ██ ██ ',
  '██      ██    ██ ██   ██ ██      ████  ████ ██ ████   ██ ██ ',
  '██      ██    ██ ██   ██ █████   ██ ████ ██ ██ ██ ██  ██ ██ ',
  '██      ██    ██ ██   ██ ██      ██  ██  ██ ██ ██  ██ ██ ██ ',
  ' ██████  ██████  ██████  ███████ ██      ██ ██ ██   ████ ██ '
];
const BANNER_COLORS = ['magentaBright', 'redBright', 'yellowBright', 'cyanBright', 'magentaBright'];
const SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
const ROLE_STYLES = {
  you: {
    accent: 'blueBright',
    border: 'blue',
    text: 'white',
    badgeBg: 'blue',
    badgeText: 'white',
    chrome: 'gray'
  },
  coder: {
    accent: 'greenBright',
    border: 'cyan',
    text: 'greenBright',
    badgeBg: 'cyan',
    badgeText: 'black',
    chrome: 'gray'
  },
  general: {
    accent: 'greenBright',
    border: 'green',
    text: 'greenBright',
    badgeBg: 'green',
    badgeText: 'black',
    chrome: 'gray'
  },
  advisor: {
    accent: 'blueBright',
    border: 'blue',
    text: 'blueBright',
    badgeBg: 'blue',
    badgeText: 'white',
    chrome: 'gray'
  },
  planner: {
    accent: 'magentaBright',
    border: 'magenta',
    text: 'magentaBright',
    badgeBg: 'magenta',
    badgeText: 'white',
    chrome: 'gray'
  },
  reviewer: {
    accent: 'yellowBright',
    border: 'yellow',
    text: 'yellowBright',
    badgeBg: 'yellow',
    badgeText: 'black',
    chrome: 'gray'
  },
  tester: {
    accent: 'blueBright',
    border: 'blue',
    text: 'blueBright',
    badgeBg: 'blue',
    badgeText: 'white',
    chrome: 'gray'
  },
  summarizer: {
    accent: 'cyanBright',
    border: 'cyan',
    text: 'cyanBright',
    badgeBg: 'cyan',
    badgeText: 'black',
    chrome: 'gray'
  },
  system: {
    accent: 'yellowBright',
    border: 'yellow',
    text: 'yellowBright',
    badgeBg: 'yellow',
    badgeText: 'black',
    chrome: 'gray'
  },
  error: {
    accent: 'redBright',
    border: 'red',
    text: 'redBright',
    badgeBg: 'red',
    badgeText: 'white',
    chrome: 'gray'
  },
  pending: {
    accent: 'cyanBright',
    border: 'cyan',
    text: 'cyanBright',
    badgeBg: 'cyan',
    badgeText: 'black',
    chrome: 'gray'
  }
};

const TUI_COPY = {
  zh: {
    roleLabels: { you: '👤 你', general: 'GENERAL', advisor: '💡 ADVISOR', coder: '💻 CODER', planner: '📋 PLANNER', reviewer: '🔍 REVIEWER', tester: '🧪 TESTER', summarizer: '📝 SUMMARIZER', system: '⚙️ 系统', error: '❌ 错误', pending: '⏳ 等待中' },
    generic: {
      waitingForInput: '等待输入',
      ready: '就绪',
      noMessagesYet: '还没有消息',
      taskCompleted: '已完成任务',
      code: '代码',
      codeActivity: '代码活动',
      textNotes: '说明文本',
      live: '运行中',
      idle: '空闲',
      plan: '计划',
      active: '进行中',
      attention: '注意',
      model: '模型',
      mode: '模式',
      session: '会话',
      internalCockpit: '内部编码控制台',
      commandBar: '命令栏',
      safeMode: '安全模式',
      queued: '排队',
      tools: '工具',
      open: '展开',
      collapsed: '收起',
      pendingQueue: '等待队列',
      commandPaletteGroupedSelect: '命令面板 | 分组选择模式',
      commandPaletteGroupedSuggestions: '命令面板 | 分组候选',
      startupHints: [
        '🧭 使用 /help 可查看命令帮助。Tab 可自动补全 slash 命令。',
        '📋 试试用 /mode code 切换编码模式，让 AI 自动规划并执行复杂任务。',
        '⏫ 使用 ↑↓ 键可以浏览历史输入，快速重复之前的操作。',
        '🐚 输入 !<shell命令> 可以直接执行本地终端命令，如 !ls、!git status。',
        '🔧 Ctrl+T 可以切换工具调用详情的展开/收起状态。',
        '📊 试试 /status 查看当前会话模式、模型和 token 用量。',
        '🧩 用 /mode code 切换到编码模式，让 AI 面向代码任务工作，需要时再出方案。',
        '🆕 /new 可以新建一个干净的会话，重新开始工作。',
        '🧠 /memory 查看和管理 AI 的持久记忆，帮助它更好地理解你的偏好。',
        '🌐 web_fetch 默认轻量读取网页；如需更好读取 JS 渲染页面，可运行 npm install -g playwright && playwright install chromium。',
        '💤 Codemini 会自动"做梦"休息，整理错误信息并自我优化，越用越聪明~'
      ],
      toolSummaryExpanded: '工具摘要：已展开',
      toolSummaryCollapsed: '工具摘要：已收起',
      toolChainCollapsed: (count) => `已折叠更早的 ${count} 个工具调用`,
      toggleToolSummary: 'Ctrl+T 切换',
      scrollHint: '使用终端自己的滚动条或 scrollback',
      keyboardDebugEnabled: '键盘调试已开启',
      keyboardDebugDisabled: '键盘调试已关闭',
      keyboardDebugStatus: (on) => `键盘调试当前${on ? '开启' : '关闭'}`,
      debugKeys: (value) => `按键调试：${value || '（无）'}`
    },
    stageTags: {
      sending: '发送中',
      thinking: '思考中',
      streaming: '输出中',
      tooling: '工具中',
      running: '运行中',
      idle: '空闲'
    },
    toolActivity: {
      blocked: '工具被拦截',
      doneRead: '已读取文件',
      doingRead: '正在读取文件',
      doneEdit: '已编辑文件',
      doingEdit: '正在编辑文件',
      doneWrite: '已写入文件',
      doingWrite: '正在写入文件',
      doneDelete: '已删除目标',
      doingDelete: '正在等待删除确认',
      donePatch: '已应用补丁',
      doingPatch: '正在应用补丁',
      doneList: '已列出目录',
      doingList: '正在列出目录',
      doneGlob: '已按模式查找文件',
      doingGlob: '正在按模式查找文件',
      doneGrep: '已搜索关键词',
      doingGrep: '正在搜索关键词',
      doneWebFetch: '已抓取网页',
      doingWebFetch: '正在抓取网页',
      doneWebSearch: '已搜索网页',
      doingWebSearch: '正在搜索网页',
      doneCommand: '已执行命令',
      doingCommand: '正在执行命令',
      doneUpdateTodos: '已更新待办',
      doingUpdateTodos: '正在更新待办',
      doneGeneric: '已完成工具',
      doingGeneric: '正在执行工具',
      doneInstall: '已安装依赖',
      doingInstall: '正在安装依赖',
      doneBuild: '已完成构建',
      doingBuild: '正在构建',
      doneTest: '已完成测试',
      doingTest: '正在运行测试',
      doneFrontend: '已启动前端服务',
      doingFrontend: '正在启动前端服务',
      doneBackend: '已启动后端服务',
      doingBackend: '正在启动后端服务',
      doneDatabase: '已启动数据库服务',
      doingDatabase: '正在启动数据库服务',
      doneDocker: '已完成 Docker 命令',
      doingDocker: '正在执行 Docker 命令',
      doneListBackgroundTasks: '已列出后台任务',
      doingListBackgroundTasks: '正在列出后台任务',
      doneBackgroundTaskStatus: '已查看后台任务',
      doingBackgroundTaskStatus: '正在查看后台任务',
      doneStopBackgroundTask: '已停止后台任务',
      doingStopBackgroundTask: '正在停止后台任务',
      doneCodeGeneration: '已生成代码',
      doingCodeGeneration: '正在生成代码',
      doneSkill: '已完成技能',
      doingSkill: '正在执行技能',
      doneProjectIndex: '已初始化项目索引',
      doingProjectIndex: '正在初始化项目索引',
      doneFileIndex: '已刷新文件索引',
      doingFileIndex: '正在刷新文件索引',
      donePromptBudget: '已测量 Prompt 预算',
      doingPromptBudget: '正在测量 Prompt 预算',
      toolFailed: (name) => `工具执行失败: ${name}`,
      waitingModelContinue: (detail) => `${detail}，等待模型继续`,
      waitingModelAdjust: (detail) => `${detail}，等待模型调整`
    },
    suggestion: {
      singleTab: 'Tab 补全当前命令',
      navFill: 'Tab 保持切换模式，↑↓选择，←→翻页，Enter 填入',
      navEnter: 'Tab 进入切换模式，再用 ↑↓ 选择，←→翻页',
      noSuggestions: '/ 查看命令，Tab 自动补全，↑↓ 历史，Ctrl+T 展开工具',
      oneNav: 'Tab 或 Enter 填入当前命令，↑↓ 历史',
      oneIdle: 'Tab 补全当前唯一候选，Enter 直接发送，↑↓ 历史',
      manyNav: (count) => `Tab 切换候选，↑↓选择，←→翻页，Enter 填入 (${count} 项)`,
      manyIdle: (count) => `Tab 进入候选切换 (${count} 项)，↑↓ 历史，←→翻页`
    },
    runtime: {
      sendingToGateway: '正在发送到网关',
      preparingRequest: '准备本轮请求',
      submittedWaiting: '已提交，等待开始处理',
      modelThinking: '模型正在思考',
      requestDelivered: '请求已送达，等待首个 token',
      generatingReply: '正在生成回复',
      generatingCode: '正在生成代码中',
      streamingReply: '回复正在流式输出',
      replyCompleted: '回复已完成',
      outputFinished: '本轮输出结束',
      toolRunning: '工具执行中',
      toolCompleted: '工具已完成',
      toolBlocked: '工具被拦截',
      toolFailed: '工具执行失败',
      skillRunning: '技能执行中',
      skillCompleted: '技能已完成',
      skillFailed: '技能执行失败',
      alwaysSkillLoaded: (names) => `始终加载技能: ${names.map((name) => `/${name}`).join(', ')}`,
      autoSkillInjected: (names) => `始终加载技能: ${names.map((name) => `/${name}`).join(', ')}`,
      contextLabel: '上下文',
      compactingContext: '正在压缩上下文',
      autoCompactTriggered: (mode, threshold) => `自动压缩已触发（${mode}，阈值 ${threshold}%）`,
      requestFailed: '请求失败',
      responseStopped: '回答已中止',
      localCommandRunning: '正在执行本地命令',
      queuedWaiting: '排队中，等待上一轮完成',
      idleReady: '等待输入',
      idleReadyDetail: '就绪',
      idleAfterTurn: '空闲',
      idleAfterTurnDetail: '等待下一轮输入',
      dreamAutoTriggered: '瞌睡虫来了…自动整理记忆中，请稍等',
      dreamRunning: '💤 打瞌睡中，请稍等…',
      dreamCompleted: '✨ 做了一个好梦，记忆已整理',
      dreamIdle: '💤'
    },
    deleteApproval: {
      title: '确认删除？',
      pathLabel: '路径',
      nameLabel: '名称',
      typeLabel: '类型',
      fileType: '文件',
      directoryType: '目录',
      prompt: '输入 yes 确认删除，输入 no 取消。',
      invalidAnswer: '请输入 yes 或 no。',
      inputLocked: '删除确认进行中，请输入 yes 或 no',
      answerLabel: '确认输入（yes/no）',
      answerPlaceholder: 'yes 或 no'
    },
    runApproval: {
      title: '确认执行命令？',
      commandLabel: '命令',
      riskLabel: '风险等级',
      descriptionLabel: '说明',
      sideEffectsLabel: '副作用',
      lowRisk: '低',
      mediumRisk: '中',
      highRisk: '高',
      prompt: '输入 yes 执行，输入 no 取消。',
      invalidAnswer: '请输入 yes 或 no。',
      inputLocked: '命令审批进行中，请输入 yes 或 no',
      answerLabel: '审批输入（yes/no）',
      answerPlaceholder: 'yes 或 no'
    },
    fileApproval: {
      title: '确认文件变更？',
      toolLabel: '工具',
      pathLabel: '路径',
      actionLabel: '操作',
      prompt: '输入 yes 执行，输入 no 取消。',
      invalidAnswer: '请输入 yes 或 no。',
      inputLocked: '文件变更确认中；输入 yes 或 no',
      answerLabel: '确认输入 (yes/no)',
      answerPlaceholder: 'yes 或 no'
    },
    fileChangeSummary: {
      title: '文件改动',
      fileLabel: '文件',
      statusLabel: '状态',
      editStatus: '编辑',
      createStatus: '新建',
      deleteStatus: '删除',
      changesLabel: '改动'
    },
    specApproval: {
      title: '审阅工程 Spec？',
      goalLabel: '目标',
      summaryLabel: '摘要',
      fileLabel: '文件',
      missingLabel: '缺失章节',
      prompt: '输入 /yes 生成并执行计划，/spec execute 直接执行，/spec save 仅保存，/edit <反馈> 修改，或 /reject 拒绝。',
      invalidAnswer: '请输入 /yes、/spec execute、/spec save、/edit <反馈> 或 /reject。',
      missingFeedback: '请在 /edit 后提供反馈内容。',
      inputLocked: 'Spec 审阅进行中，请在审阅框输入 /yes、/spec execute、/spec save、/edit 或 /reject',
      answerLabel: '审阅输入',
      answerPlaceholder: '/yes | /spec execute | /spec save | /edit <反馈> | /reject'
    },
    reflectApproval: {
      title: '审阅 Reflect 技能草稿？',
      scopeLabel: '范围',
      nameLabel: '名称',
      targetLabel: '目标',
      prompt: '输入 /yes 写入，输入 /edit <反馈> 修改，输入 /no 丢弃。',
      invalidAnswer: '请输入 /yes、/edit <反馈> 或 /no。',
      missingFeedback: '请在 /edit 后提供反馈内容。',
      inputLocked: 'Reflect 审阅进行中，请在审阅框输入 /yes、/edit 或 /no',
      answerLabel: '审阅输入',
      answerPlaceholder: '/yes | /edit <反馈> | /no'
    }
  },
  en: {
    roleLabels: { you: 'YOU', general: 'GENERAL', advisor: 'ADVISOR', coder: 'CODER', planner: 'PLANNER', reviewer: 'REVIEWER', tester: 'TESTER', summarizer: 'SUMMARIZER', system: 'SYSTEM', error: 'ERROR', pending: 'PENDING' },
    generic: {
      waitingForInput: 'waiting for input',
      ready: 'ready',
      noMessagesYet: 'No messages yet',
      taskCompleted: 'Task completed',
      code: 'code',
      codeActivity: 'CODE ACTIVITY',
      textNotes: 'NOTES',
      live: 'LIVE',
      idle: 'IDLE',
      plan: 'PLAN',
      active: 'ACTIVE',
      attention: 'ATTENTION',
      model: 'MODEL',
      mode: 'MODE',
      session: 'SESSION',
      internalCockpit: 'internal coding cockpit',
      commandBar: 'COMMAND BAR',
      safeMode: 'SAFE MODE',
      queued: 'QUEUED',
      tools: 'TOOLS',
      open: 'OPEN',
      collapsed: 'COLLAPSED',
      pendingQueue: 'pending queue',
      commandPaletteGroupedSelect: 'command palette | grouped select mode',
      commandPaletteGroupedSuggestions: 'command palette | grouped suggestions',
      startupHints: [
        '🧭 Use /help to view command help. Tab for slash autocomplete.',
        '📋 Try /mode code for coding mode — the AI can plan and execute complex tasks automatically.',
        '⏫ Use ↑↓ arrow keys to browse input history and repeat previous actions.',
        '🐚 Type !<shell command> to run local terminal commands, e.g. !ls, !git status.',
        '🔧 Ctrl+T toggles tool call detail expansion/collapse.',
        '📊 Try /status to check current session mode, model, and token usage.',
        '🧩 Use /mode code to switch to coding mode — AI works on code tasks and plans only when useful.',
        '🆕 /new starts a fresh session to begin a clean slate.',
        '🧠 /memory lets you view and manage the AI\'s persistent memory for better personalization.',
        '🌐 web_fetch uses a lightweight reader by default. For better JS-rendered pages: npm install -g playwright && playwright install chromium.',
        '💤 Codemini auto-"dreams" to rest, consolidate errors, and self-optimize — it gets smarter over time~'
      ],
      toolSummaryExpanded: 'Tool summary: expanded',
      toolSummaryCollapsed: 'Tool summary: collapsed',
      toolChainCollapsed: (count) => `${count} earlier tool calls hidden`,
      toggleToolSummary: 'Ctrl+T to toggle',
      scrollHint: 'Scroll with your terminal scrollbar or scrollback',
      keyboardDebugEnabled: 'Keyboard debug enabled',
      keyboardDebugDisabled: 'Keyboard debug disabled',
      keyboardDebugStatus: (on) => `Keyboard debug is ${on ? 'ON' : 'OFF'}`,
      debugKeys: (value) => `debug keys: ${value || '(none)'}`
    },
    stageTags: {
      sending: 'SENDING',
      thinking: 'THINKING',
      streaming: 'STREAMING',
      tooling: 'TOOLING',
      running: 'RUNNING',
      idle: 'IDLE'
    },
    toolActivity: {
      blocked: 'Tool blocked',
      doneRead: 'Read file',
      doingRead: 'Reading file',
      doneEdit: 'Edited file',
      doingEdit: 'Editing file',
      doneWrite: 'Wrote file',
      doingWrite: 'Writing file',
      doneDelete: 'Deleted target',
      doingDelete: 'Waiting for delete approval',
      donePatch: 'Applied patch',
      doingPatch: 'Applying patch',
      doneList: 'Listed directory',
      doingList: 'Listing directory',
      doneGlob: 'Matched files by pattern',
      doingGlob: 'Matching files by pattern',
      doneGrep: 'Searched keywords',
      doingGrep: 'Searching keywords',
      doneWebFetch: 'Fetched page',
      doingWebFetch: 'Fetching page',
      doneWebSearch: 'Searched web',
      doingWebSearch: 'Searching web',
      doneCommand: 'Ran command',
      doingCommand: 'Running command',
      doneUpdateTodos: 'Updated todos',
      doingUpdateTodos: 'Updating todos',
      doneGeneric: 'Completed tool',
      doingGeneric: 'Running tool',
      doneInstall: 'Dependencies installed',
      doingInstall: 'Installing dependencies',
      doneBuild: 'Build completed',
      doingBuild: 'Building',
      doneTest: 'Tests completed',
      doingTest: 'Running tests',
      doneFrontend: 'Frontend started',
      doingFrontend: 'Starting frontend service',
      doneBackend: 'Backend started',
      doingBackend: 'Starting backend service',
      doneDatabase: 'Database started',
      doingDatabase: 'Starting database service',
      doneDocker: 'Docker command completed',
      doingDocker: 'Running Docker command',
      doneListBackgroundTasks: 'Listed background tasks',
      doingListBackgroundTasks: 'Listing background tasks',
      doneBackgroundTaskStatus: 'Checked background task',
      doingBackgroundTaskStatus: 'Checking background task',
      doneStopBackgroundTask: 'Stopped background task',
      doingStopBackgroundTask: 'Stopping background task',
      doneCodeGeneration: 'Code generated',
      doingCodeGeneration: 'Generating code',
      doneSkill: 'Completed skill',
      doingSkill: 'Running skill',
      doneProjectIndex: 'Project index initialized',
      doingProjectIndex: 'Initializing project index',
      doneFileIndex: 'File index refreshed',
      doingFileIndex: 'Refreshing file index',
      donePromptBudget: 'Prompt budget measured',
      doingPromptBudget: 'Measuring prompt budget',
      toolFailed: (name) => `Tool failed: ${name}`,
      waitingModelContinue: (detail) => `${detail}, waiting for model to continue`,
      waitingModelAdjust: (detail) => `${detail}, waiting for model to adjust`
    },
    suggestion: {
      singleTab: 'Tab completes the current command',
      navFill: 'Tab stays in pick mode, ↑↓ select, ←→ page, Enter applies',
      navEnter: 'Tab enters pick mode, then use ↑↓ to choose, ←→ page',
      noSuggestions: '/ shows commands, Tab autocompletes, ↑↓ history, Ctrl+T tools',
      oneNav: 'Tab or Enter applies the current command, ↑↓ history',
      oneIdle: 'Tab completes the only candidate, Enter sends, ↑↓ history',
      manyNav: (count) => `Tab cycles candidates, ↑↓ select, ←→ page, Enter applies (${count} items)`,
      manyIdle: (count) => `Tab enters candidate mode (${count} items), ↑↓ history, ←→ page`
    },
    runtime: {
      sendingToGateway: 'sending to gateway',
      preparingRequest: 'preparing this turn',
      submittedWaiting: 'submitted, waiting to start',
      modelThinking: 'model is thinking',
      requestDelivered: 'request sent, waiting for first token',
      generatingReply: 'generating reply',
      generatingCode: 'generating code',
      streamingReply: 'reply is streaming',
      replyCompleted: 'reply completed',
      outputFinished: 'turn output finished',
      toolRunning: 'tool running',
      toolCompleted: 'tool completed',
      toolBlocked: 'tool blocked',
      toolFailed: 'tool failed',
      skillRunning: 'skill running',
      skillCompleted: 'skill completed',
      skillFailed: 'skill failed',
      alwaysSkillLoaded: (names) => `always-loaded skills: ${names.map((name) => `/${name}`).join(', ')}`,
      autoSkillInjected: (names) => `always-loaded skills: ${names.map((name) => `/${name}`).join(', ')}`,
      contextLabel: 'Context',
      compactingContext: 'compacting context',
      autoCompactTriggered: (mode, threshold) => `auto-compact triggered (${mode}, threshold ${threshold}%)`,
      requestFailed: 'request failed',
      responseStopped: 'Response stopped',
      localCommandRunning: 'running local command',
      queuedWaiting: 'queued, waiting for current turn',
      idleReady: 'waiting for input',
      idleReadyDetail: 'ready',
      idleAfterTurn: 'idle',
      idleAfterTurnDetail: 'ready for next input',
      dreamAutoTriggered: 'Getting sleepy... auto-consolidating memory, please wait',
      dreamRunning: '💤 Dreaming... please wait',
      dreamCompleted: '✨ Had a good dream, memory consolidated',
      dreamIdle: '💤'
    },
    deleteApproval: {
      title: 'Confirm deletion?',
      pathLabel: 'Path',
      nameLabel: 'Name',
      typeLabel: 'Type',
      fileType: 'file',
      directoryType: 'directory',
      prompt: 'Type yes to delete, or no to cancel.',
      invalidAnswer: 'Please enter yes or no.',
      inputLocked: 'Delete approval is active; type yes or no',
      answerLabel: 'Approval input (yes/no)',
      answerPlaceholder: 'yes or no'
    },
    runApproval: {
      title: 'Confirm command execution?',
      commandLabel: 'Command',
      riskLabel: 'Risk Level',
      descriptionLabel: 'Description',
      sideEffectsLabel: 'Side Effects',
      lowRisk: 'Low',
      mediumRisk: 'Medium',
      highRisk: 'High',
      prompt: 'Type yes to execute, or no to cancel.',
      invalidAnswer: 'Please enter yes or no.',
      inputLocked: 'Command approval is active; type yes or no',
      answerLabel: 'Approval input (yes/no)',
      answerPlaceholder: 'yes or no'
    },
    fileApproval: {
      title: 'Confirm file change?',
      toolLabel: 'Tool',
      pathLabel: 'Path',
      actionLabel: 'Action',
      prompt: 'Type yes to apply, or no to cancel.',
      invalidAnswer: 'Please enter yes or no.',
      inputLocked: 'File change approval is active; type yes or no',
      answerLabel: 'Approval input (yes/no)',
      answerPlaceholder: 'yes or no'
    },
    fileChangeSummary: {
      title: 'File Changes',
      fileLabel: 'File',
      statusLabel: 'Status',
      editStatus: 'Edit',
      createStatus: 'Create',
      deleteStatus: 'Delete',
      changesLabel: 'Changes'
    },
    specApproval: {
      title: 'Review this engineering spec?',
      goalLabel: 'Goal',
      summaryLabel: 'Summary',
      fileLabel: 'File',
      missingLabel: 'Missing sections',
      prompt: 'Type /yes to plan and execute, /spec execute to execute directly, /spec save to save only, /edit <feedback> to revise, or /reject to discard.',
      invalidAnswer: 'Please enter /yes, /spec execute, /spec save, /edit <feedback>, or /reject.',
      missingFeedback: 'Please provide feedback after /edit.',
      inputLocked: 'Spec review is active; type /yes, /spec execute, /spec save, /edit <feedback>, or /reject',
      answerLabel: 'Review input',
      answerPlaceholder: '/yes | /spec execute | /spec save | /edit <feedback> | /reject'
    },
    reflectApproval: {
      title: 'Review this reflected skill draft?',
      scopeLabel: 'Scope',
      nameLabel: 'Name',
      targetLabel: 'Target',
      prompt: 'Type /yes to write, /edit <feedback> to revise, or /no to discard.',
      invalidAnswer: 'Please enter /yes, /edit <feedback>, or /no.',
      missingFeedback: 'Please provide feedback after /edit.',
      inputLocked: 'Reflect review is active; type /yes, /edit <feedback>, or /no',
      answerLabel: 'Review input',
      answerPlaceholder: '/yes | /edit <feedback> | /no'
    }
  }
};

function normalizeLanguage(language) {
  return String(language || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function getCopy(language) {
  return TUI_COPY[normalizeLanguage(language)] || TUI_COPY.zh;
}

function messageLabel(label, copy) {
  return copy?.roleLabels?.[label] || String(label || '').toUpperCase();
}

function roleStyle(label) {
  return ROLE_STYLES[label] || ROLE_STYLES.system;
}

const PLAN_AGENT_ROLES = new Set(['planner', 'advisor', 'coder', 'reviewer', 'tester', 'summarizer']);

function normalizePlanAgentRole(role) {
  const roleKey = String(role || '').trim().toLowerCase();
  return PLAN_AGENT_ROLES.has(roleKey) ? roleKey : 'coder';
}

export function formatPlanAgentLabel(role, copy) {
  return messageLabel(normalizePlanAgentRole(role), copy);
}

function StatusPill({ label, value, color = 'cyanBright', textColor = 'black' }) {
  return h(
    Box,
    { marginRight: 1 },
    h(Text, { color: 'gray' }, `${label} `),
    h(Text, { color: textColor, backgroundColor: color }, ` ${value} `)
  );
}

function trimText(value, maxLen = 88) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

export function splitMarkdownTableCells(line) {
  const text = String(line || '').trim();
  if (!text.includes('|')) return [];
  return text
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => String(cell || '').trim());
}

export function isMarkdownTableSeparator(line) {
  const cells = splitMarkdownTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function isMarkdownTableHeader(line, nextLine) {
  const cells = splitMarkdownTableCells(line);
  return cells.length > 1 && isMarkdownTableSeparator(nextLine);
}

function getMarkdownTableAlignments(separatorLine, columnCount) {
  const cells = splitMarkdownTableCells(separatorLine);
  return Array.from({ length: columnCount }, (_, index) => {
    const cell = String(cells[index] || '').trim();
    if (/^:-{3,}:$/.test(cell)) return 'center';
    if (/^-{3,}:$/.test(cell)) return 'right';
    return 'left';
  });
}

function stringWidthLite(value) {
  return Array.from(String(value || '')).reduce((sum, ch) => sum + charDisplayWidth(ch), 0);
}

function splitTableWrapUnits(text) {
  return String(text || '')
    .split(/([\s,.;:!?/\\|()[\]{}<>，。；：！？、（）【】《》]+)/)
    .filter(Boolean);
}

function wrapPlainText(text, width, hard = false) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return [''];
  if (width <= 1) return [normalized];

  const words = splitTableWrapUnits(normalized);
  const lines = [];
  let current = '';

  const pushWord = (word) => {
    if (stringWidthLite(word) <= width) {
      if (!current) {
        current = word;
        return;
      }
      const needsSpacer =
        !/\s$/.test(current) &&
        !/^\s/.test(word) &&
        !/^[,.;:!?/\\|)\]}，。；：！？、】【》]/.test(word);
      const next = needsSpacer ? `${current} ${word}` : `${current}${word}`;
      if (stringWidthLite(next) <= width) {
        current = next;
      } else {
        lines.push(current);
        current = word;
      }
      return;
    }

    if (!hard) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word);
      return;
    }

    if (current) {
      lines.push(current);
      current = '';
    }
    let rest = word;
    while (stringWidthLite(rest) > width) {
      lines.push(Array.from(rest).slice(0, width).join(''));
      rest = Array.from(rest).slice(width).join('');
    }
    current = rest;
  };

  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function padAlignedText(text, width, align = 'left') {
  const value = String(text || '');
  const visible = stringWidthLite(value);
  if (visible >= width) return value;
  const gap = width - visible;
  if (align === 'right') return `${' '.repeat(gap)}${value}`;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return `${' '.repeat(left)}${value}${' '.repeat(right)}`;
  }
  return `${value}${' '.repeat(gap)}`;
}

function normalizeTableCellText(value) {
  return String(value || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim();
}

export function formatMarkdownTableBlock(lines, contentWidth = 72) {
  const sourceLines = Array.isArray(lines) ? lines : [];
  if (sourceLines.length < 2) return [];

  const headerCells = splitMarkdownTableCells(sourceLines[0]);
  const separatorLine = sourceLines[1];
  const bodyRows = sourceLines.slice(2).map(splitMarkdownTableCells).filter((cells) => cells.length > 0);
  if (headerCells.length === 0) return [];

  const columnCount = Math.max(headerCells.length, ...bodyRows.map((cells) => cells.length));
  const headers = Array.from({ length: columnCount }, (_, index) => normalizeTableCellText(headerCells[index] || ''));
  const rows = bodyRows.map((cells) =>
    Array.from({ length: columnCount }, (_, index) => normalizeTableCellText(cells[index] || ''))
  );
  const alignments = getMarkdownTableAlignments(separatorLine, columnCount);

  const minColumnWidth = 3;
  const maxRowLines = 6;
  const safetyMargin = 4;
  const borderOverhead = 1 + columnCount * 3;
  const availableWidth = Math.max(contentWidth - borderOverhead - safetyMargin, columnCount * minColumnWidth);

  const getMinWidth = (text) => {
    const words = splitTableWrapUnits(String(text || '')).filter((word) => !/^\s+$/.test(word));
    if (words.length === 0) return minColumnWidth;
    return Math.max(...words.map((word) => stringWidthLite(word)), minColumnWidth);
  };

  const getIdealWidth = (text) => Math.max(stringWidthLite(String(text || '').trim()), minColumnWidth);

  const minWidths = headers.map((header, index) =>
    Math.max(getMinWidth(header), ...rows.map((row) => getMinWidth(row[index])))
  );
  const idealWidths = headers.map((header, index) =>
    Math.max(getIdealWidth(header), ...rows.map((row) => getIdealWidth(row[index])))
  );

  const totalMin = minWidths.reduce((sum, width) => sum + width, 0);
  const totalIdeal = idealWidths.reduce((sum, width) => sum + width, 0);
  let needsHardWrap = false;
  let columnWidths;

  if (totalIdeal <= availableWidth) {
    columnWidths = idealWidths.slice();
  } else if (totalMin <= availableWidth) {
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, index) => ideal - minWidths[index]);
    const totalOverflow = overflows.reduce((sum, width) => sum + width, 0);
    columnWidths = minWidths.map((min, index) => {
      if (totalOverflow === 0) return min;
      return min + Math.floor((overflows[index] / totalOverflow) * extraSpace);
    });
  } else {
    needsHardWrap = true;
    const scale = availableWidth / Math.max(totalMin, 1);
    columnWidths = minWidths.map((width) => Math.max(Math.floor(width * scale), minColumnWidth));
  }

  const wrapCell = (text, width) => wrapPlainText(text, width, needsHardWrap);

  const computeMaxWrappedLines = () => {
    let maxLines = 1;
    for (let index = 0; index < headers.length; index += 1) {
      maxLines = Math.max(maxLines, wrapCell(headers[index], columnWidths[index]).length);
    }
    for (const row of rows) {
      for (let index = 0; index < columnCount; index += 1) {
        maxLines = Math.max(maxLines, wrapCell(row[index], columnWidths[index]).length);
      }
    }
    return maxLines;
  };

  const renderVerticalRows = () => {
    const rendered = [];
    const separatorWidth = Math.min(Math.max(contentWidth - 2, 12), 40);
    const separator = '─'.repeat(separatorWidth);
    rows.forEach((row, rowIndex) => {
      if (rowIndex > 0) rendered.push({ kind: 'table-vertical-separator', text: separator });
      row.forEach((cell, cellIndex) => {
        const label = headers[cellIndex] || `Column ${cellIndex + 1}`;
        const firstWidth = Math.max(contentWidth - stringWidthLite(label) - 3, 10);
        const nextWidth = Math.max(contentWidth - 3, 10);
        const firstPass = wrapPlainText(cell, firstWidth, true);
        const firstLine = firstPass[0] || '';
        const remaining = firstPass.slice(1).join(' ');
        const rest = remaining ? wrapPlainText(remaining, nextWidth, true) : [];
        const wrapped = [firstLine, ...rest].filter((line, idx) => idx === 0 || line.trim());
        rendered.push({
          kind: 'table-vertical',
          label,
          text: wrapped[0] || ''
        });
        for (const line of wrapped.slice(1)) {
          rendered.push({
            kind: 'table-vertical-continuation',
            text: line
          });
        }
      });
    });
    return rendered;
  };

  if (computeMaxWrappedLines() > maxRowLines && contentWidth < 80) {
    return renderVerticalRows();
  }

  const renderBorder = (type) => {
    const chars = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘']
    }[type];
    let line = chars[0];
    columnWidths.forEach((width, index) => {
      line += chars[1].repeat(width + 2);
      line += index < columnWidths.length - 1 ? chars[2] : chars[3];
    });
    return line;
  };

  const renderRowLines = (cells, isHeader = false) => {
    const wrappedColumns = cells.map((cell, index) => wrapCell(cell, columnWidths[index]));
    const maxLines = Math.max(...wrappedColumns.map((entry) => entry.length), 1);
    const verticalOffsets = wrappedColumns.map((entry) => Math.floor((maxLines - entry.length) / 2));
    const rendered = [];
    for (let lineIndex = 0; lineIndex < maxLines; lineIndex += 1) {
      let line = '│';
      for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
        const wrapped = wrappedColumns[columnIndex];
        const offset = verticalOffsets[columnIndex];
        const contentIndex = lineIndex - offset;
        const text = contentIndex >= 0 && contentIndex < wrapped.length ? wrapped[contentIndex] : '';
        const align = isHeader ? 'center' : alignments[columnIndex];
        line += ` ${padAlignedText(text, columnWidths[columnIndex], align)} │`;
      }
      rendered.push({
        kind: 'table',
        text: line,
        isHeader
      });
    }
    return rendered;
  };

  const tableLines = [
    { kind: 'table-separator', text: renderBorder('top') },
    ...renderRowLines(headers, true),
    { kind: 'table-separator', text: renderBorder('middle') }
  ];

  rows.forEach((row, index) => {
    tableLines.push(...renderRowLines(row, false));
    if (index < rows.length - 1) {
      tableLines.push({ kind: 'table-separator', text: renderBorder('middle') });
    }
  });
  tableLines.push({ kind: 'table-separator', text: renderBorder('bottom') });

  const maxLineWidth = Math.max(...tableLines.map((entry) => stringWidthLite(entry.text)));
  if (maxLineWidth > contentWidth - safetyMargin) {
    return renderVerticalRows();
  }

  return tableLines;
}

function parseRichTextSegments(line, baseColor) {
  const parts = String(line || '').split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return h(
        Text,
        { key: `ic-${idx}`, color: 'black', backgroundColor: 'yellow' },
        part.slice(1, -1)
      );
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return h(Text, { key: `bd-${idx}`, color: 'cyanBright', bold: true }, part.slice(2, -2));
    }
    return h(Text, { key: `tx-${idx}`, color: baseColor }, part);
  });
}

export function sanitizeRenderableText(value) {
  const input = String(value ?? '');
  if (!input) return '';

  return input
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/[\u001b\u009b][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '');
}

function textFromSessionContent(content) {
  if (typeof content === 'string') return sanitizeRenderableText(content);
  if (Array.isArray(content)) {
    return sanitizeRenderableText(
      content
        .map((part) => {
          if (typeof part === 'string') return part;
          if (part?.type === 'text') return part.text || '';
          return '';
        })
        .join('')
    );
  }
  return sanitizeRenderableText(String(content || ''));
}

export function buildUiMessagesFromSessionHistory(sessionMessages, nextId) {
  const source = Array.isArray(sessionMessages) ? sessionMessages : [];
  const out = [];

  for (const message of source) {
    if (!message || typeof message !== 'object') continue;
    if (message.role === 'tool') continue;

    const text = textFromSessionContent(message.content);
    if (!text.trim()) continue;

    if (message.role === 'user') {
      out.push({ id: nextId(), label: 'you', text, color: 'blueBright' });
      continue;
    }
    if (message.role === 'assistant') {
      out.push({ id: nextId(), label: 'general', text, color: 'greenBright' });
      continue;
    }
    if (message.role === 'system') {
      out.push({ id: nextId(), label: 'system', text, color: 'yellowBright' });
    }
  }

  return out;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch (parseError) {
    return { _raw: String(raw || ''), _invalid_json: true, _parseError: parseError.message };
  }
}

function parseToolDisplayName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^([^(]+)\((.*)\)$/);
  return {
    raw,
    base: match ? match[1] : raw,
    target: match ? match[2] : ''
  };
}

export function buildPreToolNotice(name, copy) {
  return buildRegisteredPreToolNotice(name, copy);
}

export function shouldInjectPreToolNotice(msg) {
  if (!msg) return false;
  const text = String(msg.text || '').trim();
  const segments = Array.isArray(msg.segments) ? msg.segments : [];
  const hasTextSegment = segments.some((segment) => segment?.type === 'text' && String(segment.text || '').trim());
  return !text && !hasTextSegment;
}

function getLastToolActivity(msg, statuses = []) {
  const allowed = new Set((Array.isArray(statuses) ? statuses : []).map((status) => String(status)));
  const segments = Array.isArray(msg?.segments) ? msg.segments : [];
  for (let idx = segments.length - 1; idx >= 0; idx -= 1) {
    const segment = segments[idx];
    if (segment?.type !== 'tool' && segment?.type !== 'system_tool') continue;
    if (allowed.size === 0 || allowed.has(String(segment.status || ''))) return segment;
  }
  return null;
}

function hasOnlySyntheticNarration(msg) {
  if (!msg?.syntheticPrelude) return false;
  const segments = Array.isArray(msg?.segments) ? msg.segments : [];
  const hasToolRows = segments.some((segment) => segment?.type === 'tool' || segment?.type === 'system_tool');
  const textSegments = segments.filter((segment) => segment?.type === 'text' && String(segment.text || '').trim());
  return hasToolRows && textSegments.length <= 1;
}

export function buildInterToolNotice(previousActivity, nextToolName, copy) {
  return buildRegisteredInterToolNotice(previousActivity, nextToolName, copy);
}

export function buildSyntheticCompletionText(msg, copy) {
  return buildRegisteredSyntheticCompletionText(msg, copy);
}

function formatDurationMs(ms) {
  const safeMs = Math.max(0, Number(ms) || 0);
  return `${(safeMs / 1000).toFixed(1)}s`;
}

function getIntentLabel(kind) {
  switch (kind) {
    case 'install':
      return 'Install';
    case 'build':
      return 'Build';
    case 'test':
      return 'Test';
    case 'frontend-service':
      return 'Frontend';
    case 'backend-service':
      return 'Backend';
    case 'database-service':
      return 'Database';
    case 'docker-service':
      return 'Docker';
    case 'service':
      return 'Service';
    default:
      return 'Run';
  }
}

export function formatActivityDurationText(row, nowMs = Date.now()) {
  if (!row) return '';
  if (row.status === 'running' && Number.isFinite(Number(row.startedAt))) {
    const startedAt = Number(row.startedAt);
    const endedAt = Number(row.endedAt);
    const elapsed = Number.isFinite(endedAt) && endedAt > startedAt ? endedAt - startedAt : Math.max(0, Number(nowMs) - startedAt);
    return formatDurationMs(elapsed);
  }
  if (typeof row.durationText === 'string' && row.durationText.trim()) {
    return row.durationText.trim();
  }
  if (Number.isFinite(Number(row.durationMs))) {
    return formatDurationMs(Number(row.durationMs));
  }
  return '';
}

export function getPendingUserMessageMeta(copy, { immediateLocal = false, inFlight = false } = {}) {
  if (immediateLocal) {
    return {
      phase: 'sending',
      liveStatus: copy.runtime.localCommandRunning
    };
  }

  if (inFlight) {
    return {
      phase: 'queued',
      liveStatus: copy.runtime.queuedWaiting
    };
  }

  return {
    phase: 'sending',
    liveStatus: copy.runtime.submittedWaiting || copy.runtime.sendingToGateway
  };
}

export function normalizeDeleteApprovalRequest(request) {
  if (!request || String(request?.name || '').trim() !== 'delete') return null;
  const details =
    request?.approvalDetails && typeof request.approvalDetails === 'object' && !Array.isArray(request.approvalDetails)
      ? request.approvalDetails
      : request?.arguments?.approval && typeof request.arguments.approval === 'object' && !Array.isArray(request.arguments.approval)
        ? request.arguments.approval
        : {};
  const fallbackPath = String(details.path || request?.arguments?.path || '').trim();
  const pathValue = fallbackPath;
  const nameValue = String(details.name || (pathValue ? pathValue.split(/[\\/]/).pop() : '') || '').trim();
  const typeValue = String(details.type || '').trim() === 'directory' ? 'directory' : 'file';
  if (!pathValue) return null;
  return {
    id: String(request?.id || '').trim(),
    toolName: 'delete',
    path: pathValue,
    name: nameValue || pathValue,
    type: typeValue
  };
}

export function parseDeleteApprovalAnswer(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'yes') return 'approve';
  if (normalized === 'no') return 'deny';
  return normalized ? 'invalid' : 'empty';
}

export function normalizeRunApprovalRequest(request) {
  if (!request || String(request?.name || '').trim() !== 'run') return null;
  const details =
    request?.approvalDetails && typeof request.approvalDetails === 'object' && !Array.isArray(request.approvalDetails)
      ? request.approvalDetails
      : {};
  const command = String(details.command || request?.arguments?.command || '').trim();
  if (!command) return null;
  return {
    id: String(request?.id || '').trim(),
    toolName: 'run',
    command,
    risk: details.risk || 'high',
    description: details.evaluation?.description || '',
    sideEffects: details.evaluation?.sideEffects || '',
    recommendation: details.evaluation?.recommendation || 'deny'
  };
}

export function normalizeFileApprovalRequest(request) {
  const toolName = String(request?.name || '').trim();
  if (!['edit', 'create', 'write', 'apply_patch'].includes(toolName)) return null;
  const args = request?.arguments && typeof request.arguments === 'object' && !Array.isArray(request.arguments)
    ? request.arguments
    : {};
  let pathValue = String(args.path || '').trim();
  if (!pathValue && toolName === 'apply_patch') {
    const patchText = String(args.patch_text || '');
    const paths = [...patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((match) => String(match[1] || '').trim())
      .filter(Boolean);
    pathValue = paths.length > 1 ? `${paths[0]} +${paths.length - 1}` : (paths[0] || '');
  }
  if (!pathValue) return null;
  return {
    id: String(request?.id || '').trim(),
    toolName,
    path: pathValue,
    action: String(args.kind || args.mode || toolName).trim() || toolName
  };
}

export function parseSpecApprovalAnswer(value) {
  const raw = String(value || '').trim();
  if (!raw) return { action: 'empty', command: '' };
  const normalized = raw.toLowerCase();
  if (normalized === '/yes' || normalized === 'yes') {
    return { action: 'approve', command: '/spec plan' };
  }
  if (normalized === '/reject' || normalized === 'reject' || normalized === 'no') {
    return { action: 'reject', command: '/reject' };
  }
  if (normalized === '/spec save' || normalized === 'save') {
    return { action: 'save', command: '/spec save' };
  }
  if (normalized === '/spec execute' || normalized === '/spec run' || normalized === 'execute' || normalized === 'run') {
    return { action: 'execute', command: '/spec execute' };
  }
  const editMatch = raw.match(/^\/?edit(?:\s+(.+))?$/i);
  if (editMatch) {
    const feedback = String(editMatch[1] || '').trim();
    if (!feedback) return { action: 'missing_feedback', command: '' };
    return { action: 'edit', feedback, command: `/edit ${feedback}` };
  }
  return { action: 'invalid', command: '' };
}

export function parseReflectApprovalAnswer(value) {
  const raw = String(value || '').trim();
  if (!raw) return { action: 'empty', command: '' };
  const normalized = raw.toLowerCase();
  if (normalized === '/yes' || normalized === 'yes') {
    return { action: 'approve', command: '/yes' };
  }
  if (normalized === '/no' || normalized === 'no') {
    return { action: 'reject', command: '/no' };
  }
  const editMatch = raw.match(/^\/?edit(?:\s+(.+))?$/i);
  if (editMatch) {
    const feedback = String(editMatch[1] || '').trim();
    if (!feedback) return { action: 'missing_feedback', command: '' };
    return { action: 'edit', feedback, command: `/edit ${feedback}` };
  }
  return { action: 'invalid', command: '' };
}

export function parsePendingReflectSkillMessage(text = '') {
  const raw = String(text || '');
  if (!/\bReflect skill draft pending\./i.test(raw)) return null;
  const lines = raw.split(/\r?\n/);
  const out = { scope: '', name: '', confidence: '', targetPath: '' };
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Scope: ')) out.scope = trimmed.slice('Scope: '.length).trim();
    else if (/^\[\d+\]\s+/.test(trimmed) && !out.name) out.name = trimmed.replace(/^\[\d+\]\s+/, '').trim();
    else if (trimmed.startsWith('Confidence: ')) out.confidence = trimmed.slice('Confidence: '.length).trim();
    else if (trimmed.startsWith('Target: ')) out.targetPath = trimmed.slice('Target: '.length).trim();
  }
  return out;
}

export function formatDeleteApprovalLines(copy, request) {
  const details = normalizeDeleteApprovalRequest(request);
  if (!details) return [];
  const typeLabel = details.type === 'directory' ? copy.deleteApproval.directoryType : copy.deleteApproval.fileType;
  const pathDisplay = details.path.includes('/') || details.path.includes('\\') ? details.path : `./${details.path}`;
  return [
    copy.deleteApproval.title,
    `${copy.deleteApproval.pathLabel}: ${pathDisplay}`,
    `${copy.deleteApproval.nameLabel}: ${details.name}`,
    `${copy.deleteApproval.typeLabel}: ${typeLabel}`,
    copy.deleteApproval.prompt
  ];
}

export function formatReflectApprovalLines(copy, request) {
  if (!request) return [];
  const c = copy?.reflectApproval || {};
  const lines = [String(c.title || '').trim()];
  if (request.scope) lines.push(`${c.scopeLabel || 'Scope'}: ${request.scope}`);
  if (request.name) lines.push(`${c.nameLabel || 'Name'}: ${request.name}`);
  if (request.targetPath) lines.push(`${c.targetLabel || 'Target'}: ${request.targetPath}`);
  if (c.prompt) lines.push(c.prompt);
  return lines.filter(Boolean);
}

function getActivityDisplayParts(activity) {
  if (isCodeGenerationActivityName(activity?.name)) {
    return {
      primary: '🧠 Code',
      secondary: ' (generation)'
    };
  }
  const parsed = parseToolDisplayName(activity?.displayName || activity?.name);
  const base = String(activity?.name || parsed.base || '').trim().toLowerCase();
  if (base === 'run') {
    const intent = classifyCommandIntent(parsed.target);
    return {
      primary: `${getIntentEmoji(intent.kind)} ${getIntentLabel(intent.kind)}`,
      secondary: parsed.target ? `(${parsed.target})` : ''
    };
  }
  if ((activity?.type || 'tool') === 'skill') {
    return {
      primary: '🧩 Skill',
      secondary: `(${activity?.name || 'unknown'})`
    };
  }
  if ((activity?.type || 'tool') === 'system_tool') {
    if (base === 'project_index') {
      return { primary: '🗂️ Project Index', secondary: '' };
    }
    if (base === 'file_index') {
      return { primary: '🗂️ File Index', secondary: parsed.target ? `(${parsed.target})` : '' };
    }
    return {
      primary: '🗂️ Index',
      secondary: parsed.target ? `(${parsed.target})` : parsed.base ? `(${parsed.base})` : ''
    };
  }
  const labels = {
    read: 'Read',
    edit: 'Edit',
    create: 'Create',
    write: 'Write',
    apply_patch: 'Apply Patch',
    delete: 'Delete',
    run: 'Run',
    grep: 'Search',
    web_fetch: 'Fetch',
    web_search: 'Web Search',
    glob: 'Glob',
    list: 'List',
    list_background_tasks: 'Tasks',
    get_background_task: 'Task',
    stop_background_task: 'Stop',
    list_files: 'Glob',
    update_todos: 'Update Todos',
    read_plan: 'Read Plan',
    update_plan: 'Update Plan',
    create_plan: 'Create Plan',
    create_spec: 'Create Spec',
    query_project_index: 'Query Project Index',
    tool_search: 'Tool Search'
  };
  const emojis = {
    read: '📖',
    edit: '✏️',
    create: '📝',
    write: '📝',
    apply_patch: '🩹',
    delete: '🗑️',
    run: '⚙️',
    grep: '🔍',
    web_fetch: '🌐',
    web_search: '🌐',
    glob: '🧭',
    list: '📂',
    list_background_tasks: '🗃️',
    get_background_task: '📌',
    stop_background_task: '⏹️',
    list_files: '🧭',
    update_todos: '✅',
    read_plan: '📋',
    update_plan: '🗓️',
    create_plan: '📋',
    create_spec: '📝',
    query_project_index: '🗂️',
    tool_search: '🔎'
  };
  return {
    primary: `${emojis[base] || '🔧'} ${labels[base] || formatToolLabel(base)}`,
    secondary: parsed.target ? `(${parsed.target})` : ''
  };
}

function getIntentEmoji(kind) {
  const map = {
    test: '🧪',
    install: '📦',
    build: '🏗️',
    frontend: '🖥️',
    backend: '🛰️',
    database: '🗄️',
    docker: '🐳',
    command: '⚙️'
  };
  return map[kind] || '⚙️';
}

export function isIndexSystemToolName(name) {
  const parsed = parseToolDisplayName(name);
  return parsed.base === 'project_index' || parsed.base === 'file_index';
}

export function shouldShowCompletionFooter(msg) {
  if (!msg || msg.loading || (msg.phase || '').trim()) return false;
  const label = (msg.label || '').toLowerCase();
  return label === 'general' || label === 'advisor' || label === 'coder' || label === 'planner' || label === 'reviewer' || label === 'tester';
}

function describeToolActivity(name, copy, { done = false, blocked = false } = {}) {
  return describeRegisteredToolActivity(copy, name, { done, blocked });
}

function describeSkillActivity(name, copy, { done = false, failed = false } = {}) {
  return describeRegisteredSkillActivity(copy, name, { done, failed });
}

function describeAutoSkillActivity(names, copy) {
  return describeRegisteredAutoSkillActivity(copy, names);
}

function formatAutoSkillBadge(names, copy) {
  return formatRegisteredAutoSkillBadge(copy, names);
}

function normalizeRuntimeStatus(status, copy) {
  if (status && typeof status === 'object') {
    return {
      title: trimText(status.title || copy.generic.waitingForInput, 64),
      detail: trimText(status.detail || '', 120),
      color: status.color || 'gray'
    };
  }
  return {
    title: trimText(status || copy.generic.waitingForInput, 64),
    detail: '',
    color: 'gray'
  };
}

export function shouldRefreshRuntimeStateForEvent(event) {
  const type = String(event?.type || '');
  return (
    type === 'assistant:start' ||
    type === 'assistant:delta' ||
    type === 'assistant:response' ||
    type === 'tool:result' ||
    type === 'plan:progress' ||
    type === 'spec:pending_approval' ||
    type === 'spec:approval_cleared' ||
    type === 'compact:auto' ||
    type === 'dream:auto' ||
    type === 'dream:complete'
  );
}

function stageDescriptor(inputStage, busy, runtimeStatus, copy) {
  const normalized = normalizeRuntimeStatus(runtimeStatus, copy);
  const tag =
    inputStage === 'sending'
      ? copy.stageTags.sending
      : inputStage === 'thinking'
        ? copy.stageTags.thinking
        : inputStage === 'streaming'
          ? copy.stageTags.streaming
          : inputStage === 'tooling'
            ? copy.stageTags.tooling
            : busy
              ? copy.stageTags.running
              : copy.stageTags.idle;
  const color =
    inputStage === 'sending'
      ? 'yellowBright'
      : inputStage === 'thinking'
        ? 'cyanBright'
        : inputStage === 'streaming'
          ? 'greenBright'
          : inputStage === 'tooling'
            ? 'magentaBright'
            : 'gray';
  return {
    tag,
    color,
    title: normalized.title,
    detail: normalized.detail
  };
}

function RuntimeStrip({ busy, runtimeStatus, loaderTick, copy }) {
  const status = normalizeRuntimeStatus(runtimeStatus, copy);
  return h(
    Box,
    {
      marginBottom: 1,
      borderStyle: 'round',
      borderColor: busy ? 'green' : 'gray',
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: busy ? 'greenBright' : 'gray' }, busy ? copy.generic.live : copy.generic.idle),
    h(Text, { color: 'gray' }, '  '),
    h(Text, { color: busy ? 'cyanBright' : 'gray' }, busy ? '●' : '○'),
    h(Text, { color: 'gray' }, '  '),
    h(Text, { color: busy ? 'white' : 'gray' }, status.title || copy.generic.waitingForInput)
  );
}

function ContextProgressMeter({ runtimeState, runtimeStatus, compact = false, copy }) {
  const maxContextTokens = Number(runtimeState?.maxContextTokens || 0);
  const currentContextTokens = Number(runtimeState?.currentContextTokens || 0);
  const pctRaw =
    Number.isFinite(runtimeState?.contextUsagePct) && runtimeState.contextUsagePct >= 0
      ? runtimeState.contextUsagePct
      : maxContextTokens > 0
        ? (currentContextTokens / maxContextTokens) * 100
        : 0;
  const pct = Math.min(100, Math.max(0, pctRaw));
  const filled = Math.min(12, Math.max(0, Math.round((pct / 100) * 12)));
  const activeColor = pct < 40 ? 'greenBright' : pct < 75 ? 'yellowBright' : 'redBright';
  const chunks = Array.from({ length: 12 }, (_, idx) => {
    const zoneColor = idx < 5 ? 'greenBright' : idx < 9 ? 'yellowBright' : 'redBright';
    const color = idx < filled ? zoneColor : 'gray';
    return h(Text, { key: `context-meter-${idx}`, color }, '|');
  });

  if (compact) {
    return h(
      Box,
      { justifyContent: 'flex-end', alignItems: 'center' },
      h(Text, { color: 'gray' }, `${copy?.runtime?.contextLabel ?? '上下文'} `),
      h(Text, { color: activeColor }, `${Math.round(pct)}% `),
      h(
        Box,
        { flexDirection: 'row' },
        ...chunks
      )
    );
  }

  return h(
    Box,
    { justifyContent: 'flex-end', alignItems: 'center' },
    h(Text, { color: 'gray' }, `${copy?.runtime?.contextLabel ?? '上下文'} `),
    h(Text, { color: activeColor }, `${Math.round(pct)}% `),
    h(
      Box,
      null,
      ...chunks
    )
  );
}

function PlanStrip({ planState, copy }) {
  if (!planState || !planState.total) return null;
  const isDone = planState.completed;
  const borderColor = isDone ? 'green' : planState.failed ? 'red' : 'cyan';
  const isEnglish = copy?.roleLabels?.system === 'SYSTEM';
  const completedLabel = isEnglish ? 'DONE' : '已完成';
  return h(
    Box,
    { marginBottom: 1, flexDirection: 'row' },
    h(Box, { width: 2 }, h(Text, { color: borderColor }, '│')),
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor,
        paddingX: 1,
        paddingY: 0,
        width: '100%'
      },
      h(
        Box,
        { justifyContent: 'space-between', marginBottom: planState.steps.length > 0 ? 1 : 0 },
        h(Text, { color: 'black', backgroundColor: isDone ? 'greenBright' : 'cyanBright' }, ' Plan Summary '),
        isDone
          ? h(Text, { color: 'black', backgroundColor: 'greenBright' }, ` ${completedLabel} `)
          : null
      ),
      planState.steps.length > 0
        ? h(
            Box,
            { flexDirection: 'column' },
            ...planState.steps.map((step, idx) => {
                const normalizedRole = normalizePlanAgentRole(step.role);
                const stepTheme = roleStyle(normalizedRole);
                const roleTag = formatPlanAgentLabel(normalizedRole, copy);
                const stepDone = step.status === 'done' || isDone;
                const stepFailed = step.status === 'failed';
                const marker = stepFailed ? '✗' : stepDone ? '✓' : '·';
                const markerColor = stepFailed ? 'redBright' : stepDone ? 'greenBright' : 'gray';
                return h(
                  Box,
                  { key: `plan-step-${idx}` },
                  h(Text, { color: markerColor }, `${marker} `),
                  h(Text, { color: stepTheme.badgeText, backgroundColor: stepTheme.badgeBg }, ` ${roleTag} `),
                  h(Text, { color: 'gray' }, ' '),
                  h(Text, { color: stepDone && !stepFailed ? 'gray' : 'white' }, `${step.index}. ${step.title}`)
                );
              }
            )
          )
        : null
    )
  );
}

function Header({ sessionId, model, sdkProvider, shellName, safeMode = true }) {
  const shortSession = String(sessionId || '').slice(-12) || '-';
  const modeValue = safeMode ? 'SAFE' : 'OPEN';
  const modeColor = safeMode ? 'greenBright' : 'redBright';
  const modeTextColor = safeMode ? 'black' : 'white';
  const sdkValue = String(sdkProvider || 'openai-compatible');
  return h(
    Box,
    { width: '100%', justifyContent: 'center', marginTop: 1, marginBottom: 2 },
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: 'cyan',
        paddingX: 4,
        paddingY: 1,
        alignItems: 'center',
        minWidth: 88
      },
      ...BANNER.map((line, idx) =>
        h(
          Box,
          { key: `b-${idx}`, justifyContent: 'center' },
          h(Text, { color: BANNER_COLORS[idx] || 'cyanBright' }, line)
        )
      ),
      h(Box, { height: 1 }),
      h(Text, { color: 'gray' }, 'An extremely restrained coding + tasks CLI. Every platform. Every terminal. Minimal by design.'),
      h(Box, { height: 1 }),
      h(
        Box,
        { flexDirection: 'row', justifyContent: 'center' },
        h(StatusPill, { label: 'SDK', value: sdkValue, color: 'blueBright', textColor: 'white' }),
        h(StatusPill, { label: 'MODEL', value: model, color: 'cyanBright', textColor: 'black' }),
        h(StatusPill, { label: 'SHELL', value: shellName || 'powershell', color: 'yellowBright', textColor: 'black' }),
        h(StatusPill, { label: 'SESSION', value: shortSession, color: 'magentaBright', textColor: 'black' }),
        h(StatusPill, { label: 'MODE', value: modeValue, color: modeColor, textColor: modeTextColor })
      )
    )
  );
}

function renderInlineCode(line, baseColor) {
  return parseRichTextSegments(line, baseColor);
}

function renderTextLine(msg, line, idx, color) {
  const headingMatch = String(line || '').match(/^\s{0,3}(#{1,3})\s+(.*)$/);
  if (headingMatch) {
    const level = headingMatch[1].length;
    const title = headingMatch[2].trim();
    const accent = level === 1 ? 'cyanBright' : level === 2 ? 'greenBright' : 'yellowBright';
    return h(
      Box,
      { key: `ln-wrap-${msg.id}-${idx}` },
      h(Text, { color: accent, bold: true }, title)
    );
  }

  const boldTitleMatch = String(line || '').match(/^\s*\*\*(.+)\*\*\s*$/);
  if (boldTitleMatch) {
    return h(
      Box,
      { key: `ln-wrap-${msg.id}-${idx}` },
      h(Text, { key: `ln-${msg.id}-${idx}`, color: 'cyanBright', bold: true }, boldTitleMatch[1].trim())
    );
  }

  return h(
    Box,
    { key: `ln-wrap-${msg.id}-${idx}` },
    h(Text, { key: `ln-${msg.id}-${idx}`, color }, ...renderInlineCode(line, color))
  );
}

function historyListLineColor(line, fallbackColor) {
  const raw = String(line || '');
  const trimmed = raw.trim();
  if (!trimmed) return fallbackColor;
  if (/^Current session\s+/i.test(trimmed) || /^Recent sessions$/i.test(trimmed) || /^\d+\.\s+\S+/.test(trimmed)) {
    return 'cyanBright';
  }
  if (/^Messages\s+\d+$/i.test(trimmed) || /^\d+\s+msgs?\s+\|\s+updated\b/i.test(trimmed) || /^Tip:/i.test(trimmed)) {
    return 'gray';
  }
  if (/^resume:\s+\/history resume\b/i.test(trimmed)) {
    return 'blueBright';
  }
  return 'white';
}

function isHistoryListMessage(msg) {
  const text = String(msg?.text || '');
  return msg?.label === 'system' &&
    /^Current session\s+/m.test(text) &&
    /^Recent sessions$/m.test(text) &&
    /resume:\s+\/history resume\b/m.test(text);
}

export function parseAutoPlanSummaryMessage(text) {
  const raw = String(text || '').trim();
  if (!/^Auto plan finished\b/i.test(raw)) return null;

  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = {
    statusTitle: lines[0] || '',
    filePath: '',
    planSummary: '',
    finalSummary: '',
    approval: '',
    stepsTotal: '',
    completed: '',
    warnings: '',
    failed: '',
    warningSteps: '',
    failedSteps: '',
    planSteps: []
  };

  let inPlanSteps = false;
  for (const line of lines.slice(1)) {
    if (line === 'Plan Steps:') {
      inPlanSteps = true;
      continue;
    }
    if (inPlanSteps) {
      // Parse "  1. [role] title"
      const stepMatch = line.match(/^(\d+)\.\s*\[([^\]]+)\]\s+(.+)$/);
      if (stepMatch) {
        parsed.planSteps.push({
          index: Number(stepMatch[1]),
          role: String(stepMatch[2] || '').trim().toLowerCase(),
          title: String(stepMatch[3] || '').trim(),
          task: '',
          status: 'pending'
        });
      } else if (/^-\s*task\s*:\s*/i.test(line) && parsed.planSteps.length > 0) {
        parsed.planSteps[parsed.planSteps.length - 1].task = line.replace(/^-\s*task\s*:\s*/i, '').trim();
      } else if (/^Next:\s*/i.test(line)) {
        inPlanSteps = false;
      } else {
        inPlanSteps = false;
      }
    }
    if (!inPlanSteps) {
      if (line.startsWith('File: ')) parsed.filePath = line.slice('File: '.length).trim();
      else if (line.startsWith('Plan File: ')) parsed.filePath = line.slice('Plan File: '.length).trim();
      else if (line.startsWith('Plan Summary: ')) parsed.planSummary = line.slice('Plan Summary: '.length).trim();
      else if (line.startsWith('Final Summary: ')) parsed.finalSummary = line.slice('Final Summary: '.length).trim();
      else if (line.startsWith('Approval: ')) parsed.approval = line.slice('Approval: '.length).trim();
      else if (line.startsWith('Steps: ')) parsed.stepsTotal = line.slice('Steps: '.length).trim();
      else if (line.startsWith('Completed: ')) parsed.completed = line.slice('Completed: '.length).trim();
      else if (line.startsWith('Warnings: ')) parsed.warnings = line.slice('Warnings: '.length).trim();
      else if (line.startsWith('Failed: ')) parsed.failed = line.slice('Failed: '.length).trim();
      else if (line.startsWith('Warning steps: ')) parsed.warningSteps = line.slice('Warning steps: '.length).trim();
      else if (line.startsWith('Failed steps: ')) parsed.failedSteps = line.slice('Failed steps: '.length).trim();
    }
  }

  return parsed;
}

export function parsePlanProgressLine(text) {
  const raw = String(text || '').trim();
  const match = raw.match(/^\[plan\]\s+Step\s+(\d+)\/(\d+)\s+->\s+([^:]+):\s+(.+)$/i);
  if (!match) return null;
  return {
    current: Number(match[1]),
    total: Number(match[2]),
    role: String(match[3] || '').trim(),
    title: String(match[4] || '').trim()
  };
}

export function parsePlanExecutionResult(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const statusMatch = raw.match(/(?:^|\n)\s*Status:\s*(done|partial|blocked)\s*$/im);
  const verifiedMatch = raw.match(/(?:^|\n)\s*Verified:\s*(.+)\s*$/im);
  const nextMatch = raw.match(/(?:^|\n)\s*Next:\s*(.+)\s*$/im);
  if (!statusMatch && !verifiedMatch && !nextMatch) return null;
  return {
    status: String(statusMatch?.[1] || '').trim().toLowerCase(),
    verified: String(verifiedMatch?.[1] || '').trim(),
    next: String(nextMatch?.[1] || '').trim()
  };
}

export function stripPlanExecutionResult(text) {
  const raw = String(text || '');
  if (!parsePlanExecutionResult(raw)) return raw;
  return raw
    .replace(/(?:^|\n)\s*Status:\s*(done|partial|blocked)\s*$/im, '')
    .replace(/(?:^|\n)\s*Verified:\s*.+\s*$/im, '')
    .replace(/(?:^|\n)\s*Next:\s*.+\s*$/im, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getTailPreviewWindow(text, maxLines = 3) {
  const source = String(text || '');
  if (!source.trim()) return { lines: [], startLine: 1 };
  const sliceTail = (lines) => {
    const tail = lines.slice(-Math.max(1, maxLines));
    return {
      lines: tail,
      startLine: Math.max(1, lines.length - tail.length + 1)
    };
  };

  const lines = source.split('\n').map((line) => line.replace(/\r$/, ''));
  let insideFence = false;
  let fenceLines = [];
  let latestClosedFenceLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (insideFence) {
        latestClosedFenceLines = fenceLines.slice();
        insideFence = false;
        fenceLines = [];
        continue;
      }
      insideFence = true;
      fenceLines = [];
      continue;
    }
    if (insideFence) {
      fenceLines.push(line);
    }
  }

  if (insideFence) {
    const codeLines = fenceLines.filter((line) => line.trim().length > 0);
    if (codeLines.length > 0) {
      return sliceTail(codeLines);
    }
  }

  const closedFenceLines = latestClosedFenceLines.filter((line) => line.trim().length > 0);
  if (closedFenceLines.length > 0) {
    return sliceTail(closedFenceLines);
  }

  const tailLines = source
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0);
  if (tailLines.length === 0) return { lines: [], startLine: 1 };
  return sliceTail(tailLines);
}

function collectPreviewStrings(value, out = []) {
  if (out.length >= 3 || value == null) return out;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectPreviewStrings(item, out);
      if (out.length >= 3) break;
    }
    return out;
  }
  if (typeof value !== 'object') return out;

  const priorityKeys = ['content', 'new_content', 'new_text', 'patch', 'text', 'code', 'body', 'script', 'source', 'value'];
  if (value.edit && typeof value.edit === 'object') {
    collectPreviewStrings(value.edit, out);
  }
  for (const key of priorityKeys) {
    if (out.length >= 3) break;
    collectPreviewStrings(value[key], out);
  }
  return out;
}

function extractPreviewTextFromRawArguments(raw) {
  const source = String(raw || '');
  if (!source.trim()) return '';
  const contentMatch = source.match(/"(content|new_content|new_text|patch|code|body|script|source|value)"\s*:\s*"([\s\S]*)$/);
  if (!contentMatch) return '';

  return contentMatch[2]
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .replace(/"\s*[,}\]]*\s*$/g, '')
    .trim();
}

function compactPreviewLine(line, maxChars = 56) {
  const text = String(line || '').replace(/\t/g, '  ').trimEnd();
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(1, maxChars - 3))}...`;
}

function extractPreviewLinesFromTool(tool, maxLines = 3) {
  const previewSource =
    typeof tool?.arguments === 'string'
      ? (() => {
          const parsedArguments = safeJsonParse(tool.arguments);
          if (parsedArguments && !parsedArguments._invalid_json) {
            const parsedPreview = collectPreviewStrings(parsedArguments);
            if (parsedPreview.length > 0) return parsedPreview;
          }
          const rawArgumentPreview = extractPreviewTextFromRawArguments(tool.arguments);
          return rawArgumentPreview ? [rawArgumentPreview] : [];
        })()
      : collectPreviewStrings(tool?.arguments || tool?.content || tool?.summary || []);

  if (previewSource.length === 0) return { lines: [], startLine: 1 };
  const combined = previewSource.join('\n');
  const previewWindow = getTailPreviewWindow(combined, maxLines);
  return {
    lines: previewWindow.lines.map((line) => compactPreviewLine(line)),
    startLine: previewWindow.startLine
  };
}

function getLatestToolPreviewLines(msg, maxLines = 3) {
  const codeTools = new Set(['edit', 'create']);
  const extractFromCalls = (calls) => {
    for (let index = calls.length - 1; index >= 0; index -= 1) {
      const tool = calls[index];
      const parsed = parseToolDisplayName(tool?.name);
      if (!codeTools.has(parsed.base)) continue;
      const previewWindow = extractPreviewLinesFromTool(tool, maxLines);
      if (previewWindow.lines.length > 0) return previewWindow;
    }
    return { lines: [], startLine: 1 };
  };

  const pendingCodeCalls = (Array.isArray(msg?.pendingToolCalls) ? msg.pendingToolCalls : []).filter((tool) =>
    codeTools.has(parseToolDisplayName(tool?.name).base)
  );
  if (pendingCodeCalls.length > 0) {
    const latestPendingPreview = extractPreviewLinesFromTool(pendingCodeCalls.at(-1), maxLines);
    if (latestPendingPreview.lines.length > 0) return latestPendingPreview;
    return { lines: [], startLine: 1 };
  }

  const toolCalls = (Array.isArray(msg?.toolCalls) ? msg.toolCalls : []).filter(
    (tool) => tool?.status === 'running' && codeTools.has(parseToolDisplayName(tool?.name).base)
  );
  if (toolCalls.length > 0) {
    return extractFromCalls(toolCalls);
  }

  return { lines: [], startLine: 1 };
}

export function getGeneratingCodePlaceholderRows(msg, copy, contentWidth = 72) {
  const liveStatus = String(msg?.liveStatus || '').trim();
  if (!msg?.loading || (msg?.phase !== 'generating' && msg?.phase !== 'tooling')) return [];

  const previewWindow = getLatestToolPreviewLines(msg, 3);
  if (previewWindow.lines.length === 0) return [];
  const hasRunningCodeTool = (Array.isArray(msg?.toolCalls) ? msg.toolCalls : []).some(
    (tool) => tool?.status === 'running' && new Set(['edit', 'create']).has(parseToolDisplayName(tool?.name).base)
  );
  const isCodeGenerationStatus = liveStatus === String(copy?.runtime?.generatingCode || '').trim();
  if (!isCodeGenerationStatus && !(msg?.phase === 'tooling' && hasRunningCodeTool)) return [];

  return previewWindow.lines.map((line, idx) => ({
    kind: 'code-placeholder',
    lineNo: previewWindow.startLine + idx,
    text: line,
    color: 'gray'
  }));
}

export function getCodeGenerationActivityRows(msg) {
  const startedAt = Number(msg?.codeGenerationStartedAt);
  const endedAt = Number(msg?.codeGenerationEndedAt);
  if (!startedAt || !msg?.loading || endedAt > 0) return [];

  const status = 'running';
  const durationMs = Math.max(0, Date.now() - startedAt);

  return [
    {
      kind: 'activity',
      activityType: 'tool',
      name: 'Code generation',
      status,
      statusIcon: status === 'done' ? '✓' : '…',
      statusColor: status === 'done' ? 'greenBright' : 'yellow',
      durationMs,
      durationText: formatDurationMs(durationMs),
      isLatestTool: true,
      synthetic: true
    }
  ];
}

export function ensureCodeGenerationTiming(msg, now = Date.now()) {
  if (!msg || msg.codeGenerationStartedAt) return msg;
  return {
    ...msg,
    codeGenerationStartedAt: now,
    codeGenerationEndedAt: undefined
  };
}

export function shouldAppendAssistantResult(result, activeAssistantId, streamedAssistantHandled = false) {
  if (result?.type !== 'assistant') return true;
  if (streamedAssistantHandled) return false;
  return !activeAssistantId;
}

function finishCodeGeneration(msg, now = Date.now()) {
  if (!msg?.codeGenerationStartedAt || msg?.codeGenerationEndedAt) return msg;
  return {
    ...msg,
    codeGenerationEndedAt: now,
    pendingToolCalls: []
  };
}

export function injectPlanStateMessage(messages, planState, activeUserMessageId, activeAssistantId) {
  const source = Array.isArray(messages) ? messages : [];
  if (!planState || !planState.total || planState.pendingApproval) return source;
  const synthetic = {
    id: `plan-state-${planState.current}-${planState.total}-${planState.role || 'agent'}`,
    label: 'system',
    planStrip: true,
    planState
  };
  const withNoPlanStrip = source.filter((message) => !message?.planStrip);
  const userIdx = withNoPlanStrip.findIndex((message) => message.id === activeUserMessageId);
  if (userIdx !== -1) {
    return [...withNoPlanStrip.slice(0, userIdx + 1), synthetic, ...withNoPlanStrip.slice(userIdx + 1)];
  }
  const assistantIdx = withNoPlanStrip.findIndex((message) => message.id === activeAssistantId);
  if (assistantIdx !== -1) {
    return [...withNoPlanStrip.slice(0, assistantIdx), synthetic, ...withNoPlanStrip.slice(assistantIdx)];
  }
  return [...withNoPlanStrip, synthetic];
}

export function injectRuntimeStateMessage(messages, runtimeState, runtimeStatus, busy, activeUserMessageId, activeAssistantId) {
  const source = Array.isArray(messages) ? messages : [];
  if (!runtimeState) return source;
  const withoutRuntimeStrip = source.filter((message) => !message?.runtimeStrip);
  const userIdx = withoutRuntimeStrip.findIndex((message) => message.id === activeUserMessageId);
  if (userIdx !== -1) {
    return withoutRuntimeStrip;
  }
  const assistantIdx = withoutRuntimeStrip.findIndex((message) => message.id === activeAssistantId);
  if (assistantIdx !== -1) {
    return withoutRuntimeStrip;
  }
  return withoutRuntimeStrip;
}

function PlanSummaryBubble({ msg, copy }) {
  const theme = roleStyle(msg.label);
  const summary = msg.planSummary || parseAutoPlanSummaryMessage(msg.text);
  if (!summary) return null;

  const statusColor =
    Number(summary.failed || 0) > 0 ? 'redBright' : Number(summary.warnings || 0) > 0 ? 'yellowBright' : 'greenBright';
  const isEnglish = copy?.roleLabels?.system === 'SYSTEM';
  const labels = isEnglish
    ? {
        conclusion: 'Conclusion',
        plan: 'Plan',
        approval: 'Approval',
        warnings: 'Warnings',
        failed: 'Failed',
        file: 'File',
        steps: 'steps',
        done: 'done',
        warn: 'warn',
        fail: 'fail'
      }
    : {
        conclusion: '结论',
        plan: '计划',
        approval: '审批',
        warnings: '警告',
        failed: '失败',
        file: '文件',
        steps: '步骤',
        done: '完成',
        warn: '警告',
        fail: '失败'
      };
  const metaItems = [
    summary.stepsTotal ? `${labels.steps} ${summary.stepsTotal}` : '',
    summary.completed ? `${labels.done} ${summary.completed}` : '',
    summary.warnings ? `${labels.warn} ${summary.warnings}` : '',
    summary.failed ? `${labels.fail} ${summary.failed}` : ''
  ].filter(Boolean);
  const shortFile = summary.filePath ? trimText(summary.filePath, 96) : '';
  const planSteps = Array.isArray(summary.planSteps) ? summary.planSteps : [];

  return h(
    Box,
    { marginBottom: 1, flexDirection: 'row' },
    h(Box, { width: 2 }, h(Text, { color: theme.accent }, '│')),
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: theme.border,
        paddingX: 1,
        paddingY: 0,
        width: '100%'
      },
      h(
        Box,
        { justifyContent: 'space-between', marginBottom: summary.finalSummary ? 1 : 0 },
        h(
          Box,
          null,
          h(Text, { color: theme.badgeText, backgroundColor: theme.badgeBg }, ` ${messageLabel(msg.label, copy)} `),
          h(Text, { color: 'gray' }, '  '),
          h(Text, { color: statusColor }, summary.statusTitle)
        ),
        h(Text, { color: theme.chrome }, ' ')
      ),
      summary.finalSummary
        ? h(
            Box,
            { marginBottom: summary.planSummary || metaItems.length > 0 || summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: statusColor }, labels.conclusion),
            h(Text, { color: 'white' }, summary.finalSummary)
          )
        : null,
      summary.planSummary
        ? h(
            Box,
            { marginBottom: planSteps.length > 0 || summary.approval || metaItems.length > 0 || summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'cyanBright' }, labels.plan),
            h(Text, { color: 'white' }, summary.planSummary)
          )
        : null,
      planSteps.length > 0
        ? h(
            Box,
            { marginBottom: summary.approval || metaItems.length > 0 || summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'cyanBright' }, labels.steps),
            ...planSteps.flatMap((step, idx) => {
              const roleKey = normalizePlanAgentRole(step?.role);
              const stepTheme = roleStyle(roleKey);
              const roleTag = formatPlanAgentLabel(roleKey, copy);
              const titleText = String(step?.title || '-').trim() || '-';
              const taskText = String(step?.task || '').trim();
              const titleRow = h(
                Text,
                { key: `plan-step-title-${idx}`, color: 'white' },
                `${idx + 1}. `,
                h(Text, { color: stepTheme.badgeText, backgroundColor: stepTheme.badgeBg }, ` ${roleTag} `),
                ` ${titleText}`
              );
              if (!taskText) return [titleRow];
              const taskRow = h(Text, { key: `plan-step-task-${idx}`, color: 'white' }, `   - task: ${taskText}`);
              return [titleRow, taskRow];
            })
          )
        : null,
      summary.approval
        ? h(
            Box,
            { marginBottom: metaItems.length > 0 || summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'yellowBright' }, labels.approval),
            h(Text, { color: 'white' }, summary.approval)
          )
        : null,
      metaItems.length > 0
        ? h(
            Box,
            { marginBottom: summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0 },
            ...metaItems.flatMap((item, idx) => [
              idx > 0 ? h(Text, { key: `sep-${idx}`, color: 'gray' }, '  ') : null,
              h(Text, { key: `meta-${idx}`, color: 'white' }, item)
            ])
          )
        : null,
      summary.warningSteps
        ? h(
            Box,
            { marginBottom: summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'yellowBright' }, labels.warnings),
            h(Text, { color: 'white' }, summary.warningSteps)
          )
        : null,
      summary.failedSteps
        ? h(
            Box,
            { marginBottom: shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'redBright' }, labels.failed),
            h(Text, { color: 'white' }, summary.failedSteps)
          )
        : null,
      shortFile
        ? h(
            Box,
            { flexDirection: 'column' },
            h(Text, { color: 'gray' }, labels.file),
            h(Text, { color: 'gray' }, shortFile)
          )
        : null
    )
  );
}

const BUBBLE_CHROME_ROWS = 4;

function charDisplayWidth(ch) {
  const code = ch.codePointAt(0) || 0;
  if (code === 0) return 0;
  if (
    code >= 0x1100 &&
    (
      code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    )
  ) {
    return 2;
  }
  return 1;
}

function wrapTextChunks(text, width = 72) {
  const safeWidth = Math.max(8, width);
  const chars = Array.from(String(text || ''));
  if (chars.length === 0) return [''];
  const lines = [];
  let current = '';
  let used = 0;
  for (const ch of chars) {
    const chWidth = charDisplayWidth(ch);
    if (used > 0 && used + chWidth > safeWidth) {
      lines.push(current);
      current = ch;
      used = chWidth;
      continue;
    }
    current += ch;
    used += chWidth;
  }
  if (current || lines.length === 0) lines.push(current);
  return lines;
}

function pushWrappedRow(rows, baseRow, contentWidth) {
  const chunks = wrapTextChunks(baseRow.text || '', contentWidth);
  chunks.forEach((chunk, index) => {
    rows.push({
      ...baseRow,
      text: chunk || ' ',
      continuation: index > 0
    });
  });
}

function isActivityRow(row) {
  return row?.kind === 'activity' || row?.kind === 'activity-summary';
}

function isBlankTextRow(row) {
  return row?.kind === 'text' && String(row?.text || '').trim() === '';
}

function isCodeActivityName(name) {
  const parsed = parseToolDisplayName(name);
  return new Set([
    'edit',
    'create',
    'write_file',
    'replace_text',
    'replace_block',
    'insert_before',
    'insert_after',
    'validate_edit'
  ]).has(parsed.base);
}

export function isCodeLikeRow(row) {
  if (!row) return false;
  if (row.kind === 'code' || row.kind === 'activity' || row.kind === 'activity-summary') return true;
  if (row.kind === 'status') return true;
  return false;
}

export function splitMessageRows(rows) {
  const textRows = [];
  const codeRows = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isCodeLikeRow(row)) codeRows.push(row);
    else textRows.push(row);
  }
  return { textRows, codeRows };
}

export function insertRowsAfterLastCodeRow(rows, extraRows) {
  const source = Array.isArray(rows) ? rows : [];
  const inserts = Array.isArray(extraRows) ? extraRows.filter(Boolean) : [];
  if (inserts.length === 0) return source.slice();

  let insertIndex = -1;
  for (let index = source.length - 1; index >= 0; index -= 1) {
    if (source[index]?.kind === 'code' || source[index]?.kind === 'code-placeholder') {
      insertIndex = index + 1;
      break;
    }
  }

  if (insertIndex === -1) return [...source, ...inserts];
  return [...source.slice(0, insertIndex), ...inserts, ...source.slice(insertIndex)];
}

export function normalizeActivitySpacingRows(inputRows) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  const normalized = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const prev = normalized.at(-1);
    const next = rows[index + 1];

    if (isBlankTextRow(row)) {
      let lookahead = index + 1;
      while (lookahead < rows.length && isBlankTextRow(rows[lookahead])) {
        lookahead += 1;
      }
      if (isActivityRow(rows[lookahead])) {
        continue;
      }
    }

    if (isBlankTextRow(row) && isActivityRow(next)) {
      continue;
    }

    normalized.push(row);

    if (isActivityRow(row) && !isActivityRow(next) && next) {
      const last = normalized.at(-1);
      if (!isBlankTextRow(last) && !(next.kind === 'status') && !isTodoRow(next)) {
        normalized.push({
          kind: 'text',
          text: ' ',
          color: 'white'
        });
      }
    }

    if (isTodoRow(row) && !isTodoRow(next) && next && !isBlankTextRow(next) && next.kind !== 'status') {
      normalized.push({ kind: 'todo-gap' });
    }

    if (isBlankTextRow(row) && isBlankTextRow(prev)) {
      normalized.pop();
    }
  }

  return normalized;
}

function isTodoRow(row) {
  return row?.kind === 'todo-item';
}

function isReadActivityName(name) {
  const parsed = parseToolDisplayName(name);
  return parsed.base === 'read' || parsed.base === 'Read';
}

function isIgnorableSegmentAfterRead(item, activityType, activityName) {
  if (!item) return true;
  if (item.type === 'text') {
    return String(item.text || '').trim() === '';
  }
  return (item.type || 'tool') === activityType && item.name === activityName;
}

export function findActivityUpdateIndex(items, toolEvent) {
  const source = Array.isArray(items) ? items : [];
  const activityType = toolEvent?.type || 'tool';
  const byId = toolEvent?.id
    ? source.findIndex((item) => item.type === activityType && item.id && item.id === toolEvent.id)
    : -1;
  if (byId !== -1) return byId;

  const byNameRunning = source.findIndex(
    (item) => (item.type || 'tool') === activityType && item.name === toolEvent?.name && item.status !== 'done'
  );
  if (byNameRunning !== -1) return byNameRunning;

  if (isReadActivityName(toolEvent?.name)) {
    for (let index = source.length - 1; index >= 0; index -= 1) {
      const item = source[index];
      if ((item?.type || 'tool') !== activityType || item?.name !== toolEvent?.name) continue;
      const trailing = source.slice(index + 1);
      if (trailing.every((entry) => isIgnorableSegmentAfterRead(entry, activityType, toolEvent?.name))) {
        return index;
      }
    }
  }

  return -1;
}

export function mergeActivitySummary(previousSummary, nextSummary, activityName) {
  const prev = String(previousSummary || '').trim();
  const next = String(nextSummary || '').trim();
  if (!next) return prev;
  if (!prev) return next;
  if (!isReadActivityName(activityName) || prev === next) return next;

  const lines = [];
  for (const line of `${prev}\n${next}`.split('\n')) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;
    if (!lines.includes(trimmed)) lines.push(trimmed);
  }
  return lines.join('\n');
}

export function collapseActivityChainRows(inputRows, showToolDetails, copy, maxVisibleActivities = 3) {
  const rows = Array.isArray(inputRows) ? inputRows : [];
  if (showToolDetails) return rows.slice();
  const maxVisible = Math.max(1, Number(maxVisibleActivities) || 3);
  const collapsed = [];

  const isCollapsibleActivity = (row) =>
    row?.kind === 'activity' &&
    ['tool', 'skill', 'system_tool'].includes(String(row?.activityType || 'tool'));

  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (!isCollapsibleActivity(row)) {
      collapsed.push(row);
      index += 1;
      continue;
    }

    const group = [];
    while (index < rows.length) {
      const next = rows[index];
      if (isCollapsibleActivity(next)) {
        group.push([next]);
        index += 1;
        continue;
      }
      if (next?.kind === 'activity-summary' && group.length > 0) {
        group[group.length - 1].push(next);
        index += 1;
        continue;
      }
      break;
    }

    if (group.length <= maxVisible) {
      for (const item of group) collapsed.push(...item);
      continue;
    }

    const hiddenCount = group.length - maxVisible;
    collapsed.push({
      kind: 'activity-collapsed',
      hiddenCount,
      text:
        copy?.generic?.toolChainCollapsed != null
          ? copy.generic.toolChainCollapsed(hiddenCount)
          : `${hiddenCount} earlier tool calls hidden`
    });
    for (const item of group.slice(-maxVisible)) {
      collapsed.push(...item);
    }
  }

  return collapsed;
}

export function buildMarkdownPreviewRows(text, contentWidth = 72, options = {}) {
  const rows = [];
  const isHistoryList = options.isHistoryList === true;
  const defaultColor = options.color || 'white';
  const skipPlanProgress = options.skipPlanProgress !== false;
  const lines = String(text || '').split('\n');
  let codeFence = false;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (skipPlanProgress) {
      const planProgress = parsePlanProgressLine(trimmed);
      if (planProgress) continue;
    }
    if (trimmed.startsWith('```')) {
      codeFence = !codeFence;
      continue;
    }
    if (codeFence) {
      pushWrappedRow(rows, { kind: 'code', text: line || ' ', color: 'gray' }, contentWidth);
      continue;
    }
    if (isMarkdownTableHeader(line, lines[lineIndex + 1])) {
      const tableLines = [line, lines[lineIndex + 1]];
      lineIndex += 1;
      while (lineIndex + 1 < lines.length && splitMarkdownTableCells(lines[lineIndex + 1]).length > 1) {
        tableLines.push(lines[lineIndex + 1]);
        lineIndex += 1;
      }
      rows.push(...formatMarkdownTableBlock(tableLines, contentWidth));
      continue;
    }
    let color = defaultColor;
    if (isHistoryList) color = historyListLineColor(line, color);
    else if (line.startsWith('#')) color = 'cyanBright';
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) color = 'magentaBright';
    else if (trimmed.startsWith('>')) color = 'yellow';
    else if (/^[|└├│]/.test(trimmed)) color = 'gray';
    pushWrappedRow(
      rows,
      {
        kind: trimmed.startsWith('>') ? 'quote' : /^[|└├│]/.test(trimmed) ? 'tree' : 'text',
        text: line || ' ',
        color
      },
      trimmed.startsWith('>') ? Math.max(8, contentWidth - 3) : contentWidth
    );
  }
  return rows;
}

export function buildMessageRows(msg, showToolDetails, contentWidth = 72, copy) {
  const rows = [];
  const isHistoryList = isHistoryListMessage(msg);
  const pushTextRows = (text) => {
    rows.push(
      ...buildMarkdownPreviewRows(text, contentWidth, {
        color: msg.color || roleStyle(msg.label).text || 'white',
        isHistoryList,
        skipPlanProgress: true
      })
    );
  };

  const pushActivityRows = (tool, idx, total) => {
    const statusIcon = tool.status === 'done' ? '✓' : tool.status === 'blocked' || tool.status === 'error' ? '×' : '…';
    const statusColor =
      tool.status === 'done' ? 'greenBright' : tool.status === 'blocked' || tool.status === 'error' ? 'redBright' : 'yellow';
    const durationText =
      typeof tool.durationMs === 'number' ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';
    rows.push({
      kind: 'activity',
      activityType: tool.type || 'tool',
      name: tool.name,
      statusIcon,
      statusColor,
      status: tool.status,
      durationText,
      isLatestTool: idx === total - 1
    });
    const todoItems = parseToolDisplayName(tool.name).base === 'update_todos' ? tool?.arguments?.todos : null;
    if (Array.isArray(todoItems) && todoItems.length > 0 && tool.status !== 'running') {
      for (const item of todoItems) {
        const status = String(item?.status || 'pending').trim();
        rows.push({
          kind: 'todo-item',
          status,
          text: String(item?.content || '').trim(),
          activeForm: String(item?.activeForm || '').trim()
        });
      }
      return;
    }
    if ((showToolDetails || idx === total - 1) && tool.summary && tool.status !== 'running') {
      for (const line of String(tool.summary).split('\n')) {
        pushWrappedRow(rows, { kind: 'activity-summary', text: line || ' ', color: 'gray' }, Math.max(8, contentWidth - 4));
      }
    }
  };

  const visiblePendingToolCalls = (existingCalls = []) => {
    const pendingToolCalls = Array.isArray(msg?.pendingToolCalls) ? msg.pendingToolCalls : [];
    return pendingToolCalls.filter((pending) => {
      if (!pending) return false;
      if (pending.id && existingCalls.some((tool) => tool?.id && tool.id === pending.id)) return false;
      const pendingBase = parseToolDisplayName(pending.name).base;
      return !existingCalls.some(
        (tool) => parseToolDisplayName(tool?.name).base === pendingBase && tool?.status === 'running'
      );
    });
  };

  if (Array.isArray(msg?.segments) && msg.segments.length > 0) {
    const segmentTools = msg.segments.filter(
      (segment) =>
        segment.type === 'tool' ||
        segment.type === 'skill' ||
        (segment.type === 'system_tool' && (showToolDetails || !isIndexSystemToolName(segment.name)))
    );
    const pendingToolCalls = visiblePendingToolCalls(segmentTools);
    const totalTools = segmentTools.length + pendingToolCalls.length;
    let toolIndex = 0;
    for (const segment of msg.segments) {
      if (segment.type === 'handoff') {
        continue;
      }
      if (segment.type === 'tool' || segment.type === 'skill' || segment.type === 'system_tool') {
        if (segment.type === 'system_tool' && !showToolDetails && isIndexSystemToolName(segment.name)) {
          continue;
        }
        pushActivityRows(segment, toolIndex, totalTools);
        toolIndex += 1;
      } else {
        pushTextRows(segment.text || '');
      }
    }
    pendingToolCalls.forEach((tool) => {
      pushActivityRows(tool, toolIndex, totalTools);
      toolIndex += 1;
    });
  } else {
    pushTextRows(msg?.text || '');
    const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls : [];
    const visibleCalls = [...toolCalls, ...visiblePendingToolCalls(toolCalls)];
    visibleCalls.forEach((tool, idx) => pushActivityRows(tool, idx, visibleCalls.length));
  }

  const codeGenerationRows = getCodeGenerationActivityRows(msg);
  const generatingCodeRows = getGeneratingCodePlaceholderRows(msg, copy, contentWidth);
  const trailingRows = [];
  if (msg?.loading && (msg?.liveStatus || msg?.phase)) {
    pushWrappedRow(
      trailingRows,
      {
        kind: 'status',
        text: trimText(msg.liveStatus || msg.phase, 144)
      },
      Math.max(8, contentWidth - 2)
    );
  }

  const rowsWithCodePreview = insertRowsAfterLastCodeRow(
    collapseActivityChainRows(rows, showToolDetails, copy),
    [...codeGenerationRows, ...generatingCodeRows]
  );
  return normalizeActivitySpacingRows([...rowsWithCodePreview, ...trailingRows]);
}

export function renderMessageRow(msg, row, idx, loaderTick) {
  if (row.kind === 'activity') {
    const activity = { type: row.activityType, name: row.name, status: row.status };
    const display = getActivityDisplayParts(activity);
    const dotColor =
      row.status === 'error' || row.status === 'blocked'
        ? 'redBright'
        : row.status === 'done'
          ? 'greenBright'
          : 'yellowBright';
    const textColor =
      activity.type === 'skill'
        ? row.status === 'error'
          ? 'redBright'
          : 'cyanBright'
        : activity.type === 'system_tool'
          ? row.status === 'error' || row.status === 'blocked'
            ? 'redBright'
            : 'blueBright'
        : row.status === 'error' || row.status === 'blocked'
          ? 'redBright'
          : 'cyanBright';
    const durationText = formatActivityDurationText(row);
    const trailingLoader =
      row.status === 'running'
        ? h(Text, { color: 'gray' }, ` ${SPINNER_FRAMES[loaderTick % SPINNER_FRAMES.length]}`)
        : null;
    return h(
      Box,
      { key: `row-tool-${msg.id}-${idx}` },
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: dotColor }, '●'),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: textColor }, display.primary),
      h(Text, { color: 'gray' }, display.secondary),
      durationText ? h(Text, { color: row.statusColor }, ` ${durationText}`) : null,
      trailingLoader
    );
  }
  if (row.kind === 'activity-summary') {
    return h(
      Box,
      { key: `row-tool-summary-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray' }, `└ ${row.text}`)
    );
  }
  if (row.kind === 'todo-item') {
    const marker =
      row.status === 'completed' ? '[✓]' : row.status === 'in_progress' ? '[*]' : '[ ]';
    const color =
      row.status === 'completed' ? 'gray' : row.status === 'in_progress' ? 'white' : 'gray';
    const dimColor = row.status === 'completed';
    return h(
      Box,
      { key: `row-todo-${msg.id}-${idx}`, marginLeft: 2 },
      h(Text, { color: 'gray' }, '  '),
      h(Text, { color }, marker),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color, dimColor }, row.text || row.activeForm || ' ')
    );
  }
  if (row.kind === 'todo-gap') {
    return h(Box, { key: `row-todo-gap-${msg.id}-${idx}`, marginTop: 1 }, h(Text, { color: 'gray' }, ' '));
  }
  if (row.kind === 'table') {
    return h(
      Box,
      { key: `row-table-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'white', bold: Boolean(row.isHeader) }, row.text)
    );
  }
  if (row.kind === 'table-separator') {
    return h(
      Box,
      { key: `row-table-sep-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'white' }, row.text)
    );
  }
  if (row.kind === 'table-vertical') {
    return h(
      Box,
      { key: `row-table-v-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'white', bold: true }, `${row.label}:`),
      h(Text, { color: 'white' }, row.text ? ` ${row.text}` : '')
    );
  }
  if (row.kind === 'table-vertical-continuation') {
    return h(
      Box,
      { key: `row-table-vc-${msg.id}-${idx}`, marginLeft: 3 },
      h(Text, { color: 'white' }, row.text)
    );
  }
  if (row.kind === 'table-vertical-separator') {
    return h(
      Box,
      { key: `row-table-vs-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'white' }, row.text)
    );
  }
  if (row.kind === 'activity-collapsed') {
    return h(
      Box,
      { key: `row-tool-collapsed-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray' }, `└ ${row.text}`)
    );
  }
  if (row.kind === 'plan-progress') {
    // Already shown in header badge — skip inline rendering
    return null;
  }
  if (row.kind === 'status') {
    const spinnerChar = SPINNER_FRAMES[loaderTick % SPINNER_FRAMES.length];
    return h(
      Box,
      { key: `row-status-${msg.id}-${idx}`, marginTop: 1 },
      h(Text, { color: 'gray' }, '  '),
      h(Text, { color: 'gray', dimColor: true }, `${row.text} ${spinnerChar}`)
    );
  }
  if (row.kind === 'quote') {
    return h(
      Box,
      { key: `row-quote-${msg.id}-${idx}`, marginTop: 1, marginLeft: 1, paddingLeft: 1 },
      h(Text, { color: 'yellow' }, '▍ '),
      h(Text, { color: row.color }, ...renderInlineCode(row.text, row.color))
    );
  }
  if (row.kind === 'tree') {
    return h(
      Box,
      { key: `row-tree-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: row.color }, row.text)
    );
  }
  if (row.kind === 'code') {
    return h(
      Box,
      { key: `row-code-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray' }, row.text)
    );
  }
  if (row.kind === 'code-placeholder') {
    return h(
      Box,
      { key: `row-code-placeholder-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray', dimColor: true }, String(row.lineNo || idx + 1).padStart(2, ' ')),
      h(Text, { color: 'gray' }, ' │ '),
      h(Text, { color: 'gray', dimColor: true }, row.text)
    );
  }
  return renderTextLine(msg, row.text, idx, row.color);
}

function renderMessageRowsInOrder(msg, rows, loaderTick, copy) {
  return rows.map((row, idx) => renderMessageRow(msg, row, idx, loaderTick));
}


function groupCommandSuggestions(items) {
  const categoryMap = {
    help: 'Core',
    exit: 'Core',
    commands: 'Core',
    status: 'Runtime',
    mode: 'Runtime',
    compact: 'Runtime',
    retry: 'Runtime',
    tasks: 'Workspace',
    checkpoint: 'Workspace',
    history: 'Workspace',
    config: 'Config',
    debug: 'Config',
    spec: 'Planning',
    plan: 'Planning',
    agents: 'Planning'
  };
  const grouped = new Map();
  for (const item of items) {
    const value = typeof item === 'string' ? item : String(item?.value || '');
    const root = String(value || '').trim().slice(1).split(/\s+/)[0] || 'other';
    const category = categoryMap[root] || 'Other';
    if (!grouped.has(category)) grouped.set(category, []);
    grouped.get(category).push(item);
  }
  return Array.from(grouped.entries());
}

function getSuggestionValue(item) {
  return typeof item === 'string' ? item : String(item?.value || '');
}

function getSuggestionDisplay(item) {
  return typeof item === 'string' ? item : String(item?.display || item?.value || '');
}

function getSuggestionDescription(item) {
  return typeof item === 'string' ? '' : String(item?.description || '');
}

export function formatSuggestionDescription(text, maxChars = 40) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';
  const limit = Math.max(4, Number(maxChars) || 40);
  if (value.length <= limit) return value;
  return `${value.slice(0, limit - 3)}...`;
}

export function getSuggestionPageState(commandSuggestions, menuIndex, pageSize = SUGGESTION_PAGE_SIZE) {
  const items = Array.isArray(commandSuggestions) ? commandSuggestions : [];
  const normalizedPageSize = Math.max(1, Number(pageSize) || SUGGESTION_PAGE_SIZE);
  const safeIndex = items.length === 0 ? 0 : Math.max(0, Math.min(Number(menuIndex) || 0, items.length - 1));
  const pageIndex = Math.floor(safeIndex / normalizedPageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / normalizedPageSize));
  const pageStart = pageIndex * normalizedPageSize;
  const pageEnd = Math.min(items.length, pageStart + normalizedPageSize);
  return {
    pageSize: normalizedPageSize,
    safeIndex,
    pageIndex,
    pageCount,
    pageStart,
    pageEnd,
    pageItems: items.slice(pageStart, pageEnd)
  };
}

export function moveSuggestionSelection(currentIndex, itemCount, direction, pageSize = SUGGESTION_PAGE_SIZE) {
  const total = Math.max(0, Number(itemCount) || 0);
  if (total <= 0) return 0;
  const normalizedPageSize = Math.max(1, Number(pageSize) || SUGGESTION_PAGE_SIZE);
  const safeIndex = Math.max(0, Math.min(Number(currentIndex) || 0, total - 1));

  if (direction === 'left') {
    if (safeIndex < normalizedPageSize) return 0;
    return Math.max(0, safeIndex - normalizedPageSize);
  }

  if (direction === 'right') {
    const currentPageStart = Math.floor(safeIndex / normalizedPageSize) * normalizedPageSize;
    const currentPageEnd = Math.min(total, currentPageStart + normalizedPageSize);
    if (currentPageEnd >= total) return safeIndex;
    return Math.min(total - 1, safeIndex + normalizedPageSize);
  }

  if (direction === 'up') {
    return Math.max(0, safeIndex - 1);
  }

  if (direction === 'down') {
    return Math.min(total - 1, safeIndex + 1);
  }

  return safeIndex;
}

const MessageBubble = React.memo(function MessageBubble({ msg, loaderTick, showToolDetails, rowWindow = null, contentWidth = 72, copy }) {
  if (msg?.dividerType === 'compact') {
    return h(
      Box,
      { marginY: 1, flexDirection: 'row' },
      h(Text, { color: 'yellow', dimColor: true }, '─── '),
      h(Text, { color: 'yellow' }, msg.text || '以上内容已压缩'),
      h(Text, { color: 'yellow', dimColor: true }, ' ───')
    );
  }
  if (msg?.planStrip) {
    return h(PlanStrip, { planState: msg.planState, copy });
  }
  if (msg?.planSummary || parseAutoPlanSummaryMessage(msg?.text)) {
    return h(PlanSummaryBubble, { msg, copy });
  }
  const theme = roleStyle(msg.label);
  const allRows = buildMessageRows(msg, showToolDetails, contentWidth, copy);
  const start = rowWindow ? Math.max(0, rowWindow.start || 0) : 0;
  const end = rowWindow ? Math.max(start, rowWindow.end || allRows.length) : allRows.length;
  const visibleRows = allRows.slice(start, end);
  const rendered = renderMessageRowsInOrder(msg, visibleRows, loaderTick, copy);
  const autoSkillBadge = formatAutoSkillBadge(msg.autoSkillNames, copy);

  return h(
    Box,
    { marginBottom: 1, flexDirection: 'row' },
    h(Box, { width: 2 }, h(Text, { color: theme.accent }, '│')),
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: theme.border,
        paddingX: 1,
        paddingY: 0,
        width: '100%'
      },
      h(
        Box,
        { justifyContent: 'space-between', marginBottom: rendered.length > 0 ? 1 : 0 },
        h(
          Box,
          null,
          h(Text, { color: theme.badgeText, backgroundColor: theme.badgeBg }, ` ${messageLabel(msg.label, copy)} `),
          msg.planStep ? h(Text, { color: 'gray', dimColor: true }, ` ${msg.planStep} `) : null
        ),
        autoSkillBadge
          ? h(Text, { color: 'blueBright' }, autoSkillBadge)
          : h(Text, { color: theme.chrome }, ' ')
      ),
      ...rendered,
      shouldShowCompletionFooter(msg)
        ? h(
            Box,
            { marginTop: 1, flexDirection: 'column', key: `row-completion-${msg.id}` },
            h(FileChangeSummary, { segments: msg.segments, copy }),
            h(Box, { marginLeft: 1, marginTop: 1 },
              h(Text, { color: 'gray', dimColor: true }, copy.generic.taskCompleted)
            )
          )
        : null
    )
  );
}, (prev, next) => {
  if (prev.msg === next.msg &&
      prev.showToolDetails === next.showToolDetails &&
      prev.contentWidth === next.contentWidth &&
      prev.copy === next.copy) return true;
  return false;
});

function MessageList({ messages, loaderTick, showToolDetails, contentWidth = 72, copy }) {
  return h(
    Box,
    {
      flexDirection: 'column',
      paddingX: 0,
      paddingY: 0
    },
    messages.length === 0 ? h(Text, { color: 'gray' }, copy.generic.noMessagesYet) : null,
    ...messages.map((message) =>
      h(MessageBubble, {
        key: message.id,
        msg: message,
        loaderTick: message.loading ? loaderTick : 0,
        showToolDetails,
        contentWidth,
        copy
      })
    )
  );
}

function SuggestionPanel({ commandSuggestions, suggestionNav, menuIndex, copy }) {
  if (commandSuggestions.length === 0) return null;
  const pageState = getSuggestionPageState(commandSuggestions, menuIndex);
  const grouped = groupCommandSuggestions(pageState.pageItems);
  let flatIndex = -1;
  const panelHint =
    commandSuggestions.length === 1
      ? copy.suggestion.singleTab
      : suggestionNav
        ? copy.suggestion.navFill
        : copy.suggestion.navEnter;
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'magenta',
      paddingX: 1,
      paddingY: 0
    },
    h(
      Box,
      { marginBottom: 1 },
      h(Text, { color: 'magentaBright' }, suggestionNav ? copy.generic.commandPaletteGroupedSelect : copy.generic.commandPaletteGroupedSuggestions),
      h(Text, { color: 'gray' }, `  ${panelHint}  ·  ${pageState.pageIndex + 1}/${pageState.pageCount}`)
    ),
    ...grouped.flatMap(([group, items]) => {
      const nodes = [
        h(
          Box,
          { key: `group-${group}`, marginBottom: 0 },
          h(Text, { color: 'gray' }, `${group.toUpperCase()} `),
          h(Text, { color: 'black', backgroundColor: 'gray' }, ` ${items.length} `)
        )
      ];
      items.forEach((c) => {
        flatIndex += 1;
        const active = suggestionNav && menuIndex === pageState.pageStart + flatIndex;
        const label = getSuggestionDisplay(c);
        const description = formatSuggestionDescription(getSuggestionDescription(c), 42);
        nodes.push(
          h(
            Box,
            { key: `opt-${group}-${getSuggestionValue(c)}` },
            h(Text, { color: active ? 'black' : 'magenta', backgroundColor: active ? 'magentaBright' : undefined }, `${active ? ' > ' : '   '}${label}`),
            description
              ? h(Text, { color: active ? 'black' : 'gray', backgroundColor: active ? 'magentaBright' : undefined }, `  ${description}`)
              : null
          )
        );
      });
      return nodes;
    })
  );
}

function PendingPanel({ pendingQueue, copy }) {
  if (pendingQueue.length === 0) return null;
  return h(
    Box,
    {
      marginTop: 0,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: 'cyanBright' }, `${copy.generic.pendingQueue} | ${pendingQueue.length}`),
    ...pendingQueue
      .slice(0, 3)
      .map((p, idx) =>
        h(Text, { key: `pending-${idx}`, color: 'cyan' }, `- ${typeof p === 'string' ? p : p.line}`)
      )
  );
}

function describeCommandHint(commandSuggestions, suggestionNav, copy) {
  const count = Array.isArray(commandSuggestions) ? commandSuggestions.length : 0;
  if (count === 0) {
    return copy.suggestion.noSuggestions;
  }
  if (count === 1) {
    return suggestionNav ? copy.suggestion.oneNav : copy.suggestion.oneIdle;
  }
  return suggestionNav ? copy.suggestion.manyNav(count) : copy.suggestion.manyIdle(count);
}

function buildHistoryMatches(history, needle) {
  const source = Array.isArray(history) ? history : [];
  const query = String(needle || '').toLowerCase();
  const items = [];
  const seen = new Set();
  for (let i = source.length - 1; i >= 0; i -= 1) {
    const entry = String(source[i] || '');
    const key = entry.toLowerCase();
    if (query && !key.startsWith(query)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    items.push(entry);
  }
  return items;
}

function InputBar({
  beforeCursor,
  underCursor,
  afterCursor,
  cursorVisible,
  busy,
  disabled = false,
  disabledText = '',
  inputStage,
  pendingQueueLength,
  showToolDetails,
  runtimeStatus,
  commandSuggestions,
  suggestionNav,
  copy
}) {
  const status = stageDescriptor(inputStage, busy, runtimeStatus, copy);
  const commandHint = describeCommandHint(commandSuggestions, suggestionNav, copy);
  return h(
    Box,
    {
      marginTop: 0,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'cyan',
      paddingX: 1,
      paddingY: 0
    },
    h(
      Box,
      { justifyContent: 'space-between', marginBottom: 1 },
      h(
        Box,
        null,
        h(Text, { color: 'cyanBright' }, copy.generic.commandBar),
        h(Text, { color: 'gray' }, `  ${commandHint}`)
      ),
      h(
        Box,
        { flexDirection: 'column', alignItems: 'flex-end' },
        h(Text, { color: showToolDetails ? 'greenBright' : 'gray' }, ` ${copy.generic.tools} ${showToolDetails ? copy.generic.open : copy.generic.collapsed}`),
        pendingQueueLength > 0 ? h(Text, { color: 'cyanBright' }, ` ${copy.generic.queued} ${pendingQueueLength}`) : null,
        inputStage !== 'idle' || busy ? h(Text, { color: status.color }, ` ${status.tag}`) : null
      )
    ),
    h(
      Box,
      null,
      h(Text, { color: 'cyan' }, 'codemini> '),
      disabled
        ? h(Text, { color: 'gray' }, disabledText || '')
        : [
            h(Text, { key: 'before', color: 'white' }, beforeCursor),
            h(
              Text,
              {
                key: 'cursor',
                color: cursorVisible ? 'black' : 'white',
                backgroundColor: cursorVisible ? 'cyanBright' : undefined
              },
              underCursor || ' '
            ),
            h(Text, { key: 'after', color: 'white' }, afterCursor)
          ]
    )
  );
}

function ApprovalCursorLine({ inputValue, placeholder, cursorVisible, accent }) {
  if (inputValue) {
    return h(
      Box,
      null,
      h(Text, { color: 'white' }, inputValue),
      h(
        Text,
        { color: cursorVisible ? 'black' : accent, backgroundColor: cursorVisible ? accent : undefined },
        ' '
      )
    );
  }
  return h(
    Box,
    null,
    h(
      Text,
      { color: cursorVisible ? 'black' : accent, backgroundColor: cursorVisible ? accent : undefined },
      ' '
    ),
    placeholder ? h(Text, { color: 'gray' }, placeholder) : null
  );
}

function MarkdownPreviewBlock({ text, contentWidth = 72, msgId = 'approval-md' }) {
  const value = String(text || '').trim();
  if (!value) return null;
  const pseudoMsg = { id: msgId, color: 'white' };
  const rows = buildMarkdownPreviewRows(value, contentWidth, { color: 'gray', skipPlanProgress: true });
  return h(
    Box,
    { flexDirection: 'column' },
    ...rows.map((row, idx) => renderMessageRow(pseudoMsg, row, idx, 0))
  );
}

function CommandPreviewBlock({ command, contentWidth = 72 }) {
  const value = String(command || '').trim();
  if (!value) return null;
  const fenced = `\`\`\`bash\n${value}\n\`\`\``;
  return h(
    Box,
    {
      flexDirection: 'column',
      marginTop: 0,
      borderStyle: 'single',
      borderColor: 'gray',
      paddingX: 1
    },
    h(MarkdownPreviewBlock, {
      text: fenced,
      contentWidth: Math.max(8, contentWidth - 4),
      msgId: 'approval-run-cmd'
    })
  );
}

function DeleteApprovalPanel({ request, inputValue, errorText, copy, cursorVisible }) {
  if (!request) return null;
  const details =
    request?.toolName === 'delete'
      ? request
      : normalizeDeleteApprovalRequest(request);
  if (!details) return null;
  const typeLabel = details.type === 'directory' ? copy.deleteApproval.directoryType : copy.deleteApproval.fileType;
  const pathDisplay = details.path.includes('/') || details.path.includes('\\') ? details.path : `./${details.path}`;
  const placeholder = String(copy.deleteApproval.answerPlaceholder || '').trim();
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'redBright',
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: 'redBright' }, copy.deleteApproval.title),
    h(Text, { color: 'white' }, `${copy.deleteApproval.nameLabel}: ${details.name}`),
    h(Text, { color: 'white' }, `${copy.deleteApproval.pathLabel}: ${pathDisplay}`),
    h(Text, { color: 'white' }, `${copy.deleteApproval.typeLabel}: ${typeLabel}`),
    h(Text, { color: 'gray' }, copy.deleteApproval.prompt),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: 'redBright' }, `${copy.deleteApproval.answerLabel}: `),
      h(ApprovalCursorLine, {
        inputValue,
        placeholder: placeholder || ' ',
        cursorVisible,
        accent: 'redBright'
      })
    ),
    errorText ? h(Text, { color: 'yellowBright' }, errorText) : null
  );
}

function RunApprovalPanel({ request, inputValue, errorText, copy, cursorVisible, contentWidth = 72 }) {
  if (!request) return null;
  const details = request?.toolName === 'run' ? request : normalizeRunApprovalRequest(request);
  if (!details) return null;
  const c = copy.runApproval || {};
  const riskColor = details.risk === 'low' ? 'green' : details.risk === 'medium' ? 'yellow' : 'redBright';
  const borderColor = details.risk === 'medium' ? 'yellow' : 'redBright';
  const riskLabel = details.risk === 'low' ? c.lowRisk : details.risk === 'medium' ? c.mediumRisk : c.highRisk;
  const placeholder = String(c.answerPlaceholder || '').trim();
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor,
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: borderColor }, c.title),
    h(Text, { color: 'gray' }, `${c.commandLabel}:`),
    h(CommandPreviewBlock, { command: details.command, contentWidth }),
    h(Text, null, `${c.riskLabel}: `, h(Text, { color: riskColor, bold: true }, riskLabel || details.risk)),
    details.description ? h(Text, { color: 'gray' }, `${c.descriptionLabel}: ${details.description}`) : null,
    details.sideEffects ? h(Text, { color: 'gray' }, `${c.sideEffectsLabel}: ${details.sideEffects}`) : null,
    h(Text, { color: 'gray' }, c.prompt),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: borderColor }, `${c.answerLabel}: `),
      h(ApprovalCursorLine, {
        inputValue,
        placeholder: placeholder || ' ',
        cursorVisible,
        accent: borderColor
      })
    ),
    errorText ? h(Text, { color: 'yellowBright' }, errorText) : null
  );
}

function FileApprovalPanel({ request, inputValue, errorText, copy, cursorVisible }) {
  if (!request) return null;
  const details = ['edit', 'create', 'write', 'apply_patch'].includes(request?.toolName)
    ? request
    : normalizeFileApprovalRequest(request);
  if (!details) return null;
  const c = copy.fileApproval || {};
  const placeholder = String(c.answerPlaceholder || '').trim();
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'yellowBright',
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: 'yellowBright' }, c.title),
    h(Text, { color: 'white' }, `${c.toolLabel}: ${details.toolName}`),
    h(Text, { color: 'white' }, `${c.pathLabel}: ${details.path}`),
    h(Text, { color: 'white' }, `${c.actionLabel}: ${details.action}`),
    h(Text, { color: 'gray' }, c.prompt),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: 'yellowBright' }, `${c.answerLabel}: `),
      h(ApprovalCursorLine, {
        inputValue,
        placeholder: placeholder || ' ',
        cursorVisible,
        accent: 'yellowBright'
      })
    ),
    errorText ? h(Text, { color: 'yellowBright' }, errorText) : null
  );
}

function FileChangeSummary({ segments, copy }) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  const c = copy.fileChangeSummary || {};
  const changes = new Map();
  for (const seg of segments) {
    if (!seg.fileChange) continue;
    const p = seg.fileChange.path;
    if (!p) continue;
    const existing = changes.get(p);
    if (existing) {
      /* 同一文件多次编辑，合并行数，取最高 action */
      existing.linesAdded += seg.fileChange.linesAdded || 0;
      existing.linesRemoved += seg.fileChange.linesRemoved || 0;
      const ACTION_ORDER = { delete: 3, create: 2, edit: 1 };
      if ((ACTION_ORDER[seg.fileChange.action] || 0) > (ACTION_ORDER[existing.action] || 0)) {
        existing.action = seg.fileChange.action;
      }
    } else {
      changes.set(p, { path: p, action: seg.fileChange.action, linesAdded: seg.fileChange.linesAdded || 0, linesRemoved: seg.fileChange.linesRemoved || 0 });
    }
  }
  if (changes.size === 0) return null;
  const entries = [...changes.values()];
  return h(
    Box,
    { marginTop: 1, flexDirection: 'column', borderStyle: 'round', borderColor: 'gray', paddingX: 1 },
    h(Text, { color: 'cyan', bold: true }, c.title || 'File Changes'),
    ...entries.map((entry) => {
      const statusMap = { edit: c.editStatus || 'Edit', create: c.createStatus || 'Create', delete: c.deleteStatus || 'Delete' };
      const statusColor = entry.action === 'create' ? 'green' : entry.action === 'delete' ? 'red' : 'yellow';
      const statusText = statusMap[entry.action] || entry.action;
      let changesText = '';
      if (entry.action !== 'delete') {
        const parts = [];
        if (entry.linesAdded > 0) parts.push(h(Text, { color: 'green' }, `+${entry.linesAdded}`));
        if (entry.linesRemoved > 0) parts.push(h(Text, { color: 'red' }, `-${entry.linesRemoved}`));
        if (parts.length > 0) {
          changesText = parts.reduce((acc, el, i) => i === 0 ? [el] : [...acc, ' ', el], []);
        }
      }
      return h(
        Box,
        { key: entry.path },
        h(Text, { color: 'white' }, `  ${entry.path}`),
        h(Text, { color: 'gray' }, '  '),
        h(Text, { color: statusColor }, statusText),
        changesText ? h(Text, null, '  ', changesText) : null
      );
    })
  );
}

function SpecApprovalPanel({ request, inputValue, errorText, copy, cursorVisible, contentWidth = 72 }) {
  if (!request) return null;
  const c = copy.specApproval || {};
  const placeholder = String(c.answerPlaceholder || '').trim();
  const goal = String(request.goal || '').trim();
  const summary = String(request.summary || '').trim();
  const filePath = String(request.filePath || '').trim();
  const specText = String(request.specText || '').trim();
  const missingHeadings = Array.isArray(request.missingHeadings) ? request.missingHeadings.filter(Boolean) : [];
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'yellowBright',
      paddingX: 1,
      paddingY: 0
    },
    h(Text, { color: 'yellowBright' }, c.title),
    filePath ? h(Text, { color: 'gray' }, `${c.fileLabel}: ${filePath}`) : null,
    goal ? h(Text, { color: 'gray', marginTop: 1 }, `${c.goalLabel}:`) : null,
    goal ? h(MarkdownPreviewBlock, { text: goal, contentWidth, msgId: 'spec-approval-goal' }) : null,
    summary ? h(Text, { color: 'gray', marginTop: 1 }, `${c.summaryLabel}:`) : null,
    summary ? h(MarkdownPreviewBlock, { text: summary, contentWidth, msgId: 'spec-approval-summary' }) : null,
    missingHeadings.length > 0
      ? h(Text, { color: 'yellowBright', marginTop: 1 }, `${c.missingLabel}: ${missingHeadings.join(', ')}`)
      : null,
    specText
      ? h(MarkdownPreviewBlock, { text: specText, contentWidth, msgId: 'spec-approval-body' })
      : null,
    h(Text, { color: 'gray', marginTop: 1 }, c.prompt),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: 'yellowBright' }, `${c.answerLabel}: `),
      h(ApprovalCursorLine, {
        inputValue,
        placeholder: placeholder || ' ',
        cursorVisible,
        accent: 'yellowBright'
      })
    ),
    errorText ? h(Text, { color: 'yellowBright' }, errorText) : null
  );
}

function ReflectApprovalPanel({ request, inputValue, errorText, copy, cursorVisible }) {
  if (!request) return null;
  const placeholder = String(copy.reflectApproval.answerPlaceholder || '').trim();
  const lines = formatReflectApprovalLines(copy, request);
  return h(
    Box,
    {
      marginTop: 1,
      flexDirection: 'column',
      borderStyle: 'round',
      borderColor: 'yellowBright',
      paddingX: 1,
      paddingY: 0
    },
    ...lines.map((line, index) =>
      h(Text, { key: `reflect-approval-line-${index}`, color: 'yellowBright' }, line)
    ),
    h(
      Box,
      { marginTop: 1 },
      h(Text, { color: 'yellowBright' }, `${copy.reflectApproval.answerLabel}: `),
      h(ApprovalCursorLine, {
        inputValue,
        placeholder: placeholder || ' ',
        cursorVisible,
        accent: 'yellowBright'
      })
    ),
    errorText ? h(Text, { color: 'yellowBright' }, errorText) : null
  );
}

function SignatureBar({ version = '' }) {
  return h(
    Box,
    {
      marginTop: 1,
      width: '100%',
      justifyContent: 'space-between'
    },
    h(Text, { color: 'gray' }, ' '),
    h(
      Box,
      { flexGrow: 1, justifyContent: 'center' },
      h(Text, { color: 'gray' }, 'developed by '),
      h(Text, { color: 'magentaBright' }, '@havingautism')
    ),
    h(Text, { color: 'gray' }, `v${version}`)
  );
}

function makeStatus(title, detail = '', color = 'gray') {
  return { title, detail, color };
}

function formatRuntimeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return '';
  return [
    `mode=${snapshot.mode || '-'}`,
    `role=${snapshot.agentRole || 'general'}`,
    `model=${snapshot.model || '-'}`,
    `max_ctx=${snapshot.maxContextTokens || '-'}`,
    `session=${snapshot.sessionId || '-'}`
  ].join(' | ');
}

function makeIdleStatus(copy, snapshot, variant = 'ready') {
  return makeStatus(
    variant === 'after' ? copy.runtime.idleAfterTurn : copy.runtime.idleReady,
    formatRuntimeSnapshot(snapshot) || (variant === 'after' ? copy.runtime.idleAfterTurnDetail : copy.runtime.idleReadyDetail),
    'gray'
  );
}

export function ChatApp({ runtime, sessionId, model, sdkProvider = 'openai-compatible', language = 'zh', shellName = 'powershell', version = '', safeMode = true }) {
  const copy = getCopy(language);
  const stdoutCols = Number(process.stdout?.columns || 120);
  const [inputValue, setInputValue] = useState('');
  const [cursorIndex, setCursorIndex] = useState(0);
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(null);
  const [draftBeforeHistory, setDraftBeforeHistory] = useState('');
  const [historyMatches, setHistoryMatches] = useState([]);
  const [menuIndex, setMenuIndex] = useState(0);
  const [suggestionNav, setSuggestionNav] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);
  const [displaySessionId, setDisplaySessionId] = useState(sessionId);
  const [displayModel, setDisplayModel] = useState(model);
  const [displaySdkProvider, setDisplaySdkProvider] = useState(sdkProvider);
  const [pendingQueue, setPendingQueue] = useState([]);
  const [loaderTick, setLoaderTick] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState(
    makeIdleStatus(copy, runtime.getRuntimeState?.(), 'ready')
  );
  const [runtimeState, setRuntimeState] = useState(runtime.getRuntimeState?.() || null);
  const [inputStage, setInputStage] = useState('idle');
  const [planState, setPlanState] = useState({
    current: 0,
    total: 0,
    role: '',
    title: '',
    failed: false,
    steps: [],
    pendingApproval: false,
    completed: false,
    resultStatus: '',
    resultVerified: '',
    resultNext: ''
  });
  const [debugKeys, setDebugKeys] = useState(false);
  const [lastKeyDebug, setLastKeyDebug] = useState('');
  const [showToolDetails, setShowToolDetails] = useState(false);
  const [pendingDeleteApproval, setPendingDeleteApproval] = useState(null);
  const [deleteApprovalInput, setDeleteApprovalInput] = useState('');
  const [deleteApprovalError, setDeleteApprovalError] = useState('');
  const [pendingRunApproval, setPendingRunApproval] = useState(null);
  const [runApprovalInput, setRunApprovalInput] = useState('');
  const [runApprovalError, setRunApprovalError] = useState('');
  const [pendingFileApproval, setPendingFileApproval] = useState(null);
  const [fileApprovalInput, setFileApprovalInput] = useState('');
  const [fileApprovalError, setFileApprovalError] = useState('');
  const [pendingSpecApproval, setPendingSpecApproval] = useState(null);
  const [specApprovalInput, setSpecApprovalInput] = useState('');
  const [specApprovalError, setSpecApprovalError] = useState('');
  const [pendingReflectApproval, setPendingReflectApproval] = useState(null);
  const [reflectApprovalInput, setReflectApprovalInput] = useState('');
  const [reflectApprovalError, setReflectApprovalError] = useState('');
  const approvalLockActive = Boolean(pendingDeleteApproval || pendingRunApproval || pendingFileApproval || pendingSpecApproval || pendingReflectApproval);
  const activeAssistantIdRef = useRef(null);
  const activeAssistantAutoSkillNamesRef = useRef([]);
  const streamedAssistantHandledRef = useRef(false);
  const activeUserMessageIdRef = useRef(null);
  const cursorIndexRef = useRef(0);
  const inFlightRef = useRef(false);
  const messagesRef = useRef([]);
  const pendingQueueRef = useRef([]);
  const deltaBufferRef = useRef('');
  const activePlanStepNumberRef = useRef(0);
  const activePlanStepRoleRef = useRef(null);
  const activePlanStepInfoRef = useRef(null);
  const activePlanStepTitleRef = useRef('');
  const deleteApprovalResolverRef = useRef(null);
  const runApprovalResolverRef = useRef(null);
  const fileApprovalResolverRef = useRef(null);

  useEffect(() => {
    const rawStartupActivities = runtime.consumeStartupEvents?.();
    const startupActivities = Array.isArray(rawStartupActivities) ? rawStartupActivities : [];
    if (startupActivities.length === 0) return;
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        label: 'system',
        text: '',
        color: 'yellowBright',
        toolCalls: startupActivities,
        segments: startupActivities
      }
    ]);
  }, [runtime]);
  const deltaFlushTimerRef = useRef(null);
  const escSeqRef = useRef('');
  const planTextBufferRef = useRef('');
  const { exit } = useApp();

  useEffect(() => {
    if (typeof runtime.setRequestToolApproval !== 'function') return () => {};
    runtime.setRequestToolApproval((request) => {
      const deleteNorm = normalizeDeleteApprovalRequest(request);
      if (deleteNorm) {
        setDeleteApprovalInput('');
        setDeleteApprovalError('');
        setPendingDeleteApproval(deleteNorm);
        return new Promise((resolve) => {
          deleteApprovalResolverRef.current = resolve;
        });
      }
      const runNorm = normalizeRunApprovalRequest(request);
      if (runNorm) {
        setRunApprovalInput('');
        setRunApprovalError('');
        setPendingRunApproval(runNorm);
        return new Promise((resolve) => {
          runApprovalResolverRef.current = resolve;
        });
      }
      const fileNorm = normalizeFileApprovalRequest(request);
      if (fileNorm) {
        setFileApprovalInput('');
        setFileApprovalError('');
        setPendingFileApproval(fileNorm);
        return new Promise((resolve) => {
          fileApprovalResolverRef.current = resolve;
        });
      }
      return Promise.resolve({ approved: false });
    });
    return () => {
      runtime.setRequestToolApproval(null);
      deleteApprovalResolverRef.current = null;
      runApprovalResolverRef.current = null;
      fileApprovalResolverRef.current = null;
    };
  }, [runtime]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const startupHints = copy.generic.startupHints;
  const startupHint = useMemo(() => {
    const arr = Array.isArray(startupHints) ? startupHints : [];
    if (arr.length === 0) return '';
    return arr[Math.floor(Math.random() * arr.length)];
  }, [startupHints]);
  const isBackspaceKey = (value, key) =>
    Boolean(key?.backspace) || value === '\u0008' || value === '\u007f' || (key?.ctrl && value === 'h');
  const isDeleteKey = (value, key) =>
    Boolean(key?.delete) ||
    (key?.ctrl && value === 'd') ||
    value === '\u001b[3~' ||
    value === '\u001b[3;2~' ||
    value === '\u001b[3;5~';
  const isPrintableInput = (value, key) => {
    if (!value || key?.ctrl || key?.meta) return false;
    if (value.includes('\u001b')) return false;
    for (const ch of value) {
      const code = ch.codePointAt(0) || 0;
      if (code < 32 || code === 127) return false;
    }
    return true;
  };

  const nextId = useMemo(() => {
    let id = 0;
    return () => {
      id += 1;
      return `m-${id}`;
    };
  }, []);

  const commandSuggestions =
    inputValue.startsWith('/')
      ? runtime.getCompletionOptions(inputValue) || []
      : [];
  const hasTransientPanels =
    commandSuggestions.length > 0 || pendingQueue.length > 0 || debugKeys || Boolean(planState?.total);
  const messageContentWidth = Math.max(24, stdoutCols - 8);

  const syncRuntimeVisualState = (variant = 'ready') => {
    const snapshot = runtime.getRuntimeState?.();
    if (!snapshot) return;
    setDisplaySessionId(snapshot.sessionId || sessionId);
    setDisplayModel(snapshot.model || model);
    setDisplaySdkProvider(snapshot.sdkProvider || sdkProvider);
    setRuntimeState((prev) => {
      if (!prev || !planTextBufferRef.current) return snapshot;
      const prevTokens = Number(prev.currentContextTokens || 0);
      const newTokens = Number(snapshot.currentContextTokens || 0);
      if (newTokens < prevTokens) {
        return { ...snapshot, currentContextTokens: prevTokens, contextUsagePct: prev.contextUsagePct };
      }
      return snapshot;
    });
    setRuntimeStatus(makeIdleStatus(copy, snapshot, variant));
  };

  const refreshRuntimeSnapshot = () => {
    const snapshot = runtime.getRuntimeState?.();
    if (!snapshot) return;
    setDisplaySessionId(snapshot.sessionId || sessionId);
    setDisplayModel(snapshot.model || model);
    setDisplaySdkProvider(snapshot.sdkProvider || sdkProvider);
    setRuntimeState((prev) => {
      if (!prev || !planTextBufferRef.current) return snapshot;
      const prevTokens = Number(prev.currentContextTokens || 0);
      const newTokens = Number(snapshot.currentContextTokens || 0);
      if (newTokens < prevTokens) {
        return { ...snapshot, currentContextTokens: prevTokens, contextUsagePct: prev.contextUsagePct };
      }
      return snapshot;
    });
  };

  useEffect(() => {
    syncRuntimeVisualState('ready');
  }, []);

  const updatePlanProgressFromText = (chunk) => {
    if (!chunk) return;
    planTextBufferRef.current = `${planTextBufferRef.current}${chunk}`.slice(-1200);
    const pattern = /\[plan\]\s+Step\s+(\d+)\/(\d+)\s+->\s+([^:]+):\s+([^\n\r]+)/gi;
    let match;
    let last = null;
    while ((match = pattern.exec(planTextBufferRef.current))) {
      last = match;
    }
    if (!last) return;
    const current = Number(last[1]);
    const total = Number(last[2]);
    const role = String(last[3] || '').trim().toLowerCase();
    const normalizedRole = PLAN_AGENT_ROLES.has(role) ? role : 'coder';
    const title = String(last[4] || '').trim();

    // Detect step transition — finalize old assistant and create a new one
    if (activePlanStepNumberRef.current > 0 && current !== activePlanStepNumberRef.current) {
      flushAssistantDelta();
      const oldId = activeAssistantIdRef.current;
      if (oldId) {
        finalizeActiveAssistant();
        activeAssistantIdRef.current = null;
      }
    }
    activePlanStepNumberRef.current = current;

    activePlanStepRoleRef.current = normalizedRole;
    activePlanStepInfoRef.current = { current, total };
    activePlanStepTitleRef.current = title;
    setActiveAssistantMeta({
      label: normalizedRole,
      planStepInfo: { current, total },
      planStep: `${current}/${total} · ${title}`
    });
    setPlanState((prev) => {
      let steps = (prev.steps || [])
        .map((step) => (step.status === 'active' ? { ...step, status: 'done' } : step))
        .filter((step, idx, arr) => arr.findIndex((x) => x.index === step.index) === idx);

      const withoutCurrent = steps.filter((step) => step.index !== current);
      return {
        current,
        total,
        role,
        title,
        failed: false,
        pendingApproval: false,
        completed: false,
        resultStatus: '',
        resultVerified: '',
        resultNext: '',
        steps: [...withoutCurrent, { index: current, total, role, title, status: 'active' }].sort((a, b) => a.index - b.index)
      };
    });
  };

  const flushAssistantDelta = () => {
    const targetId = activeAssistantIdRef.current;
    const delta = deltaBufferRef.current;
    if (!targetId || !delta) return;
    deltaBufferRef.current = '';
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== targetId) return m;
        const segments = Array.isArray(m.segments) ? [...m.segments] : [];
        const last = segments.at(-1);
        if (last?.type === 'text') {
          segments[segments.length - 1] = { ...last, text: `${last.text || ''}${delta}` };
        } else {
          segments.push({ type: 'text', text: delta });
        }
        const nextText = m.syntheticPrelude ? delta : `${m.text}${delta}`;
        return {
          ...m,
          text: nextText,
          segments,
          syntheticPrelude: false
        };
      })
    );
  };

  const queueAssistantDelta = (chunk) => {
    if (!chunk) return;
    deltaBufferRef.current += chunk;
    if (deltaFlushTimerRef.current) return;
    deltaFlushTimerRef.current = setTimeout(() => {
      deltaFlushTimerRef.current = null;
      flushAssistantDelta();
    }, 40);
  };

  const updateActivityStatusOnActiveAssistant = (toolEvent) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== targetId) return m;
        const toolCalls = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
        const pendingToolCalls = Array.isArray(m.pendingToolCalls) ? [...m.pendingToolCalls] : [];
        const activityType = toolEvent.type || 'tool';
        const idx = findActivityUpdateIndex(toolCalls, toolEvent);
        const startedAt = toolEvent.status === 'running' ? Date.now() : undefined;

        if (idx === -1) {
          toolCalls.push({
            type: activityType,
            id: toolEvent.id || '',
            name: toolEvent.name,
            ...(toolEvent.displayName ? { displayName: toolEvent.displayName } : {}),
            status: toolEvent.status,
            ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
            ...(startedAt ? { startedAt } : {}),
            ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
            ...(toolEvent.summary ? { summary: toolEvent.summary } : {}),
            ...(toolEvent.fileChange ? { fileChange: toolEvent.fileChange } : {})
          });
        } else {
          toolCalls[idx] = {
            ...toolCalls[idx],
            type: activityType,
            id: toolEvent.id || toolCalls[idx].id,
            status: toolEvent.status,
            ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
            ...(startedAt ? { startedAt } : {}),
            ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
            ...(toolEvent.summary
              ? { summary: mergeActivitySummary(toolCalls[idx].summary, toolEvent.summary, toolEvent.name) }
              : {})
          };
        }
        const segments = Array.isArray(m.segments) ? [...m.segments] : [];
        const segmentIdx = findActivityUpdateIndex(segments, toolEvent);
        const patch = {
          type: activityType,
          id: toolEvent.id || '',
          name: toolEvent.name,
          ...(toolEvent.displayName ? { displayName: toolEvent.displayName } : {}),
          status: toolEvent.status,
          ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
          ...(startedAt ? { startedAt } : {}),
          ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
          ...(toolEvent.summary ? { summary: toolEvent.summary } : {}),
          ...(toolEvent.fileChange ? { fileChange: toolEvent.fileChange } : {})
        };
        if (segmentIdx === -1) {
          segments.push(patch);
        } else {
          segments[segmentIdx] = {
            ...segments[segmentIdx],
            ...patch,
            ...(toolEvent.summary
              ? { summary: mergeActivitySummary(segments[segmentIdx].summary, toolEvent.summary, toolEvent.name) }
              : {})
          };
        }
        const shouldClearPending =
          activityType === 'tool' && ['running', 'done', 'blocked', 'error'].includes(toolEvent.status);
        const nextPendingToolCalls = shouldClearPending
          ? pendingToolCalls.filter((entry) => {
              if (!entry) return false;
              if (toolEvent.id && entry.id) return entry.id !== toolEvent.id;
              return parseToolDisplayName(entry.name).base !== parseToolDisplayName(toolEvent.name).base;
            })
          : pendingToolCalls;
        return { ...m, toolCalls, segments, pendingToolCalls: nextPendingToolCalls };
      })
    );
  };

  const updateMessageMeta = (messageId, patch) => {
    if (!messageId) return;
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
  };

  const appendResultMessage = (result) => {
    if (result.type === 'noop') return;
    if (Array.isArray(result.restoredMessages)) {
      setMessages(buildUiMessagesFromSessionHistory(result.restoredMessages, nextId));
      syncRuntimeVisualState('after');
    }
    if (
      result.type === 'system' &&
      typeof result.text === 'string' &&
      result.text.startsWith('[debug:keys:')
    ) {
      if (result.text === '[debug:keys:on]') {
        setDebugKeys(true);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'system', text: copy.generic.keyboardDebugEnabled, color: 'yellowBright' }
        ]);
        return;
      }
      if (result.text === '[debug:keys:off]') {
        setDebugKeys(false);
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'system', text: copy.generic.keyboardDebugDisabled, color: 'yellowBright' }
        ]);
        return;
      }
      if (result.text === '[debug:keys:status]') {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            label: 'system',
            text: sanitizeRenderableText(copy.generic.keyboardDebugStatus(debugKeys)),
            color: 'yellowBright'
          }
        ]);
        return;
      }
    }
    if (result.type === 'assistant') {
      const { displayText } = applyPlanExecutionResult(result.text);
      if (!activeAssistantIdRef.current && displayText) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            label: 'general',
            text: sanitizeRenderableText(displayText),
            color: 'greenBright',
            autoSkillNames: activeAssistantAutoSkillNamesRef.current
          }
        ]);
      }
      return;
    }
    const parsedPlanSummary = result.type === 'system' ? parseAutoPlanSummaryMessage(result.text || '') : null;
    if (result.type === 'system') {
      const pendingReflectMeta = parsePendingReflectSkillMessage(result.text || '');
      if (pendingReflectMeta) {
        setPendingReflectApproval(pendingReflectMeta);
        setReflectApprovalInput('');
        setReflectApprovalError('');
      }
    }
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        label: 'system',
        text: sanitizeRenderableText(result.text || ''),
        color: 'yellowBright',
        ...(parsedPlanSummary ? { planSummary: parsedPlanSummary } : {})
      }
    ]);
  };

  const setActiveAssistantMeta = (patch) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId) return;
    setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, ...patch } : m)));
  };

  const updatePendingToolCallOnActiveAssistant = (toolCall) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId || !toolCall) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== targetId) return m;
        const pendingToolCalls = Array.isArray(m.pendingToolCalls) ? [...m.pendingToolCalls] : [];
        const nextCall = {
          id: toolCall.id || '',
          name: toolCall.name || '',
          arguments: typeof toolCall.arguments === 'string'
            ? (() => { const p = safeJsonParse(toolCall.arguments); return p._invalid_json ? toolCall.arguments : p; })()
            : toolCall.arguments,
          status: 'pending',
          type: 'tool'
        };
        const idx = pendingToolCalls.findIndex((entry) => entry.id && entry.id === nextCall.id);
        if (idx === -1) pendingToolCalls.push(nextCall);
        else pendingToolCalls[idx] = { ...pendingToolCalls[idx], ...nextCall };
        return { ...m, pendingToolCalls };
      })
    );
  };

  const finalizeActiveAssistant = () => {
    activePlanStepRoleRef.current = null;
    activePlanStepInfoRef.current = null;
    activePlanStepTitleRef.current = '';
    setActiveAssistantMeta({
      loading: false,
      phase: undefined,
      liveStatus: undefined,
      pendingToolCalls: [],
      codeGenerationEndedAt: undefined,
      autoSkillNames: activeAssistantAutoSkillNamesRef.current
    });
  };

  const applyPlanExecutionResult = (rawText) => {
    const parsedExecution = parsePlanExecutionResult(rawText);
    if (!parsedExecution || !planTextBufferRef.current) return { parsedExecution: null, displayText: rawText };
    setPlanState((prev) => {
      if (!prev.total) return prev;
      return {
        ...prev,
        completed: parsedExecution.status === 'done',
        failed: parsedExecution.status === 'blocked',
        resultStatus: parsedExecution.status || prev.resultStatus,
        resultVerified: parsedExecution.verified || prev.resultVerified,
        resultNext: parsedExecution.next || prev.resultNext,
        steps: (prev.steps || []).map((step) =>
          step.index === prev.current && step.status === 'active'
            ? { ...step, status: parsedExecution.status === 'blocked' ? 'failed' : 'done' }
            : step
        )
      };
    });
    return {
      parsedExecution,
      displayText: stripPlanExecutionResult(rawText)
    };
  };

  const ensureActiveAssistant = () => {
    if (activeAssistantIdRef.current) return activeAssistantIdRef.current;
    const aid = nextId();
    activeAssistantIdRef.current = aid;
    const planRole = activePlanStepRoleRef.current;
    const label = planRole || 'general';
    const style = ROLE_STYLES[label] || ROLE_STYLES.general;
    const planStepInfo = activePlanStepInfoRef.current;
    const planStepTitle = activePlanStepTitleRef.current;
    const planStepDisplay = planStepInfo ? `${planStepInfo.current}/${planStepInfo.total} · ${planStepTitle}` : undefined;
    setMessages((prev) => [
      ...prev,
      {
        id: aid,
        label,
        text: '',
        color: style.text,
        toolCalls: [],
        segments: [],
        loading: true,
        phase: 'thinking',
        liveStatus: copy.runtime.modelThinking,
        autoSkillNames: activeAssistantAutoSkillNamesRef.current,
        ...(planStepInfo ? { planStepInfo } : {}),
        ...(planStepDisplay ? { planStep: planStepDisplay } : {})
      }
    ]);
    return aid;
  };

  const maybeRefreshSyntheticNarration = (nextToolName) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId || !nextToolName) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== targetId) return m;
        if (!hasOnlySyntheticNarration(m)) return m;
        const previousActivity = getLastToolActivity(m, ['done', 'running']);
        if (!previousActivity) return m;
        const bridge = buildInterToolNotice(previousActivity, nextToolName, copy);
        if (!bridge) return m;
        return {
          ...m,
          text: bridge,
          syntheticPrelude: true
        };
      })
    );
  };

  const runSubmission = (line, userMessageId = null) => {
    inFlightRef.current = true;
    activeUserMessageIdRef.current = userMessageId;
    setBusy(true);
    setInputStage('sending');
    setRuntimeStatus(makeStatus(copy.runtime.sendingToGateway, copy.runtime.preparingRequest, 'yellowBright'));
    setPendingSpecApproval(null);
    setSpecApprovalInput('');
    setSpecApprovalError('');
    setPendingReflectApproval(null);
    setReflectApprovalInput('');
    setReflectApprovalError('');
    setPlanState({
      current: 0,
      total: 0,
      role: '',
      title: '',
      failed: false,
      steps: [],
      pendingApproval: false,
      completed: false,
      resultStatus: '',
      resultVerified: '',
      resultNext: ''
    });
    planTextBufferRef.current = '';
    activePlanStepNumberRef.current = 0;
    activeAssistantIdRef.current = null;
    activeAssistantAutoSkillNamesRef.current = [];
    streamedAssistantHandledRef.current = false;
    deltaBufferRef.current = '';

    runtime
      .submit(line, (event) => {
        if (shouldRefreshRuntimeStateForEvent(event)) {
          refreshRuntimeSnapshot();
        }
        if (event?.type === 'assistant:start') {
          streamedAssistantHandledRef.current = true;
          setRuntimeStatus(makeStatus(copy.runtime.modelThinking, copy.runtime.requestDelivered, 'cyanBright'));
          setInputStage('thinking');
          updateMessageMeta(activeUserMessageIdRef.current, {
            loading: false,
            phase: undefined,
            liveStatus: undefined
          });
          ensureActiveAssistant();
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.runtime.modelThinking });
        }
        if (event?.type === 'assistant:delta') {
          ensureActiveAssistant();
          updatePlanProgressFromText(event.text);
          setRuntimeStatus(makeStatus(copy.runtime.generatingReply, copy.runtime.streamingReply, 'greenBright'));
          setInputStage('streaming');
          setActiveAssistantMeta((() => {
            const targetId = activeAssistantIdRef.current;
            let liveStatus = copy.runtime.generatingReply;
            if (targetId) {
              const current = messagesRef.current?.find?.((m) => m.id === targetId);
              const pendingToolCalls = Array.isArray(current?.pendingToolCalls) ? current.pendingToolCalls : [];
              if (pendingToolCalls.length > 0) {
                liveStatus = copy.runtime.generatingCode;
              }
            }
            return { loading: true, phase: 'generating', liveStatus };
          })());
          queueAssistantDelta(event.text);
        }
        if (event?.type === 'assistant:tool_call_delta') {
          ensureActiveAssistant();
          const parsed = parseToolDisplayName(event.toolCall?.name);
          const isCodeTool = new Set(['create', 'edit']).has(parsed.base);
          if (isCodeTool) {
            setRuntimeStatus(makeStatus(copy.runtime.generatingCode, copy.runtime.streamingReply, 'greenBright'));
            setInputStage('streaming');
            const startedAt = Date.now();
            const targetId = activeAssistantIdRef.current;
            if (targetId) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== targetId) return m;
                  return ensureCodeGenerationTiming(
                    {
                      ...m,
                      loading: true,
                      phase: 'generating',
                      liveStatus: copy.runtime.generatingCode
                    },
                    startedAt
                  );
                })
              );
            }
          }
          updatePendingToolCallOnActiveAssistant(event.toolCall);
        }
        if (event?.type === 'assistant:response') {
          const hasPlannedTools = Array.isArray(event.toolCalls) && event.toolCalls.length > 0;
          if (hasPlannedTools) {
            setRuntimeStatus(makeStatus(copy.runtime.toolRunning, copy.runtime.waitingToolStart || copy.runtime.streamingReply, 'magentaBright'));
            setInputStage('thinking');
          } else {
            setRuntimeStatus(makeStatus(copy.runtime.replyCompleted, copy.runtime.outputFinished, 'greenBright'));
            setInputStage('idle');
          }
          flushAssistantDelta();
          const targetId = activeAssistantIdRef.current;
          const hadActiveAssistant = Boolean(targetId);
          if (hadActiveAssistant) {
            streamedAssistantHandledRef.current = true;
          }
          const { displayText } = applyPlanExecutionResult(event.text);
          if (targetId && !hasPlannedTools) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                const responseText = typeof displayText === 'string' ? displayText.trim() : '';
                const cleanedExistingText = stripPlanExecutionResult(String(m.text || '')).trim();
                const finalText = responseText || cleanedExistingText;
                const shouldSynthesizeCompletion = !finalText && m.syntheticPrelude;
                return {
                  ...m,
                  ...(finalText
                    ? { text: finalText, syntheticPrelude: false }
                    : shouldSynthesizeCompletion
                      ? { text: buildSyntheticCompletionText(m, copy), syntheticPrelude: false }
                      : {}),
                  loading: false,
                  phase: undefined,
                  liveStatus: undefined,
                  pendingToolCalls: [],
                  autoSkillNames: activeAssistantAutoSkillNamesRef.current,
                  ...(m.codeGenerationStartedAt && !m.codeGenerationEndedAt ? { codeGenerationEndedAt: Date.now() } : {})
                };
              })
            );
          }
          if (!hasPlannedTools && !activePlanStepInfoRef.current) {
            activeAssistantIdRef.current = null;
          }
          if (!hadActiveAssistant && !hasPlannedTools && event.text) {
            const cleanedStandaloneText = stripPlanExecutionResult(String(displayText || event.text)).trim();
            setMessages((prev) => [
              ...prev,
              { id: nextId(), label: 'general', text: cleanedStandaloneText, color: 'greenBright' }
            ]);
          }
        }
        if (event?.type === 'tool:start') {
          ensureActiveAssistant();
          maybeRefreshSyntheticNarration(event.name);
          const detail = describeToolActivity(event.name, copy);
          setRuntimeStatus(makeStatus(copy.runtime.toolRunning, detail, 'magentaBright'));
          setInputStage('tooling');
          const targetId = activeAssistantIdRef.current;
          if (targetId) {
            const finishedAt = Date.now();
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                const nextMessage = isCodeActivityName(event.name) ? finishCodeGeneration(m, finishedAt) : m;
                const withPrelude = shouldInjectPreToolNotice(nextMessage)
                  ? {
                      ...nextMessage,
                      text: buildPreToolNotice(event.name, copy),
                      syntheticPrelude: true
                    }
                  : nextMessage;
                return {
                  ...withPrelude,
                  loading: true,
                  phase: 'tooling',
                  liveStatus: detail
                };
              })
            );
          }
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
            displayName: event.displayName,
            status: 'running',
            arguments: event.arguments
          });
        }
        if (event?.type === 'tool:end') {
          const detail = describeToolActivity(event.name, copy, { done: true });
          setRuntimeStatus(makeStatus(copy.runtime.toolCompleted, copy.toolActivity.waitingModelContinue(detail), 'cyanBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelContinue(detail) });
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
            displayName: event.displayName,
            status: 'done',
            durationMs: event.durationMs,
            summary: event.summary,
            arguments: event.arguments,
            fileChange: event.fileChange || null
          });
        }
        if (event?.type === 'tool:blocked') {
          const detail = describeToolActivity(event.name, copy, { blocked: true });
          setRuntimeStatus(makeStatus(copy.runtime.toolBlocked, detail, 'redBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelAdjust(detail) });
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
            displayName: event.displayName,
            status: 'blocked',
            arguments: event.arguments
          });
        }
        if (event?.type === 'tool:error') {
          const detail = copy.toolActivity.toolFailed(event.name);
          setRuntimeStatus(makeStatus(copy.runtime.toolFailed, event.summary || detail, 'redBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelAdjust(detail) });
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
            displayName: event.displayName,
            status: 'error',
            durationMs: event.durationMs,
            summary: event.summary,
            arguments: event.arguments
          });
        }
        if (event?.type === 'system_tool:start') {
          ensureActiveAssistant();
          const detail = describeToolActivity(event.name, copy);
          setRuntimeStatus(makeStatus(copy.runtime.toolRunning, detail, 'blueBright'));
          setInputStage('tooling');
          updateActivityStatusOnActiveAssistant({
            type: 'system_tool',
            id: event.id,
            name: event.name,
            status: 'running',
            summary: event.summary
          });
          setActiveAssistantMeta({ loading: true, phase: 'tooling', liveStatus: detail });
        }
        if (event?.type === 'system_tool:end') {
          const detail = describeToolActivity(event.name, copy, { done: true });
          setRuntimeStatus(makeStatus(copy.runtime.toolCompleted, copy.toolActivity.waitingModelContinue(detail), 'blueBright'));
          setInputStage('thinking');
          updateActivityStatusOnActiveAssistant({
            type: 'system_tool',
            id: event.id,
            name: event.name,
            status: 'done',
            summary: event.summary
          });
          setActiveAssistantMeta({
            loading: true,
            phase: 'thinking',
            liveStatus: copy.toolActivity.waitingModelContinue(detail)
          });
        }
        if (event?.type === 'system_tool:error') {
          const detail = copy.toolActivity.toolFailed(event.name);
          setRuntimeStatus(makeStatus(copy.runtime.toolFailed, event.summary || detail, 'redBright'));
          setInputStage('thinking');
          updateActivityStatusOnActiveAssistant({
            type: 'system_tool',
            id: event.id,
            name: event.name,
            status: 'error',
            summary: event.summary
          });
          setActiveAssistantMeta({
            loading: true,
            phase: 'thinking',
            liveStatus: copy.toolActivity.waitingModelAdjust(detail)
          });
        }
        if (event?.type === 'plan:steps') {
          const planSteps = Array.isArray(event.steps) ? event.steps : [];
          if (planSteps.length > 0) {
            setPlanState((prev) => ({
              ...prev,
              total: planSteps.length,
              steps: planSteps.map((s) => ({
                index: s.index,
                total: planSteps.length,
                role: s.role || '',
                title: s.title || '',
                status: 'pending'
              }))
            }));
          }
        }
        if (event?.type === 'plan:progress') {
          const current = Number(event.step || 0);
          const total = Number(event.total || 0);
          const status = String(event.status || '').trim().toLowerCase();
          if (current > 0 && total > 0) {
            const role = String(event.role || '').trim().toLowerCase();
            const normalizedRole = PLAN_AGENT_ROLES.has(role) ? role : 'coder';
            const title = String(event.title || '').trim();
            setPlanState((prev) => {
              const existingSteps = Array.isArray(prev.steps) ? prev.steps : [];
              const merged = existingSteps.some((step) => step.index === current)
                ? existingSteps.map((step) =>
                    step.index === current
                      ? {
                          ...step,
                          total,
                          role: event.role || step.role || normalizedRole,
                          title: title || step.title || '',
                          status: status === 'failed' ? 'failed' : status === 'done' ? 'done' : status === 'running' ? 'active' : step.status
                        }
                      : step
                  )
                : [
                    ...existingSteps,
                    {
                      index: current,
                      total,
                      role: event.role || normalizedRole,
                      title,
                      status: status === 'failed' ? 'failed' : status === 'done' ? 'done' : 'active'
                    }
                  ];
              return {
                ...prev,
                current,
                total,
                role: event.role || prev.role || normalizedRole,
                title: title || prev.title || '',
                failed: status === 'failed' ? true : prev.failed,
                completed: status === 'done' && current === total && !prev.failed,
                pendingApproval: false,
                steps: merged.sort((a, b) => a.index - b.index)
              };
            });
          }
        }
        if (event?.type === 'spec:pending_approval') {
          setPendingSpecApproval(event.spec || null);
          setSpecApprovalInput('');
          setSpecApprovalError('');
        }
        if (event?.type === 'spec:approval_cleared') {
          setPendingSpecApproval(null);
          setSpecApprovalInput('');
          setSpecApprovalError('');
        }
        if (event?.type === 'skill:start') {
          ensureActiveAssistant();
          const detail = describeSkillActivity(event.name, copy);
          setRuntimeStatus(makeStatus(copy.runtime.skillRunning, detail, 'blueBright'));
          setInputStage('tooling');
          setActiveAssistantMeta({ loading: true, phase: 'tooling', liveStatus: detail });
          updateActivityStatusOnActiveAssistant({
            type: 'skill',
            name: event.name,
            status: 'running'
          });
        }
        if (event?.type === 'skill:end') {
          const detail = describeSkillActivity(event.name, copy, { done: true });
          setRuntimeStatus(makeStatus(copy.runtime.skillCompleted, detail, 'blueBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: detail });
          updateActivityStatusOnActiveAssistant({
            type: 'skill',
            name: event.name,
            status: 'done'
          });
        }
        if (event?.type === 'skill:error') {
          const detail = describeSkillActivity(event.name, copy, { failed: true });
          setRuntimeStatus(makeStatus(copy.runtime.skillFailed, event.summary || detail, 'redBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: detail });
          updateActivityStatusOnActiveAssistant({
            type: 'skill',
            name: event.name,
            status: 'error',
            summary: event.summary
          });
        }
        if (event?.type === 'skill:auto' || event?.type === 'skill:always') {
          const detail = describeAutoSkillActivity(event.names, copy);
          if (Array.isArray(event.names) && event.names.length > 0) {
            activeAssistantAutoSkillNamesRef.current = event.names.filter(Boolean);
            const targetId = activeAssistantIdRef.current;
            if (targetId) {
              setMessages((prev) =>
                prev.map((m) => (m.id === targetId ? { ...m, autoSkillNames: activeAssistantAutoSkillNamesRef.current } : m))
              );
            }
          }
          if (detail) {
            setRuntimeStatus(makeStatus(copy.runtime.skillRunning, detail, 'blueBright'));
          }
        }
        if (event?.type === 'compact:auto') {
          setRuntimeStatus(makeStatus(copy.runtime.compactingContext, `auto compact ${event.mode}`, 'yellowBright'));
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              label: 'divider',
              dividerType: 'compact',
              text: copy.runtime.autoCompactTriggered(event.mode, event.threshold),
              color: 'yellowBright'
            }
          ]);
        }
        if (event?.type === 'dream:auto') {
          setRuntimeStatus(makeStatus(copy.runtime.dreamRunning, copy.runtime.dreamAutoTriggered, 'magentaBright'));
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              label: 'system',
              text: copy.runtime.dreamAutoTriggered,
              color: 'magentaBright'
            }
          ]);
        }
        if (event?.type === 'dream:complete') {
          setRuntimeStatus(makeStatus(copy.runtime.dreamCompleted, '', 'greenBright'));
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              label: 'system',
              text: copy.runtime.dreamCompleted,
              color: 'greenBright'
            }
          ]);
        }
      })
      .then((result) => {
        try {
          syncRuntimeVisualState('after');
        } catch {
          setDisplaySessionId(sessionId);
        }
        updateMessageMeta(activeUserMessageIdRef.current, {
          loading: false,
          phase: undefined,
          liveStatus: undefined
        });
        if (result.type === 'exit') {
          exit();
          return;
        }
        if (result.type !== 'noop') setInputStage('idle');
        if (planTextBufferRef.current) {
          setPlanState((prev) => {
            if (!prev.total) return prev;
            return {
              ...prev,
              completed: !prev.failed,
              steps: (prev.steps || []).map((step) =>
                step.status === 'active' ? { ...step, status: prev.failed ? 'failed' : 'done' } : step
              )
            };
          });
        }
        syncRuntimeVisualState(result.type === 'noop' ? 'ready' : 'after');
        if (result.type === 'noop') return;
        // 被用户中止时显示提示消息
        if (result.aborted) {
          setMessages((prev) => [
            ...prev,
            { id: nextId(), label: 'system', text: copy.runtime.responseStopped, color: 'yellowBright' }
          ]);
          return;
        }
        if (!shouldAppendAssistantResult(result, activeAssistantIdRef.current, streamedAssistantHandledRef.current)) return;
        appendResultMessage(result);
      })
      .catch((err) => {
        const message = sanitizeRenderableText(err?.message || String(err));
        setRuntimeStatus(makeStatus(copy.runtime.requestFailed, message, 'redBright'));
        setInputStage('idle');
        updateMessageMeta(activeUserMessageIdRef.current, {
          loading: false,
          phase: undefined,
          liveStatus: undefined
        });
        setPlanState((prev) => ({
          ...prev,
          failed: prev.total > 0,
          steps: (prev.steps || []).map((step) =>
            step.status === 'active' ? { ...step, status: 'failed' } : step
          )
        }));
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'error', text: message, color: 'redBright' }
        ]);
      })
      .finally(() => {
        flushAssistantDelta();
        finalizeActiveAssistant();
        activeAssistantIdRef.current = null;
        activePlanStepNumberRef.current = 0;
        streamedAssistantHandledRef.current = false;
        activeUserMessageIdRef.current = null;
        if (deltaFlushTimerRef.current) {
          clearTimeout(deltaFlushTimerRef.current);
          deltaFlushTimerRef.current = null;
        }
        inFlightRef.current = false;
        setBusy(false);
        if (pendingQueueRef.current.length === 0) {
          setInputStage('idle');
        }
        if (pendingQueueRef.current.length === 0) {
          syncRuntimeVisualState('ready');
        }

        if (pendingQueueRef.current.length > 0) {
          const [next, ...rest] = pendingQueueRef.current;
          pendingQueueRef.current = rest;
          setPendingQueue(rest);
          updateMessageMeta(next.messageId, {
            loading: true,
            phase: 'sending',
            liveStatus: copy.runtime.submittedWaiting || copy.runtime.sendingToGateway
          });
          runSubmission(next.line, next.messageId);
        }
      });
  };

  const runImmediateLocalCommand = (line, userMessageId) => {
    updateMessageMeta(userMessageId, {
      loading: true,
      phase: 'sending',
      liveStatus: copy.runtime.localCommandRunning
    });
    runtime
      .submit(line)
      .then((result) => {
        updateMessageMeta(userMessageId, {
          loading: false,
          phase: undefined,
          liveStatus: undefined
        });
        try {
          syncRuntimeVisualState('after');
        } catch {
          setDisplaySessionId(sessionId);
        }
        if (result.type === 'exit') {
          exit();
          return;
        }
        appendResultMessage(result);
      })
      .catch((err) => {
        // 用户主动中止，不显示为错误
        if (err?.name === 'AbortError') {
          updateMessageMeta(userMessageId, {
            loading: false,
            phase: undefined,
            liveStatus: undefined
          });
          setMessages((prev) => [
            ...prev,
            { id: nextId(), label: 'system', text: copy.runtime.responseStopped, color: 'yellowBright' }
          ]);
          return;
        }
        const message = sanitizeRenderableText(err?.message || String(err));
        updateMessageMeta(userMessageId, {
          loading: false,
          phase: undefined,
          liveStatus: undefined
        });
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'error', text: message, color: 'redBright' }
        ]);
      });
  };

  useInput((value, key) => {
    if (debugKeys) {
      const printable = JSON.stringify(value ?? '');
      const flags = Object.entries(key || {})
        .filter(([, v]) => Boolean(v))
        .map(([k]) => k)
        .join(',');
      setLastKeyDebug(`key=${printable} flags=${flags || '-'}`);
    }

    if (shouldCaptureEscapeSequence(value, escSeqRef.current)) {
      escSeqRef.current += value || '';
      const seq = escSeqRef.current;
      if (seq === '\u001b[3~' || seq === '\u001b[3;2~' || seq === '\u001b[3;5~') {
        const idxSnapshot = cursorIndexRef.current;
        setInputValue((prev) => {
          const idx = Math.min(Math.max(idxSnapshot, 0), prev.length);
          if (idx <= 0) return prev;
          return `${prev.slice(0, idx - 1)}${prev.slice(idx)}`;
        });
        const next = Math.max(0, idxSnapshot - 1);
        cursorIndexRef.current = next;
        setCursorIndex(next);
        escSeqRef.current = '';
        return;
      }
      if (seq.length > 8) {
        escSeqRef.current = '';
      }
      return;
    } else {
      escSeqRef.current = '';
    }

    if (pendingDeleteApproval) {
      if (key.return) {
        const answer = parseDeleteApprovalAnswer(deleteApprovalInput);
        if (answer === 'approve' || answer === 'deny') {
          const resolver = deleteApprovalResolverRef.current;
          deleteApprovalResolverRef.current = null;
          setPendingDeleteApproval(null);
          setDeleteApprovalInput('');
          setDeleteApprovalError('');
          if (resolver) resolver({ approved: answer === 'approve' });
        } else {
          setDeleteApprovalError(copy.deleteApproval.invalidAnswer);
        }
        return;
      }

      if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
        setDeleteApprovalInput((prev) => prev.slice(0, -1));
        setDeleteApprovalError('');
        return;
      }

      if (isPrintableInput(value, key)) {
        setDeleteApprovalInput((prev) => `${prev}${value}`);
        setDeleteApprovalError('');
        return;
      }

      if (key.ctrl && value === 'c') {
        if (busy && typeof runtime.abort === 'function') {
          runtime.abort();
          return;
        }
        exit();
        return;
      }

      return;
    }

    if (pendingRunApproval) {
      if (key.return) {
        const answer = parseDeleteApprovalAnswer(runApprovalInput);
        if (answer === 'approve' || answer === 'deny') {
          const resolver = runApprovalResolverRef.current;
          runApprovalResolverRef.current = null;
          setPendingRunApproval(null);
          setRunApprovalInput('');
          setRunApprovalError('');
          if (resolver) resolver({ approved: answer === 'approve' });
        } else {
          setRunApprovalError(copy.runApproval.invalidAnswer);
        }
        return;
      }

      if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
        setRunApprovalInput((prev) => prev.slice(0, -1));
        setRunApprovalError('');
        return;
      }

      if (isPrintableInput(value, key)) {
        setRunApprovalInput((prev) => `${prev}${value}`);
        setRunApprovalError('');
        return;
      }

      if (key.ctrl && value === 'c') {
        if (busy && typeof runtime.abort === 'function') {
          runtime.abort();
          return;
        }
        exit();
        return;
      }

      return;
    }

    if (pendingFileApproval) {
      if (key.return) {
        const answer = parseDeleteApprovalAnswer(fileApprovalInput);
        if (answer === 'approve' || answer === 'deny') {
          const resolver = fileApprovalResolverRef.current;
          fileApprovalResolverRef.current = null;
          setPendingFileApproval(null);
          setFileApprovalInput('');
          setFileApprovalError('');
          if (resolver) resolver({ approved: answer === 'approve' });
        } else {
          setFileApprovalError(copy.fileApproval.invalidAnswer);
        }
        return;
      }

      if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
        setFileApprovalInput((prev) => prev.slice(0, -1));
        setFileApprovalError('');
        return;
      }

      if (isPrintableInput(value, key)) {
        setFileApprovalInput((prev) => `${prev}${value}`);
        setFileApprovalError('');
        return;
      }

      if (key.ctrl && value === 'c') {
        if (busy && typeof runtime.abort === 'function') {
          runtime.abort();
          return;
        }
        exit();
        return;
      }

      return;
    }

    if (pendingSpecApproval) {
      if (key.return) {
        const parsed = parseSpecApprovalAnswer(specApprovalInput);
        if (parsed.action === 'approve' || parsed.action === 'reject' || parsed.action === 'edit' || parsed.action === 'save' || parsed.action === 'execute') {
          setPendingSpecApproval(null);
          setSpecApprovalInput('');
          setSpecApprovalError('');
          runSubmission(parsed.command);
        } else if (parsed.action === 'missing_feedback') {
          setSpecApprovalError(copy.specApproval.missingFeedback);
        } else {
          setSpecApprovalError(copy.specApproval.invalidAnswer);
        }
        return;
      }

      if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
        setSpecApprovalInput((prev) => prev.slice(0, -1));
        setSpecApprovalError('');
        return;
      }

      if (isPrintableInput(value, key)) {
        setSpecApprovalInput((prev) => `${prev}${value}`);
        setSpecApprovalError('');
        return;
      }

      if (key.ctrl && value === 'c') {
        if (busy && typeof runtime.abort === 'function') {
          runtime.abort();
          return;
        }
        exit();
        return;
      }

      return;
    }

    if (pendingReflectApproval) {
      if (key.return) {
        const parsed = parseReflectApprovalAnswer(reflectApprovalInput);
        if (parsed.action === 'approve' || parsed.action === 'reject' || parsed.action === 'edit') {
          setPendingReflectApproval(null);
          setReflectApprovalInput('');
          setReflectApprovalError('');
          runSubmission(parsed.command);
        } else if (parsed.action === 'missing_feedback') {
          setReflectApprovalError(copy.reflectApproval.missingFeedback);
        } else {
          setReflectApprovalError(copy.reflectApproval.invalidAnswer);
        }
        return;
      }

      if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
        setReflectApprovalInput((prev) => prev.slice(0, -1));
        setReflectApprovalError('');
        return;
      }

      if (isPrintableInput(value, key)) {
        setReflectApprovalInput((prev) => `${prev}${value}`);
        setReflectApprovalError('');
        return;
      }

      if (key.ctrl && value === 'c') {
        if (busy && typeof runtime.abort === 'function') {
          runtime.abort();
          return;
        }
        exit();
        return;
      }

      return;
    }

    if (key.upArrow) {
      if (suggestionNav && commandSuggestions.length > 0) {
        setMenuIndex((prev) => moveSuggestionSelection(prev, commandSuggestions.length, 'up'));
        return;
      }
      if (history.length === 0) return;
      if (historyIndex === null) {
        const matches = buildHistoryMatches(history, inputValue);
        if (matches.length === 0) return;
        setDraftBeforeHistory(inputValue);
        setHistoryMatches(matches);
        setHistoryIndex(0);
        setInputValue(matches[0]);
        cursorIndexRef.current = matches[0].length;
        setCursorIndex(matches[0].length);
        return;
      }
      if (historyMatches.length === 0) return;
      const idx = Math.min(historyMatches.length - 1, historyIndex + 1);
      setHistoryIndex(idx);
      setInputValue(historyMatches[idx]);
      cursorIndexRef.current = historyMatches[idx].length;
      setCursorIndex(historyMatches[idx].length);
      return;
    }

    if (key.downArrow) {
      if (suggestionNav && commandSuggestions.length > 0) {
        setMenuIndex((prev) => moveSuggestionSelection(prev, commandSuggestions.length, 'down'));
        return;
      }
      if (history.length === 0 || historyIndex === null) return;
      const idx = historyIndex - 1;
      if (idx < 0) {
        setHistoryIndex(null);
        setHistoryMatches([]);
        setInputValue(draftBeforeHistory);
        cursorIndexRef.current = draftBeforeHistory.length;
        setCursorIndex(draftBeforeHistory.length);
        return;
      }
      if (historyMatches.length === 0) return;
      setHistoryIndex(idx);
      setInputValue(historyMatches[idx]);
      cursorIndexRef.current = historyMatches[idx].length;
      setCursorIndex(historyMatches[idx].length);
      return;
    }
    if (key.leftArrow) {
      if (suggestionNav && commandSuggestions.length > 0) {
        setMenuIndex((prev) => moveSuggestionSelection(prev, commandSuggestions.length, 'left'));
        return;
      }
      setSuggestionNav(false);
      const next = Math.max(0, cursorIndexRef.current - 1);
      cursorIndexRef.current = next;
      setCursorIndex(next);
      return;
    }
    if (key.rightArrow) {
      if (suggestionNav && commandSuggestions.length > 0) {
        setMenuIndex((prev) => moveSuggestionSelection(prev, commandSuggestions.length, 'right'));
        return;
      }
      setSuggestionNav(false);
      const next = Math.min(inputValue.length, cursorIndexRef.current + 1);
      cursorIndexRef.current = next;
      setCursorIndex(next);
      return;
    }
    if (key.home) {
      setSuggestionNav(false);
      cursorIndexRef.current = 0;
      setCursorIndex(0);
      return;
    }
    if (key.end) {
      setSuggestionNav(false);
      cursorIndexRef.current = inputValue.length;
      setCursorIndex(inputValue.length);
      return;
    }

    if (key.return) {
      if (suggestionNav && commandSuggestions.length > 0) {
        const selected = commandSuggestions[Math.min(menuIndex, commandSuggestions.length - 1)];
        const selectedValue = getSuggestionValue(selected);
        const current = inputValue.trim();
        if (selectedValue && current !== selectedValue.trim()) {
          setInputValue(selectedValue);
          cursorIndexRef.current = selectedValue.length;
          setCursorIndex(selectedValue.length);
          setSuggestionNav(false);
          return;
        }
      }

      const line = inputValue.trim();
      setInputValue('');
      setSuggestionNav(false);
      cursorIndexRef.current = 0;
      setCursorIndex(0);
      if (!line) return;

      // /stop 命令：中止当前正在进行的回答
      if (line === '/stop' && busy && typeof runtime.abort === 'function') {
        runtime.abort();
        setHistory((prev) => [...prev, line]);
        setHistoryIndex(null);
        setDraftBeforeHistory('');
        setHistoryMatches([]);
        return;
      }

      setHistory((prev) => [...prev, line]);
      setHistoryIndex(null);
      setDraftBeforeHistory('');
      setHistoryMatches([]);

      const messageId = nextId();
      const immediateLocal =
        typeof runtime.isImmediateLocalInput === 'function' &&
        runtime.isImmediateLocalInput(line);
      const pendingUserMeta = getPendingUserMessageMeta(copy, {
        immediateLocal,
        inFlight: inFlightRef.current
      });
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          label: 'you',
          text: line,
          color: 'white',
          loading: true,
          phase: pendingUserMeta.phase,
          liveStatus: pendingUserMeta.liveStatus
        }
      ]);
      if (immediateLocal) {
        runImmediateLocalCommand(line, messageId);
      } else if (inFlightRef.current) {
        pendingQueueRef.current = [...pendingQueueRef.current, { line, messageId }];
        setPendingQueue([...pendingQueueRef.current]);
      } else {
        runSubmission(line, messageId);
      }
      return;
    }

    if (isBackspaceKey(value, key) || isDeleteKey(value, key)) {
      setSuggestionNav(false);
      const backspace = true;
      const idxSnapshot = cursorIndexRef.current;
      setInputValue((prev) => {
        const idx = Math.min(Math.max(idxSnapshot, 0), prev.length);
        if (idx <= 0) return prev;
        return `${prev.slice(0, idx - 1)}${prev.slice(idx)}`;
      });
      const next = Math.max(0, idxSnapshot - 1);
      cursorIndexRef.current = next;
      setCursorIndex(next);
      setHistoryIndex(null);
      setHistoryMatches([]);
      return;
    }

    if (key.tab) {
      if (!inputValue.startsWith('/')) return;
      if (commandSuggestions.length === 0) return;
      if (commandSuggestions.length === 1) {
        const selected = getSuggestionValue(commandSuggestions[0]);
        setInputValue(selected);
        cursorIndexRef.current = selected.length;
        setCursorIndex(selected.length);
        setSuggestionNav(false);
        return;
      }
      setSuggestionNav(true);
      return;
    }

    if (key.ctrl && value === 'c') {
      if (busy && typeof runtime.abort === 'function') {
        runtime.abort();
        return;
      }
      exit();
      return;
    }
    if (key.ctrl && value === 't') {
      setShowToolDetails((prev) => !prev);
      return;
    }

    if (isPrintableInput(value, key)) {
      setSuggestionNav(false);
      const idxSnapshot = cursorIndexRef.current;
      setInputValue((prev) => `${prev.slice(0, idxSnapshot)}${value}${prev.slice(idxSnapshot)}`);
      const next = idxSnapshot + value.length;
      cursorIndexRef.current = next;
      setCursorIndex(next);
      setHistoryIndex(null);
      setHistoryMatches([]);
      return;
    }

    if (key.ctrl && value === 'j') {
      setSuggestionNav(false);
      const idxSnapshot = cursorIndexRef.current;
      setInputValue((prev) => `${prev.slice(0, idxSnapshot)}\n${prev.slice(idxSnapshot)}`);
      const next = idxSnapshot + 1;
      cursorIndexRef.current = next;
      setCursorIndex(next);
      setHistoryIndex(null);
      setHistoryMatches([]);
    }
  });

  useEffect(() => {
    setMessages([
      {
        id: nextId(),
        label: 'system',
        text: startupHint,
        color: 'yellowBright'
      }
    ]);
  }, [nextId, runtime]);

  useEffect(() => {
    let alive = true;
    if (typeof runtime.getInputHistory !== 'function') return () => {};
    runtime
      .getInputHistory()
      .then((items) => {
        if (!alive || !Array.isArray(items) || items.length === 0) return;
        setHistory(items.map((v) => String(v)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [runtime]);

  useEffect(() => {
    setCursorVisible(true);
  }, []);

  useEffect(() => {
    if (!busy) return () => {};
    const timer = setInterval(() => {
      setLoaderTick((prev) => prev + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [busy]);

  useEffect(() => {
    const pending = runtimeState?.pendingSpecApproval;
    if (!pending) {
      setPendingSpecApproval(null);
      return;
    }
    if (!busy) {
      setPendingSpecApproval(pending);
      setSpecApprovalInput('');
      setSpecApprovalError('');
    }
  }, [runtimeState?.pendingSpecApproval, busy]);

  useEffect(() => {
    const pending = Boolean(runtimeState?.pendingReflectSkill);
    if (!pending) {
      setPendingReflectApproval(null);
      return;
    }
    if (!busy) {
      setPendingReflectApproval((prev) => prev || { scope: '', name: '', targetPath: '' });
    }
  }, [runtimeState?.pendingReflectSkill, busy]);

  useEffect(() => {
    if (commandSuggestions.length === 0) {
      setSuggestionNav(false);
      if (menuIndex !== 0) setMenuIndex(0);
      return;
    }
    if (menuIndex >= commandSuggestions.length) setMenuIndex(0);
  }, [menuIndex, commandSuggestions.length]);

  useEffect(() => {
    const safe = Math.min(Math.max(cursorIndexRef.current, 0), inputValue.length);
    cursorIndexRef.current = safe;
    setCursorIndex(safe);
  }, [inputValue.length]);

  useEffect(
    () => () => {
      if (deltaFlushTimerRef.current) {
        clearTimeout(deltaFlushTimerRef.current);
        deltaFlushTimerRef.current = null;
      }
    },
    []
  );

  const beforeCursor = inputValue.slice(0, cursorIndex);
  const underCursor = inputValue.slice(cursorIndex, cursorIndex + 1);
  const afterCursor = inputValue.slice(cursorIndex + 1);
  const hasConversationStarted = messages.some((m) =>
    ['you', 'coder', 'pending', 'error'].includes(m.label)
  );
  const baseVisibleMessages = hasConversationStarted
    ? messages.filter((m) => !(m.label === 'system' && m.text === startupHint))
    : messages;
  const visibleMessages = injectPlanStateMessage(
    baseVisibleMessages,
    planState,
    activeUserMessageIdRef.current,
    activeAssistantIdRef.current
  );
  const activeApprovalLock = pendingDeleteApproval
    ? { text: copy.deleteApproval.inputLocked }
    : pendingRunApproval
      ? { text: copy.runApproval.inputLocked }
      : pendingFileApproval
        ? { text: copy.fileApproval.inputLocked }
        : pendingSpecApproval
          ? { text: copy.specApproval.inputLocked }
          : pendingReflectApproval
            ? { text: copy.reflectApproval.inputLocked }
            : null;

  return h(
    Box,
    { flexDirection: 'column' },
    h(Header, { sessionId: displaySessionId, model: displayModel, sdkProvider: displaySdkProvider, shellName, safeMode }),
    h(MessageList, {
      messages: visibleMessages,
      loaderTick,
      showToolDetails,
      contentWidth: messageContentWidth,
      copy
    }),
    h(
      Box,
      { marginTop: 0, marginBottom: 0, justifyContent: 'space-between', width: '100%' },
      h(
        Box,
        { flexGrow: 1 },
        h(
          Text,
          { color: 'gray' },
          `${showToolDetails ? copy.generic.toolSummaryExpanded : copy.generic.toolSummaryCollapsed} (${copy.generic.toggleToolSummary})  ·  ${copy.generic.scrollHint}`
        )
      ),
      h(ContextProgressMeter, { runtimeState, runtimeStatus, compact: true, copy })
    ),
    h(SuggestionPanel, { commandSuggestions, suggestionNav, menuIndex, copy }),
    h(PendingPanel, { pendingQueue, copy }),
    h(DeleteApprovalPanel, {
      request: pendingDeleteApproval,
      inputValue: deleteApprovalInput,
      errorText: deleteApprovalError,
      copy,
      cursorVisible
    }),
    h(RunApprovalPanel, {
      request: pendingRunApproval,
      inputValue: runApprovalInput,
      errorText: runApprovalError,
      copy,
      cursorVisible,
      contentWidth: messageContentWidth
    }),
    h(FileApprovalPanel, {
      request: pendingFileApproval,
      inputValue: fileApprovalInput,
      errorText: fileApprovalError,
      copy,
      cursorVisible
    }),
    h(SpecApprovalPanel, {
      request: pendingSpecApproval,
      inputValue: specApprovalInput,
      errorText: specApprovalError,
      copy,
      cursorVisible,
      contentWidth: messageContentWidth
    }),
    h(ReflectApprovalPanel, {
      request: pendingReflectApproval,
      inputValue: reflectApprovalInput,
      errorText: reflectApprovalError,
      copy,
      cursorVisible
    }),
    debugKeys
      ? h(
          Box,
          { marginTop: 1 },
          h(Text, { color: 'yellow' }, copy.generic.debugKeys(lastKeyDebug))
        )
      : null,
    h(InputBar, {
      beforeCursor,
      underCursor,
      afterCursor,
      cursorVisible,
      busy,
      disabled: Boolean(activeApprovalLock),
      disabledText: activeApprovalLock ? activeApprovalLock.text : '',
      inputStage,
      pendingQueueLength: pendingQueue.length,
      showToolDetails,
      runtimeStatus,
      commandSuggestions,
      suggestionNav,
      copy
    }),
    h(SignatureBar, { version })
  );
}
