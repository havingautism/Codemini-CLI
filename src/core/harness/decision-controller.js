import { HARNESS_QUESTION_SET } from './contracts.js';
import { normalizeDecisionState } from './normalize.js';
import { createConfiguredDecisionProviders, createDecisionAdapter } from './decision-adapter.js';
import { createInitialBelief, updateBelief } from './belief/discrete-dbn.js';
import { mapStateToEvidence } from './belief/evidence.js';
import { checkHardGuards } from './policy/hard-guards.js';
import { decideInfluencePolicy } from './policy/influence-policy.js';
import { createDecisionOrchestrator } from './decision-orchestrator.js';

export function createDecisionController({
  enabled = false,
  mode = 'shadow',
  provider = 'rules',
  adapter = null,
  onDecision = null,
  providerConfig = {},
  shadowProviders = [],
  decisionMode = 'advisory',
} = {}) {
  const configured = createConfiguredDecisionProviders(providerConfig);
  const decisionAdapter = adapter || createDecisionAdapter({
    provider,
    providers: configured,
    shadowProviders,
  });
  let belief = createInitialBelief(providerConfig.priors);
  const beliefCpts = providerConfig.cpts || providerConfig.belief?.cpts;
  const beliefNodeCpts = providerConfig.nodeCpts || providerConfig.belief?.nodeCpts;
  const orchestrator = typeof decisionAdapter.ask === 'function'
    ? createDecisionOrchestrator({ adapter: decisionAdapter, provider, policy: providerConfig.policy || {}, onDecision })
    : null;
  return {
    enabled: enabled === true,
    orchestrate: orchestrator?.decide || null,
    mode: String(mode || 'shadow').toLowerCase() === 'shadow' ? 'shadow' : 'active',
    async evaluate({ episodeId = '', step = 0, state = {}, questions = HARNESS_QUESTION_SET, signal = null, onDecision: callback = null } = {}) {
      if (enabled !== true) return null;
      const normalizedState = normalizeDecisionState(state);
      // provider 请求保留较完整的上下文；事件审计继续使用短字段，避免上下文被静默截断。
      const providerState = normalizeDecisionState(state, { maxString: 20000, maxItems: 200, maxDepth: 8 });
      const decisions = typeof decisionAdapter.askShadow === 'function'
        ? await decisionAdapter.askShadow({ episodeId, step, state: providerState, questions, providerHint: provider, signal })
        : [await decisionAdapter.ask({ episodeId, step, state: providerState, questions, providerHint: provider, signal })];
      const decision = decisions.find((item) => item?.provider === provider) || decisions[0] || {
        provider,
        modelVersion: 'unavailable',
        answers: [],
        errors: ['decision provider returned no result'],
      };
      const evidence = mapStateToEvidence(providerState, decision);
      belief = updateBelief(belief, evidence, { cpts: beliefCpts, nodeCpts: beliefNodeCpts });
      const guards = checkHardGuards({ state: normalizedState, decision, belief });
      const policy = decideInfluencePolicy({
        state: normalizedState,
        decision,
        belief,
        guards,
        thresholds: providerConfig.policy || {},
        authorityMode: decisionMode,
      });
      const event = Object.freeze({
        episodeId: String(episodeId), step: Number(step) || 0, state: normalizedState,
        decision, shadowDecisions: decisions, provider: decision.provider || provider,
        mode: decisionMode === 'external_authority' ? 'external_authority' : 'shadow',
        advisory: { ...summarizeAdvisory(decision), ...policy },
        evidence,
        belief,
        guards,
        policy,
      });
      const emit = typeof callback === 'function' ? callback : onDecision;
      if (typeof emit === 'function') await emit(event);
      return event;
    }
  };
}

function summarizeAdvisory(decision = {}) {
  const answers = new Map((decision.answers || []).map((answer) => [answer.id, answer]));
  return {
    action: answers.get('next_action')?.choice || null,
    risk: answers.get('action_risk')?.score || null,
    needsReview: answers.get('needs_review')?.pTrue ?? null,
    taskComplete: answers.get('task_complete')?.pTrue ?? null,
  };
}
