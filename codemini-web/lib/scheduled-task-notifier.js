import { getScheduledChangeState } from '../../src/core/scheduled-task-store.js';

// One constant-size read per server tick, shared by every connected browser.
// The revision changes only for scheduler writes, never transcript chunks or heartbeats.
export function createScheduledTaskNotifier({ publish, hasClients, readState = getScheduledChangeState, intervalMs = 2000 }) {
  let previous = '';
  const tick = () => {
    if (!hasClients()) return;
    try {
      const state = readState();
      const signature = JSON.stringify(state);
      if (signature === previous) return;
      previous = signature;
      publish({ type: 'scheduled:changed', ...state });
    } catch (error) {
      console.warn('Scheduled task notification:', error?.message || String(error));
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, stop: () => clearInterval(timer) };
}
