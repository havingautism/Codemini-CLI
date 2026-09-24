import { createHttpDecisionProvider } from './http.js';

function criteriaFor(question) {
  if (question.type === 'choice') return Object.fromEntries((question.options || []).map((option) => [option, option]));
  if (question.type === 'score') return [...(question.levels || [])];
  return undefined;
}

function buildJevQuestions(questions = []) {
  return Object.fromEntries(questions.map((question) => {
    const value = {
      type: question.type,
      instructions: question.statement || `Evaluate the proposition for ${question.id}.`,
    };
    const criteria = criteriaFor(question);
    if (criteria !== undefined) value.criteria = criteria;
    return [question.id, value];
  }));
}

function buildJevRequest({ model, normalized, questions }) {
  return {
    model: model || 'typesafe/jev-1.13',
    state: normalized.state,
    questions: buildJevQuestions(questions),
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
      answer.score = raw.score;
      answer.probabilities = raw.probabilities;
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
