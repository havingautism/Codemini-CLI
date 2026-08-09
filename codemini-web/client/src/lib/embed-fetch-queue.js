import pLimit from "p-limit";

const limitEmbedFetch = pLimit(2);

export function queueEmbedFetch(fn) {
  return limitEmbedFetch(fn);
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
