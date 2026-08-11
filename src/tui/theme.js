const esc = (open, close) => (text) => `${open}${text}${close}`;
const fg = (r, g, b) => esc(`\u001b[38;2;${r};${g};${b}m`, '\u001b[39m');
const bg = (r, g, b) => esc(`\u001b[48;2;${r};${g};${b}m`, '\u001b[49m');

export const bold = esc('\u001b[1m', '\u001b[22m');
export const italic = esc('\u001b[3m', '\u001b[23m');
export const underline = esc('\u001b[4m', '\u001b[24m');
export const strike = esc('\u001b[9m', '\u001b[29m');

export const color = {
  text: fg(224, 224, 224),
  muted: fg(128, 128, 128),
  dim: fg(96, 96, 96),
  accent: fg(114, 159, 207),
  success: fg(126, 200, 145),
  warning: fg(224, 175, 104),
  error: fg(224, 108, 117),
  purple: fg(190, 149, 245),
  cyan: fg(101, 191, 194),
  border: fg(72, 76, 89),
  surfaceBg: bg(31, 34, 41),
  surfaceRaisedBg: bg(38, 42, 52),
  accentBg: bg(31, 45, 65),
  toolPendingBg: bg(47, 45, 55),
  toolSuccessBg: bg(32, 50, 39),
  toolErrorBg: bg(60, 34, 38),
  selectionBg: bg(43, 50, 67),
  overlayBg: bg(29, 31, 36)
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
