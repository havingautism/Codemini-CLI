import { normalizeMemoryText, segmentSearchText } from './memory-policy.js';

const EXPANSION_GROUPS = Object.freeze([
  ['test', 'tests', 'testing', 'unit-test', 'unittest', '单测', '测试', 'vitest', 'jest'],
  ['install', 'dependency', 'dependencies', 'package', '安装', '依赖', 'npm', 'pnpm'],
  ['build', 'compile', 'bundle', '构建', '编译', '打包'],
  ['lint', 'format', 'eslint', '格式化', '检查'],
  ['windows', 'powershell', 'pwsh', 'win32'],
  ['sandbox', 'microsandbox', 'microvm', '沙箱', '隔离'],
  ['error', 'failure', 'failed', 'bug', 'fix', '报错', '失败', '错误', '修复'],
  ['start', 'run', 'launch', '启动', '运行'],
  ['config', 'configuration', 'setting', 'settings', '配置', '设置']
]);

const TERM_TO_GROUP = new Map();
for (const group of EXPANSION_GROUPS) {
  for (const term of group) TERM_TO_GROUP.set(term.toLowerCase(), group);
}

function queryTerms(value) {
  return segmentSearchText(value)
    .split(/\s+/)
    .map((term) => term.toLowerCase())
    .filter((term) => /[\p{L}\p{N}]/u.test(term));
}

export function expandMemoryQuery(query, context = {}) {
  const original = normalizeMemoryText(query);
  if (!original) return '';
  const contextual = [context.project, context.platform, context.shell, context.tool, context.errorClass]
    .map(normalizeMemoryText)
    .filter(Boolean);
  const terms = queryTerms([original, ...contextual].join(' '));
  const expanded = [];
  const seen = new Set();
  const add = (term) => {
    const normalized = String(term || '').trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    expanded.push(normalized);
  };
  for (const term of terms) add(term);
  for (const term of terms) {
    for (const alias of TERM_TO_GROUP.get(term) || []) add(alias);
  }
  const originalLower = original.toLowerCase();
  for (const group of EXPANSION_GROUPS) {
    const matchesCjkPhrase = group.some((alias) => /[^\x00-\x7f]/.test(alias) && originalLower.includes(alias));
    if (matchesCjkPhrase) for (const alias of group) add(alias);
  }
  return expanded.slice(0, 24).join(' ');
}
