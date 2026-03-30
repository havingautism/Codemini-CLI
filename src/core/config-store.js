import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigFilePath, getLegacyConfigDir } from './paths.js';
import { normalizeReplyLanguage } from './reply-language.js';
import { normalizeShellName } from './shell-profile.js';

function normalizeUiLanguage(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'zh';
  if (['en', 'en-us', 'en_us', 'english'].includes(raw)) return 'en';
  if (['zh', 'zh-cn', 'zh_cn', 'cn', 'chinese'].includes(raw)) return 'zh';
  return 'zh';
}

const DEFAULT_CONFIG = {
  gateway: {
    base_url: 'http://127.0.0.1:8000/v1',
    api_key: '',
    timeout_ms: 90000,
    max_retries: 2
  },
  model: {
    name: 'gpt-4.1-mini',
    max_context_tokens: 202752
  },
  context: {
    max_tokens: 32000,
    preflight_trigger_pct: 92,
    hard_limit_pct: 98,
    tool_result_max_chars: 12000,
    read_file_default_lines: 220,
    read_file_max_chars: 24000
  },
  execution: {
    mode: 'auto',
    always_allow_tools: [
      'read',
      'grep',
      'glob',
      'list',
      'edit',
      'write',
      'run',
      'patch',
      'generate_diff',
      'start_service',
      'list_services',
      'get_service_status',
      'get_service_logs',
      'stop_service'
    ],
    max_steps: 16
  },
  sessions: {
    max_sessions: 100,
    retention_days: 30
  },
  shell: {
    default: normalizeShellName(process.platform === 'win32' ? 'powershell' : 'bash'),
    timeout_ms: 120000
  },
  ui: {
    language: 'zh',
    reply_language: 'zh'
  },
  soul: {
    preset: 'default',
    custom_path: ''
  },
  policy: {
    safe_mode: true,
    allow_dangerous_commands: false,
    command_allowlist: [],
    blocked_commands: [],
    blocked_path_patterns: [],
    blocked_command_patterns: ['rm -rf /', 'format c:', 'del /f /s /q C:\\\\']
  },
  skills: {
    enabled: {}
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

function normalizePolicyLists(config) {
  const next = structuredClone(config);
  next.shell = next.shell || {};
  next.shell.default = normalizeShellName(next.shell.default);
  next.execution = next.execution || {};
  next.execution.mode = ['auto', 'normal', 'plan'].includes(String(next.execution.mode || '').toLowerCase())
    ? String(next.execution.mode).toLowerCase()
    : 'auto';
  const rawTools = Array.isArray(next.execution.always_allow_tools)
    ? next.execution.always_allow_tools
    : [];
  next.execution.always_allow_tools = uniqueStrings(
    [
      'read',
      'grep',
      'glob',
      'list',
      'edit',
      'write',
      'run',
      'generate_diff',
      'start_service',
      'list_services',
      'get_service_status',
      'get_service_logs',
      'stop_service',
      ...rawTools
    ].filter((name) => String(name) !== 'list_files')
  );
  next.ui = next.ui || {};
  next.ui.language = normalizeUiLanguage(next.ui.language);
  next.ui.reply_language = normalizeReplyLanguage(next.ui.reply_language);
  next.policy = next.policy || {};
  next.policy.command_allowlist = uniqueStrings(
    Array.isArray(next.policy.command_allowlist) ? next.policy.command_allowlist : []
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
  if (input === 'true') return true;
  if (input === 'false') return false;
  if (input === 'null') return null;
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

export async function loadConfig() {
  const configPath = getConfigFilePath();
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizePolicyLists(deepMerge(DEFAULT_CONFIG, parsed));
  } catch {
    const defaultConfig = normalizePolicyLists(structuredClone(DEFAULT_CONFIG));
    if (process.env.CODEMINI_GLOBAL_DIR) {
      await saveConfig(defaultConfig);
      return defaultConfig;
    }
    try {
      const legacyPath = path.join(getLegacyConfigDir(), 'config.json');
      const raw = await fs.readFile(legacyPath, 'utf8');
      const parsed = JSON.parse(raw);
      return normalizePolicyLists(deepMerge(DEFAULT_CONFIG, parsed));
    } catch {
      await saveConfig(defaultConfig);
      return defaultConfig;
    }
  }
}

export async function saveConfig(config) {
  const configPath = getConfigFilePath();
  await ensureDir(configPath);
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
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
