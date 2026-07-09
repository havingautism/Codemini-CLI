export class ApprovalManager {
  #pending = new Map();

  create(id) {
    return new Promise((resolve) => {
      this.#pending.set(id, { resolve });
    });
  }

  resolve(id, approved, reason = '') {
    const entry = this.#pending.get(id);
    if (!entry) return false;
    this.#pending.delete(id);
    const payload = { approved: Boolean(approved) };
    if (!payload.approved && reason) payload.reason = String(reason);
    entry.resolve(payload);
    return true;
  }

  resolveAll(response = { approved: false }) {
    const ids = [...this.#pending.keys()];
    for (const id of ids) {
      this.resolve(id, response?.approved === true, response?.reason || '');
    }
    return ids.length;
  }

  has(id) {
    if (id == null || id === '') return this.#pending.size > 0;
    return this.#pending.has(id);
  }

  get pendingCount() {
    return this.#pending.size;
  }
}
