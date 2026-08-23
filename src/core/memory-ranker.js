export function recencyScore(updatedAt, now = Date.now()) {
  const time = Date.parse(updatedAt || '');
  if (!Number.isFinite(time)) return 0.3;
  const days = Math.max(0, (now - time) / 86400000);
  return Math.exp(-days / 45);
}

export function scopeScore(itemScope, requestedScope) {
  if (!requestedScope || requestedScope === 'all' || requestedScope === itemScope) return 1;
  if (itemScope === 'global') return 0.7;
  if (itemScope === 'user') return 0.5;
  return 0.2;
}

export function familyScore(itemFamily, requestedFamilies = []) {
  if (!Array.isArray(requestedFamilies) || requestedFamilies.length === 0) return 0.6;
  return requestedFamilies.includes(itemFamily) ? 1 : 0.2;
}

export function lexicalFromBm25(rank) {
  const value = Number(rank);
  if (!Number.isFinite(value)) return 0.3;
  return 1 / (1 + Math.exp(value));
}

export function scoreMemoryHit({
  lexicalScore = 0,
  scopeScore: scope = 0,
  familyScore: family = 0,
  confidence = 0.8,
  utilityScore = 0.5,
  recencyScore: recency = 0.5,
  verifiedRecovery = false
} = {}) {
  const base =
    Number(lexicalScore) * 0.45 +
    Number(scope) * 0.15 +
    Number(family) * 0.15 +
    Number(confidence) * 0.10 +
    Number(utilityScore) * 0.10 +
    Number(recency) * 0.05;
  return verifiedRecovery ? base + 0.12 : base;
}
