/**
 * Tower wake queue and in-flight worker tracking for async tower workers.
 * Parent turns enqueue worker-completion wakes; drain runs after each turn ends.
 */
export function createTowerCoordinator({
  inFlightWorkers,
  isTurnActive,
  submitWake,
} = {}) {
  const inFlight = inFlightWorkers instanceof Set ? inFlightWorkers : new Set();
  const pendingWakes = [];
  let draining = false;

  const enqueueWake = (wakeText) => {
    const text = String(wakeText || '').trim();
    if (!text) return;
    pendingWakes.push(text);
    if (!isTurnActive?.() && !draining) {
      void drainPendingWakes();
    }
  };

  const drainPendingWakes = async () => {
    if (draining || typeof submitWake !== 'function') return;
    if (isTurnActive?.()) return;
    draining = true;
    try {
      while (pendingWakes.length && !isTurnActive?.()) {
        const next = pendingWakes.shift();
        if (!next) continue;
        try {
          await submitWake(next);
        } catch {
          pendingWakes.unshift(next);
          break;
        }
      }
    } finally {
      draining = false;
    }
  };

  const registerInFlight = (workerId) => {
    const id = String(workerId || '').trim();
    if (!id) return;
    inFlight.add(id);
  };

  const releaseInFlight = (workerId) => {
    const id = String(workerId || '').trim();
    if (!id) return;
    inFlight.delete(id);
  };

  const hasInFlight = (workerId) => {
    const id = String(workerId || '').trim();
    return id ? inFlight.has(id) : false;
  };

  return {
    enqueueWake,
    drainPendingWakes,
    registerInFlight,
    releaseInFlight,
    hasInFlight,
    get inFlight() { return inFlight; },
    get pendingWakeCount() { return pendingWakes.length; },
  };
}
