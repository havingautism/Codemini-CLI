import { createHttpDecisionProvider } from './http.js';

const CHOICE_DESCRIPTIONS = Object.freeze({
  proceed_fast: '继续执行当前计划，证据充分且无需额外审查。',
  deep_review: '先做更深入的检查或验证，再决定下一步。',
  split_task: '把当前任务拆分成更小、可独立验证的步骤。',
  ask_user: '缺少必要信息或授权，需要向用户询问。',
  block: '存在安全、权限或正确性风险，应暂停执行。',
  continue: '继续当前工具或执行流程。',
  retry_once: '针对刚才的失败只再尝试一次。',
  change_tool: '放弃当前工具，改用另一个可行工具。',
  escalate: '把问题升级给人工或更高层处理。',
  finish: '已满足完成条件，结束当前任务。',
});

const SCORE_DESCRIPTIONS = Object.freeze({
  low: '低风险：可逆、影响小，通常可以继续。',
  medium: '中风险：可能造成影响，需要额外检查或谨慎执行。',
  high: '高风险：错误代价较大，应先审查或请求确认。',
  critical: '极高风险：可能造成严重或不可逆后果，应阻止或升级。',
});

function criteriaFor(question, candidateDescriptions = {}) {
  if (question.type === 'choice') return Object.fromEntries((question.options || []).map((option) => [option, candidateDescriptions[option] || CHOICE_DESCRIPTIONS[option] || option]));
  if (question.type === 'score') return [...(question.levels || [])].map((level) => SCORE_DESCRIPTIONS[level] || level);
  return undefined;
}

function scoreLevelForValue(question, value) {
  const levels = question.levels || [];
  if (levels.includes(value)) return { score: value, scoreValue: null };
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || levels.length === 0) return null;
  // Jev 的 score 是按有序 level 计算的数值平均；Codemini 的策略仍使用风险等级字符串，
  // 因此保留原始数值，并将其映射到最近的内部等级供现有策略消费。
  const index = Math.max(0, Math.min(levels.length - 1, Math.round(numeric)));
  return { score: levels[index], scoreValue: numeric };
}

function normalizeScoreProbabilities(question, probabilities) {
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities)) return probabilities;
  const levels = question.levels || [];
  const normalized = {};
  for (const [key, value] of Object.entries(probabilities)) {
    const index = Number(key);
    const label = Number.isInteger(index) && levels[index] !== undefined ? levels[index] : key;
    normalized[label] = value;
  }
  return normalized;
}

function buildJevQuestions(questions = [], candidates = []) {
  const candidateDescriptions = Object.fromEntries((Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => candidate?.id)
    .map((candidate) => [candidate.id, candidate.description || candidate.name || candidate.id]));
  return Object.fromEntries(questions.map((question) => {
    const value = {
      type: question.type,
      instructions: question.statement || `Evaluate the proposition for ${question.id}.`,
    };
    const criteria = criteriaFor(question, candidateDescriptions);
    if (criteria !== undefined) value.criteria = criteria;
    return [question.id, value];
  }));
}

function buildJevRequest({ model, normalized, questions, request }) {
  return {
    model: model || 'typesafe/jev-1.13',
    state: normalized.state,
    questions: buildJevQuestions(questions, request?.candidates),
  };
}

function parseJevResponse({ payload, questions }) {
  const answerMap = payload?.answers && !Array.isArray(payload.answers) && typeof payload.answers === 'object'
    ? payload.answers
    : null;
  const answers = questions.map((question) => {
    const raw = answerMap?.[question.id];
    if (!raw || raw.type !== question.type) return null;
    const answer = { id: question.id, type: question.type, confidence: raw.confidence };
    if (question.type === 'choice') {
      answer.choice = raw.choice;
      answer.probabilities = raw.probabilities;
    } else if (question.type === 'score') {
      const score = scoreLevelForValue(question, raw.score);
      if (!score) return null;
      answer.score = score.score;
      if (score.scoreValue != null) answer.scoreValue = score.scoreValue;
      answer.probabilities = normalizeScoreProbabilities(question, raw.probabilities);
      if (raw.legend && typeof raw.legend === 'object' && !Array.isArray(raw.legend)) answer.legend = raw.legend;
    } else {
      answer.pTrue = raw.noul ?? raw.pTrue;
    }
    return answer;
  });
  return { answers, modelVersion: payload?.model || 'typesafe/jev-unknown' };
}

export function createJevProvider(options = {}) {
  return createHttpDecisionProvider({
    ...options,
    name: 'jev',
    model: options.model || 'typesafe/jev-1.13',
    path: options.path ?? '',
    requestBuilder: buildJevRequest,
    responseParser: parseJevResponse,
  });
}

export { buildJevQuestions, buildJevRequest, parseJevResponse };
