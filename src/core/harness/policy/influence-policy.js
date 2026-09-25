import { beliefProbability } from '../belief/discrete-dbn.js';

export function decideInfluencePolicy({ belief = {}, guards = {}, decision = {}, state = {}, thresholds = {}, authorityMode = 'advisory' } = {}) {
  if (!guards.allowed || guards.requiresReview) return { action: 'escalate', reason: guards.reasons?.[0] || 'hard_guard' };
  const taskComplete = beliefProbability(belief, 'TaskComplete');
  const testPass = beliefProbability(belief, 'TestPass');
  const missingInfo = Number(state.missingInfoProbability || 0);
  const providerAction = decision.answers?.find((answer) => answer.id === 'next_action')?.choice;
  const retryBenefit = beliefProbability(belief, 'RetryBenefit');
  if (authorityMode === 'external_authority' && ['continue', 'retry_once', 'change_tool', 'ask_user', 'escalate', 'finish'].includes(providerAction)) {
    if (providerAction === 'finish' && (state.verificationPassed === false || testPass < 0.95)) {
      return { action: 'escalate', reason: 'external_finish_blocked_by_verification' };
    }
    if (providerAction === 'retry_once' && Number(state.retries || 0) >= Number(state.retryLimit ?? 3)) {
      return { action: 'escalate', reason: 'external_retry_limit' };
    }
    return { action: providerAction, reason: 'external_authority', probability: taskComplete };
  }
  if (missingInfo >= Number(thresholds.missing_info_probability ?? 0.55)) return { action: 'ask_user', reason: 'missing_information' };
  if (taskComplete >= Number(thresholds.finish_probability ?? 0.98) && testPass >= 0.95 && state.verificationPassed !== false) return { action: 'finish', reason: 'verified_completion', probability: taskComplete };
  if (retryBenefit >= Number(thresholds.retry_probability ?? 0.70)
    && providerAction === 'retry_once'
    && Number(state.retries || 0) < Number(state.retryLimit ?? 3)) {
    return { action: 'retry_once', reason: 'retry_benefit', probability: retryBenefit };
  }
  return { action: 'continue', reason: 'insufficient_completion_evidence', probability: taskComplete };
}
