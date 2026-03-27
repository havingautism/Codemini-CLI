import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = 'codemini-cli';
const LEGACY_APP_DIR = 'company-coder';

function getPreferredBaseConfigDir() {
  if (process.env.CODEMINI_CONFIG_DIR) {
    return process.env.CODEMINI_CONFIG_DIR;
  }

  if (process.env.COMPANY_CODER_CONFIG_DIR) {
    return process.env.COMPANY_CODER_CONFIG_DIR;
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, APP_DIR);
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Preferences', APP_DIR);
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, APP_DIR);
  }

  // Fallback for restricted/sandboxed non-Windows environments.
  return path.join(process.cwd(), '.codemini-cli');
}

function getLegacyBaseConfigDir() {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, LEGACY_APP_DIR);
  }

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Preferences', LEGACY_APP_DIR);
  }

  if (process.env.XDG_CONFIG_HOME) {
    return path.join(process.env.XDG_CONFIG_HOME, LEGACY_APP_DIR);
  }

  return path.join(process.cwd(), '.company-coder');
}

function tryMigrateLegacyDir(preferred, legacy) {
  if (!preferred || !legacy || preferred === legacy) return preferred;
  if (fs.existsSync(preferred) || !fs.existsSync(legacy)) return preferred;
  try {
    fs.renameSync(legacy, preferred);
    return preferred;
  } catch {
    return preferred;
  }
}

export function getBaseConfigDir() {
  const preferred = getPreferredBaseConfigDir();
  if (process.env.CODEMINI_CONFIG_DIR || process.env.COMPANY_CODER_CONFIG_DIR) {
    return preferred;
  }
  const legacy = getLegacyBaseConfigDir();
  return tryMigrateLegacyDir(preferred, legacy);
}

export function getLegacyConfigDir() {
  return getLegacyBaseConfigDir();
}

export function getConfigFilePath() {
  return path.join(getBaseConfigDir(), 'config.json');
}

export function getSessionsDir() {
  return path.join(getBaseConfigDir(), 'sessions');
}

export function getSkillsDir() {
  return path.join(getBaseConfigDir(), 'skills');
}

export function getSkillRegistryPath() {
  return path.join(getBaseConfigDir(), 'skill-registry.json');
}

export function getCommandsDir() {
  return path.join(getBaseConfigDir(), 'commands');
}

export function getInputHistoryFilePath() {
  return path.join(getBaseConfigDir(), 'input-history.json');
}

export function getProjectCommandsDir(cwd = process.cwd()) {
  return path.join(cwd, '.coder', 'commands');
}

export function getLegacyProjectSkillsDir(cwd = process.cwd()) {
  return path.join(cwd, '.coder', 'skills');
}

export function getLegacyGlobalSkillsDir() {
  return path.join(getBaseConfigDir(), 'skills');
}
