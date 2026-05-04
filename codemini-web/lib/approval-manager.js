const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

export class ApprovalManager {
  #pending = new Map();

  create(id) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ approved: false });
      }, APPROVAL_TIMEOUT_MS);
      this.#pending.set(id, { resolve, timer });
    });
  }

  resolve(id, approved) {
    const entry = this.#pending.get(id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.#pending.delete(id);
    entry.resolve({ approved });
    return true;
  }

  has(id) {
    return this.#pending.has(id);
  }

  get pendingCount() {
    return this.#pending.size;
  }
}
