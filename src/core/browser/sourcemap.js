import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let traceMappingPromise;

function loadTraceMapping() {
  if (!traceMappingPromise) {
    traceMappingPromise = import('@jridgewell/trace-mapping');
  }
  return traceMappingPromise;
}

export function extractSourceMappingUrl(source) {
  const match = String(source || '').match(/[@#]\s*sourceMappingURL=([^\s*'"]+)/);
  return match ? match[1].trim() : '';
}

export function parseStackFrames(stack) {
  const frames = [];
  for (const line of String(stack || '').split('\n')) {
    const match = line.match(/at\s+(?:(.+?)\s+\()?(.*?):(\d+):(\d+)\)?\s*$/);
    if (!match) continue;
    const url = String(match[2] || '').trim();
    if (!url || url === 'native' || url.startsWith('eval')) continue;
    frames.push({
      name: String(match[1] || '').replace(/^async\s+/, '').trim(),
      url,
      line: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return frames;
}

function decodeDataUrl(url) {
  const comma = url.indexOf(',');
  if (comma === -1) return '';
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  if (/;base64/i.test(meta)) return Buffer.from(data, 'base64').toString('utf8');
  return decodeURIComponent(data);
}

export async function mapGeneratedPosition({ sourceMap, line, column, oneBased = false }) {
  const { TraceMap, originalPositionFor } = await loadTraceMapping();
  const consumer = sourceMap instanceof Object && sourceMap.version
    ? new TraceMap(sourceMap)
    : new TraceMap(String(sourceMap || ''));
  const generatedLine = oneBased ? Number(line) : Number(line) + 1;
  const generatedColumn = oneBased ? Math.max(0, Number(column) - 1) : Number(column);
  const position = originalPositionFor(consumer, {
    line: generatedLine,
    column: Number.isFinite(generatedColumn) ? generatedColumn : 0,
  });
  if (!position?.source) return null;
  return {
    source: position.source,
    line: position.line,
    column: position.column,
    name: position.name || '',
  };
}

function joinSource(source, sourceRoot) {
  if (!sourceRoot) return source;
  if (/^(?:[a-z]+:|\/)/i.test(source) || /^[A-Za-z]:[\\/]/.test(source)) return source;
  const root = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
  try {
    if (/^[a-z]+:/i.test(root)) return new URL(source, root).href;
  } catch {
    // Fall through to a path join.
  }
  return path.posix.join(root, source);
}

export function resolveMappedFile(source, { mapUrl = '', mapDir = '', workspaceRoot = '', sourceRoot = '' } = {}) {
  const raw = joinSource(String(source || '').trim(), sourceRoot);
  if (!raw) return '';
  const candidates = [];
  if (path.isAbsolute(raw)) candidates.push(raw);
  if (/^file:/i.test(raw)) {
    try { candidates.push(fileURLToPath(raw)); } catch { /* ignore */ }
  }
  if (mapDir && !/^[a-z]+:/i.test(raw)) candidates.push(path.resolve(mapDir, raw));
  if (mapUrl && !path.isAbsolute(raw)) {
    try {
      const resolved = new URL(raw, mapUrl);
      if (resolved.protocol === 'file:') candidates.push(fileURLToPath(resolved));
      const pathname = decodeURIComponent(resolved.pathname || '');
      if (pathname && workspaceRoot) {
        candidates.push(path.resolve(workspaceRoot, pathname.replace(/^\/+/, '')));
      }
    } catch {
      // Ignore unresolvable source URLs.
    }
  }
  const normalized = raw.replaceAll('\\', '/');
  const srcIndex = normalized.lastIndexOf('/src/');
  if (srcIndex !== -1 && workspaceRoot) {
    candidates.push(path.resolve(workspaceRoot, normalized.slice(srcIndex + 1)));
  }
  if (workspaceRoot && !/^[a-z]+:/i.test(raw)) {
    candidates.push(path.resolve(workspaceRoot, raw.replace(/^\.\//, '')));
  }
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return path.resolve(candidate);
  }
  return candidates.find(Boolean) || raw;
}

export function displayPath(file, workspaceRoot) {
  const value = String(file || '').trim();
  if (!value) return '';
  if (!path.isAbsolute(value) || !workspaceRoot) return value.replaceAll('\\', '/');
  const relative = path.relative(path.resolve(workspaceRoot), value);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return value;
  }
  return relative.split(path.sep).join('/');
}

export function isLibraryPath(file) {
  const value = String(file || '').replaceAll('\\', '/');
  return /\/node_modules\/|\/react-dom|\/react\/jsx|webpack\/bootstrap|@vite\/client/.test(value);
}

export function createSourceResolver({ workspaceRoot, getScript, readText }) {
  const maps = new Map();

  async function loadMap(script) {
    if (!script) return null;
    if (maps.has(script.scriptId)) return maps.get(script.scriptId);
    let mapUrl = String(script.sourceMapURL || '').trim();
    if (!mapUrl && script.url) {
      const source = await readText(script.url).catch(() => '');
      const relative = extractSourceMappingUrl(source);
      if (relative) {
        try { mapUrl = new URL(relative, script.url).href; } catch { mapUrl = relative; }
      }
    }
    if (!mapUrl) {
      maps.set(script.scriptId, null);
      return null;
    }
    let parsed = null;
    let mapDir = '';
    try {
      if (mapUrl.startsWith('data:')) {
        parsed = JSON.parse(decodeDataUrl(mapUrl));
      } else {
        const text = await readText(mapUrl);
        parsed = JSON.parse(text);
        if (mapUrl.startsWith('file:')) mapDir = path.dirname(fileURLToPath(mapUrl));
        else if (workspaceRoot) {
          try {
            const pathname = decodeURIComponent(new URL(mapUrl).pathname || '');
            const candidate = path.resolve(workspaceRoot, pathname.replace(/^\/+/, ''));
            if (existsSync(candidate)) mapDir = path.dirname(candidate);
            else if (existsSync(path.join(workspaceRoot, 'dist', pathname.replace(/^\/+/, '')))) {
              mapDir = path.dirname(path.join(workspaceRoot, 'dist', pathname.replace(/^\/+/, '')));
            }
          } catch {
            mapDir = '';
          }
        }
      }
    } catch {
      parsed = null;
    }
    const loaded = parsed ? { map: parsed, mapUrl, mapDir } : null;
    maps.set(script.scriptId, loaded);
    return loaded;
  }

  function scriptPath(value) {
    try {
      if (/^[a-z]+:/i.test(value)) return decodeURIComponent(new URL(value).pathname);
    } catch {
      return value;
    }
    return value;
  }

  function sameScript(scriptUrl, frameUrl) {
    if (!scriptUrl || !frameUrl) return false;
    if (scriptUrl === frameUrl) return true;
    const left = scriptPath(scriptUrl);
    const right = scriptPath(frameUrl);
    return Boolean(left && right && (left === right || left.endsWith(right) || right.endsWith(left)));
  }

  function diskMap(value) {
    const relative = scriptPath(value).replace(/^\/+/, '');
    if (!relative || !workspaceRoot || /^[a-z]+:/i.test(relative)) return null;
    const candidates = [
      path.resolve(workspaceRoot, relative),
      path.resolve(workspaceRoot, 'dist', relative),
    ];
    for (const file of candidates) {
      const mapFile = `${file}.map`;
      if (!existsSync(mapFile)) continue;
      try {
        return {
          map: JSON.parse(readFileSync(mapFile, 'utf8')),
          mapUrl: pathToFileURL(mapFile).href,
          mapDir: path.dirname(mapFile),
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  async function locate({ scriptId = '', line = 0, column = 0, oneBased = false, url = '' } = {}) {
    const script = getScript(scriptId) || getScriptsSafe().find((item) => sameScript(item.url, url)) || null;
    const generatedLine = oneBased ? Number(line) : Number(line) + 1;
    const generatedColumn = oneBased ? Number(column) : Number(column) + 1;
    let loaded = script ? await loadMap(script) : null;
    if (!loaded?.map) loaded = diskMap(script?.url || url);
    if (loaded?.map) {
      const mapped = await mapGeneratedPosition({
        sourceMap: loaded.map,
        line: generatedLine,
        column: oneBased ? column : Number(column) + 1,
        oneBased: true,
      });
      if (mapped?.source) {
        const file = resolveMappedFile(mapped.source, {
          mapUrl: loaded.mapUrl,
          mapDir: loaded.mapDir,
          workspaceRoot,
          sourceRoot: loaded.map.sourceRoot || '',
        });
        return {
          file: displayPath(file, workspaceRoot),
          absoluteFile: path.isAbsolute(file) ? file : '',
          line: mapped.line,
          column: mapped.column,
          name: mapped.name || '',
          generatedUrl: script?.url || url,
        };
      }
    }
    const fallback = script?.url || url;
    if (!fallback) return null;
    const file = resolveMappedFile(fallback, { mapUrl: fallback, workspaceRoot });
    return {
      file: displayPath(file, workspaceRoot) || fallback,
      absoluteFile: path.isAbsolute(file) ? file : '',
      line: generatedLine,
      column: generatedColumn,
      name: '',
      generatedUrl: fallback,
    };
  }

  function getScriptsSafe() {
    return typeof getScript.all === 'function' ? getScript.all() : [];
  }

  return { locate };
}

export function readLocalText(url, workspaceRoot) {
  if (!url) return Promise.reject(new Error('missing url'));
  if (url.startsWith('data:')) return Promise.resolve(decodeDataUrl(url));
  if (url.startsWith('file:')) {
    return Promise.resolve(readFileSync(fileURLToPath(url), 'utf8'));
  }
  if (/^https?:\/\//i.test(url)) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    return fetch(url, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .finally(() => clearTimeout(timer));
  }
  const absolute = path.resolve(workspaceRoot || process.cwd(), url);
  return Promise.resolve(readFileSync(absolute, 'utf8'));
}
