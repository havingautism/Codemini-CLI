import fs from 'node:fs/promises';
import path from 'node:path';
import { getFileIndexPath, getProjectIndexDir, getProjectMapPath, getProjectWorkspaceDir } from './paths.js';
import { INDEX_SKIP_DIRS as SKIP_DIRS, SOURCE_EXTENSIONS, EXTENSION_LANGUAGE_MAP } from './constants.js';
import { sha256 } from './crypto-utils.js';
import { BoundedCache } from './bounded-cache.js';
import { trimInline, normalizeRelativePath, escapeRegex } from './string-utils.js';
import { globFilesUnder } from './workspace-glob.js';
import {
  loadProjectFileIndexFromSqlite,
  loadProjectIndexFromSqlite,
  saveProjectIndexToSqlite
} from './project-index-sqlite-store.js';
import { refreshProjectKnowledgeGraph } from './project-knowledge-graph.js';
import { extractAstIndexFacts } from './ast.js';

const PROJECT_MARKER_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'pyproject.toml',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
  'composer.json',
  'Gemfile',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'Makefile',
  '.gitignore'
]);

const LANGUAGE_BY_EXT = EXTENSION_LANGUAGE_MAP;

const initCache = new BoundedCache({ maxSize: 32, ttlMs: 10 * 60 * 1000 });
const ignoreRulesCache = new BoundedCache({ maxSize: 128, ttlMs: 60 * 1000 });
const PROJECT_CONTEXT_MAX_FILES = 6;

function clipList(values, max = 32) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].slice(0, max);
}

function rel(cwd, filePath) {
  return normalizeRelativePath(path.relative(cwd, filePath));
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function mapAsyncLimit(values, concurrency, mapper) {
  const items = Array.isArray(values) ? values : [];
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await mapper(items[index], index);
      }
    }
  );
  await Promise.all(workers);
  return results;
}

const jsonCache = new BoundedCache({ maxSize: 64, ttlMs: 30 * 1000 });
const indexUpdateLocks = new Map();

async function safeReadJson(filePath, fallback) {
  try {
    const stat = await safeStat(filePath);
    if (!stat) return fallback;
    const cacheKey = `${filePath}:${Number(stat.mtimeMs || 0)}:${Number(stat.size || 0)}`;
    if (jsonCache.has(cacheKey)) {
      return jsonCache.get(cacheKey);
    }
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    jsonCache.set(cacheKey, data);
    return data;
  } catch {
    return fallback;
  }
}

function tokenizeQuery(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9_./-]+/g) || [])].filter(Boolean);
}

function trimMultiline(value, max = 1800) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

async function withProjectIndexLock(projectRoot, task) {
  const previous = indexUpdateLocks.get(projectRoot) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  indexUpdateLocks.set(projectRoot, current);
  try {
    return await current;
  } finally {
    if (indexUpdateLocks.get(projectRoot) === current) indexUpdateLocks.delete(projectRoot);
  }
}

function gitignorePatternToRegex(pattern) {
  const normalized = normalizeRelativePath(pattern);
  let regexBody = '';
  for (let index = 0; index < normalized.length; index += 1) {
    const ch = normalized[index];
    const next = normalized[index + 1];
    if (ch === '*') {
      if (next === '*') {
        regexBody += '.*';
        index += 1;
      } else {
        regexBody += '[^/]*';
      }
      continue;
    }
    if (ch === '?') {
      regexBody += '[^/]';
      continue;
    }
    regexBody += escapeRegex(ch);
  }
  return new RegExp(`^${regexBody}$`);
}

async function readIgnoreFileRules(cwd, fileName) {
  const filePath = path.join(cwd, fileName);
  const stat = await safeStat(filePath);
  const cacheKey = `${filePath}:${Number(stat?.mtimeMs || 0)}:${Number(stat?.size || 0)}`;
  if (ignoreRulesCache.has(cacheKey)) return ignoreRulesCache.get(cacheKey);

  for (const key of ignoreRulesCache.keys()) {
    if (String(key).startsWith(`${filePath}:`) && key !== cacheKey) {
      ignoreRulesCache.delete(key);
    }
  }

  try {
    if (!stat?.isFile()) {
      ignoreRulesCache.set(cacheKey, []);
      return [];
    }
    const raw = await fs.readFile(filePath, 'utf8');
    const rules = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const negated = line.startsWith('!');
        const source = negated ? line.slice(1) : line;
        const dirOnly = source.endsWith('/');
        const anchored = source.startsWith('/');
        const normalized = normalizeRelativePath(dirOnly ? source.slice(0, -1) : source);
        return {
          negated,
          dirOnly,
          anchored,
          normalized,
          hasSlash: normalized.includes('/'),
          regex: gitignorePatternToRegex(normalized)
        };
      })
      .filter((rule) => rule.normalized);
    ignoreRulesCache.set(cacheKey, rules);
    return rules;
  } catch {
    ignoreRulesCache.set(cacheKey, []);
    return [];
  }
}

async function readProjectIgnoreRules(cwd) {
  const [gitignoreRules, llmignoreRules] = await Promise.all([
    readIgnoreFileRules(cwd, '.gitignore'),
    readIgnoreFileRules(cwd, '.llmignore')
  ]);
  return {
    gitignoreRules,
    llmignoreRules,
    combinedRules: [...gitignoreRules, ...llmignoreRules]
  };
}

function matchesGitignoreRule(rule, relativePath, isDirectory) {
  if (!rule || !relativePath) return false;
  if (rule.dirOnly && !isDirectory) return false;
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) return false;
  if (rule.anchored || rule.hasSlash) {
    return rule.regex.test(normalizedPath);
  }
  return normalizedPath.split('/').some((segment) => rule.regex.test(segment));
}

function shouldIgnorePath(relativePath, isDirectory, gitignoreRules = []) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) return false;
  const segments = normalizedPath.split('/').filter(Boolean);
  if (segments.some((segment) => SKIP_DIRS.has(segment))) return true;
  if (segments.some((segment) => /^venv[-_]/i.test(segment) || /\.egg-info$/i.test(segment))) return true;
  let ignored = false;
  for (const rule of gitignoreRules) {
    if (!matchesGitignoreRule(rule, normalizedPath, isDirectory)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

const CODEMINI_GITIGNORE_ENTRY = '.codemini/';
const CODEMINI_GITIGNORE_COMMENT = '# Codemini local workspace (indexes, backups, specs)';

function invalidateIgnoreRulesCache(gitignorePath) {
  for (const key of ignoreRulesCache.keys()) {
    if (String(key).startsWith(`${gitignorePath}:`)) {
      ignoreRulesCache.delete(key);
    }
  }
}

function isIgnoredByGitignore(relativePath, isDirectory, gitignoreRules = []) {
  const normalizedPath = normalizeRelativePath(relativePath);
  if (!normalizedPath) return false;
  let ignored = false;
  for (const rule of gitignoreRules) {
    if (!matchesGitignoreRule(rule, normalizedPath, isDirectory)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

function gitignoreAlreadyCoversCodemini(content, gitignoreRules = []) {
  if (/\b\.codemini\/?\b/m.test(String(content || ''))) return true;
  return isIgnoredByGitignore('.codemini', true, gitignoreRules)
    || isIgnoredByGitignore('.codemini/', true, gitignoreRules);
}

async function isGitRepository(projectRoot) {
  const gitPath = path.join(projectRoot, '.git');
  const stat = await safeStat(gitPath);
  return Boolean(stat?.isDirectory() || stat?.isFile());
}

export async function ensureCodeminiGitignore(projectRoot) {
  const root = path.resolve(String(projectRoot || '').trim());
  if (!root) return { updated: false, reason: 'missing_root' };
  try {
    if (!(await isGitRepository(root))) {
      return { updated: false, reason: 'not_git' };
    }
    const gitignorePath = path.join(root, '.gitignore');
    const { gitignoreRules } = await readProjectIgnoreRules(root);
    let content = '';
    try {
      content = await fs.readFile(gitignorePath, 'utf8');
    } catch {
      content = '';
    }
    if (gitignoreAlreadyCoversCodemini(content, gitignoreRules)) {
      return { updated: false, reason: 'already_ignored' };
    }
    const needsLeadingNewline = content.length > 0 && !content.endsWith('\n');
    const block = `${needsLeadingNewline ? '\n' : ''}${CODEMINI_GITIGNORE_COMMENT}\n${CODEMINI_GITIGNORE_ENTRY}\n`;
    await fs.writeFile(gitignorePath, `${content}${block}`, 'utf8');
    invalidateIgnoreRulesCache(gitignorePath);
    return { updated: true, reason: 'appended' };
  } catch (error) {
    return {
      updated: false,
      reason: 'error',
      message: error instanceof Error ? error.message : String(error)
    };
  }
}

async function detectWorkspaceKind(cwd) {
  const gitDir = await safeStat(path.join(cwd, '.git'));
  if (gitDir?.isDirectory()) return 'project';
  const markerStats = await Promise.all(
    [...PROJECT_MARKER_FILES].map((marker) => safeStat(path.join(cwd, marker)))
  );
  if (markerStats.some((stat) => stat?.isFile())) return 'project';
  return 'directory';
}

async function findNearestProjectRoot(startDir, workspaceRoot) {
  let current = path.resolve(startDir);
  const root = path.resolve(workspaceRoot);
  while (current.startsWith(root)) {
    if ((await detectWorkspaceKind(current)) === 'project') return current;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function findProjectRootFromFile(workspaceRoot, relativePath = '') {
  const absolutePath = path.resolve(workspaceRoot, String(relativePath || '.'));
  const stat = await safeStat(absolutePath);
  const probeStart = stat?.isDirectory() ? absolutePath : path.dirname(absolutePath);
  return findNearestProjectRoot(probeStart, workspaceRoot);
}

async function findNearestIndexedProjectRoot(startDir, workspaceRoot) {
  let current = path.resolve(startDir);
  const root = path.resolve(workspaceRoot);
  while (current.startsWith(root)) {
    const [sqliteStat, legacyFileIndexStat] = await Promise.all([
      safeStat(path.join(getProjectIndexDir(current), 'index.sqlite')),
      safeStat(getFileIndexPath(current))
    ]);
    if (sqliteStat?.isFile() || legacyFileIndexStat?.isFile()) return current;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function walkFiles(cwd, ignoreRules = []) {
  const absolutePaths = await globFilesUnder(cwd, { skipDirs: SKIP_DIRS });
  return absolutePaths.filter((absolutePath) => {
    const relativePath = rel(cwd, absolutePath);
    return !shouldIgnorePath(relativePath, false, ignoreRules);
  });
}

function categorizeDirectory(relativeDir) {
  const text = String(relativeDir || '').toLowerCase();
  if (!text || text === '.') return 'root';
  if (/(^|\/)(src|app|apps)\b/.test(text)) return 'source';
  if (/(^|\/)(test|tests|__tests__|spec)\b/.test(text)) return 'test';
  if (/(^|\/)(scripts|bin)\b/.test(text)) return 'script';
  if (/(^|\/)(config|configs)\b/.test(text)) return 'config';
  return 'other';
}

function extractMatches(regex, text, group = 1) {
  const out = [];
  for (const match of String(text || '').matchAll(regex)) {
    const value = String(match[group] || '').trim();
    if (value) out.push(value);
  }
  return out;
}

function lineNumberForIndex(content, index) {
  return String(content || '').slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function findBraceRange(content, openBraceIndex) {
  if (openBraceIndex < 0) return null;
  let depth = 0;
  for (let index = openBraceIndex; index < content.length; index += 1) {
    const ch = content[index];
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return { start: openBraceIndex, end: index + 1 };
    }
  }
  return null;
}

function inferSymbolType(kind) {
  if (kind === 'class') return 'class';
  if (kind === 'method') return 'method';
  if (kind === 'const') return 'function';
  return 'function';
}

function extractCallNames(content) {
  return clipList(
    extractMatches(/\b([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)?)\s*\(/g, content)
      .filter((name) => !['if', 'for', 'while', 'switch', 'return', 'function', 'class', 'catch'].includes(String(name).split('.')[0])),
    64
  );
}

function extractSemanticWrites(calls) {
  return clipList((calls || []).filter((name) => /\.(insert|update|upsert|delete|save|write|create)$/i.test(String(name)) || /^(insert|update|upsert|delete|save|write|create)$/i.test(String(name))), 16);
}

function extractSemanticEmits(calls, content) {
  const eventNames = extractMatches(/\b(?:emit|publish|dispatch)\s*\(\s*['"`]([^'"`]+)['"`]/g, content);
  return clipList([
    ...eventNames,
    ...(calls || []).filter((name) => /\.(emit|publish|dispatch)$/i.test(String(name)) || /^(emit|publish|dispatch)$/i.test(String(name)))
  ], 16);
}

function extractInterfaces(relativePath, content) {
  const interfaces = [];
  const seen = new Set();
  const add = (kind, name, method = '') => {
    const key = `${kind}:${method}:${name}`;
    if (!name || seen.has(key)) return;
    seen.add(key);
    interfaces.push({ kind, name, method });
  };
  const routePatterns = [
    /req\.method\s*===\s*['"]([A-Z]+)['"][\s\S]{0,240}?url\.pathname\s*===\s*['"]([^'"]+)['"]/g,
    /req\.method\s*===\s*['"]([A-Z]+)['"][\s\S]{0,240}?url\.pathname\.startsWith\(\s*['"]([^'"]+)['"]/g
  ];
  for (const pattern of routePatterns) {
    for (const match of String(content || '').matchAll(pattern)) add('http', match[2], match[1]);
  }
  if (/^src\/commands\/[^/]+\.js$/i.test(normalizeRelativePath(relativePath))) {
    add('cli', path.posix.basename(relativePath, path.posix.extname(relativePath)));
  }
  if (normalizeRelativePath(relativePath) === 'src/core/tools.js') {
    for (const match of String(content || '').matchAll(/\bname:\s*["']([a-z][a-z0-9_]{2,})["']/g)) {
      add('tool', match[1]);
    }
  }
  return interfaces.slice(0, 200);
}

function extractSymbolDefinitions(relativePath, content, imports = []) {
  const definitions = [];
  const patterns = [
    { kind: 'class', regex: /\b(?:export\s+)?class\s+([A-Za-z_$][A-Za-z0-9_$]*)[^{]*\{/g },
    { kind: 'function', regex: /\b(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/g },
    { kind: 'const', regex: /\b(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g },
    { kind: 'python', regex: /^\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*:/gm },
    { kind: 'go', regex: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*\{/gm }
  ];

  for (const { kind, regex } of patterns) {
    for (const match of String(content || '').matchAll(regex)) {
      const name = String(match[1] || '').trim();
      if (!name) continue;
      const start = match.index || 0;
      const openBrace = content.indexOf('{', start);
      const braceRange = openBrace >= 0 ? findBraceRange(content, openBrace) : null;
      const end = braceRange?.end || content.indexOf('\n', start + String(match[0] || '').length);
      const safeEnd = end > start ? end : start + String(match[0] || '').length;
      const body = content.slice(start, safeEnd);
      const startLine = lineNumberForIndex(content, start);
      const endLine = lineNumberForIndex(content, safeEnd);
      const signature = trimInline(String(match[0] || '').replace(/\s*\{\s*$/, '').replace(/\s*:\s*$/, ''), 220);
      const calls = extractCallNames(body);
      definitions.push({
        symbol_id: `${relativePath}#${name}`,
        name,
        type: inferSymbolType(kind),
        file: relativePath,
        range: { start_line: startLine, end_line: endLine },
        signature,
        calls,
        called_by: [],
        imports: clipList(imports, 12),
        writes: extractSemanticWrites(calls),
        emits: extractSemanticEmits(calls, body),
        used_by: []
      });

      if (kind === 'class' && braceRange) {
        const classBodyStart = openBrace + 1;
        const classBody = content.slice(classBodyStart, braceRange.end - 1);
        for (const methodMatch of classBody.matchAll(/^\s*(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\([^)]*\)\s*\{/gm)) {
          const methodName = String(methodMatch[1] || '').trim();
          if (!methodName || ['if', 'for', 'while', 'switch', 'catch'].includes(methodName)) continue;
          const leadingWhitespace = String(methodMatch[0] || '').search(/\S/);
          const methodStart = classBodyStart + (methodMatch.index || 0) + Math.max(0, leadingWhitespace);
          const methodOpenBrace = content.indexOf('{', methodStart);
          const methodBraceRange = findBraceRange(content, methodOpenBrace);
          const methodEnd = methodBraceRange?.end || methodStart + String(methodMatch[0] || '').length;
          const methodBody = content.slice(methodStart, methodEnd);
          const methodCalls = extractCallNames(methodBody);
          definitions.push({
            symbol_id: `${relativePath}#${name}.${methodName}`,
            name: `${name}.${methodName}`,
            type: 'method',
            file: relativePath,
            range: {
              start_line: lineNumberForIndex(content, methodStart),
              end_line: lineNumberForIndex(content, methodEnd)
            },
            signature: trimInline(`${name}.${String(methodMatch[0] || '').replace(/\s*\{\s*$/, '')}`, 220),
            calls: methodCalls,
            called_by: [],
            imports: clipList(imports, 12),
            writes: extractSemanticWrites(methodCalls),
            emits: extractSemanticEmits(methodCalls, methodBody),
            used_by: []
          });
        }
      }
    }
  }

  return definitions
    .sort((left, right) => left.range.start_line - right.range.start_line || left.name.localeCompare(right.name))
    .slice(0, 200);
}

function enrichSymbolGraph(files) {
  const nextFiles = (Array.isArray(files) ? files : []).map((entry) => ({
    ...entry,
    symbols: Array.isArray(entry.symbols) ? entry.symbols.map((symbol) => ({ ...symbol, called_by: [], used_by: [] })) : []
  }));
  const symbols = nextFiles.flatMap((entry) => entry.symbols || []);
  const byName = new Map();
  for (const symbol of symbols) {
    const shortName = String(symbol.name || '').split('.').pop();
    if (!shortName) continue;
    if (!byName.has(shortName)) byName.set(shortName, []);
    byName.get(shortName).push(symbol);
  }

  for (const source of symbols) {
    for (const rawCall of source.calls || []) {
      const callName = String(rawCall || '').split('.').pop();
      const targets = byName.get(callName) || [];
      for (const target of targets) {
        if (!target?.symbol_id || target.symbol_id === source.symbol_id) continue;
        target.called_by = clipList([...(target.called_by || []), source.symbol_id], 32);
      }
    }
  }

  return nextFiles;
}

async function buildFileEntry(relativePath, content, stat) {
  const ext = path.extname(relativePath).toLowerCase();
  const imports = clipList([
    ...extractMatches(/import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/g, content),
    ...extractMatches(/require\(\s*['"]([^'"]+)['"]\s*\)/g, content),
    ...extractMatches(/\buse\s+([A-Za-z0-9_:\\]+)/g, ext === '.rs' ? content : '')
  ]);
  const exports = clipList([
    ...extractMatches(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g, content),
    ...extractMatches(/export\s+class\s+([A-Za-z0-9_$]+)/g, content),
    ...extractMatches(/export\s+const\s+([A-Za-z0-9_$]+)/g, content),
    ...extractMatches(/module\.exports\s*=\s*([A-Za-z0-9_$]+)/g, content),
    ...extractMatches(/exports\.([A-Za-z0-9_$]+)/g, content)
  ]);
  const functions = clipList([
    ...extractMatches(/\bfunction\s+([A-Za-z0-9_$]+)/g, content),
    ...extractMatches(/\bdef\s+([A-Za-z0-9_]+)/g, content),
    ...extractMatches(/\bfunc\s+([A-Za-z0-9_]+)/g, content),
    ...extractMatches(/\bfn\s+([A-Za-z0-9_]+)/g, content),
    ...extractMatches(/^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?[A-Za-z0-9_<>,[\]?]+\s+([A-Za-z0-9_]+)\s*\(/gm, content),
    ...extractMatches(/^\s*function\s+([A-Za-z0-9_]+)/gm, content),
    ...extractMatches(/^\s*def\s+([A-Za-z0-9_]+)/gm, content)
  ]);
  const classes = clipList([
    ...extractMatches(/\bclass\s+([A-Za-z0-9_$]+)/g, content)
  ]);
  const calls = extractCallNames(content);
  const interfaces = extractInterfaces(relativePath, content);
  const astFacts = await extractAstIndexFacts(content, relativePath);
  const symbols = (astFacts?.symbols?.length ? astFacts.symbols : extractSymbolDefinitions(relativePath, content, imports))
    .map((symbol) => ({
      ...symbol,
      imports: clipList(symbol.imports?.length ? symbol.imports : imports, 12),
      writes: symbol.writes?.length ? symbol.writes : extractSemanticWrites(symbol.calls || []),
      emits: symbol.emits?.length ? symbol.emits : extractSemanticEmits(symbol.calls || [], content)
    }));

  return {
    file: relativePath,
    language: LANGUAGE_BY_EXT[ext] || 'text',
    hash: sha256(content),
    size: Number(stat?.size || content.length || 0),
    mtimeMs: Number(stat?.mtimeMs || 0),
    imports,
    exports,
    functions,
    classes,
    calls,
    symbols,
    interfaces
  };
}

async function scanProject(cwd) {
  const workspaceKind = await detectWorkspaceKind(cwd);
  if (workspaceKind !== 'project') {
    return {
      workspaceKind,
      projectMap: null,
      fileIndex: null,
      ignoreRules: []
    };
  }

  const { gitignoreRules, llmignoreRules, combinedRules } = await readProjectIgnoreRules(cwd);
  const allFiles = await walkFiles(cwd, combinedRules);
  const relativeFiles = allFiles.map((filePath) => rel(cwd, filePath));
  const sourceFiles = allFiles.filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  const [packageJson, tsconfigStat] = await Promise.all([
    safeReadJson(path.join(cwd, 'package.json'), null),
    safeStat(path.join(cwd, 'tsconfig.json'))
  ]);
  const tsconfigExists = Boolean(tsconfigStat);
  const sourceRoots = clipList(relativeFiles.filter((value) => /^(src|app|apps)\b/.test(value)).map((value) => value.split('/')[0]), 12);
  const testRoots = clipList(relativeFiles.filter((value) => /^(tests|test|__tests__)\b/.test(value)).map((value) => value.split('/')[0]), 12);
  const entryCandidates = clipList(
    relativeFiles.filter((value) => /(^|\/)(main|index|server|app)\.(js|jsx|mjs|cjs|ts|tsx|py|go|rs|java|cs|php|rb)$/.test(value)),
    16
  );
  const languages = clipList(sourceFiles.map((filePath) => LANGUAGE_BY_EXT[path.extname(filePath).toLowerCase()] || '').filter(Boolean), 16);
  const importantFiles = clipList(
    relativeFiles.filter((value) => ['package.json', 'tsconfig.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'composer.json', 'Gemfile'].includes(value)),
    16
  );
  const packageManagers = clipList([
    packageJson ? 'npm' : '',
    relativeFiles.includes('bun.lockb') ? 'bun' : '',
    relativeFiles.includes('pnpm-lock.yaml') ? 'pnpm' : '',
    relativeFiles.includes('yarn.lock') ? 'yarn' : ''
  ].filter(Boolean));
  const frameworkHints = clipList([
    packageJson?.dependencies?.react || packageJson?.devDependencies?.react ? 'react' : '',
    packageJson?.dependencies?.express ? 'express' : '',
    packageJson?.dependencies?.vue ? 'vue' : '',
    packageJson?.dependencies?.next ? 'next' : '',
    tsconfigExists ? 'typescript' : ''
  ].filter(Boolean));

  const directories = {};
  for (const value of relativeFiles) {
    const dir = path.posix.dirname(value);
    if (!dir || dir === '.') continue;
    if (!(dir in directories)) directories[dir] = categorizeDirectory(dir);
  }

  let files = await mapAsyncLimit(sourceFiles, 32, async (filePath) => {
    const [content, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath)
    ]);
    return buildFileEntry(rel(cwd, filePath), content, stat);
  });
  files = enrichSymbolGraph(files);

  return {
    workspaceKind,
    projectMap: {
      projectRoot: cwd,
      workspaceKind,
      languages,
      packageManagers,
      importantFiles,
      sourceRoots,
      testRoots,
      entryCandidates,
      frameworkHints,
      directories,
      gitignoreEnabled: gitignoreRules.length > 0,
      llmignoreEnabled: llmignoreRules.length > 0,
      updatedAt: new Date().toISOString()
    },
    fileIndex: {
      updatedAt: new Date().toISOString(),
      files
    },
    ignoreRules: combinedRules
  };
}

async function loadExistingProjectIndex(targetRoot) {
  try {
    const sqlite = loadProjectIndexFromSqlite(targetRoot);
    if (sqlite?.projectMap && Array.isArray(sqlite?.fileIndex?.files) && sqlite.fileIndex.files.length > 0) {
      refreshProjectKnowledgeGraph(targetRoot, {
        projectMap: sqlite.projectMap,
        fileIndex: sqlite.fileIndex
      });
      return {
        workspaceKind: 'project',
        projectRoot: targetRoot,
        projectMap: sqlite.projectMap,
        fileIndex: sqlite.fileIndex,
        summary: `loaded ${path.basename(targetRoot) || '.'}/.codemini (${sqlite.fileIndex.files.length} files)`
      };
    }
    const [projectMap, fileIndex] = await Promise.all([
      safeReadJson(getProjectMapPath(targetRoot), null),
      safeReadJson(getFileIndexPath(targetRoot), null)
    ]);
    if (!projectMap || !fileIndex || !Array.isArray(fileIndex.files) || fileIndex.files.length === 0) {
      return null;
    }
    saveProjectIndexToSqlite(targetRoot, { projectMap, fileIndex });
    refreshProjectKnowledgeGraph(targetRoot, { projectMap, fileIndex });
    return {
      workspaceKind: 'project',
      projectRoot: targetRoot,
      projectMap,
      fileIndex,
      summary: `loaded ${path.basename(targetRoot) || '.'}/.codemini (${fileIndex.files.length} files)`
    };
  } catch {
    return null;
  }
}

export async function initializeProjectIndex(cwd = process.cwd()) {
  const targetRoot = (await findNearestProjectRoot(cwd, cwd)) || path.resolve(cwd);
  const cacheKey = targetRoot;
  if (initCache.has(cacheKey)) return initCache.get(cacheKey);
  const promise = (async () => {
    const workspaceDir = getProjectWorkspaceDir(cwd);
    await fs.mkdir(workspaceDir, { recursive: true });
    await ensureCodeminiGitignore(targetRoot);
    const existing = await loadExistingProjectIndex(targetRoot);
    if (existing) return existing;
    const { workspaceKind, projectMap, fileIndex } = await scanProject(targetRoot);
    if (workspaceKind !== 'project' || !projectMap || !fileIndex) {
      return {
        workspaceKind,
        projectRoot: null,
        projectMap: null,
        fileIndex: null,
        summary: '',
        skipped: true
      };
    }
    await fs.mkdir(getProjectIndexDir(targetRoot), { recursive: true });
    saveProjectIndexToSqlite(targetRoot, { projectMap, fileIndex });
    refreshProjectKnowledgeGraph(targetRoot, { projectMap, fileIndex });
    return {
      workspaceKind,
      projectRoot: targetRoot,
      projectMap,
      fileIndex,
      summary: `initialized ${path.basename(targetRoot) || '.'}/.codemini (${Array.isArray(fileIndex?.files) ? fileIndex.files.length : 0} files)`
    };
  })();
  initCache.set(cacheKey, promise);
  try {
    return await promise;
  } catch (error) {
    initCache.delete(cacheKey);
    throw error;
  }
}

export async function refreshIndexedFiles(cwd = process.cwd(), relativePaths = []) {
  const requestedPaths = [...new Set(
    (Array.isArray(relativePaths) ? relativePaths : [relativePaths])
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
  if (requestedPaths.length === 0) {
    return { updatedProjects: 0, indexWrites: 0, files: [] };
  }

  await fs.mkdir(getProjectWorkspaceDir(cwd), { recursive: true });
  const resolved = await Promise.all(requestedPaths.map(async (relativePath) => ({
    relativePath,
    absolutePath: path.resolve(cwd, relativePath),
    projectRoot: await findProjectRootFromFile(cwd, relativePath)
  })));
  const grouped = new Map();
  for (const target of resolved) {
    if (!target.projectRoot) continue;
    if (!grouped.has(target.projectRoot)) grouped.set(target.projectRoot, []);
    grouped.get(target.projectRoot).push(target);
  }

  const projectResults = await Promise.all([...grouped.entries()].map(([projectRoot, targets]) => withProjectIndexLock(projectRoot, async () => {
    await ensureCodeminiGitignore(projectRoot);
    const { combinedRules } = await readProjectIgnoreRules(projectRoot);
    const current = loadProjectFileIndexFromSqlite(projectRoot);
    const filesByPath = new Map(
      (Array.isArray(current.files) ? current.files : []).map((entry) => [entry.file, entry])
    );

    const updates = await Promise.all(targets.map(async ({ absolutePath }) => {
      const stat = await safeStat(absolutePath);
      const projectRelativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
      const ignored = shouldIgnorePath(
        projectRelativePath,
        Boolean(stat?.isDirectory?.()),
        combinedRules
      );
      const supported = SOURCE_EXTENSIONS.has(path.extname(projectRelativePath).toLowerCase());
      if (ignored || !stat?.isFile() || !supported) {
        return { path: projectRelativePath, action: 'removed', entry: null };
      }
      const content = await fs.readFile(absolutePath, 'utf8');
      return {
        path: projectRelativePath,
        action: filesByPath.has(projectRelativePath) ? 'updated' : 'added',
        entry: await buildFileEntry(projectRelativePath, content, stat)
      };
    }));

    for (const update of updates) {
      if (update.entry) filesByPath.set(update.path, update.entry);
      else filesByPath.delete(update.path);
    }
    const enrichedFiles = enrichSymbolGraph([...filesByPath.values()]);
    const nextFileIndex = {
      updatedAt: new Date().toISOString(),
      files: enrichedFiles.sort((left, right) => left.file.localeCompare(right.file))
    };
    saveProjectIndexToSqlite(projectRoot, { fileIndex: nextFileIndex });
    refreshProjectKnowledgeGraph(projectRoot, {
      projectMap: loadProjectIndexFromSqlite(projectRoot)?.projectMap || {},
      fileIndex: nextFileIndex
    });

    return {
      projectRoot,
      files: updates.map(({ path: filePath, action }) => ({
        path: filePath,
        projectRoot,
        action,
        summary: `${action} ${path.basename(projectRoot) || '.'}/.codemini for ${filePath}`
      }))
    };
  })));

  return {
    updatedProjects: projectResults.length,
    indexWrites: projectResults.length,
    files: projectResults.flatMap((result) => result.files)
  };
}

export async function refreshIndexedFile(cwd = process.cwd(), relativePath = '') {
  if (!relativePath) return null;
  const result = await refreshIndexedFiles(cwd, [relativePath]);
  return result.files[0] || null;
}

export async function buildProjectContextSnippet(cwd = process.cwd(), userText = '') {
  const indexedRoot = await findNearestIndexedProjectRoot(cwd, cwd);
  if (!indexedRoot) return '';

  const storedIndex = loadProjectIndexFromSqlite(indexedRoot);
  const projectMap = storedIndex?.projectMap;
  const fileIndex = storedIndex?.fileIndex;
  if (!projectMap || !Array.isArray(fileIndex?.files)) return '';

  const lines = [
    'Project Context:',
    `- project_root: ${indexedRoot}`,
    `- languages: ${(projectMap.languages || []).slice(0, 6).join(', ') || 'unknown'}`,
    `- source_roots: ${(projectMap.sourceRoots || []).slice(0, 6).join(', ') || 'none'}`,
    `- test_roots: ${(projectMap.testRoots || []).slice(0, 6).join(', ') || 'none'}`,
    `- entry_candidates: ${(projectMap.entryCandidates || []).slice(0, 6).join(', ') || 'none'}`,
    `- framework_hints: ${(projectMap.frameworkHints || []).slice(0, 6).join(', ') || 'none'}`
  ];

  const tokens = tokenizeQuery(userText);
  const scored = [];
  for (const entry of fileIndex.files) {
    let score = 0;
    const fileText = String(entry.file || '').toLowerCase();
    for (const token of tokens) {
      if (fileText.includes(token)) score += 5;
      if ((entry.exports || []).some((value) => String(value).toLowerCase() === token)) score += 4;
      if ((entry.functions || []).some((value) => String(value).toLowerCase() === token)) score += 4;
      if ((entry.classes || []).some((value) => String(value).toLowerCase() === token)) score += 4;
      if ((entry.imports || []).some((value) => String(value).toLowerCase().includes(token))) score += 1;
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((left, right) => right.score - left.score || String(left.entry.file).localeCompare(String(right.entry.file)));
  const selected = scored.slice(0, PROJECT_CONTEXT_MAX_FILES).map((item) => item.entry);
  if (selected.length > 0) {
    lines.push('- relevant_files:');
    for (const entry of selected) {
      const symbolText = (entry.symbols || [])
        .slice(0, 4)
        .map((symbol) => `${symbol.name}@${symbol.range?.start_line || '?'}`)
        .join(', ');
      lines.push(
        `  - ${entry.file} :: symbols=[${symbolText}] exports=[${(entry.exports || []).slice(0, 4).join(', ')}] classes=[${(entry.classes || []).slice(0, 4).join(', ')}]`
      );
    }
  }

  const snippet = trimMultiline(lines.join('\n'));
  return snippet;
}

export async function queryProjectIndex(cwd = process.cwd(), args = {}) {
  const indexedRoot = await findNearestIndexedProjectRoot(cwd, cwd);
  if (!indexedRoot) {
    return {
      query: String(args?.query || '').trim(),
      project_root: '',
      project_map: null,
      matches: []
    };
  }

  const storedIndex = loadProjectIndexFromSqlite(indexedRoot);
  const projectMap = storedIndex?.projectMap;
  const fileIndex = storedIndex?.fileIndex;
  const query = String(args?.query || '').trim();
  const pathPrefix = normalizeRelativePath(args?.path || args?.path_prefix || '');
  const languageFilter = String(args?.language || '').trim().toLowerCase();
  const maxResults = Math.max(1, Math.min(20, Number(args?.max_results || 8) || 8));
  const files = Array.isArray(fileIndex?.files) ? fileIndex.files : [];
  const tokens = tokenizeQuery(query);

  const matches = [];
  for (const entry of files) {
    const relativePath = String(entry?.file || '');
    if (!relativePath) continue;
    if (pathPrefix && !relativePath.startsWith(pathPrefix)) continue;
    if (languageFilter && String(entry?.language || '').toLowerCase() !== languageFilter) continue;

    let score = 0;
    const reasons = [];
    const fileText = relativePath.toLowerCase();
    const symbolMatches = [];
    for (const token of tokens) {
      if (!token) continue;
      if (fileText.includes(token)) {
        score += 5;
        reasons.push(`path:${token}`);
      }
      if ((entry.exports || []).some((value) => String(value).toLowerCase() === token)) {
        score += 4;
        reasons.push(`export:${token}`);
      }
      if ((entry.functions || []).some((value) => String(value).toLowerCase().includes(token))) {
        score += 4;
        reasons.push(`function:${token}`);
      }
      if ((entry.classes || []).some((value) => String(value).toLowerCase().includes(token))) {
        score += 4;
        reasons.push(`class:${token}`);
      }
      if ((entry.imports || []).some((value) => String(value).toLowerCase().includes(token))) {
        score += 2;
        reasons.push(`import:${token}`);
      }
      for (const symbol of entry.symbols || []) {
        const nameText = String(symbol.name || '').toLowerCase();
        const idText = String(symbol.symbol_id || '').toLowerCase();
        if (nameText.includes(token) || idText.includes(token)) {
          score += 6;
          reasons.push(`symbol:${token}`);
          symbolMatches.push(symbol);
        } else if ((symbol.calls || []).some((value) => String(value).toLowerCase().includes(token))) {
          score += 3;
          reasons.push(`calls:${token}`);
          symbolMatches.push(symbol);
        } else if ((symbol.called_by || []).some((value) => String(value).toLowerCase().includes(token))) {
          score += 3;
          reasons.push(`called_by:${token}`);
          symbolMatches.push(symbol);
        }
      }
    }

    if (!query) {
      if ((projectMap?.entryCandidates || []).includes(relativePath)) score += 3;
      if ((projectMap?.importantFiles || []).includes(relativePath)) score += 2;
      if (String(relativePath).startsWith('src/')) score += 1;
    }

    if (score <= 0 && query) continue;
    matches.push({
      file: relativePath,
      language: entry.language || 'text',
      score,
      reasons: clipList(reasons, 8),
      exports: clipList(entry.exports || [], 6),
      functions: clipList(entry.functions || [], 6),
      classes: clipList(entry.classes || [], 6),
      imports: clipList(entry.imports || [], 6),
      symbols: clipList((symbolMatches.length > 0 ? symbolMatches : entry.symbols || []).map((symbol) => ({
        symbol_id: symbol.symbol_id,
        name: symbol.name,
        type: symbol.type,
        range: symbol.range,
        signature: symbol.signature,
        calls: clipList(symbol.calls || [], 8),
        called_by: clipList(symbol.called_by || [], 8),
        imports: clipList(symbol.imports || [], 6),
        writes: clipList(symbol.writes || [], 6),
        emits: clipList(symbol.emits || [], 6)
      })), 6)
    });
  }

  matches.sort((left, right) => right.score - left.score || String(left.file).localeCompare(String(right.file)));

  return {
    query,
    project_root: indexedRoot,
    project_map: projectMap
      ? {
          workspace_kind: projectMap.workspaceKind || 'project',
          languages: clipList(projectMap.languages || [], 8),
          package_managers: clipList(projectMap.packageManagers || [], 8),
          important_files: clipList(projectMap.importantFiles || [], 8),
          source_roots: clipList(projectMap.sourceRoots || [], 8),
          test_roots: clipList(projectMap.testRoots || [], 8),
          entry_candidates: clipList(projectMap.entryCandidates || [], 8),
          framework_hints: clipList(projectMap.frameworkHints || [], 8),
          gitignore_enabled: Boolean(projectMap.gitignoreEnabled),
          llmignore_enabled: Boolean(projectMap.llmignoreEnabled)
        }
      : null,
    matches: matches.slice(0, maxResults)
  };
}
