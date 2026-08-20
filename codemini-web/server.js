import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parseArgs as parseNodeArgs } from "node:util";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import sharp from "sharp";
import fg from "fast-glob";
import { Hono } from "hono";
import { serve } from "@hono/node-server";

import {
  loadConfig,
  saveConfig,
  setConfigValue,
  getConfigValue,
} from "../src/core/config-store.js";
import {
  loadWebuiActiveProjects,
  normalizeProjectDirKey,
  patchWebuiActiveProjects,
  sessionMatchesActiveProjects,
} from "../src/core/webui-sidebar-config.js";
import { createChatRuntime } from "../src/core/chat-runtime.js";
import {
  createSession,
  loadSession,
  listSessions,
  resolveSession,
  deleteSession,
  saveSession,
} from "../src/core/session-store.js";
import { buildDefaultSystemPrompt } from "../src/core/default-system-prompt.js";
import {
  parseFrontmatter,
  serializeFrontmatter,
} from "../src/core/frontmatter.js";
import {
  loadPersistedUiMessages,
  RuntimeBridge,
  serializeSessionMessages,
} from "./lib/runtime-bridge.js";
import { RuntimePool, startRuntimeEvictionTimer } from "./lib/runtime-pool.js";
import { createEmptySessionAllocator } from "./lib/empty-session-allocator.js";
import { resolveGitCwd, shouldAdoptGitCwd } from "./lib/git-project.js";
import {
  createGitInfoReader,
  readGitDiffData,
  readGitInfoBatch,
} from "./lib/git-status.js";
import {
  clearTerminal,
  getTerminalSnapshot,
  resizeTerminal,
  restartTerminal,
  runTerminalCommand,
  stopTerminal,
  subscribeTerminal,
  writeTerminalInput,
} from "./lib/web-terminal.js";
import {
  listWorkspaceChildren,
  previewWorkspaceFile,
  resolveWorkspacePath,
  isPreviewableImagePath,
} from "./lib/workspace-files.js";
import {
  parseScrapbookAttachmentFromModelContent,
  pickScrapbookAttachments,
} from "./lib/message-context-parsers.js";
import { extractPdfText } from "./lib/pdf-text.js";
import {
  addScrapbookSource,
  buildScrapbookAskPayload,
  createChatAnswerScrapbookEntryWithSummary,
  createManualScrapbookEntry,
  createMultiSourceScrapbookEntry,
  createUrlScrapbookEntry,
  deleteScrapbookEntryForApi,
  getScrapbookEntryForApi,
  getScrapbookSummaryJobForApi,
  generateScrapbookArtifact,
  listScrapbookEntriesForApi,
  removeScrapbookSource,
  setScrapbookSourceSelection,
  startScrapbookSummaryJob,
  subscribeScrapbookSummaryJob,
} from "./lib/scrapbook-service.js";
import {
  abortResearchSessionForApi,
  confirmResearchPlanForApi,
  createResearchSessionForApi,
  deleteResearchSessionForApi,
  getResearchSessionForApi,
  listResearchSessionsForApi,
  startResearchRunForApi,
  subscribeResearchRun,
  updateResearchPlanForApi,
} from "./lib/research-service.js";
import { createPooledSessionEnsurer } from "./lib/pooled-session-ensurer.js";
import { resolveCodeWikiBridge } from "./lib/codewiki-bridge.js";
import { loadSessionForSwitch } from "./lib/session-switch-loader.js";
import { resolveEmbed } from "./lib/embed-resolver.js";
import {
  canUpdateSkillPackage,
  installSkillSource,
  listSkillEntries,
  previewSkillPackageUpdate,
  previewSkillSource,
  updateSkillPackage,
} from "../src/commands/skill.js";
import { buildSkillIndexPreview } from "../src/core/command-loader.js";
import {
  computeFileSha256,
  readSkillRegistry,
  upsertSkillRegistryEntry,
  writeSkillRegistry,
} from "../src/core/skill-registry.js";
import {
  archiveEntry,
  forgetMemory,
  listInbox,
  listMemories,
  searchMemories,
} from "../src/core/memory-store.js";
import { runDreamConsolidation } from "../src/core/dream-consolidate.js";
import { getReplyLanguage } from "../src/core/reply-language.js";
import { normalizeSkillContexts } from "../src/core/skill-contexts.js";
import {
  getBaseConfigDir,
  getProjectSpecsDir,
  getSkillsDir,
} from "../src/core/paths.js";
import { initializeProjectIndex } from "../src/core/project-index.js";
import { queryProjectKnowledgeGraph } from "../src/core/project-knowledge-graph.js";
import { INDEX_SKIP_DIRS } from "../src/core/constants.js";
import { VERSION } from "../src/core/version.js";
import { detectPlaywrightStatus } from "../src/core/tools.js";
import {
  getSqliteStorageInfo,
  openSqliteStorageFolder,
} from "../src/core/storage-info.js";
import { launchWorkspacePath } from "../src/core/file-launcher.js";
import {
  loadAttachmentMetadata,
  readRuntimeStatuses,
  recoverRuntimeStatuses,
  removeRuntimeStatus,
  saveAttachmentMetadata,
  setRuntimeStatus,
} from "../src/core/web-metadata-sqlite-store.js";
import {
  closeMcpClient,
  inspectMcpServer,
  normalizeMcpServer,
  validateMcpServer,
} from "../src/core/mcp-client.js";
import {
  discoverSkillHooks,
  disableSkillHooks,
  readHooksJsonRaw,
  writeSkillHooksJson,
} from "../src/core/skill-hooks-discover.js";
import {
  loadGlobalHooks,
  loadProjectHooks,
  readWorkspaceHooksFile,
  saveGlobalHooks,
  saveProjectHooks,
} from "../src/core/project-hooks.js";
import {
  deleteCustomHookProfile,
  hookActivationFromContexts,
  listCustomHookProfiles,
  saveCustomHookProfile,
  savePackageHookProfile,
} from "../src/core/hook-profiles.js";
import {
  createSoul,
  deleteSoul,
  getActiveSoulName,
  listSouls,
  normalizeSoulCategory,
  readSoulContent,
  soulNameEquals,
  updateSoulContent,
} from "../src/core/soul.js";

const GENERAL_PROJECT_DIR = (() => {
  const base = getBaseConfigDir();
  return path.join(base, "workspace");
})();

const SKILL_CATALOG_FILE = "codemini.skills.json";
const SKILL_MODES = new Set(["always", "agent_requested", "manual"]);
const MEMORY_SCOPES = new Set(["user", "global", "project"]);

function normalizeMemoryScope(scope) {
  const value = String(scope || "")
    .trim()
    .toLowerCase();
  return MEMORY_SCOPES.has(value) ? value : "user";
}

function isSafeSkillName(name = "") {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name);
}

export function normalizeSkillMetadataPatch(input = {}) {
  const out = {};
  if (typeof input.description === "string")
    out.description = input.description.trim();
  if (typeof input.mode === "string") {
    const mode = input.mode === "auto_attach" ? "agent_requested" : input.mode;
    if (SKILL_MODES.has(mode)) out.mode = mode;
  }
  if (input.enabled !== undefined) out.enabled = input.enabled !== false;
  if (input.priority !== undefined) {
    const priority = Number(input.priority);
    if (Number.isFinite(priority))
      out.priority = Math.max(0, Math.min(100, Math.round(priority)));
  }
  if (Array.isArray(input.triggers)) {
    out.triggers = input.triggers
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  } else if (typeof input.triggers === "string") {
    out.triggers = input.triggers
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (input.contexts !== undefined) {
    out.contexts = normalizeSkillContexts(input.contexts);
  }
  if (input.disableModelInvocation !== undefined) {
    out.disableModelInvocation = input.disableModelInvocation === true;
  }
  if (input.userInvocable !== undefined) {
    out.userInvocable = input.userInvocable !== false;
  }
  if (input.routingAuthorLocked !== undefined) {
    out.routingAuthorLocked = input.routingAuthorLocked === true;
  }
  return out;
}

const AUTHOR_LOCKED_ROUTING_KEYS = new Set([
  "mode",
  "triggers",
  "priority",
  "disableModelInvocation",
  "userInvocable",
  "routingAuthorLocked",
]);

export function stripAuthorLockedRoutingPatch(
  patch = {},
  { routingAuthorLocked = false } = {},
) {
  if (!routingAuthorLocked) return { ...patch };
  const out = { ...patch };
  for (const key of AUTHOR_LOCKED_ROUTING_KEYS) {
    delete out[key];
  }
  return out;
}

function parseSkillFrontmatter(raw = "") {
  const normalized = String(raw || "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    const lines = normalized.split("\n");
    const metadata = {};
    let index = 0;
    while (index < lines.length && !lines[index].trim()) index += 1;
    const start = index;
    while (index < lines.length) {
      const trimmed = lines[index].trim();
      if (!trimmed) break;
      const inlineNameDescription = trimmed.match(
        /^name\s*:\s*(.*?)\s+description\s*:\s*(.+)$/i,
      );
      if (inlineNameDescription) {
        metadata.name = inlineNameDescription[1]
          .trim()
          .replace(/^["']|["']$/g, "");
        metadata.description = inlineNameDescription[2]
          .trim()
          .replace(/^["']|["']$/g, "");
        index += 1;
        continue;
      }
      const match = trimmed.match(
        /^(name|description|version|mode|triggers|priority|enabled)\s*:\s*(.*)$/i,
      );
      if (!match) break;
      const key = match[1].toLowerCase();
      const value = match[2].trim();
      metadata[key] =
        value.startsWith("[") && value.endsWith("]")
          ? value
              .slice(1, -1)
              .split(",")
              .map((item) => item.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean)
          : value.replace(/^["']|["']$/g, "");
      index += 1;
    }
    if (index > start) {
      while (index < lines.length && !lines[index].trim()) index += 1;
      return { metadata, content: lines.slice(index).join("\n") };
    }
    return { metadata: {}, content: normalized };
  }
  return parseFrontmatter(normalized);
}

function serializeSkillMarkdown(metadata = {}, content = "") {
  const preferred = [
    "name",
    "description",
    "version",
    "mode",
    "triggers",
    "priority",
    "enabled",
  ];
  const keys = [
    ...preferred.filter(
      (key) => metadata[key] !== undefined && metadata[key] !== "",
    ),
    ...Object.keys(metadata).filter(
      (key) =>
        !preferred.includes(key) &&
        metadata[key] !== undefined &&
        metadata[key] !== "",
    ),
  ];
  return serializeFrontmatter(
    Object.fromEntries(keys.map((key) => [key, metadata[key]])),
    content,
  );
}

function patchSkillMarkdownMetadata(raw = "", patch = {}, fallbackName = "") {
  const parsed = parseSkillFrontmatter(raw);
  const normalizedPatch = normalizeSkillMetadataPatch(patch);
  delete normalizedPatch.routingAuthorLocked;
  delete normalizedPatch.contexts;
  const metadata = {
    ...(parsed.metadata || {}),
    ...(fallbackName ? { name: parsed.metadata?.name || fallbackName } : {}),
    ...normalizedPatch,
  };
  // Prefer Claude-compatible kebab keys when writing invocation flags.
  if (Object.prototype.hasOwnProperty.call(metadata, "userInvocable")) {
    metadata["user-invocable"] = metadata.userInvocable !== false;
    delete metadata.userInvocable;
  }
  if (
    Object.prototype.hasOwnProperty.call(metadata, "disableModelInvocation")
  ) {
    metadata["disable-model-invocation"] =
      metadata.disableModelInvocation === true;
    delete metadata.disableModelInvocation;
  }
  return serializeSkillMarkdown(metadata, parsed.content);
}

function metadataPatchFromSkillMarkdown(raw = "") {
  const parsed = parseSkillFrontmatter(raw);
  return normalizeSkillMetadataPatch(parsed.metadata || {});
}

async function readSkillCatalogFromDir(skillBaseDir) {
  const catalogPath = path.join(skillBaseDir, SKILL_CATALOG_FILE);
  try {
    const parsed = JSON.parse(await fs.readFile(catalogPath, "utf8"));
    return parsed && typeof parsed === "object"
      ? parsed
      : { version: 1, skills: {} };
  } catch {
    return { version: 1, skills: {} };
  }
}

async function writeSkillCatalogToDir(skillBaseDir, catalog) {
  const catalogPath = path.join(skillBaseDir, SKILL_CATALOG_FILE);
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  const next = {
    version: 1,
    skills:
      catalog?.skills && typeof catalog.skills === "object"
        ? catalog.skills
        : {},
  };
  await fs.writeFile(catalogPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
}

async function upsertSkillCatalogMetadata(skillBaseDir, name, patch) {
  const catalog = await readSkillCatalogFromDir(skillBaseDir);
  catalog.skills = catalog.skills || {};
  const prior =
    catalog.skills[name] && typeof catalog.skills[name] === "object"
      ? catalog.skills[name]
      : {};
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
  if (process.platform === "win32") {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const roots = [];
    await Promise.all(
      letters.map(async (letter) => {
        const drivePath = `${letter}:\\`;
        try {
          await fs.access(drivePath);
          roots.push({
            name: `${letter}:`,
            path: drivePath,
            isGit: false,
            isDrive: true,
          });
        } catch {}
      }),
    );
    return roots.sort((a, b) => a.name.localeCompare(b.name));
  }

  const candidates = [
    { name: "/", path: path.resolve("/") },
    { name: "Home", path: process.env.HOME || process.env.USERPROFILE || "" },
    { name: "Current", path: process.cwd() },
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
      roots.push({
        name: candidate.name,
        path: resolved,
        isGit: false,
        isDrive: false,
      });
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
  return (
    relative === "" ||
    (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function listProjectSpecFiles(projectDir) {
  if (!projectDir || isGeneralProjectDir(projectDir)) return [];
  const specsDir = getProjectSpecsDir(projectDir);
  const entries = await fg("**/*.md", {
    cwd: specsDir,
    absolute: true,
    onlyFiles: true,
    stats: true,
    suppressErrors: true,
    followSymbolicLinks: false,
  });
  return entries.map((entry) => ({
    name: path.basename(entry.path, path.extname(entry.path)),
    file: path.basename(entry.path),
    path: entry.path,
    relativePath: path.relative(specsDir, entry.path),
    updatedAt: entry.stats?.mtime?.toISOString?.() || "",
  })).sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
}

async function resolveProjectSpecFile(projectDir, rawPath = "") {
  if (!projectDir || isGeneralProjectDir(projectDir)) return "";
  const specsDir = getProjectSpecsDir(projectDir);
  const candidate = path.resolve(projectDir, String(rawPath || "").trim());
  if (!isPathInside(specsDir, candidate)) return "";
  try {
    const stat = await fs.stat(candidate);
    if (!stat.isFile() || !candidate.toLowerCase().endsWith(".md")) return "";
    return candidate;
  } catch {
    return "";
  }
}

function getGeneralChatSystemPromptBlock() {
  return `# General Chat Mode

This is a general conversation backed by Codemini's shared general workspace.
- The working directory is a real shared workspace for general sessions, not a user project repository.
- Filesystem and terminal tools are available when they help with the user's request. Keep all operations inside this workspace unless the user explicitly opens a project.
- When the user asks to rewrite or transform remote content, fetch or read the content and answer with the rewritten text unless they explicitly ask you to create or modify a local file.
- Before making persistent filesystem changes, make sure the user requested a local artifact and use an obvious user-facing path or file name.`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const CLIENT_SOURCE_DIR = path.join(__dirname, "client");
let CLIENT_DIR = CLIENT_SOURCE_DIR;
try {
  const distDir = path.join(__dirname, "dist");
  const stat = await fs.stat(distDir);
  if (stat.isDirectory()) CLIENT_DIR = distDir;
} catch {}

const gzipAsync = promisify(zlib.gzip);
const FINGERPRINTED_ASSET = /-[A-Za-z0-9]{8,}\.[A-Za-z0-9]+$/;
const COMPRESSIBLE_EXT = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".md", ".txt"]);
const staticFileCache = new Map();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

const DEFAULT_GATEWAY_BASE_URL = "http://127.0.0.1:8000/v1";
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 80_000;
const MODEL_IMAGE_MAX_DIMENSION = 1568;
const MODEL_IMAGE_WEBP_QUALITY = 80;
const ATTACHMENT_UPLOAD_DIR = path.join(getBaseConfigDir(), "web-ui-uploads");
const SUPPORTED_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".pdf",
  ".docx",
]);
const IMAGE_ATTACHMENT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

function normalizeBaseUrl(value) {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function getConfigStatus(config) {
  const baseUrl = normalizeBaseUrl(config?.gateway?.base_url);
  const apiKey = String(config?.gateway?.api_key || "").trim();
  const setupRequired =
    !baseUrl || (baseUrl === DEFAULT_GATEWAY_BASE_URL && !apiKey);
  return {
    setupRequired,
    baseUrl,
    hasApiKey: !!apiKey,
    reason: setupRequired ? "gateway_not_configured" : "",
  };
}

export function parseArgs(argv) {
  const { values } = parseNodeArgs({
    args: argv.slice(2),
    allowNegative: true,
    options: {
      port: { type: "string", short: "p" },
      session: { type: "string", short: "s" },
      model: { type: "string", short: "m" },
      project: { type: "string", short: "d" },
      open: { type: "boolean", default: true },
      host: { type: "string" },
    },
  });
  return {
    port: Number.parseInt(values.port, 10) || 3210,
    session: values.session,
    model: values.model,
    project: values.project,
    open: values.open,
    // Local-only by default; pass --host 0.0.0.0 to expose on the LAN.
    host: String(values.host || "127.0.0.1").trim() || "127.0.0.1",
  };
}

function createNodeRouter() {
  const router = new Hono();
  router.onError((error, context) => {
    const res = context.env.outgoing;
    if (!res.headersSent) {
      jsonResponse(
        res,
        { error: error?.message || "Internal server error" },
        500,
      );
    } else if (!res.writableEnded) {
      res.end();
    }
    return context.body(null, 500);
  });
  return router;
}

function nodeRoute(handler) {
  return async (context) => {
    context.env.routeHandled.value = true;
    await handler(
      context.env.incoming,
      context.env.outgoing,
      new URL(context.req.url),
    );
    return context.body(null);
  };
}

async function dispatchNodeRouter(router, req, res) {
  const routeHandled = { value: false };
  await router.fetch(
    new Request(new URL(req.url, "http://localhost"), { method: req.method }),
    { incoming: req, outgoing: res, routeHandled },
  );
  return routeHandled.value;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function jsonResponse(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const CHAT_CONFLICT_CODES = new Set([
  "BUSY",
  "STALE_ACTION",
  "NO_PENDING_REVIEW",
  "NO_PENDING_APPROVAL",
]);

function chatErrorResponse(res, error, fallbackCode) {
  const code = error?.code || fallbackCode;
  const status = CHAT_CONFLICT_CODES.has(code) ? 409 : 400;
  jsonResponse(
    res,
    {
      error: true,
      code,
      message: error?.message || String(error),
    },
    status,
  );
}

function ensureAcceptedBridgeResult(result) {
  if (result?.accepted === false || result?.error) {
    const error = new Error(result?.message || "Chat request was rejected");
    error.code = result?.code || "INVALID_REQUEST";
    throw error;
  }
  return result;
}

export function createEventBroker() {
  const clients = new Set();
  const publish = (event) => {
    const tagged =
      event?.sessionId || !event?.state?.sessionId
        ? event
        : { ...event, sessionId: event.state.sessionId };
    const payload = `data: ${JSON.stringify(tagged)}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
      }
    }
  };
  return {
    publish,
    addClient(res) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
      clients.add(res);
      const ping = setInterval(() => {
        try {
          res.write(": ping\n\n");
        } catch {
          clearInterval(ping);
        }
      }, 15000);
      res.on("close", () => {
        clearInterval(ping);
        clients.delete(res);
      });
    },
  };
}

function poolBridge(pool, sessionId) {
  return pool.entries.get(sessionId)?.bridge || null;
}

function requireSessionId(res, sessionId) {
  const normalized = String(sessionId || "").trim();
  if (normalized) return normalized;
  jsonResponse(res, { error: true, message: "Missing sessionId" }, 400);
  return "";
}

const RECOVERABLE_RUNTIME_STATUSES = new Set([
  "queued",
  "running",
  "waiting_approval",
  "waiting_input",
]);
const ACTIVE_RUNTIME_STATUSES = new Set(RECOVERABLE_RUNTIME_STATUSES);
const TERMINAL_RUNTIME_STATUSES = new Set([
  "completed",
  "failed",
  "aborted",
  "interrupted",
  "idle",
]);
const APPROVAL_ACTION_NAMES = new Set(["approval.approve", "approval.reject"]);

function matchesEmptySessionProject(session, projectDir) {
  if (isGeneralProjectDir(projectDir)) {
    return isGeneralProjectDir(session.projectDir);
  }
  if (isGeneralProjectDir(session.projectDir)) return false;
  return (
    normalizeProjectDirKey(session.projectDir) ===
    normalizeProjectDirKey(projectDir)
  );
}

function createPooledEmptySessionAllocator(
  pool,
  {
    listSessions: listFn = listSessions,
    loadSession: loadFn = loadSession,
    createSession: createFn = createSession,
  } = {},
) {
  return createEmptySessionAllocator({
    listSessions: () => listFn(1000, { includeEmpty: true }),
    loadSession: loadFn,
    createSession: createFn,
    projectKeyOf: (projectDir) =>
      isGeneralProjectDir(projectDir)
        ? "__codemini_general__"
        : normalizeProjectDirKey(projectDir) || String(projectDir || ""),
    matchesProject: matchesEmptySessionProject,
    isBusy: (sessionId) =>
      ACTIVE_RUNTIME_STATUSES.has(pool.getSessionState(sessionId)?.status),
  });
}

function interactionConflict(res, status) {
  const alreadyResuming = status === "queued" || status === "running";
  jsonResponse(
    res,
    {
      error: true,
      code: alreadyResuming ? "ALREADY_RESUMING" : "NOT_WAITING",
      message: alreadyResuming
        ? "Interaction response is already queued or running"
        : "Session is not waiting for this interaction",
    },
    409,
  );
}

function staleInteractionResponse(res) {
  jsonResponse(
    res,
    {
      error: true,
      code: "STALE_INTERACTION",
      message: "Interaction request is no longer pending",
    },
    409,
  );
}

function recoveredInteractionResponse(res, extra = {}) {
  jsonResponse(
    res,
    {
      ok: true,
      recovered: true,
      ...extra,
    },
    200,
  );
}

function clearStaleApprovalInteraction(bridge, requestId, approved) {
  if (!bridge?.hasPendingApproval?.(requestId)) return false;
  return bridge.handleApproval?.(requestId, approved) === true;
}

function clearStaleUserInputInteraction(bridge, requestId) {
  if (!bridge?.hasPendingUserInput?.(requestId)) return false;
  return (
    bridge.handleUserInput?.(requestId, { status: "skipped", answers: {} }) ===
    true
  );
}

export function createServerCleanup({
  runtimeEvictionTimer,
  pool,
  runtimeStatusStore,
  server,
  exit = () => process.exit(0),
}) {
  let cleanupPromise = null;
  return () => {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      runtimeEvictionTimer.stop();
      await Promise.allSettled(
        [...pool.entries.values()].map((entry) => entry.bridge?.dispose?.()),
      );
      pool.entries.clear();
      await runtimeStatusStore.flush();
      await new Promise((resolve) => server.close(() => resolve()));
      exit();
    })();
    return cleanupPromise;
  };
}

export function createRuntimeStatusStore(
  filePath = path.join(getBaseConfigDir(), "web-runtime-status.json"),
) {
  let writes = Promise.resolve();
  let legacyLoaded = false;
  const read = async () => {
    const stored = readRuntimeStatuses();
    if (Object.keys(stored).length > 0 || legacyLoaded) return stored;
    legacyLoaded = true;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      for (const [sessionId, state] of Object.entries(parsed || {})) {
        if (state?.status)
          setRuntimeStatus(sessionId, state.status, state.updatedAt);
      }
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  };
  const update = (mutate) => {
    writes = writes.then(async () => {
      const states = await read();
      await mutate(states);
    });
    return writes;
  };
  return {
    read,
    set(sessionId, status) {
      return update((states) => {
        states[sessionId] = {
          status,
          updatedAt: new Date().toISOString(),
        };
        setRuntimeStatus(sessionId, status, states[sessionId].updatedAt);
      });
    },
    remove(sessionId) {
      return update((states) => {
        delete states[sessionId];
        removeRuntimeStatus(sessionId);
      });
    },
    flush() {
      return writes;
    },
    async recoverInterrupted() {
      await writes;
      return recoverRuntimeStatuses([...RECOVERABLE_RUNTIME_STATUSES]);
    },
  };
}

export function createWebRuntimeApi({
  pool,
  eventBroker,
  ensureSession,
  listSessions: listStoredSessions = listSessions,
  deleteSession: deleteStoredSession = deleteSession,
  createSession: createStoredSession = createSession,
  loadSession: loadStoredSession = loadSession,
  loadActiveProjects = loadWebuiActiveProjects,
  runtimeStatusStore = null,
  getDefaultProjectDir = () => process.cwd(),
  setDefaultProjectDir = null,
  loadConfig: loadRuntimeConfig = loadConfig,
  getConfigStatus: getRuntimeConfigStatus = getConfigStatus,
  allocateEmptySession = null,
}) {
  const loadBridge = async (res, sessionId) => {
    const id = requireSessionId(res, sessionId);
    if (!id) return null;
    try {
      await ensureSession(id);
    } catch (error) {
      const notFound =
        error?.code === "ENOENT" || error?.code === "SESSION_NOT_FOUND";
      jsonResponse(
        res,
        {
          error: true,
          code: notFound ? "SESSION_NOT_FOUND" : "SESSION_LOAD_FAILED",
          message: notFound
            ? "Session not found"
            : error?.message || "Failed to load session",
        },
        notFound ? 404 : 400,
      );
      return null;
    }
    return poolBridge(pool, id);
  };
  const allocateSession =
    allocateEmptySession ||
    createPooledEmptySessionAllocator(pool, {
      listSessions: listStoredSessions,
      loadSession: loadStoredSession,
      createSession: createStoredSession,
    });
  const submitOperation = (sessionId, invoke) =>
    pool.submit(sessionId, (bridge) =>
      typeof bridge.runPooled === "function"
        ? bridge.runPooled(() => invoke(bridge))
        : invoke(bridge),
    );
  const resumeOperation = (sessionId, invoke) =>
    pool.resume(sessionId, (bridge) => {
      const start = () => invoke(bridge);
      return typeof bridge.runPooled === "function"
        ? bridge.runPooled(start)
        : start();
    });

  const runtimeRoutes = createNodeRouter();
  runtimeRoutes.get("/api/events", nodeRoute(async (req, res, url) => {
      eventBroker.addClient(res);
      return true;

  }));
  runtimeRoutes.get("/api/runtime/sessions", nodeRoute(async (req, res, url) => {
      const persisted = (await runtimeStatusStore?.read?.()) || {};
      const states = Object.fromEntries(
        pool.listStates().map((state) => [state.sessionId, state]),
      );
      for (const [sessionId, state] of Object.entries(persisted)) {
        if (!states[sessionId]) states[sessionId] = { sessionId, ...state };
      }
      jsonResponse(res, {
        sessions: states,
      });
      return true;

  }));
  runtimeRoutes.get("/api/sessions", nodeRoute(async (req, res, url) => {
      const requestedLimit = Number(url.searchParams.get("limit") || 200);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(1000, Math.round(requestedLimit)))
        : 200;
      const [sessions, { active }] = await Promise.all([
        listStoredSessions(limit),
        loadActiveProjects(),
      ]);
      const activeSet = new Set(active);
      jsonResponse(
        res,
        sessions
          .map((session) => ({
            ...session,
            projectKey: normalizeProjectDirKey(session.projectDir) || "unknown",
            isGeneral: isGeneralProjectDir(session.projectDir),
            runtime: pool.getSessionState(session.id),
          }))
          .filter((session) =>
            sessionMatchesActiveProjects(session, activeSet),
          ),
      );
      return true;

  }));
  runtimeRoutes.post("/api/sessions/new", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      try {
        const projectDir =
          normalizeProjectPath(body?.projectDir || getDefaultProjectDir()) ||
          getDefaultProjectDir();
        const allocated = await allocateSession(projectDir);
        const session = allocated.session;
        await ensureSession(session.id);
        const isGeneral = isGeneralProjectDir(session.projectDir);
        jsonResponse(res, {
          ok: true,
          sessionId: session.id,
          cwd: session.projectDir,
          isGeneral,
          reusedSession: allocated.reused,
        });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to create session",
          },
          400,
        );
      }
      return true;

  }));
  runtimeRoutes.post("/api/attachments", nodeRoute(async (req, res, url) => {
      const sessionId = url.searchParams.get("sessionId");
      const bridge = await loadBridge(res, sessionId);
      if (!bridge) return true;
      try {
        const form = await readMultipartForm(req);
        const files = form
          .getAll("files")
          .filter((item) => item && typeof item.arrayBuffer === "function");
        if (!files.length) {
          jsonResponse(
            res,
            { error: true, message: "Missing attachment file" },
            400,
          );
          return true;
        }
        const attachments = [];
        for (const file of files.slice(0, 8)) {
          attachments.push(await saveUploadedAttachment({ file, sessionId }));
        }
        jsonResponse(res, { ok: true, attachments });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to upload attachment",
          },
          400,
        );
      }
      return true;

  }));
  runtimeRoutes.post("/api/pending-reflect", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const draft = await bridge.updatePendingReflect(body || {});
        if (!draft) {
          jsonResponse(
            res,
            { error: true, message: "No pending reflect approval" },
            409,
          );
          return true;
        }
        jsonResponse(res, { ok: true, draft });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to update reflect",
          },
          500,
        );
      }
      return true;

  }));
  runtimeRoutes.post("/api/pending-spec", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const spec = await bridge.updatePendingSpec(body || {});
        if (!spec) {
          jsonResponse(
            res,
            { error: true, message: "No pending spec approval" },
            409,
          );
          return true;
        }
        jsonResponse(res, { ok: true, spec });
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to update spec" },
          500,
        );
      }
      return true;

  }));
  runtimeRoutes.delete("/api/pending-spec", nodeRoute(async (req, res, url) => {
      const bridge = await loadBridge(res, url.searchParams.get("sessionId"));
      if (!bridge) return true;
      const result = await bridge.deletePendingSpec();
      if (!result) {
        jsonResponse(
          res,
          { error: true, message: "No pending spec approval" },
          409,
        );
        return true;
      }
      jsonResponse(res, { ok: true, ...result });
      return true;

  }));
  runtimeRoutes.get("/api/specs", nodeRoute(async (req, res, url) => {
      const sessionId = url.searchParams.get("sessionId");
      const bridge = await loadBridge(res, sessionId);
      if (!bridge) return true;
      const projectDir = pool.getSessionState(sessionId)?.projectDir;
      jsonResponse(res, { specs: await listProjectSpecFiles(projectDir) });
      return true;

  }));
  runtimeRoutes.post("/api/specs/open", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      const projectDir = pool.getSessionState(body.sessionId)?.projectDir;
      const specPath = await resolveProjectSpecFile(projectDir, body?.path);
      if (!specPath) {
        jsonResponse(res, { error: true, message: "Spec file not found" }, 404);
        return true;
      }
      const specText = await fs.readFile(specPath, "utf8");
      const spec = await bridge.setPendingSpecFromFile({
        filePath: specPath,
        specText,
      });
      if (!spec) {
        jsonResponse(res, { error: true, message: "Failed to open spec" }, 500);
        return true;
      }
      jsonResponse(res, { ok: true, spec });
      return true;

  }));
  runtimeRoutes.post("/api/chat/message", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const attachmentData = await resolveAttachmentSubmission(
          body.sessionId,
          body.text,
          body.attachmentIds,
        );
        const mergedModelText = mergeExtraModelText(body.text, [
          body.modelText,
          attachmentData.modelText,
        ]);
        const scrapbookAttachment =
          pickScrapbookAttachments(body.attachments)[0] ||
          parseScrapbookAttachmentFromModelContent(mergedModelText);
        const attachments = scrapbookAttachment
          ? [
              ...attachmentData.attachments.filter(
                (item) => !pickScrapbookAttachments([item]).length,
              ),
              scrapbookAttachment,
            ]
          : attachmentData.attachments;
        const accepted = submitOperation(body.sessionId, (target) =>
          target.handleSubmitMessage({
            text: body.text,
            messageId: body.messageId,
            skillNames: body.skillNames,
            attachmentIds: body.attachmentIds,
            dismissedAlwaysSkills: body.dismissedAlwaysSkills,
            attachments,
            modelImages: attachmentData.modelImages,
            ...(mergedModelText ? { modelText: mergedModelText } : {}),
          }),
        );
        jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
      } catch (error) {
        chatErrorResponse(res, error, "INVALID_REQUEST");
      }
      return true;

  }));
  runtimeRoutes.post("/api/submit", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      if (!body.line || typeof body.line !== "string") {
        jsonResponse(
          res,
          { error: true, message: 'Missing "line" field' },
          400,
        );
        return true;
      }
      const currentConfig = await loadRuntimeConfig();
      const configStatus = getRuntimeConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(
          res,
          {
            error: true,
            code: "CONFIG_REQUIRED",
            message:
              "Gateway is not configured. Open Settings and set the API Base URL and API Key.",
            configStatus,
          },
          409,
        );
        return true;
      }
      const attachmentData = await resolveAttachmentSubmission(
        body.sessionId,
        body.line,
        body.attachmentIds,
      );
      const accepted = submitOperation(body.sessionId, (target) =>
        target.handleSubmit(body.line, {
          readOnlyCodeWiki: body.readOnlyCodeWiki === true,
          attachments: attachmentData.attachments,
          ...(Array.isArray(body.dismissedAlwaysSkills) &&
          body.dismissedAlwaysSkills.length > 0
            ? { dismissedAlwaysSkills: body.dismissedAlwaysSkills }
            : {}),
          ...(attachmentData.modelText
            ? { modelText: attachmentData.modelText }
            : {}),
        }),
      );
      jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
      return true;

  }));
  runtimeRoutes.post("/api/chat/action", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      try {
        const status = pool.getSessionState(body.sessionId)?.status;
        const requestId = String(body.payload?.requestId || "").trim();
        if (
          APPROVAL_ACTION_NAMES.has(body.name) &&
          status === "waiting_approval"
        ) {
          if (!bridge.hasPendingApproval?.(requestId)) {
            staleInteractionResponse(res);
            return true;
          }
          const accepted = resumeOperation(body.sessionId, (target) =>
            target.handleAction({
              name: body.name,
              payload: body.payload || {},
            }),
          );
          jsonResponse(
            res,
            {
              ...accepted,
              path: "NORMAL_RESUME",
              poolStatus: status,
            },
            accepted.accepted ? 202 : 409,
          );
          return true;
        }
        if (APPROVAL_ACTION_NAMES.has(body.name)) {
          const approved = body.name === "approval.approve";
          if (
            TERMINAL_RUNTIME_STATUSES.has(status) &&
            clearStaleApprovalInteraction(bridge, requestId, approved)
          ) {
            // Pool already settled (waiting freed the slot) but Bridge was still
            // pending — resolve succeeded; report success instead of a fake 409.
            recoveredInteractionResponse(res, {
              requestId,
              approved,
              path: "RECOVERED_FALLBACK",
              poolStatus: status,
            });
            return true;
          }
          interactionConflict(res, status);
          return true;
        }
        const result = ensureAcceptedBridgeResult(
          await bridge.handleAction({
            name: body.name,
            payload: body.payload || {},
          }),
        );
        jsonResponse(res, { ok: true, result });
      } catch (error) {
        chatErrorResponse(res, error, "ACTION_FAILED");
      }
      return true;

  }));
  runtimeRoutes.post("/api/abort", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const id = requireSessionId(res, body?.sessionId);
      if (!id) return true;
      const aborted = await pool.abort(id, {
        continueInPlace: body?.continueInPlace === true,
      });
      jsonResponse(res, { ok: aborted }, aborted ? 200 : 404);
      return true;

  }));
  runtimeRoutes.post("/api/sessions/switch", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const sessionId = requireSessionId(res, body?.sessionId);
      if (!sessionId) return true;
      try {
        const result = await loadSessionForSwitch({
          sessionId,
          pool,
          ensureSession,
          loadStoredSession: loadSession,
          loadStoredUiMessages: loadPersistedUiMessages,
          serializeMessages: serializeSessionMessages,
          normalizeProjectPath,
          isGeneralProjectDir,
          setDefaultProjectDir,
        });
        jsonResponse(res, result);
      } catch (error) {
        const notFound =
          error?.code === "ENOENT" || error?.code === "SESSION_NOT_FOUND";
        jsonResponse(
          res,
          {
            error: true,
            code: notFound ? "SESSION_NOT_FOUND" : "SESSION_LOAD_FAILED",
            message: notFound
              ? "Session not found"
              : error?.message || "Failed to load session",
          },
          notFound ? 404 : 400,
        );
      }
      return true;

  }));
  runtimeRoutes.get("/api/session-changes", nodeRoute(async (req, res, url) => {
      const bridge = await loadBridge(res, url.searchParams.get("sessionId"));
      if (!bridge) return true;
      jsonResponse(res, { changes: await bridge.getChangeSets() });
      return true;

  }));
  runtimeRoutes.post("/api/session-changes/undo", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      jsonResponse(res, await bridge.undoChangeSets(body.ids));
      return true;

  }));

  return async function handleWebRuntimeApi(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (await dispatchNodeRouter(runtimeRoutes, req, res)) return true;
















    const directOperations = new Map([
      [
        "/api/approval",
        ({ bridge, body }) => ({
          ok: bridge.handleApproval(body.id, !!body.approved),
        }),
      ],
      [
        "/api/user-input",
        ({ bridge, body }) => {
          const customResponse = String(body.custom_response || "").trim();
          const ok = bridge.handleUserInput(body.id, {
            status: body.status,
            answers: body.answers,
            ...(customResponse ? { custom_response: customResponse } : {}),
          });
          return { ok, status: ok ? 200 : 409 };
        },
      ],
      [
        "/api/execution-mode",
        async ({ bridge, body }) => {
          const mode = ["spec", "code", "coding"].includes(body.mode)
            ? "plan"
            : body.mode;
          return { ok: await bridge.setExecutionMode(mode) };
        },
      ],
      [
        "/api/approval-mode",
        async ({ bridge, body }) => ({
          ok: await bridge.setApprovalMode(body.mode),
        }),
      ],
      [
        "/api/sandbox-mode",
        async ({ bridge, body }) => ({
          ok: await bridge.setSandboxMode(body.mode),
        }),
      ],
    ]);
    if (req.method === "POST" && directOperations.has(url.pathname)) {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      if (url.pathname === "/api/user-input" && !body.id) {
        jsonResponse(
          res,
          { error: true, message: "Missing user input request id" },
          400,
        );
        return true;
      }
      if (
        url.pathname === "/api/execution-mode" &&
        !["normal", "plan", "code", "coding", "spec"].includes(body.mode)
      ) {
        jsonResponse(res, { error: true, message: "Invalid mode" }, 400);
        return true;
      }
      if (
        url.pathname === "/api/approval-mode" &&
        !["review", "auto", "full_access"].includes(body.mode)
      ) {
        jsonResponse(res, { error: true, message: "Invalid approval mode" }, 400);
        return true;
      }
      if (url.pathname === "/api/sandbox-mode") {
        const sandboxMode = String(body.mode || "")
          .toLowerCase()
          .replace(/_/g, "-");
        if (
          !["read-only", "workspace-write", "danger-full-access"].includes(
            sandboxMode,
          )
        ) {
          jsonResponse(
            res,
            { error: true, message: "Invalid sandbox mode" },
            400,
          );
          return true;
        }
        body.mode = sandboxMode;
      }
      if (
        ["/api/execution-mode", "/api/approval-mode", "/api/sandbox-mode"].includes(url.pathname) &&
        (ACTIVE_RUNTIME_STATUSES.has(
          pool.getSessionState(body.sessionId)?.status,
        ) ||
          bridge.isBusy?.())
      ) {
        const message =
          url.pathname === "/api/execution-mode"
            ? "Cannot switch execution mode while a request is running"
            : url.pathname === "/api/sandbox-mode"
              ? "Cannot switch sandbox mode while a request is running"
            : "Cannot switch approval mode while a request is running";
        jsonResponse(res, { error: true, message }, 409);
        return true;
      }
      const status = pool.getSessionState(body.sessionId)?.status;
      const expectedWaitingStatus =
        url.pathname === "/api/approval"
          ? "waiting_approval"
          : url.pathname === "/api/user-input"
            ? "waiting_input"
            : null;
      if (expectedWaitingStatus && status === expectedWaitingStatus) {
        const pendingMatches =
          url.pathname === "/api/approval"
            ? bridge.hasPendingApproval?.(body.id)
            : bridge.hasPendingUserInput?.(body.id);
        if (!pendingMatches) {
          staleInteractionResponse(res);
          return true;
        }
        const accepted = resumeOperation(body.sessionId, (target) => {
          const result = directOperations.get(url.pathname)({
            bridge: target,
            body,
          });
          return result.ok ? result : { accepted: false };
        });
        jsonResponse(res, accepted, accepted.accepted ? 202 : 409);
        return true;
      }
      if (expectedWaitingStatus) {
        if (TERMINAL_RUNTIME_STATUSES.has(status)) {
          if (url.pathname === "/api/approval") {
            const approved = !!body.approved;
            if (clearStaleApprovalInteraction(bridge, body.id, approved)) {
              recoveredInteractionResponse(res, {
                requestId: body.id,
                approved,
              });
              return true;
            }
          } else if (clearStaleUserInputInteraction(bridge, body.id)) {
            recoveredInteractionResponse(res, {
              requestId: body.id,
              skipped: true,
            });
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

    const regenerateTitleMatch = url.pathname.match(
      /^\/api\/sessions\/([^/]+)\/title\/regenerate$/,
    );
    if (req.method === "POST" && regenerateTitleMatch) {
      const sessionId = decodeURIComponent(regenerateTitleMatch[1]);
      const bridge = await loadBridge(res, sessionId);
      if (!bridge) return true;
      const result = await bridge.regenerateSessionTitle();
      jsonResponse(res, result, result?.error ? 400 : 200);
      return true;
    }


    if (req.method === "DELETE" && url.pathname.startsWith("/api/sessions/")) {
      const sessionId = requireSessionId(
        res,
        decodeURIComponent(url.pathname.slice("/api/sessions/".length)),
      );
      if (!sessionId) return true;
      const state = pool.getSessionState(sessionId);
      if (
        state &&
        ["queued", "running", "waiting_approval", "waiting_input"].includes(
          state.status,
        )
      ) {
        jsonResponse(res, { error: true, message: "Session is active" }, 409);
        return true;
      }
      const entry = pool.entries.get(sessionId);
      try {
        await entry?.bridge?.dispose?.();
      } catch {}
      let result;
      try {
        result = await deleteStoredSession(sessionId);
      } finally {
        pool.entries.delete(sessionId);
      }
      await runtimeStatusStore?.remove?.(sessionId);
      jsonResponse(res, { ok: true, ...result });
      return true;
    }

    const sessionReads = new Map([
      [
        "/api/state",
        (bridge) => {
          const rawState = bridge.getState();
          const sessionId = rawState.sessionId;
          const poolEntry = sessionId ? pool.entries.get(sessionId) : undefined;
          const projectDir = poolEntry?.projectDir || "";
          if (projectDir) setDefaultProjectDir?.(projectDir);
          return {
            ...rawState,
            cwd: projectDir,
            isGeneral: isGeneralProjectDir(projectDir),
          };
        },
      ],
      ["/api/history", (bridge) => bridge.getHistory()],
      ["/api/commands", (bridge) => bridge.getCommands()],
      ["/api/startup-events", (bridge) => bridge.handleStartupEvents()],
      [
        "/api/session/messages",
        (bridge) => ({
          messages: bridge.getSessionMessages(),
          compact: bridge.getSessionCompactMeta(),
        }),
      ],
      ["/api/session/ui-messages", (bridge) => bridge.getUiMessages()],
    ]);
    if (req.method === "GET" && sessionReads.has(url.pathname)) {
      const bridge = await loadBridge(res, url.searchParams.get("sessionId"));
      if (!bridge) return true;
      jsonResponse(res, await sessionReads.get(url.pathname)(bridge));
      return true;
    }


    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/session-changes/") &&
      url.pathname.endsWith("/patch")
    ) {
      const bridge = await loadBridge(res, url.searchParams.get("sessionId"));
      if (!bridge) return true;
      const id = decodeURIComponent(
        url.pathname.slice("/api/session-changes/".length, -"/patch".length),
      );
      jsonResponse(res, { id, patch: await bridge.getChangeSetPatch(id) });
      return true;
    }

    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/session-changes/") &&
      url.pathname.endsWith("/undo")
    ) {
      const body = await readBody(req);
      const bridge = await loadBridge(res, body?.sessionId);
      if (!bridge) return true;
      const id = decodeURIComponent(
        url.pathname.slice("/api/session-changes/".length, -"/undo".length),
      );
      jsonResponse(res, await bridge.undoChangeSet(id));
      return true;
    }
    return false;
  };
}

export async function handleStructuredChatRequest(req, res, bridge) {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "POST" && url.pathname === "/api/chat/message") {
    const body = await readBody(req);
    try {
      const attachmentData = await resolveAttachmentSubmission(
        bridge.getSessionId?.(),
        body?.text,
        body?.attachmentIds,
      );
      const result = ensureAcceptedBridgeResult(
        await bridge.handleSubmitMessage({
          text: body?.text,
          messageId: body?.messageId,
          skillNames: body?.skillNames,
          attachmentIds: body?.attachmentIds,
          dismissedAlwaysSkills: body?.dismissedAlwaysSkills,
          ...attachmentData,
        }),
      );
      jsonResponse(res, { ok: true, result }, 202);
    } catch (error) {
      chatErrorResponse(res, error, "INVALID_REQUEST");
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/chat/action") {
    const body = await readBody(req);
    try {
      const result = ensureAcceptedBridgeResult(
        await bridge.handleAction({
          name: body?.name,
          payload: body?.payload || {},
        }),
      );
      jsonResponse(res, { ok: true, result }, 200);
    } catch (error) {
      chatErrorResponse(res, error, "ACTION_FAILED");
    }
    return true;
  }

  return false;
}

function safeUploadFileName(name = "") {
  const ext = path.extname(String(name || "")).toLowerCase();
  const base = path
    .basename(String(name || "attachment"), ext)
    .replace(/[^A-Za-z0-9._\-\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${base || "attachment"}${ext}`;
}

function attachmentSessionDir(sessionId = "") {
  const safeSession = String(sessionId || "unknown").replace(
    /[^A-Za-z0-9._-]+/g,
    "-",
  );
  return path.join(ATTACHMENT_UPLOAD_DIR, safeSession || "unknown");
}

function attachmentMetaPath(sessionId, id) {
  return path.join(
    attachmentSessionDir(sessionId),
    `${String(id || "").replace(/[^A-Za-z0-9._-]+/g, "")}.json`,
  );
}

function attachmentPublicUrl(sessionId, id) {
  return `/api/attachments/${encodeURIComponent(String(sessionId || ""))}/${encodeURIComponent(String(id || ""))}/file`;
}

function clipAttachmentText(text = "") {
  const value = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (value.length <= MAX_ATTACHMENT_TEXT_CHARS)
    return { text: value, truncated: false };
  return {
    text: `${value.slice(0, MAX_ATTACHMENT_TEXT_CHARS).trimEnd()}\n\n[Attachment text truncated at ${MAX_ATTACHMENT_TEXT_CHARS} characters.]`,
    truncated: true,
  };
}

async function readMultipartForm(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else if (value != null) headers.set(key, String(value));
  }
  const request = new Request("http://codemini.local/upload", {
    method: req.method,
    headers,
    body: Readable.toWeb(req),
    duplex: "half",
  });
  return request.formData();
}

async function extractAttachmentText(buffer, ext) {
  if (ext === ".pdf") {
    return extractPdfText(buffer);
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer });
    return String(parsed?.value || "").trim();
  }
  return "";
}

async function saveUploadedAttachment({ file, sessionId }) {
  const originalName = safeUploadFileName(file?.name || "attachment");
  const ext = path.extname(originalName).toLowerCase();
  if (!SUPPORTED_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new Error("Unsupported attachment type. Use images, PDF, or DOCX.");
  }
  if (Number(file?.size || 0) > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment is too large. Maximum size is 20 MB.");
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
    ? ""
    : await extractAttachmentText(buffer, ext);
  const clipped = clipAttachmentText(extractedRaw);
  const meta = {
    id,
    name: originalName,
    mime: file?.type || "",
    extension: ext,
    kind: IMAGE_ATTACHMENT_EXTENSIONS.has(ext) ? "image" : "document",
    size: buffer.length,
    path: storedPath,
    text: clipped.text,
    textChars: clipped.text.length,
    truncated: clipped.truncated,
    uploadedAt: new Date().toISOString(),
  };
  saveAttachmentMetadata(sessionId, meta);
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
    preview: meta.text ? meta.text.slice(0, 500) : "",
  };
}

async function loadAttachmentMetas(sessionId, ids = []) {
  const cleanIds = (Array.isArray(ids) ? ids : [])
    .map((id) => String(id || "").trim())
    .filter(Boolean)
    .slice(0, 8);
  const metas = [];
  for (const id of cleanIds) {
    const metaFile = attachmentMetaPath(sessionId, id);
    try {
      let parsed = loadAttachmentMetadata(sessionId, id);
      if (!parsed) {
        parsed = JSON.parse(await fs.readFile(metaFile, "utf8"));
        if (parsed?.id === id && parsed?.path)
          saveAttachmentMetadata(sessionId, parsed);
      }
      if (parsed?.id === id && parsed?.path) metas.push(parsed);
    } catch {}
  }
  return metas;
}

function buildAttachmentModelText(line, metas = []) {
  const prompt = String(line || "").trim();
  if (!metas.length) return "";
  const blocks = metas.map((meta, index) => {
    const header = [
      `Attachment ${index + 1}: ${meta.name || meta.id}`,
      `Type: ${meta.kind || "file"}${meta.mime ? ` (${meta.mime})` : ""}`,
      `Path: ${meta.path || ""}`,
      `Size: ${meta.size || 0} bytes`,
    ];
    if (meta.kind === "image") {
      return [
        ...header,
        "Content: Image file uploaded by the Web UI. Use the path if local inspection is needed.",
      ].join("\n");
    }
    return [
      ...header,
      meta.truncated
        ? "Note: Extracted text was truncated for context size."
        : "",
      "",
      "Extracted text:",
      meta.text || "[No extractable text found.]",
    ]
      .filter(Boolean)
      .join("\n");
  });
  return [
    prompt,
    "",
    "<uploaded_attachments>",
    blocks.join("\n\n---\n\n"),
    "</uploaded_attachments>",
  ].join("\n");
}

function mergeExtraModelText(line, values = []) {
  const blocks = [];
  const passthrough = [];
  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) continue;
    let matchedAttachment = false;
    for (const match of text.matchAll(
      /<uploaded_attachments>([\s\S]*?)<\/uploaded_attachments>/g,
    )) {
      const block = String(match[1] || "").trim();
      if (block) {
        blocks.push(block);
        matchedAttachment = true;
      }
    }
    if (!matchedAttachment) passthrough.push(text);
  }
  if (!blocks.length && !passthrough.length) return "";
  if (!blocks.length) {
    return [String(line || "").trim(), ...passthrough]
      .filter(Boolean)
      .join("\n\n");
  }
  return [
    String(line || "").trim(),
    "",
    "<uploaded_attachments>",
    blocks.join("\n\n---\n\n"),
    "</uploaded_attachments>",
    ...passthrough,
  ].join("\n");
}

async function encodeModelImage(meta) {
  try {
    const data = await sharp(meta.path, { animated: false })
      .rotate()
      .resize({
        width: MODEL_IMAGE_MAX_DIMENSION,
        height: MODEL_IMAGE_MAX_DIMENSION,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: MODEL_IMAGE_WEBP_QUALITY, effort: 4 })
      .toBuffer();
    return { mime: "image/webp", data: data.toString("base64"), filename: meta.path, name: meta.name };
  } catch {
    const data = await fs.readFile(meta.path);
    return { mime: meta.mime || "image/jpeg", data: data.toString("base64"), filename: meta.path, name: meta.name };
  }
}

export async function resolveAttachmentSubmission(
  sessionId,
  line,
  attachmentIds = [],
) {
  const metas = await loadAttachmentMetas(sessionId, attachmentIds);
  const modelText = buildAttachmentModelText(line, metas);
  const modelImages = await Promise.all(
    metas.filter((meta) => meta.kind === "image").map(encodeModelImage),
  );
  return {
    attachments: metas.map((meta) => ({
      id: meta.id,
      name: meta.name,
      mime: meta.mime,
      kind: meta.kind,
      size: meta.size,
      url: attachmentPublicUrl(sessionId, meta.id),
    })),
    ...(modelImages.length ? { modelImages } : {}),
    ...(modelText ? { modelText } : {}),
  };
}

function buildCodeWikiAskPrompt({
  question,
  reportPath,
  projectDir,
  replyLanguage,
  history = [],
}) {
  const historyText = buildCodeWikiHistoryContext(history, replyLanguage);
  if (getReplyLanguage(replyLanguage) === "en") {
    return [
      "Answer the following question based on the current project and the CodeWiki / project-requirements report.",
      `Project path: ${projectDir}`,
      `Report path: ${reportPath}`,
      historyText,
      "Requirements:",
      "- Prefer reading and citing the report above.",
      "- If the report is insufficient, use read-only project inspection to gather supporting evidence.",
      "- Do not modify files unless the user explicitly asks you to add or edit code comments. If they do, only add or replace comment lines and do not change executable code.",
      "- Do not generate a new report or write memory.",
      "- Respond in English unless the user explicitly asks for another language.",
      "",
      `Question: ${question.trim()}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [
    "请基于当前项目和 CodeWiki / project-requirements 报告回答下面的问题。",
    `项目路径：${projectDir}`,
    `报告路径：${reportPath}`,
    historyText,
    "要求：",
    "- 优先读取并参考上述报告。",
    "- 如果报告信息不足，可以只读检索项目文件补充证据。",
    "- 除非用户明确要求添加或编辑代码注释，否则不要修改文件；如果需要处理注释，只能添加或替换注释行，不能改变可执行代码。",
    "- 不要生成新报告，不要写入记忆。",
    "- 除非用户明确要求其他语言，否则使用简体中文回答。",
    "",
    `问题：${question.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCodeWikiHistoryContext(history = [], replyLanguage) {
  if (!Array.isArray(history) || history.length === 0) return "";
  const en = getReplyLanguage(replyLanguage) === "en";
  const header = en ? "Conversation history:" : "对话历史：";
  const lines = [header];
  for (const entry of history) {
    if (!entry || !entry.role) continue;
    const label =
      entry.role === "you" ? (en ? "User" : "用户") : en ? "Assistant" : "助手";
    const text = String(entry.text || "").slice(0, 800);
    if (text) lines.push(`${label}: ${text}`);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

export async function serveStatic(res, filePath, req) {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  try {
    const stat = await fs.stat(filePath);
    let entry = staticFileCache.get(filePath);
    if (!entry || entry.mtimeMs !== stat.mtimeMs) {
      entry = { mtimeMs: stat.mtimeMs, raw: await fs.readFile(filePath), gzip: null };
      staticFileCache.set(filePath, entry);
    }
    const headers = { "Content-Type": mime };
    if (ext === ".html") headers["Cache-Control"] = "no-cache";
    else if (FINGERPRINTED_ASSET.test(path.basename(filePath))) {
      headers["Cache-Control"] = "public, max-age=31536000, immutable";
    }
    const accept = String(req?.headers?.["accept-encoding"] || "");
    const useGzip = COMPRESSIBLE_EXT.has(ext) && accept.includes("gzip");
    let body = entry.raw;
    if (useGzip) {
      if (!entry.gzip) entry.gzip = await gzipAsync(entry.raw);
      body = entry.gzip;
      headers["Content-Encoding"] = "gzip";
      headers["Vary"] = "Accept-Encoding";
    }
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    staticFileCache.delete(filePath);
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}

function normalizeProjectPath(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const win = raw.match(/^([A-Za-z]):[\\/](.*)$/);
  if (win && process.platform !== "win32") {
    return path.join(
      "/mnt",
      win[1].toLowerCase(),
      win[2].replace(/[\\/]+/g, "/"),
    );
  }
  return path.resolve(raw);
}

function projectNameForDir(projectDir) {
  if (isGeneralProjectDir(projectDir)) return "__codemini_general__";
  return path.basename(path.resolve(projectDir || "")) || projectDir || "";
}

async function validProjectDir(value) {
  const normalized = normalizeProjectPath(value);
  if (!normalized) return "";
  try {
    const stat = await fs.stat(normalized);
    return stat.isDirectory() ? normalized : "";
  } catch {
    return "";
  }
}

async function resolveRequestProjectDir(value, fallbackDir) {
  const resolved = await validProjectDir(value);
  return resolved || fallbackDir;
}

async function parseProjectDirsParam(url, fallbackDir) {
  const raw = url.searchParams.get("projects");
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

async function enrichSkillWithHookMetadata(entry) {
  try {
    const skillRoot = entry.path ? path.dirname(entry.path) : "";
    if (!skillRoot) throw new Error("missing skill path");
    const discovered = await discoverSkillHooks({ skillRoot });
    return {
      ...entry,
      disableModelInvocation:
        entry.disableModelInvocation === true ||
        discovered.disableModelInvocation === true,
      userInvocable: entry.userInvocable !== false,
      routingAuthorLocked: entry.routingAuthorLocked === true,
      hooksProvenance: discovered.provenance || {},
      hookEvents: Object.keys(discovered.hooks || {}),
    };
  } catch {
    return {
      ...entry,
      disableModelInvocation: entry.disableModelInvocation === true,
      userInvocable: entry.userInvocable !== false,
      routingAuthorLocked: entry.routingAuthorLocked === true,
      hooksProvenance: {},
      hookEvents: [],
    };
  }
}

async function listSkillsForProjectDirs(projectDirs, fallbackDir) {
  void projectDirs;
  const entries = await listSkillEntries({ scope: "all", cwd: fallbackDir });
  const enriched = await Promise.all(entries.map(enrichSkillWithHookMetadata));
  return enriched.sort((a, b) => {
    const left = `${a.scope}:${a.name}`;
    const right = `${b.scope}:${b.name}`;
    return left.localeCompare(right);
  });
}

async function listMemoriesForProjectDirs({
  scope,
  query,
  projectDirs,
  fallbackDir,
}) {
  if (scope !== "project") {
    const items = query
      ? await searchMemories({ scope, query, workspaceRoot: fallbackDir })
      : await listMemories({ scope, workspaceRoot: fallbackDir });
    return items;
  }
  const dirs = projectDirs.length > 0 ? projectDirs : [fallbackDir];
  const chunks = await Promise.all(
    dirs.map(async (projectDir) => {
      const items = query
        ? await searchMemories({ scope, query, workspaceRoot: projectDir })
        : await listMemories({ scope, workspaceRoot: projectDir });
      return (items || []).map((item) => ({
        ...item,
        projectDir,
        projectName: projectNameForDir(projectDir),
      }));
    }),
  );
  return chunks.flat();
}

function inboxEntryMatchesQuery(entry, query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return [
    entry?.summary,
    entry?.details,
    entry?.suggestedAction,
    entry?.source,
    entry?.type,
    entry?.evidence?.reason,
    ...(Array.isArray(entry?.tags) ? entry.tags : []),
  ].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes(needle),
  );
}

async function listInboxForProjectDirs({
  scope,
  query,
  projectDirs,
  fallbackDir,
}) {
  const entries = await listInbox(scope ? { scope } : {});
  const allowedProjects = new Set(
    (projectDirs.length > 0 ? projectDirs : [fallbackDir])
      .map(normalizeProjectDirKey)
      .filter(Boolean),
  );
  return entries
    .filter((entry) => {
      if (scope !== "project") return true;
      const entryProject = normalizeProjectDirKey(
        entry?.projectDir || fallbackDir,
      );
      return allowedProjects.has(entryProject);
    })
    .filter((entry) => inboxEntryMatchesQuery(entry, query))
    .map((entry) => {
      if (entry.scope !== "project") return entry;
      const projectDir = entry.projectDir || fallbackDir;
      return {
        ...entry,
        projectDir,
        projectName: projectNameForDir(projectDir),
      };
    })
    .sort((left, right) =>
      String(right.timestamp || "").localeCompare(String(left.timestamp || "")),
    );
}

async function resolveCodeWikiProjectDir(url, fallbackDir) {
  const requested = normalizeProjectPath(url.searchParams.get("project") || "");
  if (!requested) return fallbackDir;
  try {
    const stat = await fs.stat(requested);
    if (stat.isDirectory()) return requested;
  } catch {}
  return fallbackDir;
}

function tryParseJson(value) {
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return null;
  }
}

function collectSessionPathHints(session) {
  const hints = [];
  const messages = Array.isArray(session?.messages) ? session.messages : [];
  for (const msg of messages) {
    if (Array.isArray(msg?.tool_calls)) {
      for (const call of msg.tool_calls) {
        const args = tryParseJson(call?.function?.arguments ?? call?.arguments);
        for (const key of ["path", "file", "filePath", "cwd"]) {
          if (typeof args?.[key] === "string") hints.push(args[key]);
        }
      }
    }
    const content = typeof msg?.content === "string" ? msg.content : "";
    for (const match of content.matchAll(/[A-Za-z]:[\\/][^\n\r"'`<>|]+/g))
      hints.push(match[0]);
    for (const match of content.matchAll(/\/mnt\/[A-Za-z]\/[^\n\r"'`<>|]+/g))
      hints.push(match[0]);
  }
  return hints;
}

async function existingDirectoryForHint(rawHint) {
  let candidate = normalizeProjectPath(rawHint);
  if (!candidate) return "";
  const configRoot = path.resolve(getBaseConfigDir());
  const candidateLower = path.resolve(candidate).toLowerCase();
  const configRootLower = configRoot.toLowerCase();
  if (
    candidateLower === configRootLower ||
    candidateLower.startsWith(`${configRootLower}${path.sep}`)
  )
    return "";
  candidate = candidate.replace(/[),\].。；;:]+$/g, "");
  for (
    let i = 0;
    i < 8 && candidate && candidate !== path.dirname(candidate);
    i += 1
  ) {
    try {
      const stat = await fs.stat(candidate);
      return stat.isDirectory() ? candidate : path.dirname(candidate);
    } catch {
      candidate = path.dirname(candidate);
    }
  }
  return "";
}

const CODEWIKI_REPORT_RE = /^[^/\\]+-project-requirements\.(?:html|md)$/;

function getRequirementsDir(projectDir) {
  return path.join(projectDir, "docs", "requirements");
}

function isCodeWikiReportFile(fileName) {
  return CODEWIKI_REPORT_RE.test(String(fileName || ""));
}

function codeWikiReportTitle(fileName) {
  return String(fileName || "")
    .replace(/-project-requirements\.(?:html|md)$/, "")
    .replace(/-/g, " ");
}

function codeWikiReportFormat(fileName) {
  return String(fileName || "")
    .toLowerCase()
    .endsWith(".md")
    ? "md"
    : "html";
}

// Injected for already-generated HTML shells that only ship light tokens.
const CODEWIKI_REPORT_THEME_INJECT = `
<style id="codemini-report-theme">
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #000000;
    --bg-muted: #1d1d1f;
    --bg-hover: #2c2c2e;
    --panel: #1d1d1f;
    --text: #f5f5f7;
    --text-secondary: #a1a1a6;
    --line: rgba(255, 255, 255, 0.1);
    --line-strong: rgba(255, 255, 255, 0.18);
    --accent: #2997ff;
    --accent-hover: #64b5ff;
    --accent-bg: rgba(41, 151, 255, 0.14);
    --red: #ff453a;
    --red-bg: rgba(255, 69, 58, 0.18);
    --orange: #ff9f0a;
    --orange-bg: rgba(255, 159, 10, 0.18);
    --green: #30d158;
    --green-bg: rgba(48, 209, 88, 0.18);
    --gray: #98989d;
    --gray-bg: rgba(152, 152, 157, 0.18);
    --code: #ff6482;
    --pre-bg: #1d1d1f;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
    --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.45);
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #000000;
  --bg-muted: #1d1d1f;
  --bg-hover: #2c2c2e;
  --panel: #1d1d1f;
  --text: #f5f5f7;
  --text-secondary: #a1a1a6;
  --line: rgba(255, 255, 255, 0.1);
  --line-strong: rgba(255, 255, 255, 0.18);
  --accent: #2997ff;
  --accent-hover: #64b5ff;
  --accent-bg: rgba(41, 151, 255, 0.14);
  --red: #ff453a;
  --red-bg: rgba(255, 69, 58, 0.18);
  --orange: #ff9f0a;
  --orange-bg: rgba(255, 159, 10, 0.18);
  --green: #30d158;
  --green-bg: rgba(48, 209, 88, 0.18);
  --gray: #98989d;
  --gray-bg: rgba(152, 152, 157, 0.18);
  --code: #ff6482;
  --pre-bg: #1d1d1f;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.35);
  --shadow-md: 0 12px 32px rgba(0, 0, 0, 0.45);
}
code { color: var(--code, #c9342d); }
pre { background: var(--pre-bg, var(--bg-muted, #f5f5f7)); }
</style>
<script id="codemini-report-theme-boot">
(() => {
  const root = document.documentElement;
  const apply = (theme) => {
    if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;
    else delete root.dataset.theme;
  };
  try { apply(new URLSearchParams(location.search).get('theme')); } catch {}
  window.addEventListener('message', (event) => {
    if (event?.data?.type === 'codewiki-theme') apply(event.data.theme);
  });
})();
</script>
`.trim();

function injectCodeWikiReportTheme(html) {
  const source = String(html || "");
  if (
    source.includes('id="codemini-report-theme"') ||
    source.includes("data?.type === 'codewiki-theme'")
  ) {
    return source;
  }
  if (/<\/head>/i.test(source)) {
    return source.replace(
      /<\/head>/i,
      `${CODEWIKI_REPORT_THEME_INJECT}\n</head>`,
    );
  }
  return `${CODEWIKI_REPORT_THEME_INJECT}\n${source}`;
}

function commonPathPrefix(paths) {
  const normalized = paths.map((p) =>
    path.resolve(p).split(path.sep).filter(Boolean),
  );
  if (!normalized.length) return "";
  const prefix = [];
  for (let i = 0; i < normalized[0].length; i += 1) {
    const part = normalized[0][i];
    if (normalized.every((parts) => parts[i] === part)) prefix.push(part);
    else break;
  }
  if (!prefix.length) return path.parse(paths[0]).root || "";
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
  if (dirs.length === 0) return "";

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
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
  );
  const latestWithMessages = sorted.find(
    (session) => Number(session.messageCount || 0) > 0,
  );
  if (latestWithMessages?.id) return latestWithMessages.id;

  const empty = sorted.find(
    (session) => Number(session.messageCount || 0) === 0,
  );
  if (empty?.id) return empty.id;

  return sorted[0]?.id || null;
}

export async function buildRuntimeForSession({ sessionId, model, projectDir }) {
  const resolvedDir = normalizeProjectPath(projectDir || process.cwd());
  const [config, session] = await Promise.all([
    loadConfig(),
    sessionId ? loadSession(sessionId) : createSession(resolvedDir),
  ]);
  const sessionProjectDir = normalizeProjectPath(
    (projectDir ? projectDir : await inferSessionProjectDir(session)) ||
      resolvedDir,
  );
  session.projectDir = sessionProjectDir;
  const isGeneral = isGeneralProjectDir(sessionProjectDir);
  const systemPrompt = buildDefaultSystemPrompt(config, {
    workspaceRoot: sessionProjectDir,
    extraPrompts: isGeneral ? [getGeneralChatSystemPromptBlock()] : [],
  });
  const runtime = await createChatRuntime({
    session,
    config,
    model: model || config.model?.name,
    systemPrompt,
    systemPromptFactory: (nextConfig) => buildDefaultSystemPrompt(nextConfig, {
      workspaceRoot: sessionProjectDir,
      extraPrompts: isGeneral ? [getGeneralChatSystemPromptBlock()] : [],
    }),
    workspaceRoot: sessionProjectDir,
  });
  return { runtime, config, session, cwd: sessionProjectDir, isGeneral };
}

async function main() {
  const args = parseArgs(process.argv);
  const readGitInfoAsync = createGitInfoReader();

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

  const { runtime: initialRuntime, session: initialSession } =
    await buildRuntimeForSession({
      sessionId: args.session,
      model: args.model,
    });
  const eventBroker = createEventBroker();
  const runtimeStatusStore = createRuntimeStatusStore();
  const recoveredSessionIds = new Set(
    await runtimeStatusStore.recoverInterrupted(),
  );
  const lifecycleWaiters = new Map();
  let initialRuntimeAvailable = true;
  const pool = new RuntimePool({
    maxConcurrent: 3,
    onEvent: (event) => {
      eventBroker.publish(event);
      if (event?.type === "runtime_pool_state" && event.state?.sessionId) {
        runtimeStatusStore
          .set(event.state.sessionId, event.state.status)
          .catch(() => {});
      }
    },
    runtimeFactory: async ({ sessionId, projectDir, model }) => {
      let runtime;
      if (initialRuntimeAvailable && sessionId === initialSession.id) {
        initialRuntimeAvailable = false;
        runtime = initialRuntime;
      } else {
        ({ runtime } = await buildRuntimeForSession({
          sessionId,
          projectDir,
          model,
        }));
      }
      const sessionBridge = new RuntimeBridge(runtime, {
        sessionId,
        onEvent: (event) => {
          if (event?.type === "session:forked") {
            const previousId = String(event.previousSessionId || "").trim();
            const nextId = String(event.nextSessionId || "").trim();
            if (previousId && nextId && previousId !== nextId) {
              pool.rekeySession(previousId, nextId);
            }
          }
          eventBroker.publish(event);
        },
        onLifecycle: (lifecycle) => {
          const status = lifecycle?.status;
          if (status === "running") return;

          // Waiting must win even when the Pool RUN already settled (completed
          // consumed the waiter). Otherwise approval UI appears while Pool is
          // terminal and every click falls into RECOVERED_FALLBACK.
          if (status === "waiting_approval" || status === "waiting_input") {
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
            (status === "completed" ||
              status === "failed" ||
              status === "aborted") &&
            (sessionBridge.hasPendingApproval?.() ||
              sessionBridge.hasPendingUserInput?.())
          ) {
            return;
          }

          lifecycleWaiters.delete(sessionId);
          resolve({ status });
        },
      });
      sessionBridge.abort = (options) => sessionBridge.handleAbort(options);
      sessionBridge.runPooled = (start) =>
        new Promise((resolve, reject) => {
          lifecycleWaiters.set(sessionId, resolve);
          try {
            const accepted = start();
            Promise.resolve(accepted).then(
              (result) => {
                if (result?.accepted === false || result?.error) {
                  lifecycleWaiters.delete(sessionId);
                  resolve({ status: "failed" });
                }
              },
              (error) => {
                lifecycleWaiters.delete(sessionId);
                reject(error);
              },
            );
          } catch (error) {
            lifecycleWaiters.delete(sessionId);
            reject(error);
          }
        });
      return sessionBridge;
    },
  });
  const initialEntry = await pool.ensureSession({
    sessionId: initialSession.id,
    projectDir: initialSession.projectDir || process.cwd(),
    model: args.model,
  });
  const runtimeEvictionTimer = startRuntimeEvictionTimer(pool);
  if (recoveredSessionIds.has(initialSession.id)) {
    initialEntry.status = "interrupted";
  } else {
    await runtimeStatusStore.set(initialSession.id, "idle");
  }
  let bridge = initialEntry.bridge;
  let currentProjectDir = process.cwd();
  const ensurePooledSession = createPooledSessionEnsurer({
    pool,
    loadSession,
    model: args.model,
    resolveProjectDir: (session) =>
      normalizeProjectPath(session.projectDir) ||
      session.projectDir ||
      currentProjectDir,
    prepareSession: async (session, resolvedProjectDir) => {
      // Keep the stored session cwd absolute so later pool lookups / git cwd
      // never fall back to the general workspace by accident.
      if (resolvedProjectDir && session.projectDir !== resolvedProjectDir) {
        session.projectDir = resolvedProjectDir;
        await saveSession(session).catch(() => {});
      }
      return session;
    },
    onCreated: async (entry, session) => {
      if (recoveredSessionIds.has(session.id)) entry.status = "interrupted";
      else await runtimeStatusStore.set(session.id, "idle");
    },
  });
  const allocateEmptySession = createPooledEmptySessionAllocator(pool);
  const runtimeApi = createWebRuntimeApi({
    pool,
    eventBroker,
    ensureSession: ensurePooledSession,
    runtimeStatusStore,
    allocateEmptySession,
    getDefaultProjectDir: () => currentProjectDir,
    setDefaultProjectDir: (dir) => {
      const next = String(dir || "").trim();
      if (next) currentProjectDir = next;
    },
  });

  const pickCodeWikiBridge = (codeWikiProjectDir) =>
    resolveCodeWikiBridge({
      codeWikiProjectDir,
      currentProjectDir,
      currentBridge: bridge,
      currentSessionId: bridge.getSessionId?.(),
      ensurePooledSession,
      createSession,
      findPreferredSessionId: findPreferredSessionForProject,
      sameProject: (left, right) =>
        normalizeProjectDirKey(left) === normalizeProjectDirKey(right),
      isSessionBusy: (sessionId) =>
        ACTIVE_RUNTIME_STATUSES.has(pool.getSessionState(sessionId)?.status),
    });
  const submitCodeWikiOperation = (sessionId, line, operationId) =>
    pool.submit(sessionId, (target) =>
      typeof target.runPooled === "function"
        ? target.runPooled(() =>
            target.handleCodeWikiGenerate(line, { operationId }),
          )
        : target.handleCodeWikiGenerate(line, { operationId }),
    );

  const resolveTerminalCwd = async (url, body = {}) => {
    const sessionId = String(
      body?.sessionId || url.searchParams.get("sessionId") || "",
    ).trim();
    if (sessionId) {
      try {
        await ensurePooledSession(sessionId);
      } catch {}
    }
    const cwd =
      resolveGitCwd({
        sessionId,
        getSessionProjectDir: (id) =>
          pool.getSessionState(id)?.projectDir || "",
        fallbackDir: currentProjectDir,
      }) ||
      currentProjectDir ||
      process.cwd();
    if (shouldAdoptGitCwd(cwd, currentProjectDir)) currentProjectDir = cwd;
    return cwd;
  };

  const routes = createNodeRouter();
  routes.get("/api/embed", nodeRoute(async (req, res, url) => {
      const target = String(url.searchParams.get("url") || "").trim();
      if (!target) {
        jsonResponse(
          res,
          { error: true, message: "Missing url parameter" },
          400,
        );
        return;
      }
      try {
        const embed = await resolveEmbed(target);
        jsonResponse(res, embed);
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error instanceof Error ? error.message : String(error),
          },
          400,
        );
      }
      return;

  }));
  routes.get("/api/version", nodeRoute(async (req, res, url) => {
      let latest = null;
      try {
        latest = execSync("npm view codemini-cli version", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        }).trim();
      } catch {}
      jsonResponse(res, { current: VERSION, latest });
      return;

  }));
  routes.post("/api/update", nodeRoute(async (req, res, url) => {
      try {
        const output = execSync("npm update -g codemini-cli", {
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 60000,
        });
        jsonResponse(res, { ok: true, output: output.trim() });
      } catch (err) {
        jsonResponse(res, { ok: false, error: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/codewiki/reports", nodeRoute(async (req, res, url) => {
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(
        url,
        currentProjectDir,
      );
      const initializedGraph = await initializeProjectIndex(codeWikiProjectDir);
      const graphMetadata = queryProjectKnowledgeGraph(
        initializedGraph?.projectRoot || codeWikiProjectDir,
        { operation: "overview", depth: 0, token_budget: 250 },
      );
      const requirementsDir = getRequirementsDir(codeWikiProjectDir);
      try {
        const entries = await fs.readdir(requirementsDir, {
          withFileTypes: true,
        });
        const reports = [];
        for (const entry of entries) {
          if (!entry.isFile() || !isCodeWikiReportFile(entry.name)) continue;
          const reportPath = path.join(requirementsDir, entry.name);
          const stat = await fs.stat(reportPath);
          let manifestStatus = "";
          let manifestUpdatedAt = "";
          let reportGraphVersion = "";
          let manifestError = "";
          try {
            const baseName = entry.name.replace(/\.(?:html|md)$/i, "");
            const manifestPath = path.join(
              requirementsDir,
              `${baseName}.manifest.json`,
            );
            const manifest = JSON.parse(
              await fs.readFile(manifestPath, "utf8"),
            );
            manifestStatus =
              typeof manifest?.status === "string" ? manifest.status : "";
            manifestUpdatedAt =
              typeof manifest?.updatedAt === "string" ? manifest.updatedAt : "";
            reportGraphVersion =
              typeof manifest?.graphVersion === "string"
                ? manifest.graphVersion
                : "";
            manifestError =
              typeof manifest?.error === "string" ? manifest.error : "";
          } catch {
            manifestStatus = "";
            manifestUpdatedAt = "";
            reportGraphVersion = "";
            manifestError = "";
          }
          reports.push({
            file: entry.name,
            title: codeWikiReportTitle(entry.name),
            format: codeWikiReportFormat(entry.name),
            size: stat.size,
            mtime: stat.mtime.toISOString(),
            manifestStatus,
            manifestUpdatedAt,
            manifestError,
            graphVersion: reportGraphVersion,
            graphFreshness: !reportGraphVersion
              ? "unknown"
              : reportGraphVersion === graphMetadata?.graph_version
                ? "fresh"
                : "stale",
          });
        }
        reports.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));
        jsonResponse(res, {
          reports,
          graphVersion: graphMetadata?.graph_version || "",
          graphBuiltAt: graphMetadata?.built_at || "",
        });
      } catch (err) {
        if (err?.code === "ENOENT") jsonResponse(res, { reports: [] });
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/codewiki/symbol-graph", nodeRoute(async (req, res, url) => {
      try {
        const codeWikiProjectDir = await resolveCodeWikiProjectDir(
          url,
          currentProjectDir,
        );
        const initialized = await initializeProjectIndex(codeWikiProjectDir);
        const projectRoot = initialized?.projectRoot || codeWikiProjectDir;
        const operation = url.searchParams.get("operation") || "overview";
        jsonResponse(
          res,
          queryProjectKnowledgeGraph(projectRoot, {
            operation,
            query: url.searchParams.get("query") || "",
            node_id: url.searchParams.get("node_id") || "",
            from: url.searchParams.get("from") || "",
            to: url.searchParams.get("to") || "",
            direction: url.searchParams.get("direction") || "both",
            depth: Number(
              url.searchParams.get("depth") ||
                (operation === "overview" ? 2 : 2),
            ),
            token_budget: Number(url.searchParams.get("token_budget") || 6000),
            include_ambiguous:
              url.searchParams.get("include_ambiguous") === "true",
            files: url.searchParams.getAll("file"),
          }),
        );
      } catch (err) {
        jsonResponse(res, {
          updatedAt: "",
          stats: {
            files: 0,
            symbols: 0,
            displayed_nodes: 0,
            displayed_edges: 0,
          },
          nodes: [],
          edges: [],
          error: err?.message || String(err),
        });
      }
      return;

  }));
  routes.post("/api/codewiki/generate", nodeRoute(async (req, res, url) => {
      const { depth, format } = await readBody(req);
      const normalizedDepthRaw = String(depth || "").toLowerCase();
      const normalizedDepth =
        normalizedDepthRaw === "standard" || normalizedDepthRaw === "deep"
          ? "deep"
          : normalizedDepthRaw === "fast"
            ? "fast"
            : "fast";
      const normalizedFormat = ["html", "md"].includes(
        String(format || "").toLowerCase(),
      )
        ? String(format).toLowerCase()
        : "html";
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(
        url,
        currentProjectDir,
      );
      // Reuse current bridge when idle on this project; otherwise prefer an
      // existing project session, or create one so CodeWiki is not blocked by
      // an in-progress chat.
      const { bridge: codeWikiBridge, sessionId: selectedSessionId } =
        await pickCodeWikiBridge(codeWikiProjectDir);
      if (codeWikiBridge.isBusy()) {
        jsonResponse(res, { error: true, message: "Runtime is busy" }, 409);
        return;
      }
      const codeWikiSessionId =
        selectedSessionId || codeWikiBridge.getSessionId?.();
      if (!codeWikiSessionId) {
        jsonResponse(
          res,
          { error: true, message: "CodeWiki runtime has no session id" },
          500,
        );
        return;
      }
      const operationId = `codewiki-${randomUUID()}`;
      const result = submitCodeWikiOperation(
        codeWikiSessionId,
        `/project-requirements --${normalizedDepth} --${normalizedFormat}`,
        operationId,
      );
      jsonResponse(
        res,
        { ...result, sessionId: codeWikiSessionId, operationId },
        result.accepted ? 202 : 409,
      );
      return;

  }));
  routes.post("/api/codewiki/ask", nodeRoute(async (req, res, url) => {
      const { question, reportFile, history } = await readBody(req);
      if (!question || typeof question !== "string") {
        jsonResponse(
          res,
          { error: true, message: 'Missing "question" field' },
          400,
        );
        return;
      }
      const currentConfig = await loadConfig();
      const configStatus = getConfigStatus(currentConfig);
      if (configStatus.setupRequired) {
        jsonResponse(
          res,
          {
            error: true,
            code: "CONFIG_REQUIRED",
            message:
              "Gateway is not configured. Open Settings and set the API Base URL and API Key.",
            configStatus,
          },
          409,
        );
        return;
      }
      const selectedReport = isCodeWikiReportFile(reportFile) ? reportFile : "";
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(
        url,
        currentProjectDir,
      );
      const { bridge: codeWikiBridge } =
        await pickCodeWikiBridge(codeWikiProjectDir);
      if (codeWikiBridge.isBusy()) {
        jsonResponse(res, { error: true, message: "Runtime is busy" }, 409);
        return;
      }
      const reportPath = selectedReport
        ? path.join(getRequirementsDir(codeWikiProjectDir), selectedReport)
        : getRequirementsDir(codeWikiProjectDir);
      const prompt = buildCodeWikiAskPrompt({
        question,
        reportPath,
        projectDir: codeWikiProjectDir,
        replyLanguage: codeWikiBridge.getState()?.replyLanguage,
        history: Array.isArray(history) ? history : [],
      });

      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      const writeEvent = (event) => {
        try {
          res.write(`${JSON.stringify(event)}\n`);
        } catch {}
      };
      await codeWikiBridge.handleCodeWikiAsk(prompt, writeEvent);
      res.end();
      return;

  }));
  routes.get("/api/project", nodeRoute(async (req, res, url) => {
      jsonResponse(res, {
        cwd: currentProjectDir,
        isGeneral: isGeneralProjectDir(currentProjectDir),
      });
      return;

  }));
  routes.get("/api/git", nodeRoute(async (req, res, url) => {
      try {
        const sessionId = String(
          url.searchParams.get("sessionId") || "",
        ).trim();
        if (sessionId) {
          try {
            await ensurePooledSession(sessionId);
          } catch {}
        }
        const gitCwd = resolveGitCwd({
          sessionId,
          getSessionProjectDir: (id) =>
            pool.getSessionState(id)?.projectDir || "",
          fallbackDir: currentProjectDir,
        });
        if (shouldAdoptGitCwd(gitCwd, currentProjectDir))
          currentProjectDir = gitCwd;
        jsonResponse(res, await readGitInfoAsync(gitCwd || currentProjectDir));
      } catch {
        jsonResponse(res, {
          isGit: false,
          branch: null,
          dirty: false,
          staged: 0,
          modified: 0,
          untracked: 0,
          linesAdded: 0,
          linesRemoved: 0,
        });
      }
      return;

  }));
  routes.get("/api/workspace/tree", nodeRoute(async (req, res, url) => {
      const cwd = await resolveTerminalCwd(url);
      try {
        const relativePath = String(url.searchParams.get("path") || "").trim();
        const result = await listWorkspaceChildren(cwd, relativePath);
        jsonResponse(res, result);
      } catch (err) {
        const message = String(err?.message || "Unable to list workspace");
        const status = /outside|does not exist|not a directory/i.test(message)
          ? 400
          : 500;
        jsonResponse(res, { error: true, message }, status);
      }
      return;

  }));
  routes.get("/api/workspace/preview", nodeRoute(async (req, res, url) => {
      const cwd = await resolveTerminalCwd(url);
      try {
        const relativePath = String(url.searchParams.get("path") || "").trim();
        const result = await previewWorkspaceFile(cwd, relativePath);
        jsonResponse(res, result);
      } catch (err) {
        const message = String(err?.message || "Unable to preview file");
        const status =
          /outside|does not exist|not a file|requires a file path/i.test(
            message,
          )
            ? 400
            : 500;
        jsonResponse(res, { error: true, message }, status);
      }
      return;

  }));
  routes.get("/api/workspace/file", nodeRoute(async (req, res, url) => {
      const cwd = await resolveTerminalCwd(url);
      try {
        const relativePath = String(url.searchParams.get("path") || "").trim();
        if (!relativePath) {
          jsonResponse(res, { error: true, message: "File path required" }, 400);
          return;
        }
        if (!isPreviewableImagePath(relativePath)) {
          jsonResponse(
            res,
            { error: true, message: "Only image files can be served" },
            400,
          );
          return;
        }
        const { absolutePath } = await resolveWorkspacePath(cwd, relativePath);
        const stat = await fs.stat(absolutePath);
        if (!stat.isFile()) {
          jsonResponse(res, { error: true, message: "Path is not a file" }, 400);
          return;
        }
        const ext = path.extname(absolutePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";
        const data = await fs.readFile(absolutePath);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": data.length,
          "Cache-Control": "private, max-age=120",
        });
        res.end(data);
      } catch (err) {
        const message = String(err?.message || "Unable to read file");
        const status = /outside|does not exist/i.test(message) ? 400 : 500;
        jsonResponse(res, { error: true, message }, status);
      }
      return;

  }));
  routes.get("/api/terminal", nodeRoute(async (req, res, url) => {
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url);
      jsonResponse(res, getTerminalSnapshot(cwd, config.shell?.default));
      return;

  }));
  routes.get("/api/terminal/stream", nodeRoute(async (req, res, url) => {
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      subscribeTerminal(cwd, res, config.shell?.default);
      return;

  }));
  routes.post("/api/terminal/run", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      const result = runTerminalCommand({
        cwd,
        command: body?.command,
        shellDefault: config.shell?.default,
      });
      jsonResponse(res, result, result.ok ? 200 : 400);
      return;

  }));
  routes.post("/api/terminal/input", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      jsonResponse(
        res,
        writeTerminalInput(cwd, body?.data, config.shell?.default),
      );
      return;

  }));
  routes.post("/api/terminal/resize", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      jsonResponse(
        res,
        resizeTerminal(cwd, body?.cols, body?.rows, config.shell?.default),
      );
      return;

  }));
  routes.post("/api/terminal/stop", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      jsonResponse(res, stopTerminal(cwd, config.shell?.default));
      return;

  }));
  routes.post("/api/terminal/clear", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      jsonResponse(res, {
        ok: true,
        snapshot: clearTerminal(cwd, config.shell?.default),
      });
      return;

  }));
  routes.post("/api/terminal/restart", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      const config = await loadConfig();
      const cwd = await resolveTerminalCwd(url, body);
      jsonResponse(res, restartTerminal(cwd, config.shell?.default));
      return;

  }));
  routes.get("/api/git-diff", nodeRoute(async (req, res, url) => {
      try {
        const sessionId = String(
          url.searchParams.get("sessionId") || "",
        ).trim();
        if (sessionId) {
          try {
            await ensurePooledSession(sessionId);
          } catch {}
        }
        const gitCwd = resolveGitCwd({
          sessionId,
          getSessionProjectDir: (id) =>
            pool.getSessionState(id)?.projectDir || "",
          fallbackDir: currentProjectDir,
        });
        if (shouldAdoptGitCwd(gitCwd, currentProjectDir))
          currentProjectDir = gitCwd;
        jsonResponse(res, await readGitDiffData(gitCwd || currentProjectDir));
      } catch {
        jsonResponse(res, {
          patch: "",
          files: [],
          linesAdded: 0,
          linesRemoved: 0,
        });
      }
      return;

  }));
  routes.post("/api/git-batch", nodeRoute(async (req, res, url) => {
      const { dirs } = await readBody(req);
      const result = await readGitInfoBatch(dirs, {
        reader: readGitInfoAsync,
        concurrency: 4,
        includeCounts: false,
      });
      jsonResponse(res, result);
      return;

  }));
  routes.post("/api/project/open", nodeRoute(async (req, res, url) => {
      const { path: projectPath, newSession: forceNewSession = false } =
        await readBody(req);
      if (!projectPath) {
        jsonResponse(res, { error: true, message: "Missing path" }, 400);
        return;
      }
      try {
        // Client marker for general workspace
        const openingGeneral = projectPath === "__codemini_general__";
        const resolved = openingGeneral
          ? GENERAL_PROJECT_DIR
          : path.resolve(projectPath);
        const stat = await fs.stat(resolved);
        if (!stat.isDirectory()) throw new Error("Not a directory");
        let reusedSessionId = null;
        let session;
        if (!openingGeneral) {
          await patchWebuiActiveProjects({
            action: "activate",
            projectDir: resolved,
          });
          currentProjectDir = resolved;
        }
        if (openingGeneral || forceNewSession) {
          const allocated = await allocateEmptySession(
            openingGeneral ? GENERAL_PROJECT_DIR : currentProjectDir,
          );
          reusedSessionId = allocated.reused ? allocated.session.id : null;
          session = allocated.session;
        } else {
          reusedSessionId =
            await findPreferredSessionForProject(currentProjectDir);
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
          state: {
            ...targetBridge.getState(),
            cwd: currentProjectDir,
            isGeneral,
          },
          sessionData: {
            messages: targetBridge.getSessionMessages(),
            compact: targetBridge.getSessionCompactMeta(),
            uiMessages: await targetBridge.getUiMessages(session.id),
          },
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.post("/api/project/browse", nodeRoute(async (req, res, url) => {
      const { dir } = await readBody(req);
      const roots = await listProjectRoots();
      if (!dir && roots.length) {
        jsonResponse(res, { path: "", roots, dirs: [] });
        return;
      }
      const base = dir ? path.resolve(dir) : path.resolve("/");
      try {
        const entries = await fs.readdir(base, { withFileTypes: true });
        const dirs = entries
          .filter((e) => e.isDirectory() && !e.name.startsWith("."))
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((e) => ({
            name: e.name,
            path: path.join(base, e.name),
            isGit: false,
          }));
        // Check for .git directories asynchronously
        await Promise.all(
          dirs.map(async (d) => {
            try {
              await fs.access(path.join(d.path, ".git"));
              d.isGit = true;
            } catch {}
          }),
        );
        jsonResponse(res, { path: base, roots, dirs });
      } catch (err) {
        jsonResponse(res, { path: base, roots, dirs: [], error: err.message });
      }
      return;

  }));
  routes.get("/api/config/status", nodeRoute(async (req, res, url) => {
      const config = await loadConfig();
      jsonResponse(res, getConfigStatus(config));
      return;

  }));
  routes.get("/api/playwright/status", nodeRoute(async (req, res, url) => {
      try {
        jsonResponse(res, await detectPlaywrightStatus());
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/storage", nodeRoute(async (req, res, url) => {
      try {
        jsonResponse(res, await getSqliteStorageInfo(currentProjectDir));
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/storage/open", nodeRoute(async (req, res, url) => {
      const { target } = await readBody(req);
      try {
        jsonResponse(
          res,
          await openSqliteStorageFolder(target, currentProjectDir),
        );
      } catch (err) {
        const status = String(err?.message || "").includes(
          "Invalid storage target",
        )
          ? 400
          : 500;
        jsonResponse(res, { error: true, message: err.message }, status);
      }
      return;

  }));
  routes.post("/api/files/open", nodeRoute(async (req, res, url) => {
      const { path: filePath, action = "open" } = await readBody(req);
      try {
        jsonResponse(
          res,
          await launchWorkspacePath(filePath, currentProjectDir, { action }),
        );
      } catch (err) {
        const message = String(err?.message || "Unable to open file");
        const status =
          /Missing|Invalid|outside|does not exist|not a file/i.test(message)
            ? 400
            : 500;
        jsonResponse(res, { error: true, message }, status);
      }
      return;

  }));
  routes.get("/api/config", nodeRoute(async (req, res, url) => {
      const config = await loadConfig();
      jsonResponse(res, config);
      return;

  }));
  routes.post("/api/config/set", nodeRoute(async (req, res, url) => {
      const { key, value } = await readBody(req);
      if (!key) {
        jsonResponse(res, { error: true, message: "Missing key" }, 400);
        return;
      }
      try {
        await setConfigValue(key, value);
        const config = await loadConfig();
        await pool.reloadConfig(
          key === "model.name" ? { model: config.model?.name } : {},
        );
        jsonResponse(res, { ok: true, config });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/mcp/servers", nodeRoute(async (req, res, url) => {
      const config = await loadConfig();
      const servers = Array.isArray(config.mcp?.servers)
        ? config.mcp.servers.map(normalizeMcpServer)
        : [];
      jsonResponse(res, { servers });
      return;

  }));
  routes.post("/api/mcp/servers/test", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const result = await inspectMcpServer(body?.server || body || {});
        jsonResponse(res, result);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.post("/api/mcp/servers", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const server = validateMcpServer(body?.server || body || {});
        const originalId = String(body?.originalId || server.id).trim();
        const config = await loadConfig();
        config.mcp = config.mcp || {};
        const servers = Array.isArray(config.mcp.servers)
          ? config.mcp.servers
          : [];
        const duplicate = servers.find(
          (item) =>
            String(item?.id || "").trim() === server.id &&
            String(item?.id || "").trim() !== originalId,
        );
        if (duplicate) {
          jsonResponse(
            res,
            {
              error: true,
              message: `MCP server id already exists: ${server.id}`,
            },
            409,
          );
          return;
        }
        const nextServer = server;
        config.mcp.servers = [
          ...servers.filter(
            (item) => String(item?.id || "").trim() !== originalId,
          ),
          nextServer,
        ];
        await saveConfig(config);
        await closeMcpClient(originalId);
        if (originalId !== server.id) await closeMcpClient(server.id);
        await pool.reloadConfig();
        jsonResponse(res, { ok: true, server: normalizeMcpServer(nextServer) });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.get("/api/webui/active-projects", nodeRoute(async (req, res, url) => {
      try {
        const projects = await loadWebuiActiveProjects();
        jsonResponse(res, projects);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.patch("/api/webui/active-projects", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const projects = await patchWebuiActiveProjects(body || {});
        jsonResponse(res, { ok: true, ...projects });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/memory/inbox", nodeRoute(async (req, res, url) => {
      const requestedScope = String(url.searchParams.get("scope") || "")
        .trim()
        .toLowerCase();
      const scope = MEMORY_SCOPES.has(requestedScope) ? requestedScope : null;
      const query = String(url.searchParams.get("q") || "").trim();
      try {
        const projectDirs = await parseProjectDirsParam(url, currentProjectDir);
        const items = await listInboxForProjectDirs({
          scope,
          query,
          projectDirs,
          fallbackDir: currentProjectDir,
        });
        jsonResponse(res, { scope: scope || "all", query, items });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/memory/inbox/dream", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const requestedScope = String(body?.scope || "")
          .trim()
          .toLowerCase();
        const scope = MEMORY_SCOPES.has(requestedScope) ? requestedScope : null;
        const config = await loadConfig();
        const result = await runDreamConsolidation({
          scope,
          workspaceRoot: currentProjectDir,
          config,
        });
        jsonResponse(res, result);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/memory", nodeRoute(async (req, res, url) => {
      const scope = normalizeMemoryScope(url.searchParams.get("scope"));
      const query = String(url.searchParams.get("q") || "").trim();
      try {
        const projectDirs = await parseProjectDirsParam(url, currentProjectDir);
        const items = await listMemoriesForProjectDirs({
          scope,
          query,
          projectDirs,
          fallbackDir: currentProjectDir,
        });
        jsonResponse(res, { scope, query, items });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/research/sessions", nodeRoute(async (req, res, url) => {
      const query = String(url.searchParams.get("q") || "").trim();
      jsonResponse(res, listResearchSessionsForApi({ query }));
      return;

  }));
  routes.post("/api/research/sessions", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        jsonResponse(res, createResearchSessionForApi(body || {}));
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to create research session",
          },
          400,
        );
      }
      return;

  }));
  routes.get("/api/scrapbook/entries", nodeRoute(async (req, res, url) => {
      const query = String(url.searchParams.get("q") || "").trim();
      jsonResponse(res, listScrapbookEntriesForApi({ query }));
      return;

  }));
  routes.post("/api/scrapbook/entries/manual", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      try {
        jsonResponse(res, {
          ok: true,
          entry: createManualScrapbookEntry(body || {}),
        });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to create scrapbook entry",
          },
          400,
        );
      }
      return;

  }));
  routes.post("/api/scrapbook/entries/url", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      try {
        jsonResponse(res, {
          ok: true,
          entry: createUrlScrapbookEntry(body || {}),
        });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to import scrapbook URL",
          },
          400,
        );
      }
      return;

  }));
  routes.post("/api/scrapbook/entries/notebook", nodeRoute(async (req, res, url) => {
      try {
        const form = await readMultipartForm(req);
        const title = String(form.get("title") || "").trim();
        const contentText = String(form.get("contentText") || "").trim();
        const urls = form
          .getAll("urls")
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        const files = form
          .getAll("files")
          .filter((item) => item && typeof item.arrayBuffer === "function");
        const sources = urls.map((sourceUrl) => ({
          type: "url",
          name: sourceUrl,
          url: sourceUrl,
        }));
        if (contentText) {
          sources.push({
            type: "manual",
            name: title || "Manual note",
            contentText,
          });
        }
        for (const file of files) {
          if (Number(file.size || 0) > 20 * 1024 * 1024) {
            throw new Error(`${file.name || "File"} exceeds the 20 MB limit`);
          }
          const name = safeUploadFileName(file.name || "source");
          const ext = path.extname(name).toLowerCase();
          if (![".pdf", ".docx", ".txt", ".md", ".markdown"].includes(ext)) {
            throw new Error(
              "Unsupported source type. Use PDF, DOCX, TXT, or Markdown.",
            );
          }
          const buffer = Buffer.from(await file.arrayBuffer());
          const extractedText = [".txt", ".md", ".markdown"].includes(ext)
            ? buffer.toString("utf8").trim()
            : await extractAttachmentText(buffer, ext);
          if (!extractedText)
            throw new Error(`No readable text found in ${name}`);
          sources.push({
            type: "file",
            name,
            mime: String(file.type || "application/octet-stream"),
            contentText: extractedText,
          });
        }
        const entry = createMultiSourceScrapbookEntry({ title, sources });
        const job = startScrapbookSummaryJob(entry.id);
        jsonResponse(res, { ok: true, entry, job });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to create notebook",
          },
          400,
        );
      }
      return;

  }));
  routes.post("/api/scrapbook/entries/chat-answer", nodeRoute(async (req, res, url) => {
      const body = await readBody(req);
      try {
        jsonResponse(res, {
          ok: true,
          ...createChatAnswerScrapbookEntryWithSummary(body || {}),
        });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to save scrapbook answer",
          },
          400,
        );
      }
      return;

  }));
  routes.get("/api/skills", nodeRoute(async (req, res, url) => {
      try {
        const skills = await listSkillsForProjectDirs([], currentProjectDir);
        jsonResponse(res, skills);
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/skills/index", nodeRoute(async (req, res, url) => {
      try {
        const targetProjectDir = await resolveRequestProjectDir(
          url.searchParams.get("projectDir"),
          currentProjectDir,
        );
        const config = await loadConfig();
        const preview = await buildSkillIndexPreview(targetProjectDir, config);
        jsonResponse(res, {
          ...preview,
          projectDir: targetProjectDir,
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/skills/create", nodeRoute(async (req, res, url) => {
      const { name, description, content, contexts } = await readBody(req);
      if (!name || !content) {
        jsonResponse(
          res,
          { error: true, message: "Missing name or content" },
          400,
        );
        return;
      }
      if (!isSafeSkillName(name)) {
        jsonResponse(res, { error: true, message: "Invalid skill name" }, 400);
        return;
      }
      try {
        const skillBaseDir = getSkillsDir();
        const skillDir = path.join(skillBaseDir, name);
        await fs.mkdir(skillDir, { recursive: true });
        const skillFile = path.join(skillDir, "SKILL.md");
        await fs.writeFile(skillFile, content, "utf8");
        const markdownMeta = metadataPatchFromSkillMarkdown(content);
        const catalogSeed = {
          description: description || markdownMeta.description || "",
          mode: markdownMeta.mode || "agent_requested",
          triggers: Array.isArray(markdownMeta.triggers)
            ? markdownMeta.triggers
            : [],
          enabled: markdownMeta.enabled !== false,
          ...(markdownMeta.priority !== undefined
            ? { priority: markdownMeta.priority }
            : { priority: 50 }),
        };
        await upsertSkillRegistryEntry(undefined, {
          name,
          version: "0.0.0",
          description: catalogSeed.description,
          enabled: catalogSeed.enabled,
          source: "web-create",
          entryFile: "SKILL.md",
          sha256: await computeFileSha256(skillFile),
          installedAt: new Date().toISOString(),
        });
        await upsertSkillCatalogMetadata(getSkillsDir(), name, catalogSeed);
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.contexts = config.skills.contexts || {};
        config.skills.enabled[name] = true;
        config.skills.contexts[name] =
          contexts !== undefined
            ? normalizeSkillContexts(contexts)
            : ["coding", "daily"];
        await saveConfig(config);
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, name });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/skills/preview", nodeRoute(async (req, res, url) => {
      const { source } = await readBody(req);
      if (!source) {
        jsonResponse(res, { error: true, message: "Missing source" }, 400);
        return;
      }
      try {
        const preview = await previewSkillSource(source, {
          cwd: currentProjectDir || process.cwd(),
        });
        jsonResponse(res, { ok: true, ...preview });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/skills/install", nodeRoute(async (req, res, url) => {
      const {
        source,
        contexts,
        includeHooks = false,
        skillNames = null,
      } = await readBody(req);
      if (!source) {
        jsonResponse(res, { error: true, message: "Missing source" }, 400);
        return;
      }
      try {
        const installed = await installSkillSource(source, {
          cwd: currentProjectDir,
          includeHooks: includeHooks === true,
          skillNames: Array.isArray(skillNames) ? skillNames : null,
          contexts:
            contexts !== undefined
              ? normalizeSkillContexts(contexts)
              : undefined,
        });
        if (contexts !== undefined) {
          const config = await loadConfig();
          config.skills = config.skills || {};
          config.skills.contexts = config.skills.contexts || {};
          const normalizedContexts = normalizeSkillContexts(contexts);
          for (const name of installed)
            config.skills.contexts[name] = normalizedContexts;
          await saveConfig(config);
        }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, installed });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/skills/update/preview", nodeRoute(async (req, res, url) => {
      const { name, projectDir } = await readBody(req);
      if (!name) {
        jsonResponse(res, { error: true, message: "Missing skill name" }, 400);
        return;
      }
      try {
        const targetProjectDir = await resolveRequestProjectDir(
          projectDir,
          currentProjectDir,
        );
        const preview = await previewSkillPackageUpdate({
          name,
          cwd: targetProjectDir,
        });
        jsonResponse(res, { ok: true, ...preview });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/skills/update", nodeRoute(async (req, res, url) => {
      const {
        name,
        projectDir,
        skillNames = null,
        includeHooks,
        defaultContexts,
      } = await readBody(req);
      if (!name) {
        jsonResponse(res, { error: true, message: "Missing skill name" }, 400);
        return;
      }
      try {
        const targetProjectDir = await resolveRequestProjectDir(
          projectDir,
          currentProjectDir,
        );
        const result = await updateSkillPackage({
          name,
          cwd: targetProjectDir,
          skillNames: Array.isArray(skillNames) ? skillNames : null,
          includeHooks,
          defaultContexts,
        });
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, {
          ok: true,
          installed: result.installed,
          previouslyInstalled: result.previouslyInstalled,
          packageSource: result.packageSource,
          packageName: result.packageName,
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/hooks", nodeRoute(async (req, res, url) => {
      try {
        const requestedScope = url.searchParams.get("scope");
        const scope =
          requestedScope === "global"
            ? "global"
            : requestedScope === "daily"
              ? "daily"
              : "coding";
        const loaded =
          scope === "global"
            ? await loadGlobalHooks({ rewriteMatchers: false })
            : await loadProjectHooks(currentProjectDir || process.cwd(), {
                rewriteMatchers: false,
                context: scope,
              });
        const rawHooks = await readWorkspaceHooksFile(loaded.filePath);
        jsonResponse(res, {
          scope,
          filePath: loaded.filePath,
          hooks: rawHooks,
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/hook-profiles", nodeRoute(async (req, res, url) => {
      try {
        const cwd = currentProjectDir || process.cwd();
        const [globalLayer, codingLayer, dailyLayer, customProfiles, skills] =
          await Promise.all([
            loadGlobalHooks({ rewriteMatchers: false }),
            loadProjectHooks(cwd, {
              rewriteMatchers: false,
              context: "coding",
            }),
            loadProjectHooks(cwd, { rewriteMatchers: false, context: "daily" }),
            listCustomHookProfiles(cwd),
            listSkillEntries({ scope: "all", cwd }),
          ]);
        const legacyProfiles = [];
        for (const layer of [
          {
            id: "legacy-global",
            activation: "always",
            scope: "global",
            filePath: globalLayer.filePath,
          },
          {
            id: "legacy-coding",
            activation: "coding",
            scope: "project",
            filePath: codingLayer.filePath,
          },
          {
            id: "legacy-daily",
            activation: "daily",
            scope: "project",
            filePath: dailyLayer.filePath,
          },
        ]) {
          const hooks = await readWorkspaceHooksFile(layer.filePath);
          // Old workspace hook files remain editable, but empty scope layers are
          // headings rather than fake profiles in the new profile library.
          if (Object.keys(hooks).length === 0) continue;
          legacyProfiles.push({
            ...layer,
            name: "Legacy hooks",
            nameKey: "hooksLegacyProfile",
            kind: "workspace",
            enabled: true,
            editable: true,
            hooks,
          });
        }
        const profiles = [...legacyProfiles, ...customProfiles];
        for (const skill of skills) {
          const skillRoot = path.dirname(skill.path);
          const discovered = await discoverSkillHooks({ skillRoot });
          if (discovered.disabled) continue;
          const raw = await readHooksJsonRaw(
            path.join(skillRoot, "hooks", "hooks.json"),
          );
          const hooks = Object.keys(raw).length > 0 ? raw : discovered.hooks;
          if (Object.keys(hooks).length === 0) continue;
          const activation = hookActivationFromContexts(
            Array.isArray(skill.contexts) ? skill.contexts : [],
          );
          profiles.push({
            id: `skill:${skill.scope}:${skill.name}`,
            name: skill.name,
            kind: "skill",
            scope: skill.scope,
            activation,
            enabled: skill.enabled !== false,
            editable: skill.scope !== "builtin",
            hooks,
            skillName: skill.name,
            provenance: discovered.provenance || {},
          });
        }
        jsonResponse(res, { profiles });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/hook-profiles", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const saved = await saveCustomHookProfile(
          body,
          currentProjectDir || process.cwd(),
        );
        await bridge.reloadCommandsAndSkills().catch(() => null);
        jsonResponse(res, { ok: true, profile: saved });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.put("/api/hook-profiles", nodeRoute(async (req, res, url) => {
      try {
        const profile = await readBody(req);
        const cwd = currentProjectDir || process.cwd();
        let saved = null;
        if (profile?.kind === "workspace") {
          if (profile.activation === "always")
            await saveGlobalHooks(profile.hooks || {});
          else
            await saveProjectHooks(
              cwd,
              profile.hooks || {},
              profile.activation,
            );
          saved = profile;
        } else if (profile?.kind === "skill") {
          const entries = await listSkillEntries({ scope: "all", cwd });
          const skill = entries.find((item) => item.name === profile.skillName);
          if (!skill || skill.scope === "builtin")
            throw new Error("Skill hook profile is not editable");
          await writeSkillHooksJson(
            path.dirname(skill.path),
            profile.hooks || {},
          );
          saved = profile;
        } else if (profile?.kind === "package") {
          const existing = (await listCustomHookProfiles(cwd)).find(
            (item) => item.id === profile.id && item.kind === "package",
          );
          if (!existing) throw new Error("Package hook profile not found");
          saved = await savePackageHookProfile(
            {
              ...existing,
              enabled: profile.enabled !== false,
              activation: profile.activation || existing.activation,
            },
            cwd,
          );
        } else {
          if (
            profile?.originalScope &&
            profile.originalScope !== profile.scope
          ) {
            await deleteCustomHookProfile(
              { id: profile.id, scope: profile.originalScope },
              cwd,
            );
          }
          saved = await saveCustomHookProfile(profile, cwd);
        }
        await bridge.reloadCommandsAndSkills().catch(() => null);
        jsonResponse(res, { ok: true, profile: saved });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.delete("/api/hook-profiles", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const cwd = currentProjectDir || process.cwd();
        if (body?.kind === "workspace") {
          if (body.activation === "always") await saveGlobalHooks({});
          else await saveProjectHooks(cwd, {}, body.activation);
        } else if (body?.kind === "skill") {
          const entries = await listSkillEntries({ scope: "all", cwd });
          const skill = entries.find(
            (item) =>
              item.name === body.skillName &&
              (!body.projectDir || item.projectDir === body.projectDir),
          );
          if (!skill || skill.scope === "builtin")
            throw new Error("Skill hook profile is not deletable");
          await disableSkillHooks(path.dirname(skill.path));
        } else {
          await deleteCustomHookProfile(body || {}, cwd);
        }
        await bridge.reloadCommandsAndSkills().catch(() => null);
        jsonResponse(res, { ok: true });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 400);
      }
      return;

  }));
  routes.put("/api/hooks", nodeRoute(async (req, res, url) => {
      try {
        const body = await readBody(req);
        const scope =
          body?.scope === "global"
            ? "global"
            : body?.scope === "daily"
              ? "daily"
              : "coding";
        const hooks =
          body?.hooks && typeof body.hooks === "object" ? body.hooks : {};
        const saved =
          scope === "global"
            ? await saveGlobalHooks(hooks)
            : await saveProjectHooks(
                currentProjectDir || process.cwd(),
                hooks,
                scope,
              );
        if (typeof bridge?.reloadCommandsAndSkills === "function") {
          await bridge.reloadCommandsAndSkills().catch(() => null);
        }
        jsonResponse(res, { ok: true, scope, hooks: saved });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.get("/api/souls", nodeRoute(async (req, res, url) => {
      try {
        const config = await loadConfig();
        jsonResponse(res, await listSouls(config));
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));
  routes.post("/api/souls/create", nodeRoute(async (req, res, url) => {
      const {
        name: rawName,
        content: soulContent,
        category,
      } = await readBody(req);
      if (!rawName || !soulContent) {
        jsonResponse(
          res,
          { error: true, message: "Missing name or content" },
          400,
        );
        return;
      }
      try {
        jsonResponse(
          res,
          await createSoul({ name: rawName, content: soulContent, category }),
        );
      } catch (err) {
        const status = /conflict|already exists|Invalid/i.test(err.message)
          ? 409
          : 500;
        jsonResponse(res, { error: true, message: err.message }, status);
      }
      return;

  }));
  routes.post("/api/souls/activate", nodeRoute(async (req, res, url) => {
      if (bridge.isBusy()) {
        jsonResponse(res, { error: true, message: "Runtime is busy" }, 409);
        return;
      }
      const { name: sname, category } = await readBody(req);
      if (!sname) {
        jsonResponse(res, { error: true, message: "Missing name" }, 400);
        return;
      }
      try {
        const soul = await readSoulContent(sname, { preferCategory: category });
        const resolvedCategory = normalizeSoulCategory(
          category || soul.category,
          soul.category,
        );
        const config = await loadConfig();
        config.soul = config.soul || {};
        config.soul[resolvedCategory] = soul.name;
        config.soul.custom_path = "";
        // Keep legacy preset in sync for older readers.
        config.soul.preset = getActiveSoulName(config, resolvedCategory);
        await saveConfig(config);
        jsonResponse(res, {
          ok: true,
          category: resolvedCategory,
          name: soul.name,
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;

  }));

  const handleRequest = async (req, res) => {
    const url = new URL(req.url, `http://localhost:${args.port}`);

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (await runtimeApi(req, res)) return;
    if (await dispatchNodeRouter(routes, req, res)) return;
    // SSE
    // Handled by the global runtime API broker above.

    const attachmentFileMatch = url.pathname.match(
      /^\/api\/attachments\/([^/]+)\/([^/]+)\/file$/,
    );
    if (req.method === "GET" && attachmentFileMatch) {
      try {
        const sessionId = decodeURIComponent(attachmentFileMatch[1]);
        const id = decodeURIComponent(attachmentFileMatch[2]);
        let meta = loadAttachmentMetadata(sessionId, id);
        if (!meta) {
          meta = JSON.parse(
            await fs.readFile(attachmentMetaPath(sessionId, id), "utf8"),
          );
          if (meta?.path) saveAttachmentMetadata(sessionId, meta);
        }
        const filePath = path.resolve(meta.path || "");
        const uploadRoot = path.resolve(ATTACHMENT_UPLOAD_DIR);
        if (!isPathInside(uploadRoot, filePath)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        const contentType =
          meta.mime || MIME_TYPES[ext] || "application/octet-stream";
        const data = await fs.readFile(filePath);
        res.writeHead(200, {
          "Content-Type": contentType,
          "Content-Length": data.length,
          "Cache-Control": "private, max-age=86400",
        });
        res.end(data);
      } catch {
        jsonResponse(
          res,
          { error: true, message: "Attachment not found" },
          404,
        );
      }
      return;
    }

    // Static files
    if (req.method === "GET" && !url.pathname.startsWith("/api/")) {
      let filePath;
      if (url.pathname === "/") {
        filePath = path.join(CLIENT_DIR, "index.html");
      } else {
        const relative = url.pathname.replace(/^\//, "");
        filePath = path.extname(relative)
          ? path.join(CLIENT_DIR, relative)
          : path.join(CLIENT_DIR, "index.html");
      }
      if (!filePath.startsWith(CLIENT_DIR)) {
        res.writeHead(403);
        res.end();
        return;
      }
      await serveStatic(res, filePath, req);
      return;
    }

    // ── Version ──





    // ── CodeWiki / project requirements reports ──




    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/codewiki/report/")
    ) {
      const fileName = decodeURIComponent(
        url.pathname.slice("/api/codewiki/report/".length),
      );
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: "Invalid report file" }, 400);
        return;
      }
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(
        url,
        currentProjectDir,
      );
      const requirementsDir = path.resolve(
        getRequirementsDir(codeWikiProjectDir),
      );
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: "Invalid report path" }, 403);
        return;
      }
      if (codeWikiReportFormat(fileName) === "html") {
        try {
          const raw = await fs.readFile(reportPath, "utf8");
          const html = injectCodeWikiReportTheme(raw);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
          });
          res.end(html);
        } catch (err) {
          if (err?.code === "ENOENT")
            jsonResponse(
              res,
              { error: true, message: "Report not found" },
              404,
            );
          else jsonResponse(res, { error: true, message: err.message }, 500);
        }
        return;
      }
      await serveStatic(res, reportPath, req);
      return;
    }

    if (
      req.method === "DELETE" &&
      url.pathname.startsWith("/api/codewiki/report/")
    ) {
      const fileName = decodeURIComponent(
        url.pathname.slice("/api/codewiki/report/".length),
      );
      if (!isCodeWikiReportFile(fileName)) {
        jsonResponse(res, { error: true, message: "Invalid report file" }, 400);
        return;
      }
      const codeWikiProjectDir = await resolveCodeWikiProjectDir(
        url,
        currentProjectDir,
      );
      const requirementsDir = path.resolve(
        getRequirementsDir(codeWikiProjectDir),
      );
      const reportPath = path.resolve(requirementsDir, fileName);
      if (!reportPath.startsWith(`${requirementsDir}${path.sep}`)) {
        jsonResponse(res, { error: true, message: "Invalid report path" }, 403);
        return;
      }
      try {
        await fs.unlink(reportPath);
        jsonResponse(res, { ok: true, file: fileName });
      } catch (err) {
        if (err?.code === "ENOENT")
          jsonResponse(res, { error: true, message: "Report not found" }, 404);
        else jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }





    // ── Project management ──



    // ── Project terminal (persistent PTY) ──



























    // ── Config management ──







    if (req.method === "GET" && url.pathname.startsWith("/api/config/get/")) {
      const key = url.pathname.slice("/api/config/get/".length);
      const value = await getConfigValue(key);
      jsonResponse(res, { key, value });
      return;
    }

    // ── MCP server management ──



    if (
      req.method === "DELETE" &&
      url.pathname.startsWith("/api/mcp/servers/")
    ) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/mcp/servers/".length),
      );
      if (!id) {
        jsonResponse(
          res,
          { error: true, message: "Missing MCP server id" },
          400,
        );
        return;
      }
      try {
        const config = await loadConfig();
        config.mcp = config.mcp || {};
        const servers = Array.isArray(config.mcp.servers)
          ? config.mcp.servers
          : [];
        config.mcp.servers = servers.filter(
          (item) => String(item?.id || "").trim() !== id,
        );
        await saveConfig(config);
        await closeMcpClient(id);
        await pool.reloadConfig();
        jsonResponse(res, { ok: true, id });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Web UI active projects (stored in global config.json) ──



    // ── Memory management ──


    if (
      req.method === "DELETE" &&
      url.pathname.startsWith("/api/memory/inbox/")
    ) {
      const id = decodeURIComponent(
        url.pathname.slice("/api/memory/inbox/".length),
      );
      if (!id) {
        jsonResponse(res, { error: true, message: "Missing inbox id" }, 400);
        return;
      }
      try {
        const entry = (await listInbox()).find((item) => item.id === id);
        if (!entry) {
          jsonResponse(
            res,
            { error: true, message: "Inbox entry not found" },
            404,
          );
          return;
        }
        const archived = await archiveEntry(
          entry,
          "user-discarded",
          "Discarded from Web UI",
        );
        jsonResponse(res, { ok: true, id, archivedAt: archived.archivedAt });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/api/memory/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/memory/".length));
      const scope = normalizeMemoryScope(url.searchParams.get("scope"));
      if (!id) {
        jsonResponse(res, { error: true, message: "Missing memory id" }, 400);
        return;
      }
      try {
        const workspaceRoot =
          scope === "project"
            ? await resolveRequestProjectDir(
                url.searchParams.get("projectDir"),
                currentProjectDir,
              )
            : currentProjectDir;
        const result = await forgetMemory({ scope, id, workspaceRoot });
        jsonResponse(res, { ok: true, scope, ...result });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Deep Research ──


    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/research/sessions/") &&
      url.pathname.endsWith("/stream")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length, -"/stream".length),
      );
      subscribeResearchRun(sessionId, res);
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/research/sessions/") &&
      url.pathname.endsWith("/run")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length, -"/run".length),
      );
      try {
        const body = await readBody(req);
        const config = await loadConfig();
        jsonResponse(
          res,
          await startResearchRunForApi(sessionId, {
            phase: body?.phase,
            userPrompt: body?.userPrompt,
            model: body?.model,
            config,
            workspaceRoot: currentProjectDir || process.cwd(),
          }),
        );
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to start research run",
          },
          400,
        );
      }
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/research/sessions/") &&
      url.pathname.endsWith("/abort")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length, -"/abort".length),
      );
      jsonResponse(res, abortResearchSessionForApi(sessionId));
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/research/sessions/") &&
      url.pathname.endsWith("/confirm-plan")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice(
          "/api/research/sessions/".length,
          -"/confirm-plan".length,
        ),
      );
      try {
        const body = await readBody(req);
        jsonResponse(res, confirmResearchPlanForApi(sessionId, body || {}));
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to confirm plan" },
          400,
        );
      }
      return;
    }
    if (
      req.method === "PATCH" &&
      url.pathname.startsWith("/api/research/sessions/") &&
      url.pathname.endsWith("/plan")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length, -"/plan".length),
      );
      try {
        const body = await readBody(req);
        jsonResponse(res, updateResearchPlanForApi(sessionId, body || {}));
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to update plan" },
          400,
        );
      }
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/research/sessions/")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length),
      );
      if (!sessionId.includes("/")) {
        const payload = getResearchSessionForApi(sessionId);
        if (!payload)
          jsonResponse(res, { error: true, message: "Not found" }, 404);
        else jsonResponse(res, payload);
        return;
      }
    }
    if (
      req.method === "DELETE" &&
      url.pathname.startsWith("/api/research/sessions/")
    ) {
      const sessionId = decodeURIComponent(
        url.pathname.slice("/api/research/sessions/".length),
      );
      if (!sessionId.includes("/")) {
        try {
          jsonResponse(res, deleteResearchSessionForApi(sessionId));
        } catch (error) {
          jsonResponse(
            res,
            { error: true, message: error?.message || "Failed to delete" },
            404,
          );
        }
        return;
      }
    }

    // ── Scrapbook ──





    if (
      req.method === "POST" &&
      /^\/api\/scrapbook\/entries\/[^/]+\/sources$/.test(url.pathname)
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/entries/".length,
          -"/sources".length,
        ),
      );
      try {
        const body = await readBody(req);
        const result = addScrapbookSource(entryId, body || {});
        const job = startScrapbookSummaryJob(entryId);
        jsonResponse(res, { ok: true, ...result, job });
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to add source" },
          400,
        );
      }
      return;
    }
    if (
      req.method === "POST" &&
      /^\/api\/scrapbook\/entries\/[^/]+\/sources\/upload$/.test(url.pathname)
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/entries/".length,
          -"/sources/upload".length,
        ),
      );
      try {
        const form = await readMultipartForm(req);
        const files = form
          .getAll("files")
          .filter((item) => item && typeof item.arrayBuffer === "function");
        if (!files.length) throw new Error("Missing source file");
        const sources = [];
        for (const file of files) {
          if (Number(file.size || 0) > 20 * 1024 * 1024) {
            throw new Error(`${file.name || "File"} exceeds the 20 MB limit`);
          }
          const name = safeUploadFileName(file.name || "source");
          const ext = path.extname(name).toLowerCase();
          if (![".pdf", ".docx", ".txt", ".md", ".markdown"].includes(ext)) {
            throw new Error(
              "Unsupported source type. Use PDF, DOCX, TXT, or Markdown.",
            );
          }
          const buffer = Buffer.from(await file.arrayBuffer());
          const contentText = [".txt", ".md", ".markdown"].includes(ext)
            ? buffer.toString("utf8").trim()
            : await extractAttachmentText(buffer, ext);
          if (!contentText)
            throw new Error(`No readable text found in ${name}`);
          const result = addScrapbookSource(entryId, {
            type: "file",
            name,
            mime: String(file.type || "application/octet-stream"),
            contentText,
          });
          sources.push(result.source);
        }
        const job = startScrapbookSummaryJob(entryId);
        jsonResponse(res, {
          ok: true,
          sources,
          entry: getScrapbookEntryForApi(entryId),
          job,
        });
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to upload source" },
          400,
        );
      }
      return;
    }
    if (
      req.method === "POST" &&
      /^\/api\/scrapbook\/entries\/[^/]+\/sources\/selection$/.test(
        url.pathname,
      )
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/entries/".length,
          -"/sources/selection".length,
        ),
      );
      try {
        const body = await readBody(req);
        const entry = setScrapbookSourceSelection(
          entryId,
          body?.selectedSourceIds,
        );
        const job = startScrapbookSummaryJob(entryId);
        jsonResponse(res, { ok: true, entry, job });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to update sources",
          },
          400,
        );
      }
      return;
    }
    if (
      req.method === "DELETE" &&
      /^\/api\/scrapbook\/entries\/[^/]+\/sources\/[^/]+$/.test(url.pathname)
    ) {
      const match = url.pathname.match(
        /^\/api\/scrapbook\/entries\/([^/]+)\/sources\/([^/]+)$/,
      );
      try {
        const entryId = decodeURIComponent(match[1]);
        const sourceId = decodeURIComponent(match[2]);
        const entry = removeScrapbookSource(entryId, sourceId);
        const job = entry.sources.length
          ? startScrapbookSummaryJob(entryId)
          : null;
        jsonResponse(res, { ok: true, entry, job });
      } catch (error) {
        jsonResponse(
          res,
          { error: true, message: error?.message || "Failed to remove source" },
          400,
        );
      }
      return;
    }
    if (
      req.method === "POST" &&
      /^\/api\/scrapbook\/entries\/[^/]+\/artifacts\/(mindmap|report)$/.test(
        url.pathname,
      )
    ) {
      const match = url.pathname.match(
        /^\/api\/scrapbook\/entries\/([^/]+)\/artifacts\/(mindmap|report)$/,
      );
      try {
        const result = await generateScrapbookArtifact(
          decodeURIComponent(match[1]),
          match[2],
        );
        jsonResponse(res, { ok: true, ...result });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to generate artifact",
          },
          400,
        );
      }
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/scrapbook/entries/")
    ) {
      const askSuffix = "/ask-payload";
      const summarizeSuffix = "/summarize";
      if (
        url.pathname.endsWith(askSuffix) ||
        url.pathname.endsWith(summarizeSuffix)
      ) {
        // handled below
      } else {
        const entryId = decodeURIComponent(
          url.pathname.slice("/api/scrapbook/entries/".length),
        );
        const entry = getScrapbookEntryForApi(entryId);
        if (!entry)
          jsonResponse(
            res,
            { error: true, message: "Scrapbook entry not found" },
            404,
          );
        else jsonResponse(res, { ok: true, entry });
        return;
      }
    }
    if (
      req.method === "DELETE" &&
      url.pathname.startsWith("/api/scrapbook/entries/")
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice("/api/scrapbook/entries/".length),
      );
      const result = deleteScrapbookEntryForApi(entryId);
      if (!result.ok)
        jsonResponse(
          res,
          { error: true, message: "Scrapbook entry not found" },
          404,
        );
      else jsonResponse(res, result);
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/scrapbook/entries/") &&
      url.pathname.endsWith("/summarize")
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/entries/".length,
          -"/summarize".length,
        ),
      );
      try {
        jsonResponse(res, { ok: true, job: startScrapbookSummaryJob(entryId) });
      } catch (error) {
        jsonResponse(
          res,
          {
            error: true,
            message: error?.message || "Failed to summarize scrapbook entry",
          },
          400,
        );
      }
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/scrapbook/entries/") &&
      url.pathname.endsWith("/ask-payload")
    ) {
      const entryId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/entries/".length,
          -"/ask-payload".length,
        ),
      );
      try {
        jsonResponse(res, {
          ok: true,
          payload: buildScrapbookAskPayload(entryId),
        });
      } catch (error) {
        const status = error?.code === "SCRAPBOOK_SUMMARY_IN_PROGRESS" ? 409 : 400;
        jsonResponse(
          res,
          {
            error: true,
            code: error?.code || "SCRAPBOOK_ASK_FAILED",
            message: error?.message || "Failed to prepare scrapbook payload",
          },
          status,
        );
      }
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/scrapbook/summary-jobs/") &&
      url.pathname.endsWith("/stream")
    ) {
      const jobId = decodeURIComponent(
        url.pathname.slice(
          "/api/scrapbook/summary-jobs/".length,
          -"/stream".length,
        ),
      );
      const job = getScrapbookSummaryJobForApi(jobId);
      if (!job)
        jsonResponse(
          res,
          { error: true, message: "Scrapbook summary job not found" },
          404,
        );
      else subscribeScrapbookSummaryJob(jobId, res);
      return;
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/scrapbook/summary-jobs/")
    ) {
      const jobId = decodeURIComponent(
        url.pathname.slice("/api/scrapbook/summary-jobs/".length),
      );
      const job = getScrapbookSummaryJobForApi(jobId);
      if (!job)
        jsonResponse(
          res,
          { error: true, message: "Scrapbook summary job not found" },
          404,
        );
      else jsonResponse(res, { ok: true, job });
      return;
    }

    // ── Skills management ──


    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/content")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/content".length),
      );
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        const content = await fs.readFile(skill.path, "utf8");
        jsonResponse(res, { name: skill.name, content });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }





    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/content")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/content".length),
      );
      const { content } = await readBody(req);
      if (!content) {
        jsonResponse(res, { error: true, message: "Missing content" }, 400);
        return;
      }
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        if (skill.scope === "builtin") {
          jsonResponse(
            res,
            { error: true, message: "Cannot edit builtin skill" },
            403,
          );
          return;
        }
        if (canUpdateSkillPackage(skill)) {
          jsonResponse(
            res,
            {
              error: true,
              message: "Cannot edit remote package skill content",
            },
            403,
          );
          return;
        }
        await fs.writeFile(skill.path, content, "utf8");
        const markdownPatch = metadataPatchFromSkillMarkdown(content);
        if (Object.keys(markdownPatch).length > 0) {
          await upsertSkillRegistryEntry(undefined, {
            name,
            ...(markdownPatch.description !== undefined
              ? { description: markdownPatch.description }
              : {}),
            ...(markdownPatch.enabled !== undefined
              ? { enabled: markdownPatch.enabled }
              : {}),
            sha256: await computeFileSha256(skill.path),
          });
          await upsertSkillCatalogMetadata(getSkillsDir(), name, markdownPatch);
        } else {
          await upsertSkillRegistryEntry(undefined, {
            name,
            sha256: await computeFileSha256(skill.path),
          });
        }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/skills/")) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length),
      );
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        if (skill.scope === "builtin") {
          jsonResponse(
            res,
            { error: true, message: "Cannot delete builtin skill" },
            403,
          );
          return;
        }
        await fs.rm(path.join(getSkillsDir(), name), {
          recursive: true,
          force: true,
        });
        const registry = await readSkillRegistry();
        registry.skills = (registry.skills || []).filter(
          (s) => s.name !== name,
        );
        await writeSkillRegistry(undefined, registry);
        await deleteSkillCatalogMetadata(getSkillsDir(), name);
        const config = await loadConfig();
        if (config.skills?.enabled) delete config.skills.enabled[name];
        if (config.skills?.contexts) delete config.skills.contexts[name];
        await saveConfig(config);
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/metadata")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/metadata".length),
      );
      const body = await readBody(req);
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        const routingLocked =
          canUpdateSkillPackage(skill) && skill.routingAuthorLocked === true;
        const requestedPatch = normalizeSkillMetadataPatch(body || {});
        if (routingLocked) {
          const blocked = Object.keys(requestedPatch).filter((key) =>
            AUTHOR_LOCKED_ROUTING_KEYS.has(key),
          );
          if (blocked.length > 0) {
            jsonResponse(
              res,
              {
                error: true,
                message:
                  "Remote skill routing is locked to the package author frontmatter",
              },
              403,
            );
            return;
          }
        }
        const normalizedPatch = requestedPatch;
        const contexts = normalizedPatch.contexts;
        const metadataPatch = { ...normalizedPatch };
        delete metadataPatch.contexts;
        let metadata = metadataPatch;
        if (
          skill.scope === "builtin" &&
          Object.keys(metadataPatch).length > 0
        ) {
          jsonResponse(
            res,
            { error: true, message: "Cannot edit builtin skill metadata" },
            403,
          );
          return;
        }
        if (skill.scope !== "builtin") {
          await upsertSkillRegistryEntry(undefined, {
            name,
            ...(metadataPatch.description !== undefined
              ? { description: metadataPatch.description }
              : {}),
            ...(metadataPatch.enabled !== undefined
              ? { enabled: metadataPatch.enabled }
              : {}),
          });
          metadata = await upsertSkillCatalogMetadata(
            getSkillsDir(),
            name,
            body || {},
          );
        }
        if (
          skill.scope !== "builtin" &&
          Object.keys(metadataPatch).length > 0
        ) {
          const skillPath = path.join(getSkillsDir(), name, "SKILL.md");
          const currentContent = await fs.readFile(skillPath, "utf8");
          const nextContent = patchSkillMarkdownMetadata(
            currentContent,
            metadataPatch,
            name,
          );
          if (nextContent !== currentContent) {
            await fs.writeFile(skillPath, nextContent, "utf8");
          }
          await upsertSkillRegistryEntry(undefined, {
            name,
            sha256: await computeFileSha256(skillPath),
          });
        }
        if (skill.scope !== "builtin" && body?.enabled !== undefined) {
          const config = await loadConfig();
          config.skills = config.skills || {};
          config.skills.enabled = config.skills.enabled || {};
          config.skills.enabled[name] = body.enabled !== false;
          await saveConfig(config);
          const registry = await readSkillRegistry();
          const idx = registry.skills.findIndex((s) => s.name === name);
          if (idx !== -1) {
            registry.skills[idx].enabled = body.enabled !== false;
            await writeSkillRegistry(undefined, registry);
          }
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
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (
      req.method === "POST" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/toggle")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/toggle".length),
      );
      const { enabled } = await readBody(req);
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        const config = await loadConfig();
        config.skills = config.skills || {};
        config.skills.enabled = config.skills.enabled || {};
        config.skills.enabled[name] = !!enabled;
        await saveConfig(config);
        const registry = await readSkillRegistry();
        const idx = registry.skills.findIndex((s) => s.name === name);
        if (idx !== -1) {
          registry.skills[idx].enabled = !!enabled;
          await writeSkillRegistry(undefined, registry);
        }
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }






    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/hooks")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/hooks".length),
      );
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        const skillRoot = path.dirname(skill.path);
        const discovered = await discoverSkillHooks({ skillRoot });
        const editableHooks = await readHooksJsonRaw(
          path.join(skillRoot, "hooks", "hooks.json"),
        );
        jsonResponse(res, {
          name,
          hooks:
            Object.keys(editableHooks).length > 0
              ? editableHooks
              : discovered.hooks,
          provenance: discovered.provenance,
          disableModelInvocation: discovered.disableModelInvocation === true,
        });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }
    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/skills/") &&
      url.pathname.endsWith("/hooks")
    ) {
      const name = decodeURIComponent(
        url.pathname.slice("/api/skills/".length, -"/hooks".length),
      );
      const { hooks } = await readBody(req);
      try {
        const entries = await listSkillEntries({
          scope: "all",
          cwd: currentProjectDir,
        });
        const skill = entries.find((s) => s.name === name);
        if (!skill) {
          jsonResponse(res, { error: true, message: "Skill not found" }, 404);
          return;
        }
        if (skill.scope === "builtin") {
          jsonResponse(
            res,
            { error: true, message: "Cannot edit builtin skill" },
            403,
          );
          return;
        }
        const skillRoot = path.dirname(skill.path);
        const normalizedHooks = await writeSkillHooksJson(
          skillRoot,
          hooks || {},
        );
        await bridge.reloadConfig();
        await bridge.reloadCommandsAndSkills();
        jsonResponse(res, { ok: true, name, hooks: normalizedHooks });
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    // ── Souls management ──

    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/souls/") &&
      url.pathname.endsWith("/content")
    ) {
      const sname = decodeURIComponent(
        url.pathname.slice("/api/souls/".length, -"/content".length),
      );
      try {
        jsonResponse(res, await readSoulContent(sname));
      } catch (err) {
        jsonResponse(res, { error: true, message: err.message }, 500);
      }
      return;
    }

    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/souls/") &&
      url.pathname.endsWith("/content")
    ) {
      const sname = decodeURIComponent(
        url.pathname.slice("/api/souls/".length, -"/content".length),
      );
      const { content: soulContent } = await readBody(req);
      try {
        jsonResponse(res, await updateSoulContent(sname, soulContent));
      } catch (err) {
        const status = /not found/i.test(err.message) ? 404 : 500;
        jsonResponse(res, { error: true, message: err.message }, status);
      }
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/souls/")) {
      const sname = decodeURIComponent(
        url.pathname.slice("/api/souls/".length),
      );
      try {
        await deleteSoul(sname);
        const config = await loadConfig();
        config.soul = config.soul || {};
        if (
          soulNameEquals(config.soul.coding, sname) ||
          soulNameEquals(config.soul.preset, sname)
        ) {
          config.soul.coding = "Default";
        }
        if (soulNameEquals(config.soul.daily, sname)) {
          config.soul.daily = "Playful";
        }
        await saveConfig(config);
        jsonResponse(res, { ok: true });
      } catch (err) {
        const status = /Cannot delete/i.test(err.message)
          ? 403
          : /not found/i.test(err.message)
            ? 404
            : 500;
        jsonResponse(res, { error: true, message: err.message }, status);
      }
      return;
    }


    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  };

  const app = new Hono();
  app.all("*", async (context) => {
    await handleRequest(context.env.incoming, context.env.outgoing);
    return new Response(null, {
      headers: { "x-hono-already-sent": "true" },
    });
  });
  const server = serve(
    { fetch: app.fetch, port: args.port, hostname: args.host, overrideGlobalObjects: false },
    () => {
    const displayHost = args.host === "0.0.0.0" ? "localhost" : args.host;
    console.log(
      `\n  Codemini Web UI\n  http://${displayHost}:${args.port}\n  Project: ${currentProjectDir}\n`,
    );
    if (!args.open) return;
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    import("node:child_process").then(({ exec }) => {
      exec(`${openCmd} http://localhost:${args.port}`, (err) => {
        if (err) console.log("  Could not auto-open browser.");
      });
    });
    },
  );

  const cleanup = createServerCleanup({
    runtimeEvictionTimer,
    pool,
    runtimeStatusStore,
    server,
  });
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

const isDirectRun = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) {
  main().catch((err) => {
    console.error("Failed to start:", err);
    process.exit(1);
  });
}
