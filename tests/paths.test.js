import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import { getBaseConfigDir } from '../src/core/paths.js';

test('CODEMINI_GLOBAL_DIR overrides the platform default', () => {
  const override = path.join(os.tmpdir(), 'codemini-global-override');
  assert.equal(
    getBaseConfigDir({
      env: { CODEMINI_GLOBAL_DIR: override },
      platform: 'linux',
      homedir: '/home/user',
    }),
    path.resolve(override),
  );
});

test('Linux without XDG_CONFIG_HOME uses ~/.config, not the current directory', () => {
  const homedir = '/home/someone';
  assert.equal(
    getBaseConfigDir({
      env: {},
      platform: 'linux',
      homedir,
    }),
    path.join(homedir, '.config', 'codemini-global'),
  );
  assert.equal(
    getBaseConfigDir({
      env: { XDG_CONFIG_HOME: '' },
      platform: 'linux',
      homedir,
    }),
    path.join(homedir, '.config', 'codemini-global'),
  );
});

test('Linux with XDG_CONFIG_HOME uses that directory', () => {
  assert.equal(
    getBaseConfigDir({
      env: { XDG_CONFIG_HOME: '/custom/xdg' },
      platform: 'linux',
      homedir: '/home/someone',
    }),
    path.join('/custom/xdg', 'codemini-global'),
  );
});

test('Windows and macOS keep user-profile global directories', () => {
  assert.equal(
    getBaseConfigDir({
      env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' },
      platform: 'win32',
      homedir: 'C:\\Users\\me',
    }),
    path.join('C:\\Users\\me\\AppData\\Roaming', 'codemini-global'),
  );
  assert.equal(
    getBaseConfigDir({
      env: {},
      platform: 'darwin',
      homedir: '/Users/me',
    }),
    path.join('/Users/me', 'Library', 'Preferences', 'codemini-global'),
  );
});
