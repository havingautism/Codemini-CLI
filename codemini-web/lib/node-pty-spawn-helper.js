import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function resolveNodePtyRoot() {
  try {
    return path.dirname(require.resolve('node-pty/package.json'));
  } catch {
    return '';
  }
}

function collectSpawnHelpers(root) {
  if (!root) return [];
  const helpers = [];
  const buckets = [
    path.join(root, 'prebuilds'),
    path.join(root, 'build', 'Release'),
  ];
  for (const bucket of buckets) {
    let entries = [];
    try {
      entries = fs.readdirSync(bucket, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        helpers.push(path.join(bucket, entry.name, 'spawn-helper'));
      } else if (entry.name === 'spawn-helper') {
        helpers.push(path.join(bucket, entry.name));
      }
    }
  }
  return helpers.filter((helper) => {
    try {
      return fs.statSync(helper).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * node-pty 1.1.0 ships macOS `spawn-helper` without the execute bit.
 * posix_spawnp then fails and the Web UI terminal stays blank.
 */
export function ensureNodePtySpawnHelperExecutable(
  ptyRoot = resolveNodePtyRoot(),
) {
  const helpers = collectSpawnHelpers(ptyRoot);
  const repaired = [];
  for (const helper of helpers) {
    try {
      const stat = fs.statSync(helper);
      if ((stat.mode & 0o111) !== 0) continue;
      fs.chmodSync(helper, stat.mode | 0o111);
      repaired.push(helper);
    } catch {}
  }
  return { helpers, repaired };
}
