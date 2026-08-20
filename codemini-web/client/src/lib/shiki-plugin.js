import { createHighlighter } from "shiki";

const themes = ["github-light", "github-dark"];
let highlighterPromise = null;
let highlighterInstance = null;

const EXT_TO_LANG = {
  ".js": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".jsx": "jsx",
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".py": "python",
  ".rb": "ruby",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".cs": "csharp",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".hpp": "cpp",
  ".hh": "cpp",
  ".css": "css",
  ".scss": "scss",
  ".less": "less",
  ".html": "html",
  ".htm": "html",
  ".xml": "xml",
  ".svg": "xml",
  ".json": "json",
  ".jsonc": "jsonc",
  ".md": "markdown",
  ".mdx": "mdx",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".ini": "ini",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".ps1": "powershell",
  ".sql": "sql",
  ".graphql": "graphql",
  ".gql": "graphql",
  ".php": "php",
  ".vue": "vue",
  ".svelte": "svelte",
  ".dockerfile": "dockerfile",
};

const BASENAME_TO_LANG = {
  dockerfile: "dockerfile",
  makefile: "makefile",
  gemfile: "ruby",
  procfile: "yaml",
};

function getHighlighter() {
  if (highlighterInstance) return Promise.resolve(highlighterInstance);
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({ themes, langs: [] }).then((h) => {
      highlighterInstance = h;
      return h;
    });
  }
  return highlighterPromise;
}

const loadedLangs = new Set();
async function ensureLang(lang) {
  if (!lang) return;
  if (loadedLangs.has(lang)) return;
  const h = await getHighlighter();
  try {
    if (!h.getLoadedLanguages().includes(lang)) {
      await h.loadLanguage(lang);
    }
    loadedLangs.add(lang);
  } catch {
    loadedLangs.add(lang); // mark to avoid retrying unknown langs
  }
}

export function languageFromPath(filePath = "") {
  const normalized = String(filePath || "").trim().replace(/\\/g, "/");
  if (!normalized) return null;
  const base = normalized.split("/").pop() || "";
  const lowerBase = base.toLowerCase();
  if (BASENAME_TO_LANG[lowerBase]) return BASENAME_TO_LANG[lowerBase];
  if (/^\.env(\..+)?$/i.test(base)) return "dotenv";
  const dot = lowerBase.lastIndexOf(".");
  if (dot <= 0) return null;
  const ext = lowerBase.slice(dot);
  return EXT_TO_LANG[ext] || null;
}

function plainHighlight(code) {
  const lines = String(code ?? "").split(/\r?\n/);
  return {
    fg: undefined,
    bg: undefined,
    rootStyle: undefined,
    tokens: lines.map((line) => [{ content: line }]),
  };
}

const HIGHLIGHT_CACHE_MAX = 64;
const highlightCache = new Map();

function doHighlight(code, language) {
  if (!highlighterInstance) return null;
  const key = `${code}\u0000${language}`;
  const cached = highlightCache.get(key);
  if (cached !== undefined) {
    // LRU touch: move entry to the end of insertion order
    highlightCache.delete(key);
    highlightCache.set(key, cached);
    return cached;
  }
  try {
    if (!highlighterInstance.getLoadedLanguages().includes(language)) return null;

    const result = highlighterInstance.codeToTokens(code, {
      lang: language,
      themes: getActiveSyntaxThemes(),
      defaultColor: false,
    });

    const value = {
      fg: result.fg,
      bg: result.bg,
      rootStyle: result.rootStyle,
      tokens: result.tokens,
    };
    highlightCache.set(key, value);
    if (highlightCache.size > HIGHLIGHT_CACHE_MAX) {
      const oldest = highlightCache.keys().next().value;
      highlightCache.delete(oldest);
    }
    return value;
  } catch {
    return null;
  }
}

function getActiveSyntaxThemes() {
  return { light: "github-light", dark: "github-dark" };
}

/**
 * Highlight code into token lines for file preview.
 * @returns {Promise<{ lines: Array<Array<{ content: string, htmlStyle?: Record<string, string>, color?: string }>> }>}
 */
export async function highlightCodeLines(code, language = null) {
  const text = String(code ?? "");
  if (!language) {
    return { lines: plainHighlight(text).tokens };
  }
  await getHighlighter();
  await ensureLang(language);
  const result = doHighlight(text, language) || plainHighlight(text);
  return { lines: Array.isArray(result.tokens) ? result.tokens : plainHighlight(text).tokens };
}

export function createCodePlugin() {
  getHighlighter().catch(() => {});

  return {
    name: "shiki",
    type: "code-highlighter",
    getThemes: () => themes,

    getSupportedLanguages: () => {
      if (!highlighterInstance) return [];
      return highlighterInstance.getLoadedLanguages();
    },

    supportsLanguage: (lang) => {
      if (!highlighterInstance) return false;
      return highlighterInstance.getLoadedLanguages().includes(lang);
    },

    highlight: (options, callback) => {
      const { code, language } = options;
      const result = doHighlight(code, language);

      if (result) return result;

      // Language not loaded yet — load async then callback
      ensureLang(language).then(() => {
        if (callback) callback(doHighlight(code, language) || plainHighlight(code));
      });
      return plainHighlight(code);
    },
  };
}
