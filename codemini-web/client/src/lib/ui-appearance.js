import { APPEARANCE_PALETTES, getAppearancePalette } from './appearance-palettes.js';

export const APPEARANCE_KEY = 'codemini-ui-appearance';
export const DEFAULT_APPEARANCE = Object.freeze({
  mode: 'auto', palette: 'default', font: 'sans',
});
export const PALETTES = APPEARANCE_PALETTES.map((palette) => palette.id);

export function normalizeAppearance(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  return {
    mode: ['auto', 'light', 'dark'].includes(input.mode) ? input.mode : DEFAULT_APPEARANCE.mode,
    palette: PALETTES.includes(input.palette) ? input.palette : DEFAULT_APPEARANCE.palette,
    font: ['sans', 'serif', 'system'].includes(input.font) ? input.font : DEFAULT_APPEARANCE.font,
  };
}

export function readAppearance(storage = globalThis.localStorage) {
  try {
    let saved = {};
    try { saved = JSON.parse(storage?.getItem(APPEARANCE_KEY) || '{}'); } catch { /* Keep legacy theme preferences. */ }
    return normalizeAppearance({
      ...saved,
      mode: storage?.getItem('codemini-theme') || saved?.mode,
      palette: saved?.palette || storage?.getItem('codemini-theme-palette'),
    });
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function applyAppearance(value, { persist = true } = {}) {
  const appearance = normalizeAppearance(value);
  if (persist) {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    localStorage.setItem('codemini-theme', appearance.mode);
  }
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const root = document.documentElement;
  root.dataset.theme = appearance.mode === 'auto' ? (dark ? 'dark' : 'light') : appearance.mode;
  root.dataset.palette = appearance.palette;
  root.dataset.chatFont = appearance.font;
  const colors = getAppearancePalette(appearance.palette, root.dataset.theme);
  for (const [key, color] of Object.entries(colors)) root.style.setProperty(`--palette-${key}`, color);
  return appearance;
}

export function initializeAppearance() {
  const refresh = () => applyAppearance(readAppearance(), { persist: false });
  refresh();
  const media = window.matchMedia?.('(prefers-color-scheme: dark)');
  media?.addEventListener('change', refresh);
  const onStorage = (event) => {
    if (!event.key || [APPEARANCE_KEY, 'codemini-theme', 'codemini-theme-palette'].includes(event.key)) refresh();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    media?.removeEventListener('change', refresh);
    window.removeEventListener('storage', onStorage);
  };
}
