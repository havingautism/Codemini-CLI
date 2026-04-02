import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { shouldCaptureEscapeSequence } from './input-escape.js';
import { classifyCommandIntent } from '../core/shell.js';

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
    roleLabels: { you: '你', coder: 'CODER', system: '系统', error: '错误', pending: '等待中' },
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
      startupHint: '使用 /help、/commands、/compact、/exit、!<shell>。Tab 可自动补全 slash 命令。',
      toolSummaryExpanded: '工具摘要：已展开',
      toolSummaryCollapsed: '工具摘要：已收起',
      toolChainCollapsed: (count) => `已折叠更早的 ${count} 个工具调用，按 Ctrl+T 展开全部`,
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
      donePatch: '已应用补丁',
      doingPatch: '正在应用补丁',
      doneList: '已查看目录',
      doingList: '正在查看目录',
      doneCommand: '已执行命令',
      doingCommand: '正在执行命令',
      doneCreateTask: '已创建任务',
      doingCreateTask: '正在创建任务',
      doneUpdateTask: '已更新任务',
      doingUpdateTask: '正在更新任务',
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
      doneCodeGeneration: '已生成代码',
      doingCodeGeneration: '正在生成代码',
      doneSkill: '已完成技能',
      doingSkill: '正在执行技能',
      doneProjectIndex: '已初始化项目索引',
      doingProjectIndex: '正在初始化项目索引',
      doneFileIndex: '已刷新文件索引',
      doingFileIndex: '正在刷新文件索引',
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
      autoSkillInjected: (names) => `自动启用技能: ${names.map((name) => `/${name}`).join(', ')}`,
      compactingContext: '正在压缩上下文',
      autoCompactTriggered: (mode, threshold) => `自动压缩已触发（${mode}，阈值 ${threshold}%）`,
      requestFailed: '请求失败',
      localCommandRunning: '正在执行本地命令',
      queuedWaiting: '排队中，等待上一轮完成',
      idleReady: '等待输入',
      idleReadyDetail: '就绪',
      idleAfterTurn: '空闲',
      idleAfterTurnDetail: '等待下一轮输入'
    }
  },
  en: {
    roleLabels: { you: 'YOU', coder: 'CODER', system: 'SYSTEM', error: 'ERROR', pending: 'PENDING' },
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
      startupHint: 'Use /help, /commands, /compact, /exit, !<shell>. Tab for slash autocomplete.',
      toolSummaryExpanded: 'Tool summary: expanded',
      toolSummaryCollapsed: 'Tool summary: collapsed',
      toolChainCollapsed: (count) => `${count} earlier tool calls hidden, press Ctrl+T to expand`,
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
      donePatch: 'Applied patch',
      doingPatch: 'Applying patch',
      doneList: 'Listed directory',
      doingList: 'Listing directory',
      doneCommand: 'Ran command',
      doingCommand: 'Running command',
      doneCreateTask: 'Created task',
      doingCreateTask: 'Creating task',
      doneUpdateTask: 'Updated task',
      doingUpdateTask: 'Updating task',
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
      doneCodeGeneration: 'Code generated',
      doingCodeGeneration: 'Generating code',
      doneSkill: 'Completed skill',
      doingSkill: 'Running skill',
      doneProjectIndex: 'Project index initialized',
      doingProjectIndex: 'Initializing project index',
      doneFileIndex: 'File index refreshed',
      doingFileIndex: 'Refreshing file index',
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
      autoSkillInjected: (names) => `auto-enabled skills: ${names.map((name) => `/${name}`).join(', ')}`,
      compactingContext: 'compacting context',
      autoCompactTriggered: (mode, threshold) => `auto-compact triggered (${mode}, threshold ${threshold}%)`,
      requestFailed: 'request failed',
      localCommandRunning: 'running local command',
      queuedWaiting: 'queued, waiting for current turn',
      idleReady: 'waiting for input',
      idleReadyDetail: 'ready',
      idleAfterTurn: 'idle',
      idleAfterTurnDetail: 'ready for next input'
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
  return copy.roleLabels[label] || String(label || '').toUpperCase();
}

function roleStyle(label) {
  return ROLE_STYLES[label] || ROLE_STYLES.system;
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

export function formatMarkdownTableBlock(lines, contentWidth = 72) {
  const cellRows = lines
    .filter((line) => !isMarkdownTableSeparator(line))
    .map(splitMarkdownTableCells)
    .filter((cells) => cells.length > 0);
  if (cellRows.length === 0) return [];

  const columnCount = Math.max(...cellRows.map((cells) => cells.length));
  const normalizedRows = cellRows.map((cells) =>
    Array.from({ length: columnCount }, (_, index) => trimText(cells[index] || '', 28))
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.min(
      28,
      Math.max(...normalizedRows.map((cells) => String(cells[index] || '').length), 3)
    )
  );

  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + (columnCount - 1) * 3;
  if (totalWidth > contentWidth - 2) {
    let overflow = totalWidth - (contentWidth - 2);
    for (let index = widths.length - 1; index >= 0 && overflow > 0; index -= 1) {
      const shrinkable = Math.max(0, widths[index] - 6);
      const shrink = Math.min(shrinkable, overflow);
      widths[index] -= shrink;
      overflow -= shrink;
    }
  }

  const rows = [];
  normalizedRows.forEach((cells, rowIndex) => {
    const padded = cells.map((cell, index) => trimText(cell, widths[index]).padEnd(widths[index], ' '));
    rows.push({
      kind: 'table',
      text: `│ ${padded.join(' │ ')} │`,
      isHeader: rowIndex === 0
    });
    if (rowIndex === 0) {
      rows.push({
        kind: 'table-separator',
        text: `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`
      });
    }
  });
  return rows;
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

function safeJsonParse(raw) {
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return null;
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

function isCodeGenerationActivityName(name) {
  return String(name || '').trim() === 'Code generation';
}

export function buildPreToolNotice(name, copy) {
  const parsed = parseToolDisplayName(name);
  const base = parsed.base;
  const target = parsed.target ? trimText(parsed.target, 48) : '';
  const isEnglish = String(copy?.roleLabels?.coder || '').trim() === 'CODER' && String(copy?.roleLabels?.you || '').trim() === 'YOU';

  if (isEnglish) {
    if (base === 'read') return target ? `I'll inspect ${target} first.` : `I'll inspect the relevant file first.`;
    if (base === 'list' || base === 'glob') return target ? `I'll inspect the ${target} directory first.` : `I'll inspect the relevant directory first.`;
    if (base === 'grep') return `I'll search the relevant code first.`;
    if (base === 'edit' || base === 'write' || base === 'patch' || base === 'generate_diff') {
      return `I'll inspect the current code first, then make the change.`;
    }
    if (base === 'run') return `I'll verify the current project state first.`;
    return `I'll check the relevant project context first.`;
  }

  if (base === 'read') return target ? `我先查看 ${target} 的内容。` : '我先查看相关文件内容。';
  if (base === 'list' || base === 'glob') return target ? `我先查看 ${target} 目录里的内容。` : '我先查看相关目录内容。';
  if (base === 'grep') return '我先搜索相关代码位置。';
  if (base === 'edit' || base === 'write' || base === 'patch' || base === 'generate_diff') return '我先确认当前代码上下文，再动手修改。';
  if (base === 'run') return '我先检查当前项目状态。';
  return '我先查看相关上下文。';
}

export function shouldInjectPreToolNotice(msg) {
  if (!msg) return false;
  const text = String(msg.text || '').trim();
  const segments = Array.isArray(msg.segments) ? msg.segments : [];
  const hasTextSegment = segments.some((segment) => segment?.type === 'text' && String(segment.text || '').trim());
  return !text && !hasTextSegment;
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

function getActivityDisplayParts(activity) {
  if (isCodeGenerationActivityName(activity?.name)) {
    return {
      primary: 'Code',
      secondary: ' (generation)'
    };
  }
  const parsed = parseToolDisplayName(activity?.name);
  if (parsed.base === 'run' || parsed.base === 'start_service') {
    const intent = classifyCommandIntent(parsed.target);
    return {
      primary: getIntentLabel(intent.kind),
      secondary: parsed.target ? `(${parsed.target})` : ''
    };
  }
  if ((activity?.type || 'tool') === 'skill') {
    return {
      primary: `Skill`,
      secondary: `(${activity?.name || 'unknown'})`
    };
  }
  if ((activity?.type || 'tool') === 'system_tool') {
    return {
      primary: 'Index',
      secondary: parsed.target ? `(${parsed.target})` : parsed.base ? `(${parsed.base})` : ''
    };
  }
  const labels = {
    read: 'Read',
    edit: 'Edit',
    write: 'Write',
    patch: 'Patch',
    run: 'Run',
    grep: 'Grep',
    glob: 'Glob',
    list: 'List',
    start_service: 'Service',
    list_services: 'Service',
    get_service_status: 'Service',
    get_service_logs: 'Service',
    stop_service: 'Service',
    list_files: 'Glob',
    create_task: 'Task',
    update_task: 'Task'
  };
  return {
    primary: labels[parsed.base] || parsed.base || 'Tool',
    secondary: parsed.target ? `(${parsed.target})` : ''
  };
}

export function isIndexSystemToolName(name) {
  const parsed = parseToolDisplayName(name);
  return parsed.base === 'project_index' || parsed.base === 'file_index';
}

export function shouldShowCompletionFooter(msg) {
  return Boolean(msg && msg.label === 'coder' && !msg.loading && !(msg.phase || '').trim());
}

function describeToolActivity(name, copy, { done = false, blocked = false } = {}) {
  const parsed = parseToolDisplayName(name);
  if (parsed.base === 'project_index') {
    return blocked
      ? `${copy.toolActivity.blocked}: project index`
      : done
        ? copy.toolActivity.doneProjectIndex
        : copy.toolActivity.doingProjectIndex;
  }
  if (parsed.base === 'file_index') {
    const safeTarget = trimText(parsed.target || '.codemini-project/file-index.json', 72);
    return blocked
      ? `${copy.toolActivity.blocked}: ${safeTarget}`
      : done
        ? `${copy.toolActivity.doneFileIndex}: ${safeTarget}`
        : `${copy.toolActivity.doingFileIndex}: ${safeTarget}`;
  }
  if (parsed.base === 'run' || parsed.base === 'start_service') {
    const intent = classifyCommandIntent(parsed.target);
    const target = parsed.target || intent.kind || 'command';
    if (intent.kind === 'install') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneInstall}: ${target}`
          : `${copy.toolActivity.doingInstall}: ${target}`;
    }
    if (intent.kind === 'build') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneBuild}: ${target}`
          : `${copy.toolActivity.doingBuild}: ${target}`;
    }
    if (intent.kind === 'test') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneTest}: ${target}`
          : `${copy.toolActivity.doingTest}: ${target}`;
    }
    if (intent.kind === 'frontend-service') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneFrontend}: ${target}`
          : `${copy.toolActivity.doingFrontend}: ${target}`;
    }
    if (intent.kind === 'backend-service') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneBackend}: ${target}`
          : `${copy.toolActivity.doingBackend}: ${target}`;
    }
    if (intent.kind === 'database-service') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneDatabase}: ${target}`
          : `${copy.toolActivity.doingDatabase}: ${target}`;
    }
    if (intent.kind === 'docker-service') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneDocker}: ${target}`
          : `${copy.toolActivity.doingDocker}: ${target}`;
    }
    if (intent.kind === 'service') {
      return blocked
        ? `${copy.toolActivity.blocked}: ${target}`
        : done
          ? `${copy.toolActivity.doneGeneric}: ${target}`
          : `${copy.toolActivity.doingGeneric}: ${target}`;
    }
  }
  if (isCodeGenerationActivityName(name)) {
    return blocked
      ? `${copy.toolActivity.blocked}: code generation`
      : done
        ? copy.toolActivity.doneCodeGeneration
        : copy.toolActivity.doingCodeGeneration;
  }
  const { raw, base, target } = parseToolDisplayName(name);
  const safeTarget = trimText(target, 72);
  if (base === 'read') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${base}(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneRead}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingRead}: ${safeTarget || '.'}`;
  }
  if (base === 'edit') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${base}(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneEdit}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingEdit}: ${safeTarget || '.'}`;
  }
  if (base === 'write') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${base}(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneWrite}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingWrite}: ${safeTarget || '.'}`;
  }
  if (base === 'patch') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${base}(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.donePatch}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingPatch}: ${safeTarget || '.'}`;
  }
  if (base === 'list' || base === 'glob' || base === 'grep') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${base}(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneList}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingList}: ${safeTarget || '.'}`;
  }
  if (base === 'run') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${safeTarget || base}`
      : done
        ? `${copy.toolActivity.doneCommand}: ${safeTarget || base}`
        : `${copy.toolActivity.doingCommand}: ${safeTarget || base}`;
  }
  if (base === 'start_service' || base === 'list_services' || base === 'get_service_status' || base === 'get_service_logs' || base === 'stop_service') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${safeTarget || base}`
      : done
        ? `${copy.toolActivity.doneGeneric}: ${safeTarget || base}`
        : `${copy.toolActivity.doingGeneric}: ${safeTarget || base}`;
  }
  if (base === 'create_task') {
    return blocked ? `${copy.toolActivity.blocked}: create_task` : done ? copy.toolActivity.doneCreateTask : copy.toolActivity.doingCreateTask;
  }
  if (base === 'update_task') {
    return blocked ? `${copy.toolActivity.blocked}: update_task` : done ? copy.toolActivity.doneUpdateTask : copy.toolActivity.doingUpdateTask;
  }
  return blocked ? `${copy.toolActivity.blocked}: ${raw}` : done ? `${copy.toolActivity.doneGeneric}: ${raw}` : `${copy.toolActivity.doingGeneric}: ${raw}`;
}

function describeSkillActivity(name, copy, { done = false, failed = false } = {}) {
  if (failed) return `${copy.runtime.skillFailed}: /${name}`;
  if (done) return `${copy.toolActivity.doneSkill}: /${name}`;
  return `${copy.toolActivity.doingSkill}: /${name}`;
}

function describeAutoSkillActivity(names, copy) {
  const safeNames = Array.isArray(names) ? names.filter(Boolean) : [];
  if (safeNames.length === 0) return '';
  return copy.runtime.autoSkillInjected(safeNames);
}

function formatAutoSkillBadge(names, copy) {
  const safeNames = Array.isArray(names) ? names.filter(Boolean) : [];
  if (safeNames.length === 0) return '';
  const [first, ...rest] = safeNames;
  const suffix = rest.length > 0 ? ` +${rest.length}` : '';
  const prefix = copy?.roleLabels?.system === 'SYSTEM' ? 'AUTO' : '自动';
  return `${prefix} /${first}${suffix}`;
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
  const dots = '●○○'.slice(loaderTick % 3, (loaderTick % 3) + 1) || '●';
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
    h(Text, { color: busy ? 'cyanBright' : 'gray' }, dots),
    h(Text, { color: 'gray' }, '  '),
    h(Text, { color: busy ? 'white' : 'gray' }, status.title || copy.generic.waitingForInput)
  );
}

function ContextProgressMeter({ runtimeState, runtimeStatus, compact = false }) {
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
  const statusColor = runtimeStatus?.color || activeColor;
  const chunks = Array.from({ length: 12 }, (_, idx) => {
    const zoneColor = idx < 5 ? 'greenBright' : idx < 9 ? 'yellowBright' : 'redBright';
    const color = idx < filled ? zoneColor : 'gray';
    return h(Text, { key: `context-meter-${idx}`, color }, '|');
  });

  if (compact) {
    return h(
      Box,
      { justifyContent: 'flex-end', alignItems: 'center' },
      h(Text, { color: 'gray' }, '上下文 '),
      h(Text, { color: statusColor }, `${Math.round(pct)}% `),
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
    h(Text, { color: 'gray' }, '上下文 '),
    h(Text, { color: statusColor }, `${Math.round(pct)}% `),
    h(
      Box,
      null,
      ...chunks
    )
  );
}

function PlanStrip({ planState, copy }) {
  if (!planState || !planState.total) return null;
  const progress = `${planState.current}/${planState.total}`;
  return h(
    Box,
    {
      marginBottom: 1,
      borderStyle: 'round',
      borderColor: planState.failed ? 'red' : 'cyan',
      paddingX: 1,
      paddingY: 0,
      flexDirection: 'column'
    },
    h(
      Box,
      { justifyContent: 'space-between' },
      h(
        Box,
        null,
        h(Text, { color: 'black', backgroundColor: planState.failed ? 'red' : 'cyanBright' }, ` ${copy.generic.plan} ${progress} `),
        h(Text, { color: 'gray' }, '  '),
        h(Text, { color: 'magentaBright' }, String(planState.role || 'agent').toUpperCase())
      ),
      h(Text, { color: planState.failed ? 'redBright' : 'greenBright' }, planState.failed ? copy.generic.attention : copy.generic.active)
    ),
    h(Text, { color: 'white' }, planState.title || 'running plan step'),
    planState.steps.length > 0
      ? h(
          Box,
          { marginTop: 1, flexDirection: 'column' },
          ...planState.steps.slice(-4).map((step, idx) =>
            h(
              Box,
              { key: `plan-step-${idx}`, marginTop: idx === 0 ? 0 : 1 },
              h(Text, { color: step.status === 'active' ? 'cyanBright' : step.status === 'failed' ? 'redBright' : 'gray' }, `${step.status === 'active' ? '>' : step.status === 'failed' ? 'x' : '·'} `),
              h(Text, { color: step.status === 'active' ? 'yellowBright' : step.status === 'failed' ? 'redBright' : 'gray' }, `${step.index}/${step.total}`),
              h(Text, { color: 'gray' }, '  '),
              h(Text, { color: step.status === 'active' ? 'magentaBright' : step.status === 'failed' ? 'redBright' : 'gray' }, String(step.role || 'agent').toUpperCase()),
              h(Text, { color: 'gray' }, '  '),
              h(Text, { color: step.status === 'active' ? 'white' : step.status === 'failed' ? 'redBright' : 'gray' }, step.title)
            )
          )
        )
      : null
  );
}

function Header({ sessionId, model, shellName, safeMode = true }) {
  const shortSession = String(sessionId || '').slice(-12) || '-';
  const modeValue = safeMode ? 'SAFE' : 'OPEN';
  const modeColor = safeMode ? 'greenBright' : 'redBright';
  const modeTextColor = safeMode ? 'black' : 'white';
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
      h(Text, { color: 'gray' }, 'optimized for small-model workflows'),
      h(Box, { height: 1 }),
      h(
        Box,
        { flexDirection: 'row', justifyContent: 'center' },
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
    stepsTotal: '',
    completed: '',
    warnings: '',
    failed: '',
    warningSteps: '',
    failedSteps: ''
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith('File: ')) parsed.filePath = line.slice('File: '.length).trim();
    else if (line.startsWith('Plan Summary: ')) parsed.planSummary = line.slice('Plan Summary: '.length).trim();
    else if (line.startsWith('Final Summary: ')) parsed.finalSummary = line.slice('Final Summary: '.length).trim();
    else if (line.startsWith('Steps: ')) parsed.stepsTotal = line.slice('Steps: '.length).trim();
    else if (line.startsWith('Completed: ')) parsed.completed = line.slice('Completed: '.length).trim();
    else if (line.startsWith('Warnings: ')) parsed.warnings = line.slice('Warnings: '.length).trim();
    else if (line.startsWith('Failed: ')) parsed.failed = line.slice('Failed: '.length).trim();
    else if (line.startsWith('Warning steps: ')) parsed.warningSteps = line.slice('Warning steps: '.length).trim();
    else if (line.startsWith('Failed steps: ')) parsed.failedSteps = line.slice('Failed steps: '.length).trim();
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
          if (parsedArguments) {
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
  const codeTools = new Set(['edit', 'write', 'patch', 'generate_diff']);
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
    (tool) => tool?.status === 'running' && new Set(['edit', 'write', 'patch', 'generate_diff']).has(parseToolDisplayName(tool?.name).base)
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
  if (!planState || !planState.total) return source;
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
            { marginBottom: metaItems.length > 0 || summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'cyanBright' }, labels.plan),
            h(Text, { color: 'gray' }, summary.planSummary)
          )
        : null,
      metaItems.length > 0
        ? h(
            Box,
            { marginBottom: summary.warningSteps || summary.failedSteps || shortFile ? 1 : 0 },
            ...metaItems.flatMap((item, idx) => [
              idx > 0 ? h(Text, { key: `sep-${idx}`, color: 'gray' }, '  ') : null,
              h(Text, { key: `meta-${idx}`, color: 'gray' }, item)
            ])
          )
        : null,
      summary.warningSteps
        ? h(
            Box,
            { marginBottom: summary.failedSteps || shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'yellowBright' }, labels.warnings),
            h(Text, { color: 'gray' }, summary.warningSteps)
          )
        : null,
      summary.failedSteps
        ? h(
            Box,
            { marginBottom: shortFile ? 1 : 0, flexDirection: 'column' },
            h(Text, { color: 'redBright' }, labels.failed),
            h(Text, { color: 'gray' }, summary.failedSteps)
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
    'write',
    'write_file',
    'patch',
    'replace_text',
    'replace_block',
    'insert_before',
    'insert_after',
    'validate_edit',
    'generate_diff'
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
      if (!isBlankTextRow(last) && !(next.kind === 'status')) {
        normalized.push({
          kind: 'text',
          text: ' ',
          color: 'white'
        });
      }
    }

    if (isBlankTextRow(row) && isBlankTextRow(prev)) {
      normalized.pop();
    }
  }

  return normalized;
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

function buildMessageRows(msg, showToolDetails, contentWidth = 72, copy) {
  const rows = [];
  const pushTextRows = (text) => {
    const lines = String(text || '').split('\n');
    let codeFence = false;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex];
      const trimmed = line.trim();
      const planProgress = parsePlanProgressLine(trimmed);
      if (planProgress) {
        rows.push({
          kind: 'plan-progress',
          current: planProgress.current,
          total: planProgress.total,
          role: planProgress.role,
          title: trimText(planProgress.title, Math.max(12, contentWidth - 18))
        });
        continue;
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
        const tableLines = [line];
        lineIndex += 1; // skip separator
        while (lineIndex + 1 < lines.length && splitMarkdownTableCells(lines[lineIndex + 1]).length > 1) {
          tableLines.push(lines[lineIndex + 1]);
          lineIndex += 1;
        }
        rows.push(...formatMarkdownTableBlock(tableLines, contentWidth));
        continue;
      }
      let color = msg.color || roleStyle(msg.label).text || 'white';
      if (line.startsWith('#')) color = 'cyanBright';
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
    if ((showToolDetails || idx === total - 1) && tool.summary && tool.status !== 'running') {
      for (const line of String(tool.summary).split('\n')) {
        pushWrappedRow(rows, { kind: 'activity-summary', text: line || ' ', color: 'gray' }, Math.max(8, contentWidth - 4));
      }
    }
  };

  if (Array.isArray(msg?.segments) && msg.segments.length > 0) {
    const totalTools = msg.segments.filter(
      (segment) =>
        segment.type === 'tool' ||
        segment.type === 'skill' ||
        (segment.type === 'system_tool' && (showToolDetails || !isIndexSystemToolName(segment.name)))
    ).length;
    let toolIndex = 0;
    for (const segment of msg.segments) {
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
  } else {
    pushTextRows(msg?.text || '');
    const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls : [];
    toolCalls.forEach((tool, idx) => pushActivityRows(tool, idx, toolCalls.length));
  }

  const codeGenerationRows = getCodeGenerationActivityRows(msg);
  const generatingCodeRows = getGeneratingCodePlaceholderRows(msg, copy, contentWidth);
  const syntheticRows = [...codeGenerationRows, ...generatingCodeRows];
  if (msg?.loading && (msg?.liveStatus || msg?.phase)) {
    const statusRows = [];
    pushWrappedRow(
      statusRows,
      {
        kind: 'status',
        text: trimText(msg.liveStatus || msg.phase, 144)
      },
      Math.max(8, contentWidth - 2)
    );
    syntheticRows.push(...statusRows);
  }

  return normalizeActivitySpacingRows(
    insertRowsAfterLastCodeRow(collapseActivityChainRows(rows, showToolDetails, copy), syntheticRows)
  );
}

function renderMessageRow(msg, row, idx, loaderTick) {
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
    return h(
      Box,
      { key: `row-tool-${msg.id}-${idx}` },
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: dotColor }, '●'),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: textColor }, display.primary),
      h(Text, { color: 'gray' }, display.secondary),
      durationText ? h(Text, { color: row.statusColor }, ` ${durationText}`) : null
    );
  }
  if (row.kind === 'activity-summary') {
    return h(
      Box,
      { key: `row-tool-summary-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray' }, `└ ${row.text}`)
    );
  }
  if (row.kind === 'table') {
    return h(
      Box,
      { key: `row-table-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: row.isHeader ? 'cyanBright' : 'gray', bold: Boolean(row.isHeader) }, row.text)
    );
  }
  if (row.kind === 'table-separator') {
    return h(
      Box,
      { key: `row-table-sep-${msg.id}-${idx}`, marginLeft: 1 },
      h(Text, { color: 'gray' }, row.text)
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
    return h(
      Box,
      { key: `row-plan-progress-${msg.id}-${idx}`, marginTop: 1, marginBottom: 1 },
      h(Text, { color: 'cyanBright' }, '[plan] '),
      h(Text, { color: 'yellowBright' }, `Step ${row.current}/${row.total}`),
      h(Text, { color: 'gray' }, '  ->  '),
      h(Text, { color: 'magentaBright' }, String(row.role || 'agent').toUpperCase()),
      h(Text, { color: 'gray' }, ': '),
      h(Text, { color: 'white' }, row.title)
    );
  }
  if (row.kind === 'status') {
    const dots = '.'.repeat((loaderTick % 3) + 1);
    const phase = msg.phase;
    const color =
      phase === 'sending'
        ? 'yellowBright'
        : phase === 'queued'
          ? 'cyanBright'
          : phase === 'tooling'
            ? 'magentaBright'
          : phase === 'generating'
            ? 'greenBright'
          : 'cyanBright';
    return h(
      Box,
      { key: `row-status-${msg.id}-${idx}`, marginTop: 1 },
      h(Text, { color: 'gray' }, '  '),
      h(Text, { color }, `${row.text}${dots}`)
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

function MessageBubble({ msg, loaderTick, showToolDetails, rowWindow = null, contentWidth = 72, copy }) {
  if (msg?.planStrip) {
    return h(
      Box,
      { marginBottom: 1 },
      h(PlanStrip, { planState: msg.planState, copy })
    );
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
          h(Text, { color: theme.badgeText, backgroundColor: theme.badgeBg }, ` ${messageLabel(msg.label, copy)} `)
        ),
        autoSkillBadge
          ? h(Text, { color: 'blueBright' }, autoSkillBadge)
          : h(Text, { color: theme.chrome }, ' ')
      ),
      ...rendered,
      shouldShowCompletionFooter(msg)
        ? h(
            Box,
            { marginTop: 1, marginLeft: 1, key: `row-completion-${msg.id}` },
            h(Text, { color: 'gray', dimColor: true }, copy.generic.taskCompleted)
          )
        : null
    )
  );
}

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
        loaderTick,
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
      h(Text, { color: 'white' }, beforeCursor),
      h(
        Text,
        {
          color: cursorVisible ? 'black' : 'white',
          backgroundColor: cursorVisible ? 'cyanBright' : undefined
        },
        underCursor || ' '
      ),
      h(Text, { color: 'white' }, afterCursor)
    )
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

export function ChatApp({ runtime, sessionId, model, language = 'zh', shellName = 'powershell', version = '', safeMode = true }) {
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
    steps: []
  });
  const [debugKeys, setDebugKeys] = useState(false);
  const [lastKeyDebug, setLastKeyDebug] = useState('');
  const [showToolDetails, setShowToolDetails] = useState(false);
  const activeAssistantIdRef = useRef(null);
  const activeAssistantAutoSkillNamesRef = useRef([]);
  const streamedAssistantHandledRef = useRef(false);
  const activeUserMessageIdRef = useRef(null);
  const cursorIndexRef = useRef(0);
  const inFlightRef = useRef(false);
  const messagesRef = useRef([]);
  const pendingQueueRef = useRef([]);
  const deltaBufferRef = useRef('');

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
    messagesRef.current = messages;
  }, [messages]);
  const startupHint = copy.generic.startupHint;
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
  const messageContentWidth = Math.max(24, stdoutCols - 18);

  const syncRuntimeVisualState = (variant = 'ready') => {
    const snapshot = runtime.getRuntimeState?.();
    if (!snapshot) return;
    setDisplaySessionId(snapshot.sessionId || sessionId);
    setDisplayModel(snapshot.model || model);
    setRuntimeState(snapshot);
    setRuntimeStatus(makeIdleStatus(copy, snapshot, variant));
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
    const role = String(last[3] || '').trim();
    const title = String(last[4] || '').trim();
    setActiveAssistantMeta({
      planStep: `${current}/${total} · ${role}: ${title}`
    });
    setPlanState((prev) => {
      const steps = (prev.steps || [])
        .map((step) => (step.index === current ? { ...step, status: 'done' } : step))
        .filter((step, idx, arr) => arr.findIndex((x) => x.index === step.index) === idx);
      const withoutCurrent = steps.filter((step) => step.index !== current);
      return {
        current,
        total,
        role,
        title,
        failed: false,
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
            status: toolEvent.status,
            ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
            ...(startedAt ? { startedAt } : {}),
            ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
            ...(toolEvent.summary ? { summary: toolEvent.summary } : {})
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
          status: toolEvent.status,
          ...(toolEvent.arguments !== undefined ? { arguments: toolEvent.arguments } : {}),
          ...(startedAt ? { startedAt } : {}),
          ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
          ...(toolEvent.summary ? { summary: toolEvent.summary } : {})
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
            text: copy.generic.keyboardDebugStatus(debugKeys),
            color: 'yellowBright'
          }
        ]);
        return;
      }
    }
    if (result.type === 'assistant') {
      if (!activeAssistantIdRef.current && result.text) {
        setMessages((prev) => [
          ...prev,
          {
            id: nextId(),
            label: 'coder',
            text: result.text,
            color: 'greenBright',
            autoSkillNames: activeAssistantAutoSkillNamesRef.current
          }
        ]);
      }
      return;
    }
    const parsedPlanSummary = result.type === 'system' ? parseAutoPlanSummaryMessage(result.text || '') : null;
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        label: 'system',
        text: result.text || '',
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
          arguments: typeof toolCall.arguments === 'string' ? safeJsonParse(toolCall.arguments) ?? toolCall.arguments : toolCall.arguments,
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
    setActiveAssistantMeta({
      loading: false,
      phase: undefined,
      liveStatus: undefined,
      planStep: undefined,
      pendingToolCalls: [],
      codeGenerationEndedAt: undefined,
      autoSkillNames: activeAssistantAutoSkillNamesRef.current
    });
  };

  const ensureActiveAssistant = () => {
    if (activeAssistantIdRef.current) return activeAssistantIdRef.current;
    const aid = nextId();
    activeAssistantIdRef.current = aid;
    setMessages((prev) => [
      ...prev,
      {
        id: aid,
        label: 'coder',
        text: '',
        color: 'greenBright',
        toolCalls: [],
        segments: [],
        loading: true,
        phase: 'thinking',
        liveStatus: copy.runtime.modelThinking,
        autoSkillNames: activeAssistantAutoSkillNamesRef.current
      }
    ]);
    return aid;
  };

  const runSubmission = (line, userMessageId = null) => {
    inFlightRef.current = true;
    activeUserMessageIdRef.current = userMessageId;
    setBusy(true);
    setInputStage('sending');
    setRuntimeStatus(makeStatus(copy.runtime.sendingToGateway, copy.runtime.preparingRequest, 'yellowBright'));
    setPlanState({ current: 0, total: 0, role: '', title: '', failed: false, steps: [] });
    planTextBufferRef.current = '';
    activeAssistantIdRef.current = null;
    activeAssistantAutoSkillNamesRef.current = [];
    streamedAssistantHandledRef.current = false;
    deltaBufferRef.current = '';

    runtime
      .submit(line, (event) => {
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
          const isCodeTool = new Set(['write', 'edit', 'patch', 'generate_diff']).has(parsed.base);
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
          if (targetId && !hasPlannedTools) {
            setMessages((prev) =>
              prev.map((m) => {
                if (m.id !== targetId) return m;
                return {
                  ...m,
                  ...(typeof event.text === 'string' && event.text.length > 0 ? { text: event.text } : {}),
                  loading: false,
                  phase: undefined,
                  liveStatus: undefined,
                  planStep: undefined,
                  pendingToolCalls: [],
                  autoSkillNames: activeAssistantAutoSkillNamesRef.current,
                  ...(m.codeGenerationStartedAt && !m.codeGenerationEndedAt ? { codeGenerationEndedAt: Date.now() } : {})
                };
              })
            );
          }
          if (!hasPlannedTools) {
            activeAssistantIdRef.current = null;
          }
          if (!hadActiveAssistant && !hasPlannedTools && event.text) {
            setMessages((prev) => [
              ...prev,
              { id: nextId(), label: 'coder', text: event.text, color: 'greenBright' }
            ]);
          }
        }
        if (event?.type === 'tool:start') {
          ensureActiveAssistant();
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
            status: 'done',
            durationMs: event.durationMs,
            summary: event.summary,
            arguments: event.arguments
          });
        }
        if (event?.type === 'tool:blocked') {
          const detail = describeToolActivity(event.name, copy, { blocked: true });
          setRuntimeStatus(makeStatus(copy.runtime.toolBlocked, detail, 'redBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelAdjust(detail) });
          setPlanState((prev) => ({
            ...prev,
            failed: prev.total > 0,
            steps: (prev.steps || []).map((step) =>
              step.index === prev.current ? { ...step, status: 'failed' } : step
            )
          }));
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
            status: 'blocked',
            arguments: event.arguments
          });
        }
        if (event?.type === 'tool:error') {
          const detail = copy.toolActivity.toolFailed(event.name);
          setRuntimeStatus(makeStatus(copy.runtime.toolFailed, event.summary || detail, 'redBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelAdjust(detail) });
          setPlanState((prev) => ({
            ...prev,
            failed: prev.total > 0,
            steps: (prev.steps || []).map((step) =>
              step.index === prev.current ? { ...step, status: 'failed' } : step
            )
          }));
          updateActivityStatusOnActiveAssistant({
            type: 'tool',
            id: event.id,
            name: event.name,
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
        if (event?.type === 'skill:auto') {
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
              label: 'system',
              text: copy.runtime.autoCompactTriggered(event.mode, event.threshold),
              color: 'yellowBright'
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
        if (planTextBufferRef.current && planState.total > 0) {
          setPlanState((prev) => ({
            ...prev,
            steps: (prev.steps || []).map((step) =>
              step.index === prev.current && step.status === 'active' ? { ...step, status: prev.failed ? 'failed' : 'done' } : step
            )
          }));
        }
        syncRuntimeVisualState(result.type === 'noop' ? 'ready' : 'after');
        if (result.type === 'noop') return;
        if (!shouldAppendAssistantResult(result, activeAssistantIdRef.current, streamedAssistantHandledRef.current)) return;
        appendResultMessage(result);
      })
      .catch((err) => {
        setRuntimeStatus(makeStatus(copy.runtime.requestFailed, err.message, 'redBright'));
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
            step.index === prev.current ? { ...step, status: 'failed' } : step
          )
        }));
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'error', text: err.message, color: 'redBright' }
        ]);
      })
      .finally(() => {
        flushAssistantDelta();
        finalizeActiveAssistant();
        activeAssistantIdRef.current = null;
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
            liveStatus: copy.runtime.sendingToGateway
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
        updateMessageMeta(userMessageId, {
          loading: false,
          phase: undefined,
          liveStatus: undefined
        });
        setMessages((prev) => [
          ...prev,
          { id: nextId(), label: 'error', text: err.message, color: 'redBright' }
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

      setHistory((prev) => [...prev, line]);
      setHistoryIndex(null);
      setDraftBeforeHistory('');
      setHistoryMatches([]);

      const messageId = nextId();
      const immediateLocal =
        typeof runtime.isImmediateLocalInput === 'function' &&
        runtime.isImmediateLocalInput(line);
      setMessages((prev) => [
        ...prev,
        {
          id: messageId,
          label: 'you',
          text: line,
          color: 'white',
          loading: true,
          phase: immediateLocal ? 'sending' : inFlightRef.current ? 'queued' : 'sending',
          liveStatus: immediateLocal
            ? copy.runtime.localCommandRunning
            : inFlightRef.current
              ? copy.runtime.queuedWaiting
              : copy.runtime.sendingToGateway
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
    const hasLoadingMessage = messages.some((m) => m.loading);
    if (!busy && !hasLoadingMessage) return () => {};
    const timer = setInterval(() => {
      setLoaderTick((prev) => prev + 1);
    }, 500);
    return () => clearInterval(timer);
  }, [busy, messages]);

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

  return h(
    Box,
    { flexDirection: 'column' },
    h(Header, { sessionId: displaySessionId, model: displayModel, shellName, safeMode }),
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
      h(ContextProgressMeter, { runtimeState, runtimeStatus, compact: true })
    ),
    h(SuggestionPanel, { commandSuggestions, suggestionNav, menuIndex, copy }),
    h(PendingPanel, { pendingQueue, copy }),
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
