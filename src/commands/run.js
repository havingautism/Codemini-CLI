import { loadConfig } from '../core/config-store.js';
import { buildDefaultSystemPrompt } from '../core/default-system-prompt.js';
import { runAgentLoop } from '../core/agent-loop.js';
import { createChatCompletion } from '../core/provider/index.js';
import { buildSystemPromptWithSoul } from '../core/soul.js';
import { getBuiltinTools } from '../core/tools.js';
import { buildMemorySnapshot } from '../core/memory-prompt.js';
import { getSubAgentRolePrompt } from '../core/chat-runtime.js';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROLE_TOOL_POLICY = {
  planner: ['read', 'grep', 'list', 'query_project_index', 'tool_search', 'glob', 'ast_query', 'read_ast_node', 'read_plan', 'update_plan'],
  advisor: ['read', 'grep', 'list', 'query_project_index', 'tool_search', 'read_plan'],
  coder: ['read', 'grep', 'list', 'edit', 'write', 'run', 'ast_query', 'read_ast_node', 'glob', 'tool_search', 'update_todos', 'read_plan', 'update_plan'],
  reviewer: ['read', 'grep', 'list', 'glob', 'tool_search', 'ast_query', 'read_ast_node', 'read_plan'],
  tester: ['read', 'grep', 'list', 'run', 'glob', 'tool_search', 'read_plan']
};
const HARNESS_ROLES = Object.keys(ROLE_TOOL_POLICY);

function parseRunArgs(args) {
  const parsed = {
    task: '',
    model: undefined,
    maxSteps: 8,
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
    if (arg === '--max-steps') {
      parsed.maxSteps = Number(args[i + 1] || 8);
      i += 1;
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
  const allowed = ROLE_TOOL_POLICY[role];
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
      timeoutMs: config.gateway.timeout_ms || 90000,
      maxRetries: config.gateway.max_retries ?? 2
    });
}

async function buildSystemPrompt(config) {
  const soulPrompt = await buildSystemPromptWithSoul(buildDefaultSystemPrompt(config), config);
  const memorySnapshot = await buildMemorySnapshot({ config, workspaceRoot: process.cwd() }).catch(() => '');
  return [soulPrompt, memorySnapshot].filter(Boolean).join('\n\n');
}

async function runHarness({ role, task, config, systemPrompt, model, maxSteps }) {
  if (!HARNESS_ROLES.includes(role)) {
    throw new Error(`Unknown harness role: ${role}. Available: ${HARNESS_ROLES.join(', ')}`);
  }
  const { definitions, handlers, formatters, deferredDefinitions, dispose } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config
  });
  try {
    const filtered = filterToolsForRole(definitions, handlers, deferredDefinitions, role);
    const rolePrompt = getSubAgentRolePrompt(role);

    const result = await runAgentLoop({
      systemPrompt: `${systemPrompt}\n${rolePrompt}`,
      userPrompt: task,
      model: model || config.model.name,
      toolDefinitions: filtered.definitions,
      toolHandlers: filtered.handlers,
      toolFormatters: formatters,
      deferredDefinitions: filtered.deferredDefinitions,
      maxSteps,
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
      task: String(s?.task || '').trim()
    }))
    .filter((s) => s.title && s.task && HARNESS_ROLES.includes(s.role));
  if (cleaned.length === 0) {
    return { summary: `Fallback plan for: ${goal}`, steps: [{ title: 'Execute task', role: 'coder', task: goal }] };
  }
  return { summary: parsed.summary || `Plan for: ${goal}`, steps: cleaned };
}

async function planPipeline({ goal, config, systemPrompt, model }) {
  const plannerPrompt = [
    'Create an execution plan and assign the best sub-agent role for each step.',
    'Return strict JSON only with shape {"summary":"...","steps":[{"title":"...","role":"planner|advisor|coder|reviewer|tester","task":"..."}]}. No markdown.',
    `Available roles: ${HARNESS_ROLES.join(', ')}.`,
    'Prefer 3-5 steps total. The first step should usually inspect the target area.',
    'For implementation goals, include a reviewer or tester step near the end.',
    'For advisory/analysis goals, keep it lean with planner/advisor only; do not use coder unless code or files will be modified.'
  ].join('\n');

  const planning = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: model || config.model.name,
    messages: [
      { role: 'system', content: `${systemPrompt}\n${plannerPrompt}` },
      { role: 'user', content: `Plan the following task:\n${goal}` }
    ],
    timeoutMs: config.gateway.timeout_ms || 90000,
    maxRetries: config.gateway.max_retries ?? 2
  });

  const parsed = extractJsonBlock(planning.text || '');
  return normalizePlan(parsed, goal);
}

function writePipelineState(workspaceRoot, state) {
  const dir = path.join(workspaceRoot, '.codemini');
  const filePath = path.join(dir, 'pipeline-state.json');
  return fs.mkdir(dir, { recursive: true }).then(() =>
    fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8')
  ).catch(() => {});
}

async function runPipeline({ task, config, systemPrompt, model }) {
  console.log('[pipeline] Planning...');
  const plan = await planPipeline({ goal: task, config, systemPrompt, model });

  console.log(`[pipeline] Plan: ${plan.summary}`);
  plan.steps.forEach((s, i) => console.log(`  ${i + 1}. [${s.role}] ${s.title}`));
  console.log('');

  const priorSteps = [];
  const pipelineState = {
    goal: task,
    summary: plan.summary,
    steps: plan.steps.map((s) => ({ ...s, status: 'pending' })),
    artifacts: [],
    startedAt: new Date().toISOString()
  };

  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    pipelineState.steps[i].status = 'running';
    await writePipelineState(process.cwd(), pipelineState);

    console.log(`[pipeline] Step ${i + 1}/${plan.steps.length} -> ${step.role}: ${step.title}`);

    const result = await runHarness({
      role: step.role,
      task: step.task,
      config,
      systemPrompt,
      model,
      maxSteps: Number(config.execution?.max_steps || 12)
    });

    const stepResult = {
      role: step.role,
      title: step.title,
      output: (result.text || '').slice(0, 500),
      status: 'done'
    };
    priorSteps.push(stepResult);

    pipelineState.steps[i].status = 'done';
    pipelineState.steps[i].output = stepResult.output;
    pipelineState.artifacts.push(stepResult);
    await writePipelineState(process.cwd(), pipelineState);

    console.log(`[pipeline] Step ${i + 1} complete.\n`);
  }

  pipelineState.completedAt = new Date().toISOString();
  await writePipelineState(process.cwd(), pipelineState);

  console.log('[pipeline] All steps complete.');
  console.log(`[pipeline] State saved to .codemini/pipeline-state.json`);
  return pipelineState;
}

export async function handleRun(args) {
  const parsed = parseRunArgs(args);
  if (!parsed.task) {
    throw new Error('run requires <task>');
  }

  const config = await loadConfig();
  const systemPrompt = await buildSystemPrompt(config);

  if (parsed.pipeline) {
    const state = await runPipeline({
      task: parsed.task,
      config,
      systemPrompt,
      model: parsed.model
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
      model: parsed.model,
      maxSteps: parsed.maxSteps
    });
    console.log(result.text);
    return;
  }

  const { definitions, handlers, formatters, deferredDefinitions, dispose } = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config
  });
  try {
    const result = await runAgentLoop({
      systemPrompt,
      userPrompt: parsed.task,
      model: parsed.model || config.model.name,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      maxSteps: parsed.maxSteps,
      requestCompletion: makeCompletionFn(config)
    });

    console.log(result.text);
  } finally {
    await dispose?.();
  }
}
