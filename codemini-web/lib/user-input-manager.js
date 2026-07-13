export class UserInputManager {
  #pending = new Map();

  create(id, form) {
    return new Promise((resolve) => {
      this.#pending.set(id, { resolve, form: { ...form, id } });
    });
  }

  resolve(id, response = {}) {
    const entry = this.#pending.get(id);
    if (!entry) return false;
    this.#pending.delete(id);
    const status = response?.status === 'skipped' ? 'skipped' : 'submitted';
    const answers = response?.answers && typeof response.answers === 'object' && !Array.isArray(response.answers)
      ? response.answers
      : {};
    entry.resolve({ status, answers });
    return true;
  }

  resolveAll(response = { status: 'skipped', answers: {} }) {
    const ids = [...this.#pending.keys()];
    for (const id of ids) this.resolve(id, response);
    return ids.length;
  }

  has(id) {
    if (id == null || id === '') return this.#pending.size > 0;
    return this.#pending.has(id);
  }

  get pendingCount() {
    return this.#pending.size;
  }

  get current() {
    return this.#pending.values().next().value?.form || null;
  }
}
