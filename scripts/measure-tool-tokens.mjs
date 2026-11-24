/**
 * Count tokens Codemini actually attaches to a model request:
 * active tool JSON (OpenAI function shape) plus tool-related prompt text.
 * Deferred schemas are reported separately; they are sent only after tool_search.
 *
 *   node scripts/measure-tool-tokens.mjs
 *   node scripts/measure-tool-tokens.mjs --json
 *   node scripts/measure-tool-tokens.mjs --json out.json
 */
import fs from 'node:fs';
import { getEncoding } from 'js-tiktoken';
import { getBuiltinTools } from '../src/core/tools.js';
import {
  EXECUTION_MODE_TOOL_POLICY,
  ROLE_TOOL_POLICY,
  SUBAGENT_STABLE_SKILLS_PROMPT,
  applyCrewParentToolPolicy,
  adaptToolNamesForPlatform,
  buildExecutionModePromptBlock,
  resolveExecutionModeAllowedTools,
  resolveSubAgentToolAllowList,
} from '../src/core/chat-runtime.js';
import { buildDefaultSystemPrompt, } from '../src/core/default-system-prompt.js';
import {
  buildSubAgentRuntimeNote,
  buildSubAgentShellRulesPrompt,
  getShellSystemPrompt,
  resolveShellContext,
} from '../src/core/shell-profile.js';
import { canonicalShellToolName, toolNameAllowed } from '../src/core/shell-tool-name.js';
import { getSearchFewShotBlock, getWebToolGuidance, normalizeToolPolicy } from '../src/core/provider/search-tool-registry.js';
import { createCodingTurnPolicy, isCodingTurnToolAllowed, buildCodingTurnPolicyBlock } from '../src/core/coding-turn-policy.js';
import { buildCrewModePromptBlock } from '../src/core/crew-store.js';
import {
  createReadArtifactDefinition,
  createSubmitCandidatesDefinition,
  createSubmitCriterionReviewDefinition,
} from '../src/core/research-investigation.js';
import {
  createResearchWebFetchDefinition,
  createResearchWebSearchDefinition,
} from '../src/core/research-tools.js';
import { researchSubmitDefinitions } from '../src/core/research-runtime.js';

const encoding = getEncoding('o200k_base');
// Fixed root so prompt-example token counts do not depend on the machine path.
const AUDIT_CWD = '/workspace';
const CREW_WORKER_CWD = '/workspace/.codemini/crew/worktrees/worker';

export function countTokens(text) {
  const value = String(text ?? '');
  if (!value) return 0;
  return encoding.encode(value).length;
}

function toolName(definition) {
  return String(definition?.function?.name || definition?.name || '').trim();
}

export function measureToolDefinition(definition) {
  const fn = definition?.function || {};
  const description = String(fn.description || '');
  const parameters = fn.parameters || {};
  const wire = JSON.stringify(definition);
  return {
    name: toolName(definition),
    descriptionTokens: countTokens(description),
    schemaTokens: countTokens(JSON.stringify(parameters)),
    wireTokens: countTokens(wire),
  };
}

function sumWire(definitions) {
  return (definitions || []).reduce((total, definition) => total + measureToolDefinition(definition).wireTokens, 0);
}

function toolSection(shellPrompt) {
  const marker = '# Tool discipline';
  const index = String(shellPrompt || '').indexOf(marker);
  if (index < 0) return '';
  return shellPrompt.slice(index).trim();
}

function parentToolPrompt({ platform, config, mode, crewActive }) {
  const shellContext = resolveShellContext(config, { platform, cwd: AUDIT_CWD });
  const full = buildDefaultSystemPrompt(config, { platform, workspaceRoot: AUDIT_CWD });
  const shell = getShellSystemPrompt(shellContext.shell, shellContext.commandPlatform);
  const blocks = {
    toolDiscipline: toolSection(shell),
    toolExamples: full.includes('# Tool call examples')
      ? full.slice(full.indexOf('# Tool call examples'), full.indexOf('# Web tools')).trim()
      : '',
    webTools: getWebToolGuidance(config),
    searchFewShot: getSearchFewShotBlock(config),
    executionMode: mode === 'crew' ? '' : buildExecutionModePromptBlock(mode, shellContext.commandPlatform, shellContext.shell),
    crewMode: crewActive ? buildCrewModePromptBlock({ active: true, base: 'main' }) : '',
    codingTurn: buildCodingTurnPolicyBlock(createCodingTurnPolicy({ text: '', crewActive })),
  };
  const text = Object.values(blocks).filter(Boolean).join('\n\n');
  return { blocks, tokens: countTokens(text), text };
}

function subagentToolPrompt({ config, role, allow }) {
  const shell = buildSubAgentShellRulesPrompt(allow, {
    shell: config?.shell?.default,
    workspaceRoot: AUDIT_CWD,
    config,
  });
  const note = buildSubAgentRuntimeNote(allow, {
    shell: config?.shell?.default,
    workspaceRoot: AUDIT_CWD,
    role,
    config,
  });
  const text = [shell, SUBAGENT_STABLE_SKILLS_PROMPT, note].filter(Boolean).join('\n\n');
  return { tokens: countTokens(text), text };
}

function callbacksFor({ engineering, crewActive }) {
  return {
    requestUserInput: async () => ({}),
    ...(engineering || crewActive ? { onRunSubAgent: async () => ({}) } : {}),
    ...(engineering && !crewActive ? { onForkTask: async () => ({}) } : {}),
    ...(crewActive ? {
      onLandWorkers: async () => ({}),
      onRebaseCrewMission: async () => ({}),
      onCancelWorker: async () => ({}),
    } : {}),
  };
}

function loadBundle({ platform, config, crewActive, engineering, workspaceRoot, codewiki = false }) {
  return getBuiltinTools({
    workspaceRoot: workspaceRoot || AUDIT_CWD,
    platform,
    config: codewiki
      ? { ...config, runtime: { ...(config?.runtime || {}), codewiki_comment_tools: true } }
      : config,
    crewActive,
    ...callbacksFor({ engineering, crewActive }),
  });
}

function hideDormantPlanTools(bundle, { planState = false } = {}) {
  if (planState) return bundle;
  return {
    ...bundle,
    definitions: (bundle.definitions || []).filter((definition) => toolName(definition) !== 'update_plan'),
  };
}

function parentAllowList({ mode, crewActive, config, commandPlatform }) {
  if (mode === 'normal') return null;
  const policy = createCodingTurnPolicy({ text: '', crewActive });
  const planned = EXECUTION_MODE_TOOL_POLICY.plan.filter((name) => isCodingTurnToolAllowed(policy, name));
  const requested = crewActive ? applyCrewParentToolPolicy(planned, { crewActive: true }) : planned;
  if (mode === 'crew') {
    return adaptToolNamesForPlatform(
      normalizeToolPolicy(requested, config).map(canonicalShellToolName),
      commandPlatform,
      { promoteInspection: false },
    );
  }
  return resolveExecutionModeAllowedTools(mode, requested, config, commandPlatform);
}

function splitSent(bundle, allow) {
  const active = bundle.definitions || [];
  const deferred = Object.values(bundle.deferredDefinitions || {});
  if (!Array.isArray(allow)) {
    return { sent: active, deferred };
  }
  return {
    sent: active.filter((definition) => toolNameAllowed(allow, toolName(definition))),
    deferred: deferred.filter((definition) => allow.includes(toolName(definition))),
  };
}

const HOSTS = [
  {
    id: 'linux',
    platform: 'linux',
    config: { sandbox: { enabled: false }, shell: { default: 'bash' }, web: { search_enabled: true } },
  },
  {
    id: 'win32',
    platform: 'win32',
    config: { sandbox: { enabled: false }, shell: { default: 'powershell' }, web: { search_enabled: true } },
  },
  {
    id: 'win32-vm',
    platform: 'win32',
    config: {
      sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
      shell: { default: 'bash' },
      web: { search_enabled: true },
    },
  },
];

function hostContext(host) {
  const shellContext = resolveShellContext(host.config, { platform: host.platform, cwd: AUDIT_CWD });
  return { ...host, commandPlatform: shellContext.commandPlatform };
}

export function measureParentModes() {
  const modes = [];
  for (const host of HOSTS.map(hostContext)) {
    for (const mode of ['normal', 'plan', 'crew']) {
      const crewActive = mode === 'crew';
      const engineering = mode !== 'normal';
      const bundle = hideDormantPlanTools(loadBundle({
        platform: host.platform,
        config: host.config,
        crewActive,
        engineering,
      }));
      const allow = parentAllowList({
        mode,
        crewActive,
        config: host.config,
        commandPlatform: host.commandPlatform,
      });
      const split = splitSent(bundle, allow);
      const prompt = parentToolPrompt({
        platform: host.platform,
        config: host.config,
        mode,
        crewActive,
      });
      const activeWire = sumWire(split.sent);
      modes.push({
        id: `${host.id}:${mode}`,
        host: host.id,
        mode,
        commandPlatform: host.commandPlatform,
        activeCount: split.sent.length,
        activeTools: split.sent.map(toolName),
        deferredCount: split.deferred.length,
        deferredTools: split.deferred.map(toolName),
        activeWireTokens: activeWire,
        deferredWireTokens: sumWire(split.deferred),
        toolPromptTokens: prompt.tokens,
        sentTokens: activeWire + prompt.tokens,
        promptBlocks: Object.fromEntries(
          Object.entries(prompt.blocks).map(([key, value]) => [key, countTokens(value)]),
        ),
      });
    }
  }
  return modes;
}

function pushRole(roles, host, role, bundle, { crewSession = false, idPrefix = host.id } = {}) {
  const allow = resolveSubAgentToolAllowList({
    role,
    config: host.config,
    platform: host.commandPlatform,
    crewSession,
  });
  const visible = hideDormantPlanTools(bundle);
  const split = splitSent(visible, allow);
  const prompt = subagentToolPrompt({ config: host.config, role, allow });
  const activeWire = sumWire(split.sent);
  roles.push({
    id: `${idPrefix}:${role}`,
    host: host.id,
    role,
    activeCount: split.sent.length,
    activeTools: split.sent.map(toolName),
    deferredCount: split.deferred.length,
    deferredTools: split.deferred.map(toolName),
    activeWireTokens: activeWire,
    deferredWireTokens: sumWire(split.deferred),
    toolPromptTokens: prompt.tokens,
    sentTokens: activeWire + prompt.tokens,
  });
}

export function measureRoles() {
  const roles = [];
  for (const host of HOSTS.filter((item) => item.id !== 'win32-vm').map(hostContext)) {
    const bundle = loadBundle({
      platform: host.platform,
      config: host.config,
      crewActive: false,
      engineering: false,
    });
    const codewikiBundle = loadBundle({
      platform: host.platform,
      config: host.config,
      crewActive: false,
      engineering: false,
      codewiki: true,
    });
    const workerBundle = loadBundle({
      platform: host.platform,
      config: { ...host.config, runtime: { crew_session: true } },
      crewActive: false,
      engineering: false,
      workspaceRoot: CREW_WORKER_CWD,
    });
    for (const role of Object.keys(ROLE_TOOL_POLICY)) {
      pushRole(roles, host, role, role === 'codewiki' ? codewikiBundle : bundle);
    }
    for (const role of ['coder', 'survey', 'reviewer']) {
      pushRole(roles, host, role, workerBundle, { crewSession: true, idPrefix: `${host.id}:crew-worker` });
    }
  }
  return roles;
}

export function measureCatalog(host = HOSTS[0]) {
  const bundle = loadBundle({
    platform: host.platform,
    config: host.config,
    crewActive: true,
    engineering: true,
    workspaceRoot: CREW_WORKER_CWD,
  });
  const seen = new Map();
  for (const definition of bundle.definitions || []) {
    const name = toolName(definition);
    seen.set(name, {
      ...measureToolDefinition(definition),
      exposure: name === 'update_plan' ? 'conditional' : 'active',
    });
  }
  for (const definition of Object.values(bundle.deferredDefinitions || {})) {
    const name = toolName(definition);
    if (!seen.has(name)) seen.set(name, { ...measureToolDefinition(definition), exposure: 'deferred' });
  }
  return {
    host: host.id,
    tools: [...seen.values()].sort((a, b) => b.wireTokens - a.wireTokens),
  };
}

function measureLegacy(platform, config) {
  const bundle = getBuiltinTools({
    workspaceRoot: AUDIT_CWD,
    platform,
    config,
    onCreatePlan: async () => ({}),
    getPlanState: () => ({ status: 'running', goal: 'measure', steps: [] }),
  });
  const names = new Set(['create_plan', 'update_plan']);
  return (bundle.definitions || [])
    .filter((definition) => names.has(toolName(definition)))
    .map((definition) => ({ ...measureToolDefinition(definition), exposure: 'legacy-active' }));
}

export function measureResearch() {
  const groups = {
    scout: [
      createResearchWebSearchDefinition(),
      createResearchWebFetchDefinition(),
      createReadArtifactDefinition(),
      createSubmitCandidatesDefinition(),
    ],
    evaluator: [createReadArtifactDefinition(), createSubmitCriterionReviewDefinition()],
    planning: researchSubmitDefinitions('planning'),
    investigating: researchSubmitDefinitions('investigating'),
    writing: researchSubmitDefinitions('writing'),
  };
  return Object.entries(groups).map(([id, definitions]) => ({
    id: `research:${id}`,
    activeCount: definitions.length,
    activeTools: definitions.map(toolName),
    activeWireTokens: sumWire(definitions),
    tools: definitions.map(measureToolDefinition),
    toolPromptTokens: 0,
    sentTokens: sumWire(definitions),
  }));
}

export function measureMcpWrapperOverhead() {
  const bare = 'Read a page.';
  const wrapped = '[MCP: docs] Read a page.';
  return {
    prefixTokens: countTokens(wrapped) - countTokens(bare),
    sample: wrapped,
  };
}

export function measureAll() {
  const linux = HOSTS[0];
  const win = HOSTS[1];
  return {
    tokenizer: 'o200k_base',
    wire: 'JSON.stringify of the OpenAI {type,function} tool object',
    catalog: {
      linux: measureCatalog(linux),
      win32: measureCatalog(win),
    },
    legacy: {
      linux: measureLegacy(linux.platform, linux.config),
      win32: measureLegacy(win.platform, win.config),
    },
    modes: measureParentModes(),
    roles: measureRoles(),
    research: measureResearch(),
    mcpWrapper: measureMcpWrapperOverhead(),
  };
}

function pad(value, width) {
  return String(value).padStart(width);
}

function printReport(report) {
  const catalog = report.catalog.linux.tools;
  console.log(`tokenizer: ${report.tokenizer}`);
  console.log(`wire: ${report.wire}`);
  console.log('\n## Linux catalog (crew parent + engineering callbacks; grep/glob active)');
  console.log('tool'.padEnd(28) + pad('desc', 8) + pad('schema', 8) + pad('wire', 8) + '  exposure');
  for (const tool of catalog) {
    console.log(
      tool.name.padEnd(28)
      + pad(tool.descriptionTokens, 8)
      + pad(tool.schemaTokens, 8)
      + pad(tool.wireTokens, 8)
      + `  ${tool.exposure}`,
    );
  }
  const linuxWire = catalog.reduce((total, tool) => total + tool.wireTokens, 0);
  console.log(`${'TOTAL'.padEnd(28)}${''.padStart(16)}${pad(linuxWire, 8)}`);

  console.log('\n## Windows catalog differences (wire tokens, win32 sandbox off)');
  const winByName = new Map(report.catalog.win32.tools.map((tool) => [tool.name, tool]));
  for (const tool of catalog) {
    const other = winByName.get(tool.name);
    if (!other) continue;
    const delta = other.wireTokens - tool.wireTokens;
    if (delta !== 0) {
      console.log(`${tool.name.padEnd(28)} linux ${pad(tool.wireTokens, 5)}  win32 ${pad(other.wireTokens, 5)}  delta ${pad(delta, 5)}`);
    }
  }

  console.log('\n## Legacy opt-in tools (linux wire)');
  for (const tool of report.legacy.linux) {
    console.log(`${tool.name.padEnd(28)}${pad(tool.descriptionTokens, 8)}${pad(tool.schemaTokens, 8)}${pad(tool.wireTokens, 8)}`);
  }

  console.log('\n## Parent modes (active wire + tool-related prompt = sent)');
  console.log('mode'.padEnd(22) + pad('tools', 7) + pad('active', 8) + pad('prompt', 8) + pad('sent', 8) + pad('deferred', 10));
  for (const mode of report.modes) {
    console.log(
      mode.id.padEnd(22)
      + pad(mode.activeCount, 7)
      + pad(mode.activeWireTokens, 8)
      + pad(mode.toolPromptTokens, 8)
      + pad(mode.sentTokens, 8)
      + pad(mode.deferredWireTokens, 10),
    );
  }

  console.log('\n## Roles (linux / win32 sent = active allow-list + subagent tool prompt)');
  console.log('role'.padEnd(28) + pad('linux', 8) + pad('win32', 8));
  const linuxRoles = report.roles.filter((role) => role.host === 'linux');
  const winRoles = new Map(report.roles.filter((role) => role.host === 'win32').map((role) => [role.id.replace('win32:', ''), role]));
  for (const role of linuxRoles) {
    const key = role.id.replace('linux:', '');
    console.log(key.padEnd(28) + pad(role.sentTokens, 8) + pad(winRoles.get(key)?.sentTokens ?? '', 8));
  }

  console.log('\n## Research tool groups (schemas only; prompts live in the research loop)');
  for (const group of report.research) {
    console.log(`${group.id.padEnd(28)}${pad(group.activeWireTokens, 8)}  ${group.activeTools.join(', ')}`);
  }
  console.log(`\nMCP description prefix overhead: ${report.mcpWrapper.prefixTokens} tokens (${report.mcpWrapper.sample})`);
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('measure-tool-tokens.mjs');
if (invokedDirectly) {
  const report = measureAll();
  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1) {
    const target = process.argv[jsonFlag + 1] && !process.argv[jsonFlag + 1].startsWith('--')
      ? process.argv[jsonFlag + 1]
      : '';
    const body = JSON.stringify(report, null, 2);
    if (target) fs.writeFileSync(target, body);
    else console.log(body);
  } else {
    printReport(report);
  }
}
