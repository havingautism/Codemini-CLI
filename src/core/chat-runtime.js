import { parseInput } from './input-parser.js';
import { loadCommandsAndSkills, renderCommandPrompt } from './command-loader.js';
import { runAgentLoop, setResultDir, clearResultStore } from './agent-loop.js';
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
import { buildSystemPromptWithReplyLanguage } from './reply-language.js';
import { buildSystemPromptWithSoul } from './soul.js';
import { getProjectPlansDir, getProjectSpecsDir, getProjectWorkspaceDir, getSessionsDir } from './paths.js';
import { buildProjectContextSnippet, initializeProjectIndex } from './project-index.js';

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

function describeConfigKey(key, mode = 'set') {
  const labelMap = {
    'gateway.base_url': 'gateway base URL',
    'gateway.api_key': 'gateway API key',
    'gateway.timeout_ms': 'gateway timeout in milliseconds',
    'gateway.max_retries': 'gateway retry count',
    'model.name': 'active model name',
    'model.max_context_tokens': 'model context token limit',
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
  };
  const label = labelMap[key] || key;
  return mode === 'get' ? `show the ${label}` : `set the ${label}`;
}

const SUB_AGENT_ROLES = ['planner', 'coder', 'reviewer', 'tester'];
const SUB_AGENT_CONTEXT_MAX_MESSAGES = 4;
const SUB_AGENT_CONTEXT_MAX_CHARS = 1200;
const SUB_AGENT_EVIDENCE_MAX_ITEMS = 3;
const SUB_AGENT_HANDOFF_MAX_ITEMS = 6;
function getSubAgentRolePrompt(role) {
  if (role === 'planner') {
    return 'You are a planning sub-agent. Produce a concrete implementation plan with risks and verification.';
  }
  if (role === 'reviewer') {
    return [
      'You are a review sub-agent. Focus on bugs, regressions, edge cases, and missing tests.',
      'Start with the focused files or directories handed to you. Do not roam unrelated parts of the repo unless the handed-off evidence is insufficient.',
      'Use this exact output structure:',
      'Acceptance Status:',
      '- <met|unmet|unverified> :: <acceptance checklist item or "none">',
      'Findings:',
      '- <bug, regression, risk, or "none">',
      'Verified:',
      '- <what you checked>',
      'Not Verified:',
      '- <what remains uncertain>',
      'Next Action:',
      '- <single best next step>'
    ].join('\n');
  }
  if (role === 'tester') {
    return [
      'You are a testing sub-agent. Focus on verification strategy, real test execution evidence, missing coverage, and whether the work was actually validated.',
      'Prefer running concrete verification commands over only suggesting them.',
      'Start with the focused files or directories handed to you. Verify those artifacts first before scanning the wider repo.',
      'Use this exact output structure:',
      'Acceptance Status:',
      '- <met|unmet|unverified> :: <acceptance checklist item or "none">',
      'Verified:',
      '- <commands run and evidence>',
      'Not Verified:',
      '- <what could not be validated>',
      'Failures:',
      '- <failed command or "none">',
      'Next Action:',
      '- <single best next step>'
    ].join('\n');
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
  const text = trimInlineText(step?.output || step?.task || '', 220);
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

function buildGoalRequirementPacket(goal, role) {
  const rawGoal = trimInlineText(goal, 800);
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
    'Auto-plan planning rules:',
    '- If the goal still leaves room for multiple approaches, choose one practical direction before planning execution.',
    '- Prefer the smallest local approach that satisfies the goal.',
    '- Do not output multiple alternative branches in the final plan.',
    '- Turn the chosen direction into concrete execution steps for coder, reviewer, and tester.',
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
      primary.push(`- npm test :: package.json script = ${trimInlineText(scripts.test, 140)}`);
    }
    if (typeof scripts.build === 'string' && scripts.build.trim()) {
      secondary.push(`- npm run build :: package.json script = ${trimInlineText(scripts.build, 140)}`);
    }
    if (typeof scripts.lint === 'string' && scripts.lint.trim()) {
      secondary.push(`- npm run lint :: package.json script = ${trimInlineText(scripts.lint, 140)}`);
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

function enforceAutoPlanGuardrailSteps(plan, goal) {
  const source = Array.isArray(plan?.steps) ? plan.steps : [];
  const requirements = deriveGoalRequirements(goal);
  const lightweightGoal = isLightweightAutoPlanGoal(goal, requirements);
  const implementationSteps = source.filter((step) => step.role !== 'reviewer' && step.role !== 'tester');
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

  if (lightweightGoal) {
    return {
      summary: String(plan?.summary || `Auto plan for: ${goal}`).trim(),
      steps: [primaryImplementationStep, testerStep]
    };
  }

  return {
    summary: String(plan?.summary || `Auto plan for: ${goal}`).trim(),
    steps: [...implementationSteps.slice(0, 6), reviewerStep, testerStep]
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
  const acceptanceFailures = extractAcceptanceStatusItems(value).filter((item) => item.status !== 'met');
  if (errorBullet && !/^none\b/i.test(errorBullet)) return true;
  if (failureBullet && !/^none\b/i.test(failureBullet)) return true;
  if (acceptanceFailures.length > 0) return true;
  if (role === 'reviewer' && findingsBullet && !/^none\b/i.test(findingsBullet)) return true;
  if (nextActionBullet && /^(fix|retry|correct|repair)\b/i.test(nextActionBullet)) return true;
  return false;
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
  const statusTitle =
    auto.failedCount > 0 ? 'Auto plan finished with failures' : auto.warningCount > 0 ? 'Auto plan finished with warnings' : 'Auto plan finished';
  const lines = [
    statusTitle,
    `File: ${auto.filePath}`,
    `Plan Summary: ${auto.summary || '-'}`,
    `Final Summary: ${auto.finalSummary || auto.summary || '-'}`,
    `Steps: ${auto.steps.length} total`,
    `Completed: ${auto.completedCount}`,
    `Warnings: ${auto.warningCount}`,
    `Failed: ${auto.failedCount}`
  ];
  if (auto.warningTitles?.length) {
    lines.push(`Warning steps: ${auto.warningTitles.slice(0, 5).join(', ')}`);
  }
  if (auto.failedTitles?.length) {
    lines.push(`Failed steps: ${auto.failedTitles.slice(0, 5).join(', ')}`);
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
    lines.push(`Output: ${trimInlineText(item.output || '(empty)', 500)}`);
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
    return trimInlineText(result.text || '', 600) || fallbackSummary;
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
      candidates.push(path.relative(cwd, abs).replace(/\\/g, '/'));
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

function buildRuntimeStateSnapshot({ currentSession, config, model, executionMode }) {
  const currentContextTokens = estimateMessagesTokens(currentSession?.messages || []);
  const maxContextTokens = effectiveMaxContextTokens(config);
  const contextUsagePct = maxContextTokens > 0 ? Math.min(100, Math.max(0, (currentContextTokens / maxContextTokens) * 100)) : 0;
  const snapshot = {
    sessionId: currentSession?.id || '',
    mode: executionMode || config.execution?.mode || 'auto',
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

  const projectContextSnippet = await buildProjectContextSnippet(process.cwd(), text).catch(() => '');
  const effectiveSystemPrompt = projectContextSnippet
    ? `${systemPrompt}\n\n${projectContextSnippet}\n\nUse this project context as lightweight guidance. Prefer tools for fresh verification before assuming details.`
    : systemPrompt;

  const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config,
    sessionId: session.id,
    onSystemEvent: onAgentEvent
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
    systemPrompt: effectiveSystemPrompt,
    userPrompt: loopUserPrompt,
    model: model || config.model.name,
    maxSteps: Number(config.execution?.max_steps || 16),
    toolDefinitions: definitions,
    toolHandlers: handlers,
    initialMessages: toOpenAIMessages(session.messages),
    onEvent: wrappedAgentEvent,
    executionMode: executionMode || config.execution?.mode || 'auto',
    alwaysAllowTools:
      alwaysAllowTools || config.execution?.always_allow_tools || ['run', 'read', 'write'],
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    toolFormatters: formatters,
    deferredDefinitions,
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
        },
        onToolCallDelta: (toolCall) => {
          if (onAgentEvent) onAgentEvent({ type: 'assistant:tool_call_delta', toolCall });
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
  goal = '',
  priorSteps = [],
  parentSession,
  config,
  model,
  systemPrompt,
  onAgentEvent,
  extraRolePrompt = ''
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
  const scopedTask = [
    contextPacket,
    goalRequirementPacket,
    evidencePacket,
    handoffPacket,
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
  const subResult = await askModel({
    text: scopedTask,
    session: subSession,
    config,
    model,
    systemPrompt: `${systemPrompt}\n${rolePrompt}${extraRolePrompt ? `\n${extraRolePrompt}` : ''}`,
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
    hasErrorLine,
    artifactPaths: artifactPaths.slice(0, SUB_AGENT_HANDOFF_MAX_ITEMS)
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
  const requirementPacket = buildGoalRequirementPacket(goal, 'planner');
  const plannerPrompt = [
    buildAutoPlanPlannerGuidance(),
    'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|coder|reviewer|tester","task":"..."}]}. No markdown. Always include final reviewer and tester steps.'
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
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model: model || config.model.name,
      messages: [
        { role: 'system', content: `${systemPrompt}\n${plannerPrompt}` },
        {
          role: 'user',
          content: [
            'Create an execution plan and assign best sub-agent role for each step.',
            requirementPacket,
            'The final steps must include review and testing/verification unless the goal is a tiny single-change task, in which case you may keep only one implementation step plus one testing/verification step.'
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
  }

  const runItems = [];
  const totalPlanSteps = autoPlan.steps.length + 1;
  for (let i = 0; i < autoPlan.steps.length; i += 1) {
    const step = autoPlan.steps[i];
    if (onAgentEvent) {
      onAgentEvent({
        type: 'assistant:delta',
        text: `\n[plan] Step ${i + 1}/${totalPlanSteps} -> ${step.role}: ${step.title}\n`
      });
    }
    try {
      const stepResult = await runSubAgentTask({
        role: step.role,
        task: step.task,
        goal,
        priorSteps: runItems,
        parentSession: session,
        config,
        model,
        systemPrompt,
        onAgentEvent,
        extraRolePrompt: buildAutoPlanExecutionGuidance(step.role)
      });
      const outputLooksSuccessful = looksLikeSuccessfulStepOutput(stepResult.text);
      const outputHasFailureSignals = stepOutputHasFailureSignals(step.role, stepResult.text);
      const warningParts = [];
      if (stepResult.blockedCount > 0) warningParts.push(`${stepResult.blockedCount} blocked tool call(s)`);
      if (stepResult.toolErrorCount > 0) warningParts.push(`${stepResult.toolErrorCount} tool error(s)`);
      const warning = warningParts.length > 0 ? `sub-agent recovered after ${warningParts.join(', ')}` : '';
      const failed =
        stepResult.hasErrorLine ||
        outputHasFailureSignals ||
        (!outputLooksSuccessful && (stepResult.blockedCount > 0 || stepResult.toolErrorCount > 0));
      let error = '';
      if (stepResult.hasErrorLine) {
        error = 'sub-agent output contains error line(s)';
      } else if (outputHasFailureSignals) {
        error = 'sub-agent output reports unmet requirements or failed verification';
      } else if (failed && stepResult.blockedCount > 0) {
        error = `sub-agent ended with ${stepResult.blockedCount} blocked tool call(s)`;
      } else if (failed && stepResult.toolErrorCount > 0) {
        error = `sub-agent ended with ${stepResult.toolErrorCount} tool error(s)`;
      }
      runItems.push({
        ...step,
        output: stepResult.text,
        error,
        warning,
        failed,
        artifactPaths: stepResult.artifactPaths || []
      });
    } catch (err) {
      runItems.push({
        ...step,
        output: '',
        error: String(err?.message || err || 'sub-agent step failed'),
        warning: '',
        failed: true
      });
    }
  }

  const failedItems = runItems.filter((s) => s.failed || s.error);
  const warningItems = runItems.filter((s) => !s.failed && s.warning);
  const completedItems = runItems.filter((s) => !s.failed);

  if (onAgentEvent) {
    onAgentEvent({
      type: 'assistant:delta',
      text: `\n[plan] Step ${totalPlanSteps}/${totalPlanSteps} -> summarizer: Final summary\n`
    });
  }
  const finalSummary = await buildAutoPlanFinalSummary({
    goal,
    autoPlan,
    runItems,
    planningError,
    config,
    model,
    systemPrompt
  });

  const lines = [];
  lines.push(`# Auto Plan: ${goal}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(autoPlan.summary || `Auto plan for: ${goal}`);
  lines.push('');
  lines.push('## Final Summary');
  lines.push(finalSummary || '(empty)');
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
    if (s.warning) {
      lines.push(`Note: ${s.warning}`);
      lines.push('');
    }
    lines.push(s.output || '(empty)');
    lines.push('');
  });

  const filePath = await writeMarkdownInProjectDir(
    'plans',
    `${goal}-auto`,
    lines.join('\n'),
    'plan-auto',
    sessionId
  );
  return {
    filePath,
    summary: autoPlan.summary,
    finalSummary,
    steps: autoPlan.steps,
    completedCount: completedItems.length,
    warningCount: warningItems.length,
    failedCount: failedItems.length,
    warningTitles: warningItems.map((s) => `${s.role}:${s.title}`),
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
  const startupEvents = [];
  const initialIndex = await initializeProjectIndex(process.cwd()).catch(() => null);
  if (initialIndex?.summary) {
    startupEvents.push({
      type: 'system_tool',
      name: 'project_index(.codemini-project/project-map.json,.codemini-project/file-index.json)',
      status: 'done',
      summary: initialIndex.summary
    });
  }
  let currentSession = session;
  let config = initialConfig;
  const baseSystemPrompt = systemPrompt;
  let executionMode = config.execution?.mode || 'auto';
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

  const configKeyHints = [
    'gateway.base_url',
    'gateway.api_key',
    'model.name',
    'ui.reply_language',
    'execution.mode',
    'shell.default',
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
    '/mode',
    '/plan',
    '/tasks',
    '/history',
    '/checkpoint',
    '/agents',
    '/compact',
    '/debug',
    '/retry'
  ];
  const configSubcommandPriority = ['/config set', '/config get', '/config list', '/config reset'];
  const configSubcommandDescriptions = {
    '/config set': 'update a config value',
    '/config get': 'show a config value',
    '/config list': 'print the full config',
    '/config reset': 'reset config to defaults'
  };

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
      { name: 'spec', description: 'create a spec markdown file in .codemini/specs' },
      { name: 'plan', description: 'create an implementation plan markdown file in .codemini/plans' },
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
  const agentTemplates = ['/agents list', '/agents run planner <task>', '/agents run coder <task>', '/agents run reviewer <task>', '/agents run tester <task>'];
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

    const hasTrailingSpace = /\s$/.test(input);
    const body = input.slice(1);
    const tokens = body.trim().split(/\s+/).filter(Boolean);
    const commandPart = tokens[0] || '';
    const commandHasSubcommands = new Set([
      'config',
      'compact',
      'mode',
      'tasks',
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
      registerSuggestion(template, configSubcommandDescriptions[template] || 'config command');
    }
    for (const template of historyTemplates) registerSuggestion(template, 'history command');
    for (const template of modeTemplates) registerSuggestion(template, 'switch execution mode');
    for (const template of taskTemplates) registerSuggestion(template, 'task board command');
    for (const template of checkpointTemplates) registerSuggestion(template, 'checkpoint command');
    for (const template of specTemplates) registerSuggestion(template, 'create a spec file');
    for (const template of planTemplates) registerSuggestion(template, 'planning command');
    for (const template of agentTemplates) registerSuggestion(template, 'sub-agent command');
    for (const template of debugTemplates) registerSuggestion(template, 'debug command');
    for (const template of compactTemplates) registerSuggestion(template, 'context compaction command');
    registerSuggestion('/retry', 'retry the last user request');
    registerSuggestion('/status', 'show runtime status');

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
            .map((s) => registerSuggestion(`/config ${s}`, configSubcommandDescriptions[`/config ${s}`] || 'config command').value),
          configSubcommandPriority
        ));
      }

      if (subcommand === 'get') {
        const keyPrefix = tokens.length >= 3 ? tokens[2] || '' : '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => registerSuggestion(`/config get ${k}`, describeConfigKey(k, 'get')));
      }
      if (subcommand === 'set') {
        const keyPrefix = tokens.length >= 3 ? tokens[2] || '' : '';
        return configKeyHints
          .filter((k) => k.startsWith(keyPrefix))
          .map((k) => registerSuggestion(`/config set ${k} `, describeConfigKey(k, 'set')));
      }

      return materializeSuggestions(configTemplates);
    }

    if (commandPart === 'compact') {
      const joined = tokens.slice(1).join(' ');
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        return compactOptions
          .filter((opt) => opt.startsWith(joined) || joined === '')
          .map((opt) => registerSuggestion(`/compact ${opt}`, 'context compaction command'));
      }
      return compactOptions
        .filter((opt) => opt.includes(joined) || joined === '')
        .map((opt) => registerSuggestion(`/compact ${opt}`, 'context compaction command'));
    }

    if (commandPart === 'retry') {
      return [registerSuggestion('/retry', 'retry the last user request')];
    }
    if (commandPart === 'status') {
      return [registerSuggestion('/status', 'show runtime status')];
    }
    if (commandPart === 'mode') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        return ['normal', 'auto', 'plan']
          .filter((m) => m.startsWith(sub))
          .map((m) => registerSuggestion(`/mode ${m}`, 'switch execution mode'));
      }
      return materializeSuggestions(modeTemplates);
    }
    if (commandPart === 'tasks') {
      if (tokens.length <= 2 && !hasTrailingSpace) {
        const sub = tokens[1] || '';
        return ['add', 'start', 'done', 'remove', 'rm', 'clear']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/tasks ${s}`, 'task board command'));
      }
      return materializeSuggestions(taskTemplates);
    }
    if (commandPart === 'checkpoint') {
      if (tokens.length <= 2 && !hasTrailingSpace) {
        const sub = tokens[1] || '';
        if (sub === 'list') {
          return ['--all']
            .map((v) => registerSuggestion(`/checkpoint list ${v}`, 'checkpoint command'));
        }
        return ['create', 'list', 'load']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/checkpoint ${s}`, 'checkpoint command'));
      }
      if (tokens[1] === 'list') {
        const hint = tokens[2] || '';
        return ['--all']
          .filter((v) => v.startsWith(hint))
          .map((v) => registerSuggestion(`/checkpoint list ${v}`, 'checkpoint command'));
      }
      if (tokens[1] === 'load') {
        if (tokens.length >= 3) {
          const hint = tokens[3] || '';
          return ['--all']
            .filter((v) => v.startsWith(hint))
            .map((v) => registerSuggestion(`/checkpoint load ${tokens[2]} ${v}`, 'checkpoint command'));
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
        return ['auto', 'from-spec']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/plan ${s}`, 'planning command'));
      }
      return materializeSuggestions(planTemplates);
    }
    if (commandPart === 'agents') {
      if (tokens.length === 1 || (tokens.length === 2 && !hasTrailingSpace)) {
        const sub = tokens[1] || '';
        if (sub === 'run') {
          return ['planner', 'coder', 'reviewer', 'tester']
            .map((r) => registerSuggestion(`/agents run ${r} `, 'sub-agent command'));
        }
        return ['list', 'run']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/agents ${s}`, 'sub-agent command'));
      }
      if (tokens[1] === 'run') {
        const rolePrefix = tokens[2] || '';
        return ['planner', 'coder', 'reviewer', 'tester']
          .filter((r) => r.startsWith(rolePrefix))
          .map((r) => registerSuggestion(`/agents run ${r} `, 'sub-agent command'));
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
              description: 'resume a saved session'
            }));
          if (dynamic.length > 0) return dynamic;
        }
        return ['list', 'current', 'resume']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/history ${s}`, 'history command'));
      }
      if (sub === 'resume') {
        const idPrefix = tokens[2] || '';
        const dynamic = historySessionCache
          .filter((session) => String(session.id || '').startsWith(idPrefix))
          .map((session) => ({
            value: `/history resume ${session.id}`,
            display: `/history resume ${session.id}  ·  ${Number(session.messageCount || 0)} msgs`,
            description: 'resume a saved session'
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
            .map((v) => registerSuggestion(`/debug keys ${v}`, 'keyboard debug command'));
        }
        return ['keys']
          .filter((s) => s.startsWith(sub))
          .map((s) => registerSuggestion(`/debug ${s}`, 'debug command'));
      }
      if (sub === 'keys') {
        const action = tokens[2] || '';
        return ['on', 'off', 'status']
          .filter((v) => v.startsWith(action))
          .map((v) => registerSuggestion(`/debug keys ${v}`, 'keyboard debug command'));
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
    const activeBaseSystemPrompt = buildSystemPromptWithReplyLanguage(baseSystemPrompt, config);
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
          const text = buildAutoPlanSystemSummary(auto);
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
            text: 'Sub-agent roles: planner, coder, reviewer, tester\nUse: /agents run <role> <task>'
          };
        }
        if (sub === 'run') {
          const role = (parsedInput.args[1] || '').trim().toLowerCase();
          const task = parsedInput.args.slice(2).join(' ').trim();
          if (!role || !task) return { type: 'system', text: 'Usage: /agents run <role> <task>' };
          if (!SUB_AGENT_ROLES.includes(role)) {
            return { type: 'system', text: 'Unknown role. Allowed: planner|coder|reviewer|tester' };
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
          setResultDir(path.join(getSessionsDir(), String(targetId)));
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

      const customPrompt =
        custom.name === 'brainstorm'
          ? [
              renderCommandPrompt(custom, []),
              'Explicit brainstorm mode:',
              '- Ask exactly one clarifying question first if any important uncertainty remains.',
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
          systemPrompt: activeBaseSystemPrompt,
          onAgentEvent,
          executionMode
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
    const selectedAutoSkills = selectAutoSkillNames(expandedText).filter((name) => isSkillEnabled(config, name));
    if (selectedAutoSkills.length > 0 && onAgentEvent) {
      onAgentEvent({
        type: 'skill:auto',
        names: selectedAutoSkills
      });
    }
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
    consumeStartupEvents: () => startupEvents.splice(0, startupEvents.length),
    getInputHistory: () => loadInputHistory(),
    getCurrentSessionId: () => currentSession.id,
    getRuntimeState: () =>
      buildRuntimeStateSnapshot({
        currentSession,
        config,
        model,
        executionMode
      })
  };
}
