export const SKILL_DROP_SKIP_NAMES = new Set(['.git', 'node_modules', 'dist', 'build', '.codemini']);
export const SKILL_DROP_MAX_FILES = 4000;
export const SKILL_DROP_MAX_BYTES = 32 * 1024 * 1024;

function dropError(code, message) {
  return Object.assign(new Error(message), { code });
}

function shouldSkip(name) {
  return SKILL_DROP_SKIP_NAMES.has(String(name || ''));
}

export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = '';
  const stride = 0x8000;
  for (let index = 0; index < view.length; index += stride) {
    binary += String.fromCharCode(...view.subarray(index, index + stride));
  }
  return btoa(binary);
}

export async function flattenSkillDrop(roots) {
  const files = [];
  let bytes = 0;
  let sawDirectory = false;

  async function walk(entry, prefix) {
    if (!entry || shouldSkip(entry.name)) return;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      sawDirectory = true;
      const children = await entry.listChildren();
      for (const child of children || []) await walk(child, rel);
      return;
    }
    const data = new Uint8Array(await entry.readFile());
    bytes += data.byteLength;
    if (files.length >= SKILL_DROP_MAX_FILES || bytes > SKILL_DROP_MAX_BYTES) {
      throw dropError('FOLDER_TOO_LARGE', 'Folder is too large.');
    }
    files.push({ path: rel, data });
  }

  for (const root of roots || []) await walk(root, '');
  if (files.length === 0) {
    throw dropError(sawDirectory ? 'FOLDER_EMPTY' : 'FOLDER_REQUIRED', 'Drop a skill folder.');
  }
  if (!sawDirectory && !files.some((file) => file.path.split('/').pop() === 'SKILL.md')) {
    throw dropError('FOLDER_REQUIRED', 'Drop a skill folder.');
  }
  const directories = (roots || []).filter((entry) => entry?.isDirectory).map((entry) => entry.name);
  return {
    rootName: directories.length > 0 ? directories.join(', ') : (roots?.[0]?.name || ''),
    files,
  };
}

export function skillDropEntryFromDom(entry) {
  return {
    name: entry.name,
    isDirectory: Boolean(entry.isDirectory),
    listChildren: async () => {
      const reader = entry.createReader();
      const collected = [];
      while (true) {
        const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch?.length) break;
        collected.push(...batch);
      }
      return collected.map(skillDropEntryFromDom);
    },
    readFile: async () => {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}
