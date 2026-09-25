import { createDecisionRequest, selectedChoice } from './decision-protocol.js';
import { resolveTaskRoute } from './task-router.js';
import { resolveCompletionReview } from './completion-review.js';
import { resolveToolGuard } from './tool-guard.js';

const QUESTIONS = {
  task_route: [{ id: 'route', type: 'choice', options: ['proceed_fast', 'deep_review', 'split_task', 'ask_user', 'block'] }],
  skill_route: [{ id: 'selected_skill', type: 'choice', options: ['none'] }],
  tool_route: [{ id: 'selected_tool', type: 'choice', options: ['none'] }],
  subagent_route: [{ id: 'selected_agent', type: 'choice', options: ['main_agent', 'ask_user'] }],
  context_keep: [{ id: 'keep_context', type: 'noul' }],
};

export function createDecisionOrchestrator({ adapter, provider = 'rules', policy = {}, onDecision = null } = {}) {
  if (!adapter || typeof adapter.ask !== 'function') throw new TypeError('决策编排器需要 adapter.ask');
  return {
    async decide({ kind, episodeId = '', step = 0, state = {}, candidates = [], questions = QUESTIONS[kind] || [] } = {}) {
      const request = createDecisionRequest({ kind, episodeId, step, state, candidates, questions });
      const decision = await adapter.ask({ ...request, providerHint: provider });
      const event = { ...request, decision, provider: decision?.provider || provider, selected: null, policy: null };
      if (kind === 'task_route') {
        const answer = decision?.answers?.find((item) => item.id === 'route');
        event.selected = answer?.choice || null;
        event.policy = resolveTaskRoute({ choice: answer?.choice, probability: answer?.probabilities?.[answer?.choice] || answer?.confidence || 0, margin: choiceMargin(answer), riskTier: state.riskTier, thresholds: policy });
      } else if (kind === 'tool_guard') {
        event.policy = resolveToolGuard({ decision, hardGuard: state.hardGuard || {}, thresholds: policy });
        event.selected = event.policy.action;
      } else if (kind === 'completion_review') {
        const answer = decision?.answers?.find((item) => item.id === 'completion_status');
        event.selected = answer?.choice || null;
        event.policy = resolveCompletionReview({ choice: answer?.choice, probability: answer?.pTrue ?? answer?.confidence ?? 0, deterministicVerified: state.verificationPassed === true, threshold: policy.completion_probability });
      } else if (kind === 'context_keep') {
        const answer = decision?.answers?.find((item) => item.id === 'keep_context');
        const rawProbability = Number(answer?.pTrue ?? answer?.probability);
        const providerUnavailable = Boolean(
          decision?.errors?.length
          || !answer
          || answer.abstain === true,
        );
        // 上下文判断属于保守策略：服务不可用或弃权时保留上下文，
        // 不能把“没有判断结果”误当成“概率为 0”而删除任务信息。
        if (providerUnavailable) {
          event.selected = true;
          event.probability = null;
          event.policy = { choice: 'keep', reason: 'provider_unavailable_keep', probability: null };
        } else {
          const probability = Number.isFinite(rawProbability) ? rawProbability : 0;
          event.selected = probability >= Number(policy.context_keep_probability ?? 0.5);
          event.probability = probability;
          event.policy = { choice: event.selected ? 'keep' : 'drop', reason: event.selected ? 'context_relevant' : 'context_low_relevance', probability };
        }
      } else {
        event.selected = selectedChoice(decision, kind === 'skill_route' ? 'selected_skill' : kind === 'tool_route' ? 'selected_tool' : 'selected_agent');
        event.policy = event.selected ? { choice: event.selected, reason: 'provider_choice' } : { choice: 'ask_user', reason: 'provider_abstain' };
      }
      await onDecision?.(event);
      return event;
    },
  };
}

function choiceMargin(answer = {}) {
  const probabilities = Object.values(answer?.probabilities || {})
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => b - a);
  if (probabilities.length < 2) return probabilities.length === 1 ? probabilities[0] : 1;
  return probabilities[0] - probabilities[1];
}

export { QUESTIONS as DECISION_QUESTIONS };
