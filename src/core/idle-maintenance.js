// Recheck tickets when queued work starts: becoming idle once does not mean
// the session is still idle after another session's maintenance finishes.
export function createIdleMaintenanceScheduler(run, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const pending = new Map();
  const active = new Map();
  const lastActivity = new Map();
  let queue = Promise.resolve();
  const cancel = (id) => {
    const ticket = pending.get(id);
    if (ticket) {
      ticket.cancelled = true;
      clearTimer(ticket.timer);
      pending.delete(id);
    }
  };
  return {
    begin(id) {
      cancel(id);
      lastActivity.set(id, Date.now());
      active.set(id, (active.get(id) || 0) + 1);
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        lastActivity.set(id, Date.now());
        const count = (active.get(id) || 1) - 1;
        if (count) active.set(id, count);
        else active.delete(id);
      };
    },
    schedule(id, payload, delay) {
      cancel(id);
      const ticket = { cancelled: false };
      const arm = () => {
        ticket.timer = setTimer(() => {
          if (ticket.cancelled) return;
          if (active.has(id)) { arm(); return; }
          queue = queue.then(async () => {
            if (ticket.cancelled) return;
            if (active.has(id)) { arm(); return; }
            try {
              await run(id, payload, () => !ticket.cancelled && !active.has(id));
            } finally {
              if (pending.get(id) === ticket) pending.delete(id);
            }
          }).catch(() => {});
        }, delay);
        ticket.timer?.unref?.();
      };
      pending.set(id, ticket);
      arm();
    },
    isActive: (id) => active.has(id),
    isIdle: (id, minIdleMs) => !active.has(id) && Date.now() - (lastActivity.get(id) || 0) >= minIdleMs,
    cancel,
  };
}
