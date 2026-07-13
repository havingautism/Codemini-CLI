import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import sharp from 'sharp';

import { loadConfig, saveConfig, setConfigValue, getConfigValue } from '../src/core/config-store.js';
import {
  loadWebuiActiveProjects,
  normalizeProjectDirKey,
  patchWebuiActiveProjects,
  sessionMatchesActiveProjects
} from '../src/core/webui-sidebar-config.js';
import { createChatRuntime } from '../src/core/chat-runtime.js';
import { createSession, loadSession, listSessions, resolveSession, deleteSession, saveSession } from '../src/core/session-store.js';
import { buildDefaultSystemPrompt } from '../src/core/default-system-prompt.js';
import { RuntimeBridge } from './lib/runtime-bridge.js';
import {
  RuntimePool,
  startRuntimeEvictionTimer
} from './lib/runtime-pool.js';
import { resolveGitCwd, shouldAdoptGitCwd } from './lib/git-project.js';
import { resolveEmbed } from './lib/embed-resolver.js';
import { installSkillSource, listSkillEntries, updateSkillPackage } from '../src/commands/skill.js';
import { computeFileSha256, readSkillRegistry, upsertSkillRegistryEntry, writeSkillRegistry } from '../src/core/skill-registry.js';
import {
  archiveEntry,
  forgetMemory,
  listInbox,
  listMemories,
  searchMemories
} from '../src/core/memory-store.js';
import { runDreamConsolidation } from '../src/core/dream-consolidate.js';
import { getReplyLanguage } from '../src/core/reply-language.js';
import { normalizeSkillContexts } from '../src/core/skill-contexts.js';
import { getBaseConfigDir, getFileIndexPath, getProjectSkillsDir, getProjectSpecsDir, getSkillsDir } from '../src/core/paths.js';
import { initializeProjectIndex } from '../src/core/project-index.js';
import { INDEX_SKIP_DIRS } from '../src/core/constants.js';
import { VERSION } from '../src/core/version.js';
import { detectPlaywrightStatus } from '../src/core/tools.js';

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
  if (input.contexts !== undefined) {
    out.contexts = normalizeSkillContexts(input.contexts);
  }
  return out;
}

function parseSkillFrontmatter(raw = '') {
  const normalized = String(raw || '').replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    const lines = normalized.split('\n');
    const metadata = {};
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index += 1;
    const start = index;
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (!trimmed) break;
      const inlineNameDescription = trimmed.match(/^name\s*:\s*(.*?)\s+description\s*:\s*(.+)$/i);
      if (inlineNameDescription) {
        metadata.name = inlineNameDescription[1].trim().replace(/^["']|["']$/g, '');
        metadata.description = inlineNameDescription[2].trim().replace(/^["']|["']$/g, '');
        index += 1;
        continue;
      }
      const match = trimmed.match(/^(name|description|version|mode|triggers|priority|enabled)\s*:\s*(.*)$/i);
      if (!match) break;
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      metadata[key] = value.startsWith('[') && value.endsWith(']')
        ? value.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : value.replace(/^["']|["']$/g, '');
      index += 1;
    }
    if (index > start) {
      while (index < lines.length && !lines[index].trim()) index += 1;
      return { metadata, content: lines.slice(index).join('\n') };
    }
    return { metadata: {}, content: normalized };
  }
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) {
    return { metadata: {}, content: normalized };
  }

  const metadata = {};
  const lines = normalized.slice(4, end).trim().split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      metadata[key] = inner
        ? inner.split(',').map((item) => item.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
        : [];
      continue;
    }
    metadata[key] = value.replace(/^["']|["']$/g, '');
  }

  return {
    metadata,
    content: normalized.slice(end + 5).trimStart()
  };
}

function formatFrontmatterValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => JSON.stringify(String(item))).join(', ')}]`;
  }
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  return JSON.stringify(String(value || ''));
}

function serializeSkillMarkdown(metadata = {}, content = '') {
  const preferred = ['name', 'description', 'version', 'mode', 'triggers', 'priority', 'enabled'];
  const keys = [
    ...preferred.filter((key) => metadata[key] !== undefined && metadata[key] !== ''),
    ...Object.keys(metadata).filter((key) => !preferred.includes(key) && metadata[key] !== undefined && metadata[key] !== '')
  ];
  if (keys.length === 0) return String(content || '').trimStart();
  const frontmatter = keys.map((key) => `${key}: ${formatFrontmatterValue(metadata[key])}`).join('\n');
  return `---\n${frontmatter}\n---\n\n${String(content || '').trimStart()}`;
}

function patchSkillMarkdownMetadata(raw = '', patch = {}, fallbackName = '') {
  const parsed = parseSkillFrontmatter(raw);
  const normalizedPatch = normalizeSkillMetadataPatch(patch);
  const metadata = {
    ...(parsed.metadata || {}),
    ...(fallbackName ? { name: parsed.metadata?.name || fallbackName } : {}),
    ...normalizedPatch
  };
  return serializeSkillMarkdown(metadata, parsed.content);
}

function metadataPatchFromSkillMarkdown(raw = '') {
  const parsed = parseSkillFrontmatter(raw);
  return normalizeSkillMetadataPatch(parsed.metadata || {});
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
const require = createRequire(import.meta.url);
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
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 80_000;
const MODEL_IMAGE_MAX_DIMENSION = 1568;
const MODEL_IMAGE_WEBP_QUALITY = 80;
const ATTACHMENT_UPLOAD_DIR = path.join(getBaseConfigDir(), 'web-ui-uploads');
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.docx']);
const IMAGE_ATTACHMENT_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

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

const CHAT_CONFLICT_CODES = new Set([
  'BUSY',
  'STALE_ACTION',
  'NO_PENDING_REVIEW',
  'NO_PENDING_APPROVAL'
]);

function chatErrorResponse(res, error, fallbackCode) {
  const code = error?.code || fallbackCode;
  const status = CHAT_CONFLICT_CODES.has(code) ? 409 : 400;
  jsonResponse(res, {
    error: true,
    code,
    message: error?.message || String(error)
  }, status);
}

function ensureAcceptedBridgeResult(result) {
  if (result?.accepted === false || result?.error) {
    const error = new Error(result?.message || 'Chat request was rejected');
    error.code = result?.code || 'INVALID_REQUEST';
    throw error;
  }
  return result;
}

export function createEventBroker() {
  const clients = new Set();
  const publish = (event) => {
    const tagged = event?.sessionId || !event?.state?.sessionId
      ? event
      : { ...event, sessionId: event.state.sessionId };
    const payload = `data: ${JSON.stringify(tagged)}\n\n`;
    for (const client of clients) {
      try { client.write(payload); } catch { clients.delete(client); }
    }
  };
  return {
    publish,
    addClient(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
      clients.add(res);
      res.on('close', () => clients.delete(res));
    }
  };
}

function poolBridge(pool, sessionId) {
  return pool.entries.get(sessionId)?.bridge || null;
}

function requireSessionId(res, sessionId) {
  const normalized = String(sessionId || '').trim();
  if (normalized) return normalized;
  jsonResponse(res, { error: true, message: 'Missing sessionId' }, 400);
  return '';
}

const RECOVERABLE_RUNTIME_STATUSES = new Set([
  'queued', 'running', 'waiting_approval', 'waiting_input'
]);
const ACTIVE_RUNTIME_STATUSES = new Set(RECOVERABLE_RUNTIME_STATUSES);
const TERMINAL_RUNTIME_STATUSES = new Set([
  'completed', 'failed', 'aborted', 'interrupted', 'idle'
]);
const APPROVAL_ACTION_NAMES = new Set(['approval.approve', 'approval.reject']);

function interactionConflict(res, status) {
  const alreadyResuming = status === 'queued' || status === 'running';
  jsonResponse(res, {
    error: true,
    code: alreadyResuming ? 'ALREADY_RESUMING' : 'NOT_WAITING',
    message: alreadyResuming
      ? 'Interaction response is already queued or running'
      : 'Session is not waiting for this interaction'
  }, 409);
}

function staleInteractionResponse(res) {
  jsonResponse(res, {
    error: true,
    code: 'STALE_INTERACTION',
    message: 'Interaction request is no longer pending'
  }, 409);
}

function recoveredInteractionResponse(res, extra = {}) {
  jsonResponse(res, {
    ok: true,
    recovered: true,
    ...extra
  }, 200);
}

function clearStaleApprovalInteraction(bridge, requestId, approved) {
  if (!bridge?.hasPendingApproval?.(requestId)) return false;
  return bridge.handleApproval?.(requestId, approved) === true;
}

function clearStaleUserInputInteraction(bridge, requestId) {
  if (!bridge?.hasPendingUserInput?.(requestId)) return false;
  return bridge.handleUserInput?.(requestId, { status: 'skipped', answers: {} }) === true;
}

export function createServerCleanup({
  runtimeEvictionTimer,
  pool,
  runtimeStatusStore,
  server,
  exit = () => process.exit(0)
}) {
  let cleanupPromise = null;
  return () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      runtimeEvictionTimer.stop();
      await Promise.allSettled(
        [...pool.entries.values()].map(entry => entry.bridge?.dispose?.())
      );
      pool.entries.clear();
      await runtimeStatusStore.flush();
      await new Promise(resolve => server.close(() => resolve()));
      exit();
    })();
    return cleanupPromise;
  };
}

export function createRuntimeStatusStore(
  filePath = path.join(getBaseConfigDir(), 'web-runtime-status.json')
) {
  let writes = Promise.resolve();
  const read = async () => {
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      if (error?.code === 'ENOENT') return {};
      throw error;
    }
  };
  const update = (mutate) => {
    writes = writes.then(async () => {
      const states = await read();
      await mutate(states);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${JSON.stringify(states, null, 2)}\n`, 'utf8');
    });
    return writes;
  };
  return {
    read,
    set(sessionId, status) {
      return update(states => {
        states[sessionId] = {
          status,
          updatedAt: new Date().toISOString()
        };
      });
    },
    remove(sessionId) {
      return update(states => {
        delete states[sessionId];
      });
    },
    flush() {
      return writes;
    },
    async recoverInterrupted() {
      const recovered = [];
      await update(states => {
        for (const [sessionId, state] of Object.entries(states)) {
          if (!RECOVERABLE_RUNTIME_STATUSES.has(state?.status)) continue;
          states[sessionId] = {
            ...state,
            status: 'interrupted',
            updatedAt: new Date().toISOString()
          };
          recovered.push(sessionId);
        }
      });
      return recovered;
    }
  };
}

export function createWebRuntimeApi({
  pool,
  eventBroker,
  ensureSession,
  listSessions: listStoredSessions = listSessions,
  deleteSession: deleteStoredSession = deleteSession,
  createSession: createStoredSession = createSession,
  loadActiveProjects = loadWebuiActiveProjects,
  runtimeStatusStore = null,
  getDefaultProjectDir = () => process.cwd(),
  setDefaultProjectDir = null,
  loadConfig: loadRuntimeConfig = loadConfig,
  getConfigStatus: getRuntimeConfigStatus = getConfigStatus
}) {
  const loadBridge = async (res, sessionId) => {
    const id = requireSessionId(res, sessionId);
    if (!id) return null;
    try {
      await ensureSession(id);
    } catch (error) {
      const notFound = error?.code === 'ENOENT' || error?.code === 'SESSION_NOT_FOUND';
      jsonResponse(res, {
        error: true,
        code: notFound ? 'SESSION_NOT_FOUND' : 'SESSION_LOAD_FAILED',
        message: notFound ? 'Session not found' : (error?.message || 'Failed to load session')
      }, notFound ? 404 : 400);
      return null;
    }
    return poolBridge(pool, id);
  };
  const submitOperation = (sessionId, invoke) => pool.submit(
    sessionId,
    bridge => typeof bridge.runPooled === 'function'
      ? bridge.runPooled(() => invoke(bridge))
      : invoke(bridge)
  );
  const resumeOperation = (sessionId, invoke) => pool.resume(
    sessionId,
    bridge => {
      const start = () => invoke(bridge);
      return typeof bridge.runPooled === 'function'
        ? bridge.runPooled(start)
        : start();
    }
  );

  return async function handleWebRuntimeApi(req, res) {
    const url = new URL(req.url, 'http://localhost');

    if (req.method === 'GET' && url.pathname === '/api/events') {
      eventBroker.addClient(res);
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/runtime/sessions') {
      const persisted = await runtimeStatusStore?.read?.() || {};
      const states = Object.fromEntries(pool.listStates().map(state => [state.sessionId, state]));
      for (const [sessionId, state] of Object.entries(persisted)) {
        if (!states[sessionId]) states[sessionId] = { sessionId, ...state };
      }
      jsonResponse(res, {
        sessions: states
      });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/sessions') {
      const requestedLimit = Number(url.searchParams.get('limit') || 200);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(1000, Math.round(requestedLimit)))
        : 200;
      const sessions = await listStoredSessions(limit);
      const { active } = await loadActiveProjects();
      const activeSet = new Set(active);
      jsonResponse(res, sessions
        .map(session => ({
          ...session,
          projectKey: normalizeProjectDirKey(session.projectDir) || 'unknown',
          isGeneral: isGeneralProjectDir(session.projectDir),
          runtime: pool.getSessionState(session.id)
        }))
        .filter(session => sessionMatchesActiveProjects(session, activeSet)));
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/sessions/new') {
      const body = await readBody(req);
      try {
        const projectDir = normalizeProjectPath(body?.projectDir || getDefaultProjectDir()) || getDefaultProjectDir();
        const projectKey = normalizeProjectDirKey(projectDir);
        const all = await listSessions(1000, { includeEmpty: true });
        const reusable = all.find((session) => {
          if (Number(session.messageCount || 0) > 0) return false;
          return normalizeProjectDirKey(session.projectDir) === projectKey;
        });
        const session = reusable
          ? await loadSession(reusable.id)
          : await createStoredSession(projectDir);
        await ensureSession(session.id);
        const isGeneral = isGeneralProjectDir(session.projectDir);
        jsonResponse(res, {
          ok: true,
          sessionId: session.id,
          cwd: session.projectDir,
          isGeneral,
          reusedSession: Boolean(reusable?.id)
        });
      } catch (error) {
        jsonResponse(res, {
          error: true,
          message: error?.message || 'Failed to create session'
        }, 400);
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/attachments') {
      const sessionId = url.searchParams.get('sessionId');
      const bridge = await loadBridge(res, sessionId);
      if (!bridge) return true;
      try {
        const form = await readMultipartForm(req);
        const files = form.getAll('files').filter(
          item => item && typeof item.arrayBuffer === 'function'
        );
        if (!files.length) {
          jsonResponse(res, { error: true, message: 'Missing attachment file' }, 400);
          return true;
        }
        const attachments = [];
        for (const file of files.slice(0, 8)) {
          attachments.push(await saveUploadedAttachment({ file, sessionId }));
        }
        jsonResponse(res, { ok: true, attachments });
      } catch (error) {
        jsonResponse(res, {
          error: true,
          message: error?.message || 'Failed to upload attachment'
        }, 400);
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/pending-reflect') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const draft = await bridge.updatePendingReflect(body || {});
        if (!draft) {
          jsonResponse(res, { error: true, message: 'No pending reflect approval' }, 409);
          return true;
        }
        jsonResponse(res, { ok: true, draft });
      } catch (error) {
        jsonResponse(res, { error: true, message: error?.message || 'Failed to update reflect' }, 500);
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/pending-spec') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const spec = await bridge.updatePendingSpec(body || {});
        if (!spec) {
          jsonResponse(res, { error: true, message: 'No pending spec approval' }, 409);
          return true;
        }
        jsonResponse(res, { ok: true, spec });
      } catch (error) {
        jsonResponse(res, { error: true, message: error?.message || 'Failed to update spec' }, 500);
      }
      return true;
    }
    if (req.method === 'DELETE' && url.pathname === '/api/pending-spec') {
      const bridge = await loadBridge(res, url.searchParams.get('sessionId'));
      if (!bridge) return true;
      const result = await bridge.deletePendingSpec();
      if (!result) {
        jsonResponse(res, { error: true, message: 'No pending spec approval' }, 409);
        return true;
      }
      jsonResponse(res, { ok: true, ...result });
      return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/specs') {
      const sessionId = url.searchParams.get('sessionId');
      const bridge = await loadBridge(res, sessionId);
      if (!bridge) return true;
      const projectDir = pool.getSessionState(sessionId)?.projectDir;
      jsonResponse(res, { specs: await listProjectSpecFiles(projectDir) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/specs/open') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      const projectDir = pool.getSessionState(body.sessionId)?.projectDir;
      const specPath = await resolveProjectSpecFile(projectDir, body?.path);
      if (!specPath) {
        jsonResponse(res, { error: true, message: 'Spec file not found' }, 404);
        return true;
      }
      const specText = await fs.readFile(specPath, 'utf8');
      const spec = await bridge.setPendingSpecFromFile({ filePath: specPath, specText });
      if (!spec) {
        jsonResponse(res, { error: true, message: 'Failed to open spec' }, 500);
        return true;
      }
      jsonResponse(res, { ok: true, spec });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat/message') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const attachmentData = await resolveAttachmentSubmission(
          body.sessionId,
          body.text,
          body.attachmentIds
        );
        const accepted = submitOperation(body.sessionId, target =>
          target.handleSubmitMessage({
            text: body.text,
            messageId: body.messageId,
            skillNames: body.skillNames,
            attachmentIds: body.attachmentIds,
            dismissedAlwaysSkills: body.dismissedAlwaysSkills,
            ...attachmentData
          })
        );
        jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
      } catch (error) {
        chatErrorResponse(res, error, 'INVALID_REQUEST');
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/submit') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      if (!body.line || typeof body.line !== 'string') {
        jsonResponse(res, { error: true, message: 'Missing "line" field' }, 400);
        return true;
      }
      const currentConfig = await loadRuntimeConfig();
      const configStatus = getRuntimeConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(res, {
          error: true,
          code: 'CONFIG_REQUIRED',
          message: 'Gateway is not configured. Open Settings and set the API Base URL and API Key.',
          configStatus
        }, 409);
        return true;
      }
      const attachmentData = await resolveAttachmentSubmission(
        body.sessionId,
        body.line,
        body.attachmentIds
      );
      const accepted = submitOperation(body.sessionId, target => target.handleSubmit(
        body.line,
        {
          readOnlyCodeWiki: body.readOnlyCodeWiki === true,
          attachments: attachmentData.attachments,
          ...(Array.isArray(body.dismissedAlwaysSkills) && body.dismissedAlwaysSkills.length > 0
            ? { dismissedAlwaysSkills: body.dismissedAlwaysSkills }
            : {}),
          ...(attachmentData.modelText ? { modelText: attachmentData.modelText } : {})
        }
      ));
      jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/chat/action') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const status = pool.getSessionState(body.sessionId)?.status;
        const requestId = String(body.payload?.requestId || '').trim();
        if (APPROVAL_ACTION_NAMES.has(body.name) && status === 'waiting_approval') {
          if (!bridge.hasPendingApproval?.(requestId)) {
            staleInteractionResponse(res);
            return true;
          }
          const accepted = resumeOperation(body.sessionId, target =>
            target.handleAction({
              name: body.name,
              payload: body.payload || {}
            })
          );
          jsonResponse(res, {
            ...accepted,
            path: 'NORMAL_RESUME',
            poolStatus: status
          }, accepted.accepted ? 202 : 409);
          return true;
        }
        if (APPROVAL_ACTION_NAMES.has(body.name)) {
          const approved = body.name === 'approval.approve';
          if (
            TERMINAL_RUNTIME_STATUSES.has(status) &&
            clearStaleApprovalInteraction(bridge, requestId, approved)
          ) {
            // Pool already settled (waiting freed the slot) but Bridge was still
            // pending — resolve succeeded; report success instead of a fake 409.
            recoveredInteractionResponse(res, {
              requestId,
              approved,
              path: 'RECOVERED_FALLBACK',
              poolStatus: status
            });
            return true;
          }
          interactionConflict(res, status);
          return true;
        }
        const result = ensureAcceptedBridgeResult(await bridge.handleAction({
          name: body.name,
          payload: body.payload || {}
        }));
        jsonResponse(res, { ok: true, result });
      } catch (error) {
        chatErrorResponse(res, error, 'ACTION_FAILED');
      }
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/abort') {
      const body = await readBody(req);
      const id = requireSessionId(res, body?.sessionId);
      if (!id) return true;
      const aborted = await pool.abort(id);
      jsonResponse(res, { ok: aborted }, aborted ? 200 : 404);
      return true;
    }

    const directOperations = new Map([
      ['/api/approval', ({ bridge, body }) => ({ ok: bridge.handleApproval(body.id, !!body.approved) })],
      ['/api/user-input', ({ bridge, body }) => {
        const ok = bridge.handleUserInput(body.id, { status: body.status, answers: body.answers });
        return { ok, status: ok ? 200 : 409 };
      }],
      ['/api/execution-mode', async ({ bridge, body }) => {
        const mode = ['spec', 'code', 'coding'].includes(body.mode) ? 'plan' : body.mode;
        return { ok: await bridge.setExecutionMode(mode) };
      }],
      ['/api/approval-mode', async ({ bridge, body }) => ({ ok: await bridge.setApprovalMode(body.mode) })]
    ]);
    if (req.method === 'POST' && directOperations.has(url.pathname)) {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      if (url.pathname === '/api/user-input' && !body.id) {
        jsonResponse(res, { error: true, message: 'Missing user input request id' }, 400);
        return true;
      }
      if (
        url.pathname === '/api/execution-mode' &&
        !['normal', 'plan', 'code', 'coding', 'spec'].includes(body.mode)
      ) {
        jsonResponse(res, { error: true, message: 'Invalid mode' }, 400);
        return true;
      }
      if (
        url.pathname === '/api/approval-mode' &&
        !['review', 'auto', 'full_access'].includes(body.mode)
      ) {
        jsonResponse(res, { error: true, message: 'Invalid approval mode' }, 400);
        return true;
      }
      if (
        ['/api/execution-mode', '/api/approval-mode'].includes(url.pathname) &&
        (
          ACTIVE_RUNTIME_STATUSES.has(pool.getSessionState(body.sessionId)?.status) ||
          bridge.isBusy?.()
        )
      ) {
        const message = url.pathname === '/api/execution-mode'
          ? 'Cannot switch execution mode while a request is running'
          : 'Cannot switch approval mode while a request is running';
        jsonResponse(res, { error: true, message }, 409);
        return true;
      }
      const status = pool.getSessionState(body.sessionId)?.status;
      const expectedWaitingStatus = url.pathname === '/api/approval'
        ? 'waiting_approval'
        : url.pathname === '/api/user-input'
          ? 'waiting_input'
          : null;
      if (expectedWaitingStatus && status === expectedWaitingStatus) {
        const pendingMatches = url.pathname === '/api/approval'
          ? bridge.hasPendingApproval?.(body.id)
          : bridge.hasPendingUserInput?.(body.id);
        if (!pendingMatches) {
          staleInteractionResponse(res);
          return true;
        }
        const accepted = resumeOperation(body.sessionId, target => {
          const result = directOperations.get(url.pathname)({
            bridge: target,
            body
          });
          return result.ok ? result : { accepted: false };
        });
        jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
        return true;
      }
      if (expectedWaitingStatus) {
        if (TERMINAL_RUNTIME_STATUSES.has(status)) {
          if (url.pathname === '/api/approval') {
            const approved = !!body.approved;
            if (clearStaleApprovalInteraction(bridge, body.id, approved)) {
              recoveredInteractionResponse(res, { requestId: body.id, approved });
              return true;
            }
          } else if (clearStaleUserInputInteraction(bridge, body.id)) {
            recoveredInteractionResponse(res, { requestId: body.id, skipped: true });
            return true;
          }
        }
        interactionConflict(res, status);
        return true;
      }
      const result = await directOperations.get(url.pathname)({ bridge, body });
      const responseStatus = result.status || 200;
      delete result.status;
      jsonResponse(res, result, responseStatus);
      return true;
    }

    if (req.method === 'POST' && url.pathname === '/api/sessions/switch') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      const projectDir = pool.getSessionState(body.sessionId)?.projectDir;
      const resolvedProjectDir = normalizeProjectPath(projectDir) || projectDir;
      if (resolvedProjectDir) setDefaultProjectDir?.(resolvedProjectDir);
      const state = {
        ...bridge.getState(),
        cwd: resolvedProjectDir,
        isGeneral: isGeneralProjectDir(resolvedProjectDir),
      };
      jsonResponse(res, {
        ok: true,
        sessionId: body.sessionId,
        cwd: resolvedProjectDir,
        state,
        sessionData: {
          messages: bridge.getSessionMessages(),
          compact: bridge.getSessionCompactMeta(),
          uiMessages: await bridge.getUiMessages(body.sessionId)
        }
      });
      return true;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/sessions/')) {
      const sessionId = requireSessionId(
        res,
        decodeURIComponent(url.pathname.slice('/api/sessions/'.length))
      );
      if (!sessionId) return true;
      const state = pool.getSessionState(sessionId);
      if (state && ['queued', 'running', 'waiting_approval', 'waiting_input'].includes(state.status)) {
        jsonResponse(res, { error: true, message: 'Session is active' }, 409);
        return true;
      }
      const result = await deleteStoredSession(sessionId);
      const entry = pool.entries.get(sessionId);
      await entry?.bridge?.dispose?.();
      pool.entries.delete(sessionId);
      await runtimeStatusStore?.remove?.(sessionId);
      jsonResponse(res, { ok: true, ...result });
      return true;
    }

    const sessionReads = new Map([
      ['/api/state', bridge => {
        const rawState = bridge.getState();
        const sessionId = rawState.sessionId;
        const poolEntry = sessionId ? pool.entries.get(sessionId) : undefined;
        const projectDir = poolEntry?.projectDir || '';
        if (projectDir) setDefaultProjectDir?.(projectDir);
        return {
          ...rawState,
          cwd: projectDir,
          isGeneral: isGeneralProjectDir(projectDir),
        };
      }],
      ['/api/history', bridge => bridge.getHistory()],
      ['/api/commands', bridge => bridge.getCommands()],
      ['/api/startup-events', bridge => bridge.handleStartupEvents()],
      ['/api/session/messages', bridge => ({
        messages: bridge.getSessionMessages(),
        compact: bridge.getSessionCompactMeta()
      })],
      ['/api/session/ui-messages', bridge => bridge.getUiMessages()]
    ]);
    if (req.method === 'GET' && sessionReads.has(url.pathname)) {
      const bridge = await loadBridge(res, url.searchParams.get('sessionId'));
      if (!bridge) return true;
      jsonResponse(res, await sessionReads.get(url.pathname)(bridge));
      return true;
    }

    if (url.pathname === '/api/session-changes' && req.method === 'GET') {
      const bridge = await loadBridge(res, url.searchParams.get('sessionId'));
      if (!bridge) return true;
      jsonResponse(res, { changes: await bridge.getChangeSets() });
      return true;
    }
    if (
      req.method === 'GET' &&
      url.pathname.startsWith('/api/session-changes/') &&
      url.pathname.endsWith('/patch')
    ) {
      const bridge = await loadBridge(res, url.searchParams.get('sessionId'));
      if (!bridge) return true;
      const id = decodeURIComponent(
        url.pathname.slice('/api/session-changes/'.length, -'/patch'.length)
      );
      jsonResponse(res, { id, patch: await bridge.getChangeSetPatch(id) });
      return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/session-changes/undo') {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      jsonResponse(res, await bridge.undoChangeSets(body.ids));
      return true;
    }
    if (
      req.method === 'POST' &&
      url.pathname.startsWith('/api/session-changes/') &&
      url.pathname.endsWith('/undo')
    ) {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      const id = decodeURIComponent(
        url.pathname.slice('/api/session-changes/'.length, -'/undo'.length)
      );
      jsonResponse(res, await bridge.undoChangeSet(id));
      return true;
    }
    return false;
  };
}

export async function handleStructuredChatRequest(req, res, bridge) {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/api/chat/message') {
    const body = await readBody(req);
    try {
      const attachmentData = await resolveAttachmentSubmission(
        bridge.getSessionId?.(),
        body?.text,
        body?.attachmentIds
      );
      const result = ensureAcceptedBridgeResult(await bridge.handleSubmitMessage({
        text: body?.text,
        messageId: body?.messageId,
        skillNames: body?.skillNames,
        attachmentIds: body?.attachmentIds,
        dismissedAlwaysSkills: body?.dismissedAlwaysSkills,
        ...attachmentData
      }));
      jsonResponse(res, { ok: true, result }, 202);
    } catch (error) {
      chatErrorResponse(res, error, 'INVALID_REQUEST');
    }
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/action') {
    const body = await readBody(req);
    try {
      const result = ensureAcceptedBridgeResult(await bridge.handleAction({
        name: body?.name,
        payload: body?.payload || {}
      }));
      jsonResponse(res, { ok: true, result }, 200);
    } catch (error) {
      chatErrorResponse(res, error, 'ACTION_FAILED');
    }
    return true;
  }

  return false;
}

function safeUploadFileName(name = '') {
  const ext = path.extname(String(name || '')).toLowerCase();
  const base = path.basename(String(name || 'attachment'), ext)
    .replace(/[^A-Za-z0-9._\-\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'attachment'}${ext}`;
}

function attachmentSessionDir(sessionId = '') {
  const safeSession = String(sessionId || 'unknown').replace(/[^A-Za-z0-9._-]+/g, '-');
  return path.join(ATTACHMENT_UPLOAD_DIR, safeSession || 'unknown');
}

function attachmentMetaPath(sessionId, id) {
  return path.join(attachmentSessionDir(sessionId), `${String(id || '').replace(/[^A-Za-z0-9._-]+/g, '')}.json`);
}

function attachmentPublicUrl(sessionId, id) {
  return `/api/attachments/${encodeURIComponent(String(sessionId || ''))}/${encodeURIComponent(String(id || ''))}/file`;
}

function clipAttachmentText(text = '') {
  const value = String(text || '').replace(/\r\n/g, '\n').trim();
  if (value.length <= MAX_ATTACHMENT_TEXT_CHARS) return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_ATTACHMENT_TEXT_CHARS).trimEnd()}\n\n[Attachment text truncated at ${MAX_ATTACHMENT_TEXT_CHARS} characters.]`,
    truncated: true
  };
}

async function readMultipartForm(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value != null) headers.set(key, String(value));
  }
  const request = new Request('http://codemini.local/upload', {
    method: req.method,
    headers,
    body: Readable.toWeb(req),
    duplex: 'half'
  });
  return request.formData();
}

async function extractAttachmentText(buffer, ext) {
  if (ext === '.pdf') {
    const parsePdf = require('pdf-parse');
    const parsed = await parsePdf(buffer);
    return String(parsed?.text || '').trim();
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth');
    const parsed = await mammoth.extractRawText({ buffer });
    return String(parsed?.value || '').trim();
  }
  return '';
}

async function saveUploadedAttachment({ file, sessionId }) {
  const originalName = safeUploadFileName(file?.name || 'attachment');
  const ext = path.extname(originalName).toLowerCase();
  if (!SUPPORTED_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new Error('Unsupported attachment type. Use images, PDF, or DOCX.');
  }
  if (Number(file?.size || 0) > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment is too large. Maximum size is 20 MB.');
  }
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const id = randomUUID();
  const sessionDir = attachmentSessionDir(sessionId);
  await fs.mkdir(sessionDir, { recursive: true });
  const storedName = `${id}-${originalName}`;
  const storedPath = path.join(sessionDir, storedName);
  await fs.writeFile(storedPath, buffer);

  const extractedRaw = IMAGE_ATTACHMENT_EXTENSIONS.has(ext)
    ? ''
    : await extractAttachmentText(buffer, ext);
  const clipped = clipAttachmentText(extractedRaw);
  const meta = {
    id,
    name: originalName,
    mime: file?.type || '',
    extension: ext,
    kind: IMAGE_ATTACHMENT_EXTENSIONS.has(ext) ? 'image' : 'document',
    size: buffer.length,
    path: storedPath,
    text: clipped.text,
    textChars: clipped.text.length,
    truncated: clipped.truncated,
    uploadedAt: new Date().toISOString()
  };
  await fs.writeFile(attachmentMetaPath(sessionId, id), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return {
    id,
    name: meta.name,
    mime: meta.mime,
    kind: meta.kind,
    size: meta.size,
    path: meta.path,
    url: attachmentPublicUrl(sessionId, id),
    textChars: meta.textChars,
    truncated: meta.truncated,
    preview: meta.text ? meta.text.slice(0, 500) : ''
  };
}

async function loadAttachmentMetas(sessionId, ids = []) {
  const cleanIds = (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const metas = [];
  for (const id of cleanIds) {
    const metaFile = attachmentMetaPath(sessionId, id);
    try {
      const parsed = JSON.parse(await fs.readFile(metaFile, 'utf8'));
      if (parsed?.id === id && parsed?.path) metas.push(parsed);
    } catch {}
  }
  return metas;
}

function buildAttachmentModelText(line, metas = []) {
  const prompt = String(line || '').trim();
  if (!metas.length) return '';
  const blocks = metas.map((meta, index) => {
    const header = [
      `Attachment ${index + 1}: ${meta.name || meta.id}`,
      `Type: ${meta.kind || 'file'}${meta.mime ? ` (${meta.mime})` : ''}`,
      `Path: ${meta.path || ''}`,
      `Size: ${meta.size || 0} bytes`
    ];
    if (meta.kind === 'image') {
      return [
        ...header,
        'Content: Image file uploaded by the Web UI. Use the path if local inspection is needed.'
      ].join('\n');
    }
    return [
      ...header,
      meta.truncated ? 'Note: Extracted text was truncated for context size.' : '',
      '',
      'Extracted text:',
      meta.text || '[No extractable text found.]'
    ].filter(Boolean).join('\n');
  });
  return [
    prompt,
    '',
    '<uploaded_attachments>',
    blocks.join('\n\n---\n\n'),
    '</uploaded_attachments>'
  ].join('\n');
}

async function encodeModelImage(meta) {
  try {
    const data = await sharp(meta.path, { animated: false })
      .rotate()
      .resize({
        width: MODEL_IMAGE_MAX_DIMENSION,
        height: MODEL_IMAGE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true
      })
      .webp({ quality: MODEL_IMAGE_WEBP_QUALITY, effort: 4 })
      .toBuffer();
    return { mime: 'image/webp', data: data.toString('base64') };
  } catch {
    const data = await fs.readFile(meta.path);
    return { mime: meta.mime || 'image/jpeg', data: data.toString('base64') };
  }
}

export async function resolveAttachmentSubmission(sessionId, line, attachmentIds = []) {
  const metas = await loadAttachmentMetas(sessionId, attachmentIds);
  const modelText = buildAttachmentModelText(line, metas);
  const modelImages = await Promise.all(
    metas.filter((meta) => meta.kind === 'image').map(encodeModelImage)
  );
  return {
    attachments: metas.map((meta) => ({
      id: meta.id,
      name: meta.name,
      mime: meta.mime,
      kind: meta.kind,
      size: meta.size,
      url: attachmentPublicUrl(sessionId, meta.id)
    })),
    ...(modelImages.length ? { modelImages } : {}),
    ...(modelText ? { modelText } : {})
  };
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
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
      return branch === 'HEAD' ? null : branch;
    } catch {
      return null;
    }
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

function inboxEntryMatchesQuery(entry, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  return [
    entry?.summary,
    entry?.details,
    entry?.suggestedAction,
    entry?.source,
    entry?.type,
    entry?.evidence?.reason,
    ...(Array.isArray(entry?.tags) ? entry.tags : [])
  ].some(value => String(value || '').toLowerCase().includes(needle));
}

async function listInboxForProjectDirs({ scope, query, projectDirs, fallbackDir }) {
  const entries = await listInbox(scope ? { scope } : {});
  const allowedProjects = new Set(
    (projectDirs.length > 0 ? projectDirs : [fallbackDir])
      .map(normalizeProjectDirKey)
      .filter(Boolean)
  );
  return entries
    .filter(entry => {
      if (scope !== 'project') return true;
      const entryProject = normalizeProjectDirKey(entry?.projectDir || fallbackDir);
      return allowedProjects.has(entryProject);
    })
    .filter(entry => inboxEntryMatchesQuery(entry, query))
    .map(entry => {
      if (entry.scope !== 'project') return entry;
      const projectDir = entry.projectDir || fallbackDir;
      return {
        ...entry,
        projectDir,
        projectName: projectNameForDir(projectDir)
      };
    })
    .sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
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

export async function buildRuntimeForSession({ sessionId, model, projectDir }) {
  const config = await loadConfig();
  const resolvedDir = normalizeProjectPath(projectDir || process.cwd());
  const session = sessionId ? await loadSession(sessionId) : await createSession(resolvedDir);
  const sessionProjectDir = normalizeProjectPath(
    (projectDir ? projectDir : await inferSessionProjectDir(session)) || resolvedDir
  );
  session.projectDir = sessionProjectDir;
  const isGeneral = isGeneralProjectDir(sessionProjectDir);
  const systemPrompt = buildDefaultSystemPrompt(config, {
    workspaceRoot: sessionProjectDir,
    extraPrompts: isGeneral ? [getGeneralChatSystemPromptBlock()] : []
  });
  const runtime = await createChatRuntime({
    session,
    config,
    model: model || config.model?.name,
    systemPrompt,
    workspaceRoot: sessionProjectDir
  });
  return { runtime, config, session, cwd: sessionProjectDir, isGeneral };
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

  const { runtime: initialRuntime, session: initialSession } = await buildRuntimeForSession({
    sessionId: args.session,
    model: args.model
  });
  const eventBroker = createEventBroker();
  const runtimeStatusStore = createRuntimeStatusStore();
  const recoveredSessionIds = new Set(await runtimeStatusStore.recoverInterrupted());
  const lifecycleWaiters = new Map();
  let initialRuntimeAvailable = true;
  const pool = new RuntimePool({
    maxConcurrent: 3,
    onEvent: event => {
      eventBroker.publish(event);
      if (event?.type === 'runtime_pool_state' && event.state?.sessionId) {
        runtimeStatusStore.set(event.state.sessionId, event.state.status).catch(() => {});
      }
    },
    runtimeFactory: async ({ sessionId, projectDir, model }) => {
      let runtime;
      if (initialRuntimeAvailable && sessionId === initialSession.id) {
        initialRuntimeAvailable = false;
        runtime = initialRuntime;
      } else {
        ({ runtime } = await buildRuntimeForSession({ sessionId, projectDir, model }));
      }
      const sessionBridge = new RuntimeBridge(runtime, {
        sessionId,
        onEvent: eventBroker.publish,
        onLifecycle: lifecycle => {
          const status = lifecycle?.status;
          if (status === 'running') return;

          // Waiting must win even when the Pool RUN already settled (completed
          // consumed the waiter). Otherwise approval UI appears while Pool is
          // terminal and every click falls into RECOVERED_FALLBACK.
          if (status === 'waiting_approval' || status === 'waiting_input') {
            const resolve = lifecycleWaiters.get(sessionId);
            if (resolve) {
              lifecycleWaiters.delete(sessionId);
              resolve({ status });
              return;
            }
            try {
              pool.markWaiting(sessionId, status);
            } catch {
              // Session may have been evicted; ignore.
            }
            return;
          }

          const resolve = lifecycleWaiters.get(sessionId);
          if (!resolve) return;

          // Do not terminal-settle while Bridge still has an open interaction.
          // A premature completed would leave pending approvals stuck off the
          // waiting_* resume path.
          if (
            (status === 'completed' || status === 'failed' || status === 'aborted') &&
            (
              sessionBridge.hasPendingApproval?.() ||
              sessionBridge.hasPendingUserInput?.()
            )
          ) {
            return;
          }

          lifecycleWaiters.delete(sessionId);
          resolve({ status });
        }
      });
      sessionBridge.abort = () => sessionBridge.handleAbort();
      sessionBridge.runPooled = (start) => new Promise((resolve, reject) => {
        lifecycleWaiters.set(sessionId, resolve);
        try {
          const accepted = start();
          Promise.resolve(accepted).then((result) => {
            if (result?.accepted === false || result?.error) {
              lifecycleWaiters.delete(sessionId);
              resolve({ status: 'failed' });
            }
          }, (error) => {
            lifecycleWaiters.delete(sessionId);
            reject(error);
          });
        } catch (error) {
          lifecycleWaiters.delete(sessionId);
          reject(error);
        }
      });
      return sessionBridge;
    }
  });
  const initialEntry = await pool.ensureSession({
    sessionId: initialSession.id,
    projectDir: initialSession.projectDir || process.cwd(),
    model: args.model
  });
  const runtimeEvictionTimer = startRuntimeEvictionTimer(pool);
  if (recoveredSessionIds.has(initialSession.id)) {
    initialEntry.status = 'interrupted';
  } else {
    await runtimeStatusStore.set(initialSession.id, 'idle');
  }
  let bridge = initialEntry.bridge;
  let currentProjectDir = process.cwd();
  const ensurePooledSession = async (sessionId) => {
    const session = await loadSession(sessionId);
    const alreadyLoaded = Boolean(pool.getSessionState(sessionId));
    const resolvedProjectDir =
      normalizeProjectPath(session.projectDir) || session.projectDir || currentProjectDir;
    // Keep the stored session cwd absolute so later pool lookups / git cwd
    // never fall back to the general workspace by accident.
    if (resolvedProjectDir && session.projectDir !== resolvedProjectDir) {
      session.projectDir = resolvedProjectDir;
      try {
        await saveSession(session);
      } catch {}
    }
    const entry = await pool.ensureSession({
      sessionId,
      projectDir: resolvedProjectDir,
      model: args.model
    });
    if (!alreadyLoaded && recoveredSessionIds.has(sessionId)) {
      entry.status = 'interrupted';
    } else if (!alreadyLoaded) {
      await runtimeStatusStore.set(sessionId, 'idle');
    }
    return entry;
  };
  const runtimeApi = createWebRuntimeApi({
    pool,
    eventBroker,
    ensureSession: ensurePooledSession,
    runtimeStatusStore,
    getDefaultProjectDir: () => currentProjectDir,
    setDefaultProjectDir: (dir) => {
      const next = String(dir || '').trim();
      if (next) currentProjectDir = next;
    }
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${args.port}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (await runtimeApi(req, res)) return;
    // SSE
    // Handled by the global runtime API broker above.

    const attachmentFileMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/([^/]+)\/file$/);
    if (req.method === 'GET' && attachmentFileMatch) {
      try {
        const sessionId = decodeURIComponent(attachmentFileMatch[1]);
        const id = decodeURIComponent(attachmentFileMatch[2]);
        const meta = JSON.parse(await fs.readFile(attachmentMetaPath(sessionId, id), 'utf8'));
        const filePath = path.resolve(meta.path || '');
        const uploadRoot = path.resolve(ATTACHMENT_UPLOAD_DIR);
        if (!isPathInside(uploadRoot, filePath)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType = meta.mime || MIME_TYPES[ext] || 'application/octet-stream';
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': data.length,
          'Cache-Control': 'private, max-age=86400'
        });
        res.end(data);
      } catch {
        jsonResponse(res, { error: true, message: 'Attachment not found' }, 404);
      }
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

    // ── Version ──
    if (req.method === 'GET' && url.pathname === '/api/embed') {
      const target = String(url.searchParams.get('url') || '').trim();
      if (!target) {
        jsonResponse(res, { error: true, message: 'Missing url parameter' }, 400);
        return;
      }
      try {
        const embed = await resolveEmbed(target);
        jsonResponse(res, embed);
      } catch (error) {
        jsonResponse(res, {
          error: true,
          message: error instanceof Error ? error.message : String(error)
        }, 400);
      }
      return;
    }

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
      const { depth, format } = await readBody(req);
      const normalizedDepth = ['fast', 'standard', 'deep'].includes(String(depth || '').toLowerCase())
        ? String(depth).toLowerCase()
        : 'standard';
      const normalizedFormat = ['html', 'md'].includes(String(format || '').toLowerCase())
        ? String(format).toLowerCase()
        : 'html';
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(url, currentProjectDir);
      let codeWikiBridge = bridge;
      if (codeWikiProjectDir !== currentProjectDir) {
        const session = await createSession(codeWikiProjectDir);
        codeWikiBridge = (await ensurePooledSession(session.id)).bridge;
      }
      if (codeWikiBridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
      const result = codeWikiBridge.handleCodeWikiGenerate(
        `/project-requirements --${normalizedDepth} --${normalizedFormat}`
      );
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

    // ── Project management ──
    if (req.method === 'GET' && url.pathname === '/api/project') {
      jsonResponse(res, { cwd: currentProjectDir, isGeneral: isGeneralProjectDir(currentProjectDir) });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git') {
      try {
        const sessionId = String(url.searchParams.get('sessionId') || '').trim();
        if (sessionId) {
          try { await ensurePooledSession(sessionId); } catch {}
        }
        const gitCwd = resolveGitCwd({
          sessionId,
          getSessionProjectDir: (id) => pool.getSessionState(id)?.projectDir || '',
          fallbackDir: currentProjectDir
        });
        if (shouldAdoptGitCwd(gitCwd, currentProjectDir)) currentProjectDir = gitCwd;
        jsonResponse(res, readGitInfo(gitCwd || currentProjectDir));
      } catch {
        jsonResponse(res, { isGit: false, branch: null, dirty: false, staged: 0, modified: 0, untracked: 0, linesAdded: 0, linesRemoved: 0 });
      }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/git-diff') {
      try {
        const sessionId = String(url.searchParams.get('sessionId') || '').trim();
        if (sessionId) {
          try { await ensurePooledSession(sessionId); } catch {}
        }
        const gitCwd = resolveGitCwd({
          sessionId,
          getSessionProjectDir: (id) => pool.getSessionState(id)?.projectDir || '',
          fallbackDir: currentProjectDir
        });
        if (shouldAdoptGitCwd(gitCwd, currentProjectDir)) currentProjectDir = gitCwd;
        jsonResponse(res, readGitDiffData(gitCwd || currentProjectDir));
      } catch {
        jsonResponse(res, { patch: '', files: [], linesAdded: 0, linesRemoved: 0 });
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
      try {
        // Client marker for general workspace
        const openingGeneral = projectPath === '__codemini_general__';
        const resolved = openingGeneral ? GENERAL_PROJECT_DIR : path.resolve(projectPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) throw new Error('Not a directory');
        let reusedSessionId = null;
        let session;
        if (openingGeneral) {
          const all = await listSessions(1000, { includeEmpty: true });
          const reusable = all.find((entry) =>
            isGeneralProjectDir(entry.projectDir) &&
            Number(entry.messageCount || 0) === 0
          );
          // Always reuse one empty general draft instead of stacking placeholders.
          reusedSessionId = reusable?.id || null;
          session = reusedSessionId
            ? await loadSession(reusedSessionId)
            : await createSession(GENERAL_PROJECT_DIR);
        } else {
          await patchWebuiActiveProjects({ action: 'activate', projectDir: resolved });
          currentProjectDir = resolved;
          if (forceNewSession) {
            const all = await listSessions(1000, { includeEmpty: true });
            const targetKey = normalizeProjectDirKey(currentProjectDir);
            const reusable = all.find((entry) =>
              !isGeneralProjectDir(entry.projectDir) &&
              normalizeProjectDirKey(entry.projectDir) === targetKey &&
              Number(entry.messageCount || 0) === 0
            );
            reusedSessionId = reusable?.id || null;
          } else {
            reusedSessionId = await findPreferredSessionForProject(currentProjectDir);
          }
          session = reusedSessionId
            ? await loadSession(reusedSessionId)
            : await createSession(currentProjectDir);
        }
        const targetBridge = (await ensurePooledSession(session.id)).bridge;
        bridge = targetBridge;
        currentProjectDir =
          normalizeProjectPath(session.projectDir) ||
          (openingGeneral ? GENERAL_PROJECT_DIR : resolved);
        if (!openingGeneral && session.projectDir !== currentProjectDir) {
          session.projectDir = currentProjectDir;
          try {
            await saveSession(session);
          } catch {}
        }
        const isGeneral = isGeneralProjectDir(currentProjectDir);
        jsonResponse(res, {
          ok: true,
          cwd: currentProjectDir,
          sessionId: session.id,
          isGeneral,
          reusedSession: Boolean(reusedSessionId),
          state: { ...targetBridge.getState(), cwd: currentProjectDir, isGeneral },
          sessionData: {
            messages: targetBridge.getSessionMessages(),
            compact: targetBridge.getSessionCompactMeta(),
            uiMessages: await targetBridge.getUiMessages(session.id)
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
    if (req.method === 'GET' && url.pathname === '/api/playwright/status') {
      try {
        jsonResponse(res, await detectPlaywrightStatus());
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
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
        await pool.reloadConfig(
          key === 'model.name' ? { model: config.model?.name } : {}
        );
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
    if (req.method === 'GET' && url.pathname === '/api/memory/inbox') {
      const requestedScope = String(url.searchParams.get('scope') || '').trim().toLowerCase();
      const scope = MEMORY_SCOPES.has(requestedScope) ? requestedScope : null;
      const query = String(url.searchParams.get('q') || '').trim();
      try {
        const projectDirs = await parseProjectDirsParam(url, currentProjectDir);
        const items = await listInboxForProjectDirs({
          scope,
          query,
          projectDirs,
          fallbackDir: currentProjectDir
        });
        jsonResponse(res, { scope: scope || 'all', query, items });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/memory/inbox/dream') {
      try {
        const body = await readBody(req);
        const requestedScope = String(body?.scope || '').trim().toLowerCase();
        const scope = MEMORY_SCOPES.has(requestedScope) ? requestedScope : null;
        const config = await loadConfig();
        const result = await runDreamConsolidation({
          scope,
          workspaceRoot: currentProjectDir,
          config
        });
        jsonResponse(res, result);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/memory/inbox/')) {
      const id = decodeURIComponent(url.pathname.slice('/api/memory/inbox/'.length));
      if (!id) { jsonResponse(res, { error: true, message: 'Missing inbox id' }, 400); return; }
      try {
        const entry = (await listInbox()).find(item => item.id === id);
        if (!entry) {
          jsonResponse(res, { error: true, message: 'Inbox entry not found' }, 404);
          return;
        }
        const archived = await archiveEntry(entry, 'user-discarded', 'Discarded from Web UI');
        jsonResponse(res, { ok: true, id, archivedAt: archived.archivedAt });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
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
      const { name, description, content, scope: rawScope, projectDir, contexts } = await readBody(req);
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
        config.skills.contexts = config.skills.contexts || {};
        config.skills.enabled[name] = true;
        config.skills.contexts[name] = contexts !== undefined
          ? normalizeSkillContexts(contexts)
          : scope === 'project' ? ['coding'] : ['coding', 'daily'];
        await saveConfig(config);
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, name, scope, projectDir: scope === 'project' ? targetProjectDir : '' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/install') {
      const { source, scope: rawScope, projectDir, contexts } = await readBody(req);
      if (!source) { jsonResponse(res, { error: true, message: 'Missing source' }, 400); return; }
      try {
        const scope = normalizeSkillScope(rawScope);
        const targetProjectDir = scope === 'project'
          ? await resolveRequestProjectDir(projectDir, currentProjectDir)
          : currentProjectDir;
        const installed = await installSkillSource(source, { scope, cwd: targetProjectDir });
        if (contexts !== undefined) {
          const config = await loadConfig();
          config.skills = config.skills || {};
          config.skills.contexts = config.skills.contexts || {};
          const normalizedContexts = normalizeSkillContexts(contexts);
          for (const name of installed) config.skills.contexts[name] = normalizedContexts;
          await saveConfig(config);
        }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, installed, scope, projectDir: scope === 'project' ? targetProjectDir : '' });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/skills/update') {
      const { name, projectDir } = await readBody(req);
      if (!name) { jsonResponse(res, { error: true, message: 'Missing skill name' }, 400); return; }
      try {
        const targetProjectDir = await resolveRequestProjectDir(projectDir, currentProjectDir);
        const result = await updateSkillPackage({ name, cwd: targetProjectDir });
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, {
          ok: true,
          installed: result.installed,
          previouslyInstalled: result.previouslyInstalled,
          packageSource: result.packageSource,
          packageName: result.packageName,
          scope: result.scope,
          projectDir: result.scope === 'project' ? targetProjectDir : '',
        });
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
        const markdownPatch = metadataPatchFromSkillMarkdown(content);
        if (Object.keys(markdownPatch).length > 0) {
          if (skill.scope === 'global') {
            await upsertSkillRegistryEntry(undefined, {
              name,
              ...(markdownPatch.description !== undefined ? { description: markdownPatch.description } : {}),
              ...(markdownPatch.enabled !== undefined ? { enabled: markdownPatch.enabled } : {}),
              sha256: await computeFileSha256(skill.path)
            });
            await upsertSkillCatalogMetadata(getSkillsDir(), name, markdownPatch);
          } else if (skill.scope === 'project') {
            await upsertProjectSkillMetadata(targetProjectDir, name, markdownPatch);
          }
        } else if (skill.scope === 'global') {
          await upsertSkillRegistryEntry(undefined, {
            name,
            sha256: await computeFileSha256(skill.path)
          });
        }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/skills/')) {
      const name = decodeURIComponent(url.pathname.slice('/api/skills/'.length));
      try {
        const targetProjectDir = await resolveRequestProjectDir(url.searchParams.get('projectDir'), currentProjectDir);
        const projectDirs = await parseProjectDirsParam(url, targetProjectDir);
        const entries = await listSkillEntries({ scope: 'all', cwd: targetProjectDir });
        const skill = entries.find(s => s.name === name);
        if (!skill) { jsonResponse(res, { error: true, message: 'Skill not found' }, 404); return; }
        if (skill.scope === 'builtin') { jsonResponse(res, { error: true, message: 'Cannot delete builtin skill' }, 403); return; }
        await fs.rm(path.join(getSkillsDir(), name), { recursive: true, force: true });
        for (const projectDir of projectDirs) {
          await fs.rm(path.join(getProjectSkillsDir(projectDir), name), { recursive: true, force: true });
          await deleteSkillCatalogMetadata(getProjectSkillsDir(projectDir), name);
        }
        const registry = await readSkillRegistry();
        registry.skills = (registry.skills || []).filter(s => s.name !== name);
        await writeSkillRegistry(undefined, registry);
        await deleteSkillCatalogMetadata(getSkillsDir(), name);
        const config = await loadConfig();
        if (config.skills?.enabled) delete config.skills.enabled[name];
        if (config.skills?.contexts) delete config.skills.contexts[name];
        await saveConfig(config);
        await bridge.reloadConfig();
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
        const normalizedPatch = normalizeSkillMetadataPatch(body || {});
        const contexts = normalizedPatch.contexts;
        const metadataPatch = { ...normalizedPatch };
        delete metadataPatch.contexts;
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
              source: skill.source || 'web-move',
              packageSource: skill.packageSource || skill.source || '',
              packageName: skill.packageName || '',
              entryFile: 'SKILL.md',
              sha256: await computeFileSha256(path.join(targetDir, 'SKILL.md')),
              installedAt: skill.installedAt || new Date().toISOString()
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
        if (nextScope !== 'builtin' && Object.keys(metadataPatch).length > 0) {
          const skillPath = path.join(skillBaseDirForScope(nextScope, nextProjectDir), name, 'SKILL.md');
          const currentContent = await fs.readFile(skillPath, 'utf8');
          const nextContent = patchSkillMarkdownMetadata(currentContent, metadataPatch, name);
          if (nextContent !== currentContent) {
            await fs.writeFile(skillPath, nextContent, 'utf8');
          }
          if (nextScope === 'global') {
            await upsertSkillRegistryEntry(undefined, {
              name,
              sha256: await computeFileSha256(skillPath)
            });
          }
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
        if (contexts) {
          const config = await loadConfig();
          config.skills = config.skills || {};
          config.skills.contexts = config.skills.contexts || {};
          config.skills.contexts[name] = contexts;
          await saveConfig(config);
        }
        await bridge.reloadConfig();
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
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = !!enabled;
        await saveConfig(config);
        const registry = await readSkillRegistry();
        const idx = registry.skills.findIndex(s => s.name === name);
        if (idx !== -1) { registry.skills[idx].enabled = !!enabled; await writeSkillRegistry(undefined, registry); }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }

    // ── Souls management ──
    const _BUNDLED_SOULS_DIR = path.resolve(__dirname, '..', 'souls');
    const _CUSTOM_SOULS_DIR = path.join(getBaseConfigDir(), 'souls');
    const soulNameEquals = (left, right) =>
      String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();
    const resolveSoulFilePath = async (dir, name) => {
      const requested = String(name || '').trim();
      if (!requested) return '';
      const directPath = path.join(dir, `${requested}.md`);
      try {
        await fs.access(directPath);
        return directPath;
      } catch {}
      try {
        const entries = await fs.readdir(dir);
        const expected = `${requested}.md`.toLowerCase();
        const match = entries.find(file => file.toLowerCase() === expected);
        return match ? path.join(dir, match) : '';
      } catch {
        return '';
      }
    };

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
          souls.push({ name: sname, scope: 'builtin', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: soulNameEquals(sname, activePreset) });
        }
        try {
          const customEntries = await fs.readdir(_CUSTOM_SOULS_DIR);
          for (const file of customEntries) {
            if (!file.endsWith('.md')) continue;
            const sname = file.slice(0, -3);
            const scontent = await fs.readFile(path.join(_CUSTOM_SOULS_DIR, file), 'utf8');
            souls.push({ name: sname, scope: 'custom', preview: scontent.split('\n').slice(0, 3).join('\n').slice(0, 120), active: soulNameEquals(sname, activePreset) });
          }
        } catch {}
        jsonResponse(res, souls);
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/souls/') && url.pathname.endsWith('/content')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length, -'/content'.length));
      try {
        const customPath = await resolveSoulFilePath(_CUSTOM_SOULS_DIR, sname);
        if (customPath) {
          const scontent = await fs.readFile(customPath, 'utf8');
          jsonResponse(res, { name: path.basename(customPath, '.md'), content: scontent, scope: 'custom' });
          return;
        }
        const bundledPath = await resolveSoulFilePath(_BUNDLED_SOULS_DIR, sname);
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
        const bundledCheck = await resolveSoulFilePath(_BUNDLED_SOULS_DIR, safeName);
        if (bundledCheck) { jsonResponse(res, { error: true, message: 'Name conflicts with builtin soul' }, 409); return; }
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
        const customPath = await resolveSoulFilePath(_CUSTOM_SOULS_DIR, sname);
        if (!customPath) { jsonResponse(res, { error: true, message: 'Custom soul not found' }, 404); return; }
        await fs.writeFile(customPath, soulContent, 'utf8');
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'DELETE' && url.pathname.startsWith('/api/souls/')) {
      const sname = decodeURIComponent(url.pathname.slice('/api/souls/'.length));
      try {
        const bundledPath = await resolveSoulFilePath(_BUNDLED_SOULS_DIR, sname);
        if (bundledPath) { jsonResponse(res, { error: true, message: 'Cannot delete builtin soul' }, 403); return; }
        const customPath = await resolveSoulFilePath(_CUSTOM_SOULS_DIR, sname);
        await fs.unlink(customPath);
        const config = await loadConfig();
        if (soulNameEquals(config.soul?.preset, sname)) { config.soul.preset = 'Default'; await saveConfig(config); }
        jsonResponse(res, { ok: true });
      } catch (err) { jsonResponse(res, { error: true, message: err.message }, 500); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/souls/activate') {
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: 'Runtime is busy' }, 409);
        return;
      }
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

  const cleanup = createServerCleanup({
    runtimeEvictionTimer,
    pool,
    runtimeStatusStore,
    server
  });
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });
}
