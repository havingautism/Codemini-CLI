import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigFilePath } from './paths.js';
import { normalizeReplyLanguage } from './reply-language.js';
import { normalizeShellName } from './shell-profile.js';
import {
  MEMORY_ALWAYS_ALLOW_TOOLS,
  STAGED_WRITE_ALWAYS_ALLOW_TOOLS
} from './constants.js';
import { normalizeReasoningEffort } from './provider/reasoning-effort.js';
import { normalizeSkillContexts } from './skill-contexts.js';

function normalizeUiLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'zh';
  if (['en', 'en-us', 'en_us', 'english'].includes(raw)) return 'en';
  if (['zh', 'zh-cn', 'zh_cn', 'cn', 'chinese'].includes(raw)) return 'zh';
  return 'zh';
}

const DEFAULT_CONFIG = {
  sdk: {
    provider: 'openai-compatible'
  },
  gateway: {
    base_url: 'http://127.0.0.1:8000/v1',
    api_key: '',
    timeout_ms: 1800000,
    max_retries: 2
  },
  model: {
    name: 'gpt-4.1-mini',
    fast_name: '',
    reasoning_enabled: true,
    reasoning_effort: 'auto',
    max_context_tokens: 202752
  },
  context: {
    max_tokens: 32000,
    preflight_trigger_pct: 60,
    hard_limit_pct: 98,
    tool_result_max_chars: 12000,
    read_file_default_lines: 120,
    read_file_max_chars: 12000,
    prompt_budget_audit: false,
    microcompact_enabled: true,
    microcompact_keep_recent: 5,
    aggressive_tool_prune_beta: false,
    aggressive_tool_prune_keep_recent: 3,
    aggressive_tool_prune_trigger_extra: 2,
    aggressive_tool_prune_summary_head: 600,
    aggressive_tool_prune_summary_tail: 240,
    project_context_enabled: true,
    project_instructions_enabled: true,
    project_instructions_max_chars: 12000
  },
  execution: {
    mode: 'normal',
    approval_mode: 'review',
    plan_execution_model: 'default',
    always_allow_tools: [
      'read',
      'search_code',
      'list_background_tasks',
      'get_background_task',
      ...STAGED_WRITE_ALWAYS_ALLOW_TOOLS,
      ...MEMORY_ALWAYS_ALLOW_TOOLS
    ]
  },
  tools: {
    write_chunk_max_chars: 12000,
    staged_write_max_chars: 4194304
  },
  sessions: {
    max_sessions: 100,
    retention_days: 30
  },
  shell: {
    default: normalizeShellName(process.platform === 'win32' ? 'powershell' : 'bash'),
    timeout_ms: 1800000
  },
  ui: {
    language: 'zh',
    reply_language: 'zh'
  },
  memory: {
    enabled: true,
    auto_write: true,
    auto_capture: true,
    inject_on_session_start: true,
    auto_dream_threshold: 10,
    max_items_per_scope: 12,
    max_prompt_chars: 4000,
    max_user_chars: 1375,
    max_global_chars: 2200,
    max_project_chars: 2200,
    project_binding: 'path-or-alias',
    background_review: {
      enabled: true,
      on_start: true,
      after_turn: true,
      max_sessions_per_run: 3,
      idle_delay_ms: 1500,
      min_session_idle_ms: 30000,
      max_input_chars: 12000,
      lease_ms: 120000
    }
  },
  soul: {
    coding: 'Default',
    daily: 'Playful',
    custom_path: ''
  },
  web: {
    search_enabled: true,
    search_provider: 'bing_rss',
    search_api_key: '',
    tavily_api_key: '',
    exa_api_key: ''
  },
  webui: {
    sidebar: {
      active_project_dirs: []
    }
  },
  policy: {
    safe_mode: true,
    allow_dangerous_commands: false,
    allowed_paths: [],
    command_allowlist: [],
    blocked_commands: [],
    blocked_path_patterns: [],
    blocked_command_patterns: ['rm -rf /', 'format c:', 'del /f /s /q C:\\\\']
  },
  skills: {
    enabled: {},
    contexts: {}
  },
  mcp: {
    servers: []
  }
};

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, extra) {
  if (!isObject(base) || !isObject(extra)) {
    return extra;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    if (k in out) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function uniqueStrings(items = []) {
  const out = [];
  const seen = new Set();
  for (const it of items) {
    const v = String(it || '').trim();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function normalizedNumber(value, fallback, minimum = 0, { integer = false } = {}) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  const bounded = Math.max(minimum, finite);
  return integer ? Math.floor(bounded) : bounded;
}

function normalizePolicyLists(config) {
  const next = structuredClone(config);
  next.sdk = next.sdk || {};
  next.sdk.provider = ['openai-compatible', 'anthropic'].includes(String(next.sdk.provider || '').toLowerCase())
    ? String(next.sdk.provider).toLowerCase()
    : 'openai-compatible';
  next.shell = next.shell || {};
  next.shell.default = normalizeShellName(next.shell.default);
  next.execution = next.execution || {};
  next.model = next.model || {};
  if (typeof next.model.fast_name !== 'string' && typeof next.model.lite_name === 'string') {
    next.model.fast_name = next.model.lite_name;
  }
  next.model.name = String(next.model.name || DEFAULT_CONFIG.model.name).trim() || DEFAULT_CONFIG.model.name;
  next.model.fast_name = String(next.model.fast_name || '').trim();
  const legacyReasoningOff = String(next.model.reasoning_effort || '').trim().toLowerCase() === 'off';
  next.model.reasoning_enabled = legacyReasoningOff
    ? false
    : next.model.reasoning_enabled !== false && next.model.reasoning_enabled !== 'false';
  next.model.reasoning_effort = normalizeReasoningEffort(next.model.reasoning_effort);
  const rawExecutionMode = String(next.execution.mode || '').toLowerCase();
  const rawApprovalMode = String(next.execution.approval_mode || '').toLowerCase().replace(/-/g, '_');
  next.execution.mode = rawExecutionMode === 'spec'
    ? 'plan'
    : (['normal', 'plan'].includes(rawExecutionMode) ? rawExecutionMode : 'normal');
  next.execution.approval_mode = ['review', 'auto', 'full_access'].includes(rawApprovalMode)
    ? rawApprovalMode
    : 'review';
  const rawPlanExecutionModel = String(next.execution.plan_execution_model || '').toLowerCase();
  next.execution.plan_execution_model = ['default', 'fast', 'role'].includes(rawPlanExecutionModel)
    ? rawPlanExecutionModel
    : 'default';
  const rawTools = Array.isArray(next.execution.always_allow_tools)
    ? next.execution.always_allow_tools
    : [];
  next.execution.always_allow_tools = uniqueStrings(
    [
      'read',
      'search_code',
      'list_background_tasks',
      'get_background_task',
      ...MEMORY_ALWAYS_ALLOW_TOOLS,
      ...STAGED_WRITE_ALWAYS_ALLOW_TOOLS,
      ...rawTools
    ].filter((name) => String(name) !== 'list_files')
      .filter((name) => !['edit', 'create', 'write', 'commit_write', 'apply_patch', 'delete', 'run', 'stop_background_task'].includes(String(name)))
  );
  next.ui = next.ui || {};
  next.ui.language = normalizeUiLanguage(next.ui.language);
  next.ui.reply_language = normalizeReplyLanguage(next.ui.reply_language);
  next.skills = next.skills || {};
  next.skills.enabled = isObject(next.skills.enabled) ? next.skills.enabled : {};
  const rawContexts = isObject(next.skills.contexts) ? next.skills.contexts : {};
  next.skills.contexts = Object.fromEntries(
    Object.entries(rawContexts).map(([name, value]) => [name, normalizeSkillContexts(value)])
  );
  delete next.skills.applicability;
  next.mcp = next.mcp || {};
  next.mcp.servers = Array.isArray(next.mcp.servers)
    ? next.mcp.servers.filter((server) => isObject(server))
    : [];
  next.memory = next.memory || {};
  next.memory.enabled = next.memory.enabled !== false;
  next.memory.auto_write = next.memory.auto_write !== false;
  next.memory.auto_capture = next.memory.auto_capture !== false;
  next.memory.inject_on_session_start = next.memory.inject_on_session_start !== false;
  next.memory.max_items_per_scope = Math.max(1, Number(next.memory.max_items_per_scope || 12));
  next.memory.auto_dream_threshold = Number(next.memory.auto_dream_threshold ?? 10);
  next.memory.max_prompt_chars = Math.max(200, Number(next.memory.max_prompt_chars || 4000));
  next.memory.max_user_chars = Math.max(80, Number(next.memory.max_user_chars || 1375));
  next.memory.max_global_chars = Math.max(80, Number(next.memory.max_global_chars || 2200));
  next.memory.max_project_chars = Math.max(80, Number(next.memory.max_project_chars || 2200));
  next.memory.project_binding = ['path', 'alias', 'path-or-alias'].includes(String(next.memory.project_binding || ''))
    ? String(next.memory.project_binding)
    : 'path-or-alias';
  next.memory.background_review = next.memory.background_review || {};
  next.memory.background_review.enabled = next.memory.background_review.enabled !== false;
  next.memory.background_review.on_start = next.memory.background_review.on_start !== false;
  next.memory.background_review.after_turn = next.memory.background_review.after_turn !== false;
  next.memory.background_review.max_sessions_per_run = Math.max(1, Number(next.memory.background_review.max_sessions_per_run || 3));
  next.memory.background_review.idle_delay_ms = Math.max(0, Number(next.memory.background_review.idle_delay_ms ?? 1500));
  next.memory.background_review.min_session_idle_ms = Math.max(0, Number(next.memory.background_review.min_session_idle_ms ?? 30000));
  next.memory.background_review.max_input_chars = Math.max(2000, Number(next.memory.background_review.max_input_chars || 12000));
  next.memory.background_review.lease_ms = Math.max(30000, Number(next.memory.background_review.lease_ms || 120000));
  next.context = next.context || {};
  next.context.prompt_budget_audit = next.context.prompt_budget_audit === true;
  next.context.aggressive_tool_prune_beta = next.context.aggressive_tool_prune_beta === true;
  next.context.aggressive_tool_prune_keep_recent = normalizedNumber(
    next.context.aggressive_tool_prune_keep_recent,
    DEFAULT_CONFIG.context.aggressive_tool_prune_keep_recent,
    1,
    { integer: true }
  );
  next.context.aggressive_tool_prune_trigger_extra = normalizedNumber(
    next.context.aggressive_tool_prune_trigger_extra,
    DEFAULT_CONFIG.context.aggressive_tool_prune_trigger_extra,
    0,
    { integer: true }
  );
  next.context.aggressive_tool_prune_summary_head = normalizedNumber(
    next.context.aggressive_tool_prune_summary_head,
    DEFAULT_CONFIG.context.aggressive_tool_prune_summary_head,
    80,
    { integer: true }
  );
  next.context.aggressive_tool_prune_summary_tail = normalizedNumber(
    next.context.aggressive_tool_prune_summary_tail,
    DEFAULT_CONFIG.context.aggressive_tool_prune_summary_tail,
    0,
    { integer: true }
  );
  next.context.project_context_enabled = next.context.project_context_enabled !== false;
  next.web = next.web || {};
  next.web.search_enabled = next.web.search_enabled !== false;
  const rawSearchProvider = String(next.web.search_provider || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  next.web.search_provider = ['bing_rss', 'bing', 'tavily', 'exa'].includes(rawSearchProvider)
    ? (rawSearchProvider === 'bing' ? 'bing_rss' : rawSearchProvider)
    : 'bing_rss';
  next.web.search_api_key = String(next.web.search_api_key || '').trim();
  next.web.tavily_api_key = String(next.web.tavily_api_key || '').trim();
  next.web.exa_api_key = String(next.web.exa_api_key || '').trim();
  next.webui = next.webui || {};
  next.webui.sidebar = next.webui.sidebar || {};
  next.webui.sidebar.active_project_dirs = uniqueStrings(
    Array.isArray(next.webui.sidebar.active_project_dirs) ? next.webui.sidebar.active_project_dirs : []
  );
  next.policy = next.policy || {};
  next.policy.command_allowlist = uniqueStrings(
    Array.isArray(next.policy.command_allowlist) ? next.policy.command_allowlist : []
  );
  next.policy.allowed_paths = uniqueStrings(
    Array.isArray(next.policy.allowed_paths) ? next.policy.allowed_paths : []
  );
  next.policy.blocked_commands = uniqueStrings(
    Array.isArray(next.policy.blocked_commands) ? next.policy.blocked_commands : []
  );
  next.policy.blocked_path_patterns = uniqueStrings(
    Array.isArray(next.policy.blocked_path_patterns) ? next.policy.blocked_path_patterns : []
  );
  return next;
}

function getNested(obj, keyPath) {
  return keyPath.split('.').reduce((acc, k) => (acc && k in acc ? acc[k] : undefined), obj);
}

function parseValue(input) {
  if (typeof input !== 'string') return input;
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
  if ((input.startsWith('[') && input.endsWith(']')) || (input.startsWith('{') && input.endsWith('}'))) {
    try {
      return JSON.parse(input);
    } catch {
      return input;
    }
  }
  if (!Number.isNaN(Number(input)) && input.trim() !== '') return Number(input);
  return input;
}

function setNested(obj, keyPath, rawValue) {
  const value = parseValue(rawValue);
  const parts = keyPath.split('.');
  let cursor = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    if (!isObject(cursor[p])) {
      cursor[p] = {};
    }
    cursor = cursor[p];
  }
  cursor[parts[parts.length - 1]] = value;
}

let cachedConfig = null;
let cachedConfigStat = null;

function migrateSoulConfig(parsed = {}) {
  const soul = parsed?.soul;
  if (!soul || typeof soul !== 'object') return parsed;
  const legacy = String(soul.preset || '').trim();
  if (!legacy) return parsed;
  const hasCoding = Object.prototype.hasOwnProperty.call(soul, 'coding');
  const hasDaily = Object.prototype.hasOwnProperty.call(soul, 'daily');
  if (!hasCoding) soul.coding = legacy;
  if (!hasDaily) soul.daily = legacy;
  return parsed;
}

export async function loadConfig() {
  const configPath = getConfigFilePath();
  try {
    const stat = await fs.stat(configPath).catch(() => null);
    const mtime = stat ? stat.mtimeMs : 0;
    const size = stat ? stat.size : 0;
    if (cachedConfig && cachedConfigStat && cachedConfigStat.mtime === mtime && cachedConfigStat.size === size) {
      return structuredClone(cachedConfig);
    }
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = migrateSoulConfig(JSON.parse(raw));
    const config = normalizePolicyLists(deepMerge(DEFAULT_CONFIG, parsed));
    cachedConfig = config;
    cachedConfigStat = { mtime, size };
    return structuredClone(config);
  } catch {
    const defaultConfig = normalizePolicyLists(structuredClone(DEFAULT_CONFIG));
    await saveConfig(defaultConfig);
    return defaultConfig;
  }
}

export async function saveConfig(config) {
  const configPath = getConfigFilePath();
  await ensureDir(configPath);
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  cachedConfig = normalizePolicyLists(structuredClone(config));
  const stat = await fs.stat(configPath).catch(() => null);
  cachedConfigStat = stat ? { mtime: stat.mtimeMs, size: stat.size } : null;
}

export async function setConfigValue(keyPath, value) {
  const config = await loadConfig();
  setNested(config, keyPath, value);
  await saveConfig(config);
}

export async function getConfigValue(keyPath) {
  const config = await loadConfig();
  return getNested(config, keyPath);
}

export async function resetConfig() {
  await saveConfig(structuredClone(DEFAULT_CONFIG));
}
