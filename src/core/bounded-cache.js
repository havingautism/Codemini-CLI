/**
 * 有限大小 + TTL 的 Map 缓存，带主动清理和可选的 onEvict 钩子。
 * 用于替代无界 Map 以防止长时间运行时的内存泄漏。
 */

const DEFAULT_MAX_SIZE = 128;
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 分钟

export class BoundedCache {
  constructor(options = {}) {
    this._maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
    this._ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this._onEvict = options.onEvict ?? null;
    this._map = new Map();
  }

  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (this._expired(entry)) {
      this._removeEntry(key, entry);
      return undefined;
    }
    return entry.value;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, value) {
    if (this._map.has(key)) {
      const old = this._map.get(key);
      if (this._onEvict && old !== undefined) {
        try { this._onEvict(key, old.value); } catch {}
      }
      this._map.delete(key);
    }
    this._map.set(key, { value, ts: Date.now() });
    this._evict();
  }

  delete(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    this._removeEntry(key, entry);
    return true;
  }

  clear() {
    if (this._onEvict) {
      for (const [key, entry] of this._map) {
        try { this._onEvict(key, entry.value); } catch {}
      }
    }
    this._map.clear();
  }

  get size() {
    this._prune();
    return this._map.size;
  }

  keys() {
    this._prune();
    return this._map.keys();
  }

  values() {
    this._prune();
    const out = [];
    for (const entry of this._map.values()) {
      out.push(entry.value);
    }
    return out;
  }

  entries() {
    this._prune();
    const out = [];
    for (const [key, entry] of this._map.entries()) {
      out.push([key, entry.value]);
    }
    return out;
  }

  // ─── 内部方法 ──────────────────────────────────────────────────────

  _expired(entry) {
    return Date.now() - entry.ts > this._ttlMs;
  }

  _removeEntry(key, entry) {
    this._map.delete(key);
    if (this._onEvict) {
      try { this._onEvict(key, entry.value); } catch {}
    }
  }

  /** 清理所有过期条目 */
  _prune() {
    for (const [key, entry] of this._map) {
      if (this._expired(entry)) {
        this._removeEntry(key, entry);
      }
    }
  }

  /** 按数量裁剪最旧的条目 */
  _evict() {
    this._prune();
    if (this._map.size <= this._maxSize) return;
    const iter = this._map.keys();
    while (this._map.size > this._maxSize) {
      const oldest = iter.next().value;
      if (oldest === undefined) break;
      const entry = this._map.get(oldest);
      this._removeEntry(oldest, entry);
    }
  }
}
