/**
 * Session-scoped write coordination for concurrent agents sharing one
 * worktree (the parent agent plus every `run_subagent` in the same tool
 * bundle). This is what lets read-only and mutating subagents both run in
 * parallel without the side effects of concurrent mutations:
 *
 * - Per-path serialization: concurrent writes to the SAME file queue up (the
 *   second writer applies against the latest content, and each change-tracker
 *   capture window stays clean), while writes to DIFFERENT files proceed in
 *   parallel.
 * - Exclusive shell-run lock: a mutating shell command's file targets are
 *   unknown, so it waits for in-flight file writes and blocks new ones while
 *   it runs. Writer-priority keeps a steady stream of edits from starving
 *   shell commands.
 *
 * Read-only operations never take a lock, so parallel inspection is
 * unaffected.
 */
export function createWriteCoordinator() {
  /** key -> { tail } — per-path FIFO queues. */
  const pathQueues = new Map();
  /** File mutations currently executing. */
  let activeFiles = 0;
  /** Resolvers for file ops waiting on an active/queued exclusive run. */
  let fileWaiters = [];
  /** FIFO chain for exclusive (shell-run) operations. */
  let exclusiveChain = Promise.resolve();
  let exclusiveActive = false;
  let exclusiveQueued = false;

  const wakeFileWaiters = () => {
    const waiters = fileWaiters;
    fileWaiters = [];
    for (const resolve of waiters) resolve();
  };

  return {
    /**
     * Serialize mutations of one file. `key` is the normalized absolute path
     * (lowercased on Windows) shared by every caller touching that file.
     * `fn` runs once all earlier same-path operations and any exclusive run
     * have finished.
     */
    async withFileLock(key, fn) {
      let queue = pathQueues.get(key);
      if (!queue) {
        queue = { tail: Promise.resolve() };
        pathQueues.set(key, queue);
      }
      const previous = queue.tail;
      let release;
      queue.tail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        // Never start while an exclusive run is active or already waiting
        // (writer-priority: a queued command is not starved by new edits).
        while (exclusiveActive || exclusiveQueued) {
          await new Promise((resolve) => fileWaiters.push(resolve));
        }
        activeFiles += 1;
        return await fn();
      } finally {
        activeFiles -= 1;
        release();
        if (activeFiles === 0 && exclusiveQueued) wakeFileWaiters();
      }
    },
    /**
     * Run `fn` with the whole worktree locked against file mutations. Serial
     * with other exclusive runs; waits for in-flight file writes before
     * starting and blocks new ones until it finishes.
     */
    async withRunLock(fn) {
      const previous = exclusiveChain;
      let done;
      exclusiveChain = new Promise((resolve) => {
        done = resolve;
      });
      await previous;
      try {
        exclusiveQueued = true;
        while (activeFiles > 0) {
          await new Promise((resolve) => fileWaiters.push(resolve));
        }
        exclusiveQueued = false;
        exclusiveActive = true;
        return await fn();
      } finally {
        exclusiveActive = false;
        done();
        wakeFileWaiters();
      }
    },
  };
}
