import { existsSync } from 'node:fs';
import path from 'node:path';

const UNIX_NAMES = Object.freeze({
  chrome: ['google-chrome', 'google-chrome-stable'],
  msedge: ['microsoft-edge', 'microsoft-edge-stable'],
  chromium: ['chromium', 'chromium-browser'],
});

function safeExists(exists, filePath) {
  try {
    return Boolean(filePath) && exists(filePath);
  } catch {
    return false;
  }
}

function add(list, seen, channel, name, filePath) {
  const value = String(filePath || '').trim();
  if (!value || seen.has(value)) return;
  seen.add(value);
  list.push({ channel, name, path: value });
}

function pathEntries(pathEnv) {
  return String(pathEnv || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function browserCandidates({
  platform = process.platform,
  env = process.env,
  pathEnv = env.PATH || env.Path || '',
} = {}) {
  const list = [];
  const seen = new Set();
  const programFiles = env.PROGRAMFILES || 'C:\\Program Files';
  const programFilesX86 = env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';
  const localAppData = env.LOCALAPPDATA || '';

  if (platform === 'win32') {
    add(list, seen, 'chrome', 'Chrome', path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    add(list, seen, 'chrome', 'Chrome', path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    if (localAppData) {
      add(list, seen, 'chrome', 'Chrome', path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
    add(list, seen, 'msedge', 'Edge', path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(list, seen, 'msedge', 'Edge', path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    add(list, seen, 'chromium', 'Chromium', path.join(programFiles, 'Chromium', 'Application', 'chrome.exe'));
    for (const dir of pathEntries(pathEnv)) {
      add(list, seen, 'chrome', 'Chrome', path.join(dir, 'chrome.exe'));
      add(list, seen, 'msedge', 'Edge', path.join(dir, 'msedge.exe'));
      add(list, seen, 'chromium', 'Chromium', path.join(dir, 'chromium.exe'));
    }
    return list;
  }

  if (platform === 'darwin') {
    add(list, seen, 'chrome', 'Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    add(list, seen, 'msedge', 'Edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
    add(list, seen, 'chromium', 'Chromium', '/Applications/Chromium.app/Contents/MacOS/Chromium');
  } else {
    add(list, seen, 'chrome', 'Chrome', '/usr/bin/google-chrome');
    add(list, seen, 'chrome', 'Chrome', '/usr/bin/google-chrome-stable');
    add(list, seen, 'msedge', 'Edge', '/usr/bin/microsoft-edge');
    add(list, seen, 'msedge', 'Edge', '/usr/bin/microsoft-edge-stable');
    add(list, seen, 'msedge', 'Edge', '/opt/microsoft/msedge/msedge');
    add(list, seen, 'chromium', 'Chromium', '/usr/bin/chromium');
    add(list, seen, 'chromium', 'Chromium', '/usr/bin/chromium-browser');
    add(list, seen, 'chromium', 'Chromium', '/snap/bin/chromium');
  }

  for (const dir of pathEntries(pathEnv)) {
    for (const [channel, names] of Object.entries(UNIX_NAMES)) {
      const label = channel === 'msedge' ? 'Edge' : channel === 'chromium' ? 'Chromium' : 'Chrome';
      for (const name of names) add(list, seen, channel, label, path.join(dir, name));
    }
  }
  return list;
}

export function findInstalledBrowsers(options = {}) {
  const exists = options.exists || existsSync;
  return browserCandidates(options).filter((candidate) => safeExists(exists, candidate.path));
}
