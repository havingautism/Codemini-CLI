import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_KEY, DEFAULT_APPEARANCE, normalizeAppearance, readAppearance, applyAppearance, initializeAppearance } from '../codemini-web/client/src/lib/ui-appearance.js';
import { APPEARANCE_PALETTES, getAppearancePalette } from '../codemini-web/client/src/lib/appearance-palettes.js';

function storageOf(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

test('palette body, secondary text and links remain readable on both reading surfaces', () => {
  for (const palette of APPEARANCE_PALETTES) {
    for (const mode of ['light', 'dark']) {
      const colors = palette[mode];
      for (const foreground of ['text', 'muted', 'accent']) {
        for (const background of ['canvas', 'surface']) {
          const a = luminance(colors[foreground]);
          const b = luminance(colors[background]);
          const contrast = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          assert.ok(contrast >= 4.5, `${palette.id} ${mode} ${foreground}/${background}: ${contrast.toFixed(2)}`);
        }
      }
    }
  }
});

test('new installations default to neutral sans; invalid choices normalize independently', () => {
  assert.deepEqual(readAppearance(storageOf()), DEFAULT_APPEARANCE);
  assert.deepEqual(normalizeAppearance({mode:'dark', style:'invalid', palette:'warm', font:'serif'}), {
    mode:'dark', palette:'warm', font:'serif',
  });
  assert.deepEqual(normalizeAppearance(null), DEFAULT_APPEARANCE);
});

test('every palette can be combined with every reading font, without a style setting', () => {
  for (const palette of APPEARANCE_PALETTES) {
    for (const font of ['sans', 'serif', 'system']) {
      assert.deepEqual(normalizeAppearance({mode:'light', style:'conversation', palette:palette.id, font}), {mode:'light', palette:palette.id, font});
    }
  }
});

test('legacy mode and palette survive reload and corrupted appearance JSON', () => {
  const storage = storageOf({[APPEARANCE_KEY]:'broken', 'codemini-theme':'dark', 'codemini-theme-palette':'catppuccin'});
  assert.deepEqual(readAppearance(storage), {mode:'dark', palette:'catppuccin', font:'sans'});
});

test('saved choices restore; sidebar mode and system changes preserve fonts and colors', t => {
  const previous = { localStorage:globalThis.localStorage, window:globalThis.window, document:globalThis.document };
  t.after(() => Object.assign(globalThis, previous));
  const listeners = new Map();
  const media = {matches:false, addEventListener:(key, fn)=>listeners.set('media',fn), removeEventListener:()=>listeners.delete('media')};
  globalThis.localStorage = storageOf();
  const colors = new Map();
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>colors.set(key,value)}}};
  globalThis.window = {matchMedia:()=>media, addEventListener:(key,fn)=>listeners.set(key,fn), removeEventListener:key=>listeners.delete(key)};
  const selected = {mode:'auto', font:'serif', palette:'tokyonight'};
  applyAppearance(selected);
  assert.deepEqual(readAppearance(), selected);
  const cleanup = initializeAppearance();
  assert.deepEqual(document.documentElement.dataset, {theme:'light', palette:'tokyonight', chatFont:'serif'});
  assert.equal(colors.get('--palette-canvas'), getAppearancePalette('tokyonight','light').canvas);
  media.matches = true;
  listeners.get('media')();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(colors.get('--palette-canvas'), getAppearancePalette('tokyonight','dark').canvas);
  applyAppearance({...readAppearance(), mode:'light'});
  listeners.get('media')();
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.documentElement.dataset.palette, 'tokyonight');
  assert.equal(document.documentElement.dataset.chatFont, 'serif');
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify({...selected,font:'system'}));
  listeners.get('storage')({key:APPEARANCE_KEY});
  assert.equal(document.documentElement.dataset.chatFont,'system');
  cleanup();
  assert.equal(listeners.size,0);
});
