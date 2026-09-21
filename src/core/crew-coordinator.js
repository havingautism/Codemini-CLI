/**
 * Crew wake queue and in-flight worker tracking for async crew workers.
 * Parent turns enqueue worker-completion wakes; drain runs after each turn ends.
 * Each drain call starts at most one wake so a queued user prompt can claim the
 * next idle slot instead of being starved by a wake chain.
 * onWakeQueued fires immediately so the UI can paint a divider before submit.
 */
export function createCrewCoordinator({
  inFlightWorkers,
  isTurnActive,
  submitWake,
  onWakeQueued,
} = {}) {
  const inFlight = inFlightWorkers instanceof Set ? inFlightWorkers : new Set();
  const pendingWakes = [];
  let draining = false;
  let wakeSeq = 0;

  const enqueueWake = (wakeText) => {
    const text = String(wakeText || '').trim();
    if (!text) return;
    const item = {
      text,
      messageId: `crew-wake-${Date.now().toString(36)}-${(wakeSeq += 1).toString(36)}`,
      timestamp: new Date().toISOString(),
    };
    pendingWakes.push(item);
    try {
      onWakeQueued?.(item);
    } catch {
      // UI notification must not block wake queueing.
    }
    if (!isTurnActive?.() && !draining) {
      void drainPendingWakes();
    }
  };

  const drainPendingWakes = async () => {
    if (draining || typeof submitWake !== 'function') return;
    if (isTurnActive?.()) return;
    draining = true;
    try {
      const next = pendingWakes.shift();
      if (!next) return;
      try {
        await submitWake(next.text, next);
      } catch {
        pendingWakes.unshift(next);
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
