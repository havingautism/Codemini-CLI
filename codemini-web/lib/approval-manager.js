export class ApprovalManager {
  #pending = new Map();

  create(id) {
    return new Promise((resolve) => {
      this.#pending.set(id, { resolve });
    });
  }

  resolve(id, approved) {
    const entry = this.#pending.get(id);
    if (!entry) return false;
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
