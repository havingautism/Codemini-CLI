import { parseInput } from './input-parser.js';
import { loadCommandsAndSkills, renderCommandPrompt } from './command-loader.js';
import { runAgentLoop } from './agent-loop.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createChatCompletion,
  createChatCompletionStream
} from './provider/openai-compatible.js';
import { isDangerousCommand, runShellCommand } from './shell.js';
import { getBuiltinTools } from './tools.js';
import { listSessions, loadSession, pruneSessions, saveSession } from './session-store.js';
import { getConfigValue, loadConfig, resetConfig, setConfigValue } from './config-store.js';
import { evaluateCommandPolicy } from './command-policy.js';
import { appendInputHistory, loadInputHistory } from './input-history-store.js';
import {
  clearTasks,
  createTasks,
  deleteTasks,
  loadTasks,
  updateTask
} from './task-store.js';
import { createCheckpoint, listCheckpoints, loadCheckpoint } from './checkpoint-store.js';
import {
  compactMessagesLocally,
  estimateMessagesTokens,
  parseCompactArgs
} from './context-compact.js';
import { buildSystemPromptWithSoul } from './soul.js';

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

const SUB_AGENT_ROLES = ['planner', 'coder', 'reviewer'];
const SUB_AGENT_CONTEXT_MAX_MESSAGES = 4;
const SUB_AGENT_CONTEXT_MAX_CHARS = 1200;
const SUB_AGENT_EVIDENCE_MAX_ITEMS = 3;
const AUTO_SKILL_NAMES = ['superpowers-lite', 'brainstorming-lite', 'executing-plan-lite'];

function getSubAgentRolePrompt(role) {
  if (role === 'planner') {
    return 'You are a planning sub-agent. Produce a concrete implementation plan with risks and verification.';
  }
  if (role === 'reviewer') {
    return 'You are a review sub-agent. Focus on bugs, regressions, edge cases, and missing tests.';
  }
  return 'You are an execution sub-agent. Produce practical implementation guidance with code-level detail.';
}

function trimInlineText(value, maxLen = 220) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
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
    const text = trimInlineText(msg.content, 260);
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
  const pathText = trimInlineText(filePath, 160);
  const summaryText = trimInlineText(summary, 200);
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

function isSkillEnabled(config, name) {
  return config.skills?.enabled?.[name] !== false;
}

function selectAutoSkillNames(text = '') {
  const input = String(text || '').toLowerCase();
  const selected = ['superpowers-lite'];
  if (
    /(brainstorm|头脑风暴|方案|思路|设计一下|设计方案|怎么做|如何做|approach|options?)/i.test(input)
  ) {
    selected.push('brainstorming-lite');
  }
  if (
    /(按计划|执行计划|继续执行|下一步|implement|execute|carry out|完成验证|verify|plan)/i.test(input)
  ) {
    selected.push('executing-plan-lite');
  }
  return selected;
}

function buildAutoSkillSystemPrompt(baseSystemPrompt, commands, config, text) {
  const selected = selectAutoSkillNames(text).filter((name) => isSkillEnabled(config, name));
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

  if (cleaned.length === 0) {
    return {
      summary: `Auto plan for: ${goal}`,
      steps: [
        {
          title: 'Initial analysis',
          role: 'planner',
          task: `Break down and propose implementation steps for: ${goal}`
        }
      ]
    };
  }

  return {
    summary: String(parsed?.summary || `Auto plan for: ${goal}`).trim(),
    steps: cleaned.slice(0, 8)
  };
}

async function writeMarkdownInCoderDir(subDir, title, body, fallbackName, sessionId) {
  const parts = [process.cwd(), '.coder', subDir];
  if (sessionId) parts.push(String(sessionId));
  const dir = path.join(...parts);
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
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: `${systemPrompt}\n${prompt}` },
      {
        role: 'user',
        content: `Spec path: ${specPath || '(inline)'}\n\n${specText}`
      }
    ],
    timeoutMs: config.gateway.timeout_ms || 90000,
    maxRetries: config.gateway.max_retries ?? 2
  });
  return String(result.text || '').trim();
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

async function resolveSpecPath(rawArg = '', sessionId = '') {
  const input = String(rawArg || '').trim();
  const roots = [
    path.join(process.cwd(), '.coder', 'specs', String(sessionId || '')),
    path.join(process.cwd(), '.coder', 'specs')
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
  persistSession = true,
  executionMode,
  alwaysAllowTools
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
    }, 400);
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

  if (persistSession && text) {
    session.messages.push(stampedMessage('user', text));
    await saveSession(session);
  }

  const { definitions, handlers } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config,
    sessionId: session.id
  });

  let activeAssistantIndex = -1;
  const wrappedAgentEvent = (event) => {
    if (!persistSession) {
      if (onAgentEvent) onAgentEvent(event);
      return;
    }

    if (event?.type === 'assistant:start') {
      session.messages.push(stampedMessage('assistant', ''));
      activeAssistantIndex = session.messages.length - 1;
      scheduleSessionSave();
    } else if (event?.type === 'assistant:delta') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        current.content = `${current.content || ''}${event.text || ''}`;
        current.at = new Date().toISOString();
        scheduleSessionSave();
      }
    } else if (event?.type === 'assistant:response') {
      if (activeAssistantIndex >= 0 && session.messages[activeAssistantIndex]) {
        const current = session.messages[activeAssistantIndex];
        current.content = event.assistantMessage?.content ?? event.text ?? current.content;
        if (Array.isArray(event.assistantMessage?.tool_calls) && event.assistantMessage.tool_calls.length > 0) {
          current.tool_calls = event.assistantMessage.tool_calls;
        }
        current.at = new Date().toISOString();
        scheduleSessionSave();
      }
      activeAssistantIndex = -1;
    } else if (event?.type === 'tool:result') {
      session.messages.push(
        stampedMessage('tool', event.content || '', {
          tool_call_id: event.id || ''
        })
      );
      scheduleSessionSave();
    }

    if (onAgentEvent) onAgentEvent(event);
  };

  const loopUserPrompt = persistSession ? '' : text;
  const loopResult = await runAgentLoop({
    systemPrompt,
    userPrompt: loopUserPrompt,
    model: model || config.model.name,
    maxSteps: Number(config.execution?.max_steps || 16),
    toolDefinitions: definitions,
    toolHandlers: handlers,
    initialMessages: toOpenAIMessages(session.messages),
    onEvent: wrappedAgentEvent,
    executionMode: executionMode || config.execution?.mode || 'auto',
    alwaysAllowTools:
      alwaysAllowTools || config.execution?.always_allow_tools || ['run_command', 'read_file', 'write_file'],
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    requestCompletion: async ({ messages, tools, model: selectedModel }) => {
      if (onAgentEvent) onAgentEvent({ type: 'assistant:start' });
      return createChatCompletionStream({
        baseUrl: config.gateway.base_url,
        apiKey: config.gateway.api_key,
        model: selectedModel,
        messages,
        tools,
        timeoutMs: config.gateway.timeout_ms || 90000,
        maxRetries: config.gateway.max_retries ?? 2,
        onTextDelta: (delta) => {
          if (onAgentEvent) onAgentEvent({ type: 'assistant:delta', text: delta });
        }
      });
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
  return { text: loopResult.text };
}

async function runSubAgentTask({
  role,
  task,
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent
}) {
  const subSession = { id: `sub-${Date.now()}`, messages: [] };
  const rolePrompt = getSubAgentRolePrompt(role);
  const contextPacket = buildSubAgentContextPacket(parentSession);
  const evidencePacket = buildSubAgentEvidencePacket(parentSession);
  const scopedTask = [contextPacket, evidencePacket, 'Task:', task].filter(Boolean).join('\n\n');
  let blockedCount = 0;
  let toolErrorCount = 0;
  const wrappedOnAgentEvent = (evt) => {
    if (evt?.type === 'tool:blocked') blockedCount += 1;
    if (evt?.type === 'tool:error') toolErrorCount += 1;
    if (onAgentEvent) onAgentEvent(evt);
  };
  const subResult = await askModel({
    text: scopedTask,
    session: subSession,
    config,
    model,
    systemPrompt: `${systemPrompt}\n${rolePrompt}`,
    onAgentEvent: wrappedOnAgentEvent,
    persistSession: false,
    executionMode: 'auto'
  });
  const text = subResult.text || '';
  const hasErrorLine = /(^|\n)\s*error\s*:/i.test(text);
  return {
    text,
    blockedCount,
    toolErrorCount,
    hasErrorLine
  };
}

async function buildAutoPlanAndRun({
  goal,
  session,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  sessionId
}) {
  const plannerPrompt =
    'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|coder|reviewer","task":"..."}]}. No markdown.';
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
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        { role: 'system', content: `${systemPrompt}\n${plannerPrompt}` },
        {
          role: 'user',
          content: `Create an execution plan and assign best sub-agent role for each step.\nGoal: ${goal}`
        }
      ],
      timeoutMs: config.gateway.timeout_ms || 90000,
      maxRetries: config.gateway.max_retries ?? 2
    });
    const parsed = extractJsonBlock(planning.text || '');
    autoPlan = normalizeAutoPlan(parsed, goal);
  } catch (err) {
    planningError = String(err?.message || err || 'planning failed');
  }

  const runItems = [];
  for (let i = 0; i < autoPlan.steps.length; i += 1) {
    const step = autoPlan.steps[i];
    if (onAgentEvent) {
      onAgentEvent({
        type: 'assistant:delta',
        text: `\n[plan] Step ${i + 1}/${autoPlan.steps.length} -> ${step.role}: ${step.title}\n`
      });
    }
    try {
      const stepResult = await runSubAgentTask({
        role: step.role,
        task: step.task,
        parentSession: session,
        config,
        model,
        systemPrompt,
        onAgentEvent
      });
      const failed =
        stepResult.blockedCount > 0 || stepResult.toolErrorCount > 0 || stepResult.hasErrorLine;
      let error = '';
      if (stepResult.blockedCount > 0) {
        error = `sub-agent had ${stepResult.blockedCount} blocked tool call(s)`;
      } else if (stepResult.toolErrorCount > 0) {
        error = `sub-agent had ${stepResult.toolErrorCount} tool error(s)`;
      } else if (stepResult.hasErrorLine) {
        error = 'sub-agent output contains error line(s)';
      }
      runItems.push({ ...step, output: stepResult.text, error, failed });
    } catch (err) {
      runItems.push({
        ...step,
        output: '',
        error: String(err?.message || err || 'sub-agent step failed'),
        failed: true
      });
    }
  }

  const failedItems = runItems.filter((s) => s.failed || s.error);

  const lines = [];
  lines.push(`# Auto Plan: ${goal}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(autoPlan.summary || `Auto plan for: ${goal}`);
  if (planningError) {
    lines.push('');
    lines.push(`Planning Error: ${planningError}`);
  }
  lines.push('');
  lines.push('## Steps');
  autoPlan.steps.forEach((s, idx) => {
    lines.push(`${idx + 1}. [${s.role}] ${s.title}`);
    lines.push(`   - task: ${s.task}`);
  });
  lines.push('');
  lines.push('## Sub-Agent Outputs');
  runItems.forEach((s, idx) => {
    lines.push(`### ${idx + 1}. [${s.role}] ${s.title}`);
    if (s.error) {
      lines.push(`Error: ${s.error}`);
      if (s.output) {
        lines.push('');
        lines.push(s.output);
      }
      lines.push('');
      return;
    }
    lines.push(s.output || '(empty)');
    lines.push('');
  });

  const filePath = await writeMarkdownInCoderDir(
    'plans',
    `${goal}-auto`,
    lines.join('\n'),
    'plan-auto',
    sessionId
  );
  return {
    filePath,
    summary: autoPlan.summary,
    steps: autoPlan.steps,
    failedCount: failedItems.length,
    failedTitles: failedItems.map((s) => `${s.role}:${s.title}`)
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
  systemPrompt
}) {
  let currentSession = session;
  let config = initialConfig;
  const baseSystemPrompt = systemPrompt;
  let executionMode = config.execution?.mode || 'auto';
  const commands = await loadCommandsAndSkills();
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

  const configKeyHints = [
    'gateway.base_url',
    'gateway.api_key',
    'gateway.timeout_ms',
    'gateway.max_retries',
    'model.name',
    'model.max_context_tokens',
    'execution.mode',
    'execution.always_allow_tools',
    'execution.max_steps',
    'context.preflight_trigger_pct',
    'context.hard_limit_pct',
    'context.tool_result_max_chars',
    'context.read_file_default_lines',
    'context.read_file_max_chars',
    'sessions.max_sessions',
    'sessions.retention_days',
    'shell.default',
    'shell.timeout_ms',
    'context.max_tokens',
    'policy.safe_mode',
    'policy.allow_dangerous_commands'
  ];

  const listCommandNames = () => {
    const builtins = [
      { name: 'help', description: 'show chat help' },
      { name: 'exit', description: 'exit chat' },
      { name: 'commands', description: 'list slash/custom commands' },
      { name: 'status', description: 'show runtime status (mode/model/session)' },
      { name: 'mode', description: 'set execution mode: normal|auto|plan' },
      { name: 'compact', description: 'compress message context' },
      { name: 'tasks', description: 'task board management' },
      { name: 'checkpoint', description: 'create/list/load conversation checkpoints' },
      { name: 'spec', description: 'create a spec markdown file in .coder/specs' },
      { name: 'plan', description: 'create an implementation plan markdown file in .coder/plans' },
      { name: 'agents', description: 'run/list sub-agent roles' },
      { name: 'config', description: 'set/get/list/reset config values' },
      { name: 'history', description: 'list/resume sessions' },
      { name: 'debug', description: 'runtime debug switches' },
      { name: 'retry', description: 'retry the last user request' }
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
  const modeTemplates = ['/mode normal', '/mode auto', '/mode plan'];
  const taskTemplates = ['/tasks', '/tasks add <title>', '/tasks start <id>', '/tasks done <id>', '/tasks remove <id>', '/tasks clear'];
  const checkpointTemplates = [
    '/checkpoint create <name>',
    '/checkpoint list',
    '/checkpoint list --all',
    '/checkpoint load <id>'
  ];
  const specTemplates = ['/spec <topic>'];
  const planTemplates = ['/plan <goal>', '/plan auto <goal>', '/plan from-spec <spec-path?>'];
  const agentTemplates = ['/agents list', '/agents run planner <task>', '/agents run coder <task>', '/agents run reviewer <task>'];
  const debugTemplates = ['/debug keys on', '/debug keys off', '/debug keys status'];
  const compactTemplates = compactOptions.map((opt) => `/compact ${opt}`);
  const slashTemplates = [
    ...configTemplates,
    ...historyTemplates,
    ...modeTemplates,
    ...taskTemplates,
    ...checkpointTemplates,
    ...specTemplates,
    ...planTemplates,
    ...agentTemplates,
    ...debugTemplates,
    ...compactTemplates,
    '/retry',
    '/status'
  ];
  const compactKey = (value) => String(value || '').toLowerCase().replace(/[\/\s<>?]/g, '');
  const matchCompactTemplates = (value) => {
    const needle = compactKey(value);
    if (!needle) return [];
    return slashTemplates.filter((template) => compactKey(template).startsWith(needle));
  };

  const getCompletionOptions = (rawInput) => {
    const input = String(rawInput || '');
    if (!input.startsWith('/')) return [];

    const hasTrailingSpace = /\s$/.test(input);
    const body = input.slice(1);
    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const commandPart = tokens[0] || '';

    const allCommands = listCommandNames().map((c) => c.name);

    if (!commandPart) {
      return allCommands.map((name) => `/${name}`);
    }

    if (tokens.length === 1 && !hasTrailingSpace) {
      const direct = allCommands
        .filter((name) => name.startsWith(commandPart))
        .map((name) => `/${name}`);
      if (direct.length > 0) return direct;
      return matchCompactTemplates(input);
    }

    if (commandPart === 'config') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['list', 'get', 'set', 'reset']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/config ${s}`);
      }

      const sub = tokens[1] || '';
      if (sub === 'get') {
        const keyPrefix = tokens[2] || '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => `/config get ${k}`);
      }
      if (sub === 'set') {
        const keyPrefix = tokens[2] || '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => `/config set ${k} `);
      }

      return configTemplates;
    }

    if (commandPart === 'compact') {
      const joined = tokens.slice(1).join(' ');
      return compactOptions
        .filter((opt) => opt.includes(joined) || joined === '')
        .map((opt) => `/compact ${opt}`);
    }

    if (commandPart === 'retry') {
      return ['/retry'];
    }
    if (commandPart === 'status') {
      return ['/status'];
    }
    if (commandPart === 'mode') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['normal', 'auto', 'plan']
          .filter((m) => m.startsWith(sub))
          .map((m) => `/mode ${m}`);
      }
      return modeTemplates;
    }
    if (commandPart === 'tasks') {
      if (tokens.length <= 2 && !hasTrailingSpace) {
        const sub = tokens[1] || '';
        return ['add', 'start', 'done', 'remove', 'rm', 'clear']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/tasks ${s}`);
      }
      return taskTemplates;
    }
    if (commandPart === 'checkpoint') {
      if (tokens.length <= 2 && !hasTrailingSpace) {
        const sub = tokens[1] || '';
        return ['create', 'list', 'load']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/checkpoint ${s}`);
      }
      if (tokens[1] === 'list') {
        const hint = tokens[2] || '';
        return ['--all'].filter((v) => v.startsWith(hint)).map((v) => `/checkpoint list ${v}`);
      }
      if (tokens[1] === 'load') {
        if (tokens.length >= 3) {
          const hint = tokens[3] || '';
          return ['--all']
            .filter((v) => v.startsWith(hint))
            .map((v) => `/checkpoint load ${tokens[2]} ${v}`);
        }
      }
      return checkpointTemplates;
    }
    if (commandPart === 'spec') {
      return specTemplates;
    }
    if (commandPart === 'plan') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['auto', 'from-spec']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/plan ${s}`);
      }
      return planTemplates;
    }
    if (commandPart === 'agents') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['list', 'run']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/agents ${s}`);
      }
      if (tokens[1] === 'run') {
        const rolePrefix = tokens[2] || '';
        return ['planner', 'coder', 'reviewer']
          .filter((r) => r.startsWith(rolePrefix))
          .map((r) => `/agents run ${r} `);
      }
      return agentTemplates;
    }

    if (commandPart === 'history') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['list', 'current', 'resume']
          .filter((s) => s.startsWith(sub))
          .map((s) => `/history ${s}`);
      }
      const sub = tokens[1] || '';
      if (sub === 'resume') {
        const idPrefix = tokens[2] || '';
        const dynamic = historySessionCache
          .filter((session) => String(session.id || '').startsWith(idPrefix))
          .map((session) => ({
            value: `/history resume ${session.id}`,
            display: `/history resume ${session.id}  ·  ${Number(session.messageCount || 0)} msgs`
          }));
        if (dynamic.length > 0) return dynamic;
        return historyTemplates;
      }
      return historyTemplates;
    }

    if (commandPart === 'debug') {
      const sub = tokens[1] || '';
      if (!sub) return debugTemplates;
      if (sub === 'keys') {
        const action = tokens[2] || '';
        return ['on', 'off', 'status']
          .filter((v) => v.startsWith(action))
          .map((v) => `/debug keys ${v}`);
      }
      return debugTemplates;
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
      'tasks',
      'checkpoint',
      'history',
      'config',
      'compact',
      'debug'
    ]);
    return localCommands.has(command);
  };

  const submit = async (line, onAgentEvent) => {
    const activeBaseSystemPrompt = baseSystemPrompt;
    const activeReplySystemPrompt = await buildSystemPromptWithSoul(baseSystemPrompt, config);
    try {
      await appendInputHistory(line);
    } catch {
      // Non-fatal: history persistence should not block chat flow.
    }
    const parsedInput = parseInput(line);
    if (parsedInput.type === 'empty') {
      return { type: 'noop' };
    }
    if (parsedInput.type === 'shell') {
      const shell = await handleShellInput(parsedInput.command, config);
      return { type: 'shell', text: shell.text };
    }
    if (parsedInput.type === 'slash') {
      if (parsedInput.command === 'exit') return { type: 'exit' };
      if (parsedInput.command === 'help') {
        return {
          type: 'system',
          text: 'Commands: /help /exit /commands /status /mode /compact /tasks /checkpoint /spec /plan /agents /config /history /debug /retry /<custom> !<shell>'
        };
      }
      if (parsedInput.command === 'status') {
        const taskCount = (await loadTasks(process.cwd(), currentSession.id)).length;
        return {
          type: 'system',
          text: `mode=${executionMode} | model=${model || config.model.name} | max_ctx=${effectiveMaxContextTokens(config)} | session=${currentSession.id} | tasks=${taskCount}`
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
      if (parsedInput.command === 'tasks') {
        const sub = (parsedInput.args[0] || '').trim().toLowerCase();
        if (!sub) {
          const tasks = await loadTasks(process.cwd(), currentSession.id);
          if (tasks.length === 0) return { type: 'system', text: 'No tasks' };
          const rows = tasks.map((t, idx) => `${idx + 1}. ${t.id} | ${t.status} | ${t.title}`);
          return { type: 'system', text: rows.join('\n') };
        }
        if (sub === 'add') {
          const title = parsedInput.args.slice(1).join(' ').trim();
          if (!title) return { type: 'system', text: 'Usage: /tasks add <title>' };
          const created = await createTasks([{ title }], process.cwd(), currentSession.id);
          const text = `Created task: ${created[0]?.id || '-'} | ${title}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'start') {
          const id = parsedInput.args[1];
          if (!id) return { type: 'system', text: 'Usage: /tasks start <id>' };
          const updated = await updateTask(id, { status: 'in_progress' }, process.cwd(), currentSession.id);
          if (!updated) return { type: 'system', text: `Task not found: ${id}` };
          const text = `Task in progress: ${id}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'done') {
          const id = parsedInput.args[1];
          if (!id) return { type: 'system', text: 'Usage: /tasks done <id>' };
          const updated = await updateTask(id, { status: 'completed' }, process.cwd(), currentSession.id);
          if (!updated) return { type: 'system', text: `Task not found: ${id}` };
          const text = `Task completed: ${id}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'remove' || sub === 'rm') {
          const id = parsedInput.args[1];
          if (!id) return { type: 'system', text: 'Usage: /tasks remove <id>' };
          const result = await deleteTasks([id], process.cwd(), currentSession.id);
          const text = `Removed=${result.removed}, Remaining=${result.remaining}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        if (sub === 'clear') {
          await clearTasks(process.cwd(), currentSession.id);
          const text = 'All tasks cleared';
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
        // shorthand: /tasks implement x
        const title = parsedInput.args.join(' ').trim();
        if (title) {
          const created = await createTasks([{ title }], process.cwd(), currentSession.id);
          const text = `Created task: ${created[0]?.id || '-'} | ${title}`;
          await persistLocalExchange(line, text);
          return { type: 'system', text };
        }
      }
      if (parsedInput.command === 'checkpoint') {
        const sub = (parsedInput.args[0] || 'list').trim().toLowerCase();
        if (sub === 'create') {
          const name = parsedInput.args.slice(1).join(' ').trim();
          const tasks = await loadTasks(process.cwd(), currentSession.id);
          const cp = await createCheckpoint(
            {
              name,
              session: currentSession,
              config,
              tasks
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
          if (Array.isArray(cp?.tasks)) {
            await clearTasks(process.cwd(), currentSession.id);
            if (cp.tasks.length > 0) {
              // restore with new ids to avoid stale references
              await createTasks(
                cp.tasks.map((t) => ({ title: t.title, description: t.description })),
                process.cwd(),
                currentSession.id
              );
            }
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
            systemPrompt: activeBaseSystemPrompt
          });
        } catch (err) {
          content = buildSpecTemplate(topic);
          buildNote = `\nGenerated with fallback template because model spec generation failed: ${String(err?.message || err)}`;
        }
        const filePath = await writeMarkdownInCoderDir(
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
          const goal = parsedInput.args.slice(1).join(' ').trim();
          if (!goal) return { type: 'system', text: 'Usage: /plan auto <goal>' };
          const auto = await buildAutoPlanAndRun({
            goal,
            session: currentSession,
            config,
            model,
            systemPrompt: activeBaseSystemPrompt,
            onAgentEvent,
            sessionId: currentSession.id
          });
          if (auto.failedCount > 0) {
            const failedLine = auto.failedTitles.slice(0, 5).join(', ');
            const text = `Auto plan completed with failures: ${auto.filePath}\nSteps: ${auto.steps.length}\nFailed: ${auto.failedCount}${failedLine ? `\nFailed steps: ${failedLine}` : ''}\nSummary: ${auto.summary || '-'}`;
            await persistLocalExchange(line, text);
            return {
              type: 'system',
              text
            };
          }
          const text = `Auto plan executed: ${auto.filePath}\nSteps: ${auto.steps.length}\nSummary: ${auto.summary || '-'}`;
          await persistLocalExchange(line, text);
          return {
            type: 'system',
            text
          };
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
              systemPrompt: activeBaseSystemPrompt
            });
          } catch (err) {
            planContent = buildPlanTemplate(specTitle);
            buildNote = `\nGenerated with fallback template because model plan generation failed: ${String(err?.message || err)}`;
          }
          const filePath = await writeMarkdownInCoderDir(
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
        const filePath = await writeMarkdownInCoderDir(
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
            text: 'Sub-agent roles: planner, coder, reviewer\nUse: /agents run <role> <task>'
          };
        }
        if (sub === 'run') {
          const role = (parsedInput.args[1] || '').trim().toLowerCase();
          const task = parsedInput.args.slice(2).join(' ').trim();
          if (!role || !task) return { type: 'system', text: 'Usage: /agents run <role> <task>' };
          if (!SUB_AGENT_ROLES.includes(role)) {
            return { type: 'system', text: 'Unknown role. Allowed: planner|coder|reviewer' };
          }
          const output = await runSubAgentTask({
            role,
            task,
            parentSession: currentSession,
            config,
            model,
            systemPrompt: activeBaseSystemPrompt,
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
          if (!historyIdCache.includes(targetId)) historyIdCache.unshift(targetId);
          historySessionCache = [
            { id: targetId, messageCount: Array.isArray(loaded.messages) ? loaded.messages.length : 0 },
            ...historySessionCache.filter((s) => s.id !== targetId)
          ];
          return {
            type: 'system',
            text: `Switched to session: ${targetId} (${loaded.messages.length} messages)`
          };
        }
        return { type: 'system', text: `Unknown /history subcommand: ${sub}` };
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
          executionMode
        });
        return { type: 'assistant', text: result.text };
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

      const rendered = await expandFileMentions(
        renderCommandPrompt(custom, parsedInput.args),
        process.cwd()
      );
      const result = await askModel({
        text: rendered,
        session: currentSession,
        config,
        model,
        systemPrompt: activeBaseSystemPrompt,
        onAgentEvent,
        executionMode
      });
      return { type: 'assistant', text: result.text };
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
    const routedSystemPrompt = buildAutoSkillSystemPrompt(activeReplySystemPrompt, commands, config, expandedText);
    const result = await askModel({
      text: expandedText,
      session: currentSession,
      config,
      model,
      systemPrompt: routedSystemPrompt,
      onAgentEvent,
      executionMode
    });
    return { type: 'assistant', text: result.text };
  };

  return {
    listCommandNames,
    getCompletionOptions,
    isImmediateLocalInput,
    submit,
    getInputHistory: () => loadInputHistory(),
    getCurrentSessionId: () => currentSession.id
  };
}
