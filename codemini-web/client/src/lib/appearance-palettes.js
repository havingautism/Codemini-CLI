// Shared by the live theme and the settings swatches so previews stay accurate.
export const APPEARANCE_PALETTES = [
  {
    id: 'default', labelKey: 'themeDefault',
    light: {canvas:'#fafafa', surface:'#ffffff', text:'#242426', muted:'#6e6e73', accent:'#363639', sidebar:'#f1f1f3'},
    dark: {canvas:'#202023', surface:'#29292e', text:'#eeeef0', muted:'#a5a5ad', accent:'#d0d0d6', sidebar:'#19191c'},
  },
  {
    id: 'warm', labelKey: 'themeWarm',
    light: {canvas:'#faf9f6', surface:'#fffefa', text:'#332f2a', muted:'#746d63', accent:'#a34f35', sidebar:'#f0ede7'},
    dark: {canvas:'#25231f', surface:'#302d28', text:'#eee9df', muted:'#b3aa9d', accent:'#e5a486', sidebar:'#201e1b'},
  },
  {
    id: 'catppuccin', labelKey: 'themeCatppuccin',
    light: {canvas:'#f8f6fb', surface:'#fefcff', text:'#342e3b', muted:'#73687e', accent:'#755b9e', sidebar:'#eeebf3'},
    dark: {canvas:'#27232e', surface:'#312b3b', text:'#efe8f6', muted:'#b7a9c7', accent:'#c3a7e7', sidebar:'#211d28'},
  },
  {
    id: 'tokyonight', labelKey: 'themeTokyoNight',
    light: {canvas:'#f5f7fb', surface:'#fcfdff', text:'#283345', muted:'#637389', accent:'#47668d', sidebar:'#eaf0f7'},
    dark: {canvas:'#202936', surface:'#293446', text:'#e8eff8', muted:'#a8b8cd', accent:'#95b6df', sidebar:'#1a222d'},
  },
  {
    id: 'one', labelKey: 'themeOne',
    light: {canvas:'#f5f8f3', surface:'#fcfefb', text:'#2f3a2f', muted:'#657361', accent:'#58764c', sidebar:'#eaf0e6'},
    dark: {canvas:'#242c24', surface:'#2e382d', text:'#e8f0e4', muted:'#afbdab', accent:'#a5c493', sidebar:'#1d251d'},
  },
  {
    id: 'github', labelKey: 'themeGithub',
    light: {canvas:'#fbf6f6', surface:'#fffdfd', text:'#403034', muted:'#7b656b', accent:'#9b586c', sidebar:'#f2e9eb'},
    dark: {canvas:'#2e2428', surface:'#3b2d32', text:'#f6e8ed', muted:'#c2a8b0', accent:'#dda0b4', sidebar:'#261e21'},
  },
  {
    id: 'vscode', labelKey: 'themeVSCode',
    light: {canvas:'#f3f8f7', surface:'#fbfefd', text:'#283b3a', muted:'#5b726e', accent:'#397c74', sidebar:'#e5efed'},
    dark: {canvas:'#202e2c', surface:'#283a37', text:'#e3f3ef', muted:'#a1bdb6', accent:'#83c7b6', sidebar:'#1a2523'},
  },
];

export function getAppearancePalette(id, mode) {
  const palette = APPEARANCE_PALETTES.find((item) => item.id === id) || APPEARANCE_PALETTES[0];
  return palette[mode === 'dark' ? 'dark' : 'light'];
}
