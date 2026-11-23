import fs from 'node:fs/promises';
import path from 'node:path';

function folderError(code, message) {
  return Object.assign(new Error(message), { code });
}

export async function createProjectFolder(dir, name) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || dir.includes('\0')) {
    throw folderError('INVALID_PARENT', 'Choose a parent directory first.');
  }
  if (typeof name !== 'string' || !name.trim() ||
    name === '.' || name === '..' || /[/\\\u0000-\u001f]/u.test(name) ||
    (process.platform === 'win32' &&
      (/[:*?"<>|]|[ .]$/u.test(name) || /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/iu.test(name)))) {
    throw folderError('INVALID_NAME', 'Enter a valid folder name.');
  }

  const folder = path.join(dir, name);
  await fs.mkdir(folder);
  return { name, path: folder, isGit: false };
}
