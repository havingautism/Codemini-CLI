import path from 'node:path';

const BUSY_STATUSES = new Set([
  'queued', 'running', 'waiting_approval', 'waiting_input'
]);
const WAITING_STATUSES = new Set(['waiting_approval', 'waiting_input']);
const SETTLED_STATUSES = new Set([
  ...WAITING_STATUSES, 'completed', 'failed', 'aborted', 'interrupted'
]);
const EVICTABLE_STATUSES = new Set([
  'idle', 'completed', 'failed', 'aborted', 'interrupted'
]);

export function startRuntimeEvictionTimer(
  pool,
  { intervalMs = 5 * 60_000 } = {}
) {
  const timer = setInterval(() => {
    Promise.resolve(pool.evictIdle()).catch(() => {});
  }, intervalMs);
  timer.unref?.();
  timer.stop = () => clearInterval(timer);
  return timer;
}

export class RuntimePool {
  constructor({
    runtimeFactory,
    maxConcurrent = 3,
    idleTtlMs = 30 * 60_000,
    onEvent = () => {}
  }) {
    if (typeof runtimeFactory !== 'function') {
      throw new TypeError('runtimeFactory must be a function');
    }
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError('maxConcurrent must be a positive integer');
    }

    this.runtimeFactory = runtimeFactory;
    this.maxConcurrent = maxConcurrent;
    this.idleTtlMs = idleTtlMs;
    this.onEvent = onEvent;
    this.entries = new Map();
    this.creating = new Map();
    this.queue = [];
    this.running = new Set();
  }

  async ensureSession({ sessionId, projectDir, model }) {
    if (this.entries.has(sessionId)) return this.entries.get(sessionId);
    if (this.creating.has(sessionId)) return this.creating.get(sessionId);

    const creation = Promise.resolve(
      this.runtimeFactory({ sessionId, projectDir, model })
    ).then(bridge => {
      const entry = {
        sessionId,
        projectDir,
        model,
        bridge,
        status: 'idle',
        operation: null,
        updatedAt: Date.now(),
        runId: 0
      };
      this.entries.set(sessionId, entry);
      return entry;
    }).finally(() => {
      this.creating.delete(sessionId);
    });
    this.creating.set(sessionId, creation);
    return creation;
  }

  submit(sessionId, operation) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new Error(`Unknown session: ${sessionId}`);
    if (BUSY_STATUSES.has(entry.status)) {
      return {
        accepted: false,
        code: 'SESSION_BUSY',
        status: entry.status
      };
    }

    entry.operation = operation;
    if (this.running.size >= this.maxConcurrent) {
      this.#enqueue(entry);
      return {
        accepted: true,
        state: 'queued',
        queuePosition: this.queue.length
      };
    }

    this.#start(entry);
    return { accepted: true, state: 'running', queuePosition: null };
  }

  resolveWaiting(sessionId) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new Error(`Unknown session: ${sessionId}`);
    if (!WAITING_STATUSES.has(entry.status)) return false;
    this.#enqueue(entry);
    this.#drain();
    return true;
  }

  resume(sessionId, operation) {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new Error(`Unknown session: ${sessionId}`);
    if (!WAITING_STATUSES.has(entry.status)) {
      return {
        accepted: false,
        code: 'SESSION_NOT_WAITING',
        status: entry.status
      };
    }
    entry.operation = operation;
    this.#enqueue(entry);
    this.#drain();
    return {
      accepted: true,
      state: entry.status,
      queuePosition: this.#snapshot(entry).queuePosition
    };
  }

  /**
   * Put a session into waiting_approval / waiting_input even if the Pool RUN
   * already settled (e.g. completed ate the lifecycle waiter). Frees a running
   * slot when needed so concurrency stays correct.
   */
  markWaiting(sessionId, status = 'waiting_approval') {
    const entry = this.entries.get(sessionId);
    if (!entry) throw new Error(`Unknown session: ${sessionId}`);
    if (!WAITING_STATUSES.has(status)) {
      throw new RangeError(`Invalid waiting status: ${status}`);
    }
    if (entry.status === status) return this.#snapshot(entry);

    this.#removeQueued(sessionId);
    if (entry.status === 'running') {
      this.running.delete(sessionId);
    }
    // Keep operation only while a live run may still resume via waiter settle.
    // After terminal settle, operation is already null; waiting is Bridge-backed.
    this.#setStatus(entry, status);
    this.#drain();
    return this.#snapshot(entry);
  }

  async abort(sessionId) {
    const entry = this.entries.get(sessionId);
    if (!entry) return false;

    this.#removeQueued(sessionId);
    this.running.delete(sessionId);
    entry.runId += 1;
    entry.operation = null;
    try {
      await entry.bridge?.abort?.();
    } finally {
      this.#setStatus(entry, 'aborted');
      this.#emitQueuedStates();
      this.#drain();
    }
    return true;
  }

  async abortAll() {
    const entries = [...this.entries.values()].filter(entry =>
      BUSY_STATUSES.has(entry.status)
    );
    this.queue = [];
    this.running.clear();

    const results = await Promise.allSettled(entries.map(async entry => {
      entry.runId += 1;
      entry.operation = null;
      try {
        await entry.bridge?.abort?.();
      } finally {
        this.#setStatus(entry, 'aborted');
      }
    }));
    this.#emitQueuedStates();
    this.#drain();

    const errors = results
      .filter(result => result.status === 'rejected')
      .map(result => result.reason);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Failed to abort all sessions');
    }
  }

  getSessionState(sessionId) {
    const entry = this.entries.get(sessionId);
    return entry ? this.#snapshot(entry) : null;
  }

  listStates() {
    return [...this.entries.values()].map(entry => this.#snapshot(entry));
  }

  async reloadConfig(options = {}) {
    const nextModel = String(options.model || '').trim();
    await Promise.all([...this.entries.values()].map(async entry => {
      await entry.bridge?.reloadConfig?.(options);
      if (nextModel) entry.model = nextModel;
      entry.updatedAt = Date.now();
      entry.bridge?.broadcastRuntimeState?.();
      this.#emitState(entry);
    }));
  }

  async evictIdle(now = Date.now()) {
    const evicted = [];
    const disposals = [];
    for (const [sessionId, entry] of this.entries) {
      if (
        EVICTABLE_STATUSES.has(entry.status) &&
        now - entry.updatedAt > this.idleTtlMs
      ) {
        this.entries.delete(sessionId);
        evicted.push(sessionId);
        disposals.push(Promise.resolve().then(() => entry.bridge?.dispose?.()));
      }
    }
    await Promise.allSettled(disposals);
    return evicted;
  }

  #enqueue(entry) {
    if (!this.queue.includes(entry.sessionId)) this.queue.push(entry.sessionId);
    this.#setStatus(entry, 'queued');
    this.#emitQueuedStates();
  }

  #start(entry) {
    this.#removeQueued(entry.sessionId);
    this.running.add(entry.sessionId);
    const runId = ++entry.runId;
    this.#setStatus(entry, 'running');

    let result;
    try {
      result = entry.operation(entry.bridge);
    } catch {
      this.#settle(entry, runId, 'failed');
      return;
    }
    Promise.resolve(result).then(
      outcome => this.#settle(entry, runId, outcome?.status ?? 'completed'),
      () => this.#settle(entry, runId, 'failed')
    );
  }

  #settle(entry, runId, status) {
    if (entry.runId !== runId || entry.status !== 'running') return;
    const nextStatus = SETTLED_STATUSES.has(status) ? status : 'completed';
    this.running.delete(entry.sessionId);

    if (!WAITING_STATUSES.has(nextStatus)) entry.operation = null;
    this.#setStatus(entry, nextStatus);
    this.#drain();
  }

  #drain() {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const sessionId = this.queue.shift();
      const entry = this.entries.get(sessionId);
      if (entry?.status === 'queued') this.#start(entry);
    }
    this.#emitQueuedStates();
  }

  #removeQueued(sessionId) {
    const index = this.queue.indexOf(sessionId);
    if (index !== -1) this.queue.splice(index, 1);
  }

  #setStatus(entry, status) {
    entry.status = status;
    entry.updatedAt = Date.now();
    this.#emitState(entry);
    for (const peer of this.entries.values()) {
      if (peer !== entry && this.#sameProjectRoot(peer, entry)) {
        this.#emitState(peer);
      }
    }
  }

  #emitQueuedStates() {
    for (const sessionId of this.queue) {
      const entry = this.entries.get(sessionId);
      if (entry) this.#emitState(entry);
    }
  }

  #emitState(entry) {
    this.onEvent({
      type: 'runtime_pool_state',
      sessionId: entry.sessionId,
      state: this.#snapshot(entry)
    });
  }

  #snapshot(entry) {
    const queueIndex = entry.status === 'queued'
      ? this.queue.indexOf(entry.sessionId)
      : -1;
    return {
      sessionId: entry.sessionId,
      projectDir: entry.projectDir,
      model: entry.model,
      status: entry.status,
      busy: BUSY_STATUSES.has(entry.status),
      queuePosition: queueIndex === -1 ? null : queueIndex + 1,
      updatedAt: entry.updatedAt,
      parallelWriteRisk: this.#hasParallelWriteRisk(entry)
    };
  }

  #hasParallelWriteRisk(entry) {
    if (!BUSY_STATUSES.has(entry.status)) return false;
    const root = this.#normalizeRoot(entry.projectDir);
    if (!root) return false;
    return [...this.entries.values()].some(other =>
      other !== entry &&
      BUSY_STATUSES.has(other.status) &&
      this.#normalizeRoot(other.projectDir) === root
    );
  }

  #sameProjectRoot(first, second) {
    const root = this.#normalizeRoot(first.projectDir);
    return Boolean(root) && root === this.#normalizeRoot(second.projectDir);
  }

  #normalizeRoot(value) {
    const raw = String(value || '');
    return /^[A-Za-z]:[\\/]/.test(raw)
      ? path.win32.resolve(raw).toLowerCase()
      : path.resolve(raw);
  }
}
