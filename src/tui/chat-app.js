import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';

const h = React.createElement;
const BANNER = ['CODEMINI CLI'];
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
      code: '代码',
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
      startupHint: '使用 /help、/commands、/exit、!<shell>。Tab 可自动补全 slash 命令。',
      toolSummaryExpanded: '工具摘要：已展开',
      toolSummaryCollapsed: '工具摘要：已收起',
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
      doneWrite: '已写入文件',
      doingWrite: '正在写入文件',
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
      toolFailed: (name) => `工具执行失败: ${name}`,
      waitingModelContinue: (detail) => `${detail}，等待模型继续`,
      waitingModelAdjust: (detail) => `${detail}，等待模型调整`
    },
    suggestion: {
      singleTab: 'Tab 补全当前命令',
      navFill: 'Tab 保持切换模式，↑↓选择，Enter 填入',
      navEnter: 'Tab 进入切换模式，再用 ↑↓ 选择',
      noSuggestions: '/ 查看命令，Tab 自动补全，↑↓ 历史，Ctrl+T 展开工具',
      oneNav: 'Tab 或 Enter 填入当前命令，↑↓ 历史',
      oneIdle: 'Tab 补全当前唯一候选，Enter 直接发送，↑↓ 历史',
      manyNav: (count) => `Tab 切换候选，↑↓选择，Enter 填入 (${count} 项)`,
      manyIdle: (count) => `Tab 进入候选切换 (${count} 项)，↑↓ 历史`
    },
    runtime: {
      sendingToGateway: '正在发送到网关',
      preparingRequest: '准备本轮请求',
      modelThinking: '模型正在思考',
      requestDelivered: '请求已送达，等待首个 token',
      generatingReply: '正在生成回复',
      streamingReply: '回复正在流式输出',
      replyCompleted: '回复已完成',
      outputFinished: '本轮输出结束',
      toolRunning: '工具执行中',
      toolCompleted: '工具已完成',
      toolBlocked: '工具被拦截',
      toolFailed: '工具执行失败',
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
      code: 'code',
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
      startupHint: 'Use /help, /commands, /exit, !<shell>. Tab for slash autocomplete.',
      toolSummaryExpanded: 'Tool summary: expanded',
      toolSummaryCollapsed: 'Tool summary: collapsed',
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
      doneWrite: 'Wrote file',
      doingWrite: 'Writing file',
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
      toolFailed: (name) => `Tool failed: ${name}`,
      waitingModelContinue: (detail) => `${detail}, waiting for model to continue`,
      waitingModelAdjust: (detail) => `${detail}, waiting for model to adjust`
    },
    suggestion: {
      singleTab: 'Tab completes the current command',
      navFill: 'Tab stays in pick mode, ↑↓ select, Enter applies',
      navEnter: 'Tab enters pick mode, then use ↑↓ to choose',
      noSuggestions: '/ shows commands, Tab autocompletes, ↑↓ history, Ctrl+T tools',
      oneNav: 'Tab or Enter applies the current command, ↑↓ history',
      oneIdle: 'Tab completes the only candidate, Enter sends, ↑↓ history',
      manyNav: (count) => `Tab cycles candidates, ↑↓ select, Enter applies (${count} items)`,
      manyIdle: (count) => `Tab enters candidate mode (${count} items), ↑↓ history`
    },
    runtime: {
      sendingToGateway: 'sending to gateway',
      preparingRequest: 'preparing this turn',
      modelThinking: 'model is thinking',
      requestDelivered: 'request sent, waiting for first token',
      generatingReply: 'generating reply',
      streamingReply: 'reply is streaming',
      replyCompleted: 'reply completed',
      outputFinished: 'turn output finished',
      toolRunning: 'tool running',
      toolCompleted: 'tool completed',
      toolBlocked: 'tool blocked',
      toolFailed: 'tool failed',
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

function parseToolDisplayName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^([^(]+)\((.*)\)$/);
  return {
    raw,
    base: match ? match[1] : raw,
    target: match ? match[2] : ''
  };
}

function getToolNameBadgeStyle(name) {
  const { base } = parseToolDisplayName(name);
  if (base === 'read_file') {
    return { bg: 'blueBright', text: 'black', label: 'read' };
  }
  if (base === 'write_file') {
    return { bg: 'magentaBright', text: 'black', label: 'write' };
  }
  if (base === 'run_command') {
    return { bg: 'cyan', text: 'black', label: 'run' };
  }
  return { bg: 'gray', text: 'black', label: base || 'tool' };
}

function describeToolActivity(name, copy, { done = false, blocked = false } = {}) {
  const { raw, base, target } = parseToolDisplayName(name);
  const safeTarget = trimText(target, 72);
  if (base === 'read_file') {
    return blocked
      ? `${copy.toolActivity.blocked}: read_file(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneRead}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingRead}: ${safeTarget || '.'}`;
  }
  if (base === 'write_file') {
    return blocked
      ? `${copy.toolActivity.blocked}: write_file(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneWrite}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingWrite}: ${safeTarget || '.'}`;
  }
  if (base === 'list_files') {
    return blocked
      ? `${copy.toolActivity.blocked}: list_files(${safeTarget || '.'})`
      : done
        ? `${copy.toolActivity.doneList}: ${safeTarget || '.'}`
        : `${copy.toolActivity.doingList}: ${safeTarget || '.'}`;
  }
  if (base === 'run_command') {
    return blocked
      ? `${copy.toolActivity.blocked}: ${safeTarget || 'run_command'}`
      : done
        ? `${copy.toolActivity.doneCommand}: ${safeTarget || 'run_command'}`
        : `${copy.toolActivity.doingCommand}: ${safeTarget || 'run_command'}`;
  }
  if (base === 'create_task') {
    return blocked ? `${copy.toolActivity.blocked}: create_task` : done ? copy.toolActivity.doneCreateTask : copy.toolActivity.doingCreateTask;
  }
  if (base === 'update_task') {
    return blocked ? `${copy.toolActivity.blocked}: update_task` : done ? copy.toolActivity.doneUpdateTask : copy.toolActivity.doingUpdateTask;
  }
  return blocked ? `${copy.toolActivity.blocked}: ${raw}` : done ? `${copy.toolActivity.doneGeneric}: ${raw}` : `${copy.toolActivity.doingGeneric}: ${raw}`;
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
    h(Text, { color: busy ? 'white' : 'gray' }, status.title || copy.generic.waitingForInput),
    status.detail ? h(Text, { color: 'gray' }, `  ${status.detail}`) : null
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
              { key: `plan-step-${idx}` },
              h(Text, { color: step.status === 'active' ? 'cyanBright' : step.status === 'failed' ? 'redBright' : 'gray' }, `${step.status === 'active' ? '>' : step.status === 'failed' ? 'x' : '·'} `),
              h(Text, { color: step.status === 'active' ? 'white' : step.status === 'failed' ? 'redBright' : 'gray' }, `${step.index}/${step.total} ${step.role}: ${step.title}`)
            )
          )
        )
      : null
  );
}

function Header({ sessionId, model, shellName }) {
  const shortSession = String(sessionId || '').slice(-12) || '-';
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
      h(
        Box,
        { width: '100%', justifyContent: 'space-between', marginBottom: 1 },
        h(Text, { color: 'cyan' }, ':: CODEMINI CLI ::'),
        h(Text, { color: 'greenBright' }, 'SAFE')
      ),
      ...BANNER.map((line, idx) => h(Text, { key: `b-${idx}`, color: 'cyanBright' }, line)),
      h(Box, { height: 1 }),
      h(Text, { color: 'gray' }, 'optimized for small-model workflows'),
      h(Box, { height: 1 }),
      h(
        Box,
        { flexDirection: 'row', justifyContent: 'center' },
        h(StatusPill, { label: 'MODEL', value: model, color: 'cyanBright', textColor: 'black' }),
        h(StatusPill, { label: 'SHELL', value: shellName || 'powershell', color: 'greenBright', textColor: 'black' }),
        h(StatusPill, { label: 'SESSION', value: shortSession, color: 'magentaBright', textColor: 'black' })
      )
    )
  );
}

function renderInlineCode(line, baseColor) {
  const parts = line.split(/(`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      return h(
        Text,
        { key: `ic-${idx}`, color: 'black', backgroundColor: 'yellow' },
        part.slice(1, -1)
      );
    }
    return h(Text, { key: `tx-${idx}`, color: baseColor }, part);
  });
}

function renderTextLine(msg, line, idx, color) {
  return h(
    Box,
    { key: `ln-wrap-${msg.id}-${idx}` },
    h(Text, { key: `ln-${msg.id}-${idx}`, color }, ...renderInlineCode(line, color))
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

function buildMessageRows(msg, showToolDetails, contentWidth = 72) {
  const rows = [];
  const pushTextRows = (text) => {
    const lines = String(text || '').split('\n');
    let codeFence = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('```')) {
        codeFence = !codeFence;
        continue;
      }
      if (codeFence) {
        pushWrappedRow(rows, { kind: 'code', text: line || ' ', color: 'gray' }, contentWidth);
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

  const pushToolRows = (tool, idx, total) => {
    const statusIcon = tool.status === 'done' ? '✓' : tool.status === 'blocked' || tool.status === 'error' ? '×' : '…';
    const statusColor =
      tool.status === 'done' ? 'greenBright' : tool.status === 'blocked' || tool.status === 'error' ? 'redBright' : 'yellow';
    const durationText =
      typeof tool.durationMs === 'number' ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';
    rows.push({
      kind: 'tool',
      name: tool.name,
      statusIcon,
      statusColor,
      status: tool.status,
      durationText,
      isLatestTool: idx === total - 1
    });
    if ((showToolDetails || idx === total - 1) && tool.summary && tool.status !== 'running') {
      for (const line of String(tool.summary).split('\n')) {
        pushWrappedRow(rows, { kind: 'tool-summary', text: line || ' ', color: 'gray' }, Math.max(8, contentWidth - 2));
      }
    }
  };

  if (Array.isArray(msg?.segments) && msg.segments.length > 0) {
    const totalTools = msg.segments.filter((segment) => segment.type === 'tool').length;
    let toolIndex = 0;
    for (const segment of msg.segments) {
      if (segment.type === 'tool') {
        pushToolRows(segment, toolIndex, totalTools);
        toolIndex += 1;
      } else {
        pushTextRows(segment.text || '');
      }
    }
  } else {
    pushTextRows(msg?.text || '');
    const toolCalls = Array.isArray(msg?.toolCalls) ? msg.toolCalls : [];
    toolCalls.forEach((tool, idx) => pushToolRows(tool, idx, toolCalls.length));
  }

  if (msg?.loading && (msg?.liveStatus || msg?.phase)) {
    pushWrappedRow(
      rows,
      {
        kind: 'status',
        text: trimText(msg.liveStatus || msg.phase, 144)
      },
      Math.max(8, contentWidth - 2)
    );
  }

  return rows;
}

function renderRichTextBlock(msg, text, copy, keyPrefix = 'body') {
  const lines = String(text || '').split('\n');
  const rendered = [];
  let codeFence = false;
  let codeBuffer = [];
  let codeStart = 0;
  const flushCodeBlock = () => {
    if (codeBuffer.length === 0) return;
    rendered.push(
      h(
        Box,
        {
          key: `${keyPrefix}-code-${msg.id}-${codeStart}`,
          marginTop: 1,
          marginBottom: 1,
          marginLeft: 1,
          flexDirection: 'column',
          borderStyle: 'round',
          borderColor: 'gray',
          paddingX: 1,
          paddingY: 0
        },
        h(Text, { color: 'gray' }, copy.generic.code),
        ...codeBuffer.map((codeLine, idx) =>
          h(Text, { key: `${keyPrefix}-code-ln-${msg.id}-${codeStart + idx}`, color: 'gray' }, codeLine || ' ')
        )
      )
    );
    codeBuffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      if (!codeFence) {
        codeFence = true;
        codeStart = i;
        codeBuffer = [];
      } else {
        codeFence = false;
        flushCodeBlock();
      }
      continue;
    }
    if (codeFence) {
      codeBuffer.push(line);
      continue;
    }
    let color = msg.color || roleStyle(msg.label).text || 'white';
    if (line.startsWith('#')) color = 'cyanBright';
    else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) color = 'magentaBright';
    else if (trimmed.startsWith('>')) color = 'yellow';
    else if (/^[|└├│]/.test(trimmed)) color = 'gray';
    if (trimmed.startsWith('>')) {
      rendered.push(
        h(
          Box,
          {
            key: `${keyPrefix}-quote-${msg.id}-${i}`,
            marginTop: 1,
            marginLeft: 1,
            paddingLeft: 1
          },
          h(Text, { color: 'yellow' }, '▍ '),
          h(Text, { color }, ...renderInlineCode(line, color))
        )
      );
      continue;
    }
    if (/^[|└├│]/.test(trimmed)) {
      rendered.push(
        h(
          Box,
          { key: `${keyPrefix}-tree-${msg.id}-${i}`, marginLeft: 1 },
          h(Text, { color }, line)
        )
      );
      continue;
    }
    rendered.push(
      h(
        Box,
        { key: `${keyPrefix}-ln-wrap-${msg.id}-${i}` },
        h(Text, { color }, ...renderInlineCode(line, color))
      )
    );
  }
  flushCodeBlock();
  return rendered;
}

function renderToolEntry(msg, tool, idx, showToolDetails, isLatestTool) {
  const statusIcon = tool.status === 'done' ? '✓' : tool.status === 'blocked' || tool.status === 'error' ? '×' : '…';
  const statusColor =
    tool.status === 'done' ? 'greenBright' : tool.status === 'blocked' || tool.status === 'error' ? 'redBright' : 'yellow';
  const pillBg = tool.status === 'done' ? 'green' : tool.status === 'blocked' || tool.status === 'error' ? 'red' : 'yellow';
  const nameBadge = getToolNameBadgeStyle(tool.name);
  const durationText =
    typeof tool.durationMs === 'number' ? `${(tool.durationMs / 1000).toFixed(1)}s` : '';
  const header = h(
    Box,
    { key: `toolbox-${msg.id}-${idx}`, flexDirection: 'column' },
    h(
      Box,
      null,
      h(Text, { color: 'gray' }, '  ↳ '),
      h(Text, { color: 'black', backgroundColor: 'gray' }, ' tool '),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: nameBadge.text, backgroundColor: nameBadge.bg }, ` ${nameBadge.label} `),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: 'black', backgroundColor: 'gray' }, ` ${tool.name} `),
      h(Text, { color: 'gray' }, ' '),
      h(Text, { color: 'black', backgroundColor: pillBg }, ` ${statusIcon} `),
      durationText ? h(Text, { color: statusColor }, ` ${durationText}`) : null
    )
  );
  if ((!showToolDetails && !isLatestTool) || !tool.summary || tool.status === 'running') return [header];
  return [
    header,
    h(
      Box,
      { key: `tool-${msg.id}-${idx}-summary-box`, marginLeft: 1 },
      h(Text, { key: `tool-${msg.id}-${idx}-summary`, color: 'gray' }, tool.summary)
    )
  ];
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

function MessageBubble({ msg, loaderTick, showToolDetails, rowWindow = null, contentWidth = 72, copy }) {
  const theme = roleStyle(msg.label);
  const allRows = buildMessageRows(msg, showToolDetails, contentWidth);
  const start = rowWindow ? Math.max(0, rowWindow.start || 0) : 0;
  const end = rowWindow ? Math.max(start, rowWindow.end || allRows.length) : allRows.length;
  const visibleRows = allRows.slice(start, end);
  const rendered = visibleRows.map((row, idx) => {
    if (row.kind === 'tool') {
      const pillBg = row.status === 'done' ? 'green' : row.status === 'blocked' || row.status === 'error' ? 'red' : 'yellow';
      const nameBadge = getToolNameBadgeStyle(row.name);
      return h(
        Box,
        { key: `row-tool-${msg.id}-${idx}` },
        h(Text, { color: 'gray' }, '  ↳ '),
        h(Text, { color: 'black', backgroundColor: 'gray' }, ' tool '),
        h(Text, { color: 'gray' }, ' '),
        h(Text, { color: nameBadge.text, backgroundColor: nameBadge.bg }, ` ${nameBadge.label} `),
        h(Text, { color: 'gray' }, ' '),
        h(Text, { color: 'black', backgroundColor: 'gray' }, ` ${row.name} `),
        h(Text, { color: 'gray' }, ' '),
        h(Text, { color: 'black', backgroundColor: pillBg }, ` ${row.statusIcon} `),
        row.durationText ? h(Text, { color: row.statusColor }, ` ${row.durationText}`) : null
      );
    }
    if (row.kind === 'tool-summary') {
      return h(
        Box,
        { key: `row-tool-summary-${msg.id}-${idx}`, marginLeft: 1 },
        h(Text, { color: 'gray' }, row.text)
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
    return renderTextLine(msg, row.text, idx, row.color);
  });

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
        h(Text, { color: theme.chrome }, ' ')
      ),
      ...rendered
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
  const grouped = groupCommandSuggestions(commandSuggestions);
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
      h(Text, { color: 'gray' }, `  ${panelHint}`)
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
        const active = suggestionNav && menuIndex === flatIndex;
        const label = getSuggestionDisplay(c);
        nodes.push(
          h(
            Box,
            { key: `opt-${group}-${getSuggestionValue(c)}` },
            h(Text, { color: active ? 'black' : 'magenta', backgroundColor: active ? 'magentaBright' : undefined }, `${active ? ' > ' : '   '}${label}`)
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
      marginTop: 1,
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
      marginTop: 1,
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
        null,
        h(Text, { color: 'black', backgroundColor: 'greenBright' }, ` ${copy.generic.safeMode} `),
        inputStage !== 'idle' || busy ? h(Text, { color: status.color }, `  ${status.tag}`) : null,
        pendingQueueLength > 0 ? h(Text, { color: 'cyanBright' }, `  ${copy.generic.queued} ${pendingQueueLength}`) : null,
        h(Text, { color: showToolDetails ? 'greenBright' : 'gray' }, `  ${copy.generic.tools} ${showToolDetails ? copy.generic.open : copy.generic.collapsed}`)
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

function SignatureBar({ version = '0.1.0' }) {
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

export function ChatApp({ runtime, sessionId, model, language = 'zh', shellName = 'powershell', version = '0.1.0' }) {
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
  const [pendingQueue, setPendingQueue] = useState([]);
  const [loaderTick, setLoaderTick] = useState(0);
  const [runtimeStatus, setRuntimeStatus] = useState(
    makeStatus(copy.runtime.idleReady, copy.runtime.idleReadyDetail, 'gray')
  );
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
  const activeUserMessageIdRef = useRef(null);
  const cursorIndexRef = useRef(0);
  const inFlightRef = useRef(false);
  const pendingQueueRef = useRef([]);
  const deltaBufferRef = useRef('');
  const deltaFlushTimerRef = useRef(null);
  const escSeqRef = useRef('');
  const planTextBufferRef = useRef('');
  const { exit } = useApp();
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
      ? (runtime.getCompletionOptions(inputValue) || []).slice(0, 8)
      : [];
  const hasTransientPanels =
    commandSuggestions.length > 0 || pendingQueue.length > 0 || debugKeys || Boolean(planState?.total);
  const messageContentWidth = Math.max(24, stdoutCols - 18);

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
        return { ...m, text: `${m.text}${delta}`, segments };
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

  const updateToolStatusOnActiveAssistant = (toolEvent) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== targetId) return m;
        const toolCalls = Array.isArray(m.toolCalls) ? [...m.toolCalls] : [];
        const byId = toolEvent.id
          ? toolCalls.findIndex((t) => t.id && t.id === toolEvent.id)
          : -1;
        const byNameRunning = toolCalls.findIndex(
          (t) => t.name === toolEvent.name && t.status !== 'done'
        );
        const idx = byId !== -1 ? byId : byNameRunning;

        if (idx === -1) {
          toolCalls.push({
            id: toolEvent.id || '',
            name: toolEvent.name,
            status: toolEvent.status,
            ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
            ...(toolEvent.summary ? { summary: toolEvent.summary } : {})
          });
        } else {
          toolCalls[idx] = {
            ...toolCalls[idx],
            id: toolEvent.id || toolCalls[idx].id,
            status: toolEvent.status,
            ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
            ...(toolEvent.summary ? { summary: toolEvent.summary } : {})
          };
        }
        const segments = Array.isArray(m.segments) ? [...m.segments] : [];
        const bySegmentId = toolEvent.id
          ? segments.findIndex((segment) => segment.type === 'tool' && segment.id === toolEvent.id)
          : -1;
        const bySegmentName = segments.findIndex(
          (segment) => segment.type === 'tool' && segment.name === toolEvent.name && segment.status !== 'done'
        );
        const segmentIdx = bySegmentId !== -1 ? bySegmentId : bySegmentName;
        const patch = {
          type: 'tool',
          id: toolEvent.id || '',
          name: toolEvent.name,
          status: toolEvent.status,
          ...(toolEvent.durationMs !== undefined ? { durationMs: toolEvent.durationMs } : {}),
          ...(toolEvent.summary ? { summary: toolEvent.summary } : {})
        };
        if (segmentIdx === -1) {
          segments.push(patch);
        } else {
          segments[segmentIdx] = {
            ...segments[segmentIdx],
            ...patch
          };
        }
        return { ...m, toolCalls, segments };
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
          { id: nextId(), label: 'coder', text: result.text, color: 'greenBright' }
        ]);
      }
      return;
    }
    setMessages((prev) => [
      ...prev,
      { id: nextId(), label: 'system', text: result.text || '', color: 'yellowBright' }
    ]);
  };

  const setActiveAssistantMeta = (patch) => {
    const targetId = activeAssistantIdRef.current;
    if (!targetId) return;
    setMessages((prev) => prev.map((m) => (m.id === targetId ? { ...m, ...patch } : m)));
  };

  const finalizeActiveAssistant = () => {
    setActiveAssistantMeta({ loading: false, phase: undefined, liveStatus: undefined, planStep: undefined });
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
        liveStatus: copy.runtime.modelThinking
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
    deltaBufferRef.current = '';

    runtime
      .submit(line, (event) => {
        if (event?.type === 'assistant:start') {
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
          setActiveAssistantMeta({ loading: true, phase: 'generating', liveStatus: copy.runtime.generatingReply });
          queueAssistantDelta(event.text);
        }
        if (event?.type === 'assistant:response') {
          setRuntimeStatus(makeStatus(copy.runtime.replyCompleted, copy.runtime.outputFinished, 'greenBright'));
          setInputStage('idle');
          flushAssistantDelta();
          finalizeActiveAssistant();
          if (!activeAssistantIdRef.current && event.text) {
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
          setActiveAssistantMeta({ loading: true, phase: 'tooling', liveStatus: detail });
          updateToolStatusOnActiveAssistant({
            id: event.id,
            name: event.name,
            status: 'running'
          });
        }
        if (event?.type === 'tool:end') {
          const detail = describeToolActivity(event.name, copy, { done: true });
          setRuntimeStatus(makeStatus(copy.runtime.toolCompleted, copy.toolActivity.waitingModelContinue(detail), 'cyanBright'));
          setInputStage('thinking');
          setActiveAssistantMeta({ loading: true, phase: 'thinking', liveStatus: copy.toolActivity.waitingModelContinue(detail) });
          updateToolStatusOnActiveAssistant({
            id: event.id,
            name: event.name,
            status: 'done',
            durationMs: event.durationMs,
            summary: event.summary
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
          updateToolStatusOnActiveAssistant({
            id: event.id,
            name: event.name,
            status: 'blocked'
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
          updateToolStatusOnActiveAssistant({
            id: event.id,
            name: event.name,
            status: 'error',
            durationMs: event.durationMs,
            summary: event.summary
          });
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
          setDisplaySessionId(runtime.getCurrentSessionId?.() || sessionId);
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
        setRuntimeStatus(
          result.type === 'noop'
            ? makeStatus(copy.runtime.idleReady, copy.runtime.idleReadyDetail, 'gray')
            : makeStatus(copy.runtime.idleAfterTurn, copy.runtime.idleAfterTurnDetail, 'gray')
        );
        if (result.type === 'noop') return;
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
          setRuntimeStatus(makeStatus(copy.runtime.idleReady, copy.runtime.idleReadyDetail, 'gray'));
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
          setDisplaySessionId(runtime.getCurrentSessionId?.() || sessionId);
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

    if (value === '\u001b' || escSeqRef.current || value === '[' || value === '3' || value === '~' || value === ';' || value === '2' || value === '5') {
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
        setMenuIndex((prev) => Math.max(0, prev - 1));
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
        setMenuIndex((prev) => Math.min(commandSuggestions.length - 1, prev + 1));
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
      setSuggestionNav(false);
      const next = Math.max(0, cursorIndexRef.current - 1);
      cursorIndexRef.current = next;
      setCursorIndex(next);
      return;
    }
    if (key.rightArrow) {
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
  const visibleMessages = hasConversationStarted
    ? messages.filter((m) => !(m.label === 'system' && m.text === startupHint))
    : messages;

  return h(
    Box,
    { flexDirection: 'column' },
    h(Header, { sessionId: displaySessionId, model, shellName }),
    h(RuntimeStrip, { busy, runtimeStatus, loaderTick, copy }),
    h(PlanStrip, { planState, copy }),
    h(MessageList, {
      messages: visibleMessages,
      loaderTick,
      showToolDetails,
      contentWidth: messageContentWidth,
      copy
    }),
    h(
      Box,
      { marginTop: 1 },
      h(
        Text,
        { color: 'gray' },
        `${showToolDetails ? copy.generic.toolSummaryExpanded : copy.generic.toolSummaryCollapsed} (${copy.generic.toggleToolSummary})  ·  ${copy.generic.scrollHint}`
      )
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
