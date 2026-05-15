import { createHighlighter } from "shiki";

const themes = [
  "github-light",
  "github-dark",
  "catppuccin-latte",
  "catppuccin-mocha",
  "tokyo-night",
  "one-light",
  "one-dark-pro",
  "github-light-default",
  "github-dark-default",
  "light-plus",
  "dark-plus",
];
let highlighterPromise = null;
let highlighterInstance = null;

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
if (typeof window !== "undefined") {
  window.addEventListener("codemini-theme-palette-change", () => {
    highlighterPromise = null;
    highlighterInstance = null;
    loadedLangs.clear();
  });
}

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

function plainHighlight(code) {
  const lines = String(code ?? "").split(/\r?\n/);
  return {
    fg: undefined,
    bg: undefined,
    rootStyle: undefined,
    tokens: lines.map((line) => [{ content: line }]),
  };
}

function doHighlight(code, language) {
  if (!highlighterInstance) return null;
  try {
    if (!highlighterInstance.getLoadedLanguages().includes(language)) return null;

    const result = highlighterInstance.codeToTokens(code, {
      lang: language,
      themes: getActiveSyntaxThemes(),
      defaultColor: false,
    });

    return {
      fg: result.fg,
      bg: result.bg,
      rootStyle: result.rootStyle,
      tokens: result.tokens,
    };
  } catch {
    return null;
  }
}

function getActiveSyntaxThemes() {
  if (typeof document === "undefined") {
    return { light: "github-light", dark: "github-dark" };
  }
  const palette = document.documentElement.dataset.palette || "default";
  if (palette === "catppuccin") {
    return { light: "catppuccin-latte", dark: "catppuccin-mocha" };
  }
  if (palette === "tokyonight") {
    return { light: "github-light", dark: "tokyo-night" };
  }
  if (palette === "one") {
    return { light: "one-light", dark: "one-dark-pro" };
  }
  if (palette === "github") {
    return { light: "github-light-default", dark: "github-dark-default" };
  }
  if (palette === "vscode") {
    return { light: "light-plus", dark: "dark-plus" };
  }
  return { light: "github-light", dark: "github-dark" };
}
