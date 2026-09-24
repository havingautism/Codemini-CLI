import { createAbstainAnswer, createDecisionResponse, HARNESS_QUESTION_SET, RISKS } from '../contracts.js';
import { normalizeDecisionInput } from '../normalize.js';

function answerFor(id, type, value, probabilities = {}, confidence = 1) {
  if (type === 'choice') return { id, type, choice: value, probabilities, confidence, abstain: false };
  if (type === 'score') return { id, type, score: value, probabilities, confidence, abstain: false };
  return { id, type, pTrue: value, confidence, abstain: false };
}

export function createRulesProvider({ modelVersion = 'rules-v1', calibrationId = 'cal-v1' } = {}) {
  return {
    name: 'rules',
    async ask(request = {}) {
      const startedAt = Date.now();
      const state = request.state || {};
      const questions = request.questions || HARNESS_QUESTION_SET;
      const normalized = normalizeDecisionInput(state, questions);
      const toolError = Boolean(state.toolError || state.toolResult?.ok === false || state.lastToolError);
      const hasVerification = Boolean(state.verificationPassed || state.testsPassed);
      const approvalRequired = Boolean(state.approvalRequired || state.humanReviewRequired);
      const budgetExhausted = Number(state.stepsLeft) === 0 || Number(state.budget?.stepsLeft) === 0;
      const complete = hasVerification && !toolError;
      const action = approvalRequired ? 'escalate'
        : complete ? 'finish'
          : budgetExhausted ? 'ask_user'
            : toolError ? 'retry_once' : 'continue';
      const requestedRisk = String(state.riskTier || 'low').toLowerCase();
      const risk = approvalRequired ? 'high' : (RISKS.includes(requestedRisk) ? requestedRisk : 'low');
      const answers = questions.map((question) => {
        if (question.id === 'next_action') return answerFor(question.id, question.type, action, { [action]: 1 });
        if (question.id === 'action_risk') return answerFor(question.id, question.type, risk, { [risk]: 1 });
        if (question.id === 'needs_review') return answerFor(question.id, question.type, approvalRequired ? 1 : 0);
        if (question.id === 'task_complete') return answerFor(question.id, question.type, complete ? 1 : 0);
        return createAbstainAnswer(question);
      });
      return createDecisionResponse({
        provider: 'rules', modelVersion, calibrationId, answers,
        inputHash: normalized.inputHash, optionsHash: normalized.optionsHash,
        latencyMs: Date.now() - startedAt,
      });
    }
  };
}
