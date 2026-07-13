const MAX_CONCURRENT = 2;
let active = 0;
const pending = [];

function pump() {
  while (active < MAX_CONCURRENT && pending.length > 0) {
    const job = pending.shift();
    active += 1;
    Promise.resolve()
      .then(() => job.fn())
      .then(job.resolve, job.reject)
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

export function queueEmbedFetch(fn) {
  return new Promise((resolve, reject) => {
    pending.push({ fn, resolve, reject });
    pump();
  });
}

export function deferUntilIdle(callback, { timeout = 1500 } = {}) {
  if (typeof window === "undefined") {
    return setTimeout(callback, 0);
  }
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, { timeout });
  }
  return window.setTimeout(callback, 80);
}

export function cancelDeferred(id) {
  if (typeof window === "undefined") return;
  if (typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(id);
    return;
  }
  window.clearTimeout(id);
}
