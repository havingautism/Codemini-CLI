export const COMPLETION_OPTIONS = Object.freeze(['complete', 'verify_more', 'incomplete']);

export function buildCompletionState({ objective = '', criteria = [], completedWork = [], verification = [], knownGaps = [], diff = '' } = {}) {
  return { objective, criteria, completedWork, verification, knownGaps, diff: String(diff).slice(0, 4000) };
}

export function resolveCompletionReview({ choice, probability = 0, deterministicVerified = false, threshold = 0.9 } = {}) {
  if (!deterministicVerified) return { choice: 'verify_more', reason: 'deterministic_verification_missing' };
  if (choice !== 'complete' || Number(probability) < Number(threshold)) return { choice: 'verify_more', reason: 'completion_confidence_low' };
  return { choice: 'complete', reason: 'verified_completion' };
}

