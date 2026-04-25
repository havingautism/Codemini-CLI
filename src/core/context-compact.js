import { summarizeToolResult, trimInline } from './agent-loop.js';

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

export function estimateMessagesTokens(messages) {
  let total = 0;
  for (const message of messages || []) {
    const roleOverhead = 6;
    const text = textFromContent(message.content);
    let asciiChars = 0;
    let nonAsciiChars = 0;
    for (const char of text) {
      if (char.charCodeAt(0) <= 0x7f) asciiChars += 1;
      else nonAsciiChars += 1;
    }
    total += roleOverhead + Math.ceil(asciiChars / 4) + Math.ceil(nonAsciiChars / 2);
  }
  return total;
}

function modeToKeepRecent(mode) {
  if (mode === 'aggressive') return 4;
  if (mode === 'conservative') return 10;
  return 6;
}

function buildLocalSummary(messages) {
  const goal = [];
  const constraints = [];
  const changedFiles = new Set();
  const verification = [];
  const openThreads = [];
  const limit = 16;
  for (const msg of messages.slice(-limit)) {
    if (msg.role === 'tool') {
      const text = textFromContent(msg.content);
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = null; }
      if (parsed && typeof parsed === 'object') {
        const summary = summarizeToolResult(parsed);
        if (parsed.path) changedFiles.add(String(parsed.path));
        if (parsed.command || parsed.code != null || parsed.stderr || parsed.stdout) {
          verification.push(summary);
        } else {
          openThreads.push(`tool_result: ${summary}`);
        }
      } else {
        const clipped = text.length > 120 ? `${text.slice(0, 117)}...` : text;
        const match = clipped.match(/([A-Za-z0-9_./-]+\.[A-Za-z0-9]+):\d+/);
        if (match) changedFiles.add(match[1]);
        openThreads.push(`tool_result: ${clipped}`);
      }
      continue;
    }
    if (msg.role === 'assistant') {
      const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
      const toolCallCount = Array.isArray(msg.tool_calls) ? msg.tool_calls.length : 0;
      const toolInfo = toolCallCount > 0 ? ` [called ${toolCallCount} tool(s)]` : '';
      const clipped = text.length > 300 ? `${text.slice(0, 297)}...` : text;
      if (clipped) openThreads.push(`assistant: ${clipped}${toolInfo}`);
      continue;
    }
    if (msg.role === 'user') {
      const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
      const clipped = text.length > 200 ? `${text.slice(0, 197)}...` : text;
      if (goal.length === 0) goal.push(clipped);
      else constraints.push(clipped);
      continue;
    }
    const text = textFromContent(msg.content).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const clipped = text.length > 160 ? `${text.slice(0, 157)}...` : text;
    openThreads.push(`${msg.role}: ${clipped}`);
  }
  const lines = [
    'Context Summary',
    'Goal:',
    goal.length > 0 ? `- ${goal[0]}` : '- Unknown from compacted context',
    'Key Constraints:',
    ...(constraints.length > 0 ? constraints.slice(-4).map((item) => `- ${item}`) : ['- None recorded']),
    'Changed Files:',
    ...(changedFiles.size > 0 ? [...changedFiles].slice(0, 8).map((item) => `- ${item}`) : ['- None recorded']),
    'Verification:',
    ...(verification.length > 0 ? verification.slice(-4).map((item) => `- ${item}`) : ['- None recorded']),
    'Open Threads:',
    ...(openThreads.length > 0 ? openThreads.slice(-8).map((item) => `- ${item}`) : ['- None recorded'])
  ];
  return lines.join('\n').trim();
}

export function compactMessagesLocally(messages, { mode = 'default' } = {}) {
  const keepRecent = modeToKeepRecent(mode);
  if (!Array.isArray(messages) || messages.length <= keepRecent + 1) {
    return {
      compacted: [...(messages || [])],
      changed: false
    };
  }

  const older = messages.slice(0, Math.max(0, messages.length - keepRecent));
  const recent = messages.slice(Math.max(0, messages.length - keepRecent));
  const summary = buildLocalSummary(older);
  const compacted = [{ role: 'assistant', content: summary }, ...recent];

  return {
    compacted,
    changed: true,
    summary
  };
}

export function parseCompactArgs(args = []) {
  const parsed = {
    mode: 'default',
    preview: false,
    restore: false,
    auto: undefined,
    threshold: undefined
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--preview') parsed.preview = true;
    if (arg === '--restore') parsed.restore = true;
    if (arg === '--aggressive') parsed.mode = 'aggressive';
    if (arg === '--conservative') parsed.mode = 'conservative';
    if (arg === '--default') parsed.mode = 'default';
    if (arg === '--auto-on') parsed.auto = 'on';
    if (arg === '--auto-off') parsed.auto = 'off';
    if (arg === '--threshold') {
      const n = Number(args[i + 1]);
      if (!Number.isNaN(n)) parsed.threshold = n;
      i += 1;
    }
  }

  return parsed;
}
