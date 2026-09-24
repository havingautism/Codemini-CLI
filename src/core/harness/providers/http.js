import { createDecisionResponse, HARNESS_QUESTION_SET } from '../contracts.js';
import { normalizeDecisionInput } from '../normalize.js';

function abstainAnswers(questions = HARNESS_QUESTION_SET, reason = 'provider_error') {
  return questions.map((question) => ({ id: question.id, type: question.type, abstain: true, reason }));
}

function validateAnswer(answer, question) {
  if (!answer || answer.id !== question.id || answer.type !== question.type) return false;
  if (answer.abstain === true) return true;
  if (question.type === 'choice' && !question.options.includes(answer.choice)) return false;
  if (question.type === 'score' && !question.levels.includes(answer.score)) return false;
  if (question.type === 'noul' && !(Number(answer.pTrue) >= 0 && Number(answer.pTrue) <= 1)) return false;
  if (answer.confidence != null && !(Number(answer.confidence) >= 0 && Number(answer.confidence) <= 1)) return false;
  return true;
}

export function createHttpDecisionProvider({
  name,
  baseUrl = '',
  apiKey = '',
  model = '',
  timeoutMs = 1500,
  path = '/decide',
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    name,
    async ask(request = {}) {
      const questions = Array.isArray(request.questions) ? request.questions : HARNESS_QUESTION_SET;
      const normalized = normalizeDecisionInput(request.state || {}, questions);
      if (!baseUrl || typeof fetchImpl !== 'function') {
        return createDecisionResponse({ provider: name, answers: abstainAnswers(questions, 'provider_unavailable'), errors: ['provider endpoint is unavailable'] });
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(50, Number(timeoutMs) || 1500));
      if (request.signal) {
        if (request.signal.aborted) controller.abort();
        else request.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
      try {
        const base = String(baseUrl).replace(/\/+$/, '');
        const requestPath = String(path || '').trim();
        const endpoint = /^https?:\/\//i.test(requestPath)
          ? new URL(requestPath)
          : new URL(`${base}/${requestPath.replace(/^\/+/, '')}`);
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            provider: name,
            model,
            episodeId: request.episodeId,
            step: request.step,
            state: normalized.state,
            questions,
            inputHash: normalized.inputHash,
            optionsHash: normalized.optionsHash,
          }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
        const payload = await response.json();
        const answers = Array.isArray(payload?.answers) ? payload.answers : [];
        if (answers.length !== questions.length || questions.some((question, index) => !validateAnswer(answers[index], question))) {
          return createDecisionResponse({ provider: name, answers: abstainAnswers(questions, 'invalid_schema'), errors: ['provider response schema mismatch'] });
        }
        return createDecisionResponse({
          provider: name,
          modelVersion: payload.modelVersion || `${name}-unknown`,
          calibrationId: payload.calibrationId || '',
          answers,
          inputHash: normalized.inputHash,
          optionsHash: normalized.optionsHash,
          errors: [],
        });
      } catch (error) {
        return createDecisionResponse({ provider: name, answers: abstainAnswers(questions, error?.name === 'AbortError' ? 'timeout' : 'provider_error'), errors: [error?.message || String(error)] });
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
