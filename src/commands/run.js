import { loadConfig } from '../core/config-store.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { runAgentLoop } from '../core/agent-loop.js';
import { createChatCompletion } from '../core/provider/index.js';
import { getBuiltinTools } from '../core/tools.js';
import { getSubAgentRolePrompt, ROLE_TOOL_POLICY } from '../core/chat-runtime.js';
import { composeSystemPrompt } from '../core/system-prompt-composer.js';
import { normalizePlanState } from '../core/plan-state.js';
import fs from 'node:fs/promises';
import path from 'node:path';


const CLI_ROLE_TOOL_POLICY = {
  ...ROLE_TOOL_POLICY,
  planner: ['read', 'read_plan', 'tool_search', 'skill', 'update_plan', 'update_todos'],
  coder: (ROLE_TOOL_POLICY.coder || []).filter((tool) => !['web_fetch', 'web_search'].includes(tool)),
  refactorer: (ROLE_TOOL_POLICY.refactorer || []).filter((tool) => !['web_fetch', 'web_search'].includes(tool)),
  writer: ROLE_TOOL_POLICY.writer || []
};
const HARNESS_ROLES = Object.keys(CLI_ROLE_TOOL_POLICY).filter((role) => !['planner', 'codewiki'].includes(role));

function parseRunArgs(args) {
  const parsed = {
    task: '',
    model: undefined,
    fast: false,
    harness: null,
    pipeline: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--model') {
      parsed.model = args[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--fast' || arg === '--lite') {
      parsed.fast = true;
      continue;
    }
    if (arg === '--harness') {
      parsed.harness = (args[i + 1] || '').toLowerCase();
      i += 1;
      continue;
    }
    if (arg === '--pipeline') {
      parsed.pipeline = true;
      continue;
    }
    parsed.task += `${parsed.task ? ' ' : ''}${arg}`;
  }
  return parsed;
}

function filterToolsForRole(definitions, handlers, deferredDefinitions, role) {
  const allowed = CLI_ROLE_TOOL_POLICY[role];
  if (!allowed) return { definitions, handlers, deferredDefinitions };
  return {
    definitions: definitions.filter((t) => allowed.includes(t.function?.name || t.name)),
    handlers: Object.fromEntries(Object.entries(handlers).filter(([name]) => allowed.includes(name))),
    deferredDefinitions: Object.fromEntries(Object.entries(deferredDefinitions || {}).filter(([name]) => allowed.includes(name)))
  };
}

function makeCompletionFn(config) {
  return async ({ messages, tools, model }) =>
    createChatCompletion({
      sdkProvider: config.sdk?.provider,
      baseUrl: config.gateway.base_url,
      apiKey: config.gateway.api_key,
      model,
      messages,
      tools,
      timeoutMs: config.gateway.timeout_ms || 1800000,
      maxRetries: config.gateway.max_retries ?? 2
    });
}

async function buildSystemPrompt(config) {
  return composeSystemPrompt({
    shellRulesPrompt: buildDefaultSystemPrompt(config),
    config,
    workspaceRoot: process.cwd()
  });
}

async function isGitWorkspace(workspaceRoot) {
  try {
    await fs.stat(path.join(workspaceRoot, '.git'));
    return true;
  } catch {
    return false;
  }
}

async function buildAgentLoopRuntimeOptions(config, workspaceRoot) {
  return {
    executionMode: config.execution?.mode || 'normal',
    approvalMode: config.execution?.approval_mode || 'review',
    alwaysAllowTools: config.execution?.always_allow_tools || [],
    projectIsGit: await isGitWorkspace(workspaceRoot),
    toolResultMaxChars: config.context?.tool_result_max_chars || 12000,
    config: { ...config, workspaceRoot }
  };
}

async function runHarness({ role, task, config, systemPrompt, model }) {
  if (!HARNESS_ROLES.includes(role)) {
    throw new Error(`Unknown harness role: ${role}. Available: ${HARNESS_ROLES.join(', ')}`);
  }
  const workspaceRoot = process.cwd();
  const { definitions, handlers, formatters, deferredDefinitions, dispose } = getBuiltinTools({
    workspaceRoot,
    config
  });
  try {
    const filtered = filterToolsForRole(definitions, handlers, deferredDefinitions, role);
    const rolePrompt = getSubAgentRolePrompt(role);
    const harnessSystemPrompt = await composeSystemPrompt({
      shellRulesPrompt: systemPrompt,
      config,
      skillsPrompt: rolePrompt,
      includeSoul: false,
      includeMemory: false
    });

    const result = await runAgentLoop({
      systemPrompt: harnessSystemPrompt,
      userPrompt: task,
      model: model || config.model.name,
      toolDefinitions: filtered.definitions,
      toolHandlers: filtered.handlers,
      toolFormatters: formatters,
      deferredDefinitions: filtered.deferredDefinitions,
      ...(await buildAgentLoopRuntimeOptions(config, workspaceRoot)),
      requestCompletion: makeCompletionFn(config)
    });
    return result;
  } finally {
    await dispose?.();
  }
}

function extractJsonBlock(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) { try { return JSON.parse(fenced[1]); } catch {} }
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(raw.slice(first, last + 1)); } catch {}
  }
  return null;
}

function normalizePlan(parsed, goal) {
  const steps = Array.isArray(parsed?.steps) ? parsed.steps : [];
  const cleaned = steps
    .map((s) => ({
      title: String(s?.title || '').trim(),
      role: String(s?.role || '').trim().toLowerCase(),
      task: [
        String(s?.task || '').trim(),
        Array.isArray(s?.target_files) && s.target_files.length ? `Targets: ${s.target_files.join(', ')}` : '',
        s?.success_criteria ? `Success criteria: ${s.success_criteria}` : '',
        s?.verification ? `Verification intent: ${s.verification}` : '',
        s?.handoff ? `Handoff artifact: ${s.handoff}` : ''
      ].filter(Boolean).join('\n')
    }))
    .filter((s) => s.title && s.task && HARNESS_ROLES.includes(s.role));
  if (cleaned.length === 0) {
    return { summary: `Fallback plan for: ${goal}`, steps: [{ title: 'Execute task', role: 'coder', task: goal }] };
  }
  return { summary: parsed.summary || `Plan for: ${goal}`, steps: cleaned };
}

async function planPipeline({ goal, config, systemPrompt, model }) {
  const roleList = HARNESS_ROLES.filter(r => r !== 'planner').join(', ');
  const plannerPrompt = [
    'Create an execution plan and assign the best sub-agent role for each step.',
    `Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"${HARNESS_ROLES.join('|')}","task":"...","target_files":["..."],"success_criteria":"...","verification":"...","handoff":"..."}]}. No markdown.`,
    `Available roles: ${roleList}. The planner role generates the plan but does not execute steps. Start with explorer for codebase inspection.`,
    'Prefer 3-5 steps total. Always include a summarizer as the final step.',
    'For debugging: explorer -> debugger -> coder -> tester -> summarizer.',
    'For architecture/design: explorer -> architect -> summarizer.',
    'For refactoring: explorer -> refactorer -> tester -> summarizer.',
    'For implementation: explorer -> coder -> reviewer -> tester -> summarizer.',
    'For documentation: explorer -> writer -> summarizer.',
    'For advisory: explorer -> advisor -> summarizer.',
    'For implementation goals, include a reviewer or tester step near the end.',
    'For advisory/analysis goals, keep it lean with explorer/advisor only; do not use coder unless code or files will be modified.'
  ].join('\n');
  const plannerSystemPrompt = await composeSystemPrompt({
    shellRulesPrompt: systemPrompt,
    config,
    skillsPrompt: plannerPrompt,
    includeSoul: false,
    includeMemory: false
  });

  const planning = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: plannerSystemPrompt },
      { role: 'user', content: `Plan the following task:\n${goal}` }
    ],
    timeoutMs: config.gateway.timeout_ms || 1800000,
    maxRetries: config.gateway.max_retries ?? 2
  });

  const parsed = extractJsonBlock(planning.text || '');
  return normalizePlan(parsed, goal);
}

function createRunId() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function formatPriorStepsForTask(priorSteps = []) {
  const steps = Array.isArray(priorSteps) ? priorSteps.filter(Boolean) : [];
  if (steps.length === 0) return '';
  const lines = ['Prior pipeline step outputs. Use these as working context for the current task:'];
  for (const step of steps.slice(-4)) {
    lines.push('');
    lines.push(`[${step.role}] ${step.title}`);
    if (step.outputRef) lines.push(`Output file: ${step.outputRef}`);
    lines.push(String(step.output || '').trim() || '(no output captured)');
  }
  return lines.join('\n');
}

function buildStepTask({ goal, step, priorSteps }) {
  return [
    `Original goal:\n${goal}`,
    formatPriorStepsForTask(priorSteps),
    'Current step task:',
    step.task
  ].filter(Boolean).join('\n');
}

async function writeStepOutput(workspaceRoot, runId, stepIndex, stepResult) {
  const dir = path.join(workspaceRoot, '.codemini', 'runs', runId);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `step_${stepIndex + 1}.md`);
  const content = [
    `# Step ${stepIndex + 1}: ${stepResult.title}`,
    '',
    `Role: ${stepResult.role}`,
    `Status: ${stepResult.status}`,
    '',
    '## Output',
    '',
    stepResult.output || ''
  ].join('\n');
  await fs.writeFile(filePath, `${content.trim()}\n`, 'utf8');
  return path.relative(workspaceRoot, filePath).replace(/\\/g, '/');
}

function writePlanState(workspaceRoot, state) {
  const dir = path.join(workspaceRoot, '.codemini');
  const filePath = path.join(dir, 'plan-state.json');
  const normalized = normalizePlanState(state);
  return fs.mkdir(dir, { recursive: true }).then(() =>
    fs.writeFile(filePath, JSON.stringify(normalized, null, 2), 'utf-8')
  ).catch(() => {});
}

async function runPipeline({ task, config, systemPrompt, model }) {
  console.log('[pipeline] Planning...');
  const plan = await planPipeline({ goal: task, config, systemPrompt, model });

  console.log(`[pipeline] Plan: ${plan.summary}`);
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.role}] ${s.title}`));
  console.log('');

  const priorSteps = [];
  const runId = createRunId();
  const planState = {
    id: `plan_${runId}`,
    status: 'running',
    source: 'cli-pipeline',
    goal: task,
    summary: plan.summary,
    steps: plan.steps.map((s, index) => ({ id: `step_${index + 1}`, ...s, status: 'pending' })),
    startedAt: new Date().toISOString()
  };

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    planState.steps[i].status = 'running';
    await writePlanState(process.cwd(), planState);

    console.log(`[pipeline] Step ${i + 1}/${plan.steps.length} -> ${step.role}: ${step.title}`);

    const result = await runHarness({
      role: step.role,
      task: buildStepTask({ goal: task, step, priorSteps }),
      config,
      systemPrompt,
      model,


    });

    const stepResult = {
      role: step.role,
      title: step.title,
      output: (result.text || '').slice(0, 2000),
      status: 'done'
    };
    stepResult.outputRef = await writeStepOutput(process.cwd(), runId, i, stepResult);
    priorSteps.push(stepResult);

    planState.steps[i].status = 'done';
    planState.steps[i].output = stepResult.output;
    planState.steps[i].outputRef = stepResult.outputRef;
    await writePlanState(process.cwd(), planState);

    console.log(`[pipeline] Step ${i + 1} complete.\n`);
  }

  planState.status = 'completed';
  planState.completedAt = new Date().toISOString();
  await writePlanState(process.cwd(), planState);

  console.log('[pipeline] All steps complete.');
  console.log(`[pipeline] State saved to .codemini/plan-state.json`);
  return planState;
}

export async function handleRun(args) {
  const parsed = parseRunArgs(args);
  if (!parsed.task) {
    throw new Error('run requires <task>');
  }

  const config = await loadConfig();
  const selectedModel = parsed.fast ? (config.model?.fast_name || config.model?.name) : parsed.model;
  const systemPrompt = await buildSystemPrompt(config);

  if (parsed.pipeline) {
    const state = await runPipeline({
      task: parsed.task,
      config,
      systemPrompt,
      model: selectedModel
    });
    for (const step of state.steps) {
      console.log(`\n--- [${step.role}] ${step.title} ---`);
      console.log(step.output || '(no output)');
    }
    return;
  }

  if (parsed.harness) {
    const result = await runHarness({
      role: parsed.harness,
      task: parsed.task,
      config,
      systemPrompt,
      model: selectedModel,


    });
    console.log(result.text);
    return;
  }

  const workspaceRoot = process.cwd();
  const { definitions, handlers, formatters, deferredDefinitions, dispose } = getBuiltinTools({
    workspaceRoot,
    config
  });
  try {
    const result = await runAgentLoop({
      systemPrompt,
      userPrompt: parsed.task,
      model: selectedModel || config.model.name,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      ...(await buildAgentLoopRuntimeOptions(config, workspaceRoot)),

      requestCompletion: makeCompletionFn(config)
    });

    console.log(result.text);
  } finally {
    await dispose?.();
  }
}
