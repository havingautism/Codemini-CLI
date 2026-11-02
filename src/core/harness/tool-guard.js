import { selectedChoice } from './decision-protocol.js';

export const TOOL_GUARD_QUESTIONS = Object.freeze([
  { id: 'guard_action', type: 'choice', options: ['allow', 'confirm', 'review', 'deny'] },
  { id: 'guard_risk', type: 'score', levels: ['low', 'medium', 'high', 'critical'] },
  { id: 'needs_review', type: 'noul' },
]);

export function resolveToolGuard({ decision = {}, hardGuard = {}, thresholds = {} } = {}) {
  if (!hardGuard.allowed || hardGuard.requiresReview) return { action: hardGuard.requiresReview ? 'review' : 'deny', reason: hardGuard.reasons?.[0] || 'hard_guard' };
  const action = selectedChoice(decision, 'guard_action');
  const review = decision.answers?.find((answer) => answer.id === 'needs_review')?.pTrue;
  if (Number(review) >= Number(thresholds.guard_review_probability ?? 0.7)) return { action: 'review', reason: 'provider_review_probability' };
  return ['allow', 'confirm', 'review', 'deny'].includes(action)
    ? { action, reason: 'provider_guard' }
    : { action: 'review', reason: 'provider_abstain' };
}
