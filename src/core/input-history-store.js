import fs from 'node:fs/promises';
import path from 'node:path';
import { getInputHistoryFilePath } from './paths.js';

const MAX_HISTORY = 300;

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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
  const existing = await loadInputHistory();
  const next = existing.filter((v) => v !== normalized);
  next.push(normalized);
  const finalList = normalizeList(next);

  await ensureDir(filePath);
  await fs.writeFile(
    filePath,
    `${JSON.stringify({ updatedAt: new Date().toISOString(), items: finalList }, null, 2)}\n`,
    'utf8'
  );
  return finalList;
}
