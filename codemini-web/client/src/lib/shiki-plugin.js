import { createHighlighter } from "shiki";

const themes = ["github-light", "github-dark"];
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
      themes: { light: "github-light", dark: "github-dark" },
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
