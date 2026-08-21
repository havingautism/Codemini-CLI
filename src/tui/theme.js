const esc = (open, close) => (text) => `${open}${text}${close}`;
// Close to the TUI's own colors, not SGR 39/49 (terminal default). Nested
// spans would otherwise restore a light terminal surface and dark default
// text, which punches holes in the forced near-black canvas.
const TEXT_RGB = [224, 224, 224];
const SURFACE_RGB = [14, 14, 16];
const CURSOR_RGB = [236, 236, 240];
export const TEXT_FG = `\u001b[38;2;${TEXT_RGB[0]};${TEXT_RGB[1]};${TEXT_RGB[2]}m`;
export const SURFACE_BG = `\u001b[48;2;${SURFACE_RGB[0]};${SURFACE_RGB[1]};${SURFACE_RGB[2]}m`;
export const CURSOR_COLOR = '\u001b]12;#ececf0\u0007';
export const CURSOR_COLOR_RESET = '\u001b]112\u0007';
export const CURSOR_SHAPE = '\u001b[2 q';
export const CURSOR_SHAPE_RESET = '\u001b[0 q';
const CURSOR_FG = `\u001b[38;2;${SURFACE_RGB[0]};${SURFACE_RGB[1]};${SURFACE_RGB[2]}m`;
const CURSOR_BG = `\u001b[48;2;${CURSOR_RGB[0]};${CURSOR_RGB[1]};${CURSOR_RGB[2]}m`;
// SGR 0 also clears reverse/bold. Replacing it with colors alone would leave
// the editor's reverse cursor on, swapping our dark surface into a light bar.
const ATTR_OFF = '\u001b[22;23;24;25;27;28;29m';
const fg = (r, g, b) => esc(`\u001b[38;2;${r};${g};${b}m`, TEXT_FG);
const bg = (r, g, b) => esc(`\u001b[48;2;${r};${g};${b}m`, SURFACE_BG);

export function styleEditorCursor(text) {
  return String(text).replace(/\u001b\[7m([\s\S]*?)\u001b\[0m/g, (_match, cell) => (
    `\u001b[27m${CURSOR_FG}${CURSOR_BG}${cell || ' '}${ATTR_OFF}${TEXT_FG}${SURFACE_BG}`
  ));
}

export function sealAnsi(text) {
  return styleEditorCursor(text)
    .replaceAll('\u001b[0m', `${ATTR_OFF}${TEXT_FG}${SURFACE_BG}`)
    .replaceAll('\u001b[39m', TEXT_FG)
    .replaceAll('\u001b[49m', SURFACE_BG);
}

export const bold = esc('\u001b[1m', '\u001b[22m');
export const italic = esc('\u001b[3m', '\u001b[23m');
export const underline = esc('\u001b[4m', '\u001b[24m');
export const strike = esc('\u001b[9m', '\u001b[29m');

export const color = {
  text: fg(...TEXT_RGB),
  muted: fg(128, 128, 128),
  dim: fg(96, 96, 96),
  accent: fg(114, 159, 207),
  success: fg(126, 200, 145),
  warning: fg(224, 175, 104),
  error: fg(224, 108, 117),
  purple: fg(190, 149, 245),
  cyan: fg(101, 191, 194),
  border: fg(72, 76, 89),
  surfaceBg: bg(...SURFACE_RGB),
  surfaceRaisedBg: bg(20, 20, 24),
  accentBg: bg(16, 24, 36),
  toolPendingBg: bg(28, 26, 34),
  toolSuccessBg: bg(16, 32, 22),
  toolErrorBg: bg(40, 18, 20),
  selectionBg: bg(32, 38, 52),
  overlayBg: bg(...SURFACE_RGB)
};

export const markdownTheme = {
  heading: (text) => bold(color.accent(text)),
  link: (text) => underline(color.accent(text)),
  linkUrl: color.dim,
  code: color.warning,
  codeBlock: color.text,
  codeBlockBorder: (text) => color.dim(text === '```' ? '╰' : `╭${text.length > 3 ? ` ${text.slice(3)}` : ''}`),
  quote: color.muted,
  quoteBorder: color.dim,
  hr: color.dim,
  listBullet: color.accent,
  bold,
  italic,
  strikethrough: strike,
  underline,
  codeBlockIndent: `${color.dim('│')} `
};

export const selectTheme = {
  selectedPrefix: color.accent,
  selectedText: (text) => bold(color.accent(text)),
  description: color.muted,
  scrollInfo: color.dim,
  noMatch: color.muted
};

export const editorTheme = {
  borderColor: color.dim,
  selectList: selectTheme
};
