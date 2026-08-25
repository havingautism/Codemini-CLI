import { rebuildMemoryIndex, searchFts, syncMemoryFts } from './memory-sqlite-store.js';

export class FTS5RetrievalAdapter {
  constructor({ db, index = {}, onMetric } = {}) {
    this.db = db;
    this.index = index;
    this.name = 'fts5';
    this.onMetric = typeof onMetric === 'function' ? onMetric : null;
  }

  async search(query, options = {}) {
    if (!this.db || !String(query || '').trim()) return [];
    return searchFts(this.db, {
      ...options,
      query,
      rebuild: this.index.rebuild_on_corruption !== false,
      fallback: this.index.substring_fallback !== false,
      onRebuild: () => this.onMetric?.('index_rebuild_count'),
      onFallback: () => this.onMetric?.('fts_fallback_count')
    });
  }

  async upsert(memory) {
    if (this.db && memory?.id) syncMemoryFts(this.db, memory);
  }

  async remove(id) {
    if (this.db && id) this.db.prepare('DELETE FROM memory_fts WHERE id = ?').run(String(id));
  }

  async rebuild() {
    if (this.db) {
      rebuildMemoryIndex(this.db);
      this.onMetric?.('index_rebuild_count');
    }
  }
}
