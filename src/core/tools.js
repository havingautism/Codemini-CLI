import fs from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { rgPath } from "@vscode/ripgrep";
import net from "node:net";
import { escapeRegex, normalizePath } from "./string-utils.js";
import {
  classifyCommandIntent,
  hasReadyOutput,
  isDangerousCommand,
  isLikelyLongRunningCommand,
  resolveShell,
  runShellCommand,
  terminateChild,
} from "./shell.js";
import { evaluateCommandPolicy } from "./command-policy.js";
import {
  findEnclosingSymbol,
  queryAst,
  queryAstGrep,
  readAstNode,
  resolveAstTarget,
} from "./ast.js";
import {
  initializeProjectIndex,
  queryProjectIndex,
  refreshIndexedFile,
} from "./project-index.js";
import { checkReadDedup } from "./tool-result-store.js";
import {
  TOOL_SKIP_DIRS as SKIP_DIRS,
  TEXT_EXTENSIONS,
  CODE_WRITE_GUARD_EXTENSIONS,
  LANGUAGE_FILE_TYPES,
} from "./constants.js";
import {
  globFilePathsByPattern,
  globFilesUnder,
  globWorkspaceEntriesUnder,
} from "./workspace-glob.js";
import {
  sha256Prefixed as sha256,
  sha256 as sha256Hash,
} from "./crypto-utils.js";
import {
  forgetMemory,
  listMemories,
  rememberMemory,
  searchMemories,
  captureToInbox,
} from "./memory-store.js";
import { runDreamConsolidation } from "./dream-consolidate.js";
import { normalizePlanState } from "./plan-state.js";
import { normalizeTodos } from "./todo-state.js";
import { normalizeAssumptionItems } from "./tool-args-helpers.js";
import { createFffAdapter } from "./fff-adapter.js";
import {
  isSkillIndexEligible,
  loadIndexedSkills,
  renderCommandPrompt,
} from "./command-loader.js";
import {
  getToolOutputSanitizeOptions,
  sanitizePreviewLines,
  sanitizeTextForModel,
  buildRunFailureMessage,
  summarizeRunOutput,
} from "./tool-output.js";
import {
  normalizeFilePathValue,
  normalizePathArgs,
  parseInlineRangePath,
  normalizePatternArgs,
  normalizeReadArgs,
  normalizeWebFetchArgs,
  normalizeWebSearchArgs,
  normalizeWriteArgs,
} from "./tool-args.js";
const BACKGROUND_TASK_RECENT_OUTPUT_LIMIT = 80;
const BACKGROUND_TASK_POLL_MS = 150;
const MAX_AST_ENCLOSING_BYTES = 300_000;
const MAX_AST_ENCLOSING_LINES = 5_000;
const SKILL_ALIASES = new Map([
  ["superpowers-lite", "using-superpowers"],
  ["superpowers", "using-superpowers"],
  ["brainstorm", "brainstorming"],
]);
const RUN_COMMAND_SAFE_MODE_APPROVED = Symbol("runCommandSafeModeApproved");
const backgroundTaskRegistry = new Map();
let backgroundTaskCounter = 0;
let backgroundTaskLogCursorCounter = 0;

export function markRunCommandSafeModeApproved(args = {}) {
  const next = { ...(args && typeof args === "object" ? args : {}) };
  Object.defineProperty(next, RUN_COMMAND_SAFE_MODE_APPROVED, {
    value: true,
    enumerable: false,
  });
  return next;
}

export function hasRunCommandSafeModeApproval(args = {}) {
  return Boolean(args?.[RUN_COMMAND_SAFE_MODE_APPROVED]);
}

async function realpathIfExists(targetPath) {
  try {
    return await fs.realpath(targetPath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function isWithinResolvedRoot(resolvedRoot, candidatePath) {
  const relative = path.relative(resolvedRoot, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function getAllowedRealRoots(root, config = {}) {
  const roots = [
    root,
    ...(Array.isArray(config?.policy?.allowed_paths)
      ? config.policy.allowed_paths
      : []),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const out = [];
  for (const item of roots) {
    try {
      out.push(await fs.realpath(path.resolve(item)));
    } catch {
      continue;
    }
  }
  return out;
}

function isWithinAnyResolvedRoot(roots, candidatePath) {
  return roots.some((resolvedRoot) =>
    isWithinResolvedRoot(resolvedRoot, candidatePath),
  );
}

function resolvesOutsideRoot(root, targetPath = ".") {
  const text = String(targetPath || "").trim();
  if (!text || text === ".") return false;
  return !isWithinResolvedRoot(path.resolve(root), path.resolve(root, text));
}

async function resolveInWorkspace(root, targetPath = ".", config = {}) {
  const absRoot = path.resolve(root);
  const realRoots = await getAllowedRealRoots(absRoot, config);
  if (realRoots.length === 0) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  const absTarget = path.resolve(absRoot, targetPath);
  const realTarget = await realpathIfExists(absTarget);
  if (realTarget) {
    if (!isWithinAnyResolvedRoot(realRoots, realTarget)) {
      throw new Error(`Path escapes workspace: ${targetPath}`);
    }
    const linkStat = await fs.lstat(absTarget);
    return linkStat.isSymbolicLink() ? realTarget : absTarget;
  }

  let probe = path.dirname(absTarget);
  while (!(await realpathIfExists(probe))) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }

  const resolvedProbe = await realpathIfExists(probe);
  if (!resolvedProbe) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }

  const resolvedTarget = path.join(
    resolvedProbe,
    path.relative(probe, absTarget),
  );
  if (!isWithinAnyResolvedRoot(realRoots, resolvedTarget)) {
    throw new Error(`Path escapes workspace: ${targetPath}`);
  }
  return absTarget;
}

async function getBackgroundTasksDir(root) {
  return path.join(await resolveInWorkspace(root, ".codemini"), "tasks");
}

function toWorkspaceRelative(root, absPath) {
  const roots = [path.resolve(root)];
  try {
    const realRoot = realpathSync(root);
    if (realRoot) roots.push(realRoot);
  } catch {}
  for (const candidateRoot of roots) {
    const relative = path.relative(candidateRoot, absPath);
    if (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    ) {
      return normalizePath(relative);
    }
  }
  return normalizePath(path.relative(path.resolve(root), absPath));
}

function trimLinePreview(line, maxLen = 180) {
  const text = String(line || "")
    .replace(/\t/g, "  ")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function splitLines(text) {
  return String(text || "").split("\n");
}

function stripLineCr(line) {
  return String(line || "").replace(/\r$/, "");
}

function splitLinesNormalized(text) {
  return String(text || "")
    .replace(/\r\n|\r/g, "\n")
    .split("\n");
}

function linesEqualNormalized(a, b) {
  return stripLineCr(a) === stripLineCr(b);
}

function joinFileLines(lines, eol = "\n") {
  if (!lines.length) return "";
  return lines.map((line) => stripLineCr(line)).join(eol);
}

function buildDiffPreview(beforeContent, afterContent) {
  const beforeLines = splitLines(beforeContent);
  const afterLines = splitLines(afterContent);
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let beforeEnd = beforeLines.length - 1;
  let afterEnd = afterLines.length - 1;
  while (
    beforeEnd >= prefix &&
    afterEnd >= prefix &&
    beforeLines[beforeEnd] === afterLines[afterEnd]
  ) {
    beforeEnd -= 1;
    afterEnd -= 1;
  }

  const lines = [];
  for (let i = prefix; i <= beforeEnd; i += 1) {
    lines.push(`-${i + 1}| ${beforeLines[i]}`);
  }
  for (let i = prefix; i <= afterEnd; i += 1) {
    lines.push(`+${i + 1}| ${afterLines[i]}`);
  }
  return lines.join("\n");
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function normalizeWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function semanticBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const text = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!text) return fallback;
  if (["true", "1", "yes", "y", "on"].includes(text)) return true;
  if (["false", "0", "no", "n", "off"].includes(text)) return false;
  return Boolean(value);
}

function trimPreview(value, maxLen = 300) {
  const text = normalizeWhitespace(value);
  if (text.length <= maxLen) return text;
  return `${text.slice(0, Math.max(0, maxLen - 3))}...`;
}

function normalizeSkillToolName(value) {
  const raw = String(value || "")
    .trim()
    .replace(/^\/+/, "");
  if (!raw) return "";
  const lower = raw.toLowerCase();
  return SKILL_ALIASES.get(lower) || raw;
}

function skillScopeFromSource(source = "") {
  if (source === "bundled-skill") return "builtin";
  if (source === "project-skill") return "project";
  if (source === "global-skill" || source === "registry-skill") return "global";
  return source || "unknown";
}

function isIndexedSkillEnabled(command, config = {}) {
  if (command?.metadata?.enabled === false) return false;
  const scope = skillScopeFromSource(command?.source);
  if (scope === "builtin") return true;
  return config?.skills?.enabled?.[command?.name] !== false;
}

function summarizeIndexedSkill(command) {
  return {
    name: command.name,
    description: command.metadata?.description || "",
    mode: command.metadata?.mode || "",
    scope: skillScopeFromSource(command.source),
    path: command.path,
    packageName: command.metadata?.packageName || "",
    packageSource:
      command.metadata?.packageSource || command.metadata?.source || "",
    enabled: command.metadata?.enabled !== false,
  };
}

function scoreIndexedSkillMatch(item, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return 0;
  const name = String(
    item?.summary?.name || item?.command?.name || "",
  ).toLowerCase();
  const desc = String(item?.summary?.description || "").toLowerCase();
  const triggers = Array.isArray(item?.command?.metadata?.triggers)
    ? item.command.metadata.triggers
        .map((entry) => String(entry || "").toLowerCase())
        .join(" ")
    : "";

  if (name === q) return 100;
  if (name.includes(q) || q.includes(name)) return 85;
  const tokens = q.split(/[\s\-_/|]+/).filter((token) => token.length >= 2);
  if (tokens.length === 0) return 0;
  let score = 0;
  for (const token of tokens) {
    if (name.includes(token)) score += 30;
    if (desc.includes(token)) score += 18;
    if (triggers.includes(token)) score += 22;
  }
  return score;
}

function searchIndexedSkills(allSkills, query, { limit = 10 } = {}) {
  return allSkills
    .map((item) => ({ item, score: scoreIndexedSkillMatch(item, query) }))
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        `${a.item.summary.scope}:${a.item.summary.name}`.localeCompare(
          `${b.item.summary.scope}:${b.item.summary.name}`,
        ),
    )
    .slice(0, limit)
    .map(({ item }) => item.summary);
}

const SKILL_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: "skill",
    description:
      'Search and load Codemini skills from the indexed skill registry/catalog. To browse skills, call skill({name:"list"}). To find a skill by keywords, call skill({query:"ts generic error"}) or skill({name:"fix-ts-generic-error"}). After you know the exact skill name, call skill({name:"<skill-name>"}) to load its instructions. Do NOT use grep, glob, or list on skills directories to discover skills.',
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            'Exact skill name, "list"/"all" to browse all indexed skills, or keywords to search the skill index',
        },
        query: {
          type: "string",
          description:
            "Search indexed skills by name/description keywords without loading one",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional positional arguments to substitute into the skill prompt",
        },
      },
    },
  },
};

function normalizeWebUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`Invalid URL: ${text}`);
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }
  return parsed.toString();
}

function extractHtmlMeta($, name, attribute = "content") {
  return String(
    $(`meta[name="${name}"]`).attr(attribute) ||
      $(`meta[property="${name}"]`).attr(attribute) ||
      "",
  ).trim();
}

function collectPageLinks($, pageUrl, maxLinks = 20) {
  const links = [];
  const seen = new Set();
  $("a[href]").each((_, element) => {
    if (links.length >= maxLinks) return false;
    const hrefRaw = String($(element).attr("href") || "").trim();
    if (!hrefRaw) return undefined;
    try {
      const href = new URL(hrefRaw, pageUrl).toString();
      if (seen.has(href)) return undefined;
      seen.add(href);
      links.push({
        href,
        text: trimPreview($(element).text(), 160),
      });
    } catch {
      return undefined;
    }
    return undefined;
  });
  return links;
}

function extractPageContent(
  cheerio,
  html,
  pageUrl,
  { maxLinks, status = null, contentType = "", fetchMode = "static" } = {},
) {
  const $ = cheerio.load(html);
  $("script, style, noscript").remove();
  const bodyText = $("body").text() || $.root().text();
  const text = String(bodyText || "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const title = trimPreview($("title").first().text(), 240);
  const description =
    extractHtmlMeta($, "description") || extractHtmlMeta($, "og:description");
  const links = collectPageLinks($, pageUrl, maxLinks);

  return {
    final_url: pageUrl,
    title,
    description,
    text,
    links,
    metadata: {
      status,
      fetched_at: new Date().toISOString(),
      content_type: contentType,
      fetch_mode: fetchMode,
      lang: String($("html").attr("lang") || "").trim(),
    },
  };
}

function shouldTryBrowserRender(html, text) {
  if (String(text || "").trim().length >= 120) return false;
  return (
    /<script\b/i.test(html) ||
    /id=["']__(?:next|nuxt)["']/i.test(html) ||
    /data-reactroot|ng-version|window\.__/i.test(html)
  );
}

function playwrightInstallHint() {
  return "For JavaScript-rendered pages, install Playwright for richer web_fetch results: npm install -g playwright && playwright install chromium";
}

async function loadOptionalPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    if (
      code === "ERR_MODULE_NOT_FOUND" ||
      /Cannot find package 'playwright'|Cannot find module 'playwright'/i.test(
        message,
      )
    ) {
      return null;
    }
    throw error;
  }
}

async function buildPlaywrightLaunchEnv() {
  const localLibDir = path.join(
    process.env.HOME || "",
    ".cache",
    "codemini",
    "playwright-libs",
    "usr",
    "lib",
    "x86_64-linux-gnu",
  );
  try {
    await fs.access(localLibDir);
  } catch {
    return process.env;
  }

  const existing = String(process.env.LD_LIBRARY_PATH || "").trim();
  return {
    ...process.env,
    LD_LIBRARY_PATH: existing ? `${localLibDir}:${existing}` : localLibDir,
  };
}

async function webFetchPage(args = {}) {
  const normalizedArgs = normalizeWebFetchArgs(args);
  const url = normalizeWebUrl(normalizedArgs.url);
  const timeoutMs = clampNumber(
    normalizedArgs.timeout_ms,
    1_000,
    120_000,
    20_000,
  );
  const maxLinks = clampNumber(normalizedArgs.max_links, 0, 100, 20);
  const waitUntil = ["domcontentloaded", "load", "networkidle"].includes(
    String(normalizedArgs.wait_until || "").trim(),
  )
    ? String(normalizedArgs.wait_until).trim()
    : "domcontentloaded";

  const cheerio = await import("cheerio");
  let staticResult = null;
  let staticHtml = "";
  let staticError = null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent": "CodeminiCLI/0.4 web_fetch",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    staticHtml = await response.text();
    staticResult = {
      url,
      ...extractPageContent(cheerio, staticHtml, response.url || url, {
        maxLinks,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        fetchMode: "static",
      }),
    };
    if (!shouldTryBrowserRender(staticHtml, staticResult.text)) {
      return staticResult;
    }
  } catch (error) {
    staticError = error;
  }

  const playwright = await loadOptionalPlaywright();
  if (!playwright) {
    if (staticResult) {
      return {
        ...staticResult,
        warnings: [playwrightInstallHint()],
      };
    }
    throw new Error(
      `web_fetch failed and browser rendering is unavailable. ${playwrightInstallHint()}. Static fetch error: ${staticError?.message || staticError}`,
    );
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({
      headless: true,
      env: await buildPlaywrightLaunchEnv(),
    });
    const page = await browser.newPage();
    const response = await page.goto(url, { waitUntil, timeout: timeoutMs });
    const finalUrl = page.url();
    const html = await page.content();
    const rendered = {
      url,
      ...extractPageContent(cheerio, html, finalUrl, {
        maxLinks,
        status: response?.status?.() ?? null,
        contentType: response?.headers?.()["content-type"] || "",
        fetchMode: "browser",
      }),
    };
    rendered.metadata.wait_until = waitUntil;
    rendered.title = rendered.title || trimPreview(await page.title(), 240);
    return rendered;
  } catch (error) {
    if (staticResult) {
      return {
        ...staticResult,
        warnings: [
          `Browser rendering fallback failed: ${error?.message || error}`,
        ],
      };
    }
    throw error;
  } finally {
    if (browser) await browser.close();
  }
}

async function webSearchQuery(config, args = {}) {
  if (config?.web?.search_enabled === false) {
    throw new Error(
      "web_search is disabled by config. Set web.search_enabled=true to enable network search.",
    );
  }

  const normalizedArgs = normalizeWebSearchArgs(args);
  const query = String(normalizedArgs.query || "").trim();
  if (!query) throw new Error("web_search requires query");

  const maxResults = clampNumber(normalizedArgs.max_results, 1, 20, 8);
  const locale =
    String(
      normalizedArgs.locale || config?.web?.search_locale || "en-US",
    ).trim() || "en-US";
  const region =
    String(
      normalizedArgs.region ||
        normalizedArgs.cc ||
        config?.web?.search_region ||
        (locale.toLowerCase().endsWith("-cn") ? "CN" : "US"),
    ).trim() || "US";
  const searchUrl = buildBingRssSearchUrl({
    baseUrl: config?.web?.search_base_url,
    query,
    locale,
    region,
  });
  const timeoutMs = clampNumber(
    normalizedArgs.timeout_ms || config?.web?.search_timeout_ms,
    1_000,
    60_000,
    15_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(searchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "CodeminiCLI/0.4 web_search",
        accept:
          "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
        "accept-language": `${locale},en;q=0.8`,
      },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(
      `web_search Bing RSS request failed: HTTP ${response.status}`,
    );
  }

  const xml = await response.text();
  const cheerio = await import("cheerio");
  const parsed = parseBingRssResults(cheerio, xml, maxResults);

  return {
    query,
    engine: "bing_rss",
    source_url: response.url || searchUrl,
    no_results: parsed.results.length === 0,
    results: parsed.results,
    related: [],
  };
}

function buildBingRssSearchUrl({ baseUrl, query, locale, region }) {
  const url = new URL(String(baseUrl || "https://cn.bing.com/search"));
  url.searchParams.set("q", query);
  url.searchParams.set("mkt", locale);
  url.searchParams.set("setlang", locale);
  url.searchParams.set("cc", region);
  url.searchParams.set("format", "rss");
  return url.toString();
}

function parseBingRssResults(cheerio, xml, maxResults) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const results = [];
  const seenUrls = new Set();
  $("item").each((_, element) => {
    if (results.length >= maxResults) return false;
    const title = normalizeWhitespace($(element).find("title").first().text());
    const url = normalizeSearchResultUrl(
      $(element).find("link").first().text(),
    );
    if (!title || !url || seenUrls.has(url)) return undefined;
    seenUrls.add(url);
    results.push({
      title,
      url,
      description: normalizeRssDescription(
        cheerio,
        $(element).find("description").first().text(),
      ),
      hostname: hostnameFromUrl(url),
      published_at: normalizeWhitespace(
        $(element).find("pubDate").first().text(),
      ),
    });
    return undefined;
  });
  return { results };
}

function normalizeSearchResultUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeRssDescription(cheerio, value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return normalizeWhitespace(cheerio.load(text).text() || text);
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function findUniqueLineBlock(lines, blockContent) {
  const probeLines = splitLinesNormalized(blockContent);
  if (
    probeLines.length === 0 ||
    (probeLines.length === 1 && probeLines[0] === "")
  )
    return null;
  const matches = [];
  const lastStart = lines.length - probeLines.length;
  for (let start = 0; start <= lastStart; start += 1) {
    let ok = true;
    for (let offset = 0; offset < probeLines.length; offset += 1) {
      if (!linesEqualNormalized(lines[start + offset], probeLines[offset])) {
        ok = false;
        break;
      }
    }
    if (ok) {
      const blockLines = lines.slice(start, start + probeLines.length);
      matches.push({
        start_line: start + 1,
        end_line: start + probeLines.length,
        content: blockLines.join("\n"),
      });
      if (matches.length > 1) break;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function resolveReplaceBlockTarget(state, target) {
  const startLine = Number(target?.start_line);
  const endLine = Number(target?.end_line);
  const oldHash = String(target?.old_hash || "");
  const currentBlock =
    Number.isFinite(startLine) &&
    Number.isFinite(endLine) &&
    startLine > 0 &&
    endLine >= startLine
      ? state.lines.slice(startLine - 1, endLine).join("\n")
      : "";

  if (oldHash && currentBlock && oldHash === sha256(currentBlock)) {
    return {
      start_line: startLine,
      end_line: endLine,
      old_hash: oldHash,
      old_content: currentBlock,
      relocated: false,
    };
  }

  const oldContent = String(target?.old_content || "");
  if (oldContent) {
    const relocated = findUniqueLineBlock(state.lines, oldContent);
    if (relocated) {
      return {
        start_line: relocated.start_line,
        end_line: relocated.end_line,
        old_hash: sha256(relocated.content),
        old_content: relocated.content,
        relocated: true,
      };
    }
  }

  return null;
}

function detectTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function isCodeLikePath(filePath) {
  return CODE_WRITE_GUARD_EXTENSIONS.has(
    path.extname(String(filePath || "")).toLowerCase(),
  );
}

function normalizeFileTypes(args = {}) {
  const explicit = Array.isArray(args?.file_types)
    ? args.file_types
        .map((item) =>
          String(item || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
    : [];
  const language = String(args?.language || "")
    .trim()
    .toLowerCase();
  const languageTypes = LANGUAGE_FILE_TYPES[language] || [];
  const merged = [...explicit, ...languageTypes];
  return [...new Set(merged)];
}

async function walkTextFiles(
  root,
  startPath = ".",
  fileTypes = [],
  config = {},
) {
  const abs = await resolveInWorkspace(root, startPath, config);
  const allowedExts = new Set(
    (Array.isArray(fileTypes) ? fileTypes : []).map(
      (item) => `.${String(item || "").replace(/^\./, "")}`,
    ),
  );
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    if (!detectTextFile(abs)) return [];
    if (
      allowedExts.size > 0 &&
      !allowedExts.has(path.extname(abs).toLowerCase())
    )
      return [];
    return [abs];
  }

  const files = await globFilesUnder(abs, { skipDirs: SKIP_DIRS });
  return files.filter((filePath) => {
    if (!detectTextFile(filePath)) return false;
    if (
      allowedExts.size > 0 &&
      !allowedExts.has(path.extname(filePath).toLowerCase())
    )
      return false;
    return true;
  });
}

async function walkWorkspaceEntries(
  root,
  startPath = ".",
  { includeHidden = false, config = {} } = {},
) {
  const abs = await resolveInWorkspace(root, startPath, config);
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    const relative = toWorkspaceRelative(root, abs) || path.basename(abs);
    return [{ path: relative, name: path.basename(abs), type: "file" }];
  }
  return globWorkspaceEntriesUnder(abs, { includeHidden, skipDirs: SKIP_DIRS });
}

function globToRegex(pattern) {
  const normalized = String(pattern || "")
    .replace(/\\/g, "/")
    .trim();
  let regexBody = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i];
    const next = normalized[i + 1];
    const afterNext = normalized[i + 2];
    if (ch === "*" && next === "*" && afterNext === "/") {
      regexBody += "(?:.*/)?";
      i += 2;
      continue;
    }
    if (ch === "*" && next === "*") {
      regexBody += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      regexBody += "[^/]*";
      continue;
    }
    if (ch === "?") {
      regexBody += "[^/]";
      continue;
    }
    regexBody += /[-/\\^$+?.()|[\]{}]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${regexBody}$`);
}

function findSymbolDefinition(lines, symbol) {
  const escaped = String(symbol || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(String.raw`\bfunction\s+${escaped}\b`),
    new RegExp(String.raw`\basync\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bexport\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bexport\s+async\s+function\s+${escaped}\b`),
    new RegExp(String.raw`\bclass\s+${escaped}\b`),
    new RegExp(String.raw`\bconst\s+${escaped}\b`),
    new RegExp(String.raw`\blet\s+${escaped}\b`),
    new RegExp(String.raw`\bvar\s+${escaped}\b`),
  ];
  for (let i = 0; i < lines.length; i += 1) {
    if (patterns.some((pattern) => pattern.test(lines[i]))) {
      return i + 1;
    }
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (new RegExp(String.raw`\b${escaped}\b`).test(lines[i])) {
      return i + 1;
    }
  }
  return 1;
}

function lineIndentSize(line) {
  const match = String(line || "").match(/^\s*/);
  return match ? match[0].length : 0;
}

function findBlockRange(lines, anchorLine) {
  const total = lines.length;
  const anchorIdx = Math.max(
    0,
    Math.min(total - 1, Number(anchorLine || 1) - 1),
  );

  let start = anchorIdx;
  for (let i = anchorIdx; i >= 0; i -= 1) {
    const line = String(lines[i] || "");
    if (
      /\b(function|class|interface|type|enum|const|let|var|export)\b/.test(
        line,
      ) ||
      /=>\s*{/.test(line) ||
      /<\w/.test(line)
    ) {
      start = i;
      break;
    }
  }

  let braceDepth = 0;
  let seenBrace = false;
  let end = anchorIdx;
  for (let i = start; i < total; i += 1) {
    const line = String(lines[i] || "");
    for (const ch of line) {
      if (ch === "{") {
        braceDepth += 1;
        seenBrace = true;
      } else if (ch === "}") {
        braceDepth -= 1;
      }
    }
    end = i;
    if (seenBrace && braceDepth <= 0 && i > start) {
      return { startLine: start + 1, endLine: end + 1 };
    }
  }

  const anchorText = String(lines[start] || "");
  if (/^\s*def\b/.test(anchorText) || /:\s*$/.test(anchorText)) {
    const baseIndent = lineIndentSize(anchorText);
    end = start;
    for (let i = start + 1; i < total; i += 1) {
      const line = String(lines[i] || "");
      if (!line.trim()) break;
      if (lineIndentSize(line) <= baseIndent) break;
      end = i;
    }
    return { startLine: start + 1, endLine: end + 1 };
  }

  const baseIndent = lineIndentSize(lines[start]);
  end = start;
  for (let i = start + 1; i < total; i += 1) {
    const line = String(lines[i] || "");
    if (!line.trim()) {
      end = i;
      continue;
    }
    if (lineIndentSize(line) <= baseIndent && i > anchorIdx) break;
    end = i;
  }
  return { startLine: start + 1, endLine: end + 1 };
}

function extractImports(lines) {
  return lines
    .filter((line) => /^\s*import\b/.test(String(line || "")))
    .map((line) => trimLinePreview(line, 220));
}

function extractImportSignatures(lines, maxItems = 6) {
  const imports = [];
  for (const line of lines) {
    const text = String(line || "").trim();
    if (!/^import\b/.test(text)) continue;
    imports.push(trimLinePreview(text, 96));
    if (imports.length >= maxItems) break;
  }
  return imports;
}

function extractTypeSignatures(lines, maxItems = 6) {
  const out = [];
  const patterns = [
    /^\s*(?:export\s+)?type\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?interface\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?enum\s+[A-Za-z0-9_$]+.*$/,
    /^\s*(?:export\s+)?class\s+[A-Za-z0-9_$]+.*$/,
    /^\s*import\s+type\b.*$/,
  ];
  for (const line of lines) {
    const text = String(line || "").trim();
    if (!patterns.some((pattern) => pattern.test(text))) continue;
    out.push(trimLinePreview(text, 96));
    if (out.length >= maxItems) break;
  }
  return out;
}

function extractLocalSymbols(lines, sourceSymbol = "") {
  const out = [];
  const seen = new Set();
  const regex =
    /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)|^\s*(?:export\s+)?class\s+([A-Za-z0-9_$]+)|^\s*(?:export\s+)?const\s+([A-Za-z0-9_$]+)\s*=/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = String(lines[i] || "").match(regex);
    const name = match?.[1] || match?.[2] || match?.[3] || "";
    if (!name || name === sourceSymbol || seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      line: i + 1,
      signature: trimLinePreview(lines[i], 220),
    });
  }
  return out.slice(0, 8);
}

function extractDirectCalls(lines, symbol, maxItems = 3, excludeRange = null) {
  const escaped = escapeRegex(symbol);
  const out = [];
  for (let i = 0; i < lines.length && out.length < maxItems; i += 1) {
    if (
      excludeRange &&
      i + 1 >= excludeRange.startLine &&
      i + 1 <= excludeRange.endLine
    )
      continue;
    const line = String(lines[i] || "");
    if (!new RegExp(String.raw`\b${escaped}\s*\(`).test(line)) continue;
    const blockLine = findEnclosingSymbolLine(lines, i + 1);
    const owner = blockLine
      ? trimLinePreview(lines[blockLine - 1], 220)
      : trimLinePreview(line, 220);
    const ownerName = blockLine ? extractSymbolName(lines[blockLine - 1]) : "";
    if (ownerName === symbol) continue;
    out.push({
      symbol: ownerName || "(anonymous)",
      line: blockLine || i + 1,
      preview: owner,
    });
  }
  return out;
}

function extractSymbolName(line) {
  const text = String(line || "");
  const match =
    text.match(/\bfunction\s+([A-Za-z0-9_$]+)/) ||
    text.match(/\bclass\s+([A-Za-z0-9_$]+)/) ||
    text.match(/\bconst\s+([A-Za-z0-9_$]+)\s*=/) ||
    text.match(/^\s*def\s+([A-Za-z0-9_]+)/);
  return match?.[1] || "";
}

function findEnclosingSymbolLine(lines, anchorLine) {
  for (let i = Math.max(0, anchorLine - 1); i >= 0; i -= 1) {
    const name = extractSymbolName(lines[i]);
    if (name) return i + 1;
  }
  return 0;
}

async function getFileState(root, relativePath, config = {}) {
  const target = await resolveInWorkspace(root, relativePath, config);
  const stat = await fs.stat(target);
  const content = await fs.readFile(target, "utf8");
  return {
    target,
    content,
    lines: splitLines(content),
    stat,
  };
}

async function readFile(root, args, config = {}) {
  const normalizedArgs = normalizeReadArgs(args);
  const target = await resolveInWorkspace(root, normalizedArgs?.path, config);
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    const listing = await builtinList(
      root,
      { path: normalizedArgs?.path },
      config,
    );
    return {
      ...listing,
      phase: "directory_listing",
      note: "Path is a directory. Returned a listing instead of file contents. Prefer list for directory discovery, or read a specific file path inside it.",
    };
  }
  const text = await fs.readFile(target, "utf8");
  const lines = splitLines(text);
  const totalLines = lines.length;
  const startLineRaw = Number(normalizedArgs?.start_line);
  const endLineRaw = Number(normalizedArgs?.end_line);
  const defaultLines = Number(normalizedArgs?.default_lines || 220);
  const maxChars = Number(normalizedArgs?.max_chars || 24000);
  const wantsMetadataOnly =
    normalizedArgs?.metadata_only === true ||
    normalizedArgs?.include_content === false;

  let startLine =
    Number.isFinite(startLineRaw) && startLineRaw > 0 ? startLineRaw : 1;
  let endLine =
    Number.isFinite(endLineRaw) && endLineRaw >= startLine
      ? endLineRaw
      : Math.min(totalLines, startLine + Math.max(1, defaultLines) - 1);
  startLine = Math.max(1, Math.min(startLine, totalLines));
  endLine = Math.max(startLine, Math.min(endLine, totalLines));

  const tokenSeed = `${normalizedArgs?.path}|${stat.size}|${stat.mtimeMs}|${startLine}|${endLine}`;
  const readToken = sha256Hash(tokenSeed).slice(0, 16);

  if (wantsMetadataOnly) {
    return {
      path: normalizedArgs?.path,
      phase: "metadata",
      size_bytes: stat.size,
      modified_at: new Date(stat.mtimeMs).toISOString(),
      total_lines: totalLines,
      suggested_start_line: startLine,
      suggested_end_line: endLine,
      read_token: readToken,
      next: "Call read again with include_content=true and this read_token",
    };
  }

  let content = lines.slice(startLine - 1, endLine).join("\n");
  let truncated = false;
  if (maxChars > 0 && content.length > maxChars) {
    content = `${content.slice(0, maxChars)}\n... [truncated by max_chars]`;
    truncated = true;
  }

  // Read deduplication: if same path+range+mtime was read before, return a short stub
  const isDuplicate = checkReadDedup(
    normalizedArgs?.path,
    startLine,
    endLine,
    stat.mtimeMs,
  );
  if (isDuplicate) {
    return {
      path: normalizedArgs?.path,
      phase: "content",
      start_line: startLine,
      end_line: endLine,
      total_lines: totalLines,
      truncated: false,
      unchanged: true,
      content: `File unchanged since last read. The content from the earlier read tool_result in this conversation is still current -- refer to that instead of re-reading.`,
    };
  }

  // Resolve enclosing structural symbol via Tree-sitter (best-effort, skipped for large files)
  const shouldResolveEnclosing =
    text.length <= MAX_AST_ENCLOSING_BYTES &&
    totalLines <= MAX_AST_ENCLOSING_LINES;
  const anchorLine = Math.floor((startLine + endLine) / 2);
  const enclosing = shouldResolveEnclosing
    ? await findEnclosingSymbol(text, normalizedArgs?.path, anchorLine)
    : null;

  return {
    path: normalizedArgs?.path,
    phase: "content",
    start_line: startLine,
    end_line: endLine,
    total_lines: totalLines,
    truncated,
    content,
    ...(enclosing
      ? {
          enclosing_symbol: enclosing.name,
          enclosing_kind: enclosing.kind,
          enclosing_line: enclosing.start_line,
        }
      : {}),
  };
}

async function writeFile(root, args, config = {}) {
  const normalizedArgs = normalizeWriteArgs(args);
  const rawPath = String(normalizedArgs?.path || "").trim();
  if (!rawPath) {
    throw new Error("create requires a file path like src/app.js");
  }
  if (rawPath === "." || rawPath === "./") {
    throw new Error("create requires a file path, not the workspace root");
  }
  if (normalizedArgs?.content == null) {
    throw new Error("create requires content");
  }
  const target = await resolveInWorkspace(root, rawPath, config);
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      throw new Error(`create target is a directory: ${rawPath}`);
    }
  } catch (error) {
    if (error?.code && error.code !== "ENOENT") throw error;
  }
  let existed = false;
  try {
    await fs.readFile(target, "utf8");
    existed = true;
  } catch {
    /* file does not exist — expected path */
  }
  if (existed) {
    throw new Error(
      `create target already exists: ${rawPath}. Use edit to modify existing files.`,
    );
  }
  const nextContent = String(normalizedArgs.content ?? "");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, nextContent, "utf8");
  const afterLines = splitLines(nextContent);
  const changed = { added: afterLines.length, removed: 0 };
  return {
    ok: true,
    path: rawPath,
    action: "create",
    changed_line: 1,
    diff_preview: buildDiffPreview("", nextContent),
    lines_added: changed.added,
    lines_removed: changed.removed,
  };
}
async function prepareDeleteTarget(root, args, config = {}) {
  const normalizedArgs = normalizePathArgs(args, [
    "file",
    "file_path",
    "target",
    "directory",
    "dir",
  ]);
  const rawPath = String(normalizedArgs?.path || "").trim();
  if (!rawPath) {
    throw new Error("delete requires a file or directory path");
  }
  const absRoot = path.resolve(root);
  const realRoots = await getAllowedRealRoots(absRoot, config);
  const originalTarget = path.resolve(absRoot, rawPath);
  if (originalTarget === absRoot) {
    throw new Error(
      "delete requires a path inside the workspace, not the workspace root",
    );
  }
  const resolvedTarget = await resolveInWorkspace(root, rawPath, config);
  if (realRoots.some((realRoot) => resolvedTarget === realRoot)) {
    throw new Error(
      "delete requires a path inside the workspace or allowed paths, not an allowed root",
    );
  }

  let rawStat;
  let stat;
  try {
    rawStat = await fs.lstat(originalTarget);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`delete target not found: ${rawPath}`);
    }
    throw error;
  }
  try {
    stat = await fs.stat(resolvedTarget);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const type = stat?.isDirectory?.()
    ? "directory"
    : rawStat.isDirectory()
      ? "directory"
      : "file";
  const pathInWorkspace = toWorkspaceRelative(root, originalTarget);
  return {
    originalTarget,
    resolvedTarget,
    path: pathInWorkspace,
    name: path.basename(pathInWorkspace),
    type,
  };
}

async function deletePath(root, args, config = {}) {
  const target = await prepareDeleteTarget(root, args, config);
  await fs.rm(target.originalTarget, { recursive: true, force: false });

  return {
    ok: true,
    path: target.path,
    name: target.name,
    type: target.type,
    deleted: true,
  };
}

async function runCommand(root, config, args) {
  const command = args?.command || "";
  if (!command.trim()) {
    throw new Error("run requires command");
  }
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(command, config.policy.blocked_command_patterns)
  ) {
    throw new Error("Command blocked by policy");
  }

  const check = evaluateCommandPolicy(command, config, root);
  if (!check.allowed && !hasRunCommandSafeModeApproval(args)) {
    throw new Error(
      `Command blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ""}`,
    );
  }

  const shouldBackground =
    args?.run_in_background === true ||
    args?.runInBackground === true ||
    args?.background === true ||
    isLikelyLongRunningCommand(command);

  if (shouldBackground) {
    return startBackgroundTask(root, config, args);
  }

  const result = await runShellCommand({
    command,
    cwd: root,
    shell: config.shell.default,
    timeoutMs: Number(
      args?.timeout ||
        args?.timeout_ms ||
        args?.timeoutMs ||
        config.shell.timeout_ms,
    ),
  });
  const payload = { ...result, command };
  const failureMessage = buildRunFailureMessage(payload);
  if (failureMessage) {
    payload.failed = true;
    payload.error = failureMessage;
  }
  return payload;
}

function nextBackgroundTaskId() {
  backgroundTaskCounter += 1;
  return `task_${String(backgroundTaskCounter).padStart(3, "0")}`;
}

function normalizeSuccessMatchers(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => String(item || "").trim()).filter(Boolean);
}

function shellCommandForBackgroundTask(command, shellSpec) {
  return process.platform !== "win32" &&
    /(?:^|\/)bash(?:\.exe)?$/i.test(shellSpec.command)
    ? `exec ${command}`
    : command;
}

function appendRecentOutput(task, chunk) {
  const lines = sanitizePreviewLines(chunk, { maxLineLength: 220 }).map(
    (line) => trimLinePreview(line, 220),
  );
  if (lines.length === 0) return;
  for (const line of lines) {
    backgroundTaskLogCursorCounter += 1;
    task.recentLogs.push({ cursor: backgroundTaskLogCursorCounter, line });
  }
  if (task.recentLogs.length > BACKGROUND_TASK_RECENT_OUTPUT_LIMIT) {
    task.recentLogs.splice(
      0,
      task.recentLogs.length - BACKGROUND_TASK_RECENT_OUTPUT_LIMIT,
    );
  }
}

function matchesTaskStartupSuccess(task, text) {
  const value = String(text || "");
  if (!value) return false;
  if (hasReadyOutput(value)) return true;
  return task.successMatchers.some((matcher) =>
    value.toLowerCase().includes(matcher.toLowerCase()),
  );
}

function markTaskReady(task, source = "output") {
  if (task.startupConfirmed) return;
  task.startupConfirmed = true;
  task.startupSource = source;
  task.status = "running";
}

function serviceUrlForPort(port) {
  const portNumber = Number(port);
  return Number.isInteger(portNumber) && portNumber > 0
    ? `http://127.0.0.1:${portNumber}`
    : "";
}

function normalizeHttpProbe(value) {
  if (!value || typeof value !== "object") return null;
  const url = String(value.url || "").trim();
  if (!url) return null;
  const expectStatus = Number(value.expect_status ?? value.expectStatus ?? 200);
  return {
    url,
    expect_status: Number.isInteger(expectStatus) ? expectStatus : 200,
  };
}

function snapshotBackgroundTask(task, tail = 12) {
  const recentOutput = Array.isArray(task.recentLogs)
    ? task.recentLogs.slice(-Math.max(1, tail)).map((item) => item.line)
    : [];
  const latestCursor =
    Array.isArray(task.recentLogs) && task.recentLogs.length > 0
      ? task.recentLogs[task.recentLogs.length - 1].cursor
      : 0;
  return {
    task_id: task.taskId,
    pid: task.child?.pid || null,
    command: task.command,
    cwd: task.cwd,
    status: task.status,
    background: true,
    kind: task.intentKind,
    startup_confirmed: task.startupConfirmed,
    startup_source: task.startupSource || "",
    http_probe: task.httpProbe || undefined,
    url: serviceUrlForPort(task.portProbe) || undefined,
    output_file: task.outputFile,
    recent_output: recentOutput,
    recent_logs: recentOutput,
    log_cursor: latestCursor,
    exit_code: task.exitCode ?? undefined,
    signal: task.signal ?? undefined,
    duration_ms: Date.now() - task.startedAt,
  };
}

function listBackgroundTaskSnapshots() {
  return Array.from(backgroundTaskRegistry.values()).map((task) =>
    snapshotBackgroundTask(task, 4),
  );
}

function probePortOnce(port, host = "127.0.0.1", timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(Number(port), host);
  });
}

async function probeHttpOnce(httpProbe, timeoutMs = 400) {
  if (!httpProbe?.url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(httpProbe.url, {
      method: "GET",
      signal: controller.signal,
    });
    return response.status === Number(httpProbe.expect_status || 200);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function queueBackgroundTaskOutputWrite(task, chunk) {
  if (!task?.outputFileAbs) return;
  task.outputWrite = (task.outputWrite || Promise.resolve())
    .then(() => fs.appendFile(task.outputFileAbs, String(chunk || ""), "utf8"))
    .catch(() => {});
}

async function startBackgroundTask(root, config, args) {
  const command = String(args?.command || args?.cmd || "").trim();
  if (!command) throw new Error("run requires command");
  if (
    !config.policy.allow_dangerous_commands &&
    isDangerousCommand(command, config.policy.blocked_command_patterns)
  ) {
    throw new Error("Command blocked by policy");
  }
  const check = evaluateCommandPolicy(command, config, root);
  if (!check.allowed && !hasRunCommandSafeModeApproval(args)) {
    throw new Error(
      `Command blocked by safe mode: ${check.reason}${check.suggestion ? ` | ${check.suggestion}` : ""}`,
    );
  }

  const shellSpec = resolveShell(config.shell.default);
  const taskId = nextBackgroundTaskId();
  const startupTimeoutMs = Math.max(
    250,
    Number(args?.startup_timeout_ms || args?.startupTimeoutMs || 20000),
  );
  const successMatchers = normalizeSuccessMatchers(
    args?.success_matchers || args?.successMatchers,
  );
  const portProbe = Number(args?.port_probe || args?.portProbe || 0) || 0;
  const httpProbe = normalizeHttpProbe(args?.http_probe || args?.httpProbe);
  const outputDir = await getBackgroundTasksDir(root);
  await fs.mkdir(outputDir, { recursive: true });
  const outputFileAbs = path.join(outputDir, `${taskId}.log`);
  await fs.writeFile(outputFileAbs, "", "utf8");

  const task = {
    taskId,
    command,
    cwd: root,
    child: spawn(
      shellSpec.command,
      [...shellSpec.args, shellCommandForBackgroundTask(command, shellSpec)],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
    startedAt: Date.now(),
    status: "starting",
    intentKind: classifyCommandIntent(command).kind,
    startupConfirmed: false,
    startupSource: "",
    successMatchers,
    portProbe,
    httpProbe,
    outputFileAbs,
    outputFile: toWorkspaceRelative(root, outputFileAbs),
    recentLogs: [],
    exitCode: null,
    signal: null,
    outputWrite: Promise.resolve(),
  };
  backgroundTaskRegistry.set(taskId, task);

  task.closePromise = new Promise((resolve) => {
    task.child.on("close", (code, signal) => {
      task.exitCode = code;
      task.signal = signal;
      task.status = task.status === "stopped" ? "stopped" : "exited";
      resolve();
    });
  });

  const onOutput = (chunk) => {
    appendRecentOutput(task, chunk);
    queueBackgroundTaskOutputWrite(task, chunk);
    if (matchesTaskStartupSuccess(task, chunk)) {
      markTaskReady(task, "output");
      if (task._finishStartup) task._finishStartup();
    }
  };
  task.child.stdout.on("data", onOutput);
  task.child.stderr.on("data", onOutput);
  task.child.on("error", (error) => {
    appendRecentOutput(task, error?.message || String(error));
    queueBackgroundTaskOutputWrite(task, error?.message || String(error));
    task.status = "exited";
    if (task._finishStartup) task._finishStartup();
  });

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearInterval(portHandle);
      clearInterval(httpHandle);
      task._finishStartup = null;
      resolve();
    };
    task._finishStartup = finish;
    if (task.startupConfirmed || task.status === "exited") {
      finish();
      return;
    }
    const timeoutHandle = setTimeout(() => {
      if (task.status === "starting") {
        if (!task.startupConfirmed) {
          markTaskReady(task, "startup_window");
        } else {
          task.status = "running";
        }
      }
      finish();
    }, startupTimeoutMs);
    const portHandle =
      portProbe > 0
        ? setInterval(async () => {
            const open = await probePortOnce(portProbe);
            if (open) {
              markTaskReady(task, "port_probe");
              finish();
            }
          }, BACKGROUND_TASK_POLL_MS)
        : null;
    const httpHandle = httpProbe
      ? setInterval(async () => {
          const ok = await probeHttpOnce(httpProbe);
          if (ok) {
            markTaskReady(task, "http_probe");
            finish();
          }
        }, BACKGROUND_TASK_POLL_MS)
      : null;
    task.child.once("close", () => finish());
  });

  if (task.status === "starting") {
    task.status = "running";
  }
  return snapshotBackgroundTask(task);
}

function getBackgroundTaskOrThrow(taskId) {
  const task = backgroundTaskRegistry.get(String(taskId || "").trim());
  if (!task) throw new Error(`Unknown background task: ${taskId}`);
  return task;
}

async function getBackgroundTask(_root, args) {
  const task = getBackgroundTaskOrThrow(args?.task_id || args?.taskId);
  return snapshotBackgroundTask(task);
}

async function listBackgroundTasks() {
  return {
    tasks: listBackgroundTaskSnapshots(),
  };
}

function toRipgrepGlob(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (
    text.includes("*") ||
    text.includes("?") ||
    text.includes("/") ||
    text.includes("\\")
  ) {
    return text.replace(/\\/g, "/");
  }
  return `**/*.${text.replace(/^\./, "")}`;
}

function buildRipgrepArgs(pattern, normalizedArgs, targetPath, maxResults) {
  const args = [
    "--json",
    "--line-number",
    "--column",
    "--no-heading",
    "--color",
    "never",
    "--max-columns",
    "500",
    "--max-columns-preview",
  ];
  if (!normalizedArgs?.regex) args.push("--fixed-strings");
  if (!normalizedArgs?.case_sensitive) args.push("--ignore-case");
  for (const dirName of SKIP_DIRS) {
    args.push("--glob", `!**/${dirName}/**`);
  }
  const fileTypes = normalizeFileTypes(normalizedArgs);
  for (const fileType of fileTypes) {
    const glob = toRipgrepGlob(fileType);
    if (glob) args.push("--glob", glob);
  }
  args.push("--", pattern, targetPath);
  return args;
}

async function runRipgrepSearch(root, normalizedArgs, config = {}) {
  if (!rgPath) return null;
  const pattern = String(normalizedArgs?.pattern || "").trim();
  const maxResults = Math.max(
    1,
    Math.min(200, Number(normalizedArgs?.max_results || 50)),
  );
  const target = await resolveInWorkspace(
    root,
    normalizedArgs?.path || ".",
    config,
  );
  const args = buildRipgrepArgs(pattern, normalizedArgs, target, maxResults);
  const child = spawn(rgPath, args, {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const exitCode = await new Promise((resolve) => {
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code));
  });
  if (exitCode == null) return null;
  if (exitCode !== 0 && exitCode !== 1) {
    throw new Error(`ripgrep failed: ${stderr.trim() || `exit ${exitCode}`}`);
  }
  const matches = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type !== "match") continue;
    const data = event.data || {};
    const absolutePath = String(data.path?.text || "");
    const submatches = Array.isArray(data.submatches) ? data.submatches : [];
    const firstMatch = submatches[0] || {};
    matches.push({
      path: toWorkspaceRelative(root, absolutePath),
      line: Number(data.line_number || 1),
      column: Math.max(1, Number(firstMatch.start || 0) + 1),
      preview: trimLinePreview(data.lines?.text || ""),
    });
    if (matches.length >= maxResults) break;
  }
  return {
    pattern,
    matches,
    truncated: matches.length >= maxResults,
    engine: "ripgrep",
  };
}

async function stopBackgroundTask(_root, args) {
  const task = getBackgroundTaskOrThrow(args?.task_id || args?.taskId);
  if (task.status === "stopped" || task.status === "exited") {
    return { ...snapshotBackgroundTask(task), stopped: true };
  }
  task.status = "stopped";
  terminateChild(task.child, "SIGTERM");
  setTimeout(() => terminateChild(task.child, "SIGKILL"), 200);
  await Promise.race([
    task.closePromise,
    new Promise((resolve) => setTimeout(resolve, 500)),
  ]);
  return { ...snapshotBackgroundTask(task), stopped: true };
}

async function builtinGrep(root, args, config = {}) {
  const normalizedArgs = normalizePatternArgs(
    args,
    ["query", "symbol", "q"],
    ["directory", "dir", "cwd", "file_path", "file"],
  );
  const pattern = String(normalizedArgs?.pattern || "").trim();
  if (!pattern) throw new Error("grep requires pattern");
  const maxResults = Math.max(
    1,
    Math.min(200, Number(normalizedArgs?.max_results || 50)),
  );
  const rgResult = await runRipgrepSearch(root, normalizedArgs, config).catch(
    (error) => {
      if (config?.tools?.ripgrep_strict === true) throw error;
      return null;
    },
  );
  if (rgResult) {
    return rgResult;
  }
  const caseSensitive = Boolean(normalizedArgs?.case_sensitive);
  const files = await walkTextFiles(
    root,
    normalizedArgs?.path || ".",
    normalizeFileTypes(normalizedArgs),
    config,
  );
  const regex = normalizedArgs?.regex
    ? new RegExp(pattern, caseSensitive ? "g" : "gi")
    : new RegExp(escapeRegex(pattern), caseSensitive ? "g" : "gi");
  const matches = [];

  for (const filePath of files) {
    const content = await fs.readFile(filePath, "utf8");
    const lines = splitLines(content);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = String(lines[idx] || "");
      regex.lastIndex = 0;
      const found = regex.exec(line);
      if (!found) continue;
      matches.push({
        path: toWorkspaceRelative(root, filePath),
        line: idx + 1,
        column: Math.max(1, Number(found.index || 0) + 1),
        preview: trimLinePreview(line),
      });
      if (matches.length >= maxResults) {
        return { pattern, matches, truncated: true, engine: "js" };
      }
    }
  }

  return { pattern, matches, truncated: false, engine: "js" };
}

async function builtinGlob(root, args, config = {}) {
  const normalizedArgs = normalizePatternArgs(
    args,
    ["glob", "query"],
    ["directory", "dir", "cwd", "file_path", "file"],
  );
  const pattern = String(normalizedArgs?.pattern || "").trim();
  if (!pattern) throw new Error("glob requires pattern");
  const maxResults = Math.max(
    1,
    Math.min(500, Number(normalizedArgs?.max_results || 200)),
  );
  const abs = await resolveInWorkspace(
    root,
    normalizedArgs?.path || ".",
    config,
  );
  const stat = await fs.stat(abs);
  if (!stat.isDirectory()) {
    const relative = toWorkspaceRelative(root, abs);
    const regex = globToRegex(pattern);
    const matches = regex.test(relative) ? [relative] : [];
    return { pattern, matches, truncated: false, engine: "fast-glob" };
  }
  const result = await globFilePathsByPattern(abs, pattern, {
    includeHidden: Boolean(normalizedArgs?.include_hidden),
    skipDirs: SKIP_DIRS,
    maxResults,
  });
  return {
    pattern,
    matches: result.matches,
    truncated: result.truncated,
    engine: "fast-glob",
  };
}

async function builtinList(root, args, config = {}) {
  const normalizedArgs = normalizePathArgs(args, [
    "dir",
    "directory",
    "file_path",
    "file",
    "target",
  ]);
  const relativePath = String(normalizedArgs?.path || ".").trim() || ".";
  const target = await resolveInWorkspace(root, relativePath, config);
  const entries = await fs.readdir(target, { withFileTypes: true });
  const includeHidden = Boolean(normalizedArgs?.include_hidden);
  const items = entries
    .filter((entry) => includeHidden || !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path:
        path.posix.join(
          relativePath === "." ? "" : relativePath.replace(/\\/g, "/"),
          entry.name,
        ) || entry.name,
      type: entry.isDirectory() ? "dir" : "file",
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
      return left.path.localeCompare(right.path);
    });
  return {
    path: relativePath,
    items,
  };
}

async function readBlock(root, args, config = {}) {
  const relativePath = String(args?.path || "").trim();
  if (!relativePath) throw new Error("read_block requires path");
  const { lines } = await getFileState(root, relativePath, config);
  const symbol = String(args?.symbol || "").trim();
  const anchorLine = symbol
    ? findSymbolDefinition(lines, symbol)
    : Number(args?.line || args?.anchor_line || 1);
  const range = findBlockRange(lines, anchorLine);
  return {
    file: relativePath,
    symbol: symbol || undefined,
    mode: symbol ? "symbol" : "block",
    start_line: range.startLine,
    end_line: range.endLine,
    content: lines.slice(range.startLine - 1, range.endLine).join("\n"),
  };
}

async function readSymbolContext(root, args, config = {}) {
  const relativePath = String(args?.path || "").trim();
  const symbol = String(args?.symbol || "").trim();
  if (!relativePath || !symbol)
    throw new Error("read_symbol_context requires path and symbol");
  const { lines } = await getFileState(root, relativePath, config);
  const mainBlock = await readBlock(
    root,
    { path: relativePath, symbol },
    config,
  );
  return {
    file: relativePath,
    symbol,
    main_block: mainBlock,
    related: {
      imports: extractImports(lines),
      import_signatures: extractImportSignatures(
        lines,
        Number(args?.max_related_imports || 4),
      ),
      type_signatures: extractTypeSignatures(
        lines,
        Number(args?.max_related_types || 4),
      ),
      local_symbols: extractLocalSymbols(lines, symbol),
      calls: extractDirectCalls(
        lines,
        symbol,
        Number(args?.max_related_calls || 3),
        {
          startLine: mainBlock.start_line,
          endLine: mainBlock.end_line,
        },
      ),
    },
  };
}

async function validateEdit(root, args, config = {}) {
  const relativePath = String(args?.path || "").trim();
  const kind = String(args?.kind || "").trim();
  if (!relativePath || !kind)
    throw new Error("validate_edit requires path and kind");
  const { content, lines } = await getFileState(root, relativePath, config);

  if (kind === "replace_block") {
    const startLine = Number(args?.target?.start_line || args?.start_line);
    const endLine = Number(args?.target?.end_line || args?.end_line);
    if (
      !Number.isFinite(startLine) ||
      !Number.isFinite(endLine) ||
      startLine <= 0 ||
      endLine < startLine
    ) {
      throw new Error(
        "replace_block validation requires target.start_line and target.end_line",
      );
    }
    const resolved = resolveReplaceBlockTarget(
      { content, lines },
      {
        start_line: startLine,
        end_line: endLine,
        old_hash: args?.target?.old_hash,
        old_content: args?.target?.old_content,
      },
    );
    const oldBlock =
      resolved?.old_content || lines.slice(startLine - 1, endLine).join("\n");
    return {
      ok: true,
      path: relativePath,
      kind,
      target: {
        start_line: resolved?.start_line || startLine,
        end_line: resolved?.end_line || endLine,
        old_hash: sha256(oldBlock),
        old_content: oldBlock,
      },
      file_hash: sha256(content),
      relocated: Boolean(resolved?.relocated),
    };
  }

  if (
    kind === "replace_text" ||
    kind === "insert_before" ||
    kind === "insert_after"
  ) {
    const probe = String(args?.old_text || args?.anchor_text || "");
    if (!probe)
      throw new Error(`${kind} validation requires old_text or anchor_text`);
    const occurrences = countTextOccurrences(content, probe);
    return {
      ok: occurrences === 1,
      path: relativePath,
      kind,
      occurrences,
      reason:
        occurrences === 1
          ? "unique match"
          : occurrences === 0
            ? "anchor not found"
            : "anchor not unique",
      file_hash: sha256(content),
    };
  }

  throw new Error(`validate_edit does not support kind: ${kind}`);
}

function countChangedLines(beforeContent, afterContent) {
  const before = splitLines(beforeContent);
  const after = splitLines(afterContent);
  const m = before.length;
  const n = after.length;
  // LCS via rolling DP — O(m*n) time, O(min(m,n)) space
  const short = m <= n ? before : after;
  const long = m <= n ? after : before;
  const shortLen = short.length;
  const longLen = long.length;
  let prev = new Array(longLen + 1).fill(0);
  let curr = new Array(longLen + 1).fill(0);
  for (let i = 1; i <= shortLen; i++) {
    for (let j = 1; j <= longLen; j++) {
      if (short[i - 1] === long[j - 1]) {
        curr[j] = prev[j - 1] + 1;
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const lcsLen = prev[longLen];
  return { added: n - lcsLen, removed: m - lcsLen };
}

function editResult(
  pathText,
  action,
  beforeContent,
  afterContent,
  changedLine = 1,
) {
  const diffPreview = buildDiffPreview(beforeContent, afterContent);
  const changed = countChangedLines(beforeContent, afterContent);
  return {
    ok: true,
    path: pathText,
    action,
    changed_line: changedLine,
    diff_preview: diffPreview,
    new_hash: sha256(afterContent),
    lines_added: changed.added,
    lines_removed: changed.removed,
  };
}

function lineRangeToOffsets(content, startLineRaw, endLineRaw) {
  const lines = splitLines(content);
  const totalLines = lines.length;
  const startLine = Math.max(
    1,
    Math.min(totalLines, Number(startLineRaw) || 1),
  );
  const endLine = Math.max(
    startLine,
    Math.min(totalLines, Number(endLineRaw) || startLine),
  );
  let startOffset = 0;
  for (let i = 1; i < startLine; i += 1) {
    startOffset += lines[i - 1].length + 1;
  }
  let endOffset = startOffset;
  for (let i = startLine; i <= endLine; i += 1) {
    endOffset += lines[i - 1].length;
    if (i < endLine) endOffset += 1;
  }
  return { startLine, endLine, startOffset, endOffset };
}

function normalizeNewlinesWithMap(text) {
  const source = String(text || "");
  const chars = [];
  const indexMap = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "\r") {
      chars.push("\n");
      indexMap.push(i);
      if (source[i + 1] === "\n") i += 1;
      continue;
    }
    chars.push(ch);
    indexMap.push(i);
  }
  return { text: chars.join(""), indexMap };
}

function detectEol(text) {
  const sample = String(text || "");
  const crlf = (sample.match(/\r\n/g) || []).length;
  const loneLf = (sample.match(/(?<!\r)\n/g) || []).length;
  const loneCr = (sample.match(/\r(?!\n)/g) || []).length;
  if (crlf >= loneLf && crlf >= loneCr && crlf > 0) return "\r\n";
  if (loneCr > loneLf && loneCr > 0) return "\r";
  return "\n";
}

function applyEol(text, eol) {
  return String(text || "").replace(/\r\n|\r|\n/g, eol || "\n");
}

function findLineEndingEquivalentMatches(content, oldText) {
  const normalizedOld = normalizeNewlinesWithMap(oldText).text;
  if (!normalizedOld) return [];
  const normalizedContent = normalizeNewlinesWithMap(content);
  const matches = [];
  let pos = 0;
  while (true) {
    const found = normalizedContent.text.indexOf(normalizedOld, pos);
    if (found === -1) break;
    const start = normalizedContent.indexMap[found] ?? 0;
    const endNorm = found + normalizedOld.length;
    const end =
      endNorm >= normalizedContent.text.length
        ? String(content || "").length
        : normalizedContent.indexMap[endNorm];
    matches.push({ start, end });
    pos = found + Math.max(1, normalizedOld.length);
  }
  return matches;
}

// Mirror read-tool sanitization (CRLF→LF, strip trailing ws) plus tab/indent tolerance for edit matching.
function normalizeProbeLine(line) {
  return String(line || "")
    .replace(/\r$/, "")
    .replace(/\t/g, "    ")
    .replace(/[ \t]+$/, "");
}

function normalizeProbeLineTrimStart(line) {
  return normalizeProbeLine(line).replace(/^\s+/, "");
}

function findLineBlockMatches(
  content,
  oldText,
  { compareTrimStart = false } = {},
) {
  const probeLines = splitLinesNormalized(oldText).map(normalizeProbeLine);
  if (probeLines.length === 0 || probeLines.every((line) => !line.trim()))
    return [];
  const contentLines = splitLinesNormalized(content);
  const compareLine = compareTrimStart
    ? normalizeProbeLineTrimStart
    : normalizeProbeLine;
  const normalizedProbe = probeLines.map(compareLine);
  const matches = [];

  for (let i = 0; i <= contentLines.length - probeLines.length; i += 1) {
    let ok = true;
    for (let j = 0; j < probeLines.length; j += 1) {
      const probeLine = probeLines[j];
      const contentLine = contentLines[i + j] ?? "";
      if (!probeLine.trim()) {
        if (contentLine.trim()) {
          ok = false;
          break;
        }
        continue;
      }
      if (compareLine(contentLine) !== normalizedProbe[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    const { startOffset, endOffset } = lineRangeToOffsets(
      content,
      i + 1,
      i + probeLines.length,
    );
    matches.push({ start: startOffset, end: endOffset });
  }
  return matches;
}

function findFlexibleTextMatches(content, oldText) {
  if (!oldText) return [];

  const exact = [];
  let pos = 0;
  while (true) {
    const found = content.indexOf(oldText, pos);
    if (found === -1) break;
    exact.push({ start: found, end: found + oldText.length });
    pos = found + Math.max(1, oldText.length);
  }
  if (exact.length > 0) return exact;

  const newline = findLineEndingEquivalentMatches(content, oldText);
  if (newline.length > 0) return newline;

  const trailing = findTrailingWhitespaceTolerantMatches(content, oldText);
  if (trailing.length > 0) return trailing;

  const flexTrim = findLineBlockMatches(content, oldText, {
    compareTrimStart: true,
  });
  if (flexTrim.length > 0) return flexTrim;

  return findLineBlockMatches(content, oldText, { compareTrimStart: false });
}

function applyMatchReplacements(searchContent, matches, newText, replaceAll) {
  const selected = replaceAll ? matches : matches.slice(0, 1);
  if (selected.length === 0) return null;
  let cursor = 0;
  let replaced = "";
  for (const match of selected) {
    const originalMatch = searchContent.slice(match.start, match.end);
    replaced += searchContent.slice(cursor, match.start);
    replaced += applyEol(newText, detectEol(originalMatch));
    cursor = match.end;
    if (!replaceAll) break;
  }
  replaced += searchContent.slice(cursor);
  return { replaced, firstMatch: selected[0] };
}

function changedLineForMatch(fullContent, searchContent, match, range) {
  if (range) {
    return (
      range.startLine +
      splitLines(searchContent.slice(0, match.start)).length -
      1
    );
  }
  return splitLines(fullContent.slice(0, match.start)).length;
}

function countTextOccurrences(content, probe) {
  if (!probe) return 0;
  return findFlexibleTextMatches(content, probe).length;
}

function findTrailingWhitespaceTolerantMatches(content, oldText) {
  if (!oldText) return [];
  const escapedLines = splitLinesNormalized(oldText).map((line) => {
    const trimmed = normalizeProbeLine(line);
    return `${escapeRegex(trimmed)}[ \\t\\r]*`;
  });
  const pattern = escapedLines.join("\\r?\\n");
  if (!pattern) return [];
  try {
    const regex = new RegExp(pattern, "gm");
    const matches = [];
    let match;
    while ((match = regex.exec(content)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length });
    }
    return matches;
  } catch {
    return [];
  }
}

function buildOldTextNotFoundHint(content, oldText, relativePath) {
  const firstLine = String(oldText || "")
    .split("\n")[0]
    .substring(0, 100);
  const snippetLines = splitLines(String(content || "")).slice(0, 15);
  const snippet = snippetLines.map((l, i) => `${i + 1}| ${l}`).join("\n");
  return [
    `old_text not found in ${relativePath || "file"}.`,
    `Searched for: "${firstLine}${firstLine.length < (oldText || "").length ? "..." : ""}"`,
    `File starts with:\n${snippet}${snippetLines.length < splitLines(content).length ? "\n..." : ""}`,
    `Hint: read output normalizes CRLF and trailing spaces; edit now tolerates those plus tabs/indent drift. If this still fails, read the file and copy old_text exactly from the read result.`,
  ].join("\n");
}

async function replaceBlock(root, args, config = {}) {
  const relativePath = String(args?.path || "").trim();
  const newContent = String(args?.new_content || args?.content || "");
  const target = args?.target || {};
  const state = await getFileState(root, relativePath, config);
  const resolved = resolveReplaceBlockTarget(state, target);
  if (!resolved) {
    throw new Error(
      "replace_block old_hash mismatch; retry through edit with a symbol or line hint",
    );
  }
  const fileEol = detectEol(state.content);
  const nextLines = [
    ...state.lines.slice(0, resolved.start_line - 1),
    ...splitLinesNormalized(newContent),
    ...state.lines.slice(resolved.end_line),
  ];
  const afterContent = joinFileLines(nextLines, fileEol);
  await fs.writeFile(state.target, afterContent, "utf8");
  return editResult(
    relativePath,
    "replace_block",
    state.content,
    afterContent,
    resolved.start_line,
  );
}

async function replaceText(root, args, config = {}) {
  const relativePath = String(args?.path || "").trim();
  const oldText = String(args?.old_text || "");
  const newText = String(args?.new_text || "");
  const replaceAll = semanticBoolean(args?.replace_all ?? args?.replaceAll);
  const state = await getFileState(root, relativePath, config);
  if (!oldText) {
    throw new Error("replace_text requires old_text");
  }
  const rangeStart = Number(args?.start_line || args?.line);
  const rangeEnd = Number(args?.end_line || args?.line);
  const hasRange = Number.isFinite(rangeStart) && rangeStart > 0;
  const range = hasRange
    ? lineRangeToOffsets(
        state.content,
        rangeStart,
        Number.isFinite(rangeEnd) && rangeEnd >= rangeStart
          ? rangeEnd
          : rangeStart,
      )
    : null;
  const searchContent = range
    ? state.content.slice(range.startOffset, range.endOffset)
    : state.content;
  let matches = findFlexibleTextMatches(searchContent, oldText);
  let effectiveSearchContent = searchContent;
  let effectiveRange = range;
  if (
    matches.length === 0 &&
    range &&
    args?.auto_range_from_recent_read === true
  ) {
    const fullMatches = findFlexibleTextMatches(state.content, oldText);
    if (fullMatches.length > 0) {
      matches = fullMatches;
      effectiveSearchContent = state.content;
      effectiveRange = null;
    }
  }
  const matchCount = matches.length;

  if (matchCount === 1 || (replaceAll && matchCount > 0)) {
    const applied = applyMatchReplacements(
      effectiveSearchContent,
      matches,
      newText,
      replaceAll,
    );
    if (applied) {
      const afterContent = effectiveRange
        ? `${state.content.slice(0, effectiveRange.startOffset)}${applied.replaced}${state.content.slice(effectiveRange.endOffset)}`
        : applied.replaced;
      await fs.writeFile(state.target, afterContent, "utf8");
      const changedLine = changedLineForMatch(
        state.content,
        effectiveSearchContent,
        applied.firstMatch,
        effectiveRange,
      );
      return editResult(
        relativePath,
        "replace_text",
        state.content,
        afterContent,
        changedLine,
      );
    }
  }

  if (matchCount === 0) {
    throw new Error(
      buildOldTextNotFoundHint(searchContent, oldText, relativePath),
    );
  }

  const baseLine = effectiveRange ? effectiveRange.startLine : 1;
  const baseOffset = effectiveRange ? effectiveRange.startOffset : 0;
  const lineDetails = [];
  for (const match of matches) {
    const pos = match.start;
    const lineNum =
      baseLine + splitLines(effectiveSearchContent.slice(0, pos)).length - 1;
    const globalPos = baseOffset + pos;
    const lStart = state.content.lastIndexOf("\n", globalPos) + 1;
    const lEnd = state.content.indexOf("\n", globalPos);
    const lineText = state.content
      .slice(lStart, lEnd >= 0 ? lEnd : void 0)
      .trim();
    lineDetails.push(`  Line ${lineNum}: ${lineText}`);
  }
  const lineHint =
    lineDetails.length > 0 ? `\n${lineDetails.join("\n")}\n` : " ";
  throw new Error(
    `replace_text old_text not unique; found ${matchCount} occurrences:${lineHint}Use path:"${relativePath}:N-M" to narrow the range, set replace_all=true, or provide more unique old_text`,
  );
}

async function insertRelative(root, args, mode, config = {}) {
  const relativePath = String(args?.path || "").trim();
  const anchorText = String(args?.anchor_text || "");
  const content = String(args?.content || "");
  const state = await getFileState(root, relativePath, config);
  const anchorMatches = findFlexibleTextMatches(state.content, anchorText);
  const occurrences = anchorMatches.length;
  if (occurrences !== 1) {
    throw new Error(
      occurrences === 0
        ? `${mode} anchor not found`
        : `${mode} anchor not unique`,
    );
  }
  const match = anchorMatches[0];
  let afterContent;
  let anchorStart = match.start;
  const originalAnchor = state.content.slice(match.start, match.end);
  const insertContent = applyEol(content, detectEol(originalAnchor));
  const replacement =
    mode === "insert_before"
      ? `${insertContent}${originalAnchor}`
      : `${originalAnchor}${insertContent}`;
  afterContent = `${state.content.slice(0, match.start)}${replacement}${state.content.slice(match.end)}`;
  await fs.writeFile(state.target, afterContent, "utf8");
  const changedLine = splitLines(state.content.slice(0, anchorStart)).length;
  return editResult(
    relativePath,
    mode,
    state.content,
    afterContent,
    changedLine,
  );
}

function commentSyntaxForFile(file = "") {
  const ext = path.extname(String(file || "").toLowerCase());
  if (
    [
      ".py",
      ".rb",
      ".sh",
      ".bash",
      ".zsh",
      ".ps1",
      ".psm1",
      ".yaml",
      ".yml",
      ".toml",
    ].includes(ext)
  ) {
    return { prefix: "# ", suffix: "" };
  }
  if ([".html", ".htm", ".xml", ".svg", ".vue", ".svelte"].includes(ext)) {
    return { prefix: "<!-- ", suffix: " -->" };
  }
  if ([".css", ".scss", ".sass", ".less"].includes(ext)) {
    return { prefix: "/* ", suffix: " */" };
  }
  if ([".sql"].includes(ext)) {
    return { prefix: "-- ", suffix: "" };
  }
  if (
    [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".mjs",
      ".cjs",
      ".java",
      ".c",
      ".cpp",
      ".cc",
      ".cxx",
      ".h",
      ".hpp",
      ".cs",
      ".go",
      ".rs",
      ".swift",
      ".kt",
      ".kts",
      ".scala",
      ".m",
      ".mm",
      ".dart",
      ".php",
    ].includes(ext)
  ) {
    return { prefix: "/* ", suffix: " */" };
  }
  return { prefix: "// ", suffix: "" };
}

function formatCodeCommentLines(comment, file, indent = "") {
  const rawLines = String(comment || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (rawLines.length === 0)
    throw new Error("add_code_comment requires comment text");
  const { prefix, suffix } = commentSyntaxForFile(file);
  return rawLines.map((line) => `${indent}${prefix}${line}${suffix}`);
}

function isCodeCommentLine(line, file) {
  const trimmed = String(line || "").trim();
  if (!trimmed) return true;
  const { prefix, suffix } = commentSyntaxForFile(file);
  const normalizedPrefix = prefix.trim();
  const normalizedSuffix = suffix.trim();
  if (normalizedPrefix && trimmed.startsWith(normalizedPrefix)) {
    return !normalizedSuffix || trimmed.endsWith(normalizedSuffix);
  }
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("--") ||
    (trimmed.startsWith("/*") && trimmed.endsWith("*/")) ||
    (trimmed.startsWith("<!--") && trimmed.endsWith("-->"))
  );
}

async function addCodeComment(root, args, config = {}) {
  const relativePath = normalizeFilePathValue(
    args?.path || args?.file || args?.file_path || "",
    { stripInlineRange: true },
  ).trim();
  if (!relativePath) throw new Error("add_code_comment requires path");
  const state = await getFileState(root, relativePath, config);
  const eol = state.content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(state.content);
  const lines = state.content.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();

  const position =
    String(args?.position || "before")
      .trim()
      .toLowerCase() === "after"
      ? "after"
      : "before";
  const requestedLine = Number(args?.line);
  const anchorText = String(args?.anchor_text || "").trim();
  let targetIndex = -1;

  if (Number.isFinite(requestedLine) && requestedLine >= 1) {
    targetIndex = Math.min(
      lines.length,
      Math.max(0, Math.floor(requestedLine) - 1),
    );
  } else if (anchorText) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(anchorText)) matches.push(index);
    }
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "add_code_comment anchor not found"
          : "add_code_comment anchor not unique",
      );
    }
    targetIndex = matches[0];
  } else {
    throw new Error("add_code_comment requires line or anchor_text");
  }

  const referenceLine =
    lines[Math.min(targetIndex, Math.max(0, lines.length - 1))] || "";
  const indent = referenceLine.match(/^\s*/)?.[0] || "";
  const insertAt =
    position === "after"
      ? Math.min(lines.length, targetIndex + 1)
      : targetIndex;
  const commentLines = formatCodeCommentLines(
    args?.comment ?? args?.content,
    relativePath,
    indent,
  );
  const nextLines = [
    ...lines.slice(0, insertAt),
    ...commentLines,
    ...lines.slice(insertAt),
  ];
  const afterContent = `${nextLines.join(eol)}${hadFinalNewline ? eol : ""}`;
  await fs.writeFile(state.target, afterContent, "utf8");
  return editResult(
    relativePath,
    "add_code_comment",
    state.content,
    afterContent,
    insertAt + 1,
  );
}

async function updateCodeComment(root, args, config = {}) {
  const relativePath = normalizeFilePathValue(
    args?.path || args?.file || args?.file_path || "",
    { stripInlineRange: true },
  ).trim();
  if (!relativePath) throw new Error("update_code_comment requires path");
  const state = await getFileState(root, relativePath, config);
  const eol = state.content.includes("\r\n") ? "\r\n" : "\n";
  const hadFinalNewline = /\r?\n$/.test(state.content);
  const lines = state.content.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();

  const anchorText = String(args?.anchor_text || "").trim();
  const startLine = Number(args?.start_line ?? args?.line);
  const endLine = Number(args?.end_line ?? args?.line);
  let startIndex = -1;
  let endIndex = -1;

  if (Number.isFinite(startLine) && startLine >= 1) {
    startIndex = Math.min(
      lines.length - 1,
      Math.max(0, Math.floor(startLine) - 1),
    );
    endIndex =
      Number.isFinite(endLine) && endLine >= startLine
        ? Math.min(lines.length - 1, Math.floor(endLine) - 1)
        : startIndex;
  } else if (anchorText) {
    const matches = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].includes(anchorText)) matches.push(index);
    }
    if (matches.length !== 1) {
      throw new Error(
        matches.length === 0
          ? "update_code_comment anchor not found"
          : "update_code_comment anchor not unique",
      );
    }
    startIndex = matches[0];
    endIndex = matches[0];
  } else {
    throw new Error(
      "update_code_comment requires line, start_line/end_line, or anchor_text",
    );
  }

  const targetLines = lines.slice(startIndex, endIndex + 1);
  if (
    targetLines.length === 0 ||
    targetLines.some((line) => !isCodeCommentLine(line, relativePath))
  ) {
    throw new Error(
      "update_code_comment can only replace existing comment lines",
    );
  }

  const referenceLine =
    targetLines.find((line) => line.trim()) || lines[startIndex] || "";
  const indent = referenceLine.match(/^\s*/)?.[0] || "";
  const commentLines = formatCodeCommentLines(
    args?.comment ?? args?.content ?? args?.new_comment,
    relativePath,
    indent,
  );
  const nextLines = [
    ...lines.slice(0, startIndex),
    ...commentLines,
    ...lines.slice(endIndex + 1),
  ];
  const afterContent = `${nextLines.join(eol)}${hadFinalNewline ? eol : ""}`;
  await fs.writeFile(state.target, afterContent, "utf8");
  return editResult(
    relativePath,
    "update_code_comment",
    state.content,
    afterContent,
    startIndex + 1,
  );
}

async function openTarget(root, args, config = {}) {
  const file = String(args?.file || args?.path || "").trim();
  if (!file) throw new Error("open_target requires file");
  const symbol = String(args?.symbol || "").trim();
  const line = Number(args?.line || 1);
  const mainBlock = symbol
    ? await readSymbolContext(
        root,
        {
          path: file,
          symbol,
          max_related_calls: args?.max_related_calls,
          max_related_imports: args?.max_related_imports,
          max_related_types: args?.max_related_types,
        },
        config,
      )
    : {
        file,
        symbol: "",
        main_block: await readBlock(root, { path: file, line }, config),
        related: { imports: [], local_symbols: [] },
      };
  const block = mainBlock.main_block || mainBlock;
  return {
    file,
    symbol: symbol || undefined,
    main_block: block,
    related: mainBlock.related || { imports: [], local_symbols: [] },
    edit: {
      start_line: block.start_line,
      end_line: block.end_line,
      old_hash: sha256(block.content),
      old_content: block.content,
    },
  };
}

function normalizeEditTargetArgs(args = {}) {
  const rawFile = String(
    args?.file || args?.path || args?.file_path || "",
  ).trim();
  const inlineRange = parseInlineRangePath(rawFile);
  const file = normalizeFilePathValue(rawFile, {
    stripInlineRange: true,
  }).trim();
  const nestedEdit =
    args?.edit && typeof args.edit === "object" ? args.edit : null;
  const startLine = args?.start_line ?? args?.line ?? inlineRange?.start_line;
  const endLine = args?.end_line ?? inlineRange?.end_line ?? args?.line;
  if (nestedEdit) {
    const normalizedEdit = { ...nestedEdit };
    if (normalizedEdit.new_content == null && normalizedEdit.content != null) {
      normalizedEdit.new_content = normalizedEdit.content;
    }
    if (normalizedEdit.old_text == null && normalizedEdit.old_string != null) {
      normalizedEdit.old_text = normalizedEdit.old_string;
    }
    if (
      normalizedEdit.new_text == null &&
      normalizedEdit.content != null &&
      normalizedEdit.old_text != null
    ) {
      normalizedEdit.new_text = normalizedEdit.content;
    }
    if (normalizedEdit.new_text == null && normalizedEdit.new_string != null) {
      normalizedEdit.new_text = normalizedEdit.new_string;
    }
    return {
      path: file,
      file,
      start_line: startLine,
      end_line: endLine,
      ast_target: normalizedEdit.ast_target ?? args?.ast_target,
      edit: normalizedEdit,
    };
  }
  const topLevelOldText = args?.old_text ?? args?.old_string;
  const topLevelContent = args?.content;
  return {
    path: file,
    file,
    start_line: startLine,
    end_line: endLine,
    ast_target: args?.ast_target,
    edit: {
      kind: args?.kind,
      target: args?.target,
      new_content: args?.new_content ?? args?.content,
      old_text: args?.old_text,
      new_text:
        args?.new_text ??
        (topLevelOldText != null && topLevelContent != null
          ? topLevelContent
          : undefined),
      old_string: args?.old_string,
      new_string: args?.new_string,
      anchor_text: args?.anchor_text,
      content: args?.content,
      replace_all: args?.replace_all ?? args?.replaceAll,
    },
  };
}

async function editTarget(root, args, config = {}) {
  const normalized = normalizeEditTargetArgs(args);
  const file =
    normalized.file ||
    normalizeFilePathValue(args?.recent_file || "", {
      stripInlineRange: true,
    }).trim();
  const astTarget = normalized.ast_target;
  const edit = normalized.edit || {};
  let kind = String(edit.kind || "").trim();
  if (edit.old_text == null && edit.old_string != null) {
    edit.old_text = edit.old_string;
  }
  if (edit.new_text == null && edit.new_string != null) {
    edit.new_text = edit.new_string;
  }
  const hasContent = edit.new_content != null || edit.content != null;
  const hasExplicitRewrite =
    edit.kind === "rewrite_file" || args?.kind === "rewrite_file";
  const hasTargetHint = Boolean(
    edit.symbol || args?.symbol || edit.line || args?.line || edit.target,
  );
  if (!kind) {
    if (hasContent && hasTargetHint) {
      kind = "replace_block";
    } else if (
      edit.old_text != null &&
      (edit.new_text != null || edit.content != null)
    ) {
      kind = "replace_text";
    } else if (
      (edit.anchor_text != null || edit.target_text != null) &&
      (edit.content != null || edit.new_content != null)
    ) {
      kind =
        String(edit.position || edit.mode || args?.position || "").trim() ===
        "after"
          ? "insert_after"
          : "insert_before";
    } else if (hasContent && hasExplicitRewrite) {
      kind = "rewrite_file";
    }
  }
  if (!file || !kind) {
    const recentFile = String(args?.recent_file || "").trim();
    const rawArgs =
      typeof args?._raw === "string" && args._raw.trim()
        ? ` Raw tool arguments: ${args._raw.trim()}.`
        : "";
    const missing = !file
      ? "file path"
      : edit.old_text != null && edit.new_text == null && edit.content == null
        ? "new_text"
        : "edit operation";
    const hint = recentFile
      ? ` If you meant the recently read file ${recentFile}, use edit with {file:"${recentFile}", old_text:"...", new_text:"..."} for a text replacement, or {file:"${recentFile}", kind:"rewrite_file", new_content:"..."} for a full rewrite.`
      : ' Use edit with {file:"path", old_text:"...", new_text:"..."} for a text replacement, or {file:"path", kind:"rewrite_file", new_content:"..."} for a full rewrite.';
    throw new Error(`edit requires ${missing}.${rawArgs}${hint}`);
  }
  if (astTarget) {
    if (kind !== "replace_block") {
      throw new Error("AST-scoped edit only supports replace_block");
    }
    const resolved = await resolveAstTarget(root, file, astTarget);
    const beforeContent = resolved.content;
    const node = resolved.node;
    const afterContent = `${beforeContent.slice(0, node.startIndex)}${edit.new_content || ""}${beforeContent.slice(node.endIndex)}`;
    await fs.writeFile(resolved.absolutePath, afterContent, "utf8");
    resolved.tree.delete();
    resolved.parser.delete();
    return editResult(
      file,
      "replace_block",
      beforeContent,
      afterContent,
      node.startPosition.row + 1,
    );
  }
  if (kind === "replace_block") {
    const resolvedTarget =
      edit.target ||
      (
        await openTarget(
          root,
          {
            file,
            symbol: edit.symbol || args?.symbol,
            line: edit.line || args?.line,
          },
          config,
        )
      ).edit;
    try {
      return await replaceBlock(
        root,
        {
          path: file,
          target: resolvedTarget,
          new_content: edit.new_content,
        },
        config,
      );
    } catch (error) {
      if (!/old_hash mismatch/i.test(String(error?.message || ""))) throw error;
      const validation = await validateEdit(
        root,
        {
          path: file,
          kind: "replace_block",
          target: resolvedTarget,
        },
        config,
      );
      return replaceBlock(
        root,
        {
          path: file,
          target: validation.target,
          new_content: edit.new_content,
        },
        config,
      );
    }
  }
  if (kind === "replace_text") {
    return replaceText(
      root,
      {
        path: file,
        old_text: edit.old_text,
        new_text: edit.new_text,
        replace_all: edit.replace_all ?? args?.replace_all ?? args?.replaceAll,
        start_line: edit.start_line ?? normalized.start_line,
        end_line: edit.end_line ?? normalized.end_line,
        auto_range_from_recent_read: args?.auto_range_from_recent_read === true,
      },
      config,
    );
  }
  if (kind === "insert_before") {
    return insertRelative(
      root,
      { path: file, anchor_text: edit.anchor_text, content: edit.content },
      "insert_before",
      config,
    );
  }
  if (kind === "insert_after") {
    return insertRelative(
      root,
      { path: file, anchor_text: edit.anchor_text, content: edit.content },
      "insert_after",
      config,
    );
  }
  if (kind === "rewrite_file") {
    const state = await getFileState(root, file, config);
    const afterContent = String(edit.new_content ?? edit.content ?? "");
    await fs.writeFile(state.target, afterContent, "utf8");
    return editResult(file, "rewrite_file", state.content, afterContent, 1);
  }
  throw new Error(`edit does not support kind: ${kind}`);
}

export function getBuiltinTools({
  workspaceRoot = process.cwd(),
  config,
  onSystemEvent,
  getTodos,
  onTodosUpdate,
  getPlanState,
  onPlanStateUpdate,
  onCreatePlan,
  onCreateSpec,
  fffAdapter,
  backupManager,
}) {
  const emitSystemTool = (event) => {
    if (typeof onSystemEvent === "function" && event) onSystemEvent(event);
  };
  const astSelectionCache = new Map();
  let lastAstTarget = null;
  let lastReadPath = "";
  let lastReadRange = null;
  const rememberAstSelection = (filePath, astTarget) => {
    const key = normalizePath(filePath).trim();
    if (!key || !astTarget) return;
    lastAstTarget = astTarget;
    astSelectionCache.set(key, astTarget);
  };
  const hasExplicitBlockHints = (args = {}) =>
    Boolean(
      args?.ast_target ||
      args?.symbol ||
      args?.line ||
      args?.target ||
      args?.edit?.ast_target ||
      args?.edit?.symbol ||
      args?.edit?.line ||
      args?.edit?.target,
    );
  const resolveCachedAstTarget = (
    args = {},
    { requireAstScope = false } = {},
  ) => {
    const file = normalizeFilePathValue(
      args?.path ||
        args?.file ||
        args?.file_path ||
        args?.ast_target?.path ||
        "",
      { stripInlineRange: true },
    ).trim();
    if (args?.ast_target) return args.ast_target;
    if (file) {
      if (requireAstScope && hasExplicitBlockHints(args)) return null;
      return astSelectionCache.get(file) || null;
    }
    return lastAstTarget || null;
  };
  const ensureProjectIndex = async () => {
    const eventId = `project-index:${Date.now()}`;
    const name =
      "project_index(.codemini/project-map.json,.codemini/file-index.json)";
    try {
      const result = await initializeProjectIndex(workspaceRoot);
      if (result?.skipped || !result?.summary) {
        return result;
      }
      emitSystemTool({
        type: "system_tool:end",
        id: eventId,
        name,
        summary: result?.summary,
      });
      return result;
    } catch (error) {
      emitSystemTool({
        type: "system_tool:error",
        id: eventId,
        name,
        summary: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  const refreshProjectFile = async (filePath) => {
    const relativePath = String(filePath || "").trim();
    if (!relativePath) return null;
    const eventId = `file-index:${relativePath}:${Date.now()}`;
    const name = `file_index(${relativePath})`;
    try {
      const result = await refreshIndexedFile(workspaceRoot, relativePath);
      if (!result?.summary) {
        return result;
      }
      emitSystemTool({
        type: "system_tool:end",
        id: eventId,
        name,
        summary: result?.summary || `updated .codemini for ${relativePath}`,
      });
      return result;
    } catch (error) {
      emitSystemTool({
        type: "system_tool:error",
        id: eventId,
        name,
        summary: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  };
  const codeWikiCommentToolDefinitions = [
    {
      type: "function",
      function: {
        name: "add_code_comment",
        description:
          "Add comment-only documentation to an existing code file. This tool may only insert comment lines; it cannot change executable code. Provide path plus either line or anchor_text, and comment text. Use position before/after to choose insertion side.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path to annotate." },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            line: { type: "number", description: "1-based line to annotate." },
            anchor_text: {
              type: "string",
              description:
                "Unique text on the line to annotate when line is not provided.",
            },
            comment: {
              type: "string",
              description:
                "Plain comment text. The tool will apply the correct code comment syntax.",
            },
            content: { type: "string", description: "Alias for comment" },
            position: {
              type: "string",
              enum: ["before", "after"],
              description:
                "Insert before or after the target line. Defaults to before.",
            },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_code_comment",
        description:
          "Replace existing code comments only. The target line or range must already be comment-only lines; the tool formats the replacement as comments and refuses executable-code targets.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description: "File path containing the comment to update.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            line: {
              type: "number",
              description: "1-based comment line to replace.",
            },
            start_line: {
              type: "number",
              description: "1-based start line for a comment-only range.",
            },
            end_line: {
              type: "number",
              description: "1-based end line for a comment-only range.",
            },
            anchor_text: {
              type: "string",
              description:
                "Unique text on the comment line to replace when line is not provided.",
            },
            comment: {
              type: "string",
              description: "Replacement plain comment text.",
            },
            new_comment: { type: "string", description: "Alias for comment" },
            content: { type: "string", description: "Alias for comment" },
          },
          required: ["path"],
        },
      },
    },
  ];
  const primaryDefinitions = [
    {
      type: "function",
      function: {
        name: "read",
        description:
          'Inspect code or text files before generating or editing code. Use search_code first to locate the file/range or ast_target, then read that precise context. Use {path} for normal reads; file_path/file are accepted aliases. Use start_line/end_line or path:"src/app.ts:10-40" for ranges. If ast_target comes from search_code structure results, read returns the exact structural node. Normal code reads include enclosing symbol metadata when available; read with query is a Tree-sitter-query fallback that returns the matched AST node and ast_target.',
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "File path to read. You can also include an inline range like src/app.ts:10-40.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            start_line: { type: "number", description: "1-based start line" },
            end_line: { type: "number", description: "Inclusive end line" },
            max_chars: { type: "number", description: "Max chars to return" },
            ast_target: {
              type: "object",
              description:
                "AST target from search_code structure results, ast_grep, ast_query, or a prior AST selection. When provided, read returns that node instead of a line window.",
            },
            query: {
              type: "string",
              description:
                "Optional Tree-sitter query to run inline before reading the first matched AST node. Prefer search_code for normal search; use query when you need Tree-sitter capture syntax.",
            },
            capture_name: {
              type: "string",
              description:
                "Optional capture name to select when query is provided.",
            },
            include_ast_context: {
              type: "boolean",
              description:
                "For AST reads, include compact parent/child summaries. Defaults to true.",
            },
            language: {
              type: "string",
              description:
                "Optional Tree-sitter language override for AST reads or inline queries.",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_code",
        description:
          "Find code locations before reading or editing. This is the default search entry point: it routes plain text to ripgrep, symbols to the project index, and structure patterns to ast-grep. Results are concise locations with ranges/previews; follow with read on the returned file/range or ast_target.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                "Search text, symbol name, or structural ast-grep pattern.",
            },
            q: { type: "string", description: "Alias for query" },
            mode: {
              type: "string",
              enum: ["auto", "text", "symbol", "structure", "file"],
              description: "Search mode. Defaults to auto.",
            },
            intent: {
              type: "string",
              enum: ["auto", "text", "symbol", "structure", "file"],
              description: "Alias for mode.",
            },
            path: {
              type: "string",
              description:
                "Optional directory or file to search. file_path/file/dir/directory/cwd are accepted aliases.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            dir: { type: "string", description: "Alias for path" },
            directory: { type: "string", description: "Alias for path" },
            language: {
              type: "string",
              description:
                "Optional language filter such as js, ts, java, python, or go.",
            },
            lang: { type: "string", description: "Alias for language" },
            max_results: {
              type: "number",
              description: "Max locations to return. Defaults to 20.",
            },
            include_preview: {
              type: "boolean",
              description: "Include short code previews. Defaults to true.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit",
        description:
          'Edit existing files after reading enough surrounding code. Prefer search_code → read → edit. Use {path, old_text, new_text}; old_string/new_string and file_path/file are accepted aliases. For structural replacements, prefer search_code({mode:"structure"}) → read({ast_target}) → edit({ast_target, kind:"replace_block", content}). If old_text is repeated, use path:"file:10-30" or rely on the most recent read range. Set replace_all=true to replace every match.',
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "File path to edit. Inline ranges like src/app.js:10-30 are accepted.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            new_content: { type: "string", description: "Replacement content" },
            old_text: { type: "string", description: "Exact text to replace" },
            new_text: { type: "string", description: "Replacement text" },
            old_string: { type: "string", description: "Alias for old_text" },
            new_string: { type: "string", description: "Alias for new_text" },
            replace_all: {
              type: "boolean",
              description: "Replace all matching old_text occurrences",
            },
            start_line: {
              type: "number",
              description: "Optional range start for disambiguating old_text",
            },
            end_line: {
              type: "number",
              description: "Optional range end for disambiguating old_text",
            },
            anchor_text: {
              type: "string",
              description: "Anchor text for inserts",
            },
            content: {
              type: "string",
              description: "Content to insert or append",
            },
            position: { type: "string", description: "before or after" },
            kind: {
              type: "string",
              description:
                "replace_block, replace_text, insert_before, insert_after, or rewrite_file",
            },
            target: {
              type: "object",
              description: "Location object with symbol or line info",
            },
            ast_target: {
              type: "object",
              description:
                "AST target from search_code structure results, ast_grep, ast_query, or a prior AST selection",
            },
            symbol: { type: "string", description: "Symbol to target" },
            line: { type: "number", description: "Line to target" },
            edit: { type: "object", description: "Structured edit input" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "create",
        description:
          "Create a new file. Always include path and content; file_path/file are accepted aliases. For modifying existing files, use edit instead. Target must not already exist.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Required file path like src/app.js or pages/index.html. Never omit this.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            content: { type: "string", description: "File content" },
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete",
        description:
          "Delete a file or directory inside the workspace. Missing targets fail. Workspace escape attempts are rejected.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "File or directory path to delete. file_path/file/target are accepted aliases.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            target: { type: "string", description: "Alias for path" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_plan",
        description:
          "Read the structured plan state for the current session. Use this to recover plan progress after transient model/tool errors before continuing implementation.",
        parameters: {
          type: "object",
          properties: {
            include_steps: {
              type: "boolean",
              description:
                "Include normalized plan steps in the output (default: true)",
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_plan",
        description:
          "Synchronize progress for an existing structured plan state after an interruption. This tool cannot create a plan or manage spec approvals; use create_plan/create_spec in coding mode for new workflows. Use clear=true only to remove existing plan state.",
        parameters: {
          type: "object",
          properties: {
            clear: {
              type: "boolean",
              description: "Set true to clear current existing plan state",
            },
            plan: {
              type: "object",
              properties: {
                status: {
                  type: "string",
                  description:
                    "Progress status for an existing plan: draft, ready, running, completed, or failed.",
                },
                source: {
                  type: "string",
                  description: "Existing plan source such as auto/manual/tool",
                },
                goal: {
                  type: "string",
                  description: "Original user goal for the existing plan",
                },
                filePath: {
                  type: "string",
                  description: "Existing plan markdown file path",
                },
                summary: {
                  type: "string",
                  description: "Short progress summary for the existing plan",
                },
                finalSummary: {
                  type: "string",
                  description: "Final progress summary for the existing plan",
                },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      role: { type: "string" },
                      task: { type: "string" },
                    },
                  },
                },
              },
            },
            status: {
              type: "string",
              description:
                "Top-level alias for plan.status when plan is omitted",
            },
            source: {
              type: "string",
              description:
                "Top-level alias for existing plan.source when plan is omitted",
            },
            goal: {
              type: "string",
              description:
                "Top-level alias for existing plan.goal when plan is omitted",
            },
            filePath: {
              type: "string",
              description:
                "Top-level alias for existing plan.filePath when plan is omitted",
            },
            summary: {
              type: "string",
              description:
                "Top-level alias for existing plan.summary when plan is omitted",
            },
            finalSummary: {
              type: "string",
              description:
                "Top-level alias for existing plan.finalSummary when plan is omitted",
            },
            steps: {
              type: "array",
              description:
                "Top-level alias for existing plan.steps when plan is omitted",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  role: { type: "string" },
                  task: { type: "string" },
                },
              },
            },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "update_todos",
        description:
          "Create or replace the structured todo checklist for the current session. Use this proactively for complex single-task work to track progress. Provide the full current list each time, and keep exactly one item in_progress when work is actively underway.",
        parameters: {
          type: "object",
          properties: {
            todos: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  content: {
                    type: "string",
                    description: 'Imperative task text such as "Run tests"',
                  },
                  activeForm: {
                    type: "string",
                    description:
                      'Present continuous form such as "Running tests"',
                  },
                  status: {
                    type: "string",
                    description: "pending, in_progress, or completed",
                  },
                },
                required: ["content", "activeForm", "status"],
              },
              description: "The full current todo checklist for this session",
            },
          },
          required: ["todos"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run",
        description:
          "Run a shell command. Use this for one-shot commands like install/build/test, and also for long-running commands by setting run_in_background=true. Long-running commands may also be backgrounded automatically.",
        parameters: {
          type: "object",
          properties: {
            command: {
              type: "string",
              description: "Shell command to execute",
            },
            timeout: { type: "number", description: "Timeout in milliseconds" },
            run_in_background: {
              type: "boolean",
              description:
                "Run in the background and return a task handle immediately",
            },
            startup_timeout_ms: {
              type: "number",
              description: "Background startup wait window in milliseconds",
            },
            success_matchers: {
              type: "array",
              items: { type: "string" },
              description:
                "Optional startup success phrases to look for in command output",
            },
            port_probe: {
              type: "number",
              description: "Optional localhost port to probe for readiness",
            },
            http_probe: {
              type: "object",
              properties: {
                url: { type: "string" },
                expect_status: { type: "number" },
              },
              description:
                "Optional HTTP readiness probe for a background task",
            },
          },
          required: ["command"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "tool_search",
        description:
          "Load one deferred tool schema by name. Use this when a needed tool is not in the current tool list. Skill discovery uses the always-available skill tool instead of tool_search.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: 'Tool name to load, or "all"',
            },
          },
          required: ["query"],
        },
      },
    },
    SKILL_TOOL_DEFINITION,
  ];

  const workflowToolDefinitions = [];
  if (typeof onCreatePlan === "function") {
    workflowToolDefinitions.push({
      type: "function",
      function: {
        name: "create_plan",
        description:
          "Create and execute a structured implementation plan in coding mode. Use when the goal, scope, and constraints are already clear enough to break work into sub-agent execution steps. Do not call for simple localized changes; implement those directly with edit/create/delete instead. Do not call if important details are still unknown or if a design spec is still needed. Assign roles correctly: explorer/architect/advisor are read-only; coder/refactorer/writer implement changes; never assign explorer to implement or edit code.",
        parameters: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description: "Clear, scoped goal for the plan",
            },
            readiness: {
              type: "string",
              enum: ["ready"],
              description:
                'Must be "ready" when requirements are sufficiently clear',
            },
            assumptions: {
              type: "array",
              items: { type: "string" },
              description:
                "Explicit assumptions made because details were inferred",
            },
            context_summary: {
              type: "string",
              description: "Brief summary of what was learned from exploration",
            },
            steps: {
              type: "array",
              description:
                "Optional explicit sub-agent execution steps. Provide this when you can assign concrete roles and tasks directly.",
              items: {
                type: "object",
                properties: {
                  title: {
                    type: "string",
                    description: "Concrete step title tied to the goal",
                  },
                  role: {
                    type: "string",
                    description:
                      "explorer, architect, advisor, coder, refactorer, reviewer, tester, debugger, writer, or summarizer",
                  },
                  task: {
                    type: "string",
                    description:
                      "Executable handoff task with target files/modules, expected result, and scope boundaries",
                  },
                  target_files: {
                    type: "array",
                    items: { type: "string" },
                    description: "Known target files/modules for this step",
                  },
                  success_criteria: {
                    type: "string",
                    description: "Observable completion criteria for this step",
                  },
                  verification: {
                    type: "string",
                    description:
                      "How this step or a later tester should verify the outcome",
                  },
                  handoff: {
                    type: "string",
                    description: "What this step must hand to the next step",
                  },
                },
                required: ["title", "role", "task"],
              },
            },
          },
          required: ["goal", "readiness"],
        },
      },
    });
  }
  const specSectionSchema = (heading) => ({
    type: "object",
    description: `${heading} section. Fill only when supported by exploration evidence; omit when unknown.`,
    properties: {
      goal: {
        type: "string",
        description: "One concise goal for this section",
      },
      summary: {
        type: "string",
        description: "Concrete summary for this section",
      },
      requirements: {
        type: "array",
        items: { type: "string" },
        description: "Requirements or facts for this section",
      },
      acceptance_criteria: {
        type: "array",
        items: { type: "string" },
        description: "Observable acceptance checks",
      },
      notes: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional evidence, file names, constraints, or open points",
      },
    },
    required: [],
  });
  const specSectionProperties = {
    summary: specSectionSchema("Summary"),
    goals: specSectionSchema("Goals"),
    non_goals: specSectionSchema("Non-Goals"),
    user_experience: specSectionSchema("User Experience / Command Behavior"),
    architecture: specSectionSchema("Architecture"),
    data_state_model: specSectionSchema("Data / State Model"),
    safety_rules: specSectionSchema("Safety Rules"),
    requirements: specSectionSchema("Requirements"),
    risks_mitigations: specSectionSchema("Risks and Mitigations"),
    testing_validation: specSectionSchema("Testing / Validation"),
  };
  if (typeof onCreateSpec === "function") {
    workflowToolDefinitions.push({
      type: "function",
      function: {
        name: "create_spec",
        description:
          "Create an engineering spec document for user approval. Use when scope, architecture, UX, or constraints still need alignment before implementation. Prefer this over create_plan for large, novel, or cross-cutting work. If details are too unknown to write a reviewable spec, ask one focused clarifying question instead. If trade-offs, constraints, or open risks can be stated clearly, include them in the spec for approval. Populate the structured section fields directly from explored evidence; do not put section content into assumptions.",
        parameters: {
          type: "object",
          properties: {
            topic: {
              type: "string",
              description: "Clear, scoped feature or change to specify",
            },
            readiness: {
              type: "string",
              enum: ["ready"],
              description:
                'Must be "ready" when requirements are sufficiently clear',
            },
            assumptions: {
              type: "array",
              items: { type: "string" },
              description:
                "Only explicit assumptions or inferred unknowns. Do not place explored requirements, architecture, or validation details here.",
            },
            context_summary: {
              type: "string",
              description: "Brief summary of what was learned from exploration",
            },
            ...specSectionProperties,
          },
          required: ["topic", "readiness"],
        },
      },
    });
  }

  const deferredDefinitions = {
    grep: {
      type: "function",
      function: {
        name: "grep",
        description:
          "Low-level plain text search. Prefer search_code unless you specifically need raw grep/ripgrep-style output.",
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description: "Plain text or regex search pattern",
            },
            query: { type: "string", description: "Alias for pattern" },
            path: {
              type: "string",
              description:
                "Directory or file to search. file_path/file/dir/directory/cwd are accepted aliases.",
            },
            regex: { type: "boolean", description: "Treat pattern as regex" },
            case_sensitive: {
              type: "boolean",
              description: "Case-sensitive matching",
            },
            max_results: {
              type: "number",
              description: "Max matches to return",
            },
            language: { type: "string", description: "Filter by language" },
            file_types: {
              type: "array",
              items: { type: "string" },
              description: "Filter by file glob",
            },
          },
          required: ["pattern"],
        },
      },
    },
    ast_grep: {
      type: "function",
      function: {
        name: "ast_grep",
        description:
          'Low-level structural ast-grep search. Prefer search_code({mode:"structure"}) unless you need raw ast-grep results or advanced pattern debugging.',
        parameters: {
          type: "object",
          properties: {
            pattern: {
              type: "string",
              description:
                'ast-grep structural pattern, such as "function $A($$$) { $$$ }", "class $A { $$$ }", "$A($$$)", or "<$A $$$ />". query is accepted as an alias.',
            },
            query: { type: "string", description: "Alias for pattern" },
            path: {
              type: "string",
              description:
                "Directory or file to search. Defaults to workspace root.",
            },
            file_path: { type: "string", description: "Alias for path" },
            file: { type: "string", description: "Alias for path" },
            dir: { type: "string", description: "Alias for path" },
            directory: { type: "string", description: "Alias for path" },
            language: {
              type: "string",
              description:
                "Optional language filter such as js, ts, tsx, html, css, python, go, c, cpp, bash, java, rust, csharp, php, or ruby.",
            },
            max_results: {
              type: "number",
              description: "Max structural matches to return",
            },
          },
          required: [],
        },
      },
    },
    list: {
      type: "function",
      function: {
        name: "list",
        description:
          "Low-level directory listing. Prefer search_code for code discovery and load this only when you need to inspect directory contents.",
        parameters: {
          type: "object",
          properties: {
            path: {
              type: "string",
              description:
                "Directory path to list. file_path/file/dir/directory are accepted aliases.",
            },
            include_hidden: {
              type: "boolean",
              description: "Include dotfiles",
            },
          },
        },
      },
    },
    query_project_index: {
      type: "function",
      function: {
        name: "query_project_index",
        description:
          'Low-level project index query. Prefer search_code({mode:"symbol"}) unless you need raw Symbol Graph summaries.',
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description:
                'Task or code search phrase such as "login auth" or "tui presenters"',
            },
            path: {
              type: "string",
              description:
                "Optional path prefix like src or src/auth to narrow results",
            },
            path_prefix: { type: "string", description: "Alias for path" },
            language: {
              type: "string",
              description:
                "Optional language filter such as ts, js, python, or go",
            },
            max_results: {
              type: "number",
              description: "Max result files to return",
            },
          },
        },
      },
    },
    glob: {
      type: "function",
      function: {
        name: "glob",
        description:
          "Find files by glob pattern. Use this when you already know a filename pattern such as src/**/*.ts.",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string", description: "Glob pattern" },
            path: { type: "string", description: "Directory to search" },
            include_hidden: {
              type: "boolean",
              description: "Include dotfiles",
            },
            max_results: { type: "number", description: "Max results" },
          },
          required: ["pattern"],
        },
      },
    },
    ast_query: {
      type: "function",
      function: {
        name: "ast_query",
        description:
          "Run a Tree-sitter query on a code file and return ast_target objects. Use this for advanced AST workflows such as multi-match selection, explicit node caching, or when you plan to reuse ast_target across follow-up reads or edits. For a common one-shot function, class, or method read, prefer read(path, query=...) or read(ast_target=...).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            language: { type: "string" },
            query: { type: "string" },
            capture_name: { type: "string" },
            max_results: { type: "number" },
          },
          required: ["path", "query"],
        },
      },
    },
    read_ast_node: {
      type: "function",
      function: {
        name: "read_ast_node",
        description:
          "Read a previously selected AST node with compact structural context. Use this after ast_query when you want an explicit follow-up read of a cached node before a scoped structural edit. For common one-shot AST reads, prefer read(ast_target=...) or read(path, query=...).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            language: { type: "string" },
            ast_target: { type: "object" },
          },
          required: ["path", "ast_target"],
        },
      },
    },
    web_fetch: {
      type: "function",
      function: {
        name: "web_fetch",
        description:
          "Fetch and read a live web page. Uses a lightweight fetch + Cheerio reader by default, then falls back to optional Playwright browser rendering for JavaScript-heavy pages when Playwright is installed. Use this for direct URL reads, not for keyword search.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "Absolute http or https URL to fetch",
            },
            href: { type: "string", description: "Alias for url" },
            timeout_ms: {
              type: "number",
              description: "Navigation timeout in milliseconds",
            },
            wait_until: {
              type: "string",
              description: "domcontentloaded, load, or networkidle",
            },
            max_links: {
              type: "number",
              description: "Max number of links to extract from the page",
            },
          },
          required: ["url"],
        },
      },
    },
    web_search: {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Run a live web search by fetching Bing RSS results. Use this for keyword-based internet search. This tool respects config.web.search_enabled and will fail when network search is disabled.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query" },
            q: { type: "string", description: "Alias for query" },
            max_results: {
              type: "number",
              description: "Max results to return",
            },
            locale: {
              type: "string",
              description: "Bing market and language such as en-US or zh-CN",
            },
            region: {
              type: "string",
              description: "Bing country code such as US or CN",
            },
          },
          required: ["query"],
        },
      },
    },
    save_memory: {
      type: "function",
      function: {
        name: "save_memory",
        description:
          "Save a durable observation or knowledge to persistent memory. Use this when you notice a reusable pattern, a user correction, a stable preference, a project convention, or a workflow insight. Do NOT use for casual chatter, trivial typos, one-off noise, or secrets. The memory is saved immediately and available in future sessions.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The knowledge or observation to remember",
            },
            summary: {
              type: "string",
              description:
                "Short summary for the memory index (under 80 chars)",
            },
            scope: {
              type: "string",
              description:
                'Where to store this memory. "user" = personal preferences (language, style, interaction habits). "global" = cross-project knowledge useful in ANY repository (environment quirks, general workflows, tool tips). "project" = specific to THIS repository only (architecture conventions, local config, test commands, file locations). Default: "global".',
            },
            kind: {
              type: "string",
              description:
                "Memory kind: preference, pattern, correction, observation, decision, failure, win, gap, convention. Default: observation",
            },
            replace_similar: {
              type: "boolean",
              description:
                "Replace an existing similar memory when true. Default: true.",
            },
          },
          required: ["content"],
        },
      },
    },
    list_memory: {
      type: "function",
      function: {
        name: "list_memory",
        description: "List stored persistent memories for one scope.",
        parameters: {
          type: "object",
          properties: {
            scope: { type: "string", description: "user, global, or project" },
          },
          required: ["scope"],
        },
      },
    },
    search_memory: {
      type: "function",
      function: {
        name: "search_memory",
        description: "Search stored persistent memories for one scope.",
        parameters: {
          type: "object",
          properties: {
            scope: { type: "string", description: "user, global, or project" },
            query: { type: "string", description: "Search phrase" },
          },
          required: ["scope", "query"],
        },
      },
    },
    forget_memory: {
      type: "function",
      function: {
        name: "forget_memory",
        description: "Delete a stored persistent memory by id.",
        parameters: {
          type: "object",
          properties: {
            scope: { type: "string", description: "user, global, or project" },
            id: { type: "string", description: "Memory id to delete" },
          },
          required: ["scope", "id"],
        },
      },
    },
    dream_consolidate: {
      type: "function",
      function: {
        name: "dream_consolidate",
        description:
          "Run a dream loop pass over inbox entries and existing memory buckets. Reads recent inbox items, deduplicates, evaluates lifecycle progression (observed → candidate → operational/longterm), promotes stable patterns into persistent memory, then uses LLM maintenance to merge/summarize/clean stale user/global/project memories when their bucket changed since the last maintenance marker. Writes an audit report. Use during off-hours or explicit maintenance.",
        parameters: {
          type: "object",
          properties: {
            scope: {
              type: "string",
              description: "Optional scope filter: global, repo, or thread",
            },
            dry_run: {
              type: "boolean",
              description:
                "If true, only preview what would change without making changes",
            },
          },
        },
      },
    },
    list_background_tasks: {
      type: "function",
      function: {
        name: "list_background_tasks",
        description:
          "List background shell tasks started by run(..., run_in_background=true) or auto-backgrounded by run.",
        parameters: {
          type: "object",
          properties: {},
        },
      },
    },
    get_background_task: {
      type: "function",
      function: {
        name: "get_background_task",
        description: "Get the current status for one background shell task.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string" },
          },
          required: ["task_id"],
        },
      },
    },
    stop_background_task: {
      type: "function",
      function: {
        name: "stop_background_task",
        description:
          "Stop a running background shell task when it is no longer needed.",
        parameters: {
          type: "object",
          properties: {
            task_id: { type: "string" },
          },
          required: ["task_id"],
        },
      },
    },
  };

  const enableCodeWikiCommentTools =
    config?.runtime?.codewiki_comment_tools === true;
  const definitions = enableCodeWikiCommentTools
    ? [
        ...primaryDefinitions,
        ...workflowToolDefinitions,
        ...codeWikiCommentToolDefinitions,
      ]
    : [...primaryDefinitions, ...workflowToolDefinitions];
  const activeFffAdapter =
    fffAdapter || createFffAdapter({ workspaceRoot, config });
  async function backupNonGitPathOnce(rawPath) {
    if (!backupManager || typeof backupManager.backupOnce !== "function")
      return null;
    const normalized = normalizeFilePathValue(rawPath || "", {
      stripInlineRange: true,
    }).trim();
    if (!normalized) return null;
    try {
      const backup = await backupManager.backupOnce(normalized);
      return backup?.ok ? backup : null;
    } catch (error) {
      return {
        ok: false,
        path: normalized,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  function attachBackup(result, backup) {
    if (!backup || !result || typeof result !== "object") return result;
    return {
      ...result,
      non_git_backup: true,
      backupPath: backup.backupPath || "",
      backupRelativePath: backup.backupRelativePath || "",
      backupCreated: backup.created === true,
      backupReused: backup.reused === true,
      backupSkipped:
        backup.skipped === true ||
        (!backup.backupPath && backup.existed === true),
      backupError: backup.error || "",
      backupReason: backup.reason || "",
    };
  }
  let fffConnected = false;

  async function ensureFffConnected() {
    if (!activeFffAdapter?.connect || fffConnected) return;
    await activeFffAdapter.connect();
    fffConnected = true;
  }

  async function grep(args) {
    const normalizedArgs = normalizePatternArgs(
      args,
      ["query", "symbol", "q"],
      ["directory", "dir", "cwd"],
    );
    if (
      !resolvesOutsideRoot(workspaceRoot, normalizedArgs?.path || ".") &&
      activeFffAdapter?.grep
    ) {
      try {
        await ensureFffConnected();
        const result = await activeFffAdapter.grep(args);
        if (result && Array.isArray(result.matches)) return result;
      } catch {}
    }
    return builtinGrep(workspaceRoot, args, config);
  }

  async function astGrep(args) {
    const normalizedArgs = normalizePatternArgs(
      args,
      ["query", "q"],
      ["directory", "dir", "cwd", "file_path", "file"],
    );
    const result = await queryAstGrep(workspaceRoot, normalizedArgs);
    const firstTarget = result?.matches?.[0]?.ast_target;
    if (firstTarget?.path) rememberAstSelection(firstTarget.path, firstTarget);
    return result;
  }

  function classifyCodeSearchQuery(query) {
    const text = String(query || "").trim();
    if (!text) return "text";
    const looksLikePath =
      /[\\/]/.test(text) ||
      /\.[a-zA-Z0-9]{1,8}$/.test(text) ||
      /(?:package\.json|vite\.config|tsconfig|pom\.xml|build\.gradle)/i.test(
        text,
      );
    if (looksLikePath) return "file";
    const looksLikeAstPattern =
      /\$\w+|\$\$\$/.test(text) ||
      /<\$\w+/.test(text) ||
      /^\s*(function|class|interface|enum|import|export|method|call|useEffect|annotation|decorator|jsx)\b/i.test(
        text,
      ) ||
      /@\$\w+/.test(text);
    if (looksLikeAstPattern) return "structure";
    const looksLikeSymbol =
      /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?$/.test(text) &&
      (/[A-Z]/.test(text) ||
        /(Controller|Service|Mapper|Repository|Store|Provider|Handler|Manager|Client|Util|Config)$/i.test(
          text,
        ));
    if (looksLikeSymbol) return "symbol";
    return "text";
  }

  function enginesForSearchCode(mode, detectedIntent) {
    const normalized = String(mode || "auto")
      .trim()
      .toLowerCase();
    const intent = normalized === "auto" ? detectedIntent : normalized;
    if (intent === "symbol") return ["project-index", "ripgrep"];
    if (intent === "structure") return ["ast-grep", "project-index"];
    if (intent === "file") return ["glob", "project-index"];
    return ["ripgrep"];
  }

  function makeReadNext(result) {
    if (!result?.path) return "";
    if (result.ast_target)
      return `read({ast_target:${JSON.stringify(result.ast_target)}})`;
    if (
      Number.isFinite(Number(result.start_line)) &&
      Number.isFinite(Number(result.end_line))
    ) {
      return `read({path:"${result.path}", start_line:${result.start_line}, end_line:${result.end_line}})`;
    }
    if (Number.isFinite(Number(result.line))) {
      return `read({path:"${result.path}", start_line:${result.line}, end_line:${result.line}})`;
    }
    return `read({path:"${result.path}"})`;
  }

  function scoreSearchCodeResult(result, query) {
    let score = Number(result?.score || 0);
    const q = String(query || "").toLowerCase();
    const resultPath = String(result?.path || "").toLowerCase();
    const preview = String(result?.preview || "").toLowerCase();
    const symbol = String(result?.symbol || "").toLowerCase();
    if (symbol && symbol === q) score += 50;
    if (q && resultPath.includes(q)) score += 35;
    if (q && preview.includes(q)) score += 15;
    if (resultPath.startsWith("src/")) score += 10;
    if (/(^|\/)(test|tests|__tests__)(\/|$)/.test(resultPath)) score -= 10;
    if (/(^|\/)(node_modules|dist|build|coverage)(\/|$)/.test(resultPath))
      score -= 100;
    if (result?.engine === "project-index") score += 20;
    if (result?.kind === "structure") score += 15;
    return score;
  }

  function dedupeAndRankSearchCodeResults(results, query, maxResults) {
    const seen = new Set();
    const deduped = [];
    for (const result of results) {
      const key = [
        result.path || "",
        result.kind || "",
        result.symbol || "",
        result.start_line || result.line || "",
        result.end_line || "",
      ].join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      const scored = { ...result };
      scored.score = scoreSearchCodeResult(scored, query);
      scored.next = scored.next || makeReadNext(scored);
      deduped.push(scored);
    }
    deduped.sort(
      (left, right) =>
        Number(right.score || 0) - Number(left.score || 0) ||
        String(left.path || "").localeCompare(String(right.path || "")),
    );
    return deduped.slice(0, maxResults);
  }

  function compactSymbolSearchMatches(indexResult, maxResults, includePreview) {
    const out = [];
    for (const match of Array.isArray(indexResult?.matches)
      ? indexResult.matches
      : []) {
      const symbols = Array.isArray(match.symbols) ? match.symbols : [];
      if (symbols.length === 0) {
        out.push({
          path: match.file,
          kind: "file",
          language: match.language,
          engine: "project-index",
          score: Number(match.score || 0),
          preview: includePreview
            ? `exports=[${(match.exports || []).join(", ")}] functions=[${(match.functions || []).join(", ")}] classes=[${(match.classes || []).join(", ")}]`
            : undefined,
          next: match.file ? `read({path:"${match.file}"})` : undefined,
        });
      }
      for (const symbol of symbols) {
        out.push({
          path: match.file,
          kind: "symbol",
          language: match.language,
          symbol: symbol.name,
          symbol_id: symbol.symbol_id,
          type: symbol.type,
          start_line: symbol.range?.start_line,
          end_line: symbol.range?.end_line,
          engine: "project-index",
          score: Number(match.score || 0),
          preview: includePreview
            ? symbol.signature || symbol.name || ""
            : undefined,
          next:
            match.file && symbol.range
              ? `read({path:"${match.file}", start_line:${symbol.range.start_line}, end_line:${symbol.range.end_line}})`
              : match.file
                ? `read({path:"${match.file}"})`
                : undefined,
        });
        if (out.length >= maxResults) return out;
      }
      if (out.length >= maxResults) return out;
    }
    return out.slice(0, maxResults);
  }

  function compactTextSearchMatches(grepResult, maxResults, includePreview) {
    return (Array.isArray(grepResult?.matches) ? grepResult.matches : [])
      .slice(0, maxResults)
      .map((match) => ({
        path: match.path,
        kind: "text",
        line: match.line,
        column: match.column,
        engine: grepResult.engine || "ripgrep",
        score: 0,
        preview: includePreview ? match.preview : undefined,
        next: match.path
          ? `read({path:"${match.path}", start_line:${match.line}, end_line:${match.line}})`
          : undefined,
      }));
  }

  function compactStructureSearchMatches(
    astResult,
    maxResults,
    includePreview,
  ) {
    return (Array.isArray(astResult?.matches) ? astResult.matches : [])
      .slice(0, maxResults)
      .map((match) => {
        const target = match.ast_target || {};
        return {
          path: target.path || astResult.path,
          kind: "structure",
          language: target.language,
          symbol: target.name,
          type: match.node_type || target.node_type,
          start_line: match.start_line,
          end_line: match.end_line,
          engine: astResult.engine || "ast-grep",
          score: 0,
          preview: includePreview ? match.text : undefined,
          ast_target: target,
          next: target.path
            ? `read({ast_target:${JSON.stringify(target)}})`
            : undefined,
        };
      });
  }

  function compactFileSearchMatches(globResult, maxResults) {
    return (Array.isArray(globResult?.matches) ? globResult.matches : [])
      .slice(0, maxResults)
      .map((match) => ({
        path: match,
        kind: "file",
        engine: globResult.engine || "glob",
        score: 0,
        preview: match,
        next: `read({path:"${match}"})`,
      }));
  }

  async function searchCode(args = {}) {
    const query = String(args?.query || args?.q || args?.pattern || "").trim();
    if (!query) throw new Error("search_code requires query");
    const requestedMode =
      String(args?.mode || args?.intent || "auto")
        .trim()
        .toLowerCase() || "auto";
    const maxResults = Math.max(
      1,
      Math.min(50, Number(args?.max_results || args?.limit || 20) || 20),
    );
    const includePreview =
      args?.include_preview !== false && args?.includePreview !== false;
    const pathArg =
      args?.path ||
      args?.file_path ||
      args?.file ||
      args?.dir ||
      args?.directory ||
      ".";
    const language = String(args?.language || args?.lang || "").trim();
    const detectedIntent = classifyCodeSearchQuery(query);
    const normalizedMode = [
      "auto",
      "text",
      "symbol",
      "structure",
      "file",
    ].includes(requestedMode)
      ? requestedMode
      : "auto";
    const engines = enginesForSearchCode(normalizedMode, detectedIntent);
    const rawResults = [];
    let truncated = false;

    for (const engine of engines) {
      if (engine === "project-index") {
        await ensureProjectIndex();
        const result = await queryProjectIndex(workspaceRoot, {
          query,
          path: pathArg === "." ? "" : pathArg,
          language,
          max_results: maxResults,
        });
        rawResults.push(
          ...compactSymbolSearchMatches(result, maxResults, includePreview),
        );
        truncated =
          truncated ||
          (Array.isArray(result.matches) &&
            result.matches.length >= maxResults);
      } else if (engine === "ripgrep") {
        const result = await grep({
          pattern: query,
          path: pathArg,
          language,
          max_results: maxResults,
        });
        rawResults.push(
          ...compactTextSearchMatches(result, maxResults, includePreview),
        );
        truncated = truncated || Boolean(result.truncated);
      } else if (engine === "ast-grep") {
        try {
          const result = await astGrep({
            pattern: query,
            path: pathArg,
            language,
            max_results: maxResults,
          });
          rawResults.push(
            ...compactStructureSearchMatches(
              result,
              maxResults,
              includePreview,
            ),
          );
          truncated = truncated || Boolean(result.truncated);
        } catch (error) {
          if (normalizedMode === "structure") throw error;
          rawResults.push({
            path: "",
            kind: "structure",
            engine: "ast-grep",
            score: -100,
            preview: `ast-grep skipped: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      } else if (engine === "glob") {
        const pattern =
          query.includes("*") || query.includes("?") ? query : `**/*${query}*`;
        const result = await glob({ pattern, path: pathArg });
        rawResults.push(...compactFileSearchMatches(result, maxResults));
        truncated = truncated || Boolean(result.truncated);
      }
    }

    const results = dedupeAndRankSearchCodeResults(
      rawResults.filter((item) => item.path),
      query,
      maxResults,
    );
    return {
      query,
      mode: normalizedMode,
      detected_intent: detectedIntent,
      resolved_mode:
        normalizedMode === "auto" ? detectedIntent : normalizedMode,
      engines,
      results,
      matches: results,
      truncated,
    };
  }

  async function glob(args) {
    const normalizedArgs = normalizePatternArgs(
      args,
      ["glob", "query"],
      ["directory", "dir", "cwd"],
    );
    if (
      !resolvesOutsideRoot(workspaceRoot, normalizedArgs?.path || ".") &&
      activeFffAdapter?.glob
    ) {
      try {
        await ensureFffConnected();
        const result = await activeFffAdapter.glob(args);
        if (result && Array.isArray(result.matches)) return result;
      } catch {}
    }
    return builtinGlob(workspaceRoot, args, config);
  }

  async function list(args) {
    const normalizedArgs = normalizePathArgs(args, [
      "dir",
      "directory",
      "file_path",
      "file",
      "target",
    ]);
    if (
      !resolvesOutsideRoot(workspaceRoot, normalizedArgs?.path || ".") &&
      activeFffAdapter?.list
    ) {
      try {
        await ensureFffConnected();
        const result = await activeFffAdapter.list(args);
        if (result && Array.isArray(result.items)) return result;
      } catch {}
    }
    return builtinList(workspaceRoot, args, config);
  }

  const handlers = {
    read: async (args) => {
      const inlineQuery = String(args?.query || "").trim();
      const directAstTarget = args?.ast_target;

      if (directAstTarget) {
        const result = await readAstNode(workspaceRoot, {
          ...args,
          path: args?.path || directAstTarget?.path,
          ast_target: directAstTarget,
        });
        if (directAstTarget?.path)
          rememberAstSelection(directAstTarget.path, directAstTarget);
        const readPath = normalizePath(
          result?.path || directAstTarget?.path || "",
        ).trim();
        if (readPath) {
          lastReadPath = readPath;
          lastReadRange = null;
        }
        if (args?.include_ast_context === false) {
          const { parent_summary, child_summaries, ...rest } = result;
          return { ...rest, ast_target: directAstTarget };
        }
        return { ...result, ast_target: directAstTarget };
      }

      if (inlineQuery) {
        const queryResult = await queryAst(workspaceRoot, args);
        const firstTarget = queryResult?.matches?.[0]?.ast_target;
        if (!firstTarget) {
          return {
            path: String(args?.path || "").trim(),
            language: queryResult?.language,
            query: inlineQuery,
            capture_name: String(args?.capture_name || "").trim() || undefined,
            matches: 0,
            content: "",
          };
        }
        rememberAstSelection(firstTarget.path, firstTarget);
        const result = await readAstNode(workspaceRoot, {
          ...args,
          path: firstTarget.path,
          ast_target: firstTarget,
        });
        const readPath = normalizePath(
          result?.path || firstTarget?.path || "",
        ).trim();
        if (readPath) {
          lastReadPath = readPath;
          lastReadRange = null;
        }
        return {
          path: result.path,
          language: result.language,
          node: result.node,
          content: result.content,
          ...(args?.include_ast_context === false
            ? {}
            : {
                parent_summary: result.parent_summary,
                child_summaries: result.child_summaries,
              }),
          ast_target: firstTarget,
          symbol: {
            symbol_id: `${result.path}#${firstTarget.name || firstTarget.node_type || `${result.node.start_line}-${result.node.end_line}`}`,
            type: result.node.node_type,
            file: result.path,
            range: {
              start_line: result.node.start_line,
              end_line: result.node.end_line,
            },
          },
          query: inlineQuery,
          capture_name: String(args?.capture_name || "").trim() || undefined,
          matches: queryResult.matches.length,
        };
      }

      const result = await readFile(
        workspaceRoot,
        {
          ...args,
          default_lines: config.context?.read_file_default_lines ?? 120,
          max_chars:
            typeof args?.max_chars === "number"
              ? args.max_chars
              : (config.context?.read_file_max_chars ?? 12000),
        },
        config,
      );
      const readPath = normalizePath(result?.path || args?.path || "").trim();
      if (readPath) {
        lastReadPath = readPath;
        lastReadRange =
          result?.phase === "content"
            ? {
                path: readPath,
                start_line: result.start_line,
                end_line: result.end_line,
              }
            : null;
      }
      return result;
    },
    search_code: searchCode,
    query_project_index: async (args) => {
      await ensureProjectIndex();
      return queryProjectIndex(workspaceRoot, args);
    },
    grep,
    ast_grep: astGrep,
    glob,
    list,
    ast_query: async (args) => {
      const result = await queryAst(workspaceRoot, args);
      const firstTarget = result?.matches?.[0]?.ast_target;
      if (firstTarget?.path)
        rememberAstSelection(firstTarget.path, firstTarget);
      return result;
    },
    read_ast_node: (args) => {
      const astTarget = resolveCachedAstTarget(args);
      if (!astTarget)
        throw new Error(
          "read_ast_node requires ast_target or a prior ast_query on the same file",
        );
      if (astTarget.path) rememberAstSelection(astTarget.path, astTarget);
      return readAstNode(workspaceRoot, { ...args, ast_target: astTarget });
    },
    web_fetch: (args) => webFetchPage(args),
    web_search: (args) => webSearchQuery(config, args),
    add_code_comment: async (args) => {
      await ensureProjectIndex();
      const commentPath = normalizeFilePathValue(
        args?.path || args?.file || args?.file_path || "",
        { stripInlineRange: true },
      ).trim();
      const backup = await backupNonGitPathOnce(commentPath);
      const result = await addCodeComment(workspaceRoot, args, config);
      if (result?.path) await refreshProjectFile(result.path);
      return attachBackup(result, backup);
    },
    update_code_comment: async (args) => {
      await ensureProjectIndex();
      const commentPath = normalizeFilePathValue(
        args?.path || args?.file || args?.file_path || "",
        { stripInlineRange: true },
      ).trim();
      const backup = await backupNonGitPathOnce(commentPath);
      const result = await updateCodeComment(workspaceRoot, args, config);
      if (result?.path) await refreshProjectFile(result.path);
      return attachBackup(result, backup);
    },
    edit: async (args) => {
      await ensureProjectIndex();
      const normalizedKind = String(
        args?.edit?.kind || args?.kind || "",
      ).trim();
      const hasReplaceTextArgs =
        args?.edit?.old_text != null ||
        args?.old_text != null ||
        args?.old_string != null;
      const astTarget =
        hasReplaceTextArgs ||
        (normalizedKind && normalizedKind !== "replace_block")
          ? null
          : resolveCachedAstTarget(args, {
              requireAstScope: normalizedKind === "replace_block",
            });
      const editPath = normalizeFilePathValue(
        args?.path ||
          args?.file ||
          args?.file_path ||
          args?.ast_target?.path ||
          args?.edit?.target?.path ||
          "",
        { stripInlineRange: true },
      ).trim();
      const shouldUseRecentReadRange =
        editPath &&
        lastReadRange?.path === editPath &&
        !Number.isFinite(
          Number(args?.start_line || args?.line || args?.edit?.start_line),
        ) &&
        !Number.isFinite(Number(args?.end_line || args?.edit?.end_line));
      const rangeArgs = shouldUseRecentReadRange
        ? {
            start_line: lastReadRange.start_line,
            end_line: lastReadRange.end_line,
            auto_range_from_recent_read: true,
          }
        : {};
      const backup = await backupNonGitPathOnce(editPath || astTarget?.path);
      const result = await editTarget(
        workspaceRoot,
        astTarget
          ? {
              ...args,
              ...rangeArgs,
              ast_target: astTarget,
              recent_file: lastReadPath,
            }
          : { ...args, ...rangeArgs, recent_file: lastReadPath },
        config,
      );
      if (result?.path) await refreshProjectFile(result.path);
      return attachBackup(result, backup);
    },
    create: async (args) => {
      await ensureProjectIndex();
      const createPath = normalizeFilePathValue(
        args?.path || args?.file || args?.file_path || "",
        { stripInlineRange: true },
      ).trim();
      const backup = await backupNonGitPathOnce(createPath);
      const result = await writeFile(workspaceRoot, args, config);
      if (result?.path) await refreshProjectFile(result.path);
      return attachBackup(result, backup);
    },
    delete: Object.assign(
      async (args) => {
        await ensureProjectIndex();
        const deletePathValue = normalizeFilePathValue(
          args?.path || args?.file || args?.file_path || args?.target || "",
          { stripInlineRange: true },
        ).trim();
        const backup = await backupNonGitPathOnce(deletePathValue);
        const result = await deletePath(workspaceRoot, args, config);
        if (result?.path) await refreshProjectFile(result.path);
        return attachBackup(result, backup);
      },
      {
        prepareApproval: async (args) => {
          const target = await prepareDeleteTarget(workspaceRoot, args, config);
          return {
            path: target.path,
            name: target.name,
            type: target.type,
          };
        },
      },
    ),
    update_todos: async (args = {}) => {
      const oldTodos = normalizeTodos(
        typeof getTodos === "function" ? getTodos() : [],
      );
      const nextTodos = normalizeTodos(args?.todos);
      if (typeof onTodosUpdate === "function") {
        onTodosUpdate(nextTodos);
      }
      return {
        ok: true,
        oldTodos,
        newTodos: nextTodos,
      };
    },
    read_plan: async (args = {}) => {
      const includeSteps = args?.include_steps !== false;
      const currentPlan = normalizePlanState(
        typeof getPlanState === "function" ? getPlanState() : null,
      );
      if (!includeSteps && currentPlan && Array.isArray(currentPlan.steps)) {
        const { steps, ...rest } = currentPlan;
        return {
          ok: true,
          plan: rest,
          hasPendingApproval: false,
        };
      }
      return {
        ok: true,
        plan: currentPlan,
        hasPendingApproval: false,
      };
    },
    update_plan: async (args = {}) => {
      const oldPlan = normalizePlanState(
        typeof getPlanState === "function" ? getPlanState() : null,
      );
      const shouldClear = args?.clear === true || args?.plan === null;
      if (!oldPlan && !shouldClear) {
        return {
          ok: false,
          error:
            "update_plan cannot create plan state. Use create_plan/create_spec in plan mode, or provide a normal text plan without tool calls.",
          oldPlan,
          newPlan: oldPlan,
          hasPendingApproval: false,
        };
      }
      const blockedStatuses = new Set([
        "pending_approval",
        "pending_spec_approval",
        "approved",
      ]);
      const nextRaw = shouldClear
        ? null
        : args?.plan && typeof args.plan === "object"
          ? args.plan
          : args;
      const mergedRaw = shouldClear
        ? null
        : {
            ...oldPlan,
            ...nextRaw,
            steps: Array.isArray(nextRaw?.steps)
              ? nextRaw.steps
              : oldPlan?.steps,
          };
      const nextPlan = normalizePlanState(mergedRaw);
      if (
        nextPlan &&
        blockedStatuses.has(nextPlan.status) &&
        nextPlan.status !== oldPlan?.status
      ) {
        return {
          ok: false,
          error: `update_plan cannot set approval lifecycle status "${nextPlan.status}". Use draft, ready, running, completed, or failed.`,
          oldPlan,
          newPlan: oldPlan,
          hasPendingApproval: false,
        };
      }
      if (typeof onPlanStateUpdate === "function") {
        onPlanStateUpdate(nextPlan);
      }
      return {
        ok: true,
        oldPlan,
        newPlan: nextPlan,
        hasPendingApproval: false,
      };
    },
    create_plan: async (args = {}) => {
      if (typeof onCreatePlan !== "function") {
        return {
          ok: false,
          error: "create_plan is not available in the current mode.",
        };
      }
      const readiness = String(args?.readiness || "").toLowerCase();
      if (readiness !== "ready") {
        return {
          ok: false,
          error:
            'Set readiness to "ready" only when requirements are clear. Otherwise ask the user a clarifying question first.',
        };
      }
      const goal = String(args?.goal || "").trim();
      if (!goal) {
        return { ok: false, error: "goal is required" };
      }
      const assumptions = normalizeAssumptionItems(args?.assumptions);
      return onCreatePlan({
        goal,
        assumptions,
        contextSummary: String(args?.context_summary || "").trim(),
        steps: Array.isArray(args?.steps) ? args.steps : [],
      });
    },
    create_spec: async (args = {}) => {
      if (typeof onCreateSpec !== "function") {
        return {
          ok: false,
          error: "create_spec is not available in the current mode.",
        };
      }
      const readiness = String(args?.readiness || "").toLowerCase();
      if (readiness !== "ready") {
        return {
          ok: false,
          error:
            'Set readiness to "ready" only when requirements are clear. Otherwise ask the user a clarifying question first.',
        };
      }
      const topic = String(args?.topic || "").trim();
      if (!topic) {
        return { ok: false, error: "topic is required" };
      }
      const assumptions = normalizeAssumptionItems(args?.assumptions);
      const sections = {};
      for (const key of [
        "summary",
        "goals",
        "non_goals",
        "user_experience",
        "architecture",
        "data_state_model",
        "safety_rules",
        "requirements",
        "risks_mitigations",
        "testing_validation",
      ]) {
        if (args?.[key] != null) sections[key] = args[key];
      }
      return onCreateSpec({
        topic,
        assumptions,
        contextSummary: String(args?.context_summary || "").trim(),
        sections,
      });
    },
    run: Object.assign((args) => runCommand(workspaceRoot, config, args), {
      prepareApproval: async (args) => ({
        command: args?.command || "",
        risk: args?._risk || "high",
        evaluation: args?._evaluation || null,
        policyBlock: args?._policyBlock || null,
      }),
    }),
    save_memory: async (args = {}) => {
      const rawScope = String(args.scope || "global").toLowerCase();
      const memoryScope =
        rawScope === "repo" || rawScope === "project"
          ? "project"
          : rawScope === "user"
            ? "user"
            : "global";
      const saved = await rememberMemory({
        scope: memoryScope,
        content: args.content,
        kind: args.kind || "observation",
        summary: args.summary || String(args.content || "").slice(0, 80),
        source: "tool",
        replaceSimilar: args.replace_similar !== false,
        workspaceRoot,
        config,
      });
      return { ok: true, scope: memoryScope, memory: saved };
    },
    list_memory: async (args = {}) => ({
      scope: String(args.scope || ""),
      items: await listMemories({ scope: args.scope, workspaceRoot }),
    }),
    search_memory: async (args = {}) => ({
      scope: String(args.scope || ""),
      query: String(args.query || ""),
      items: await searchMemories({
        scope: args.scope,
        query: args.query,
        workspaceRoot,
      }),
    }),
    forget_memory: async (args = {}) => ({
      ok: true,
      ...(await forgetMemory({
        scope: args.scope,
        id: args.id,
        workspaceRoot,
      })),
    }),
    dream_consolidate: async (args = {}) => {
      return runDreamConsolidation({
        dryRun: args.dry_run === true,
        scope: args.scope || null,
        workspaceRoot,
        config,
        writeAudit: true,
      });
    },
    skill: async (args = {}) => {
      const indexedSkills = await loadIndexedSkills(workspaceRoot);
      const allSkills = Array.from(indexedSkills.values())
        .filter((command) => isSkillIndexEligible(command))
        .map((command) => ({
          command,
          summary: {
            ...summarizeIndexedSkill(command),
            enabled: isIndexedSkillEnabled(command, config),
          },
        }))
        .sort((a, b) =>
          `${a.summary.scope}:${a.summary.name}`.localeCompare(
            `${b.summary.scope}:${b.summary.name}`,
          ),
        );

      const searchQuery = String(args?.query || "").trim();
      if (searchQuery && !String(args?.name || args?.skill || "").trim()) {
        const matches = searchIndexedSkills(allSkills, searchQuery).filter(
          (item) => item.enabled !== false,
        );
        return {
          matches,
          message: matches.length
            ? 'Skill search results from indexed registry. Load one with skill({name:"<exact-name>"}).'
            : 'No indexed skills matched that query. Try skill({name:"list"}) to browse all skills.',
        };
      }

      const requested = normalizeSkillToolName(
        args?.name || args?.skill || args?.query,
      );
      if (!requested || requested === "list" || requested === "all") {
        return {
          skills: allSkills.map((item) => item.summary),
          message:
            'Indexed skills loaded from catalogs and registry. Load one with skill({name:"<exact-name>"}).',
        };
      }

      let command =
        indexedSkills.get(requested) ||
        allSkills.find(
          (item) => item.command.name.toLowerCase() === requested.toLowerCase(),
        )?.command;
      if (!command) {
        const matches = searchIndexedSkills(allSkills, requested).filter(
          (item) => item.enabled !== false,
        );
        return {
          error: `Unknown indexed skill: "${requested}".`,
          matches,
          hint: 'Use skill({name:"list"}) to browse indexed skills, or skill({query:"keywords"}) to search by name/description. Do not grep or list skills directories.',
        };
      }
      if (!isIndexedSkillEnabled(command, config)) {
        return {
          error: `Skill "${command.name}" is disabled in the skill index.`,
        };
      }

      const skillArgs = Array.isArray(args?.args)
        ? args.args.map((item) => String(item))
        : args?.arguments
          ? [String(args.arguments)]
          : [];
      emitSystemTool({ type: "skill:start", name: command.name });
      try {
        const content = renderCommandPrompt(command, skillArgs);
        emitSystemTool({ type: "skill:end", name: command.name });
        return {
          name: command.name,
          path: command.path,
          scope: skillScopeFromSource(command.source),
          packageName: command.metadata?.packageName || "",
          packageSource:
            command.metadata?.packageSource || command.metadata?.source || "",
          content,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emitSystemTool({
          type: "skill:error",
          name: command.name,
          summary: message,
        });
        emitSystemTool({ type: "skill:end", name: command.name });
        return { error: message };
      }
    },
    list_background_tasks: () => listBackgroundTasks(workspaceRoot),
    get_background_task: (args) => getBackgroundTask(workspaceRoot, args),
    stop_background_task: (args) => stopBackgroundTask(workspaceRoot, args),
    tool_search: (args) => {
      const query = String(args?.query || "")
        .trim()
        .toLowerCase();
      if (query === "all") {
        const all = Object.values(deferredDefinitions);
        return {
          loaded: Object.keys(deferredDefinitions),
          schemas: all,
          message: `Loaded all ${all.length} deferred tools. You can now call them directly.`,
        };
      }
      const match = Object.entries(deferredDefinitions).find(
        ([name]) => name === query,
      );
      if (!match) {
        const available = Object.keys(deferredDefinitions).join(", ");
        return {
          error: `Unknown tool: "${query}". Available deferred tools: ${available}`,
        };
      }
      return {
        loaded: [match[0]],
        schemas: [match[1]],
        message: `Loaded tool "${match[0]}". You can now call it in your next response.`,
      };
    },
  };

  const rawFormatters = {
    read(result) {
      if (typeof result === "string") return result;
      if (!result || typeof result !== "object") return String(result);
      if (result.node && typeof result.content === "string") {
        const header = `[AST: ${result.path || "?"} ${result.node.node_type || "node"} ${result.node.start_line || "?"}-${result.node.end_line || "?"}${result.matches ? `, matches ${result.matches}` : ""}]`;
        const contextLines = [];
        if (result.parent_summary)
          contextLines.push(`Parent: ${result.parent_summary}`);
        if (
          Array.isArray(result.child_summaries) &&
          result.child_summaries.length > 0
        ) {
          contextLines.push(`Children: ${result.child_summaries.join(" | ")}`);
        }
        return `${header}\n${contextLines.length > 0 ? `${contextLines.join("\n")}\n` : ""}${result.content}`;
      }
      if (result.phase === "directory_listing") {
        if (!Array.isArray(result.items)) return JSON.stringify(result);
        const header = `[Directory: ${result.path || "?"}] (read received a directory path; listing contents)`;
        const dirs = result.items
          .filter((item) => item.type === "dir")
          .map((item) => `${item.name}/`);
        const files = result.items
          .filter((item) => item.type === "file")
          .map((item) => item.name);
        const note = result.note ? `\n${result.note}` : "";
        return `${header}${note}\n${dirs.join("\n")}${dirs.length && files.length ? "\n" : ""}${files.join("\n")}`;
      }
      // Phase 1 metadata: small, return as-is
      if (result.phase === "metadata") {
        return JSON.stringify(result);
      }
      // Phase 2 content: structured header + head/tail content
      if (result.phase === "content") {
        const enclosing = result.enclosing_symbol
          ? `, inside ${result.enclosing_kind || "symbol"} ${result.enclosing_symbol}`
          : "";
        const header = `[File: ${result.path}, lines ${result.start_line || 1}-${result.end_line || "?"}${result.total_lines ? ` of ${result.total_lines}` : ""}${result.truncated ? ", truncated" : ""}${enclosing}]`;
        const content = result.content || "";
        if (typeof content !== "string" || content.length <= 3000) {
          return `${header}\n${content}`;
        }
        const headLen = 1800;
        const tailLen = 800;
        return `${header}\n${content.slice(0, headLen)}\n... [omitted ${content.length - headLen - tailLen} chars] ...\n${content.slice(-tailLen)}`;
      }
      return JSON.stringify(result);
    },

    search_code(result) {
      if (!result || typeof result !== "object") return String(result);
      const results = Array.isArray(result.results)
        ? result.results
        : result.matches;
      if (!Array.isArray(results)) return JSON.stringify(result);
      const header = `[search_code: "${result.query || ""}" intent=${result.detected_intent || result.resolved_mode || result.mode || "auto"} engines=${(result.engines || []).join(",") || result.engine || "?"}]`;
      if (results.length === 0) return `${header}\nNo code locations found.`;
      const lines = results.slice(0, 30).map((match) => {
        const range =
          Number.isFinite(Number(match.start_line)) &&
          Number.isFinite(Number(match.end_line))
            ? `${match.start_line}-${match.end_line}`
            : match.line
              ? String(match.line)
              : "?";
        const symbol = match.symbol ? ` ${match.symbol}` : "";
        const type = match.type ? ` ${match.type}` : "";
        const engine = match.engine ? ` [${match.engine}]` : "";
        const preview = match.preview
          ? `: ${String(match.preview).slice(0, 140)}`
          : "";
        return `${match.path || match.file || "?"}:${range}${type}${symbol}${engine}${preview}`;
      });
      const more =
        results.length > 30
          ? `\n... and ${results.length - 30} more location(s) [total: ${results.length}${result.truncated ? ", results were truncated" : ""}]`
          : "";
      return `${header}\n${lines.join("\n")}${more}`;
    },

    grep(result) {
      if (!result || typeof result !== "object") return String(result);
      const { pattern, matches, truncated, engine } = result;
      const header = pattern
        ? `[grep: "${pattern}"${engine ? ` via ${engine}` : ""}]`
        : "";
      if (!Array.isArray(matches) || matches.length === 0)
        return `${header}\nNo matches found.`;
      if (matches.length <= 30) {
        const lines = matches.map(
          (m) =>
            `${m.path}:${m.line}: ${String(m.preview || "").slice(0, 120)}`,
        );
        return `${header}\n${lines.join("\n")}`;
      }
      const shown = matches
        .slice(0, 30)
        .map(
          (m) =>
            `${m.path}:${m.line}: ${String(m.preview || "").slice(0, 120)}`,
        );
      return `${header}\n${shown.join("\n")}\n... and ${matches.length - 30} more matches [total: ${matches.length}${truncated ? ", results were truncated" : ""}]`;
    },

    ast_grep(result) {
      if (!result || typeof result !== "object") return String(result);
      if (!Array.isArray(result.matches)) return JSON.stringify(result);
      const header = `[ast_grep: "${result.pattern || ""}"${result.engine ? ` via ${result.engine}` : ""}]`;
      if (result.matches.length === 0)
        return `${header}\nNo structural matches found.`;
      const lines = result.matches.slice(0, 30).map((match) => {
        const target = match.ast_target || {};
        const name = target.name ? ` ${target.name}` : "";
        return `${target.path || result.path || "?"}:${match.start_line || "?"}-${match.end_line || "?"} ${match.node_type || target.node_type || "node"}${name}: ${String(match.text || "").slice(0, 120)}`;
      });
      const more =
        result.matches.length > 30
          ? `\n... and ${result.matches.length - 30} more structural matches [total: ${result.matches.length}${result.truncated ? ", results were truncated" : ""}]`
          : "";
      return `${header}\n${lines.join("\n")}${more}`;
    },

    glob(result) {
      if (!result || typeof result !== "object") return String(result);
      const { pattern, matches, truncated } = result;
      const header = pattern ? `[glob: "${pattern}"]` : "";
      if (!Array.isArray(matches) || matches.length === 0)
        return `${header}\nNo files found.`;
      if (matches.length <= 50) {
        return `${header}\n${matches.join("\n")}`;
      }
      const shown = matches.slice(0, 50);
      return `${header}\n${shown.join("\n")}\n... and ${matches.length - 50} more files [total: ${matches.length}${truncated ? ", results were truncated" : ""}]`;
    },

    list(result) {
      if (!result || typeof result !== "object") return String(result);
      if (!Array.isArray(result.items)) return JSON.stringify(result);
      const header = result.path ? `[${result.path}]` : "";
      const dirs = result.items
        .filter((i) => i.type === "dir")
        .map((i) => `${i.name}/`);
      const files = result.items
        .filter((i) => i.type === "file")
        .map((i) => i.name);
      return `${header}\n${dirs.join("\n")}${dirs.length && files.length ? "\n" : ""}${files.join("\n")}`;
    },

    update_todos(result) {
      if (!result || typeof result !== "object") return String(result);
      const nextTodos = normalizeTodos(result.newTodos);
      if (nextTodos.length === 0) return "Todo list cleared.";
      const lines = nextTodos.map((item) => {
        const box =
          item.status === "completed"
            ? "[x]"
            : item.status === "in_progress"
              ? "[~]"
              : "[ ]";
        return `${box} ${item.content}`;
      });
      return ["Updated todo list:", ...lines].join("\n");
    },

    read_plan(result) {
      if (!result || typeof result !== "object") return String(result);
      const plan = normalizePlanState(result.plan);
      if (!plan) return "No active plan state.";
      const lines = [
        "Current plan state:",
        `- status: ${plan.status || "-"}`,
        `- source: ${plan.source || "-"}`,
        `- goal: ${plan.goal || "-"}`,
        `- filePath: ${plan.filePath || "-"}`,
        `- summary: ${plan.summary || "-"}`,
        `- finalSummary: ${plan.finalSummary || "-"}`,
      ];
      const steps = Array.isArray(plan.steps) ? plan.steps : [];
      if (steps.length > 0) {
        lines.push("- steps:");
        for (let i = 0; i < Math.min(steps.length, 8); i += 1) {
          const step = steps[i];
          lines.push(
            `  ${i + 1}. [${step.role || "-"}] ${step.title || "-"} :: ${step.task || "-"}`,
          );
        }
        if (steps.length > 8)
          lines.push(`  ... and ${steps.length - 8} more step(s)`);
      }
      return lines.join("\n");
    },

    update_plan(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.error) return String(result.error);
      const nextPlan = normalizePlanState(result.newPlan);
      if (!nextPlan) return "Plan state cleared.";
      const lines = [
        "Current plan state:",
        `- status: ${nextPlan.status || "-"}`,
        `- source: ${nextPlan.source || "-"}`,
        `- goal: ${nextPlan.goal || "-"}`,
        `- filePath: ${nextPlan.filePath || "-"}`,
        `- summary: ${nextPlan.summary || "-"}`,
        `- finalSummary: ${nextPlan.finalSummary || "-"}`,
      ];
      const steps = Array.isArray(nextPlan.steps) ? nextPlan.steps : [];
      if (steps.length > 0) {
        lines.push("- steps:");
        for (let i = 0; i < Math.min(steps.length, 8); i += 1) {
          const step = steps[i];
          lines.push(
            `  ${i + 1}. [${step.role || "-"}] ${step.title || "-"} :: ${step.task || "-"}`,
          );
        }
        if (steps.length > 8)
          lines.push(`  ... and ${steps.length - 8} more step(s)`);
      }
      return lines.join("\n");
    },

    create_plan(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.error) return String(result.error);
      if (result.message) return String(result.message);
      if (result.filePath) return `Plan draft created: ${result.filePath}`;
      return JSON.stringify(result);
    },

    create_spec(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.error) return String(result.error);
      if (result.message) return String(result.message);
      if (result.filePath) return `Spec draft created: ${result.filePath}`;
      return JSON.stringify(result);
    },

    query_project_index(result) {
      if (!result || typeof result !== "object") return String(result);
      const lines = [];
      if (result.query) lines.push(`[project_index: "${result.query}"]`);
      if (result.project_root)
        lines.push(`project_root: ${result.project_root}`);
      const projectMap = result.project_map;
      if (projectMap) {
        lines.push(
          `languages: ${(projectMap.languages || []).join(", ") || "unknown"}`,
        );
        lines.push(
          `source_roots: ${(projectMap.source_roots || []).join(", ") || "none"}`,
        );
        lines.push(
          `test_roots: ${(projectMap.test_roots || []).join(", ") || "none"}`,
        );
        lines.push(
          `entry_candidates: ${(projectMap.entry_candidates || []).join(", ") || "none"}`,
        );
        lines.push(
          `framework_hints: ${(projectMap.framework_hints || []).join(", ") || "none"}`,
        );
      }
      const matches = Array.isArray(result.matches) ? result.matches : [];
      if (matches.length === 0) {
        lines.push("No indexed file matches found.");
        return lines.join("\n");
      }
      lines.push("matches:");
      for (const item of matches) {
        lines.push(
          `- ${item.file} [score=${item.score}] exports=[${(item.exports || []).join(", ")}] functions=[${(item.functions || []).join(", ")}] classes=[${(item.classes || []).join(", ")}]`,
        );
      }
      return lines.join("\n");
    },

    edit(result) {
      if (!result || typeof result !== "object") return String(result);
      const p = result.path || "";
      const action = result.action || "";
      const line = result.changed_line || 0;
      const backup = result.backupPath
        ? `\nbackup: ${result.backupPath}${result.backupReused ? " (reused)" : ""}`
        : "";
      const summary = `${action} ${p}${line > 0 ? ` @L${line}` : ""}${backup}`;
      const diffPreview = result.diff_preview || "";
      if (diffPreview) {
        const trimmed =
          diffPreview.length > 600
            ? `${diffPreview.slice(0, 597)}...`
            : diffPreview;
        return `${summary}\n${trimmed}`;
      }
      return (
        summary +
        (result.ok !== false ? "" : ` [FAILED: ${result.error || "unknown"}]`)
      );
    },

    create(result) {
      if (!result || typeof result !== "object") return String(result);
      const p = result.path || "";
      const action = result.action || "create";
      const line = result.changed_line || 0;
      const backup = result.backupPath
        ? `\nbackup: ${result.backupPath}${result.backupReused ? " (reused)" : ""}`
        : "";
      const summary = `${action} ${p}${line > 0 ? ` @L${line}` : ""}${backup}`;
      const diffPreview = result.diff_preview || "";
      if (diffPreview) {
        const trimmed =
          diffPreview.length > 600
            ? `${diffPreview.slice(0, 597)}...`
            : diffPreview;
        return `${summary}\n${trimmed}`;
      }
      return summary;
    },

    delete(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.ok === false) return JSON.stringify(result);
      const kind = result.type || "item";
      const target = result.path || "";
      const backup = result.backupPath
        ? `\nbackup: ${result.backupPath}${result.backupReused ? " (reused)" : ""}`
        : "";
      return `[delete: ${kind}] deleted ${target}${backup}`;
    },

    run(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.background) {
        const parts = [
          `[background task: ${result.task_id || "?"}]`,
          `status: ${result.status || "running"}`,
        ];
        if (result.command)
          parts.push(`command: ${String(result.command).slice(0, 200)}`);
        if (result.output_file)
          parts.push(`output_file: ${result.output_file}`);
        if (
          Array.isArray(result.recent_output) &&
          result.recent_output.length > 0
        ) {
          parts.push(
            `recent_output:\n${result.recent_output.slice(0, 6).join("\n")}`,
          );
        }
        return parts.join("\n");
      }
      const runSummary = summarizeRunOutput(result);
      if (runSummary) return runSummary;
      const command = String(result.command || "").slice(0, 200);
      const stdout = String(result.stdout || "");
      const stderr = String(result.stderr || "");
      const code = result.code ?? 0;
      const parts = [`[exit: ${code}]`];
      if (command) parts.push(`command: ${command}`);
      if (stdout) parts.push(`stdout:\n${stdout}`);
      if (stderr) parts.push(`stderr:\n${stderr}`);
      return parts.join("\n");
    },

    remember_user(result) {
      return result?.memory?.content
        ? `stored user memory: ${result.memory.content}`
        : JSON.stringify(result);
    },

    remember_global(result) {
      return result?.memory?.content
        ? `stored global memory: ${result.memory.content}`
        : JSON.stringify(result);
    },

    remember_project(result) {
      return result?.memory?.content
        ? `stored project memory: ${result.memory.content}`
        : JSON.stringify(result);
    },

    save_memory(result) {
      const scope = result?.scope || "global";
      return result?.memory?.content
        ? `stored ${scope} memory: ${result.memory.content}`
        : JSON.stringify(result);
    },

    list_memory(result) {
      if (!result || typeof result !== "object" || !Array.isArray(result.items))
        return JSON.stringify(result);
      if (result.items.length === 0)
        return `No ${result.scope || ""} memories found.`;
      return result.items
        .map((item) => `${item.id} [${item.kind}] ${item.content}`)
        .join("\n");
    },

    search_memory(result) {
      if (!result || typeof result !== "object" || !Array.isArray(result.items))
        return JSON.stringify(result);
      if (result.items.length === 0)
        return `No ${result.scope || ""} memories matched "${result.query || ""}".`;
      return result.items
        .map((item) => `${item.id} [${item.kind}] ${item.content}`)
        .join("\n");
    },

    forget_memory(result) {
      return `removed ${Number(result?.removed || 0)} memory item(s)`;
    },

    ast_query(result) {
      if (!result || typeof result !== "object") return String(result);
      if (!Array.isArray(result.matches)) return JSON.stringify(result);
      const header = `[ast_query: ${result.matches.length} match(es)]`;
      const lines = result.matches.slice(0, 20).map((m) => {
        const name = m.name || m.ast_target?.name || "?";
        const kind = m.kind || m.ast_target?.kind || "?";
        return `  ${kind} ${name}`;
      });
      return `${header}\n${lines.join("\n")}${result.matches.length > 20 ? `\n... +${result.matches.length - 20} more` : ""}`;
    },

    read_ast_node(result) {
      if (typeof result === "string") return result;
      if (!result || typeof result !== "object") return String(result);
      const name = result.name || "";
      const kind = result.kind || "";
      const content = result.content || result.source || "";
      const header = `${kind} ${name}`;
      return `${header}\n${content}`;
    },

    skill(result) {
      if (!result || typeof result !== "object") return String(result);
      if (result.error) {
        const matches =
          Array.isArray(result.matches) && result.matches.length > 0
            ? [
                "Possible matches:",
                ...result.matches.map((item) => {
                  const disabled = item.enabled === false ? " disabled" : "";
                  const desc = item.description ? ` - ${item.description}` : "";
                  return `/${item.name} [${item.scope}${disabled}]${desc}`;
                }),
              ]
            : [];
        const hint = result.hint ? `\n${result.hint}` : "";
        return `${result.error}${matches.length ? `\n${matches.join("\n")}` : ""}${hint}`;
      }
      if (typeof result.content === "string") return result.content;
      if (Array.isArray(result.matches)) {
        if (result.matches.length === 0) {
          return result.message || "No indexed skills matched that query.";
        }
        const lines = result.matches.map((item) => {
          const disabled = item.enabled === false ? " disabled" : "";
          const desc = item.description ? ` - ${item.description}` : "";
          return `/${item.name} [${item.scope}${disabled}]${desc}`;
        });
        return [result.message || "Skill search results:", ...lines].join("\n");
      }
      if (Array.isArray(result.skills)) {
        if (result.skills.length === 0) return "No indexed skills found.";
        const lines = result.skills.map((item) => {
          const disabled = item.enabled === false ? " disabled" : "";
          const desc = item.description ? ` - ${item.description}` : "";
          return `/${item.name} [${item.scope}${disabled}]${desc}`;
        });
        return [result.message || "Indexed skills:", ...lines].join("\n");
      }
      return JSON.stringify(result);
    },

    web_fetch(result) {
      if (!result || typeof result !== "object") return String(result);
      const lines = [`[web_fetch: ${result.final_url || result.url || "?"}]`];
      if (result.title) lines.push(`title: ${result.title}`);
      if (result.description)
        lines.push(`description: ${trimPreview(result.description, 200)}`);
      if (result.metadata?.status)
        lines.push(`status: ${result.metadata.status}`);
      if (result.metadata?.fetch_mode)
        lines.push(`mode: ${result.metadata.fetch_mode}`);
      if (Array.isArray(result.warnings)) {
        for (const warning of result.warnings.slice(0, 3)) {
          if (warning) lines.push(`warning: ${warning}`);
        }
      }
      if (Array.isArray(result.links) && result.links.length > 0) {
        lines.push(
          `links: ${result.links
            .slice(0, 5)
            .map((item) => item.href)
            .join(", ")}`,
        );
      }
      if (result.text) {
        lines.push(result.text);
      }
      return lines.join("\n");
    },

    web_search(result) {
      if (!result || typeof result !== "object") return String(result);
      const lines = [
        result.query ? `[web_search: "${result.query}"]` : "[web_search]",
      ];
      if (!Array.isArray(result.results) || result.results.length === 0) {
        lines.push(
          result.no_results
            ? "No results found."
            : "No search results returned.",
        );
        return lines.join("\n");
      }
      for (const item of result.results.slice(0, 8)) {
        lines.push(`- ${item.title || item.url}`);
        if (item.url) lines.push(`  ${item.url}`);
        if (item.description)
          lines.push(`  ${trimPreview(item.description, 180)}`);
      }
      return lines.join("\n");
    },

    list_background_tasks(result) {
      if (!result || typeof result !== "object") return String(result);
      if (!Array.isArray(result.tasks)) return JSON.stringify(result);
      if (result.tasks.length === 0) return "No background tasks running.";
      return result.tasks
        .map(
          (task) =>
            `${task.task_id || "?"} ${task.status || "unknown"}${task.command ? ` (${task.command.slice(0, 60)})` : ""}`,
        )
        .join("\n");
    },

    get_background_task(result) {
      if (!result || typeof result !== "object") return String(result);
      const tid = result.task_id || "";
      const status = result.status || "unknown";
      const outputFile = result.output_file || "";
      const output = Array.isArray(result.recent_output)
        ? result.recent_output.slice(-3).join("\n")
        : "";
      return `${tid} ${status}${outputFile ? ` -> ${outputFile}` : ""}${output ? `\n${output}` : ""}`;
    },

    stop_background_task(result) {
      if (!result || typeof result !== "object") return String(result);
      return `${result.task_id || "?"} stopped${result.exit_code != null ? ` (exit ${result.exit_code})` : ""}`;
    },
  };

  const formatters = Object.fromEntries(
    Object.entries(rawFormatters).map(([name, formatter]) => [
      name,
      (result, args) =>
        sanitizeTextForModel(
          formatter(result, args),
          getToolOutputSanitizeOptions(name),
        ),
    ]),
  );

  async function dispose() {
    if (activeFffAdapter?.dispose) {
      try {
        await activeFffAdapter.dispose();
      } catch {}
    }
  }

  return { definitions, handlers, formatters, deferredDefinitions, dispose };
}
