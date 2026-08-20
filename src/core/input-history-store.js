import fs from 'node:fs/promises';
import path from 'node:path';
import { getInputHistoryFilePath } from './paths.js';

const MAX_HISTORY = 300;

// Serializes appends so concurrent load→filter→write cycles cannot lose
// entries (each append waits for the previous one to fully persist).
let pendingAppend = Promise.resolve();

async function ensureDir(filePath) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
  } catch {
    // best-effort: the write below will surface a real failure if the
    // directory truly cannot be created.
  }
}

function normalizeList(value) {
  if (!Array.isArray(value)) return [];
  const lines = value
    .map((v) => String(v || '').trim())
    .filter(Boolean);
  if (lines.length <= MAX_HISTORY) return lines;
  return lines.slice(lines.length - MAX_HISTORY);
}

export async function loadInputHistory() {
  const filePath = getInputHistoryFilePath();
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeList(parsed?.items);
  } catch {
    return [];
  }
}

export async function appendInputHistory(line) {
  const normalized = String(line || '').trim();
  if (!normalized) return [];

  const filePath = getInputHistoryFilePath();
  const run = pendingAppend.then(async () => {
    const existing = await loadInputHistory();
    const next = existing.filter((v) => v !== normalized);
    next.push(normalized);
    const finalList = normalizeList(next);

    await ensureDir(filePath);
    // Write to a sibling temp file then rename, so a crash mid-write cannot
    // truncate the history and concurrent readers never see a partial file.
    const tempPath = `${filePath}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
    try {
      await fs.writeFile(
        tempPath,
        `${JSON.stringify({ updatedAt: new Date().toISOString(), items: finalList }, null, 2)}\n`,
        'utf8'
      );
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
    return finalList;
  });
  pendingAppend = run.catch(() => {});
  return run;
}
