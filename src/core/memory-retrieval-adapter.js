import { FallbackRetrievalAdapter } from './memory-retrieval-adapter-fallback.js';
import { FTS5RetrievalAdapter } from './memory-retrieval-adapter-fts5.js';

export function createMemoryRetrievalAdapter({ name = 'fts5', db, index, onMetric } = {}) {
  if (String(name || '').toLowerCase() === 'fallback') {
    return new FallbackRetrievalAdapter({ db });
  }
  return new FTS5RetrievalAdapter({ db, index, onMetric });
}
