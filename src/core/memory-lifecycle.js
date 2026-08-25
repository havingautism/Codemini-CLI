import { retentionScore } from './memory-ranker.js';

const DAY_MS = 86400000;

/**
 * True when a memory's expected_valid_days has elapsed (design §26/§27).
 * Never flags pinned or archived items; staleness only gates a review, it
 * never auto-deletes.
 */
export function isMemoryStale(item, now = Date.now()) {
  const days = Number(item?.expectedValidDays);
  if (!Number.isFinite(days) || days <= 0) return false;
  if (item?.lifecycle === 'archived' || item?.pinned === true) return false;
  const updated = Date.parse(item?.updatedAt || item?.createdAt || '');
  if (!Number.isFinite(updated)) return false;
  return (now - updated) / DAY_MS > days;
}

export function findStaleMemories(items = [], now = Date.now()) {
  return (Array.isArray(items) ? items : []).filter((item) => isMemoryStale(item, now));
}

/**
 * Low-utility candidates for maintenance (design §31), ranked by retention
 * score (§24). Pinned/archived items are protected.
 */
export function findLowUtilityMemories(items = [], now = Date.now(), threshold = 0.35) {
  return rankMemoryRetentionCandidates(items, now)
    .filter((entry) => entry.retentionScore < threshold)
    .map((entry) => entry.item);
}

export function rankMemoryRetentionCandidates(items = [], now = Date.now()) {
  const timestamp = (item) => {
    const parsed = Date.parse(item?.updatedAt || item?.createdAt || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.lifecycle !== 'archived' && item?.pinned !== true)
    .map((item) => ({
      item,
      retentionScore: retentionScore({
        confidence: item?.confidence,
        lastConfirmedAt: item?.lastConfirmedAt,
        accessCount: item?.accessCount,
        now
      })
    }))
    .sort((a, b) => (
      a.retentionScore - b.retentionScore
      || timestamp(a.item) - timestamp(b.item)
      || String(a.item?.id || '').localeCompare(String(b.item?.id || ''))
    ));
}
