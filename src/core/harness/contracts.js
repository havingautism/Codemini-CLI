const ACTIONS = ['continue', 'retry_once', 'change_tool', 'ask_user', 'escalate', 'finish'];
const RISKS = ['low', 'medium', 'high', 'critical'];

export const HARNESS_QUESTION_SET = Object.freeze([
  Object.freeze({ id: 'next_action', type: 'choice', options: Object.freeze([...ACTIONS]) }),
  Object.freeze({ id: 'action_risk', type: 'score', levels: Object.freeze([...RISKS]) }),
  Object.freeze({ id: 'needs_review', type: 'noul', statement: 'The proposed action requires human review.' }),
  Object.freeze({ id: 'task_complete', type: 'noul', statement: 'The acceptance criteria are satisfied.' })
]);

export function createDecisionRequest({
  episodeId = '',
  step = 0,
  state = {},
  questions = HARNESS_QUESTION_SET,
  providerHint = 'rules',
  signal = null,
} = {}) {
  return { episodeId: String(episodeId), step: Number(step) || 0, state, questions, providerHint, signal };
}

export function createAbstainAnswer({ id, type, reason = 'insufficient_evidence' }) {
  if (!id || !type) throw new TypeError('Decision answer requires id and type');
  return { id: String(id), type: String(type), abstain: true, reason: String(reason) };
}

export function createDecisionResponse({
  provider = 'rules',
  modelVersion = 'rules-v1',
  calibrationId = 'cal-v1',
  answers = [],
  inputHash = '',
  optionsHash = '',
  latencyMs = 0,
  errors = [],
} = {}) {
  return {
    provider: String(provider),
    modelVersion: String(modelVersion),
    calibrationId: String(calibrationId),
    answers: Array.isArray(answers) ? answers : [],
    inputHash: String(inputHash),
    optionsHash: String(optionsHash),
    latencyMs: Math.max(0, Number(latencyMs) || 0),
    errors: Array.isArray(errors) ? errors.map((error) => String(error)) : [],
  };
}

export { ACTIONS, RISKS };
