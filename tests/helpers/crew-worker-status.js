import fs from 'node:fs/promises';

import { getProjectCrewStatePath } from '../../src/core/paths.js';
import { listCrewWorkersFromState } from '../../src/core/crew-store.js';

export function crewWorkerRunStatusMatches(worker, expected) {
  const actual = String(worker?.runStatus || '').trim();
  if (expected === 'completed') {
    return actual === 'completed' || actual === 'awaiting_submit';
  }
  return actual === expected;
}

export async function waitForCrewWorkerRunStatus(dir, workerId, status, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const raw = await fs.readFile(getProjectCrewStatePath(dir), 'utf8').catch(() => '');
    if (raw) {
      const worker = listCrewWorkersFromState(JSON.parse(raw)).find((item) => (
        item.id === workerId || String(item.name || '').toLowerCase() === String(workerId).toLowerCase()
      ));
      if (worker && crewWorkerRunStatusMatches(worker, status)) return worker;
    }
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`timed out waiting for ${workerId} status=${status}`);
}
