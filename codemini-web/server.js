import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';

import { loadConfig, saveConfig, setConfigValue, getConfigValue } from '../src/core/config-store.js';
import {
  loadWebuiActiveProjects,
  normalizeProjectDirKey,
  patchWebuiActiveProjects,
  sessionMatchesActiveProjects
} from '../src/core/webui-sidebar-config.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, listSessions, resolveSession, deleteSession } from '../src/core/session-store.js';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { RuntimeBridge } from './lib/runtime-bridge.js';
import { installSkillSource, listSkillEntries } from '../src/commands/skill.js';
import { computeFileSha256, readSkillRegistry, upsertSkillRegistryEntry, writeSkillRegistry } from '../src/core/skill-registry.js';
import { forgetMemory, listMemories, searchMemories } from '../src/core/memory-store.js';
import { getReplyLanguage } from '../src/core/reply-language.js';
import { getBaseConfigDir, getFileIndexPath, getProjectSkillsDir, getProjectSpecsDir, getSkillsDir } from '../src/core/paths.js';
import { initializeProjectIndex } from '../src/core/project-index.js';
import { INDEX_SKIP_DIRS } from '../src/core/constants.js';
import { VERSION } from '../src/core/version.js';

const GENERAL_PROJECT_DIR = (() => {
  const base = getBaseConfigDir();
  return path.join(base, 'workspace');
})();

const SKILL_CATALOG_FILE = 'codemini.skills.json';
const SKILL_MODES = new Set(['always', 'agent_requested', 'manual']);
const SKILL_SCOPES = new Set(['project', 'global']);
const MEMORY_SCOPES = new Set(['user', 'global', 'project']);

function normalizeSkillScope(scope) {
  return SKILL_SCOPES.has(scope) ? scope : 'project';
}

function normalizeMemoryScope(scope) {
  const value = String(scope || '').trim().toLowerCase();
  return MEMORY_SCOPES.has(value) ? value : 'user';
}

function isSafeSkillName(name = '') {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);
}

function skillBaseDirForScope(scope, projectDir) {
  return scope === 'global' ? getSkillsDir() : getProjectSkillsDir(projectDir);
}

function normalizeSkillMetadataPatch(input = {}) {
  const out = {};
  if (typeof input.description === 'string') out.description = input.description.trim();
  if (typeof input.mode === 'string') {
    const mode = input.mode === 'auto_attach' ? 'agent_requested' : input.mode;
    if (SKILL_MODES.has(mode)) out.mode = mode;
  }
  if (input.enabled !== undefined) out.enabled = input.enabled !== false;
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (Number.isFinite(priority)) out.priority = Math.max(0, Math.min(100, Math.round(priority)));
  }
  if (Array.isArray(input.triggers)) {
    out.triggers = input.triggers.map((item) => String(item || '').trim()).filter(Boolean);
  } else if (typeof input.triggers === 'string') {
    out.triggers = input.triggers.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return out;
}

async function readProjectSkillCatalog(projectDir) {
  return readSkillCatalogFromDir(getProjectSkillsDir(projectDir));
}

async function readSkillCatalogFromDir(skillBaseDir) {
  const catalogPath = path.join(skillBaseDir, SKILL_CATALOG_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(catalogPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : { version: 1, skills: {} };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeProjectSkillCatalog(projectDir, catalog) {
  return writeSkillCatalogToDir(getProjectSkillsDir(projectDir), catalog);
}

async function writeSkillCatalogToDir(skillBaseDir, catalog) {
  const catalogPath = path.join(skillBaseDir, SKILL_CATALOG_FILE);
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  const next = {
    version: 1,
    skills: catalog?.skills && typeof catalog.skills === 'object' ? catalog.skills : {}
  };
  await fs.writeFile(catalogPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

async function upsertProjectSkillMetadata(projectDir, name, patch) {
  return upsertSkillCatalogMetadata(getProjectSkillsDir(projectDir), name, patch);
}

async function upsertSkillCatalogMetadata(skillBaseDir, name, patch) {
  const catalog = await readSkillCatalogFromDir(skillBaseDir);
  catalog.skills = catalog.skills || {};
  const prior = catalog.skills[name] && typeof catalog.skills[name] === 'object' ? catalog.skills[name] : {};
  catalog.skills[name] = { ...prior, ...normalizeSkillMetadataPatch(patch) };
  await writeSkillCatalogToDir(skillBaseDir, catalog);
  return catalog.skills[name];
}

async function deleteSkillCatalogMetadata(skillBaseDir, name) {
  const catalog = await readSkillCatalogFromDir(skillBaseDir);
  if (!catalog.skills?.[name]) return;
  delete catalog.skills[name];
  await writeSkillCatalogToDir(skillBaseDir, catalog);
}

async function listProjectRoots() {
  if (process.platform === 'win32') {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const roots = [];
    await Promise.all(letters.map(async (letter) => {
      const drivePath = `${letter}:\\`;
      try {
        await fs.access(drivePath);
        roots.push({ name: `${letter}:`, path: drivePath, isGit: false, isDrive: true });
      } catch {}
    }));
    return roots.sort((a, b) => a.name.localeCompare(b.name));
  }

  const candidates = [
    { name: '/', path: path.resolve('/') },
    { name: 'Home', path: process.env.HOME || process.env.USERPROFILE || '' },
    { name: 'Current', path: process.cwd() },
  ];
  const seen = new Set();
  const roots = [];
  for (const candidate of candidates) {
    if (!candidate.path) continue;
    const resolved = path.resolve(candidate.path);
    if (seen.has(resolved)) continue;
    try {
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) continue;
      seen.add(resolved);
      roots.push({ name: candidate.name, path: resolved, isGit: false, isDrive: false });
    } catch {}
  }
  return roots;
}

function isGeneralProjectDir(value) {
  if (!value) return false;
  return path.resolve(value) === path.resolve(GENERAL_PROJECT_DIR);
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(parent, candidate);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function listProjectSpecFiles(projectDir) {
  if (!projectDir || isGeneralProjectDir(projectDir)) return [];
  const specsDir = getProjectSpecsDir(projectDir);
  const specs = [];
  async function walk(dir) {
    let entries = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      let stat = null;
      try {
        stat = await fs.stat(fullPath);
      } catch {}
      const relativePath = path.relative(specsDir, fullPath);
      specs.push({
        name: entry.name.replace(/\.md$/i, ''),
        file: entry.name,
        path: fullPath,
        relativePath,
        updatedAt: stat?.mtime?.toISOString?.() || ''
      });
    }
  }
  await walk(specsDir);
  return specs.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

async function resolveProjectSpecFile(projectDir, rawPath = '') {
  if (!projectDir || isGeneralProjectDir(projectDir)) return '';
  const specsDir = getProjectSpecsDir(projectDir);
  const candidate = path.resolve(projectDir, String(rawPath || '').trim());
  if (!isPathInside(specsDir, candidate)) return '';
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || !candidate.toLowerCase().endsWith('.md')) return '';
    return candidate;
  } catch {
    return '';
  }
}

function getGeneralChatSystemPromptBlock() {
  return `# General Chat Mode

This is a general conversation, not an opened project workspace.
- The working directory is Codemini's internal general workspace. Do not treat it as a user project.
- Use filesystem read, write, and edit tools only as auxiliary scratch or artifact tools when the user explicitly needs local files.
- When the user asks to rewrite or transform remote content, fetch or read the content and answer with the rewritten text unless they explicitly ask you to create or modify a local file.
- Before making persistent filesystem changes in this mode, make sure the user requested a local artifact and use an obvious user-facing path or file name.`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_SOURCE_DIR = path.join(__dirname, 'client');
let CLIENT_DIR = CLIENT_SOURCE_DIR;
try {
  const distDir = path.join(__dirname, 'dist');
  const stat = await fs.stat(distDir);
  if (stat.isDirectory()) CLIENT_DIR = distDir;
} catch {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const DEFAULT_GATEWAY_BASE_URL = 'http://127.0.0.1:8000/v1';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function getConfigStatus(config) {
  const baseUrl = normalizeBaseUrl(config?.gateway?.base_url);
  const apiKey = String(config?.gateway?.api_key || '').trim();
  const setupRequired = !baseUrl || (baseUrl === DEFAULT_GATEWAY_BASE_URL && !apiKey);
  return {
    setupRequired,
    baseUrl,
    hasApiKey: !!apiKey,
    reason: setupRequired ? 'gateway_not_configured' : ''
  };
}

function parseArgs(argv) {
  const parsed = { port: 3210, session: undefined, model: undefined, project: undefined, open: true };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') { parsed.port = parseInt(argv[++i], 10) || 3210; continue; }
    if (arg === '--session' || arg === '-s') { parsed.session = argv[++i]; continue; }
    if (arg === '--model' || arg === '-m') { parsed.model = argv[++i]; continue; }
    if (arg === '--project' || arg === '-d') { parsed.project = argv[++i]; continue; }
    if (arg === '--no-open') { parsed.open = false; continue; }
  }
  return parsed;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function buildCodeWikiAskPrompt({ question, reportPath, projectDir, replyLanguage, history = [] }) {
  const historyText = buildCodeWikiHistoryContext(history, replyLanguage);
  if (getReplyLanguage(replyLanguage) === 'en') {
    return [
      'Answer the following question based on the current project and the CodeWiki / project-requirements report.',
      `Project path: ${projectDir}`,
      `Report path: ${reportPath}`,
      historyText,
      'Requirements:',
      '- Prefer reading and citing the report above.',
      '- If the report is insufficient, use read-only project inspection to gather supporting evidence.',
      '- Do not modify files unless the user explicitly asks you to add or edit code comments. If they do, only add or replace comment lines and do not change executable code.',
      '- Do not generate a new report or write memory.',
      '- Respond in English unless the user explicitly asks for another language.',
      '',
      `Question: ${question.trim()}`
    ].filter(Boolean).join('\n');
  }
  return [
    '请基于当前项目和 CodeWiki / project-requirements 报告回答下面的问题。',
    `项目路径：${projectDir}`,
    `报告路径：${reportPath}`,
    historyText,
    '要求：',
    '- 优先读取并参考上述报告。',
    '- 如果报告信息不足，可以只读检索项目文件补充证据。',
    '- 除非用户明确要求添加或编辑代码注释，否则不要修改文件；如果需要处理注释，只能添加或替换注释行，不能改变可执行代码。',
    '- 不要生成新报告，不要写入记忆。',
    '- 除非用户明确要求其他语言，否则使用简体中文回答。',
    '',
    `问题：${question.trim()}`
  ].filter(Boolean).join('\n');
}

function buildCodeWikiHistoryContext(history = [], replyLanguage) {
  if (!Array.isArray(history) || history.length === 0) return '';
  const en = getReplyLanguage(replyLanguage) === 'en';
  const header = en ? 'Conversation history:' : '对话历史：';
  const lines = [header];
  for (const entry of history) {
    if (!entry || !entry.role) continue;
    const label = entry.role === 'you' ? (en ? 'User' : '用户') : (en ? 'Assistant' : '助手');
    const text = String(entry.text || '').slice(0, 800);
    if (text) lines.push(`${label}: ${text}`);
  }
  return lines.length > 1 ? lines.join('\n') : '';
}

async function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function normalizeProjectPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const win = raw.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win && process.platform !== 'win32') {
    return path.join('/mnt', win[1].toLowerCase(), win[2].replace(/[\\/]+/g, '/'));
  }
  return path.resolve(raw);
}

function projectNameForDir(projectDir) {
  if (isGeneralProjectDir(projectDir)) return '__codemini_general__';
  return path.basename(path.resolve(projectDir || '')) || projectDir || '';
}

function getGitBranch(cwd) {
  try {
    return execSync('git symbolic-ref --quiet --short HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    return branch === 'HEAD' ? null : branch;
  }
}

function execGitStdout(command, cwd) {
  try {
    return execSync(command, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return String(err.stdout || '');
  }
}

function execGitFileStdout(args, cwd) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (err) {
    return String(err.stdout || '');
  }
}

function splitNulRecords(text) {
  return String(text || '').split('\0').filter(Boolean);
}

function hasGitHead(cwd) {
  try {
    execSync('git rev-parse --verify HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function parseGitNumstat(text) {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    const [addedRaw, removedRaw] = line.split('\t');
    if (addedRaw !== '-') linesAdded += Number(addedRaw) || 0;
    if (removedRaw !== '-') linesRemoved += Number(removedRaw) || 0;
  }
  return { linesAdded, linesRemoved };
}

function countUntrackedLineStats(cwd) {
  const untrackedRaw = execGitFileStdout(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  let linesAdded = 0;
  for (const relPath of splitNulRecords(untrackedRaw)) {
    try {
      const fullPath = path.join(cwd, relPath);
      const content = readFileSync(fullPath, 'utf8');
      linesAdded += content ? content.split('\n').length : 0;
    } catch {
      // Skip binary or unreadable files.
    }
  }
  return { linesAdded, linesRemoved: 0 };
}

function readGitLineStats(cwd) {
  const hasHead = hasGitHead(cwd);
  if (hasHead) {
    const stats = parseGitNumstat(execGitStdout('git diff HEAD --numstat', cwd));
    const untracked = countUntrackedLineStats(cwd);
    return {
      linesAdded: stats.linesAdded + untracked.linesAdded,
      linesRemoved: stats.linesRemoved + untracked.linesRemoved
    };
  }
  const cached = parseGitNumstat(execGitStdout('git diff --cached --numstat', cwd));
  const unstaged = parseGitNumstat(execGitStdout('git diff --numstat', cwd));
  const untracked = countUntrackedLineStats(cwd);
  return {
    linesAdded: cached.linesAdded + unstaged.linesAdded + untracked.linesAdded,
    linesRemoved: cached.linesRemoved + unstaged.linesRemoved + untracked.linesRemoved
  };
}

function readGitStatusEntries(cwd) {
  const records = splitNulRecords(execGitFileStdout(['status', '--porcelain=v1', '-z'], cwd));
  const statusByPath = new Map();
  for (let index = 0; index < records.length; index += 1) {
    const line = records[index];
    if (line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const filePath = line.slice(3);
    let status;
    if (x === '?' && y === '?') status = '?';
    else if (x === 'A' || y === 'A') status = 'A';
    else if (x === 'D' || y === 'D') status = 'D';
    else status = 'M';
    const staged = (x !== ' ' && x !== '?');
    statusByPath.set(filePath, { path: filePath, status, staged });
    if (x === 'R' || y === 'R' || x === 'C' || y === 'C') {
      index += 1;
    }
  }
  return statusByPath;
}

function appendUntrackedDiffPatches(cwd, patch) {
  const untrackedRaw = execGitFileStdout(['ls-files', '--others', '--exclude-standard', '-z'], cwd);
  const parts = [];
  const nullPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  for (const relPath of splitNulRecords(untrackedRaw)) {
    const diff = execGitFileStdout(['diff', '--no-index', '--no-color', '--', nullPath, relPath], cwd).trim();
    if (diff) parts.push(diff);
  }
  return [patch, ...parts].filter(Boolean).join('\n');
}

function readGitDiffPatch(cwd) {
  const hasHead = hasGitHead(cwd);
  let patch = '';
  if (hasHead) {
    patch = execGitStdout('git diff HEAD --no-color', cwd).trim();
  } else {
    patch = [
      execGitStdout('git diff --cached --no-color', cwd).trim(),
      execGitStdout('git diff --no-color', cwd).trim()
    ].filter(Boolean).join('\n');
  }
  return appendUntrackedDiffPatches(cwd, patch);
}

function readGitDiffData(cwd) {
  const patch = readGitDiffPatch(cwd);
  const patchFiles = [];
  const seenPatchFiles = new Set();
  for (const line of patch.split('\n')) {
    const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!match) continue;
    const filePath = match[2] || match[1];
    if (!filePath || seenPatchFiles.has(filePath)) continue;
    seenPatchFiles.add(filePath);
    patchFiles.push(filePath);
  }
  const statusByPath = readGitStatusEntries(cwd);
  const files = patchFiles.map((filePath) => statusByPath.get(filePath) || { path: filePath, status: 'M', staged: false });
  for (const [filePath, entry] of statusByPath.entries()) {
    if (entry.status === '?' && !seenPatchFiles.has(filePath)) {
      files.push(entry);
    }
  }
  return { patch, files, ...readGitLineStats(cwd) };
}

function readGitInfo(cwd, { includeCounts = true } = {}) {
  execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
  const branch = getGitBranch(cwd);
  if (!includeCounts) return { isGit: true, branch };

  const porcelain = execGitStdout('git status --porcelain', cwd).trim();
  const lines = porcelain ? porcelain.split('\n') : [];
  let staged = 0, modified = 0, untracked = 0;
  for (const line of lines) {
    const x = line[0], y = line[1];
    if (x === '?' && y === '?') { untracked++; continue; }
    if (x !== ' ' && x !== '?') staged++;
    if (y === 'M' || y === 'D') modified++;
  }
  const { linesAdded, linesRemoved } = readGitLineStats(cwd);
  return {
    isGit: true,
    branch,
    dirty: lines.length > 0,
    staged,
    modified,
    untracked,
    linesAdded,
    linesRemoved
  };
}

async function validProjectDir(value) {
  const normalized = normalizeProjectPath(value);
  if (!normalized) return '';
  try {
    const stat = await fs.stat(normalized);
    return stat.isDirectory() ? normalized : '';
  } catch {
    return '';
  }
}

async function resolveRequestProjectDir(value, fallbackDir) {
  const resolved = await validProjectDir(value);
  return resolved || fallbackDir;
}

async function parseProjectDirsParam(url, fallbackDir) {
  const raw = url.searchParams.get('projects');
  const parsed = raw ? tryParseJson(raw) : [];
  const values = Array.isArray(parsed) ? parsed : [];
  const seen = new Set();
  const dirs = [];
  for (const candidate of [fallbackDir, ...values]) {
    const resolved = await validProjectDir(candidate);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    dirs.push(resolved);
  }
  if (dirs.length === 0 && fallbackDir) {
    dirs.push(fallbackDir);
  }
  return dirs;
}

async function listSkillsForProjectDirs(projectDirs, fallbackDir) {
  const dirs = projectDirs.length > 0 ? projectDirs : [fallbackDir];
  const seen = new Set();
  const results = [];
  for (let index = 0; index < dirs.length; index += 1) {
    const projectDir = dirs[index];
    const entries = await listSkillEntries({ scope: 'all', cwd: projectDir });
    for (const entry of entries) {
      if (entry.scope !== 'project') {
        const globalKey = `${entry.scope}:${entry.name}:${entry.path || ''}`;
        if (seen.has(globalKey)) continue;
        seen.add(globalKey);
        results.push(entry);
        continue;
      }
      const projectKey = `project:${projectDir}:${entry.name}:${entry.path || ''}`;
      if (seen.has(projectKey)) continue;
      seen.add(projectKey);
      results.push({
        ...entry,
        projectDir,
        projectName: projectNameForDir(projectDir)
      });
    }
  }
  return results.sort((a, b) => {
    const left = `${a.scope}:${a.projectName || ''}:${a.name}`;
    const right = `${b.scope}:${b.projectName || ''}:${b.name}`;
    return left.localeCompare(right);
  });
}

async function listMemoriesForProjectDirs({ scope, query, projectDirs, fallbackDir }) {
  if (scope !== 'project') {
    const items = query
      ? await searchMemories({ scope, query, workspaceRoot: fallbackDir })
      : await listMemories({ scope, workspaceRoot: fallbackDir });
    return items;
  }
  const dirs = projectDirs.length > 0 ? projectDirs : [fallbackDir];
  const chunks = await Promise.all(dirs.map(async (projectDir) => {
    const items = query
      ? await searchMemories({ scope, query, workspaceRoot: projectDir })
      : await listMemories({ scope, workspaceRoot: projectDir });
    return (items || []).map((item) => ({
      ...item,
      projectDir,
      projectName: projectNameForDir(projectDir)
    }));
  }));
  return chunks.flat();
}

async function resolveCodeWikiProjectDir(url, fallbackDir) {
  const requested = normalizeProjectPath(url.searchParams.get('project') || '');
  if (!requested) return fallbackDir;
  try {
    const stat = await fs.stat(requested);
    if (stat.isDirectory()) return requested;
  } catch {}
  return fallbackDir;
}

function tryParseJson(value) {
  try { return JSON.parse(String(value || '')); } catch { return null; }
}

function collectSessionPathHints(session) {
  const hints = [];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const msg of messages) {
    if (Array.isArray(msg?.tool_calls)) {
      for (const call of msg.tool_calls) {
        const args = tryParseJson(call?.function?.arguments ?? call?.arguments);
        for (const key of ['path', 'file', 'filePath', 'cwd']) {
          if (typeof args?.[key] === 'string') hints.push(args[key]);
        }
      }
    }
    const content = typeof msg?.content === 'string' ? msg.content : '';
    for (const match of content.matchAll(/[A-Za-z]:[\\/][^\n\r"'`<>|]+/g)) hints.push(match[0]);
    for (const match of content.matchAll(/\/mnt\/[A-Za-z]\/[^\n\r"'`<>|]+/g)) hints.push(match[0]);
  }
  return hints;
}

async function existingDirectoryForHint(rawHint) {
  let candidate = normalizeProjectPath(rawHint);
  if (!candidate) return '';
  const configRoot = path.resolve(getBaseConfigDir());
  const candidateLower = path.resolve(candidate).toLowerCase();
  const configRootLower = configRoot.toLowerCase();
  if (candidateLower === configRootLower || candidateLower.startsWith(`${configRootLower}${path.sep}`)) return '';
  candidate = candidate.replace(/[),\].。；;:]+$/g, '');
  for (let i = 0; i < 8 && candidate && candidate !== path.dirname(candidate); i += 1) {
    try {
      const stat = await fs.stat(candidate);
      return stat.isDirectory() ? candidate : path.dirname(candidate);
    } catch {
      candidate = path.dirname(candidate);
    }
  }
  return '';
}

const CODEWIKI_REPORT_RE = /^[^/\\]+-project-requirements\.(?:html|md)$/;

function getRequirementsDir(projectDir) {
  return path.join(projectDir, 'docs', 'requirements');
}

function isCodeWikiReportFile(fileName) {
  return CODEWIKI_REPORT_RE.test(String(fileName || ''));
}

function codeWikiReportTitle(fileName) {
  return String(fileName || '')
    .replace(/-project-requirements\.(?:html|md)$/, '')
    .replace(/-/g, ' ');
}

function codeWikiReportFormat(fileName) {
  return String(fileName || '').toLowerCase().endsWith('.md') ? 'md' : 'html';
}

function clipGraphList(values, max = 12) {
  return [...new Set((Array.isArray(values) ? values : []).filter(Boolean))].slice(0, max);
}

const CODEWIKI_GRAPH_NOISY_NAMES = new Set([
  '__init__',
  '__enter__',
  '__exit__',
  '__getitem__',
  '__setitem__',
  '__delitem__',
  '__contains__',
  '__len__',
  '__iter__',
  '__next__',
  '__call__',
  'get',
  'set',
  'add',
  'run',
  'close',
  'open',
  'read',
  'write',
  'send',
  'recv',
  'poll',
  'update',
  'copy',
  'size',
  'apply'
]);

function normalizeGraphPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function isDependencyLikeGraphPath(file = '') {
  const normalized = normalizeGraphPath(file);
  const segments = normalized.split('/').filter(Boolean);
  return segments.some(
    (segment) =>
      INDEX_SKIP_DIRS.has(segment) ||
      /^venv[-_]/i.test(segment) ||
      /\.egg-info$/i.test(segment) ||
      /^python\d+(?:\.\d+)?$/i.test(segment)
  );
}

function isNoisyGraphSymbol(symbol = {}) {
  const name = String(symbol.name || symbol.symbol_id || '').split('.').pop();
  if (!name) return true;
  if (CODEWIKI_GRAPH_NOISY_NAMES.has(name)) return true;
  return /^__.*__$/.test(name);
}

function sourceRootScore(file = '') {
  const normalized = normalizeGraphPath(file);
  if (normalized.startsWith('src/')) return 8;
  if (normalized.startsWith('codemini-web/client/src/')) return 8;
  if (normalized.startsWith('codemini-web/server.js')) return 7;
  if (normalized.startsWith('codemini-web/')) return 5;
  if (normalized.startsWith('tests/')) return 1;
  return 3;
}

function buildCodeWikiSymbolGraph(fileIndex, { maxNodes = 42 } = {}) {
  const files = Array.isArray(fileIndex?.files) ? fileIndex.files : [];
  const sourceFiles = files.filter((entry) => !isDependencyLikeGraphPath(entry.file));
  const symbols = sourceFiles
    .flatMap((entry) =>
      (Array.isArray(entry.symbols) ? entry.symbols : []).map((symbol) => ({
        ...symbol,
        file: symbol.file || entry.file
      }))
    )
    .filter((symbol) => !isDependencyLikeGraphPath(symbol.file) && !isNoisyGraphSymbol(symbol));
  const ranked = symbols
    .map((symbol) => {
      const calls = Array.isArray(symbol.calls) ? symbol.calls.length : 0;
      const calledBy = Array.isArray(symbol.called_by) ? symbol.called_by.length : 0;
      const writes = Array.isArray(symbol.writes) ? symbol.writes.length : 0;
      const emits = Array.isArray(symbol.emits) ? symbol.emits.length : 0;
      const typeBoost = symbol.type === 'class' ? 8 : symbol.type === 'method' ? 4 : 2;
      return {
        symbol,
        score: sourceRootScore(symbol.file) + typeBoost + calledBy * 4 + calls * 2 + writes * 2 + emits * 2
      };
    })
    .sort((a, b) => b.score - a.score || String(a.symbol.symbol_id).localeCompare(String(b.symbol.symbol_id)))
    .slice(0, maxNodes)
    .map((item) => item.symbol);

  const byId = new Map(ranked.map((symbol) => [String(symbol.symbol_id || ''), symbol]));
  const byShortName = new Map();
  for (const symbol of ranked) {
    const shortName = String(symbol.name || '').split('.').pop();
    if (!shortName) continue;
    if (!byShortName.has(shortName)) byShortName.set(shortName, []);
    byShortName.get(shortName).push(symbol);
  }

  const nodes = ranked.map((symbol) => ({
    id: symbol.symbol_id,
    label: symbol.name || symbol.symbol_id,
    type: symbol.type || 'symbol',
    file: symbol.file || '',
    range: symbol.range || null,
    signature: symbol.signature || '',
    calls: clipGraphList(symbol.calls || [], 8),
    called_by: clipGraphList(symbol.called_by || [], 8),
    imports: clipGraphList(symbol.imports || [], 6),
    writes: clipGraphList(symbol.writes || [], 6),
    emits: clipGraphList(symbol.emits || [], 6)
  }));

  const edgeMap = new Map();
  const addEdge = (source, target, kind, label = '') => {
    if (!source || !target || source === target) return;
    if (!byId.has(source) || !byId.has(target)) return;
    const key = `${source}->${target}:${kind}`;
    if (!edgeMap.has(key)) edgeMap.set(key, { source, target, kind, label });
  };

  for (const symbol of ranked) {
    const source = String(symbol.symbol_id || '');
    for (const call of symbol.calls || []) {
      const shortName = String(call || '').split('.').pop();
      for (const target of byShortName.get(shortName) || []) {
        addEdge(source, target.symbol_id, 'calls', call);
      }
    }
    for (const caller of symbol.called_by || []) {
      addEdge(caller, source, 'called_by');
    }
  }

  const edges = [...edgeMap.values()].slice(0, 80);

  return {
    updatedAt: fileIndex?.updatedAt || '',
    stats: {
      files: files.length,
      source_files: sourceFiles.length,
      symbols: symbols.length,
      displayed_nodes: nodes.length,
      displayed_edges: edges.length
    },
    nodes,
    edges
  };
}

function commonPathPrefix(paths) {
  const normalized = paths.map((p) => path.resolve(p).split(path.sep).filter(Boolean));
  if (!normalized.length) return '';
  const prefix = [];
  for (let i = 0; i < normalized[0].length; i += 1) {
    const part = normalized[0][i];
    if (normalized.every((parts) => parts[i] === part)) prefix.push(part);
    else break;
  }
  if (!prefix.length) return path.parse(paths[0]).root || '';
  return `${path.sep}${prefix.join(path.sep)}`;
}

async function inferSessionProjectDir(session) {
  const explicit = normalizeProjectPath(session?.projectDir);
  if (explicit) {
    try {
      if ((await fs.stat(explicit)).isDirectory()) return explicit;
    } catch {}
  }

  const dirs = [];
  for (const hint of collectSessionPathHints(session)) {
    const dir = await existingDirectoryForHint(hint);
    if (dir) dirs.push(dir);
  }
  if (dirs.length === 0) return '';

  const common = commonPathPrefix(dirs);
  let candidate = common;
  while (candidate && candidate !== path.dirname(candidate)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {}
    candidate = path.dirname(candidate);
  }
  return dirs[0];
}

async function findPreferredSessionForProject(projectDir) {
  const targetKey = normalizeProjectDirKey(projectDir);
  if (!targetKey) return null;
  const sessions = await listSessions(500, { includeEmpty: true });
  const matches = sessions.filter((session) => {
    if (isGeneralProjectDir(session.projectDir)) return false;
    return normalizeProjectDirKey(session.projectDir) === targetKey;
  });
  if (!matches.length) return null;

  const sorted = [...matches].sort((a, b) =>
    String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))
  );
  const latestWithMessages = sorted.find((session) => Number(session.messageCount || 0) > 0);
  if (latestWithMessages?.id) return latestWithMessages.id;

  const empty = sorted.find((session) => Number(session.messageCount || 0) === 0);
  if (empty?.id) return empty.id;

  return sorted[0]?.id || null;
}

async function buildRuntimeForSession({ sessionId, model, projectDir }) {
  const config = await loadConfig();
  const resolvedDir = projectDir || process.cwd();
  const session = sessionId ? await loadSession(sessionId) : await createSession(resolvedDir);
  const sessionProjectDir = projectDir ? normalizeProjectPath(projectDir) : await inferSessionProjectDir(session);
  if (sessionProjectDir) {
    try {
      const stat = await fs.stat(sessionProjectDir);
      if (stat.isDirectory()) process.chdir(sessionProjectDir);
    } catch {}
  }
  session.projectDir = process.cwd();
  const isGeneral = isGeneralProjectDir(process.cwd());
  const systemPrompt = buildDefaultSystemPrompt(config, {
    extraPrompts: isGeneral ? [getGeneralChatSystemPromptBlock()] : []
  });
  const runtime = await createChatRuntime({
    session,
    config,
    model: model || config.model?.name,
    systemPrompt
  });
  return { runtime, config, session, cwd: process.cwd(), isGeneral };
}

async function main() {
  const args = parseArgs(process.argv);

  // Ensure general workspace directory exists
  await fs.mkdir(GENERAL_PROJECT_DIR, { recursive: true });

  // Set initial project directory
  if (!args.project && !args.session) {
    process.chdir(GENERAL_PROJECT_DIR);
  }
  if (args.project) {
    try {
      const resolved = path.resolve(args.project);
      process.chdir(resolved);
    } catch {}
  }

  const { runtime: initialRuntime, config } = await buildRuntimeForSession({
    sessionId: args.session,
    model: args.model
  });
  let bridge = new RuntimeBridge(initialRuntime);
  let currentProjectDir = process.cwd();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${args.port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // SSE
    if (url.pathname === '/api/events' && req.method === 'GET') {
      bridge.addClient(res);
      return;
    }

    // Static files
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      let filePath;
      if (url.pathname === '/') {
        filePath = path.join(CLIENT_DIR, 'index.html');
      } else {
        const relative = url.pathname.replace(/^\//, '');
        filePath = path.extname(relative)
          ? path.join(CLIENT_DIR, relative)
          : path.join(CLIENT_DIR, 'index.html');
      }
      if (!filePath.startsWith(CLIENT_DIR)) { res.writeHead(403); res.end(); return; }
      await serveStatic(res, filePath);
      return;
    }

    // ── Submit / Abort / Approval ──
    if (req.method === 'POST' && url.pathname === '/api/submit') {
      const { line, readOnlyCodeWiki } = await readBody(req);
      if (!line || typeof line !== 'string') { jsonResponse(res, { error: true, message: 'Missing "line" field' }, 400); return; }
      const currentConfig = await loadConfig();
      const configStatus = getConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(res, {
          error: true,
          code: 'CONFIG_REQUIRED',
          message: 'Gateway is not configured. Open Settings and set the API Base URL and API Key.',
          configStatus
        }, 409);
        return;
      }
      const result = bridge.handleSubmit(line, { readOnlyCodeWiki: readOnlyCodeWiki === true });
      jsonResponse(res, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/abort') {
      bridge.handleAbort();
      jsonResponse(res, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/execution-mode') {
      const { mode } = await readBody(req);
      if (!mode || !['normal', 'plan', 'spec'].includes(mode)) {
        jsonResponse(res, { error: true, message: 'Invalid mode' }, 400);
        return;
      }
      const normalizedMode = mode === 'spec' ? 'plan' : mode;
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Cannot switch execution mode while a request is running' }, 409);
        return;
      }
      const ok = await bridge.setExecutionMode(normalizedMode);
      jsonResponse(res, { ok });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pending-plan') {
      const body = await readBody(req);
      try {
        const plan = await bridge.updatePendingPlan(body || {});
        if (!plan) { jsonResponse(res, { error: true, message: 'Plan review has been removed; use engineering mode and /stop.' }, 409); return; }
        jsonResponse(res, { ok: true, plan });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pending-reflect') {
      const body = await readBody(req);
      try {
        const draft = await bridge.updatePendingReflect(body || {});
        if (!draft) { jsonResponse(res, { error: true, message: 'No pending reflect approval' }, 409); return; }
        jsonResponse(res, { ok: true, draft });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/pending-spec') {
      const body = await readBody(req);
      try {
        const spec = await bridge.updatePendingSpec(body || {});
        if (!spec) { jsonResponse(res, { error: true, message: 'No pending spec approval' }, 409); return; }
        jsonResponse(res, { ok: true, spec });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/approval-mode') {
      const { mode } = await readBody(req);
      if (!mode || !['review', 'auto', 'full_access'].includes(mode)) {
        jsonResponse(res, { error: true, message: 'Invalid approval mode' }, 400);
        return;
      }
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Cannot switch approval mode while a request is running' }, 409);
        return;
      }
      const ok = await bridge.setApprovalMode(mode);
      jsonResponse(res, { ok });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/approval') {
      const { id, approved } = await readBody(req);
      jsonResponse(res, { ok: bridge.handleApproval(id, !!approved) });
      return;
    }

    // ── Version ──
    if (req.method === 'GET' && url.pathname === '/api/version') {
      let latest = null;
      try {
        latest = execSync('npm view codemini-cli version', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      } catch {}
      jsonResponse(res, { current: VERSION, latest });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/update') {
      try {
        const output = execSync('npm update -g codemini-cli', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 60000 });
        jsonResponse(res, { ok: true, output: output.trim() });
      } catch (err) {
        jsonResponse(res, { ok: false, error: err.message }, 500);
      }
      return;
    }

    // ── Runtime state ──
    if (req.method === 'GET' && url.pathname === '/api/state') {
      jsonResponse(res, { ...bridge.getState(), cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/completions') {
      jsonResponse(res, bridge.getCompletions(url.searchParams.get('q') || ''));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      jsonResponse(res, bridge.getHistory());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/commands') {
      jsonResponse(res, bridge.getCommands());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/startup-events') {
      jsonResponse(res, await bridge.handleStartupEvents());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/messages') {
      jsonResponse(res, { messages: bridge.getSessionMessages(), compact: bridge.getSessionCompactMeta() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session/ui-messages') {
      jsonResponse(res, await bridge.getUiMessages());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/specs') {
      jsonResponse(res, { specs: await listProjectSpecFiles(currentProjectDir) });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/specs/open') {
      const body = await readBody(req);
      const specPath = await resolveProjectSpecFile(currentProjectDir, body?.path);
      if (!specPath) {
        jsonResponse(res, { error: true, message: 'Spec file not found' }, 404);
        return;
      }
      const specText = await fs.readFile(specPath, 'utf8');
      const spec = await bridge.setPendingSpecFromFile({
        filePath: specPath,
        specText,
        goal: path.basename(specPath, '.md'),
        summary: path.basename(specPath, '.md')
      });
      if (!spec) {
        jsonResponse(res, { error: true, message: 'Failed to open spec' }, 500);
        return;
      }
      jsonResponse(res, { ok: true, spec });
      return;
    }
    if (req.method === 'DELETE' && url.pathname === '/api/pending-spec') {
      const result = await bridge.deletePendingSpec();
      if (!result) {
        jsonResponse(res, { error: true, message: 'No pending spec approval' }, 409);
        return;
      }
      jsonResponse(res, { ok: true, ...result });
      return;
    }

    // ── CodeWiki / project requirements reports ──
    if (req.method === 'GET' && url.pathname === '/api/codewiki/reports') {
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      const requirementsDir = getRequirementsDir(codeWikiProjectDir);
      try {
        const entries = await fs.readdir(requirementsDir, { withFileTypes: true });
        const reports = [];
        for (const entry of entries) {
          if (!entry.isFile() || !isCodeWikiReportFile(entry.name)) continue;
          const reportPath = path.join(requirementsDir, entry.name);
          const stat = await fs.stat(reportPath);
          let manifestStatus = '';
          let manifestUpdatedAt = '';
          try {
            const baseName = entry.name.replace(/\.(?:html|md)$/i, '');
            const manifestPath = path.join(requirementsDir, `${baseName}.manifest.json`);
            const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
            manifestStatus = typeof manifest?.status === 'string' ? manifest.status : '';
            manifestUpdatedAt = typeof manifest?.updatedAt === 'string' ? manifest.updatedAt : '';
          } catch {
            manifestStatus = '';
            manifestUpdatedAt = '';
          }
          reports.push({
            file: entry.name,
            title: codeWikiReportTitle(entry.name),
            format: codeWikiReportFormat(entry.name),
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            manifestStatus,
            manifestUpdatedAt
          });
        }
        reports.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        jsonResponse(res, { reports });
      } catch (err) {
        if (err?.code === 'ENOENT') jsonResponse(res, { reports: [] });
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/codewiki/symbol-graph') {
      try {
        const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
        const initialized = await initializeProjectIndex(codeWikiProjectDir);
        const projectRoot = initialized?.projectRoot || codeWikiProjectDir;
        const fileIndexPath = getFileIndexPath(projectRoot);
        const fileIndex = JSON.parse(await fs.readFile(fileIndexPath, 'utf8'));
        const maxNodes = Math.max(12, Math.min(80, Number(url.searchParams.get('max_nodes') || 42)));
        jsonResponse(res, buildCodeWikiSymbolGraph(fileIndex, { maxNodes }));
      } catch (err) {
        jsonResponse(res, {
          updatedAt: '',
          stats: { files: 0, symbols: 0, displayed_nodes: 0, displayed_edges: 0 },
          nodes: [],
          edges: [],
          error: err?.message || String(err)
        });
      }
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/codewiki/report/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/codewiki/report/'.length));
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: 'Invalid report file' }, 400);
        return;
      }
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      const requirementsDir = path.resolve(getRequirementsDir(codeWikiProjectDir));
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: 'Invalid report path' }, 403);
        return;
      }
      await serveStatic(res, reportPath);
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/codewiki/report/')) {
      const fileName = decodeURIComponent(url.pathname.slice('/api/codewiki/report/'.length));
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: 'Invalid report file' }, 400);
        return;
      }
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      const requirementsDir = path.resolve(getRequirementsDir(codeWikiProjectDir));
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: 'Invalid report path' }, 403);
        return;
      }
      try {
        await fs.unlink(reportPath);
        jsonResponse(res, { ok: true, file: fileName });
      } catch (err) {
        if (err?.code === 'ENOENT') jsonResponse(res, { error: true, message: 'Report not found' }, 404);
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codewiki/generate') {
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      const { depth, format } = await readBody(req);
      const normalizedDepth = ['fast', 'standard', 'deep'].includes(String(depth || '').toLowerCase())
        ? String(depth).toLowerCase()
        : 'standard';
      const normalizedFormat = ['html', 'md'].includes(String(format || '').toLowerCase())
        ? String(format).toLowerCase()
        : 'html';
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      if (codeWikiProjectDir !== currentProjectDir) {
        const { runtime } = await buildRuntimeForSession({
          model: bridge.getState().model,
          projectDir: codeWikiProjectDir
        });
        await bridge.switchRuntime(runtime);
        currentProjectDir = process.cwd();
      }
      const result = bridge.handleCodeWikiGenerate(`/project-requirements --${normalizedDepth} --${normalizedFormat}`);
      jsonResponse(res, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/codewiki/ask') {
      const { question, reportFile, history } = await readBody(req);
      if (!question || typeof question !== 'string') {
        jsonResponse(res, { error: true, message: 'Missing "question" field' }, 400);
        return;
      }
      const currentConfig = await loadConfig();
      const configStatus = getConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(res, {
          error: true,
          code: 'CONFIG_REQUIRED',
          message: 'Gateway is not configured. Open Settings and set the API Base URL and API Key.',
          configStatus
        }, 409);
        return;
      }
      const selectedReport = isCodeWikiReportFile(reportFile) ? reportFile : '';
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      const reportPath = selectedReport
        ? path.join(getRequirementsDir(codeWikiProjectDir), selectedReport)
        : getRequirementsDir(codeWikiProjectDir);
      const prompt = buildCodeWikiAskPrompt({
        question,
        reportPath,
        projectDir: codeWikiProjectDir,
        replyLanguage: bridge.getState()?.replyLanguage,
        history: Array.isArray(history) ? history : []
      });

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no'
      });
      const writeEvent = (event) => {
        try {
          res.write(`${JSON.stringify(event)}\n`);
        } catch {}
      };
      await bridge.handleCodeWikiAsk(prompt, writeEvent);
      res.end();
      return;
    }

    // ── Session management ──
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const requestedLimit = Number(url.searchParams.get('limit') || 200);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(1000, Math.round(requestedLimit)))
        : 200;
      try {
        const sessions = await listSessions(limit);
        const { active } = await loadWebuiActiveProjects();
        const activeSet = new Set(active);
        const enriched = sessions
          .map((s) => {
            const projectKey = normalizeProjectDirKey(s.projectDir) || 'unknown';
            const isGeneral = isGeneralProjectDir(s.projectDir);
            return {
              ...s,
              projectKey,
              isGeneral
            };
          })
          .filter((s) => sessionMatchesActiveProjects(s, activeSet));
        jsonResponse(res, enriched);
      } catch (err) {
        console.error('[sessions] failed to list sessions:', err?.message || err);
        jsonResponse(res, { error: true, message: err?.message || 'Failed to list sessions' }, 500);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/new') {
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      try {
        const currentMessages = bridge.getSessionMessages();
        if (!Array.isArray(currentMessages) || currentMessages.length === 0) {
          jsonResponse(res, {
            ok: true,
            reused: true,
            sessionId: bridge.getSessionId(),
            cwd: currentProjectDir,
            isGeneral: isGeneralProjectDir(currentProjectDir)
          });
          return;
        }
        const { runtime: newRuntime, session } = await buildRuntimeForSession({
          model: bridge.getState().model,
          projectDir: currentProjectDir
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        jsonResponse(res, { ok: true, sessionId: session.id, cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/switch') {
      const { sessionId } = await readBody(req);
      if (!sessionId) { jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400); return; }
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      try {
        const { runtime: newRuntime, session: switchedSession } = await buildRuntimeForSession({
          sessionId,
          model: bridge.getState().model
        });
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        if (!isGeneralProjectDir(currentProjectDir)) {
          await patchWebuiActiveProjects({ action: 'activate', projectDir: currentProjectDir });
        }
        jsonResponse(res, {
          ok: true,
          sessionId,
          cwd: currentProjectDir,
          isGeneral: isGeneralProjectDir(currentProjectDir),
          state: { ...bridge.getState(), cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) },
          sessionData: {
            messages: bridge.getSessionMessages(),
            compact: bridge.getSessionCompactMeta()
          }
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = decodeURIComponent(url.pathname.slice('/api/sessions/'.length));
      if (!sessionId) { jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400); return; }
      const deletingCurrent = sessionId === bridge.getSessionId();
      if (deletingCurrent && bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Current session is busy' }, 409);
        return;
      }
      try {
        const result = await deleteSession(sessionId);
        let nextSessionId = bridge.getSessionId();
        let cwd = currentProjectDir;
        if (deletingCurrent) {
          const remaining = await listSessions(1);
          const next = remaining.find((session) => session.id !== sessionId);
          const built = next
            ? await buildRuntimeForSession({ sessionId: next.id, model: bridge.getState().model })
            : await buildRuntimeForSession({ model: bridge.getState().model, projectDir: currentProjectDir });
          await bridge.switchRuntime(built.runtime);
          currentProjectDir = process.cwd();
          nextSessionId = built.session.id;
          cwd = currentProjectDir;
        }
        jsonResponse(res, {
          ok: true,
          removed: result.removed,
          sessionId: nextSessionId,
          cwd,
          isGeneral: isGeneralProjectDir(currentProjectDir),
          ...(deletingCurrent ? {
            state: { ...bridge.getState(), cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) },
            sessionData: {
              messages: bridge.getSessionMessages(),
              compact: bridge.getSessionCompactMeta()
            }
          } : {})
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Project management ──
    if (req.method === 'GET' && url.pathname === '/api/project') {
      jsonResponse(res, { cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git') {
      try {
        jsonResponse(res, readGitInfo(currentProjectDir));
      } catch {
        jsonResponse(res, { isGit: false, branch: null, dirty: false, staged: 0, modified: 0, untracked: 0, linesAdded: 0, linesRemoved: 0 });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git-diff') {
      try {
        jsonResponse(res, readGitDiffData(currentProjectDir));
      } catch {
        jsonResponse(res, { patch: '', files: [], linesAdded: 0, linesRemoved: 0 });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/session-changes') {
      try {
        jsonResponse(res, { changes: await bridge.getChangeSets() });
      } catch (err) {
        jsonResponse(res, { error: true, message: err?.message || 'Failed to read session changes' }, 500);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/session-changes/') && url.pathname.endsWith('/patch')) {
      const id = decodeURIComponent(url.pathname.slice('/api/session-changes/'.length, -'/patch'.length));
      try {
        jsonResponse(res, { id, patch: await bridge.getChangeSetPatch(id) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err?.message || 'Failed to read change patch' }, 404);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname !== '/api/session-changes/undo' && url.pathname.startsWith('/api/session-changes/') && url.pathname.endsWith('/undo')) {
      const id = decodeURIComponent(url.pathname.slice('/api/session-changes/'.length, -'/undo'.length));
      try {
        jsonResponse(res, await bridge.undoChangeSet(id));
      } catch (err) {
        jsonResponse(res, { error: true, message: err?.message || 'Failed to undo change' }, 409);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/session-changes/undo') {
      const { ids } = await readBody(req);
      try {
        jsonResponse(res, await bridge.undoChangeSets(ids));
      } catch (err) {
        jsonResponse(res, { error: true, message: err?.message || 'Failed to undo changes' }, 409);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/git-batch') {
      const { dirs } = await readBody(req);
      const result = {};
      for (const dir of (Array.isArray(dirs) ? dirs : [])) {
        try {
          const resolved = path.resolve(dir);
          result[dir] = readGitInfo(resolved, { includeCounts: false });
        } catch {
          result[dir] = { isGit: false, branch: null };
        }
      }
      jsonResponse(res, result);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/open') {
      const { path: projectPath, newSession: forceNewSession = false } = await readBody(req);
      if (!projectPath) { jsonResponse(res, { error: true, message: 'Missing path' }, 400); return; }
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      try {
        // Client marker for general workspace
        const openingGeneral = projectPath === '__codemini_general__';
        const resolved = openingGeneral ? GENERAL_PROJECT_DIR : path.resolve(projectPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) throw new Error('Not a directory');
        let built;
        let reusedSessionId = null;
        if (openingGeneral) {
          if (forceNewSession) {
            built = await buildRuntimeForSession({
              model: bridge.getState().model,
              projectDir: GENERAL_PROJECT_DIR
            });
          } else {
            const all = await listSessions(1000, { includeEmpty: true });
            const reusable = all.find((session) =>
              isGeneralProjectDir(session.projectDir) &&
              Number(session.messageCount || 0) === 0
            );
            built = reusable
              ? await buildRuntimeForSession({ sessionId: reusable.id, model: bridge.getState().model })
              : await buildRuntimeForSession({ model: bridge.getState().model, projectDir: GENERAL_PROJECT_DIR });
          }
        } else {
          await patchWebuiActiveProjects({ action: 'activate', projectDir: resolved });
          process.chdir(resolved);
          currentProjectDir = process.cwd();
          if (!forceNewSession) {
            reusedSessionId = await findPreferredSessionForProject(currentProjectDir);
          }
          built = await buildRuntimeForSession({
            sessionId: reusedSessionId || undefined,
            model: bridge.getState().model,
            projectDir: currentProjectDir
          });
        }
        const { runtime: newRuntime, session } = built;
        await bridge.switchRuntime(newRuntime);
        currentProjectDir = process.cwd();
        const isGeneral = isGeneralProjectDir(currentProjectDir);
        jsonResponse(res, {
          ok: true,
          cwd: currentProjectDir,
          sessionId: session.id,
          isGeneral,
          reusedSession: Boolean(reusedSessionId),
          state: { ...bridge.getState(), cwd: currentProjectDir, isGeneral },
          sessionData: {
            messages: bridge.getSessionMessages(),
            compact: bridge.getSessionCompactMeta()
          }
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/project/browse') {
      const { dir } = await readBody(req);
      const roots = await listProjectRoots();
      if (!dir && roots.length) {
        jsonResponse(res, { path: '', roots, dirs: [] });
        return;
      }
      const base = dir ? path.resolve(dir) : path.resolve('/');
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        const dirs = entries
          .filter(e => e.isDirectory() && !e.name.startsWith('.'))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map(e => ({
            name: e.name,
            path: path.join(base, e.name),
            isGit: false
          }));
        // Check for .git directories asynchronously
        await Promise.all(dirs.map(async (d) => {
          try { await fs.access(path.join(d.path, '.git')); d.isGit = true; } catch {}
        }));
        jsonResponse(res, { path: base, roots, dirs });
      } catch (err) {
        jsonResponse(res, { path: base, roots, dirs: [], error: err.message });
      }
      return;
    }

    // ── Config management ──
    if (req.method === 'GET' && url.pathname === '/api/config/status') {
      const config = await loadConfig();
      jsonResponse(res, getConfigStatus(config));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      const config = await loadConfig();
      jsonResponse(res, config);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/config/set') {
      const { key, value } = await readBody(req);
      if (!key) { jsonResponse(res, { error: true, message: 'Missing key' }, 400); return; }
      try {
        await setConfigValue(key, value);
        const config = await loadConfig();
        await bridge.reloadConfig(
          key === 'model.name' ? { model: config.model?.name } : {}
        );
        bridge.broadcastRuntimeState();
        jsonResponse(res, { ok: true, config });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/config/get/')) {
      const key = url.pathname.slice('/api/config/get/'.length);
      const value = await getConfigValue(key);
      jsonResponse(res, { key, value });
      return;
    }

    // ── Web UI active projects (stored in global config.json) ──
    if (req.method === 'GET' && url.pathname === '/api/webui/active-projects') {
      try {
        const projects = await loadWebuiActiveProjects();
        jsonResponse(res, projects);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'PATCH' && url.pathname === '/api/webui/active-projects') {
      try {
        const body = await readBody(req);
        const projects = await patchWebuiActiveProjects(body || {});
        jsonResponse(res, { ok: true, ...projects });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Memory management ──
    if (req.method === 'GET' && url.pathname === '/api/memory') {
      const scope = normalizeMemoryScope(url.searchParams.get('scope'));
      const query = String(url.searchParams.get('q') || '').trim();
      try {
        const projectDirs = await parseProjectDirsParam(url, currentProjectDir);
        const items = await listMemoriesForProjectDirs({
          scope,
          query,
          projectDirs,
          fallbackDir: currentProjectDir
        });
        jsonResponse(res, { scope, query, items });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/memory/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/memory/'.length));
      const scope = normalizeMemoryScope(url.searchParams.get('scope'));
      if (!id) { jsonResponse(res, { error: true, message: 'Missing memory id' }, 400); return; }
      try {
        const workspaceRoot = scope === 'project'
          ? await resolveRequestProjectDir(url.searchParams.get('projectDir'), currentProjectDir)
          : currentProjectDir;
        const result = await forgetMemory({ scope, id, workspaceRoot });
        jsonResponse(res, { ok: true, scope, ...result });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Skills management ──
    if (req.method === 'GET' && url.pathname === '/api/skills') {
      try {
        const projectDirs = await parseProjectDirsParam(url, currentProjectDir);
        const skills = await listSkillsForProjectDirs(projectDirs, currentProjectDir);
        jsonResponse(res, skills);
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/content')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/content'.length));
      try {
        const targetProjectDir = await resolveRequestProjectDir(url.searchParams.get('projectDir'), currentProjectDir);
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        const content = await fs.readFile(skill.path, 'utf8');
        jsonResponse(res, { name: skill.name, content, scope: skill.scope });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/create') {
      const { name, description, content, scope: rawScope, projectDir } = await readBody(req);
      if (!name || !content) { jsonResponse(res, { error: true, message: 'Missing name or content' }, 400); return; }
      if (!isSafeSkillName(name)) { jsonResponse(res, { error: true, message: 'Invalid skill name' }, 400); return; }
      try {
        const scope = normalizeSkillScope(rawScope);
        const targetProjectDir = scope === 'project'
          ? await resolveRequestProjectDir(projectDir, currentProjectDir)
          : currentProjectDir;
        const skillBaseDir = skillBaseDirForScope(scope, targetProjectDir);
        const skillDir = path.join(skillBaseDir, name);
        await fs.mkdir(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, 'SKILL.md');
        await fs.writeFile(skillFile, content, 'utf8');
        if (scope === 'global') {
          await upsertSkillRegistryEntry(undefined, {
            name,
            version: '0.0.0',
            description: description || '',
            enabled: true,
            source: 'web-create',
            entryFile: 'SKILL.md',
            sha256: await computeFileSha256(skillFile),
            installedAt: new Date().toISOString()
          });
          await upsertSkillCatalogMetadata(getSkillsDir(), name, {
            description: description || '',
            mode: 'agent_requested',
            triggers: [],
            enabled: true,
            priority: 50
          });
        } else {
          await upsertProjectSkillMetadata(targetProjectDir, name, {
            description: description || '',
            mode: 'agent_requested',
            triggers: [],
            enabled: true,
            priority: 50
          });
        }
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = true;
        await saveConfig(config);
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, name, scope, projectDir: scope === 'project' ? targetProjectDir : '' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/install') {
      const { source, scope: rawScope, projectDir } = await readBody(req);
      if (!source) { jsonResponse(res, { error: true, message: 'Missing source' }, 400); return; }
      try {
        const scope = normalizeSkillScope(rawScope);
        const targetProjectDir = scope === 'project'
          ? await resolveRequestProjectDir(projectDir, currentProjectDir)
          : currentProjectDir;
        const installed = await installSkillSource(source, { scope, cwd: targetProjectDir });
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, installed, scope, projectDir: scope === 'project' ? targetProjectDir : '' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/content')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/content'.length));
      const { content, projectDir } = await readBody(req);
      if (!content) { jsonResponse(res, { error: true, message: 'Missing content' }, 400); return; }
      try {
        const targetProjectDir = await resolveRequestProjectDir(projectDir, currentProjectDir);
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot edit builtin skill' }, 403); return; }
        await fs.writeFile(skill.path, content, 'utf8');
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length));
      try {
        const targetProjectDir = await resolveRequestProjectDir(url.searchParams.get('projectDir'), currentProjectDir);
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot delete builtin skill' }, 403); return; }
        const dir = path.dirname(skill.path);
        await fs.rm(dir, { recursive: true, force: true });
        const registry = await readSkillRegistry();
        registry.skills = (registry.skills || []).filter(s => s.name !== name);
        await writeSkillRegistry(undefined, registry);
        const catalog = await readProjectSkillCatalog(targetProjectDir);
        if (catalog.skills?.[name]) {
          delete catalog.skills[name];
          await writeProjectSkillCatalog(targetProjectDir, catalog);
        }
        await deleteSkillCatalogMetadata(getSkillsDir(), name);
        const config = await loadConfig();
        if (config.skills?.enabled) delete config.skills.enabled[name];
        await saveConfig(config);
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/metadata')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/metadata'.length));
      const body = await readBody(req);
      try {
        const targetProjectDir = await resolveRequestProjectDir(body?.projectDir, currentProjectDir);
        const requestedProjectDir = body?.targetProjectDir
          ? await resolveRequestProjectDir(body.targetProjectDir, currentProjectDir)
          : targetProjectDir;
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin' && body?.scope && body.scope !== 'builtin') {
          jsonResponse(res, { error: true, message: 'Cannot move builtin skill' }, 403);
          return;
        }
        const metadataPatch = normalizeSkillMetadataPatch(body || {});
        let metadata = metadataPatch;
        const requestedScope = body?.scope ? normalizeSkillScope(body.scope) : skill.scope;
        let nextScope = skill.scope;
        let nextProjectDir = targetProjectDir;

        if (
          skill.scope !== 'builtin' &&
          (requestedScope !== skill.scope || (requestedScope === 'project' && requestedProjectDir !== targetProjectDir))
        ) {
          const sourceDir = path.dirname(skill.path);
          const targetBaseDir = skillBaseDirForScope(requestedScope, requestedProjectDir);
          const targetDir = path.join(targetBaseDir, name);
          await fs.rm(targetDir, { recursive: true, force: true });
          await fs.mkdir(path.dirname(targetDir), { recursive: true });
          await fs.cp(sourceDir, targetDir, { recursive: true, force: true });
          await fs.rm(sourceDir, { recursive: true, force: true });
          if (requestedScope === 'global') {
            await deleteSkillCatalogMetadata(getProjectSkillsDir(targetProjectDir), name);
            await upsertSkillRegistryEntry(undefined, {
              name,
              version: skill.version || '0.0.0',
              description: metadataPatch.description ?? skill.description ?? '',
              enabled: metadataPatch.enabled !== undefined ? metadataPatch.enabled : skill.enabled !== false,
              source: 'web-move',
              entryFile: 'SKILL.md',
              sha256: await computeFileSha256(path.join(targetDir, 'SKILL.md')),
              installedAt: new Date().toISOString()
            });
          } else {
            const registry = await readSkillRegistry();
            registry.skills = (registry.skills || []).filter(s => s.name !== name);
            await writeSkillRegistry(undefined, registry);
            await deleteSkillCatalogMetadata(getSkillsDir(), name);
            if (requestedProjectDir !== targetProjectDir) {
              await deleteSkillCatalogMetadata(getProjectSkillsDir(targetProjectDir), name);
            }
          }
          nextScope = requestedScope;
          nextProjectDir = requestedScope === 'project' ? requestedProjectDir : targetProjectDir;
        }

        if (nextScope === 'global') {
          await upsertSkillRegistryEntry(undefined, {
            name,
            ...(metadataPatch.description !== undefined ? { description: metadataPatch.description } : {}),
            ...(metadataPatch.enabled !== undefined ? { enabled: metadataPatch.enabled } : {})
          });
          metadata = await upsertSkillCatalogMetadata(getSkillsDir(), name, body || {});
        } else if (nextScope === 'project') {
          metadata = await upsertProjectSkillMetadata(nextProjectDir, name, body || {});
        } else if (skill.scope !== 'builtin') {
          metadata = await upsertProjectSkillMetadata(targetProjectDir, name, body || {});
        } else {
          metadata = await upsertProjectSkillMetadata(targetProjectDir, name, body || {});
        }
        if (skill.scope !== 'builtin' && body?.enabled !== undefined) {
          const config = await loadConfig();
          config.skills = config.skills || {};
          config.skills.enabled = config.skills.enabled || {};
          config.skills.enabled[name] = body.enabled !== false;
          await saveConfig(config);
          const registry = await readSkillRegistry();
          const idx = registry.skills.findIndex(s => s.name === name);
          if (idx !== -1) { registry.skills[idx].enabled = body.enabled !== false; await writeSkillRegistry(undefined, registry); }
        }
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, name, metadata });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/skills/') && url.pathname.endsWith('/toggle')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length, -'/toggle'.length));
      const { enabled, projectDir } = await readBody(req);
      try {
        const targetProjectDir = await resolveRequestProjectDir(projectDir, currentProjectDir);
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') {
          const metadata = await upsertProjectSkillMetadata(targetProjectDir, name, { enabled });
          await bridge.reloadCommandsAndSkills();
          jsonResponse(res, { ok: true, name, metadata });
          return;
        }
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = !!enabled;
        await saveConfig(config);
        const registry = await readSkillRegistry();
        const idx = registry.skills.findIndex(s => s.name === name);
        if (idx !== -1) { registry.skills[idx].enabled = !!enabled; await writeSkillRegistry(undefined, registry); }
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }

    // ── Souls management ──
    const _BUNDLED_SOULS_DIR = path.resolve(__dirname, '..', 'souls');
    const _CUSTOM_SOULS_DIR = path.join(getBaseConfigDir(), 'souls');

    if (req.method === 'GET' && url.pathname === '/api/souls') {
      try {
        const config = await loadConfig();
        const activePreset = config?.soul?.preset || 'default';
        const souls = [];
        const bundledEntries = await fs.readdir(_BUNDLED_SOULS_DIR);
        for (const file of bundledEntries) {
          if (!file.endsWith('.md')) continue;
          const sname = file.slice(0, -3);
          const scontent = await fs.readFile(path.join(_BUNDLED_SOULS_DIR, file), 'utf8');
          souls.push({ name: sname, scope: 'builtin', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: sname === activePreset });
        }
        try {
          const customEntries = await fs.readdir(_CUSTOM_SOULS_DIR);
          for (const file of customEntries) {
            if (!file.endsWith('.md')) continue;
            const sname = file.slice(0, -3);
            const scontent = await fs.readFile(path.join(_CUSTOM_SOULS_DIR, file), 'utf8');
            souls.push({ name: sname, scope: 'custom', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: sname === activePreset });
          }
        } catch {}
        jsonResponse(res, souls);
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/souls/') && url.pathname.endsWith('/content')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length, -'/content'.length));
      try {
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        try { const scontent = await fs.readFile(customPath, 'utf8'); jsonResponse(res, { name: sname, content: scontent, scope: 'custom' }); return; } catch {}
        const bundledPath = path.join(_BUNDLED_SOULS_DIR, `${sname}.md`);
        const scontent = await fs.readFile(bundledPath, 'utf8');
        jsonResponse(res, { name: sname, content: scontent, scope: 'builtin' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/souls/create') {
      const { name: rawName, content: soulContent } = await readBody(req);
      if (!rawName || !soulContent) { jsonResponse(res, { error: true, message: 'Missing name or content' }, 400); return; }
      try {
        const safeName = String(rawName).replace(/[^a-zA-Z0-9_-]/g, '');
        if (!safeName) { jsonResponse(res, { error: true, message: 'Invalid name' }, 400); return; }
        const bundledCheck = path.join(_BUNDLED_SOULS_DIR, `${safeName}.md`);
        try { await fs.access(bundledCheck); jsonResponse(res, { error: true, message: 'Name conflicts with builtin soul' }, 409); return; } catch {}
        await fs.mkdir(_CUSTOM_SOULS_DIR, { recursive: true });
        await fs.writeFile(path.join(_CUSTOM_SOULS_DIR, `${safeName}.md`), soulContent, 'utf8');
        jsonResponse(res, { ok: true, name: safeName });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'PUT' && url.pathname.startsWith('/api/souls/') && url.pathname.endsWith('/content')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length, -'/content'.length));
      const { content: soulContent } = await readBody(req);
      if (!soulContent) { jsonResponse(res, { error: true, message: 'Missing content' }, 400); return; }
      try {
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        try { await fs.access(customPath); } catch { jsonResponse(res, { error: true, message: 'Custom soul not found' }, 404); return; }
        await fs.writeFile(customPath, soulContent, 'utf8');
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/souls/')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length));
      try {
        const bundledPath = path.join(_BUNDLED_SOULS_DIR, `${sname}.md`);
        try { await fs.access(bundledPath); jsonResponse(res, { error: true, message: 'Cannot delete builtin soul' }, 403); return; } catch {}
        const customPath = path.join(_CUSTOM_SOULS_DIR, `${sname}.md`);
        await fs.unlink(customPath);
        const config = await loadConfig();
        if (config.soul?.preset === sname) { config.soul.preset = 'default'; await saveConfig(config); }
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/souls/activate') {
      const { name: sname } = await readBody(req);
      if (!sname) { jsonResponse(res, { error: true, message: 'Missing name' }, 400); return; }
      try {
        const config = await loadConfig();
        config.soul = config.soul || {};
        config.soul.preset = sname;
        config.soul.custom_path = '';
        await saveConfig(config);
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(args.port, () => {
    console.log(`\n  Codemini Web UI\n  http://localhost:${args.port}\n  Project: ${currentProjectDir}\n`);
    if (!args.open) return;
    const openCmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    import('node:child_process').then(({ exec }) => {
      exec(`${openCmd} http://localhost:${args.port}`, (err) => { if (err) console.log('  Could not auto-open browser.'); });
    });
  });

  const cleanup = async () => {
    await bridge.dispose();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
