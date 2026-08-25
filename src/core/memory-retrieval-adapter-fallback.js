import { searchSubstring } from './memory-sqlite-store.js';

export class FallbackRetrievalAdapter {
  constructor({ db } = {}) {
    this.db = db;
    this.name = 'fallback';
  }

  async search(query, options = {}) {
    if (!this.db || !String(query || '').trim()) return [];
    return searchSubstring(this.db, { ...options, query });
  }

  async upsert() {}

  async remove() {}

  async rebuild() {}
}
