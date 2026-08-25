export function recencyScore(updatedAt, now = Date.now()) {
  const time = Date.parse(updatedAt || '');
  if (!Number.isFinite(time)) return 0.3;
  const days = Math.max(0, (now - time) / 86400000);
  return Math.exp(-days / 45);
}

export function lexicalFromBm25(rank) {
  const value = Number(rank);
  if (!Number.isFinite(value)) return 0.3;
  return 1 / (1 + Math.exp(value));
}

function clamp01(value, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

/**
 * Verification signal drives the 10% retrieval boost (§10.1).
 * Deterministic evidence only: confirmations, verified recovery evidence,
 * or a non-zero success count. A bare LLM "solved" self-report never counts.
 */
export function verificationSignal(item = {}) {
  if (Number(item?.confirmationCount) > 0) return 1;
  const evidence = item?.evidence && typeof item.evidence === 'object' ? item.evidence : {};
  if (evidence.verified === true || evidence.successful_recovery === true) return 1;
  if (Number(item?.successCount) > 0) return 0.7;
  return 0;
}

/**
 * Retrieval score (§10): BM25 70% + confidence 15% + verification 10% + recency 5%.
 * Scope/family are hard filters at the query layer, not soft weights here.
 */
export function scoreMemoryHit({
  bm25Score = 0,
  confidence = 0.8,
  verification = 0,
  recencyScore: recency = 0.5
} = {}) {
  return (
    clamp01(bm25Score, 0.3) * 0.70 +
    clamp01(confidence, 0.8) * 0.15 +
    clamp01(verification, 0) * 0.10 +
    clamp01(recency, 0.5) * 0.05
  );
}

export function retentionScore({
  confidence = 0.8,
  lastConfirmedAt = '',
  accessCount = 0,
  now = Date.now()
} = {}) {
  const confirmedAt = Date.parse(lastConfirmedAt || '');
  const freshness = Number.isFinite(confirmedAt)
    ? Math.exp(-Math.max(0, (now - confirmedAt) / 86400000) / 90)
    : 0;
  const heat = Math.min(1, Number(accessCount || 0) / 10);
  return Number(confidence) * 0.65 + freshness * 0.25 + heat * 0.10;
}
