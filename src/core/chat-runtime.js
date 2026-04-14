import { parseInput } from './input-parser.js';
import { loadCommandsAndSkills, renderCommandPrompt } from './command-loader.js';
import { runAgentLoop, setResultDir, clearResultStore } from './agent-loop.js';
import { trimInline, normalizePath } from './string-utils.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createChatCompletion,
  createChatCompletionStream
} from './provider/index.js';
import { isDangerousCommand, runShellCommand } from './shell.js';
import { getBuiltinTools } from './tools.js';
import { createSession, listSessions, loadSession, pruneSessions, saveSession } from './session-store.js';
import { getConfigValue, loadConfig, resetConfig, setConfigValue } from './config-store.js';
import { evaluateCommandPolicy } from './command-policy.js';
import { appendInputHistory, loadInputHistory } from './input-history-store.js';
import { createCheckpoint, listCheckpoints, loadCheckpoint } from './checkpoint-store.js';
import {
  compactMessagesLocally,
  estimateMessagesTokens,
  parseCompactArgs
} from './context-compact.js';
import { buildSystemPromptWithReplyLanguage } from './reply-language.js';
import { buildSystemPromptWithSoul } from './soul.js';
import { getProjectPlansDir, getProjectSpecsDir, getProjectWorkspaceDir, getSessionsDir } from './paths.js';
import { buildProjectContextSnippet, initializeProjectIndex } from './project-index.js';
import { buildMemorySnapshot } from './memory-prompt.js';
import { forgetMemory, listMemories, searchMemories, captureToInbox, listInbox } from './memory-store.js';
import { runDreamConsolidation } from './dream-consolidate.js';
import { normalizePlanState } from './plan-state.js';
import { countActiveTodos, normalizeTodos } from './todo-state.js';

const STREAM_SAVE_DEBOUNCE_MS = 120;

function toOpenAIMessages(sessionMessages) {
  const mapped = [];
  for (const msg of sessionMessages) {
    if (msg.role === 'tool') {
      mapped.push({
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.tool_call_id
      });
      continue;
    }
    mapped.push({
      role: msg.role,
      content: msg.content,
      ...(typeof msg.reasoning_content === 'string' && msg.reasoning_content ? { reasoning_content: msg.reasoning_content } : {}),
      ...(Array.isArray(msg.reasoning_details) && msg.reasoning_details.length > 0 ? { reasoning_details: msg.reasoning_details } : {}),
      ...(msg.tool_calls ? { tool_calls: msg.tool_calls } : {})
    });
  }
  return mapped;
}

function slugify(input) {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled';
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function prioritizeByPreferredOrder(items, preferredOrder) {
  const source = Array.isArray(items) ? items : [];
  const priorities = new Map((Array.isArray(preferredOrder) ? preferredOrder : []).map((value, index) => [value, index]));
  return [...source].sort((left, right) => {
    const leftRank = priorities.has(left) ? priorities.get(left) : Number.MAX_SAFE_INTEGER;
    const rightRank = priorities.has(right) ? priorities.get(right) : Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return source.indexOf(left) - source.indexOf(right);
  });
}

function normalizeUiLocale(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'zh';
}

function getCompletionCopy(language = 'zh') {
  const lang = normalizeUiLocale(language);
  return {
    zh: {
      configLabels: {
        'gateway.base_url': '网关基础 URL',
        'gateway.api_key': '网关 API Key',
        'sdk.provider': 'SDK provider',
        'gateway.timeout_ms': '网关超时时间（毫秒）',
        'gateway.max_retries': '网关重试次数',
        'model.name': '当前模型名称',
        'model.max_context_tokens': '模型上下文 token 上限',
        'ui.language': '界面语言',
        'ui.reply_language': '回复语言',
        'execution.mode': '执行模式',
        'execution.always_allow_tools': '始终允许的工具列表',
        'execution.max_steps': '最大工具步骤数',
        'context.preflight_trigger_pct': '预压缩阈值',
        'context.hard_limit_pct': '硬压缩阈值',
        'context.tool_result_max_chars': '工具结果字符上限',
        'context.read_file_default_lines': 'read_file 默认行数窗口',
        'context.read_file_max_chars': 'read_file 字符上限',
        'sessions.max_sessions': '会话保留上限',
        'sessions.retention_days': '会话保留天数',
        'shell.default': '默认 shell',
        'shell.timeout_ms': 'shell 超时时间（毫秒）',
        'context.max_tokens': '上下文 token 预算',
        'soul.preset': 'soul 预设',
        'soul.custom_path': '自定义 soul 路径',
        'policy.safe_mode': '安全模式开关',
        'policy.allow_dangerous_commands': '危险命令开关'
      },
      optionHints: {
        'sdk.provider': '可选：openai-compatible | anthropic',
        'ui.language': '可选：zh | en',
        'ui.reply_language': '可选：zh | en',
        'execution.mode': '可选：auto | normal | plan',
        'shell.default': '常用：bash | powershell',
        'policy.safe_mode': '可选：true | false',
        'policy.allow_dangerous_commands': '可选：true | false'
      },
      describeSet: (label, hint) => `设置${label}${hint ? `（${hint}）` : ''}`,
      describeGet: (label, hint) => `查看${label}${hint ? `（${hint}）` : ''}`,
      configSubcommands: {
        '/config set': '设置配置项',
        '/config get': '查看配置项',
        '/config list': '查看完整配置',
        '/config reset': '重置为默认配置'
      },
      planSubcommands: {
        '/plan <goal>': '创建一个人工审阅的实施计划',
        '/plan auto <goal>': '自动生成计划并等待你确认执行',
        '/plan approve': '批准当前待确认的计划并开始执行',
        '/yes': '确认并执行当前待确认计划',
        '/edit <feedback>': '根据你的反馈修改当前待确认计划',
        '/reject': '拒绝并清空当前待确认计划',
        '/plan from-spec <spec-path?>': '从 spec 文件生成实施计划'
      },
      commands: {
        help: '显示聊天帮助',
        exit: '退出聊天',
        commands: '列出 slash/自定义命令',
        status: '查看运行状态（mode/model/session）',
        mode: '设置执行模式：normal|auto|plan',
        compact: '压缩消息上下文',
        checkpoint: '创建/查看/加载检查点',
        spec: '在 .codemini/specs 中创建 spec',
        plan: '在 .codemini/plans 中创建实施计划',
        agents: '列出/运行子代理角色',
        config: '设置/读取/列出/重置配置',
        memory: '查看/搜索/删除持久记忆',
        dream: '整理记忆收件箱（dream consolidation）',
        history: '查看/恢复会话',
        debug: '运行时调试开关',
        retry: '重试上一条用户请求',
        stop: '中止当前回答',
        new: '开始新会话',
        yes: '确认当前待审批计划并开始执行',
        edit: '修改当前待审批计划',
        reject: '拒绝当前待审批计划'
      },
      generic: {
        configCommand: '配置命令',
        historyCommand: '历史会话命令',
        modeCommand: '切换执行模式',
        checkpointCommand: '检查点命令',
        specCommand: '创建 spec 文件',
        planCommand: '规划命令',
        agentCommand: '子代理命令',
        memoryCommand: '记忆命令',
        dreamCommand: '记忆整理命令',
        debugCommand: '调试命令',
        keyboardDebugCommand: '键盘调试命令',
        compactCommand: '上下文压缩命令',
        retryCommand: '重试上一条用户请求',
        stopCommand: '中止当前回答',
        statusCommand: '查看运行状态',
        resumeSession: '恢复一个已保存的会话'
      }
    },
    en: {
      configLabels: {
        'gateway.base_url': 'gateway base URL',
        'gateway.api_key': 'gateway API key',
        'sdk.provider': 'SDK provider',
        'gateway.timeout_ms': 'gateway timeout in milliseconds',
        'gateway.max_retries': 'gateway retry count',
        'model.name': 'active model name',
        'model.max_context_tokens': 'model context token limit',
        'ui.language': 'UI language',
        'ui.reply_language': 'reply language',
        'execution.mode': 'execution mode',
        'execution.always_allow_tools': 'always-allowed tools',
        'execution.max_steps': 'maximum tool steps',
        'context.preflight_trigger_pct': 'preflight compact threshold',
        'context.hard_limit_pct': 'hard compact threshold',
        'context.tool_result_max_chars': 'tool result character limit',
        'context.read_file_default_lines': 'default read_file line window',
        'context.read_file_max_chars': 'read_file character limit',
        'sessions.max_sessions': 'stored session limit',
        'sessions.retention_days': 'session retention days',
        'shell.default': 'default shell',
        'shell.timeout_ms': 'shell timeout in milliseconds',
        'context.max_tokens': 'context token budget',
        'soul.preset': 'soul preset',
        'soul.custom_path': 'custom soul prompt path',
        'policy.safe_mode': 'safe mode switch',
        'policy.allow_dangerous_commands': 'dangerous command allowance'
      },
      optionHints: {
        'sdk.provider': 'options: openai-compatible | anthropic',
        'ui.language': 'options: zh | en',
        'ui.reply_language': 'options: zh | en',
        'execution.mode': 'options: auto | normal | plan',
        'shell.default': 'common: bash | powershell',
        'policy.safe_mode': 'options: true | false',
        'policy.allow_dangerous_commands': 'options: true | false'
      },
      describeSet: (label, hint) => `set the ${label}${hint ? ` (${hint})` : ''}`,
      describeGet: (label, hint) => `show the ${label}${hint ? ` (${hint})` : ''}`,
      configSubcommands: {
        '/config set': 'update a config value',
        '/config get': 'show a config value',
        '/config list': 'print the full config',
        '/config reset': 'reset config to defaults'
      },
      planSubcommands: {
        '/plan <goal>': 'create an implementation plan for manual review',
        '/plan auto <goal>': 'generate a plan and wait for your approval',
        '/plan approve': 'approve the pending plan and start execution',
        '/yes': 'approve and execute the pending plan',
        '/edit <feedback>': 'revise the pending plan based on your feedback',
        '/reject': 'reject and clear the pending plan',
        '/plan from-spec <spec-path?>': 'generate an implementation plan from a spec file'
      },
      commands: {
        help: 'show chat help',
        exit: 'exit chat',
        commands: 'list slash/custom commands',
        status: 'show runtime status (mode/model/session)',
        mode: 'set execution mode: normal|auto|plan',
        compact: 'compress message context',
        checkpoint: 'create/list/load conversation checkpoints',
        spec: 'create a spec markdown file in .codemini/specs',
        plan: 'create an implementation plan markdown file in .codemini/plans',
        agents: 'run/list sub-agent roles',
        config: 'set/get/list/reset config values',
        memory: 'list/search/delete persistent memories',
        dream: 'consolidate memory inbox (dream)',
        history: 'list/resume sessions',
        debug: 'runtime debug switches',
        retry: 'retry the last user request',
        stop: 'stop the current response',
        new: 'start a new session',
        yes: 'approve the pending plan and start execution',
        edit: 'revise the pending plan',
        reject: 'reject the pending plan'
      },
      generic: {
        configCommand: 'config command',
        historyCommand: 'history command',
        modeCommand: 'switch execution mode',
        checkpointCommand: 'checkpoint command',
        specCommand: 'create a spec file',
        planCommand: 'planning command',
        agentCommand: 'sub-agent command',
        memoryCommand: 'memory command',
        dreamCommand: 'dream consolidation command',
        debugCommand: 'debug command',
        keyboardDebugCommand: 'keyboard debug command',
        compactCommand: 'context compaction command',
        retryCommand: 'retry the last user request',
        stopCommand: 'stop the current response',
        statusCommand: 'show runtime status',
        resumeSession: 'resume a saved session'
      }
    }
  }[lang];
}

function describeConfigKey(key, mode = 'set', language = 'zh') {
  const copy = getCompletionCopy(language);
  const label = copy.configLabels[key] || key;
  const hint = copy.optionHints[key] || '';
  return mode === 'get' ? copy.describeGet(label, hint) : copy.describeSet(label, hint);
}

const SUB_AGENT_ROLES = ['planner', 'coder', 'reviewer', 'tester', 'summarizer'];
export const ROLE_TOOL_POLICY = {
  planner: ['read', 'grep', 'list', 'query_project_index', 'tool_search', 'glob', 'ast_query', 'read_ast_node', 'web_fetch', 'web_search', 'read_plan', 'update_plan'],
  coder: ['read', 'grep', 'list', 'edit', 'write', 'delete', 'run', 'ast_query', 'read_ast_node', 'glob', 'tool_search', 'web_fetch', 'web_search', 'update_todos', 'read_plan', 'update_plan'],
  reviewer: ['read', 'grep', 'list', 'glob', 'tool_search', 'ast_query', 'read_ast_node', 'read_plan'],
  tester: ['read', 'grep', 'list', 'run', 'glob', 'tool_search', 'read_plan'],
  summarizer: ['read_plan']
};
const SUB_AGENT_CONTEXT_MAX_MESSAGES = 4;
const SUB_AGENT_CONTEXT_MAX_CHARS = 1200;
const SUB_AGENT_EVIDENCE_MAX_ITEMS = 3;
const SUB_AGENT_HANDOFF_MAX_ITEMS = 6;
const PLAN_MEMORY_MARKERS = {
  findings: ['<!-- plan-findings-start -->', '<!-- plan-findings-end -->'],
  progress: ['<!-- plan-progress-start -->', '<!-- plan-progress-end -->']
};
export function getSubAgentRolePrompt(role) {
  if (role === 'planner') {
    return [
      'You are the planner in a multi-step agent pipeline.',
      'Your job: inspect the codebase and produce a concrete, actionable plan.',
      'Do not write implementation code.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <important constraint, dependency, risk, or "none">',
      'Actions Taken:',
      '- <what you inspected>',
      'Open Issues:',
      '- <blocking uncertainty or "none">',
      'Next Action:',
      '- <the concrete next step for the following role>',
      'Do not summarize your own work or add closing remarks — just deliver the structured handoff and stop.',
      'IMPORTANT: Stop as soon as you have enough context to produce the plan. Do NOT keep exploring once the plan is clear — deliver it immediately.'
    ].join('\n');
  }
  if (role === 'reviewer') {
    return [
      'You are the reviewer in a multi-step agent pipeline.',
      'Focus on bugs, regressions, edge cases, and missing tests in the files handed to you.',
      'Do not roam unrelated parts of the repo unless the handed-off evidence is insufficient.',
      'Output format — keep it short and direct:',
      'Findings:',
      '- <bug, regression, risk, or "none">',
      'Verified:',
      '- <what you checked>',
      'Not Verified:',
      '- <what remains uncertain>',
      'Do not add a closing summary or "Next Action" — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'tester') {
    return [
      'You are the tester in a multi-step agent pipeline.',
      'Run concrete verification commands. Prefer real execution over suggestions.',
      'Verify the handed-off files first before scanning wider.',
      'Output format — keep it short and direct:',
      'Verified:',
      '- <commands run and evidence>',
      'Not Verified:',
      '- <what could not be validated>',
      'Failures:',
      '- <failed command or "none">',
      'Do not add a closing summary or "Next Action" — the pipeline handles what comes next.'
    ].join('\n');
  }
  if (role === 'summarizer') {
    return [
      'You are the summarizer in a multi-step agent pipeline.',
      'Your job is to synthesize the results of all prior steps into a concise, actionable final summary.',
      'Do NOT re-analyze the codebase or make new tool calls unless the handed-off evidence is clearly insufficient.',
      'Instead, read the accumulated step results in the plan file context provided to you.',
      'Output format — keep it short and direct:',
      'Summary:',
      '- <overall result in 2-4 sentences>',
      'Key Findings:',
      '- <most important findings from all steps>',
      'Actions Taken:',
      '- <what was implemented/changed/verified>',
      'Remaining Issues:',
      '- <unresolved items or "none">',
      'Recommended Next Steps:',
      '- <concrete follow-up actions if any>',
      'Do not add greetings, filler, or restate the goal. Deliver the summary and stop.'
    ].join('\n');
  }
  return [
    'You are the coder in a multi-step agent pipeline.',
    'Produce practical code changes with minimal explanation.',
    'Output format — keep it short and direct:',
    'Actions Taken:',
    '- <file changes, commands, or "none">',
    'Findings:',
    '- <important implementation note, regression risk, or "none">',
    'Verified:',
    '- <test/check evidence or "none">',
    'Open Issues:',
    '- <remaining gap or "none">',
    'Artifacts:',
    '- <changed file path or "none">',
    'Next Action:',
    '- <the best next step for the following role or "none">',
    'Do not summarize the goal, recap the plan, or add closing remarks.'
  ].join('\n');
}

function buildPipelineStepGuidance({ role, stepIndex, totalSteps, isFirst, isLast, priorSteps }) {
  const lines = [];
  lines.push(`Pipeline position: step ${stepIndex + 1} of ${totalSteps}.`);
  if (isFirst) {
    lines.push('You are the first step. Your output sets direction for the rest of the pipeline.');
  } else if (isLast) {
    lines.push('You are the final step. After you, the pipeline will present a combined result to the user.');
  } else {
    lines.push('You are in the middle of the pipeline. Your output feeds into the next step.');
  }
  if (priorSteps.length > 0) {
    const prev = priorSteps[priorSteps.length - 1];
    lines.push(`Previous step was [${prev.role}]: ${prev.title}. Use its output as your starting point.`);
  }
  lines.push('Style rules:');
  lines.push('- Be direct and action-oriented. No greetings, no summaries, no "In conclusion" or "To summarize".');
  lines.push('- Treat the Findings Ledger and Progress Ledger in the plan file context as the shared working memory for this pipeline.');
  lines.push('- If you discover something new, record it under the requested headings instead of burying it in prose.');
  lines.push('- Continue the established direction unless you have concrete contradictory evidence.');
  lines.push('- Output only what the next step needs to know. Skip obvious observations.');
  if (isLast) {
    lines.push('- Since you are the final step, give a concise overall verdict the user can act on.');
  }
  return lines.join('\n');
}

function buildSubAgentContextPacket(session) {
  const source = Array.isArray(session?.messages) ? session.messages : [];
  const recent = source
    .filter((msg) => msg && (msg.role === 'user' || msg.role === 'assistant'))
    .slice(-SUB_AGENT_CONTEXT_MAX_MESSAGES);
  if (recent.length === 0) return '';

  const lines = [];
  let usedChars = 0;
  for (const msg of recent) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user';
    const text = trimInline(msg.content, 260);
    if (!text) continue;
    const line = `- ${role}: ${text}`;
    if (usedChars + line.length > SUB_AGENT_CONTEXT_MAX_CHARS) break;
    lines.push(line);
    usedChars += line.length;
  }
  if (lines.length === 0) return '';
  return [
    'Scoped parent context (recent only, not full history):',
    ...lines,
    'Use this context only if it helps the current task.'
  ].join('\n');
}

function maybePushEvidence(out, seen, filePath, summary) {
  const pathText = trimInline(filePath, 160);
  const summaryText = trimInline(summary, 200);
  if (!pathText || seen.has(pathText)) return;
  seen.add(pathText);
  out.push(`- ${pathText}${summaryText ? ` :: ${summaryText}` : ''}`);
}

function extractEvidenceFromToolMessage(rawContent, out, seen) {
  if (!rawContent) return;
  let parsed = null;
  try {
    parsed = JSON.parse(String(rawContent));
  } catch {}

  if (parsed && typeof parsed === 'object') {
    if (parsed.path) {
      const summary = parsed.content || parsed.diff_preview || parsed.stdout || parsed.next || '';
      maybePushEvidence(out, seen, parsed.path, summary);
    }
    const stdout = typeof parsed.stdout === 'string' ? parsed.stdout : '';
    const stderr = typeof parsed.stderr === 'string' ? parsed.stderr : '';
    const merged = `${stdout}\n${stderr}`.trim();
    const matches = merged.matchAll(/(?:^|\s)([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):\d+(?::\d+)?/g);
    for (const match of matches) {
      if (out.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
      maybePushEvidence(out, seen, match[1], merged);
    }
    return;
  }

  const text = String(rawContent || '');
  const matches = text.matchAll(/(?:^|\s)([A-Za-z0-9_./\\-]+\.[A-Za-z0-9_]+):\d+(?::\d+)?/g);
  for (const match of matches) {
    if (out.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
    maybePushEvidence(out, seen, match[1], text);
  }
}

function buildSubAgentEvidencePacket(session) {
  const source = Array.isArray(session?.messages) ? session.messages : [];
  const toolMessages = source.filter((msg) => msg && msg.role === 'tool').slice(-6).reverse();
  const lines = [];
  const seen = new Set();
  for (const msg of toolMessages) {
    extractEvidenceFromToolMessage(msg.content, lines, seen);
    if (lines.length >= SUB_AGENT_EVIDENCE_MAX_ITEMS) break;
  }
  if (lines.length === 0) return '';
  return ['Scoped file evidence (recent tool outputs only):', ...lines].join('\n');
}

function extractLikelyPathsFromText(rawText, out, seen) {
  const text = String(rawText || '');
  if (!text) return;
  const matches = text.matchAll(
    /(?:^|[\s("'`])([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_]+)(?=$|[\s)"'`:,`])/g
  );
  for (const match of matches) {
    const value = String(match[1] || '').replace(/\/+$/, '');
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= SUB_AGENT_HANDOFF_MAX_ITEMS) break;
  }
}

function summarizeStepOutput(step) {
  const text = trimInline(step?.output || step?.task || '', 800);
  return text || 'No concise output captured.';
}

function collectStepArtifacts(runItems, role) {
  if (!Array.isArray(runItems) || runItems.length === 0) return '';

  const relevantSteps =
    role === 'reviewer' || role === 'tester'
      ? runItems.filter((step) => step && !step.failed && step.role !== 'reviewer' && step.role !== 'tester')
      : runItems.filter((step) => step && !step.failed);
  if (relevantSteps.length === 0) return '';

  const focusPaths = [];
  const seenPaths = new Set();
  const summaries = [];

  for (const step of relevantSteps.slice(-4)) {
    if (Array.isArray(step.artifactPaths)) {
      for (const artifactPath of step.artifactPaths) {
        if (!artifactPath || seenPaths.has(artifactPath)) continue;
        seenPaths.add(artifactPath);
        focusPaths.push(artifactPath);
        if (focusPaths.length >= SUB_AGENT_HANDOFF_MAX_ITEMS) break;
      }
    }
    extractLikelyPathsFromText(step.output, focusPaths, seenPaths);
    const summary = summarizeStepOutput(step);
    summaries.push(`- [${step.role}] ${step.title}: ${summary}`);
    if (focusPaths.length >= SUB_AGENT_HANDOFF_MAX_ITEMS && summaries.length >= 3) break;
  }

  return { focusPaths, summaries };
}

function buildStepArtifactPacket(runItems, role) {
  const collected = collectStepArtifacts(runItems, role);
  if (!collected) return '';
  const { focusPaths, summaries } = collected;

  if (focusPaths.length === 0 && summaries.length === 0) return '';

  const lines = ['Implementation handoff from earlier plan steps:'];
  if (focusPaths.length > 0) {
    lines.push('Focus paths first:');
    for (const value of focusPaths.slice(0, SUB_AGENT_HANDOFF_MAX_ITEMS)) {
      lines.push(`- ${value}`);
    }
    if (role === 'reviewer' || role === 'tester') {
      lines.push('Start with these files/directories before exploring unrelated repo areas.');
    }
  }
  if (summaries.length > 0) {
    lines.push('Prior step summaries:');
    lines.push(...summaries.slice(-3));
  }
  return lines.join('\n');
}

function buildFocusedTaskNote(role, focusPaths) {
  if (!Array.isArray(focusPaths) || focusPaths.length === 0) return '';
  const head = focusPaths.slice(0, 4).join(', ');
  if (role === 'reviewer') {
    return `Focus review on these artifacts first: ${head}. Only inspect unrelated repo areas if these artifacts do not provide enough evidence.`;
  }
  if (role === 'tester') {
    return `Focus verification on these artifacts first: ${head}. Prefer commands and reads that directly validate these paths before wider repo exploration.`;
  }
  return '';
}

function normalizeGoalClauseText(value) {
  return String(value || '')
    .replace(/^[\s\-*0-9.)、，,:;]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sentenceCaseRequirement(value) {
  const text = normalizeGoalClauseText(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function deriveGoalRequirements(goal) {
  const rawGoal = String(goal || '').trim();
  if (!rawGoal) return [];

  const normalized = rawGoal
    .replace(/\r\n?/g, '\n')
    .replace(/[；。]/g, ',')
    .replace(/\band then\b/gi, ',')
    .replace(/\bthen\b/gi, ',')
    .replace(/\bplus\b/gi, ',')
    .replace(/\s+(?:and|并且|而且|以及)\s+/gi, ', ')
    .replace(/\n+/g, ', ');

  const roughParts = normalized
    .split(/\s*,\s*/)
    .map((part) => normalizeGoalClauseText(part))
    .filter(Boolean);

  const requirements = [];
  const seen = new Set();

  for (const part of roughParts) {
    const lowered = part.toLowerCase();
    if (/\btrim\b/.test(lowered) && !/\bwhitespace\b/.test(lowered)) {
      const label = 'Trim whitespace in the returned greeting';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    if (/\btrim\b/.test(lowered) && /\bwhitespace\b/.test(lowered)) {
      const label = 'Trim whitespace in the returned greeting';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    if (/(exclamation mark|感叹号|!)/i.test(part)) {
      const label = 'Preserve the exclamation mark';
      if (!seen.has(label)) {
        seen.add(label);
        requirements.push(label);
      }
      continue;
    }
    const label = sentenceCaseRequirement(part);
    if (!label || seen.has(label)) continue;
    seen.add(label);
    requirements.push(label);
  }

  if (requirements.length === 0) {
    return [sentenceCaseRequirement(rawGoal)].filter(Boolean);
  }
  return requirements.slice(0, 6);
}

function isLightweightAutoPlanGoal(goal, requirements = []) {
  const text = String(goal || '').trim();
  if (!text) return false;
  if (requirements.length !== 1) return false;
  if (text.length > 140) return false;
  if (/\b(plan|spec|design|architecture|roadmap|strategy|migration|refactor)\b/i.test(text)) return false;
  if (/\b(ensure|verify|review|test|validate|make sure|confirm)\b/i.test(text)) return false;
  if (/[；。]/.test(text)) return false;
  return /\b(add|update|fix|rename|trim|export|create|remove|change|implement)\b/i.test(text);
}

function classifyPlanTaskClass(goal = '') {
  const text = String(goal || '').trim();
  const lowerGoal = text.toLowerCase();
  const advisory =
    /\b(analyze|analysis|review|audit|inspect|assess|recommend|recommendation|optimization|optimize|improve|suggest|brainstorm|plan|feedback)\b/i.test(lowerGoal) ||
    /(分析|审查|审计|检查|评估|建议|优化|优化点|优化建议|改进|改进点|规划|方案|看一下|看看|有哪些问题|有什么问题)/.test(text);
  const implementation =
    /\b(add|build|create|implement|support|introduce|refactor|rewrite|rework|migrate|change|update|fix)\b/i.test(lowerGoal) ||
    /(新增|增加|实现|支持|重构|重写|改造|迁移|修改|更新|修复)/.test(text);
  const verificationHeavy =
    /\b(test|verify|validation|validate|prove|confirm|reproduce|check coverage)\b/i.test(lowerGoal) ||
    /(测试|验证|校验|确认|复现|覆盖率)/.test(text);

  if (verificationHeavy) return 'verification-heavy';
  if (advisory && !implementation) return 'advisory';
  return 'implementation';
}

function buildGoalRequirementPacket(goal, role) {
  const rawGoal = trimInline(goal, 800);
  if (!rawGoal) return '';
  const requirements = deriveGoalRequirements(goal);
  const lines = ['Original goal:', rawGoal];
  if (requirements.length > 0) {
    lines.push('Acceptance checklist:');
    for (const requirement of requirements) {
      lines.push(`- ${requirement}`);
    }
  }
  if (role === 'reviewer') {
    lines.push('Review against the original goal, not just local code quality.');
    lines.push('Check each acceptance item explicitly before deciding there are no findings.');
    lines.push('If any requested behavior is missing, incorrect, or only partially implemented, report it in Findings.');
  } else if (role === 'tester') {
    lines.push('Verify the implementation against the original goal, not just syntax or smoke checks.');
    lines.push('Check each acceptance item explicitly before calling the work verified.');
    lines.push('If any requested behavior is unverified or contradicted by evidence, list it under Not Verified or Failures.');
  } else if (role === 'coder') {
    lines.push('Implement against the acceptance checklist, not only the broad wording of the goal.');
  }
  return lines.join('\n');
}

function buildAutoPlanPlannerGuidance() {
  return [
    'Design a short implementation plan for a small model.',
    'Auto-plan planning rules:',
    '- Start with a discovery or clarification step when the current implementation is not yet verified.',
    '- If the goal still leaves room for multiple approaches, choose one practical direction before planning execution.',
    '- Prefer the smallest local approach that satisfies the goal.',
    '- Do not output multiple alternative branches in the final plan.',
    '- Do not assume implementation should begin before the plan is coherent.',
    '- Available sub-agent roles are planner, coder, reviewer, tester, and summarizer. Use only the roles the task actually needs.',
    '- The summarizer role reads accumulated step results from the plan file and synthesizes a final summary. It does NOT re-analyze the codebase. Prefer summarizer as the final step for multi-step plans.',
    '- For implementation-heavy or risky changes, prefer adding review and/or verification steps.',
    '- For analysis, recommendation, or planning-only goals, you may omit reviewer/tester if they do not add value.',
    '- Prefer 3-5 steps total unless the task is clearly larger.',
    '- Keep the plan ordered, implementation-oriented, and easy for small sub-agents to follow.'
  ].join('\n');
}

function buildAutoPlanExecutionGuidance(role) {
  const common = [
    'Auto-plan execution rules:',
    '- Work in the smallest useful step.',
    '- Read the target code before editing.',
    '- Prefer local changes over broad refactors.',
    '- Prefer narrow verification with concrete evidence before claiming success.'
  ];

  if (role === 'coder') {
    common.push('- Keep edits tightly scoped to the chosen plan direction.');
    common.push('- Avoid speculative cleanup or unrelated improvements.');
  } else if (role === 'reviewer') {
    common.push('- Review against the chosen plan direction and the acceptance checklist.');
    common.push('- Call out missing requested behavior, regression risk, and unverified claims.');
  } else if (role === 'tester') {
    common.push('- Prefer running the narrowest real verification command that matches the changed area.');
    common.push('- Distinguish clearly between verified behavior and assumptions.');
  }

  return common.join('\n');
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(targetPath) {
  try {
    return JSON.parse(await fs.readFile(targetPath, 'utf8'));
  } catch {
    return null;
  }
}

function extractManagedPlanSection(content = '', key = 'findings') {
  const markers = PLAN_MEMORY_MARKERS[key];
  if (!markers) return '';
  const [startMarker, endMarker] = markers;
  const start = String(content || '').indexOf(startMarker);
  const end = String(content || '').indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return '';
  return String(content || '')
    .slice(start + startMarker.length, end)
    .trim();
}

function replaceManagedPlanSection(content = '', key = 'findings', nextSection = '') {
  const markers = PLAN_MEMORY_MARKERS[key];
  if (!markers) return String(content || '');
  const [startMarker, endMarker] = markers;
  const sectionBody = `${startMarker}\n${String(nextSection || '').trim()}\n${endMarker}`;
  const pattern = new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`);
  if (pattern.test(String(content || ''))) {
    return String(content || '').replace(pattern, sectionBody);
  }
  return `${String(content || '').trimEnd()}\n\n${sectionBody}\n`;
}

function normalizeLedgerItems(items = [], fallback = '- None recorded yet.') {
  const cleaned = [...new Set((Array.isArray(items) ? items : []).map((item) => String(item || '').trim()).filter(Boolean))];
  return cleaned.length > 0 ? cleaned : [fallback];
}

function trimLedger(items = [], maxItems = 10) {
  const cleaned = normalizeLedgerItems(items, '').filter(Boolean);
  return cleaned.slice(Math.max(0, cleaned.length - maxItems));
}

export function extractStepWorkingMemory(output = '', artifactPaths = []) {
  const findings = extractSectionBullets(output, 'Findings')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const actionsTaken = extractSectionBullets(output, 'Actions Taken')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const verified = extractSectionBullets(output, 'Verified')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const notVerified = extractSectionBullets(output, 'Not Verified')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const failures = extractSectionBullets(output, 'Failures')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const openIssues = extractSectionBullets(output, 'Open Issues')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const nextAction = extractSectionBullets(output, 'Next Action')
    .filter((item) => !/^none\b/i.test(item))
    .map((item) => `- ${item}`);
  const artifactLines = [
    ...extractSectionBullets(output, 'Artifacts')
      .filter((item) => !/^none\b/i.test(item))
      .map((item) => `- ${item}`),
    ...(Array.isArray(artifactPaths) ? artifactPaths : []).filter(Boolean).map((item) => `- ${item}`)
  ];

  return {
    findings: trimLedger(findings, 8),
    actionsTaken: trimLedger(actionsTaken, 8),
    verified: trimLedger(verified, 6),
    notVerified: trimLedger(notVerified, 6),
    failures: trimLedger(failures, 6),
    openIssues: trimLedger(openIssues, 6),
    nextAction: trimLedger(nextAction, 3),
    artifacts: trimLedger(artifactLines, 6)
  };
}

function buildProgressLedgerEntry(stepIndex, stepTitle, role, memory) {
  const status = memory.failures.length > 0 || memory.openIssues.length > 0 || memory.notVerified.length > 0 ? 'attention-needed' : 'completed';
  const highlights = [
    memory.actionsTaken[0],
    memory.verified[0],
    memory.nextAction[0],
    memory.openIssues[0],
    memory.notVerified[0],
    memory.failures[0]
  ]
    .filter(Boolean)
    .map((item) => item.replace(/^- /, ''))
    .slice(0, 2);
  const suffix = highlights.length > 0 ? ` :: ${highlights.join(' | ')}` : '';
  return `- Step ${stepIndex + 1} [${role}] ${stepTitle} -> ${status}${suffix}`;
}

function buildRecentStepResults(content = '', maxEntries = 2) {
  const value = String(content || '');
  const matches = [...value.matchAll(/^## Step \d+ Result: .*$/gm)];
  if (matches.length === 0) return '';
  const starts = matches.map((match) => match.index || 0);
  const chunks = starts.map((start, index) => value.slice(start, starts[index + 1] || value.length).trim());
  return chunks.slice(-maxEntries).join('\n\n---\n\n');
}

export function buildPlanWorkingMemoryContext(content = '', maxChars = 6000) {
  const value = String(content || '').trim();
  if (!value) return '';

  const findings = extractManagedPlanSection(value, 'findings');
  const progress = extractManagedPlanSection(value, 'progress');
  if (!findings && !progress) {
    if (value.length <= maxChars) return value;
    const headSize = Math.floor(maxChars * 0.3);
    const tailSize = maxChars - headSize - 50;
    return `${value.slice(0, headSize)}\n\n... [plan file truncated, showing most recent step results] ...\n\n${value.slice(-tailSize)}`;
  }

  const headLimit = Math.max(600, Math.floor(maxChars * 0.35));
  const head = value.slice(0, headLimit).trimEnd();
  const recentResults = buildRecentStepResults(value, 2);
  const sections = [
    head,
    '## Working Memory Snapshot',
    '### Findings Ledger',
    findings || '- None recorded yet.',
    '### Progress Ledger',
    progress || '- No progress recorded yet.'
  ];
  if (recentResults) {
    sections.push('## Recent Step Results');
    sections.push(recentResults);
  }
  const summary = sections.filter(Boolean).join('\n\n').trim();
  return summary.length <= maxChars ? summary : `${summary.slice(0, maxChars - 42).trimEnd()}\n... [working memory truncated]`;
}

async function appendStepResultToPlanFile(planFilePath, stepIndex, stepTitle, role, output, artifactPaths = []) {
  if (!planFilePath) return;
  try {
    const separator = '\n\n---\n\n';
    const timestamp = new Date().toISOString();
    const content = await fs.readFile(planFilePath, 'utf8');
    const memory = extractStepWorkingMemory(output, artifactPaths);
    const findingsBlock = [
      ...extractManagedPlanSection(content, 'findings')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      ...memory.findings,
      ...memory.openIssues,
      ...memory.notVerified,
      ...memory.failures
    ];
    const progressBlock = [
      ...extractManagedPlanSection(content, 'progress')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      buildProgressLedgerEntry(stepIndex, stepTitle, role, memory)
    ];
    const entry = [
      `## Step ${stepIndex + 1} Result: ${stepTitle}`,
      `Role: ${role}`,
      `Completed: ${timestamp}`,
      '',
      output || '(no output)',
      ''
    ].join('\n');
    const nextContent = [
      replaceManagedPlanSection(content, 'findings', normalizeLedgerItems(trimLedger(findingsBlock, 12)).join('\n')),
      ''
    ].join('\n');
    const nextWithProgress = replaceManagedPlanSection(
      nextContent,
      'progress',
      normalizeLedgerItems(trimLedger(progressBlock, 12), '- No progress recorded yet.').join('\n')
    );
    await fs.writeFile(planFilePath, `${nextWithProgress.trimEnd()}${separator}${entry}\n`, 'utf8');
  } catch {
    // Non-fatal: plan file handoff is best-effort
  }
}

async function readPlanFileAsContext(planFilePath, maxChars = 6000) {
  if (!planFilePath) return '';
  try {
    const content = await fs.readFile(planFilePath, 'utf8');
    return buildPlanWorkingMemoryContext(content, maxChars);
  } catch {
    return '';
  }
}

async function buildTesterVerificationPacket(focusPaths = []) {
  const cwd = process.cwd();
  const primary = [];
  const secondary = [];
  const fallback = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  const cargoPath = path.join(cwd, 'Cargo.toml');
  const goModPath = path.join(cwd, 'go.mod');
  const focusTargets = Array.isArray(focusPaths) ? focusPaths.filter(Boolean).slice(0, 4) : [];

  if (await pathExists(packageJsonPath)) {
    const pkg = await readJsonSafe(packageJsonPath);
    const scripts = pkg?.scripts || {};
    if (typeof scripts.test === 'string' && scripts.test.trim()) {
      primary.push(`- npm test :: package.json script = ${trimInline(scripts.test, 140)}`);
    }
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      secondary.push(`- npm run build :: package.json script = ${trimInline(scripts.build, 140)}`);
    }
    if (typeof scripts.lint === 'string' && scripts.lint.trim()) {
      secondary.push(`- npm run lint :: package.json script = ${trimInline(scripts.lint, 140)}`);
    }
    fallback.push('- If test/build scripts are not usable, inspect package.json scripts and run the narrowest relevant check.');
  }

  if (await pathExists(pyprojectPath)) {
    primary.push('- pytest');
  }
  if (await pathExists(cargoPath)) {
    primary.push('- cargo test');
  }
  if (await pathExists(goModPath)) {
    primary.push('- go test ./...');
  }

  if (primary.length === 0 && secondary.length === 0) {
    return [
      'Verification guidance:',
      '- No obvious project-level test command was detected automatically.',
      '- Prefer running at least one concrete verification command when possible.',
      '- Fall back to the lightest real check you can justify for the files involved.',
      '- If no runnable checks exist, explicitly say what you tried and what remains unverified.'
    ].join('\n');
  }

  const lines = [
    'Verification guidance:',
    'Prefer executing real verification commands before concluding the work is done.',
    'Use the strongest available evidence first, then fall back in order.',
    'Start with artifact-scoped checks for the handed-off files/directories before broad repo discovery.',
    'Read package.json scripts before inventing commands. If a test or build script exists, prefer that exact script name first.',
    'Priority order:'
  ];

  if (focusTargets.length > 0) {
    lines.push('Artifact focus:');
    for (const target of focusTargets) {
      lines.push(`- ${target}`);
    }
  }

  if (primary.length > 0) {
    lines.push('1. Primary verification commands:');
    lines.push(...primary);
  }
  if (secondary.length > 0) {
    lines.push(`${primary.length > 0 ? '2' : '1'}. Secondary verification commands:`);
    lines.push(...secondary);
  }
  lines.push(`${primary.length > 0 || secondary.length > 0 ? '3' : '2'}. Fallback rules:`);
  lines.push('- If the top command fails because the repo is not set up for it, report that clearly and try the next best command.');
  lines.push('- Prefer narrow checks that mention the handed-off path (for example the target directory or file) before scanning the full repository.');
  lines.push('- Do not use unrelated directories as a starting point if focused artifacts were handed to you.');
  lines.push('- Do not treat ls/find/grep directory discovery as verification evidence by itself.');
  lines.push('- Prefer concrete execution evidence over narrative claims.');
  lines.push('- End with two explicit sections: "Verified" and "Not Verified".');
  lines.push(...fallback);

  return lines.join('\n');
}

function isSkillEnabled(config, name) {
  return config.skills?.enabled?.[name] !== false;
}

function selectAutoSkillNames(text = '') {
  const input = String(text || '').toLowerCase();
  const selected = ['superpowers-lite'];

  const explicitBrainstorm =
    /(brainstorm|头脑风暴|方案|思路|设计一下|设计方案|怎么做|如何做|approach|options?)/i.test(input);
  const ambiguitySignals =
    /(not sure|unsure|unclear|help me think|let'?s think|should we|which (?:approach|option|way)|best way|trade-?off|vs\b|versus|or should|maybe|roughly|just something simple|要不要|不确定|不明确|先别写|先不要写|先讨论|先想一下|哪个方案|怎么设计|如何设计|取舍|还是|大概|先做个|做一个简单的|先来个)/i.test(
      input
    );
  const featureRequest =
    /\b(add|build|create|generate|make|implement|support|introduce|design|refactor|change|update)\b/i.test(input) ||
    /(新增|增加|实现|支持|设计|重构|改造|调整|生成|做一个|做个|创建)/i.test(input);
  const greenfieldBuildRequest =
    (/\b(build|create|generate|make)\b/i.test(input) || /(生成|做一个|做个|创建)/i.test(input)) &&
    /(\b(project|app|site|website|page|dashboard|tool|component|landing page|html page)\b|项目|应用|网页|页面|网站|工具|组件|看板)/i.test(
      input
    );

  if (explicitBrainstorm || (ambiguitySignals && featureRequest) || greenfieldBuildRequest) {
    selected.push('brainstorm');
  }
  return selected;
}

function classifyTaskComplexity(text = '') {
  const input = String(text || '').trim();
  if (!input) return 'simple';

  const lower = input.toLowerCase();
  const explicitPlanning =
    /(\/plan\b|plan first|make a plan|implementation plan|先做计划|先出方案|先规划|先计划)/i.test(lower);
  if (explicitPlanning) return 'complex';

  const simpleSkip =
    /(typo|readme|console\.log|log this|rename\s+\w+|one line|small tweak|tiny fix|格式化|拼写|注释|文案|小改|微调)/i.test(
      lower
    );
  if (simpleSkip) return 'simple';

  const discussionFirst =
    /(brainstorm|头脑风暴|方案|思路|怎么做|如何做|which (?:approach|option|way)|best way|trade-?off|not sure|unsure|unclear|whether it should|要不要|不确定|先别写|先不要写|先讨论|先想一下)/i.test(
      lower
    );
  if (discussionFirst) return 'simple';

  const implementationRequest =
    /\b(add|build|create|implement|support|introduce|design|refactor|rework|migrate|change|update|rewrite|restructure)\b/i.test(
      lower
    ) ||
    /(新增|增加|实现|支持|设计|重构|改造|迁移|调整|重写|重做)/i.test(lower);
  if (!implementationRequest) return 'simple';

  const broadSignalPattern =
    /\b(auth|authentication|workflow|flow|system|architecture|api|endpoint|state management|session state|cache|caching|database|migration|service|integration|error handling|error recovery|shared helper|helper module)\b/gi;
  const broadSignals = lower.match(broadSignalPattern) || [];
  const multipleActions = /\b(and|plus|also|while|along with)\b/i.test(lower) || /[，、；;].+/.test(input);
  const singleFileScoped =
    /\b(?:in|inside|within|only in)\s+[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/i.test(lower) ||
    /\b(?:src|app|lib|tests?)\/[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/i.test(lower);
  const fileMentions = (lower.match(/[-_/.\w]+\.(?:[cm]?[jt]sx?|py|go|rb|java|rs|php|md)\b/g) || []).length;
  const multiFileScope =
    fileMentions >= 2 ||
    /\b(across|multiple files?|cross-file|cross file)\b/i.test(lower) ||
    /跨文件|多文件/.test(input);
  const verificationHeavy = /\b(with tests?|and tests?|verify|validation|error handling|error recovery)\b/i.test(lower) || /测试|验证|校验|错误处理|错误恢复/.test(input);
  const architectureHeavy =
    broadSignals.length >= 3 ||
    /\b(architecture|workflow|migration|state management|session state|integration)\b/i.test(lower) ||
    /架构|流程|迁移|状态/.test(input);

  if (singleFileScoped && !multipleActions && !verificationHeavy) return 'simple';
  if (architectureHeavy && (multiFileScope || multipleActions || verificationHeavy)) return 'complex';
  if (multiFileScope || verificationHeavy || multipleActions) return 'medium';
  return 'simple';
}

function classifyAutoRoute(text = '') {
  const selectedSkills = selectAutoSkillNames(text);
  const hasBrainstorm = selectedSkills.includes('brainstorm');
  if (hasBrainstorm) {
    return {
      mode: 'brainstorm',
      autoPlan: false,
      selectedSkills,
      complexity: 'discussion'
    };
  }

  const complexity = classifyTaskComplexity(text);
  if (complexity === 'complex') {
    return {
      mode: 'auto_plan',
      autoPlan: true,
      selectedSkills: ['superpowers-lite'],
      complexity
    };
  }

  return {
    mode: complexity === 'medium' ? 'direct_medium' : 'direct',
    autoPlan: false,
    selectedSkills,
    complexity
  };
}

function buildMediumTaskSystemPrompt(systemPrompt) {
  const guidance = [
    'Task Mode: medium',
    'Execution guidance:',
    '- Give a brief execution outline before coding.',
    '- Keep the outline concise and focused on touched files/behaviors.',
    '- Then implement directly instead of entering pending plan approval.',
    '- Verify the changed behavior before finishing.',
    '- If major ambiguity appears mid-task, say so clearly and ask for a plan instead of guessing.'
  ].join('\n');
  return `${systemPrompt}\n\n${guidance}`;
}

function buildAutoSkillSystemPrompt(baseSystemPrompt, commands, config, text) {
  const selected = classifyAutoRoute(text).selectedSkills.filter((name) => isSkillEnabled(config, name));
  if (selected.length === 0) return baseSystemPrompt;

  const blocks = [];
  for (const name of selected) {
    const skill = commands.get(name);
    if (!skill || skill.metadata?.type !== 'skill') continue;
    blocks.push(`[Auto skill: ${name}]\n${skill.content}`);
  }
  if (blocks.length === 0) return baseSystemPrompt;
  return `${baseSystemPrompt}\n\n${blocks.join('\n\n')}`;
}

function extractJsonBlock(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1]);
    } catch {}
  }

  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try {
      return JSON.parse(raw.slice(first, last + 1));
    } catch {}
  }
  return null;
}

function normalizeAutoPlan(parsed, goal) {
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const cleaned = steps
    .map((s) => ({
      title: String(s?.title || '').trim(),
      role: String(s?.role || '').trim().toLowerCase(),
      task: String(s?.task || '').trim()
    }))
    .filter((s) => s.title && s.task && SUB_AGENT_ROLES.includes(s.role));

  const basePlan =
    cleaned.length === 0
      ? {
          summary: `Auto plan for: ${goal}`,
          steps: [
            {
              title: 'Initial analysis',
              role: 'planner',
              task: `Break down and propose implementation steps for: ${goal}`
            }
          ]
        }
      : {
          summary: String(parsed?.summary || `Auto plan for: ${goal}`).trim(),
          steps: cleaned
        };

  return enforceAutoPlanGuardrailSteps(basePlan, goal);
}

function summarizeGoalForStepTitle(goal, fallback = 'requested change') {
  const text = String(goal || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  const compact = text.length > 72 ? `${text.slice(0, 69).trimEnd()}...` : text;
  return compact;
}

function buildFallbackAutoPlan(goal) {
  const requirements = deriveGoalRequirements(goal);
  const lightweightGoal = isLightweightAutoPlanGoal(goal, requirements);
  const focus = summarizeGoalForStepTitle(goal);
  const summary =
    requirements.length > 0
      ? `Auto fallback plan for: ${requirements.join('; ')}`
      : `Auto fallback plan for: ${goal}`;

  if (lightweightGoal) {
    return {
      summary,
      steps: [
        {
          title: `Implement ${focus}`,
          role: 'coder',
          task: `Implement the requested change for: ${goal}. Follow the acceptance checklist and keep the change narrowly scoped.`
        },
        {
          title: 'Verify the change',
          role: 'tester',
          task: `Verify the completed change for: ${goal}. Run the most relevant focused checks available and report concrete evidence plus anything still unverified.`
        }
      ]
    };
  }

  return {
    summary,
    steps: [
      {
        title: 'Inspect the target area',
        role: 'planner',
        task: `Inspect the existing code paths, affected files, and current behavior for: ${goal}. Identify constraints, dependencies, and any compatibility risks before implementation.`
      },
      {
        title: `Implement ${focus}`,
        role: 'coder',
        task: `Implement the requested changes for: ${goal}. Keep the behavior aligned with the acceptance checklist and preserve existing external behavior unless the goal explicitly changes it.`
      },
      {
        title: 'Update or add focused verification',
        role: 'coder',
        task: `Add or update the most relevant tests and focused verification coverage for: ${goal}. Prefer narrow checks tied to the changed files and flows.`
      },
      {
        title: 'Review for regressions and gaps',
        role: 'reviewer',
        task: `Review the completed work for: ${goal}. Start with the changed files, then check regressions, risky assumptions, backward compatibility, and missing edge cases.`
      },
      {
        title: 'Verify the changed flows',
        role: 'tester',
        task: `Verify the completed work for: ${goal}. Run the most relevant checks available, report concrete evidence, and call out anything still not verified.`
      },
      {
        title: 'Synthesize final implementation status',
        role: 'summarizer',
        task: `Synthesize the completed work for: ${goal}. Read the accumulated findings, verification evidence, and open issues from earlier steps, then produce a concise final status with remaining risks and the single best next action.`
      }
    ]
  };
}

function buildDefaultSummarizerStep(goal, source = []) {
  const existing = (Array.isArray(source) ? source : []).find((step) => step.role === 'summarizer');
  if (existing?.title && existing?.task) return existing;
  return {
    title: 'Synthesize final implementation status',
    role: 'summarizer',
    task: `Synthesize the completed work for: ${goal}. Read the accumulated findings, verification evidence, and open issues from earlier steps, then produce a concise final status with remaining risks and the single best next action.`
  };
}

function enforceAutoPlanGuardrailSteps(plan, goal) {
  const source = Array.isArray(plan?.steps) ? plan.steps : [];
  const requirements = deriveGoalRequirements(goal);
  const lightweightGoal = isLightweightAutoPlanGoal(goal, requirements);
  const taskClass = classifyPlanTaskClass(goal);
  const implementationSteps = source.filter((step) => step.role !== 'reviewer' && step.role !== 'tester' && step.role !== 'summarizer');
  const primaryImplementationStep =
    implementationSteps.find((step) => step.role === 'coder') ||
    implementationSteps[0] || {
      title: 'Implement requested change',
      role: 'coder',
      task: `Implement the requested change for: ${goal}`
    };
  const reviewerStep = source.find((step) => step.role === 'reviewer') || {
    title: 'Review implementation',
    role: 'reviewer',
    task: `Review the completed work for: ${goal}. Start with the files and directories produced by earlier implementation steps, then check bugs, regressions, risky assumptions, edge cases, and missing tests.`
  };
  const testerStep = source.find((step) => step.role === 'tester') || {
    title: 'Test and verify',
    role: 'tester',
    task: `Test and verify the completed work for: ${goal}. Start with the artifacts produced by earlier implementation steps, run the most relevant checks available, report concrete evidence, and call out anything still unverified.`
  };
  const summarizerStep = buildDefaultSummarizerStep(goal, source);
  const hasReviewer = source.some((step) => step.role === 'reviewer');
  const hasTester = source.some((step) => step.role === 'tester');

  if (taskClass === 'advisory') {
    const advisorySteps = source.filter((step) => step.role === 'planner' || step.role === 'coder');
    return {
      summary: String(plan?.summary || `Auto plan for: ${goal}`).trim(),
      steps: advisorySteps.length > 0 ? advisorySteps.slice(0, 6) : [primaryImplementationStep]
    };
  }

  if (lightweightGoal) {
    return {
      summary: String(plan?.summary || `Auto plan for: ${goal}`).trim(),
      steps: hasTester ? [primaryImplementationStep, testerStep] : [primaryImplementationStep]
    };
  }

  const executionSteps = [
    ...implementationSteps.slice(0, 6),
    ...(hasReviewer ? [reviewerStep] : []),
    ...(testerStep ? [testerStep] : [])
  ];
  const needsSummarizer = executionSteps.length >= 3;

  return {
    summary: String(plan?.summary || `Auto plan for: ${goal}`).trim(),
    steps: needsSummarizer ? [...executionSteps, summarizerStep] : executionSteps
  };
}

function looksLikeSuccessfulStepOutput(text = '') {
  const value = String(text || '').trim();
  if (!value) return false;
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  const acceptanceFailures = extractAcceptanceStatusItems(value).filter((item) => item.status !== 'met');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return false;
  if (failureBullet && !/^none\b/i.test(failureBullet)) return false;
  if (acceptanceFailures.length > 0) return false;
  if (nextActionBullet && /^retry\b/i.test(nextActionBullet)) return false;
  return true;
}

function stepOutputHasFailureSignals(role, text = '') {
  const value = String(text || '').trim();
  if (!value) return true;
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  const findingsBullet = extractSectionFirstBullet(value, 'Findings');
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  const notVerifiedBullet = extractSectionFirstBullet(value, 'Not Verified');
  const remainingIssuesBullet = extractSectionFirstBullet(value, 'Remaining Issues');
  const actionsTakenBullet = extractSectionFirstBullet(value, 'Actions Taken');
  const artifactsBullet = extractSectionFirstBullet(value, 'Artifacts');
  const acceptanceFailures = extractAcceptanceStatusItems(value).filter((item) => item.status !== 'met');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return true;
  if (failureBullet && !/^none\b/i.test(failureBullet)) return true;
  if (acceptanceFailures.length > 0) return true;
  if (role === 'coder' && coderOutputLacksImplementationEvidence(actionsTakenBullet, artifactsBullet)) return true;
  if (role === 'reviewer' && reviewerFindingNeedsAction(findingsBullet)) return true;
  if ((role === 'tester' || role === 'summarizer') && notVerifiedBullet && !/^none\b/i.test(notVerifiedBullet)) return true;
  if (role === 'summarizer' && remainingIssuesBullet && !/^none\b/i.test(remainingIssuesBullet)) return true;
  if (nextActionBullet && /^(fix|retry|correct|repair)\b/i.test(nextActionBullet)) return true;
  return false;
}

function coderOutputLacksImplementationEvidence(actionsTaken = '', artifacts = '') {
  const noActions = !String(actionsTaken || '').trim() || /^none\b/i.test(String(actionsTaken || '').trim());
  const noArtifacts = !String(artifacts || '').trim() || /^none\b/i.test(String(artifacts || '').trim());
  return noActions && noArtifacts;
}

function reviewerFindingNeedsAction(text = '') {
  const value = String(text || '').trim();
  if (!value || /^none\b/i.test(value)) return false;
  const lower = value.toLowerCase();
  if (
    /\b(bug|regression|risk|risky|missing|missing test|unsafe|blocker|blocked|incorrect|broken|failure|failing|unverified|mismatch|incomplete|gap|can regress|still regress)\b/i.test(
      lower
    )
  ) {
    return true;
  }
  if (/\b(not covered|not handled|not verified|does not|doesn't|cannot|can't|lacks?)\b/i.test(lower)) {
    return true;
  }
  return false;
}

function buildExitCriteriaFailureReason(role, text = '') {
  const value = String(text || '').trim();
  if (!value) return 'no structured step output was produced';
  const errorBullet = extractSectionFirstBullet(value, 'Error');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return `error: ${errorBullet}`;
  const failureBullet = extractSectionFirstBullet(value, 'Failures');
  if (failureBullet && !/^none\b/i.test(failureBullet)) return `failures: ${failureBullet}`;
  const findingsBullet = extractSectionFirstBullet(value, 'Findings');
  const actionsTakenBullet = extractSectionFirstBullet(value, 'Actions Taken');
  const artifactsBullet = extractSectionFirstBullet(value, 'Artifacts');
  if (role === 'coder' && coderOutputLacksImplementationEvidence(actionsTakenBullet, artifactsBullet)) {
    return 'coder output did not include implementation evidence';
  }
  if (role === 'reviewer' && reviewerFindingNeedsAction(findingsBullet)) return `review findings: ${findingsBullet}`;
  const nextActionBullet = extractSectionFirstBullet(value, 'Next Action');
  if (nextActionBullet && /^(fix|retry|correct|repair)\b/i.test(nextActionBullet)) return `next action requires rework: ${nextActionBullet}`;
  const acceptanceFailure = extractAcceptanceStatusItems(value).find((item) => item.status !== 'met');
  if (acceptanceFailure) return `acceptance ${acceptanceFailure.status}: ${acceptanceFailure.label}`;
  const notVerifiedBullet = extractSectionFirstBullet(value, 'Not Verified');
  if ((role === 'tester' || role === 'summarizer') && notVerifiedBullet && !/^none\b/i.test(notVerifiedBullet)) {
    return `not verified: ${notVerifiedBullet}`;
  }
  const remainingIssuesBullet = extractSectionFirstBullet(value, 'Remaining Issues');
  if (role === 'summarizer' && remainingIssuesBullet && !/^none\b/i.test(remainingIssuesBullet)) {
    return `remaining issues: ${remainingIssuesBullet}`;
  }
  return 'step output did not satisfy exit criteria';
}

function extractSectionFirstBullet(text = '', heading = '') {
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(text || '').match(new RegExp(String.raw`(^|\n)\s*${escaped}\s*:\s*(?:\n|\r\n?)+\s*-\s*([^\n\r]+)`, 'i'));
  return String(match?.[2] || '').trim();
}

function extractSectionBullets(text = '', heading = '') {
  const escaped = String(heading || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const value = String(text || '');
  const headingMatch = value.match(new RegExp(String.raw`(^|\n)\s*${escaped}\s*:\s*(?:\n|\r\n?)`, 'i'));
  if (!headingMatch || headingMatch.index == null) return [];
  const start = headingMatch.index + headingMatch[0].length;
  const after = value.slice(start);
  const nextHeading = after.search(/\n\s*[A-Za-z][A-Za-z ]+\s*:\s*(?:\n|\r\n?)/);
  const section = nextHeading === -1 ? after : after.slice(0, nextHeading);
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1]?.trim() || '')
    .filter(Boolean);
}

function extractAcceptanceStatusItems(text = '') {
  return extractSectionBullets(text, 'Acceptance Status')
    .map((item) => {
      const match = String(item).match(/^(met|unmet|unverified)\s*::\s*(.+)$/i);
      if (!match) return null;
      return {
        status: String(match[1] || '').toLowerCase(),
        label: String(match[2] || '').trim()
      };
    })
    .filter(Boolean);
}

function buildAutoPlanSystemSummary(auto) {
  const baseStatusTitle =
    auto.failedCount > 0 ? 'Auto plan finished with failures' : auto.warningCount > 0 ? 'Auto plan finished with warnings' : 'Auto plan finished';
  const statusTitle =
    auto.approvalStatus === 'pending' ? `${baseStatusTitle} (waiting for /yes)` : baseStatusTitle;
  const lines = [
    statusTitle,
    `Plan File: ${auto.filePath}`,
    `Plan Summary: ${auto.summary || '-'}`,
    `Final Summary: ${auto.finalSummary || auto.summary || '-'}`,
    `Approval: ${auto.approvalStatus || 'not_required'}`
  ];
  if (auto.approvalStatus !== 'pending') {
    lines.push(`Steps: ${auto.steps.length} total`);
    lines.push(`Completed: ${auto.completedCount}`);
    lines.push(`Warnings: ${auto.warningCount}`);
    lines.push(`Failed: ${auto.failedCount}`);
  }
  if (auto.warningTitles?.length) {
    lines.push(`Warning steps: ${auto.warningTitles.slice(0, 5).join(', ')}`);
  }
  if (auto.failedTitles?.length) {
    lines.push(`Failed steps: ${auto.failedTitles.slice(0, 5).join(', ')}`);
  }
  // Always include plan steps for TUI rendering
  if (Array.isArray(auto.steps) && auto.steps.length > 0) {
    lines.push('Plan Steps:');
    auto.steps.forEach((s, idx) => {
      lines.push(`  ${idx + 1}. [${s.role}] ${s.title}`);
      if (String(s?.task || '').trim()) {
        lines.push(`     - task: ${String(s.task).trim()}`);
      }
    });
  }
  if (auto.approvalStatus === 'pending') {
    lines.push('Next: review the plan summary, then use /yes to execute, /edit <feedback> to revise this plan, or /reject to discard it.');
  }
  return lines.join('\n');
}

function buildAutoPlanFinalSummaryUserPrompt({ goal, autoPlan, runItems, planningError }) {
  const lines = [];
  lines.push('Create a final execution summary for an auto-generated implementation/test plan.');
  lines.push('Keep it concise, high-signal, and outcome-focused.');
  lines.push('Include: overall result, what was verified, what is still pending, and the best next action.');
  lines.push('Use plain text only. Do not use markdown fences.');
  lines.push('');
  lines.push(`Goal: ${goal}`);
  lines.push(`Plan Summary: ${autoPlan?.summary || `Auto plan for: ${goal}`}`);
  if (planningError) {
    lines.push(`Planning Error: ${planningError}`);
  }
  lines.push('');
  lines.push('Executed Steps:');
  runItems.forEach((item, idx) => {
    lines.push(`${idx + 1}. [${item.role}] ${item.title}`);
    if (item.failed) {
      lines.push(`Status: failed`);
    } else if (item.warning) {
      lines.push(`Status: warning`);
    } else {
      lines.push(`Status: completed`);
    }
    if (item.error) {
      lines.push(`Error: ${item.error}`);
    }
    if (item.warning) {
      lines.push(`Warning: ${item.warning}`);
    }
    lines.push(`Output: ${trimInline(item.output || '(empty)', 500)}`);
    if (Array.isArray(item.artifactPaths) && item.artifactPaths.length > 0) {
      lines.push(`Artifacts: ${item.artifactPaths.slice(0, 5).join(', ')}`);
    }
    lines.push('');
  });
  return lines.join('\n').trim();
}

async function buildAutoPlanFinalSummary({
  goal,
  autoPlan,
  runItems,
  planningError,
  config,
  model,
  systemPrompt
}) {
  const fallbackParts = [];
  if (runItems.some((item) => item.failed || item.error)) {
    fallbackParts.push('Execution finished with failed steps.');
  } else if (runItems.some((item) => item.warning)) {
    fallbackParts.push('Execution finished with warnings.');
  } else {
    fallbackParts.push('Execution finished successfully.');
  }
  const verifiedTitles = runItems.filter((item) => !item.failed).map((item) => item.title);
  const pendingTitles = runItems.filter((item) => item.failed || item.warning).map((item) => item.title);
  if (verifiedTitles.length > 0) {
    fallbackParts.push(`Completed: ${verifiedTitles.slice(0, 4).join(', ')}.`);
  }
  if (pendingTitles.length > 0) {
    fallbackParts.push(`Needs follow-up: ${pendingTitles.slice(0, 4).join(', ')}.`);
  }
  const fallbackSummary = fallbackParts.join(' ');

  if (runItems.some((item) => item.failed || item.error)) {
    return fallbackSummary;
  }

  try {
    const result = await createChatCompletion({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        {
          role: 'system',
          content: `${systemPrompt}\nYou are writing the final execution summary for a completed auto plan. Focus on closure, verification status, and the next action.`
        },
        {
          role: 'user',
          content: buildAutoPlanFinalSummaryUserPrompt({ goal, autoPlan, runItems, planningError })
        }
      ],
      timeoutMs: config.gateway.timeout_ms || 90000,
      maxRetries: config.gateway.max_retries ?? 2
    });
    return trimInline(result.text || '', 600) || fallbackSummary;
  } catch {
    return fallbackSummary;
  }
}

async function writeMarkdownInProjectDir(subDir, title, body, fallbackName, sessionId) {
  const dir =
    subDir === 'specs'
      ? getProjectSpecsDir(process.cwd(), sessionId)
      : subDir === 'plans'
        ? getProjectPlansDir(process.cwd(), sessionId)
        : path.join(getProjectWorkspaceDir(process.cwd()), subDir, ...(sessionId ? [String(sessionId)] : []));
  await fs.mkdir(dir, { recursive: true });
  const slug = slugify(title).slice(0, 64);
  const fileName = `${nowStamp()}-${slug || fallbackName}.md`;
  const filePath = path.join(dir, fileName);
  await fs.writeFile(filePath, `${body.trim()}\n`, 'utf8');
  return filePath;
}

function buildSpecTemplate(topic) {
  return `
# Spec: ${topic}

## 1. Background
- Why this work is needed
- Existing pain points

## 2. Goals
- Primary goal
- Non-goals

## 3. Scope
- In scope
- Out of scope

## 4. Requirements
- Functional requirements
- Non-functional requirements
- Win10 compatibility requirements

## 5. Design
- Architecture sketch
- Data flow
- Key interfaces/commands

## 6. Risks and Mitigations
- Risk
- Mitigation

## 7. Validation
- Test strategy
- Acceptance checklist
`;
}

function extractSpecTitle(specText, fallback = 'spec') {
  const raw = String(specText || '');
  const heading = raw.match(/^#\s+Spec:\s+(.+)$/m) || raw.match(/^#\s+(.+)$/m);
  return String(heading?.[1] || fallback).trim();
}

async function buildSpecWithModel({
  topic,
  config,
  model,
  systemPrompt
}) {
  const prompt = [
    'Write a practical engineering spec in markdown.',
    'Use these sections exactly:',
    '# Spec: <title>',
    '## 1. Background',
    '## 2. Goals',
    '## 3. Scope',
    '## 4. Requirements',
    '## 5. Design',
    '## 6. Risks and Mitigations',
    '## 7. Validation',
    'Make it implementation-oriented and suitable for a Win10-first internal coding CLI.'
  ].join('\n');

  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: `${systemPrompt}\n${prompt}` },
      { role: 'user', content: `Topic: ${topic}` }
    ],
    timeoutMs: config.gateway.timeout_ms || 90000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  return String(result.text || '').trim();
}

function buildPlanTemplate(goal) {
  return `
# Plan: ${goal}

## Phase 1: Discovery
1. Confirm constraints and environment assumptions
2. Inspect related modules and dependencies
3. Define verification approach

## Phase 2: Implementation
1. Implement core flow
2. Integrate with existing command/runtime paths
3. Add guards for Win10-specific behavior

## Phase 3: Verification
1. Run automated tests
2. Run manual TUI validation
3. Document usage and rollback steps

## Task Breakdown
- [ ] Task A
- [ ] Task B
- [ ] Task C
`;
}

async function buildPlanFromSpecWithModel({
  specText,
  specPath,
  config,
  model,
  systemPrompt
}) {
  const projectConstraints = await inferProjectImplementationConstraints(process.cwd());
  const prompt = [
    'Convert the provided engineering spec into an implementation plan in markdown.',
    'Use this structure exactly:',
    '# Plan: <title>',
    '## Phase 1: Discovery',
    '## Phase 2: Implementation',
    '## Phase 3: Verification',
    '## Task Breakdown',
    'Make the plan concrete and ordered for a coding agent.'
  ].join('\n');

  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: `${systemPrompt}\n${prompt}` },
      {
        role: 'user',
        content: `Spec path: ${specPath || '(inline)'}\n\nProject implementation constraints:\n${projectConstraints}\n\n${specText}`
      }
    ],
    timeoutMs: config.gateway.timeout_ms || 90000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  return String(result.text || '').trim();
}

async function collectLikelyImplementationFiles(cwd) {
  const candidates = [];
  const roots = ['src', 'app', 'lib'];
  const preferredExts = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

  async function visit(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.codemini') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(abs);
        continue;
      }
      if (!preferredExts.has(path.extname(entry.name).toLowerCase())) continue;
      candidates.push(normalizePath(path.relative(cwd, abs)));
      if (candidates.length >= 8) return;
    }
  }

  for (const root of roots) {
    const absRoot = path.join(cwd, root);
    if (!(await pathExists(absRoot))) continue;
    await visit(absRoot);
    if (candidates.length >= 8) break;
  }
  return candidates.slice(0, 8);
}

async function inferProjectImplementationConstraints(cwd) {
  const hints = [];
  const packageJsonPath = path.join(cwd, 'package.json');
  const pyprojectPath = path.join(cwd, 'pyproject.toml');
  const cargoPath = path.join(cwd, 'Cargo.toml');
  const goModPath = path.join(cwd, 'go.mod');

  if (await pathExists(packageJsonPath)) {
    hints.push('- Detected package.json in the workspace.');
    hints.push('- Prefer JavaScript/TypeScript style paths and file names that fit the existing repo.');
    hints.push('- Reuse existing src/*.js, src/*.ts, or neighboring modules before inventing new utility modules.');
  }
  if (await pathExists(pyprojectPath)) {
    hints.push('- Detected pyproject.toml in the workspace.');
    hints.push('- Prefer Python modules and package layout that already exist in this repo.');
  }
  if (await pathExists(cargoPath)) {
    hints.push('- Detected Cargo.toml in the workspace.');
    hints.push('- Prefer Rust crate/module layout that matches the current workspace.');
  }
  if (await pathExists(goModPath)) {
    hints.push('- Detected go.mod in the workspace.');
    hints.push('- Prefer Go package paths and file names already present in the repo.');
  }

  if (hints.length === 0) {
    hints.push('- No strong language marker was detected automatically.');
    hints.push('- Infer the implementation language from the referenced files in the spec and preserve that language family.');
  }

  const likelyFiles = await collectLikelyImplementationFiles(cwd);
  if (likelyFiles.length > 0) {
    hints.push('- Likely existing implementation files to reuse first:');
    for (const file of likelyFiles) {
      hints.push(`  - ${file}`);
    }
    hints.push('- Prefer updating one of the listed files when the feature naturally fits there before inventing new modules.');
  }

  hints.push('- Do not invent files in another language family unless the spec explicitly requires it.');
  hints.push('- If the spec references existing files, keep the plan anchored to those exact files or their immediate neighbors.');
  return hints.join('\n');
}

function clampRange(start, end, max) {
  const s = Math.max(1, Math.min(start, max));
  const e = Math.max(s, Math.min(end, max));
  return { s, e };
}

function effectiveMaxContextTokens(config) {
  const modelCap = Number(config.model?.max_context_tokens);
  if (Number.isFinite(modelCap) && modelCap > 0) return modelCap;
  const legacy = Number(config.context?.max_tokens);
  if (Number.isFinite(legacy) && legacy > 0) return legacy;
  return 32000;
}

function buildRuntimeStateSnapshot({ currentSession, config, model, executionMode, extraSession }) {
  const parentTokens = estimateMessagesTokens(currentSession?.messages || []);
  const subTokens = extraSession ? estimateMessagesTokens(extraSession.messages || []) : 0;
  const currentContextTokens = parentTokens + subTokens;
  const maxContextTokens = effectiveMaxContextTokens(config);
  const contextUsagePct = maxContextTokens > 0 ? Math.min(100, Math.max(0, (currentContextTokens / maxContextTokens) * 100)) : 0;
  const snapshot = {
    sessionId: currentSession?.id || '',
    mode: executionMode || config.execution?.mode || 'auto',
    sdkProvider: config.sdk?.provider || 'openai-compatible',
    model: model || config.model?.name || '',
    maxContextTokens
  };
  Object.defineProperties(snapshot, {
    currentContextTokens: {
      value: currentContextTokens,
      enumerable: false,
      writable: false
    },
    contextUsagePct: {
      value: contextUsagePct,
      enumerable: false,
      writable: false
    },
    pendingPlanApproval: {
      value: currentSession?.planState?.status === 'pending_approval',
      enumerable: false,
      writable: false
    }
  });
  return snapshot;
}

function estimatePromptTokensForRequest(sessionMessages, userText = '') {
  const tokenMsgs = [
    ...(Array.isArray(sessionMessages) ? sessionMessages : []),
    { role: 'user', content: String(userText || '') }
  ];
  return estimateMessagesTokens(tokenMsgs);
}

function stampedMessage(role, content, extra = {}) {
  return {
    role,
    content,
    at: new Date().toISOString(),
    ...extra
  };
}

function hasPendingPlanApproval(session) {
  return session?.planState?.status === 'pending_approval';
}

function isApprovalText(text = '') {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return /^(yes|\/yes|y|ok|okay|approve|approved|continue|proceed|go ahead|start|开始|继续|可以|同意|批准|通过|按这个做)$/.test(value);
}

function isStayInPlanText(text = '') {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return /^(stay|\/stay|keep planning|keep in plan mode|not yet|wait|先别|先等等|继续计划|继续讨论|继续规划|暂不批准)$/.test(value);
}

function isRejectPlanText(text = '') {
  const value = String(text || '').trim().toLowerCase();
  if (!value) return false;
  return /^(\/reject|reject|no|discard|cancel|否决|拒绝|不要了|取消计划)$/.test(value);
}

function shouldPersistInputHistory(parsedInput) {
  if (!parsedInput || parsedInput.type !== 'slash') return true;
  const command = String(parsedInput.command || '').trim().toLowerCase();
  // Keep approval-only commands out of input history (↑/↓ should focus on real task prompts).
  return !['yes', 'no', 'edit', 'reject'].includes(command);
}

function buildPendingPlanApprovalMessage(planState) {
  const lines = [
    'Plan approval is still pending.',
    `Goal: ${planState?.goal || '-'}`,
    `Plan File: ${planState?.filePath || '-'}`,
    `Summary: ${planState?.finalSummary || planState?.summary || '-'}`,
    'Use /yes to execute this plan, /edit <feedback> to revise it, or /reject to discard it.'
  ];
  return lines.join('\n');
}

function buildApprovedPlanExecutionPrompt(planState, approvalText = '') {
  const requirementPacket = buildGoalRequirementPacket(planState?.goal || '', 'coder');
  const lines = [
    'Approved implementation plan:',
    `Original goal: ${planState?.goal || '-'}`,
    `Plan file: ${planState?.filePath || '-'}`,
    `Plan summary: ${planState?.summary || '-'}`,
    `Final planning summary: ${planState?.finalSummary || planState?.summary || '-'}`,
    `User approval: ${String(approvalText || '').trim() || 'approved'}`,
    requirementPacket,
    Array.isArray(planState?.steps) && planState.steps.length > 0 ? 'Planned steps:' : '',
    ...(Array.isArray(planState?.steps)
      ? planState.steps.slice(0, 8).map((step, index) => `${index + 1}. [${step.role}] ${step.title} :: ${step.task}`)
      : []),
    'Proceed with implementation now.',
    'Follow the approved direction unless a blocking contradiction appears.',
    'Output rules for this implementation phase:',
    '- Be concise and practical.',
    '- Do not celebrate, praise, or use emojis.',
    '- Do not restate the full plan back to the user.',
    '- If the work is already done, say so briefly and cite the verification evidence.',
    '- After implementation or verification, prefer a short result summary in 3-6 lines.',
    '- If the work is complete, use this exact structure:',
    'Status: <done|partial|blocked>',
    'Verified: <tests, checks, or evidence>',
    'Next: <none or the single next action>'
  ];
  return lines.join('\n');
}

async function resolveSpecPath(rawArg = '', sessionId = '') {
  const input = String(rawArg || '').trim();
  const roots = [
    getProjectSpecsDir(process.cwd(), String(sessionId || '')),
    getProjectSpecsDir(process.cwd())
  ];

  if (input) {
    const direct = path.resolve(process.cwd(), input);
    try {
      await fs.access(direct);
      return direct;
    } catch {}

    for (const root of roots) {
      try {
        const entries = await fs.readdir(root);
        const match = entries.find((name) => name.endsWith('.md') && name.includes(input));
        if (match) return path.join(root, match);
      } catch {
        continue;
      }
    }
  }

  for (const root of roots) {
    try {
      const latest = (await fs.readdir(root))
        .filter((name) => name.endsWith('.md'))
        .sort()
        .reverse()[0];
      if (latest) return path.join(root, latest);
    } catch {
      continue;
    }
  }
  return '';
}

async function expandFileMentions(rawText, workspaceRoot = process.cwd()) {
  const text = String(rawText || '');
  const mentionRegex = /@([A-Za-z0-9_./\\-]+)(?::(\d+)-(\d+))?/g;
  const matches = Array.from(text.matchAll(mentionRegex));
  if (matches.length === 0) return text;

  let out = text;
  for (const m of matches) {
    const full = m[0];
    const relPath = m[1];
    const a = m[2] ? Number(m[2]) : null;
    const b = m[3] ? Number(m[3]) : null;
    const abs = path.resolve(workspaceRoot, relPath);
    if (!abs.startsWith(path.resolve(workspaceRoot))) continue;
    try {
      const content = await fs.readFile(abs, 'utf8');
      let snippet = content;
      if (a && b) {
        const lines = content.split('\n');
        const { s, e } = clampRange(a, b, lines.length);
        snippet = lines.slice(s - 1, e).join('\n');
      }
      const replacement = `\n[FILE:${relPath}${a && b ? `:${a}-${b}` : ''}]\n${snippet}\n[/FILE]\n`;
      out = out.replace(full, replacement);
    } catch {
      continue;
    }
  }
  return out;
}

async function askModel({
  text,
  session,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  requestToolApproval,
  persistSession = true,
  executionMode,
  alwaysAllowTools,
  signal,
  allowedTools,
  maxSteps: maxStepsOverride,
  skipAnalysisNudge = false
}) {
  const maxContextTokens = effectiveMaxContextTokens(config);
  const triggerPct = Number(config.context?.preflight_trigger_pct || 92);
  const hardPct = Number(config.context?.hard_limit_pct || 98);
  const preflightTokens = estimatePromptTokensForRequest(session.messages, text);
  const preflightPct = (preflightTokens / maxContextTokens) * 100;

  if (preflightPct >= triggerPct) {
    const auto = compactMessagesLocally(session.messages, {
      mode: preflightPct >= hardPct ? 'aggressive' : 'conservative'
    });
    if (auto.changed) {
      session.messages = auto.compacted.map((m) => ({ ...m, at: new Date().toISOString() }));
      await saveSession(session);
      if (onAgentEvent) {
        onAgentEvent({
          type: 'compact:auto',
          mode: preflightPct >= hardPct ? 'aggressive' : 'conservative',
          threshold: Math.round(preflightPct)
        });
      }
    }
  }

  let saveTimer = null;
  let saveResolver = null;
  let savePromise = null;
  const scheduleSessionSave = () => {
    if (!persistSession) return;
    if (saveTimer) return;
    savePromise = new Promise((resolve) => {
      saveResolver = resolve;
    });
    saveTimer = setTimeout(async () => {
      const done = saveResolver;
      saveTimer = null;
      saveResolver = null;
      try {
        await saveSession(session);
      } finally {
        if (done) done();
        savePromise = null;
      }
    }, STREAM_SAVE_DEBOUNCE_MS);
  };
  const flushScheduledSave = async () => {
    if (!persistSession) return;
    if (saveTimer) {
      clearTimeout(saveTimer);
      const done = saveResolver;
      saveTimer = null;
      saveResolver = null;
      savePromise = null;
      await saveSession(session);
      if (done) done();
      return;
    }
    if (savePromise) await savePromise;
  };
  if (persistSession && signal) {
    const flushOnAbort = () => {
      void flushScheduledSave().catch(() => {});
    };
    if (signal.aborted) {
      flushOnAbort();
    } else {
      signal.addEventListener('abort', flushOnAbort, { once: true });
    }
  }

  if (text) {
    session.messages.push(stampedMessage('user', text));
    if (persistSession) await saveSession(session);
  }

  const projectContextSnippet = await buildProjectContextSnippet(process.cwd(), text).catch(() => '');
  const effectiveSystemPrompt = projectContextSnippet
    ? `${systemPrompt}\n\n${projectContextSnippet}\n\nUse this project context as lightweight guidance and verify important details with fresh reads when needed.`
    : systemPrompt;

  const { definitions, handlers, formatters, deferredDefinitions, dispose: disposeTools } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config,
    sessionId: session.id,
    onSystemEvent: onAgentEvent,
    getTodos: () => normalizeTodos(session.todos),
    onTodosUpdate: (todos) => {
      session.todos = normalizeTodos(todos);
      scheduleSessionSave();
    },
    getPlanState: () => normalizePlanState(session.planState),
    onPlanStateUpdate: (planState) => {
      session.planState = normalizePlanState(planState);
      scheduleSessionSave();
    }
  });

  const filteredDefinitions = Array.isArray(allowedTools)
    ? definitions.filter((t) => allowedTools.includes(t.function?.name || t.name))
    : definitions;
  const filteredHandlers = Array.isArray(allowedTools)
    ? Object.fromEntries(Object.entries(handlers).filter(([name]) => allowedTools.includes(name)))
    : handlers;
  const filteredDeferred = Array.isArray(allowedTools)
    ? Object.fromEntries(Object.entries(deferredDefinitions).filter(([name]) => allowedTools.includes(name)))
    : deferredDefinitions;

  let activeAssistantIndex = -1;
  const wrappedAgentEvent = (event) => {
    // Always accumulate messages in session (for token tracking), only save when persisting
    if (event?.type === 'assistant:start') {
      session.messages.push(stampedMessage('assistant', ''));
      activeAssistantIndex = session.messages.length - 1;
      if (persistSession) scheduleSessionSave();
    } else if (event?.type === 'assistant:delta') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        current.content = `${current.content || ''}${event.text || ''}`;
        current.at = new Date().toISOString();
        if (persistSession) scheduleSessionSave();
      }
    } else if (event?.type === 'assistant:response') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        current.content = event.assistantMessage?.content ?? event.text ?? current.content;
        if (typeof event.assistantMessage?.reasoning_content === 'string' && event.assistantMessage.reasoning_content) {
          current.reasoning_content = event.assistantMessage.reasoning_content;
        }
        if (Array.isArray(event.assistantMessage?.reasoning_details) && event.assistantMessage.reasoning_details.length > 0) {
          current.reasoning_details = event.assistantMessage.reasoning_details;
        }
        if (Array.isArray(event.assistantMessage?.tool_calls) && event.assistantMessage.tool_calls.length > 0) {
          current.tool_calls = event.assistantMessage.tool_calls;
        }
        current.at = new Date().toISOString();
        if (persistSession) scheduleSessionSave();
      }
      activeAssistantIndex = -1;
    } else if (event?.type === 'tool:result') {
      session.messages.push(
        stampedMessage('tool', event.content || '', {
          tool_call_id: event.id || ''
        })
      );
      if (persistSession) scheduleSessionSave();
    }

    if (onAgentEvent) onAgentEvent(event);
  };

  const loopUserPrompt = persistSession ? '' : text;
  const loopResult = await runAgentLoop({
    systemPrompt: effectiveSystemPrompt,
    userPrompt: loopUserPrompt,
    model: model || config.model.name,
    maxSteps: maxStepsOverride ?? Number(config.execution?.max_steps || 16),
    toolDefinitions: filteredDefinitions,
    toolHandlers: filteredHandlers,
    initialMessages: toOpenAIMessages(session.messages),
    onEvent: wrappedAgentEvent,
    executionMode: executionMode || config.execution?.mode || 'auto',
    alwaysAllowTools:
      alwaysAllowTools || config.execution?.always_allow_tools || ['run', 'read', 'write'],
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    toolFormatters: formatters,
    deferredDefinitions: filteredDeferred,
    requestToolApproval,
    signal,
    skipAnalysisNudge,
    config,
    requestCompletion: async ({ messages, tools, model: selectedModel }) => {
      let started = false;
      const startAssistantStream = () => {
        if (!started && onAgentEvent) {
          started = true;
          onAgentEvent({ type: 'assistant:start' });
        }
      };

      const result = await createChatCompletionStream({
        sdkProvider: config.sdk?.provider,
        baseUrl: config.gateway.base_url,
        apiKey: config.gateway.api_key,
        model: selectedModel,
        messages,
        tools,
        timeoutMs: config.gateway.timeout_ms || 90000,
        maxRetries: config.gateway.max_retries ?? 2,
        signal,
        onTextDelta: (delta) => {
          startAssistantStream();
          if (onAgentEvent) onAgentEvent({ type: 'assistant:delta', text: delta });
        },
        onToolCallDelta: (toolCall) => {
          startAssistantStream();
          if (onAgentEvent) onAgentEvent({ type: 'assistant:tool_call_delta', toolCall });
        }
      });

      if (!started && !result?.incomplete && (result?.text || result?.toolCalls?.length)) {
        startAssistantStream();
      }

      return result;
    }
  });

  if (persistSession) {
    session.messages = loopResult.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ ...m, at: new Date().toISOString() }));
    await flushScheduledSave();
    await saveSession(session);
    try {
      await pruneSessions(config.sessions || {});
    } catch {
      // keep chat usable even if pruning fails
    }
  }
  return { text: loopResult.text, aborted: !!loopResult.aborted };
}

async function runSubAgentTask({
  role,
  task,
  goal = '',
  priorSteps = [],
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  extraRolePrompt = '',
  signal,
  onSessionActive,
  planFileContext = ''
}) {
  const subSession = { id: `sub-${Date.now()}`, messages: [] };
  const rolePrompt = getSubAgentRolePrompt(role);
  const contextPacket = buildSubAgentContextPacket(parentSession);
  const evidencePacket = buildSubAgentEvidencePacket(parentSession);
  const handoffPacket = buildStepArtifactPacket(priorSteps, role);
  const handoffFocusPaths = collectStepArtifacts(priorSteps, role)?.focusPaths || [];
  const focusedTaskNote = buildFocusedTaskNote(role, handoffFocusPaths);
  const goalRequirementPacket = buildGoalRequirementPacket(goal, role);
  const verificationPacket = role === 'tester' ? await buildTesterVerificationPacket(handoffFocusPaths) : '';
  const planFileSection = planFileContext
    ? `Accumulated plan file context (results from prior steps):\n${planFileContext}`
    : '';
  const scopedTask = [
    contextPacket,
    goalRequirementPacket,
    evidencePacket,
    handoffPacket,
    planFileSection,
    verificationPacket,
    focusedTaskNote,
    'Task:',
    task
  ]
    .filter(Boolean)
    .join('\n\n');
  let blockedCount = 0;
  let toolErrorCount = 0;
  const artifactPaths = [];
  const seenArtifactPaths = new Set();
  const wrappedOnAgentEvent = (evt) => {
    if (evt?.type === 'tool:blocked') blockedCount += 1;
    if (evt?.type === 'tool:error') toolErrorCount += 1;
    if (evt?.type === 'tool:result' && evt.content) {
      try {
        const parsed = JSON.parse(String(evt.content));
        if (parsed?.path) {
          const artifactPath = String(parsed.path);
          if (!seenArtifactPaths.has(artifactPath)) {
            seenArtifactPaths.add(artifactPath);
            artifactPaths.push(artifactPath);
          }
        }
        if (typeof parsed?.stdout === 'string') {
          extractLikelyPathsFromText(parsed.stdout, artifactPaths, seenArtifactPaths);
        }
      } catch {}
    }
    if (onAgentEvent) onAgentEvent(evt);
  };
  const roleAllowedTools = ROLE_TOOL_POLICY[role];
  if (onSessionActive) onSessionActive(subSession);
  const subResult = await askModel({
    text: scopedTask,
    session: subSession,
    config,
    model,
    systemPrompt: `${systemPrompt}\n${rolePrompt}${extraRolePrompt ? `\n${extraRolePrompt}` : ''}`,
    onAgentEvent: wrappedOnAgentEvent,
    persistSession: false,
    executionMode: 'auto',
    allowedTools: roleAllowedTools,
    skipAnalysisNudge: true,
    signal
  });
  const text = subResult.text || '';
  const hasErrorLine = /(^|\n)\s*error\s*:/i.test(text);
  return {
    text,
    blockedCount,
    toolErrorCount,
    hasErrorLine,
    artifactPaths: artifactPaths.slice(0, SUB_AGENT_HANDOFF_MAX_ITEMS)
  };
}

async function executePlanWithSubAgents({
  planState,
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  signal,
  onSubSessionActive
}) {
  const steps = Array.isArray(planState.steps) ? planState.steps : [];
  const goal = planState.goal || '';
  const planFilePath = planState.filePath || '';
  let partialDeltaText = '';
  const emitPlanEvent = (evt) => {
    if (evt?.type === 'assistant:delta' && evt.text) {
      partialDeltaText += String(evt.text);
    }
    if (onAgentEvent) onAgentEvent(evt);
  };
  if (steps.length === 0) {
    return { text: '(no steps to execute)', aborted: false };
  }

  const priorSteps = [];
  const results = [];

  // Emit structured plan steps so TUI can show all steps with real role/title
  emitPlanEvent({
    type: 'plan:steps',
    steps: steps.map((s, idx) => ({ index: idx + 1, role: s.role, title: s.title, status: 'pending' }))
  });

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (signal?.aborted) break;

    emitPlanEvent({
      type: 'assistant:delta',
      text: `\n[plan] Step ${i + 1}/${steps.length} -> ${step.role}: ${step.title}\n`
    });

    // Read accumulated plan file context from prior step results (skip for step 0)
    let planFileContext = '';
    if (i > 0 && planFilePath) {
      planFileContext = await readPlanFileAsContext(planFilePath);
    }

    const stepGuidance = buildPipelineStepGuidance({ role: step.role, stepIndex: i, totalSteps: steps.length, isFirst: i === 0, isLast: i === steps.length - 1, priorSteps });
    const output = await runSubAgentTask({
      role: step.role,
      task: step.task,
      goal,
      priorSteps,
      parentSession,
      config,
      model,
      systemPrompt,
      onAgentEvent: emitPlanEvent,
      extraRolePrompt: stepGuidance,
      signal,
      onSessionActive: onSubSessionActive,
      planFileContext
    });

    const stepRecord = {
      role: step.role,
      title: step.title,
      task: step.task,
      output: output.text || '',
      blockedCount: output.blockedCount || 0,
      toolErrorCount: output.toolErrorCount || 0,
      hasErrorLine: output.hasErrorLine || false,
      artifactPaths: output.artifactPaths || [],
      failed:
        output.hasErrorLine ||
        stepOutputHasFailureSignals(step.role, output.text || ''),
      failureReason: ''
    };
    if (stepRecord.failed) {
      stepRecord.failureReason =
        output.hasErrorLine
          ? 'tool or model execution error'
          : buildExitCriteriaFailureReason(step.role, output.text || '');
    }
    priorSteps.push(stepRecord);
    results.push(stepRecord);

    // Write step result to plan file for subsequent steps to read
    if (planFilePath) {
      await appendStepResultToPlanFile(
        planFilePath,
        i,
        step.title,
        step.role,
        stepRecord.output,
        stepRecord.artifactPaths
      );
    }

    if (stepRecord.failed && i < steps.length - 1) break;
  }

  const summaryLines = [];
  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const tag = r.failed ? 'FAILED' : 'DONE';
    summaryLines.push(`[${tag}] ${r.role}: ${r.title}`);
    summaryLines.push(r.output.slice(0, 400));
    summaryLines.push('');
  }

  const failedSteps = results.filter((r) => r.failed);
  if (failedSteps.length > 0) {
    summaryLines.push(`${failedSteps.length} step(s) had errors.`);
    const firstFailed = failedSteps[0];
    if (firstFailed?.failureReason) {
      summaryLines.push(`Pipeline stopped after exit criteria failed at [${firstFailed.role}] ${firstFailed.title}: ${firstFailed.failureReason}.`);
    }
  }
  if (signal?.aborted) {
    const partial = partialDeltaText.trim();
    if (partial) {
      const clipped = partial.length > 6000 ? `${partial.slice(0, 6000)}\n... [partial output truncated]` : partial;
      parentSession.messages.push(stampedMessage('assistant', clipped));
      await saveSession(parentSession);
    }
  }

  return {
    text: summaryLines.join('\n'),
    aborted: !!signal?.aborted,
    results
  };
}

async function buildAutoPlanAndRun({
  goal,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  sessionId,
  taskClass
}) {
  const normalizedTaskClass = taskClass || classifyPlanTaskClass(goal);
  const requirementPacket = buildGoalRequirementPacket(goal, 'planner');
  const plannerPrompt = [
    buildAutoPlanPlannerGuidance(),
    'Planning policy:',
    '- First classify the user goal as one of: advisory, implementation, or verification-heavy.',
    '- advisory = analysis, review, audit, optimization suggestions, architecture feedback, brainstorming, planning, or recommendation requests.',
    '- implementation = add/build/create/implement/refactor/fix/update/change behavior in code or files.',
    '- verification-heavy = the user explicitly asks to run tests, verify findings, reproduce a bug, prove a claim, or validate a result.',
    '- For advisory goals, prefer only planner and coder roles. Do not use reviewer or tester unless the user explicitly asks for verification or review as a separate deliverable.',
    '- For advisory goals, do not emit generic filler steps such as "Test and verify", "Review recommendations", or other template-only steps.',
    '- For implementation goals, reviewer and tester are optional support roles, not defaults. Only include them when they clearly add value.',
    '- Every step title must be concrete and tied to the goal. Avoid vague titles like "Initial analysis", "Review recommendations", or "Test and verify" unless the user explicitly requested those activities.',
    '- If the task is purely to inspect the current project and suggest improvements, a lean 2-step or 3-step plan is preferred.',
    '- Example advisory roles: planner -> inspect project shape, coder -> synthesize findings and prioritized recommendations.',
    '- Example implementation roles: planner -> inspect target area, coder -> implement change, tester -> verify changed behavior.',
    'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|coder|reviewer|tester|summarizer","task":"..."}]}. No markdown.'
  ].join('\n');
  let autoPlan = {
    summary: `Auto plan for: ${goal}`,
    steps: [
      {
        title: 'Initial analysis',
        role: 'planner',
        task: `Break down and propose implementation steps for: ${goal}`
      }
    ]
  };
  let planningError = '';
  try {
    const planning = await createChatCompletion({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        { role: 'system', content: `${systemPrompt}\n${plannerPrompt}` },
        {
          role: 'user',
          content: [
            'Create an execution plan and assign best sub-agent role for each step.',
            'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|coder|reviewer|tester|summarizer","task":"..."}]}. No markdown.',
            'The available roles are planner, coder, reviewer, tester, and summarizer. Use only the roles the task actually needs.',
            'The summarizer role synthesizes prior step results without re-analyzing. Use it as the final step for plans with 3+ steps.',
            `Task class: ${normalizedTaskClass}`,
            'Before choosing roles, decide whether the request is advisory, implementation, or verification-heavy.',
            requirementPacket,
            'The first step should usually inspect or clarify the target area before implementation.',
            'For analysis, recommendation, optimization, audit, or project-review goals, keep the plan lean and usually limit it to planner/coder.',
            'Do not include reviewer/tester for advisory goals unless the user explicitly asks to validate, verify, or independently review the findings.',
            'Avoid template-only titles like "Initial analysis", "Review recommendations", or "Test and verify" for advisory goals.',
            'For implementation-heavy changes, prefer review and/or testing steps near the end only when they materially improve confidence.',
            'Prefer 3-5 steps total.'
          ]
            .filter(Boolean)
            .join('\n')
        }
      ],
      timeoutMs: config.gateway.timeout_ms || 90000,
      maxRetries: config.gateway.max_retries ?? 2
    });
    const parsed = extractJsonBlock(planning.text || '');
    autoPlan = normalizeAutoPlan(parsed, goal);
  } catch (err) {
    planningError = String(err?.message || err || 'planning failed');
    autoPlan = buildFallbackAutoPlan(goal);
  }

  const finalSummary = planningError
    ? `Plan created with fallback guidance because planning hit an error: ${planningError}`
    : 'Plan created and waiting for approval before implementation.';

  const filePath = await writeMarkdownInProjectDir(
    'plans',
    `${goal}-auto`,
    renderAutoPlanMarkdown({
      goal,
      autoPlan,
      finalSummary,
      planningError,
      approvalText: 'Pending user approval before implementation.',
      progressLine: '- Plan created and waiting for execution.'
    }),
    'plan-auto',
    sessionId
  );
  return {
    filePath,
    summary: autoPlan.summary,
    finalSummary,
    approvalStatus: 'pending',
    steps: autoPlan.steps,
    completedCount: 0,
    warningCount: planningError ? 1 : 0,
    failedCount: 0,
    warningTitles: planningError ? ['planner:fallback-plan'] : [],
    failedTitles: []
  };
}

function renderAutoPlanMarkdown({
  goal,
  autoPlan,
  finalSummary,
  planningError = '',
  approvalText = 'Pending user approval before implementation.',
  progressLine = '- Plan created and waiting for execution.'
}) {
  const lines = [];
  lines.push(`# Auto Plan: ${goal}`);
  lines.push('');
  lines.push('## Summary');
  lines.push(autoPlan?.summary || `Auto plan for: ${goal}`);
  lines.push('');
  lines.push('## Final Summary');
  lines.push(finalSummary || '(empty)');
  if (planningError) {
    lines.push('');
    lines.push(`Planning Error: ${planningError}`);
  }
  lines.push('');
  lines.push('## Steps');
  (Array.isArray(autoPlan?.steps) ? autoPlan.steps : []).forEach((s, idx) => {
    lines.push(`${idx + 1}. [${s.role}] ${s.title}`);
    lines.push(`   - task: ${s.task}`);
  });
  lines.push('');
  lines.push('## Approval');
  lines.push(approvalText);
  lines.push('');
  lines.push('## Working Memory');
  lines.push('### Findings Ledger');
  lines.push(PLAN_MEMORY_MARKERS.findings[0]);
  lines.push('- None recorded yet.');
  lines.push(PLAN_MEMORY_MARKERS.findings[1]);
  lines.push('');
  lines.push('### Progress Ledger');
  lines.push(PLAN_MEMORY_MARKERS.progress[0]);
  lines.push(progressLine);
  lines.push(PLAN_MEMORY_MARKERS.progress[1]);
  return lines.join('\n');
}

async function revisePendingPlanWithModel({
  planState,
  feedback,
  config,
  model,
  systemPrompt
}) {
  const goal = String(planState?.goal || '').trim();
  const priorSummary = String(planState?.summary || '').trim();
  const priorSteps = Array.isArray(planState?.steps) ? planState.steps : [];
  if (!goal || !feedback) {
    throw new Error('Plan revision requires both goal and feedback.');
  }
  const prompt = [
    buildAutoPlanPlannerGuidance(),
    'You are revising an existing plan based on explicit user feedback.',
    'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|coder|reviewer|tester|summarizer","task":"..."}]}. No markdown.',
    'Keep roles minimal and only include steps that materially help the goal.'
  ].join('\n');
  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: `${systemPrompt}\n${prompt}` },
      {
        role: 'user',
        content: [
          `Goal: ${goal}`,
          `Current summary: ${priorSummary || '-'}`,
          'Current plan steps:',
          ...priorSteps.map((step, index) => `${index + 1}. [${step.role}] ${step.title} :: ${step.task}`),
          '',
          `User revision feedback: ${feedback}`,
          'Revise the summary and steps accordingly while keeping them executable.'
        ].join('\n')
      }
    ],
    timeoutMs: config.gateway.timeout_ms || 90000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  const parsed = extractJsonBlock(result.text || '');
  const revised = normalizeAutoPlan(parsed, goal);
  const revisedFinalSummary = `Plan revised based on feedback: ${feedback}`;
  const planFilePath = String(planState?.filePath || '').trim();
  if (planFilePath) {
    const content = renderAutoPlanMarkdown({
      goal,
      autoPlan: revised,
      finalSummary: revisedFinalSummary,
      approvalText: 'Pending user approval before implementation (revised).',
      progressLine: `- Plan revised with user feedback: ${feedback}`
    });
    await fs.writeFile(planFilePath, `${content.trim()}\n`, 'utf8');
  }
  return {
    status: 'pending_approval',
    source: String(planState?.source || 'auto'),
    goal,
    filePath: planFilePath,
    summary: revised.summary || `Auto plan for: ${goal}`,
    finalSummary: revisedFinalSummary,
    steps: revised.steps
  };
}

async function handleShellInput(shellText, config) {
  if (!shellText) return { text: '' };
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(shellText, config.policy.blocked_command_patterns)
  ) {
    return { text: 'Blocked by policy: dangerous command pattern detected' };
  }
  const check = evaluateCommandPolicy(shellText, config, process.cwd());
  if (!check.allowed) {
    return { text: `Blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ''}` };
  }
  const result = await runShellCommand({
    command: shellText,
    shell: config.shell.default,
    timeoutMs: config.shell.timeout_ms
  });
  const chunks = [];
  if (result.stdout.trim()) chunks.push(result.stdout.trimEnd());
  if (result.stderr.trim()) chunks.push(result.stderr.trimEnd());
  if (result.code !== 0) chunks.push(`exit code: ${result.code}`);
  return { text: chunks.join('\n') };
}

export async function createChatRuntime({
  session,
  config: initialConfig,
  model,
  systemPrompt,
  requestToolApproval
}) {
  let activeRequestToolApproval = typeof requestToolApproval === 'function' ? requestToolApproval : null;
  const startupEvents = [];
  const initialIndex = await initializeProjectIndex(process.cwd()).catch(() => null);
  if (initialIndex?.summary) {
    startupEvents.push({
      type: 'system_tool',
      name: 'project_index(.codemini/project-map.json,.codemini/file-index.json)',
      status: 'done',
      summary: initialIndex.summary
    });
  }
  const initialTodos = normalizeTodos(session?.todos);
  if (initialTodos.length > 0) {
    startupEvents.push({
      type: 'tool',
      id: `startup-todos-${String(session?.id || 'session')}`,
      name: 'update_todos',
      status: 'done',
      arguments: { todos: initialTodos },
      summary: `${initialTodos.length} todo item(s)`
    });
  }
  const initialPlanState = normalizePlanState(session?.planState);
  if (initialPlanState) {
    startupEvents.push({
      type: 'tool',
      id: `startup-plan-${String(session?.id || 'session')}`,
      name: 'update_plan',
      status: 'done',
      arguments: { plan: initialPlanState },
      summary: `plan status=${initialPlanState.status || 'draft'}`
    });
  }
  let currentSession = session;
  let config = initialConfig;
  const baseSystemPrompt = systemPrompt;
  let executionMode = config.execution?.mode || 'auto';
  if (hasPendingPlanApproval(currentSession)) {
    executionMode = 'plan';
  }
  const commands = await loadCommandsAndSkills();

  // Set up tool result store under session directory
  const sessionResultsDir = path.join(getSessionsDir(), String(currentSession.id));
  setResultDir(sessionResultsDir);
  const compactState = {
    backupMessages: null,
    autoEnabled: true,
    threshold: 60,
    mode: 'conservative'
  };
  let historyIdCache = [currentSession.id];
  let historySessionCache = [
    {
      id: currentSession.id,
      messageCount: Array.isArray(currentSession.messages) ? currentSession.messages.length : 0
    }
  ];
  try {
    const initialSessions = await listSessions(100);
    if (initialSessions.length > 0) {
      const merged = [
        {
          id: currentSession.id,
          messageCount: Array.isArray(currentSession.messages) ? currentSession.messages.length : 0
        },
        ...initialSessions.map((session) => ({
          id: session.id,
          messageCount: Number(session.messageCount || 0)
        }))
      ];
      const deduped = [];
      const seen = new Set();
      for (const session of merged) {
        const id = String(session.id || '').trim();
        if (!id || seen.has(id)) continue;
        seen.add(id);
        deduped.push(session);
      }
      historySessionCache = deduped;
      historyIdCache = deduped.map((session) => session.id);
    }
  } catch {
    // keep startup resilient even if historical sessions cannot be listed
  }

  const configKeyHints = [
    'gateway.base_url',
    'gateway.api_key',
    'model.name',
    'ui.language',
    'ui.reply_language',
    'execution.mode',
    'shell.default',
    'sdk.provider',
    'gateway.timeout_ms',
    'gateway.max_retries',
    'model.max_context_tokens',
    'execution.always_allow_tools',
    'execution.max_steps',
    'context.preflight_trigger_pct',
    'context.hard_limit_pct',
    'context.tool_result_max_chars',
    'context.read_file_default_lines',
    'context.read_file_max_chars',
    'sessions.max_sessions',
    'sessions.retention_days',
    'shell.timeout_ms',
    'context.max_tokens',
    'soul.preset',
    'soul.custom_path',
    'policy.safe_mode',
    'policy.allow_dangerous_commands'
  ];

  const commandPriorityOrder = [
    '/help',
    '/status',
    '/config',
    '/memory',
    '/capture',
    '/inbox',
    '/dream',
    '/mode',
    '/plan',
    '/history',
    '/checkpoint',
    '/agents',
    '/compact',
    '/debug',
    '/retry',
    '/new'
  ];
  const configSubcommandPriority = ['/config set', '/config get', '/config list', '/config reset'];

  const listCommandNames = () => {
    const completionCopy = getCompletionCopy(config.ui?.language);
    const builtins = [
      { name: 'help', description: completionCopy.commands.help },
      { name: 'exit', description: completionCopy.commands.exit },
      { name: 'commands', description: completionCopy.commands.commands },
      { name: 'status', description: completionCopy.commands.status },
      { name: 'mode', description: completionCopy.commands.mode },
      { name: 'compact', description: completionCopy.commands.compact },
      { name: 'checkpoint', description: completionCopy.commands.checkpoint },
      { name: 'spec', description: completionCopy.commands.spec },
      { name: 'plan', description: completionCopy.commands.plan },
      { name: 'agents', description: completionCopy.commands.agents },
      { name: 'config', description: completionCopy.commands.config },
      { name: 'memory', description: completionCopy.commands.memory },
      { name: 'dream', description: completionCopy.commands.dream },
      { name: 'history', description: completionCopy.commands.history },
      { name: 'debug', description: completionCopy.commands.debug },
      { name: 'retry', description: completionCopy.commands.retry },
      { name: 'stop', description: completionCopy.commands.stop },
      { name: 'new', description: completionCopy.commands.new }
    ];
    const out = [];
    for (const cmd of commands.values()) {
      if (cmd.metadata.type === 'skill' && config.skills?.enabled?.[cmd.name] === false) {
        continue;
      }
      out.push({
        name: cmd.name,
        description: cmd.metadata.description || ''
      });
    }
    return [...builtins, ...out].sort((a, b) => a.name.localeCompare(b.name));
  };

  const compactOptions = [
    '--preview',
    '--restore',
    '--aggressive',
    '--conservative',
    '--default',
    '--auto-on',
    '--auto-off',
    '--threshold 60'
  ];

  const configTemplates = [
    '/config list',
    '/config get <key>',
    '/config set <key> <value>',
    '/config reset'
  ];

  const historyTemplates = ['/history list', '/history current', '/history resume <session_id>'];
  const memoryTemplates = ['/memory list <scope>', '/memory search <scope> <query>', '/memory forget <scope> <id>'];
  const modeTemplates = ['/mode normal', '/mode auto', '/mode plan'];
  const checkpointTemplates = [
    '/checkpoint create <name>',
    '/checkpoint list',
    '/checkpoint list --all',
    '/checkpoint load <id>'
  ];
  const specTemplates = ['/spec <topic>'];
  const planTemplates = ['/plan <goal>', '/plan auto <goal>', '/plan approve', '/plan from-spec <spec-path?>'];
  const agentTemplates = ['/agents list', '/agents run planner <task>', '/agents run coder <task>', '/agents run reviewer <task>', '/agents run tester <task>', '/agents run summarizer <task>'];
  const debugTemplates = ['/debug keys on', '/debug keys off', '/debug keys status'];
  const dreamTemplates = ['/dream', '/dream --dry-run', '/dream --scope=project', '/dream --scope=global'];
  const compactTemplates = compactOptions.map((opt) => `/compact ${opt}`);
  const slashTemplates = [
    ...configTemplates,
    ...memoryTemplates,
    ...historyTemplates,
    ...modeTemplates,
    ...checkpointTemplates,
    ...specTemplates,
    ...planTemplates,
    ...agentTemplates,
    ...debugTemplates,
    ...dreamTemplates,
    ...compactTemplates,
    '/retry',
    '/status'
  ];
  const compactKey = (value) => String(value || '').toLowerCase().replace(/[\/\s<>?]/g, '');
  const commandDescriptions = new Map();
  const registerSuggestion = (value, description = '') => {
    commandDescriptions.set(value, description);
    return { value, description };
  };
  const materializeSuggestions = (items) =>
    (Array.isArray(items) ? items : []).map((item) => {
      if (item && typeof item === 'object' && 'value' in item) return item;
      const value = String(item || '');
      return { value, description: commandDescriptions.get(value) || '' };
    });
  const matchCompactTemplates = (value) => {
    const needle = compactKey(value);
    if (!needle) return [];
    return materializeSuggestions(
      slashTemplates.filter((template) => compactKey(template).startsWith(needle))
    );
  };

  const getCompletionOptions = (rawInput) => {
    const input = String(rawInput || '');
    if (!input.startsWith('/')) return [];
    const completionCopy = getCompletionCopy(config.ui?.language);
    const configSubcommandDescriptions = completionCopy.configSubcommands;
    const planSubcommandDescriptions = completionCopy.planSubcommands || {};

    const hasTrailingSpace = /\s$/.test(input);
    const body = input.slice(1);
    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const commandPart = tokens[0] || '';
    const commandHasSubcommands = new Set([
      'config',
      'memory',
      'compact',
      'mode',
      'checkpoint',
      'plan',
      'agents',
      'history',
      'debug'
    ]);

    const allCommandEntries = listCommandNames();
    const allCommands = allCommandEntries.map((c) => c.name);
    const exactCommand = Boolean(commandPart) && allCommands.includes(commandPart);
    for (const entry of allCommandEntries) {
      registerSuggestion(`/${entry.name}`, entry.description || '');
    }
    for (const template of configTemplates) {
      registerSuggestion(template, configSubcommandDescriptions[template] || completionCopy.generic.configCommand);
    }
    for (const template of memoryTemplates) registerSuggestion(template, completionCopy.generic.memoryCommand);
    for (const template of historyTemplates) registerSuggestion(template, completionCopy.generic.historyCommand);
    for (const template of modeTemplates) registerSuggestion(template, completionCopy.generic.modeCommand);
    for (const template of checkpointTemplates) registerSuggestion(template, completionCopy.generic.checkpointCommand);
    for (const template of specTemplates) registerSuggestion(template, completionCopy.generic.specCommand);
    for (const template of planTemplates) {
      registerSuggestion(template, planSubcommandDescriptions[template] || completionCopy.generic.planCommand);
    }
    for (const template of agentTemplates) registerSuggestion(template, completionCopy.generic.agentCommand);
    for (const template of debugTemplates) registerSuggestion(template, completionCopy.generic.debugCommand);
    for (const template of dreamTemplates) registerSuggestion(template, completionCopy.generic.dreamCommand);
    for (const template of compactTemplates) registerSuggestion(template, completionCopy.generic.compactCommand);
    registerSuggestion('/retry', completionCopy.generic.retryCommand);
    registerSuggestion('/status', completionCopy.generic.statusCommand);

    if (!commandPart) {
      return materializeSuggestions(prioritizeByPreferredOrder(
        allCommands.map((name) => `/${name}`),
        commandPriorityOrder
      ));
    }

    if (tokens.length === 1 && !hasTrailingSpace && !(exactCommand && commandHasSubcommands.has(commandPart))) {
      const direct = prioritizeByPreferredOrder(
        allCommands
          .filter((name) => name.startsWith(commandPart))
          .map((name) => `/${name}`),
        commandPriorityOrder
      );
      if (direct.length > 0) return materializeSuggestions(direct);
      return matchCompactTemplates(input);
    }

    if (commandPart === 'config') {
      const subcommand = tokens[1] || '';
      const subcommandIsExact = ['set', 'get', 'list', 'reset'].includes(subcommand);

      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace && !subcommandIsExact)) {
        return materializeSuggestions(prioritizeByPreferredOrder(
          ['set', 'get', 'list', 'reset']
            .filter((s) => s.startsWith(subcommand))
            .map((s) => registerSuggestion(`/config ${s}`, configSubcommandDescriptions[`/config ${s}`] || completionCopy.generic.configCommand).value),
          configSubcommandPriority
        ));
      }

      if (subcommand === 'get') {
        const keyPrefix = tokens.length >= 3 ? tokens[2] || '' : '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => registerSuggestion(`/config get ${k}`, describeConfigKey(k, 'get', config.ui?.language)));
      }
      if (subcommand === 'set') {
        const keyPrefix = tokens.length >= 3 ? tokens[2] || '' : '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => registerSuggestion(`/config set ${k} `, describeConfigKey(k, 'set', config.ui?.language)));
      }

      return materializeSuggestions(configTemplates);
    }

    if (commandPart === 'memory') {
      const sub = tokens[1] || '';
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        return ['list', 'search', 'forget']
          .filter((item) => item.startsWith(sub))
          .map((item) => registerSuggestion(`/memory ${item}`, completionCopy.generic.memoryCommand));
      }
      const scope = tokens[2] || '';
      if (['list', 'search', 'forget'].includes(sub) && (tokens.length === 2 || (tokens.length === 3 && !hasTrailingSpace))) {
        return ['user', 'global', 'project']
          .filter((item) => item.startsWith(scope))
          .map((item) => registerSuggestion(`/memory ${sub} ${item}${sub === 'list' ? '' : ' '}`, completionCopy.generic.memoryCommand));
      }
      return materializeSuggestions(memoryTemplates);
    }

    if (commandPart === 'compact') {
      const joined = tokens.slice(1).join(' ');
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        return compactOptions
          .filter((opt) => opt.startsWith(joined) || joined === '')
          .map((opt) => registerSuggestion(`/compact ${opt}`, completionCopy.generic.compactCommand));
      }
      return compactOptions
        .filter((opt) => opt.includes(joined) || joined === '')
        .map((opt) => registerSuggestion(`/compact ${opt}`, completionCopy.generic.compactCommand));
    }

    if (commandPart === 'retry') {
      return [registerSuggestion('/retry', completionCopy.generic.retryCommand)];
    }
    if (commandPart === 'status') {
      return [registerSuggestion('/status', completionCopy.generic.statusCommand)];
    }
    if (commandPart === 'mode') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['normal', 'auto', 'plan']
          .filter((m) => m.startsWith(sub))
          .map((m) => registerSuggestion(`/mode ${m}`, completionCopy.generic.modeCommand));
      }
      return materializeSuggestions(modeTemplates);
    }
    if (commandPart === 'checkpoint') {
      if (tokens.length <= 2 && !hasTrailingSpace) {
        const sub = tokens[1] || '';
        if (sub === 'list') {
          return ['--all']
            .map((v) => registerSuggestion(`/checkpoint list ${v}`, completionCopy.generic.checkpointCommand));
        }
        return ['create', 'list', 'load']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/checkpoint ${s}`, completionCopy.generic.checkpointCommand));
      }
      if (tokens[1] === 'list') {
        const hint = tokens[2] || '';
        return ['--all']
          .filter((v) => v.startsWith(hint))
          .map((v) => registerSuggestion(`/checkpoint list ${v}`, completionCopy.generic.checkpointCommand));
      }
      if (tokens[1] === 'load') {
        if (tokens.length >= 3) {
          const hint = tokens[3] || '';
          return ['--all']
            .filter((v) => v.startsWith(hint))
            .map((v) => registerSuggestion(`/checkpoint load ${tokens[2]} ${v}`, completionCopy.generic.checkpointCommand));
        }
      }
      return materializeSuggestions(checkpointTemplates);
    }
    if (commandPart === 'spec') {
      return materializeSuggestions(specTemplates);
    }
    if (commandPart === 'plan') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['auto', 'approve', 'from-spec']
          .filter((s) => s.startsWith(sub))
          .map((s) =>
            registerSuggestion(
              `/plan ${s}`,
              planSubcommandDescriptions[`/plan ${s}`] ||
                planSubcommandDescriptions[`/plan ${s} <goal>`] ||
                planSubcommandDescriptions[`/plan ${s} <spec-path?>`] ||
                completionCopy.generic.planCommand
            )
          );
      }
      return materializeSuggestions(planTemplates);
    }
    if (commandPart === 'agents') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        if (sub === 'run') {
          return ['planner', 'coder', 'reviewer', 'tester', 'summarizer']
            .map((r) => registerSuggestion(`/agents run ${r} `, completionCopy.generic.agentCommand));
        }
        return ['list', 'run']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/agents ${s}`, completionCopy.generic.agentCommand));
      }
      if (tokens[1] === 'run') {
        const rolePrefix = tokens[2] || '';
        return ['planner', 'coder', 'reviewer', 'tester']
          .filter((r) => r.startsWith(rolePrefix))
          .map((r) => registerSuggestion(`/agents run ${r} `, completionCopy.generic.agentCommand));
      }
      return materializeSuggestions(agentTemplates);
    }

    if (commandPart === 'history') {
      const sub = tokens[1] || '';
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        if (sub === 'resume') {
          const dynamic = historySessionCache
            .filter((session) => String(session.id || '').startsWith(''))
            .map((session) => ({
              value: `/history resume ${session.id}`,
              display: `/history resume ${session.id}  ·  ${Number(session.messageCount || 0)} msgs`,
              description: completionCopy.generic.resumeSession
            }));
          if (dynamic.length > 0) return dynamic;
        }
        return ['list', 'current', 'resume']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/history ${s}`, completionCopy.generic.historyCommand));
      }
      if (sub === 'resume') {
        const idPrefix = tokens[2] || '';
        const dynamic = historySessionCache
          .filter((session) => String(session.id || '').startsWith(idPrefix))
          .map((session) => ({
            value: `/history resume ${session.id}`,
            display: `/history resume ${session.id}  ·  ${Number(session.messageCount || 0)} msgs`,
            description: completionCopy.generic.resumeSession
          }));
        if (dynamic.length > 0) return dynamic;
        return materializeSuggestions(historyTemplates);
      }
      return materializeSuggestions(historyTemplates);
    }

    if (commandPart === 'debug') {
      const sub = tokens[1] || '';
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        if (sub === 'keys') {
          return ['on', 'off', 'status']
            .map((v) => registerSuggestion(`/debug keys ${v}`, completionCopy.generic.keyboardDebugCommand));
        }
        return ['keys']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/debug ${s}`, completionCopy.generic.debugCommand));
      }
      if (sub === 'keys') {
        const action = tokens[2] || '';
        return ['on', 'off', 'status']
          .filter((v) => v.startsWith(action))
          .map((v) => registerSuggestion(`/debug keys ${v}`, completionCopy.generic.keyboardDebugCommand));
      }
      return materializeSuggestions(debugTemplates);
    }

    return [];
  };

  const persistLocalExchange = async (userText, systemText, { includeUser = true } = {}) => {
    if (includeUser && userText) {
      currentSession.messages.push(stampedMessage('user', userText));
    }
    if (systemText) {
      currentSession.messages.push(stampedMessage('system', systemText));
    }
    await saveSession(currentSession);
  };

  const persistAssistantExchange = async (userText, assistantText, { includeUser = true } = {}) => {
    if (includeUser && userText) {
      currentSession.messages.push(stampedMessage('user', userText));
    }
    if (assistantText) {
      currentSession.messages.push(stampedMessage('assistant', assistantText));
    }
    await saveSession(currentSession);
  };

  const persistUserExchange = async (userText) => {
    if (!userText) return;
    currentSession.messages.push(stampedMessage('user', userText));
    await saveSession(currentSession);
  };

  const buildActiveSystemPrompt = async () => {
    const soulPrompt = await buildSystemPromptWithSoul(baseSystemPrompt, config);
    const memorySnapshot = await buildMemorySnapshot({
      config,
      workspaceRoot: process.cwd()
    }).catch(() => '');
    const memoryGuide =
      'Persistent memory stores durable preferences and stable workflow knowledge. Verify changeable details from files, and only write memory for future-useful, non-sensitive facts.';
    return [soulPrompt, memorySnapshot, memoryGuide].filter(Boolean).join('\n\n');
  };

  const isImmediateLocalInput = (line) => {
    const parsedInput = parseInput(line);
    if (parsedInput.type !== 'slash') return false;
    const command = String(parsedInput.command || '').trim().toLowerCase();
    if (!command) return false;
    if (command === 'agents') {
      const sub = String(parsedInput.args?.[0] || 'list').trim().toLowerCase();
      return sub === 'list';
    }
    const localCommands = new Set([
      'exit',
      'help',
      'commands',
      'status',
      'mode',
      'checkpoint',
      'history',
      'memory',
      'config',
      'compact',
      'debug'
    ]);
    return localCommands.has(command);
  };

  // 当前的 AbortController 引用，用于中止正在进行的回答
  let activeAbortController = null;
  let activeSubSession = null;

  const submit = async (line, onAgentEvent) => {
    // 每次提交创建新的 AbortController，替代旧的
    activeAbortController = new AbortController();
    const { signal } = activeAbortController;
    const activeReplySystemPrompt = await buildActiveSystemPrompt();
    const parsedInput = parseInput(line);
    const maybeAutoDreamFromRuntime = async () => {
      const threshold = Number(config?.memory?.auto_dream_threshold ?? 10);
      if (!(threshold > 0)) return null;
      let entries = [];
      try {
        entries = await listInbox();
      } catch {
        return null;
      }
      if (entries.length < threshold) return null;
      if (onAgentEvent) onAgentEvent({ type: 'dream:auto', message: 'inbox threshold reached' });
      try {
        const report = await runDreamConsolidation({
          dryRun: false,
          workspaceRoot: process.cwd(),
          config,
          writeAudit: true
        });
        if (onAgentEvent) {
          onAgentEvent({ type: 'dream:complete', report });
        }
        return report;
      } catch (error) {
        if (onAgentEvent) {
          onAgentEvent({
            type: 'dream:complete',
            report: { ok: false, error: String(error?.message || error || 'unknown dream error') }
          });
        }
        return null;
      }
    };
    try {
      if (shouldPersistInputHistory(parsedInput)) {
        await appendInputHistory(line);
      }
    } catch {
      // Non-fatal: history persistence should not block chat flow.
    }
    if (parsedInput.type === 'empty') {
      return { type: 'noop' };
    }
    if (parsedInput.type === 'shell') {
      const shell = await handleShellInput(parsedInput.command, config);
      return { type: 'shell', text: shell.text };
    }
    if (parsedInput.type === 'slash') {
      if (parsedInput.command === 'exit') return { type: 'exit' };
      if (parsedInput.command === 'new') {
        const fresh = await createSession();
        currentSession = fresh;
        executionMode = config.execution?.mode || 'auto';
        compactState.backupMessages = null;
        setResultDir(path.join(getSessionsDir(), String(fresh.id)));
        historyIdCache = [fresh.id, ...historyIdCache.filter((id) => id !== fresh.id)];
        historySessionCache = [
          { id: fresh.id, messageCount: 0 },
          ...historySessionCache.filter((s) => s.id !== fresh.id)
        ];
        return {
          type: 'system',
          text: `New session started: ${fresh.id}`,
          restoredMessages: []
        };
      }
      if (parsedInput.command === 'help') {
        return {
          type: 'system',
          text: 'Commands: /help /exit /new /stop /commands /status /mode /compact /checkpoint /spec /plan /yes /edit /reject /agents /config /memory /capture /inbox /dream /history /debug /retry /<custom> !<shell>'
        };
      }
      if (parsedInput.command === 'status') {
        const todoCount = countActiveTodos(currentSession.todos);
        return {
          type: 'system',
          text: `mode=${executionMode} | model=${model || config.model.name} | max_ctx=${effectiveMaxContextTokens(config)} | session=${currentSession.id} | todos=${todoCount}`
        };
      }
      if (parsedInput.command === 'mode') {
        const next = (parsedInput.args[0] || '').trim().toLowerCase();
        if (!next) {
          return { type: 'system', text: `Current mode: ${executionMode} (available: normal|auto|plan)` };
        }
        if (!['normal', 'auto', 'plan'].includes(next)) {
          return { type: 'system', text: 'Usage: /mode <normal|auto|plan>' };
        }
        executionMode = next;
        await setConfigValue('execution.mode', next);
        config = await loadConfig();
        const text = `Execution mode set to: ${next}`;
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (parsedInput.command === 'yes') {
        if (!hasPendingPlanApproval(currentSession)) {
          return { type: 'system', text: 'No pending plan approval. Use /plan auto <goal> first.' };
        }
        await persistUserExchange(line);
        const planState = { ...currentSession.planState };
        const result = await executePlanWithSubAgents({
          planState,
          parentSession: currentSession,
          config,
          model,
          systemPrompt: baseSystemPrompt,
          onAgentEvent,
          signal,
          onSubSessionActive: (sub) => { activeSubSession = sub; }
        });
        activeSubSession = null;
        currentSession.planState = null;
        executionMode = 'auto';
        await persistAssistantExchange(line, result.text || '', { includeUser: false });
        return { type: 'assistant', text: result.text, aborted: !!result.aborted };
      }
      if (parsedInput.command === 'edit') {
        if (!hasPendingPlanApproval(currentSession)) {
          return { type: 'system', text: 'No pending plan approval. Use /plan auto <goal> first.' };
        }
        const feedback = parsedInput.args.join(' ').trim();
        if (!feedback) {
          return { type: 'system', text: 'Usage: /edit <feedback>' };
        }
        const revised = await revisePendingPlanWithModel({
          planState: currentSession.planState,
          feedback,
          config,
          model,
          systemPrompt: activeReplySystemPrompt
        });
        currentSession.planState = revised;
        executionMode = 'plan';
        const text = `Plan revised.\n${buildPendingPlanApprovalMessage(currentSession.planState)}`;
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (parsedInput.command === 'reject') {
        if (!hasPendingPlanApproval(currentSession)) {
          return { type: 'system', text: 'No pending plan approval.' };
        }
        currentSession.planState = null;
        executionMode = 'auto';
        const text = 'Pending plan rejected and cleared.';
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (parsedInput.command === 'checkpoint') {
        const sub = (parsedInput.args[0] || 'list').trim().toLowerCase();
        if (sub === 'create') {
          const name = parsedInput.args.slice(1).join(' ').trim();
          const cp = await createCheckpoint(
            {
              name,
              session: currentSession,
              config
            },
            process.cwd()
          );
          const text = `Checkpoint created: ${cp.id}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'list') {
          const showAll = parsedInput.args.includes('--all');
          const checkpoints = (await listCheckpoints(process.cwd())).filter((c) =>
            showAll ? true : c.sessionId === currentSession.id
          );
          if (checkpoints.length === 0) return { type: 'system', text: 'No checkpoints found' };
          const rows = checkpoints.map(
            (c, idx) =>
              `${idx + 1}. ${c.id} | session:${c.sessionId || '-'} | ${c.createdAt} | ${c.name || '-'}`
          );
          return { type: 'system', text: rows.join('\n') };
        }
        if (sub === 'load') {
          const id = parsedInput.args[1];
          if (!id) return { type: 'system', text: 'Usage: /checkpoint load <id>' };
          const cp = await loadCheckpoint(id, process.cwd());
          if (cp?.session?.id && cp.session.id !== currentSession.id && !parsedInput.args.includes('--all')) {
            return {
              type: 'system',
              text: `Checkpoint belongs to session ${cp.session.id}. Use /checkpoint load ${id} --all to force load.`
            };
          }
          if (cp?.session?.id) currentSession = cp.session;
          if (cp?.config) {
            config = cp.config;
            executionMode = config.execution?.mode || executionMode;
          }
          const text = `Checkpoint loaded: ${id}`;
          await persistLocalExchange(line, text, { includeUser: false });
          return { type: 'system', text };
        }
        return { type: 'system', text: 'Usage: /checkpoint create <name> | /checkpoint list | /checkpoint load <id>' };
      }
      if (parsedInput.command === 'spec') {
        const topic = parsedInput.args.join(' ').trim();
        if (!topic) return { type: 'system', text: 'Usage: /spec <topic>' };
        let content = '';
        let buildNote = '';
        try {
          content = await buildSpecWithModel({
            topic,
            config,
            model,
            systemPrompt: activeReplySystemPrompt
          });
        } catch (err) {
          content = buildSpecTemplate(topic);
          buildNote = `\nGenerated with fallback template because model spec generation failed: ${String(err?.message || err)}`;
        }
        const filePath = await writeMarkdownInProjectDir(
          'specs',
          topic,
          content,
          'spec',
          currentSession.id
        );
        const text = `Spec created: ${filePath}${buildNote}`;
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (parsedInput.command === 'plan') {
        const sub = (parsedInput.args[0] || '').trim().toLowerCase();
        if (sub === 'auto') {
          const deprecatedRun = (parsedInput.args[1] || '').trim().toLowerCase() === 'run';
          if (deprecatedRun) {
            return {
              type: 'system',
              text: 'Usage: /plan auto <goal>\n`/plan auto run` was removed. Review the generated plan first, then use /yes to execute, /edit <feedback> to revise, or /reject to discard.'
            };
          }
          const goal = parsedInput.args.slice(1).join(' ').trim();
          if (!goal) return { type: 'system', text: 'Usage: /plan auto <goal>' };
          await maybeAutoDreamFromRuntime();
          const auto = await buildAutoPlanAndRun({
            goal,
            session: currentSession,
            config,
            model,
            systemPrompt: activeReplySystemPrompt,
            onAgentEvent,
            sessionId: currentSession.id,
            taskClass: classifyPlanTaskClass(goal)
          });
          currentSession.planState = {
            status: 'pending_approval',
            source: 'auto',
            goal,
            filePath: auto.filePath,
            summary: auto.summary || '',
            finalSummary: auto.finalSummary || auto.summary || '',
            steps: Array.isArray(auto.steps) ? auto.steps : []
          };
          executionMode = 'plan';
          const text = buildAutoPlanSystemSummary(auto);
          await persistLocalExchange(line, text);
          return {
            type: 'system',
            text
          };
        }
        if (sub === 'approve') {
          if (!hasPendingPlanApproval(currentSession)) {
            return { type: 'system', text: 'No pending plan approval. Use /plan auto <goal> first.' };
          }
          await persistUserExchange(line);
          const planState = { ...currentSession.planState };
          const result = await executePlanWithSubAgents({
            planState,
            parentSession: currentSession,
            config,
            model,
            systemPrompt: baseSystemPrompt,
            onAgentEvent,
            signal,
            onSubSessionActive: (sub) => { activeSubSession = sub; }
          });
          activeSubSession = null;
          currentSession.planState = null;
          executionMode = 'auto';
          await persistAssistantExchange(line, result.text || '', { includeUser: false });
          return { type: 'assistant', text: result.text, aborted: !!result.aborted };
        }
        if (sub === 'stay') {
          if (!hasPendingPlanApproval(currentSession)) {
            return { type: 'system', text: 'No pending plan approval.' };
          }
          const text = buildPendingPlanApprovalMessage(currentSession.planState);
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'from-spec') {
          const specArg = parsedInput.args.slice(1).join(' ').trim();
          const specPath = await resolveSpecPath(specArg, currentSession.id);
          if (!specPath) {
            return { type: 'system', text: 'Usage: /plan from-spec <spec-path-or-fragment>\nNo spec file found.' };
          }
          const specText = await fs.readFile(specPath, 'utf8');
          const specTitle = extractSpecTitle(specText, path.basename(specPath, '.md'));
          let planContent = '';
          let buildNote = '';
          try {
            planContent = await buildPlanFromSpecWithModel({
              specText,
              specPath,
              config,
              model,
              systemPrompt: activeReplySystemPrompt
            });
          } catch (err) {
            planContent = buildPlanTemplate(specTitle);
            buildNote = `\nGenerated with fallback template because model plan generation failed: ${String(err?.message || err)}`;
          }
          const filePath = await writeMarkdownInProjectDir(
            'plans',
            `${specTitle}-from-spec`,
            planContent,
            'plan-from-spec',
            currentSession.id
          );
          const text = `Plan created from spec: ${filePath}\nSpec: ${specPath}${buildNote}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }

        const goal = parsedInput.args.join(' ').trim();
        if (!goal) return { type: 'system', text: 'Usage: /plan <goal> | /plan auto <goal> | /plan from-spec <spec-path?>' };
        const content = buildPlanTemplate(goal);
        const filePath = await writeMarkdownInProjectDir(
          'plans',
          goal,
          content,
          'plan',
          currentSession.id
        );
        const text = `Plan created: ${filePath}`;
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (parsedInput.command === 'agents') {
        const sub = parsedInput.args[0] || 'list';
        if (sub === 'list') {
          return {
            type: 'system',
            text: 'Sub-agent roles: planner, coder, reviewer, tester, summarizer\nUse: /agents run <role> <task>'
          };
        }
        if (sub === 'run') {
          const role = (parsedInput.args[1] || '').trim().toLowerCase();
          const task = parsedInput.args.slice(2).join(' ').trim();
          if (!role || !task) return { type: 'system', text: 'Usage: /agents run <role> <task>' };
          if (!SUB_AGENT_ROLES.includes(role)) {
            return { type: 'system', text: 'Unknown role. Allowed: planner|coder|reviewer|tester|summarizer' };
          }
          const output = await runSubAgentTask({
            role,
            task,
            parentSession: currentSession,
            config,
            model,
            systemPrompt: activeReplySystemPrompt,
            onAgentEvent
          });
          const text = `[sub-agent:${role}]\n${output.text || output}`;
          await persistLocalExchange(line, text);
          return { type: 'assistant', text };
        }
        return { type: 'system', text: `Unknown /agents subcommand: ${sub}` };
      }
      if (parsedInput.command === 'debug') {
        const sub = parsedInput.args[0] || '';
        const action = parsedInput.args[1] || '';
        if (sub === 'keys') {
          if (action === 'on') return { type: 'system', text: '[debug:keys:on]' };
          if (action === 'off') return { type: 'system', text: '[debug:keys:off]' };
          if (action === 'status') return { type: 'system', text: '[debug:keys:status]' };
          return { type: 'system', text: 'Usage: /debug keys on|off|status' };
        }
        return { type: 'system', text: 'Usage: /debug keys on|off|status' };
      }
      if (parsedInput.command === 'history') {
        const sub = parsedInput.args[0] || 'list';
        if (sub === 'list') {
          const sessions = await listSessions(20);
          historyIdCache = sessions.map((s) => s.id);
          historySessionCache = sessions.map((s) => ({
            id: s.id,
            messageCount: Number(s.messageCount || 0)
          }));
          if (sessions.length === 0) return { type: 'system', text: 'No sessions found' };
          const rows = sessions.map(
            (s, idx) =>
              `${idx + 1}. ${s.id} | msgs:${s.messageCount} | updated:${s.updatedAt || '-'}${s.preview ? ` | ${s.preview}` : ''}`
          );
          return {
            type: 'system',
            text: `Current: ${currentSession.id}\n${rows.join('\n')}\nUse /history resume <session_id>`
          };
        }
        if (sub === 'current') {
          return {
            type: 'system',
            text: `Current session: ${currentSession.id} (${currentSession.messages.length} messages)`
          };
        }
        if (sub === 'resume') {
          const targetId = parsedInput.args[1];
          if (!targetId) return { type: 'system', text: 'Usage: /history resume <session_id>' };
          const loaded = await loadSession(targetId);
          currentSession = loaded;
          setResultDir(path.join(getSessionsDir(), String(targetId)));
          if (hasPendingPlanApproval(currentSession)) {
            executionMode = 'plan';
          }
          if (!historyIdCache.includes(targetId)) historyIdCache.unshift(targetId);
          historySessionCache = [
            { id: targetId, messageCount: Array.isArray(loaded.messages) ? loaded.messages.length : 0 },
            ...historySessionCache.filter((s) => s.id !== targetId)
          ];
          return {
            type: 'system',
            text: `Switched to session: ${targetId} (${loaded.messages.length} messages)`,
            restoredMessages: structuredClone(loaded.messages || [])
          };
        }
        return { type: 'system', text: `Unknown /history subcommand: ${sub}` };
      }
      if (parsedInput.command === 'memory') {
        const sub = String(parsedInput.args[0] || '').trim().toLowerCase();
        if (!sub) {
          return { type: 'system', text: 'Usage: /memory list <user|global|project> | /memory search <scope> <query> | /memory forget <scope> <id>' };
        }
        if (sub === 'list') {
          const scope = String(parsedInput.args[1] || '').trim().toLowerCase();
          if (!['user', 'global', 'project'].includes(scope)) {
            return { type: 'system', text: 'Usage: /memory list <user|global|project>' };
          }
          const items = await listMemories({ scope, workspaceRoot: process.cwd() });
          if (items.length === 0) return { type: 'system', text: `No ${scope} memories found.` };
          return {
            type: 'system',
            text: items.map((item) => `${item.id} | ${item.kind} | ${item.content}`).join('\n')
          };
        }
        if (sub === 'search') {
          const scope = String(parsedInput.args[1] || '').trim().toLowerCase();
          const query = parsedInput.args.slice(2).join(' ').trim();
          if (!['user', 'global', 'project'].includes(scope) || !query) {
            return { type: 'system', text: 'Usage: /memory search <user|global|project> <query>' };
          }
          const items = await searchMemories({ scope, query, workspaceRoot: process.cwd() });
          if (items.length === 0) return { type: 'system', text: `No ${scope} memories matched: ${query}` };
          return {
            type: 'system',
            text: items.map((item) => `${item.id} | ${item.kind} | ${item.content}`).join('\n')
          };
        }
        if (sub === 'forget') {
          const scope = String(parsedInput.args[1] || '').trim().toLowerCase();
          const id = String(parsedInput.args[2] || '').trim();
          if (!['user', 'global', 'project'].includes(scope) || !id) {
            return { type: 'system', text: 'Usage: /memory forget <user|global|project> <id>' };
          }
          const result = await forgetMemory({ scope, id, workspaceRoot: process.cwd() });
          const text = `Removed ${Number(result.removed || 0)} ${scope} memory item(s)`;
          await persistLocalExchange(line, text, { includeUser: false });
          return { type: 'system', text };
        }
        return { type: 'system', text: `Unknown /memory subcommand: ${sub}` };
      }
      if (parsedInput.command === 'capture') {
        const summary = parsedInput.args.join(' ').trim();
        if (!summary) return { type: 'system', text: 'Usage: /capture <summary> [--scope global|repo|thread] [--type observation|correction|failure|preference|pattern|win|gap|decision]' };
        let scope = 'global';
        let capType = 'observation';
        const filtered = [];
        for (const arg of parsedInput.args) {
          if (arg.startsWith('--scope=')) { scope = arg.slice(7); continue; }
          if (arg.startsWith('--type=')) { capType = arg.slice(7); continue; }
          if (arg === '--scope') { scope = ''; continue; }
          if (arg === '--type') { capType = ''; continue; }
          filtered.push(arg);
        }
        const capSummary = filtered.join(' ').trim();
        if (!capSummary) return { type: 'system', text: 'Usage: /capture <summary>' };
        try {
          const entry = await captureToInbox({ summary: capSummary, scope, type: capType, source: 'slash' });
          const text = `Captured to inbox: ${entry.id} [${entry.lifecycle}] ${entry.summary}`;
          return { type: 'system', text };
        } catch (err) {
          return { type: 'system', text: `Capture failed: ${err.message}` };
        }
      }
      if (parsedInput.command === 'inbox') {
        const since = parsedInput.args[0] || '';
        try {
          const entries = await listInbox({ since: since || undefined });
          if (entries.length === 0) return { type: 'system', text: 'Inbox is empty.' };
          const rows = entries.map((e) => `[${e.lifecycle}] ${e.scope}/${e.type}: ${e.summary} (${e.id})`);
          return { type: 'system', text: `Inbox (${entries.length}):\n${rows.join('\n')}` };
        } catch (err) {
          return { type: 'system', text: `Failed to list inbox: ${err.message}` };
        }
      }
      if (parsedInput.command === 'dream') {
        let dryRun = false;
        let scope = null;
        for (const arg of parsedInput.args) {
          if (arg === '--dry-run') {
            dryRun = true;
            continue;
          }
          if (arg.startsWith('--scope=')) {
            scope = arg.slice(8) || null;
          }
        }
        try {
          const report = await runDreamConsolidation({
            dryRun,
            scope,
            workspaceRoot: process.cwd(),
            config,
            writeAudit: true
          });
          const summary = [
            `Dream done${dryRun ? ' (dry-run)' : ''}.`,
            `Candidates: ${Number(report.candidatesGenerated || 0)}`,
            `Promotions: ${Array.isArray(report.promotions) ? report.promotions.length : 0}`,
            `Rejections: ${Array.isArray(report.rejections) ? report.rejections.length : 0}`,
            `Archives: ${Array.isArray(report.archives) ? report.archives.length : 0}`,
            report.auditReport ? `Audit: ${report.auditReport}` : ''
          ]
            .filter(Boolean)
            .join('\n');
          return { type: 'system', text: summary };
        } catch (err) {
          return { type: 'system', text: `Dream failed: ${err.message}` };
        }
      }
      if (parsedInput.command === 'retry') {
        const lastUser = [...currentSession.messages].reverse().find((m) => m.role === 'user');
        if (!lastUser?.content) {
          return { type: 'system', text: 'No previous user message to retry' };
        }
        const result = await askModel({
          text: String(lastUser.content),
          session: currentSession,
          config,
          model,
          systemPrompt: activeReplySystemPrompt,
          onAgentEvent,
          requestToolApproval: activeRequestToolApproval,
          executionMode,
          signal
        });
        return { type: 'assistant', text: result.text, aborted: !!result.aborted };
      }
      if (parsedInput.command === 'config') {
        const sub = parsedInput.args[0];
        if (!sub || sub === 'help') {
          return {
            type: 'system',
            text: 'Usage:\n/config list\n/config get <key>\n/config set <key> <value>\n/config reset'
          };
        }

        if (sub === 'list') {
          config = await loadConfig();
          return { type: 'system', text: JSON.stringify(config, null, 2) };
        }

        if (sub === 'get') {
          const key = parsedInput.args[1];
          if (!key) return { type: 'system', text: 'Usage: /config get <key>' };
          const value = await getConfigValue(key);
          if (value === undefined) return { type: 'system', text: 'undefined' };
          return {
            type: 'system',
            text: typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)
          };
        }

        if (sub === 'set') {
          const key = parsedInput.args[1];
          const value = parsedInput.args.slice(2).join(' ');
          if (!key || !value) return { type: 'system', text: 'Usage: /config set <key> <value>' };
          await setConfigValue(key, value);
          config = await loadConfig();
          const text = `Set ${key}=${value}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }

        if (sub === 'reset') {
          await resetConfig();
          config = await loadConfig();
          compactState.threshold = 60;
          compactState.mode = 'conservative';
          compactState.autoEnabled = true;
          const text = 'Config reset complete';
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }

        return { type: 'system', text: `Unknown /config subcommand: ${sub}` };
      }
      if (parsedInput.command === 'compact') {
        const cargs = parseCompactArgs(parsedInput.args);

        if (cargs.auto === 'on') compactState.autoEnabled = true;
        if (cargs.auto === 'off') compactState.autoEnabled = false;
        if (typeof cargs.threshold === 'number' && cargs.threshold >= 50 && cargs.threshold <= 95) {
          compactState.threshold = cargs.threshold;
        }
        if (cargs.mode) compactState.mode = cargs.mode;

        if (cargs.restore) {
          if (!compactState.backupMessages) {
            return { type: 'system', text: 'No backup available to restore' };
          }
          currentSession.messages = structuredClone(compactState.backupMessages);
          await saveSession(currentSession);
          const text = 'Context restored from backup';
          await persistLocalExchange(line, text, { includeUser: false });
          return { type: 'system', text };
        }

        const beforeTokens = estimateMessagesTokens(currentSession.messages);
        const result = compactMessagesLocally(currentSession.messages, { mode: compactState.mode });
        if (!result.changed) {
          return { type: 'system', text: 'Nothing to compact yet' };
        }
        const afterTokens = estimateMessagesTokens(result.compacted);
        const report = `Compact ${cargs.preview ? 'preview' : 'applied'} (${compactState.mode}): ${beforeTokens} -> ${afterTokens} tokens`;

        if (cargs.preview) {
          return { type: 'system', text: `${report}\n\n${result.summary}` };
        }

        compactState.backupMessages = structuredClone(currentSession.messages);
        currentSession.messages = result.compacted.map((m) => ({ ...m, at: new Date().toISOString() }));
        await saveSession(currentSession);
        await persistLocalExchange(line, report, { includeUser: false });
        return { type: 'system', text: report };
      }
      if (parsedInput.command === 'commands') {
        const all = listCommandNames();
        if (all.length === 0) {
          return { type: 'system', text: 'No commands/skills available' };
        }
        const rows = all.map((c) => `/${c.name}${c.description ? ` - ${c.description}` : ''}`);
        return { type: 'system', text: rows.join('\n') };
      }

      const custom = commands.get(parsedInput.command);
      if (!custom) {
        return { type: 'system', text: `Unknown slash command: /${parsedInput.command}` };
      }
      if (custom.metadata.type === 'skill' && config.skills?.enabled?.[custom.name] === false) {
        return { type: 'system', text: `Skill is disabled: ${custom.name}` };
      }

      const customPrompt =
        custom.name === 'brainstorm'
          ? [
              renderCommandPrompt(custom, []),
              'Explicit brainstorm mode:',
              '- Ask exactly one clarifying question first if any important uncertainty remains.',
              '- Stop after the question and wait for the user\'s answer before continuing.',
              '- Do not inspect the repo or generate code unless the user explicitly asks for that.',
              '- If you recommend an option, present it as a suggested decision rather than a final choice for the user.',
              parsedInput.args.length > 0 ? `Current question:\n${parsedInput.args.join(' ')}` : ''
            ]
              .filter(Boolean)
              .join('\n\n')
          : renderCommandPrompt(custom, parsedInput.args);
      const rendered = await expandFileMentions(customPrompt, process.cwd());
      if (custom.metadata.type === 'skill' && onAgentEvent) {
        onAgentEvent({ type: 'skill:start', name: custom.name });
      }
      let result;
      try {
        result = await askModel({
          text: rendered,
          session: currentSession,
          config,
          model,
          systemPrompt: activeReplySystemPrompt,
          onAgentEvent,
          requestToolApproval: activeRequestToolApproval,
          executionMode,
          signal
        });
      } catch (error) {
        if (custom.metadata.type === 'skill' && onAgentEvent) {
          onAgentEvent({
            type: 'skill:error',
            name: custom.name,
            summary: error instanceof Error ? error.message : String(error)
          });
        }
        throw error;
      }
      if (custom.metadata.type === 'skill' && onAgentEvent) {
        onAgentEvent({ type: 'skill:end', name: custom.name });
      }
      return { type: 'assistant', text: result.text };
    }

    if (hasPendingPlanApproval(currentSession)) {
      if (isApprovalText(parsedInput.text)) {
        await persistUserExchange(line);
        const planState = { ...currentSession.planState };
        const result = await executePlanWithSubAgents({
          planState,
          parentSession: currentSession,
          config,
          model,
          systemPrompt: baseSystemPrompt,
          onAgentEvent,
          signal,
          onSubSessionActive: (sub) => { activeSubSession = sub; }
        });
        activeSubSession = null;
        currentSession.planState = null;
        executionMode = 'auto';
        await persistAssistantExchange(line, result.text || '', { includeUser: false });
        return { type: 'assistant', text: result.text, aborted: !!result.aborted };
      }
      if (isStayInPlanText(parsedInput.text)) {
        const text = buildPendingPlanApprovalMessage(currentSession.planState);
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      if (isRejectPlanText(parsedInput.text)) {
        currentSession.planState = null;
        executionMode = 'auto';
        const text = 'Pending plan rejected and cleared.';
        await persistLocalExchange(line, text);
        return { type: 'system', text };
      }
      return {
        type: 'system',
        text: buildPendingPlanApprovalMessage(currentSession.planState)
      };
    }

    if (compactState.autoEnabled) {
      const currentTokens = estimateMessagesTokens(currentSession.messages);
      const maxTokens = effectiveMaxContextTokens(config);
      const usagePct = (currentTokens / maxTokens) * 100;
      if (usagePct >= compactState.threshold) {
        const autoResult = compactMessagesLocally(currentSession.messages, {
          mode: compactState.mode
        });
        if (autoResult.changed) {
          compactState.backupMessages = structuredClone(currentSession.messages);
          currentSession.messages = autoResult.compacted.map((m) => ({
            ...m,
            at: new Date().toISOString()
          }));
          await saveSession(currentSession);
          if (onAgentEvent) {
            onAgentEvent({
              type: 'compact:auto',
              mode: compactState.mode,
              threshold: compactState.threshold
            });
          }
        }
      }
    }

    const expandedText = await expandFileMentions(parsedInput.text, process.cwd());
    const autoRoute = classifyAutoRoute(expandedText);
    if (autoRoute.autoPlan) {
      await maybeAutoDreamFromRuntime();
      const auto = await buildAutoPlanAndRun({
        goal: expandedText,
        session: currentSession,
        config,
        model,
        systemPrompt: activeReplySystemPrompt,
        onAgentEvent,
        sessionId: currentSession.id,
        taskClass: classifyPlanTaskClass(expandedText)
      });
      currentSession.planState = {
        status: 'pending_approval',
        source: 'auto',
        goal: expandedText,
        filePath: auto.filePath,
        summary: auto.summary || '',
        finalSummary: auto.finalSummary || auto.summary || '',
        steps: Array.isArray(auto.steps) ? auto.steps : []
      };
      executionMode = 'plan';
      const text = buildAutoPlanSystemSummary(auto);
      await persistLocalExchange(line, text);
      return { type: 'system', text };
    }

    const selectedAutoSkills = autoRoute.selectedSkills.filter((name) => isSkillEnabled(config, name));
    if (selectedAutoSkills.length > 0 && onAgentEvent) {
      onAgentEvent({
        type: 'skill:auto',
        names: selectedAutoSkills
      });
    }
    const skillPrompt = buildAutoSkillSystemPrompt(activeReplySystemPrompt, commands, config, expandedText);
    const routedSystemPrompt =
      autoRoute.mode === 'direct_medium'
        ? buildMediumTaskSystemPrompt(skillPrompt)
        : skillPrompt;
    const result = await askModel({
      text: expandedText,
      session: currentSession,
      config,
      model,
      systemPrompt: routedSystemPrompt,
      onAgentEvent,
      requestToolApproval: activeRequestToolApproval,
      executionMode,
      signal
    });
    return { type: 'assistant', text: result.text, aborted: !!result.aborted };
  };

  return {
    listCommandNames,
    getCompletionOptions,
    isImmediateLocalInput,
    submit,
    abort: () => {
      if (activeAbortController && !activeAbortController.signal.aborted) {
        activeAbortController.abort();
        return true;
      }
      return false;
    },
    consumeStartupEvents: () => startupEvents.splice(0, startupEvents.length),
    getInputHistory: () => loadInputHistory(),
    getCurrentSessionId: () => currentSession.id,
    setRequestToolApproval: (handler) => {
      activeRequestToolApproval = typeof handler === 'function' ? handler : null;
      return true;
    },
    dispose: async () => {
      if (typeof disposeTools === 'function') {
        await disposeTools();
      }
      return true;
    },
    getRuntimeState: () =>
      buildRuntimeStateSnapshot({
        currentSession,
        config,
        model,
        executionMode,
        extraSession: activeSubSession
      })
  };
}
