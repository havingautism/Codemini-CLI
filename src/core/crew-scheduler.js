import { abortErrorFromSignal } from './tower-cancel.js';

function normalizeLimit(value, fallback = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function createTowerWorkerScheduler({ getLimit = () => 4 } = {}) {
  let active = 0;
  const queue = [];

  const pump = () => {
    const limit = normalizeLimit(getLimit());
    while (active < limit && queue.length > 0) {
      const entry = queue.shift();
      entry.signal?.removeEventListener?.('abort', entry.onAbortQueued);
      if (entry.signal?.aborted) {
        entry.reject(abortErrorFromSignal(entry.signal));
        continue;
      }
      active += 1;
      entry.onStart?.();
      Promise.resolve()
        .then(entry.task)
        .then(entry.resolve, entry.reject)
        .finally(() => {
          active -= 1;
          pump();
        });
    }
  };

  return {
    isSaturated() {
      return active >= normalizeLimit(getLimit());
    },
    run(task, { onQueued, onStart, signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(abortErrorFromSignal(signal));
          return;
        }
        const entry = { task, resolve, reject, onStart, signal };
        entry.onAbortQueued = () => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(abortErrorFromSignal(signal));
        };
        signal?.addEventListener?.('abort', entry.onAbortQueued, { once: true });
        if (active >= normalizeLimit(getLimit())) onQueued?.();
        queue.push(entry);
        pump();
      });
    },
    snapshot() {
      return { active, queued: queue.length, limit: normalizeLimit(getLimit()) };
    },
  };
}
