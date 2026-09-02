function posixPath(value) {
  return String(value || '').replace(/\\/g, '/').trim();
}

export function normalizeTowerGlob(value) {
  let glob = posixPath(value);
  if (!glob) return '';
  glob = glob.replace(/^\.\//, '');
  if (!glob) return '';
  if (pathIsAbsoluteGlob(glob)) return '';
  const parts = glob.split('/');
  if (parts.some((part) => part === '..')) return '';
  return glob;
}

function pathIsAbsoluteGlob(glob) {
  if (glob.startsWith('/')) return true;
  return /^[A-Za-z]:\//.test(glob);
}

export function normalizeTowerPaths(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const glob = normalizeTowerGlob(item);
    if (!glob || seen.has(glob)) continue;
    seen.add(glob);
    out.push(glob);
  }
  return out;
}

export function normalizeTowerDependsOn(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))];
}

function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      if (glob[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index += 1;
      }
      continue;
    }
    if (char === '*') {
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if ('\\^$+{}()|[]'.includes(char)) {
      source += `\\${char}`;
      continue;
    }
    source += char;
  }
  return new RegExp(`^${source}$`);
}

export function fileMatchesTowerGlob(file, glob) {
  const relative = posixPath(file).replace(/^\.\//, '');
  const pattern = normalizeTowerGlob(glob);
  if (!relative || !pattern) return false;
  return globToRegExp(pattern).test(relative);
}

export function fileMatchesTowerPaths(file, paths) {
  const globs = normalizeTowerPaths(paths);
  if (globs.length === 0) return false;
  return globs.some((glob) => fileMatchesTowerGlob(file, glob));
}

function staticPrefix(glob) {
  const pattern = normalizeTowerGlob(glob);
  const star = pattern.search(/[*?[]/);
  const cut = star === -1 ? pattern : pattern.slice(0, star);
  return cut.replace(/\/$/, '');
}

export function towerGlobsOverlap(left, right) {
  const a = normalizeTowerGlob(left);
  const b = normalizeTowerGlob(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const aPrefix = staticPrefix(a);
  const bPrefix = staticPrefix(b);
  if (fileMatchesTowerGlob(aPrefix || a, b) || fileMatchesTowerGlob(bPrefix || b, a)) return true;
  if (aPrefix && fileMatchesTowerGlob(aPrefix, b)) return true;
  if (bPrefix && fileMatchesTowerGlob(bPrefix, a)) return true;
  if (aPrefix && fileMatchesTowerGlob(`${aPrefix}/file`, b)) return true;
  if (bPrefix && fileMatchesTowerGlob(`${bPrefix}/file`, a)) return true;
  if (aPrefix && bPrefix) {
    if (aPrefix === bPrefix) return true;
    if (aPrefix.startsWith(`${bPrefix}/`) || bPrefix.startsWith(`${aPrefix}/`)) {
      const shorter = aPrefix.length <= bPrefix.length ? a : b;
      const longerPrefix = aPrefix.length <= bPrefix.length ? bPrefix : aPrefix;
      return fileMatchesTowerGlob(longerPrefix, shorter)
        || fileMatchesTowerGlob(`${longerPrefix}/file`, shorter);
    }
  }
  if (!aPrefix || !bPrefix) return true;
  return false;
}

export function workerHoldsTowerScope(worker) {
  return Boolean(worker) && worker.integrated !== true;
}

export function findOverlappingTowerWorker(paths, workers, { exceptId = '' } = {}) {
  const next = normalizeTowerPaths(paths);
  const list = Array.isArray(workers) ? workers : [];
  const skipId = String(exceptId || '').trim();
  for (const worker of list) {
    if (!workerHoldsTowerScope(worker)) continue;
    if (skipId && String(worker?.id || '').trim() === skipId) continue;
    const existing = normalizeTowerPaths(worker?.paths);
    if (existing.length === 0) {
      return {
        worker,
        glob: next[0] || '',
        existing: '(unscoped)',
      };
    }
    for (const glob of next) {
      for (const other of existing) {
        if (towerGlobsOverlap(glob, other)) {
          return { worker, glob, existing: other };
        }
      }
    }
  }
  return null;
}

function workerKeys(worker) {
  return [worker?.id, worker?.taskId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export function orderTowerWorkersForLand(workers) {
  const list = (Array.isArray(workers) ? workers : []).filter(Boolean);
  const byId = new Map();
  for (const worker of list) {
    for (const key of workerKeys(worker)) {
      if (!byId.has(key)) byId.set(key, worker);
    }
  }
  const remaining = [...list];
  const ordered = [];
  const placed = new Set();
  while (remaining.length) {
    const index = remaining.findIndex((worker) => {
      const deps = normalizeTowerDependsOn(worker.dependsOn);
      return deps.every((dep) => {
        const target = byId.get(dep);
        return !target || placed.has(target);
      });
    });
    if (index < 0) {
      ordered.push(...remaining);
      break;
    }
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    placed.add(next);
  }
  return ordered;
}
