import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getFileIndexPath, getProjectIndexDir, getProjectMapPath, getProjectWorkspaceDir } from './paths.js';

const SKIP_DIRS = new Set(['.git', 'node_modules', '.codemini', '.codemini-project', '.codemini-global', 'dist', 'coverage']);
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
const SOURCE_EXTENSIONS = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.go', '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hh',
  '.sh', '.bash', '.java', '.rs', '.cs', '.php', '.rb'
]);
const LANGUAGE_BY_EXT = {
  '.js': 'js', '.jsx': 'jsx', '.mjs': 'js', '.cjs': 'js', '.ts': 'ts', '.tsx': 'tsx', '.py': 'python',
  '.go': 'go', '.c': 'c', '.h': 'c', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp',
  '.sh': 'bash', '.bash': 'bash', '.java': 'java', '.rs': 'rust', '.cs': 'csharp', '.php': 'php', '.rb': 'ruby'
};

const initCache = new Map();
const PROJECT_CONTEXT_MAX_FILES = 6;

function sha1(input) {
  return crypto.createHash('sha1').update(String(input || '')).digest('hex');
}

function clipList(values, max = 32) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].slice(0, max);
}

function rel(cwd, filePath) {
  return path.relative(cwd, filePath).replace(/\\/g, '/');
}

function normalizeRelativePath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '');
}

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function safeReadJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function tokenizeQuery(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z0-9_./-]+/g) || [])].filter(Boolean);
}

function trimInline(value, max = 240) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function trimMultiline(value, max = 1800) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3).trimEnd()}...`;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function readGitignoreRules(cwd) {
  try {
    const raw = await fs.readFile(path.join(cwd, '.gitignore'), 'utf8');
    return raw
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
  } catch {
    return [];
  }
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
  const topName = normalizedPath.split('/')[0];
  if (topName && SKIP_DIRS.has(topName)) return true;
  let ignored = false;
  for (const rule of gitignoreRules) {
    if (!matchesGitignoreRule(rule, normalizedPath, isDirectory)) continue;
    ignored = !rule.negated;
  }
  return ignored;
}

async function detectWorkspaceKind(cwd) {
  const gitDir = await safeStat(path.join(cwd, '.git'));
  if (gitDir?.isDirectory()) return 'project';
  for (const marker of PROJECT_MARKER_FILES) {
    const stat = await safeStat(path.join(cwd, marker));
    if (stat?.isFile()) return 'project';
  }
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
    const projectMapStat = await safeStat(getProjectMapPath(current));
    const fileIndexStat = await safeStat(getFileIndexPath(current));
    if (projectMapStat?.isFile() && fileIndexStat?.isFile()) return current;
    if (current === root) break;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

async function walkFiles(cwd, start = cwd, out = [], gitignoreRules = []) {
  const entries = await fs.readdir(start, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(start, entry.name);
    const relativePath = rel(cwd, absolutePath);
    if (entry.isDirectory()) {
      if (shouldIgnorePath(relativePath, true, gitignoreRules)) continue;
      await walkFiles(cwd, absolutePath, out, gitignoreRules);
      continue;
    }
    if (shouldIgnorePath(relativePath, false, gitignoreRules)) continue;
    out.push(absolutePath);
  }
  return out;
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

function buildFileEntry(relativePath, content, stat) {
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
  const calls = clipList([
    ...extractMatches(/\b([A-Za-z0-9_$]+)\s*\(/g, content).filter((name) => !['if', 'for', 'while', 'switch', 'return', 'function', 'class', 'catch'].includes(name))
  ], 64);

  return {
    file: relativePath,
    language: LANGUAGE_BY_EXT[ext] || 'text',
    hash: sha1(content),
    size: Number(stat?.size || content.length || 0),
    mtimeMs: Number(stat?.mtimeMs || 0),
    imports,
    exports,
    functions,
    classes,
    calls
  };
}

async function scanProject(cwd) {
  const workspaceKind = await detectWorkspaceKind(cwd);
  if (workspaceKind !== 'project') {
    return {
      workspaceKind,
      projectMap: null,
      fileIndex: null,
      gitignoreRules: []
    };
  }

  const gitignoreRules = await readGitignoreRules(cwd);
  const allFiles = await walkFiles(cwd, cwd, [], gitignoreRules);
  const relativeFiles = allFiles.map((filePath) => rel(cwd, filePath));
  const sourceFiles = allFiles.filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));

  const packageJson = await safeReadJson(path.join(cwd, 'package.json'), null);
  const tsconfigExists = Boolean(await safeStat(path.join(cwd, 'tsconfig.json')));
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

  const files = [];
  for (const filePath of sourceFiles) {
    const content = await fs.readFile(filePath, 'utf8');
    const stat = await fs.stat(filePath);
    files.push(buildFileEntry(rel(cwd, filePath), content, stat));
  }

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
      updatedAt: new Date().toISOString()
    },
    fileIndex: {
      updatedAt: new Date().toISOString(),
      files
    },
    gitignoreRules
  };
}

export async function initializeProjectIndex(cwd = process.cwd()) {
  const targetRoot = (await findNearestProjectRoot(cwd, cwd)) || path.resolve(cwd);
  const cacheKey = targetRoot;
  if (initCache.has(cacheKey)) return initCache.get(cacheKey);
  const promise = (async () => {
    const workspaceDir = getProjectWorkspaceDir(cwd);
    await fs.mkdir(workspaceDir, { recursive: true });
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
    await writeJson(getProjectMapPath(targetRoot), projectMap);
    await writeJson(getFileIndexPath(targetRoot), fileIndex);
    return {
      workspaceKind,
      projectRoot: targetRoot,
      projectMap,
      fileIndex,
      summary: `initialized ${path.basename(targetRoot) || '.'}/.codemini-project (${Array.isArray(fileIndex?.files) ? fileIndex.files.length : 0} files)`
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

export async function refreshIndexedFile(cwd = process.cwd(), relativePath = '') {
  if (!relativePath) return null;
  const workspaceDir = getProjectWorkspaceDir(cwd);
  await fs.mkdir(workspaceDir, { recursive: true });
  const projectRoot = await findProjectRootFromFile(cwd, relativePath);
  if (!projectRoot) return null;
  const fileIndexPath = getFileIndexPath(projectRoot);
  const gitignoreRules = await readGitignoreRules(projectRoot);
  const absolutePath = path.join(cwd, relativePath);
  const stat = await safeStat(absolutePath);
  let action = 'updated';
  const projectRelativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
  const current = await safeReadJson(fileIndexPath, { updatedAt: '', files: [] });
  const files = Array.isArray(current.files) ? [...current.files] : [];
  const index = files.findIndex((entry) => entry.file === projectRelativePath);

  if (shouldIgnorePath(projectRelativePath, Boolean(stat?.isDirectory?.()), gitignoreRules)) {
    if (index >= 0) files.splice(index, 1);
    action = 'removed';
  } else if (!stat || !stat.isFile()) {
    if (index >= 0) files.splice(index, 1);
    action = 'removed';
  } else {
    const ext = path.extname(relativePath).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) {
      if (index >= 0) files.splice(index, 1);
      action = 'removed';
    } else {
      const content = await fs.readFile(absolutePath, 'utf8');
      const nextEntry = buildFileEntry(projectRelativePath, content, stat);
      if (index >= 0) {
        files[index] = nextEntry;
      } else {
        files.push(nextEntry);
        action = 'added';
      }
    }
  }

  await writeJson(fileIndexPath, {
    updatedAt: new Date().toISOString(),
    files: files.sort((left, right) => left.file.localeCompare(right.file))
  });

  return {
    path: projectRelativePath,
    projectRoot,
    action,
    summary: `${action} ${path.basename(projectRoot) || '.'}/.codemini-project for ${projectRelativePath}`
  };
}

export async function buildProjectContextSnippet(cwd = process.cwd(), userText = '') {
  const indexedRoot = await findNearestIndexedProjectRoot(cwd, cwd);
  if (!indexedRoot) return '';

  const projectMap = await safeReadJson(getProjectMapPath(indexedRoot), null);
  const fileIndex = await safeReadJson(getFileIndexPath(indexedRoot), null);
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
      lines.push(
        `  - ${entry.file} :: exports=[${(entry.exports || []).slice(0, 4).join(', ')}] functions=[${(entry.functions || []).slice(0, 4).join(', ')}] classes=[${(entry.classes || []).slice(0, 4).join(', ')}]`
      );
    }
  }

  const snippet = trimMultiline(lines.join('\n'));
  return snippet;
}
