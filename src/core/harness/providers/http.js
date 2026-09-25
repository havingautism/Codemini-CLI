import { createDecisionResponse, HARNESS_QUESTION_SET } from '../contracts.js';
import { normalizeDecisionInput } from '../normalize.js';

function abstainAnswers(questions = HARNESS_QUESTION_SET, reason = 'provider_error') {
  return questions.map((question) => ({ id: question.id, type: question.type, abstain: true, reason }));
}

function validProbability(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
}

function validProbabilityMap(value, allowedKeys, requireAll = false) {
  if (value == null) return !requireAll;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (requireAll && allowedKeys.some((key) => !Object.hasOwn(value, key))) return false;
  return entries.every(([key, probability]) => allowedKeys.includes(String(key)) && validProbability(probability));
}

function validateAnswer(answer, question) {
  if (!answer || answer.id !== question.id || answer.type !== question.type) return false;
  if (answer.abstain === true) return true;
  if (question.type === 'choice') {
    if (!question.options.includes(answer.choice)) return false;
    if (!validProbabilityMap(answer.probabilities, question.options, true)) return false;
  }
  if (question.type === 'score') {
    if (!question.levels.includes(answer.score)) return false;
    if (!validProbabilityMap(answer.probabilities, question.levels, true)) return false;
    if (answer.scoreValue != null && !Number.isFinite(Number(answer.scoreValue))) return false;
  }
  if (question.type === 'noul' && !validProbability(answer.pTrue)) return false;
  if (answer.confidence != null && !validProbability(answer.confidence)) return false;
  return true;
}

export function createHttpDecisionProvider({
  name,
  baseUrl = '',
  apiKey = '',
  model = '',
  timeoutMs = 1500,
  path = '/decide',
  requestBuilder = null,
  responseParser = null,
  fetchImpl = globalThis.fetch,
} = {}) {
  return {
    name,
    async ask(request = {}) {
      const questions = Array.isArray(request.questions) ? request.questions : HARNESS_QUESTION_SET;
      const normalized = normalizeDecisionInput(request.state || {}, questions, { maxString: 20000, maxItems: 200, maxDepth: 8 });
      if (!baseUrl || typeof fetchImpl !== 'function') {
        return createDecisionResponse({ provider: name, modelVersion: `${name}-unavailable`, calibrationId: '', answers: abstainAnswers(questions, 'provider_unavailable'), errors: ['provider endpoint is unavailable'] });
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
        const endpoint = !requestPath
          ? new URL(baseUrl)
          : /^https?:\/\//i.test(requestPath)
          ? new URL(requestPath)
          : new URL(`${base}/${requestPath.replace(/^\/+/, '')}`);
        const body = typeof requestBuilder === 'function'
          ? requestBuilder({ name, model, request, normalized, questions })
          : {
            provider: name,
            model,
            episodeId: request.episodeId,
            step: request.step,
            state: normalized.state,
            questions,
            inputHash: normalized.inputHash,
            optionsHash: normalized.optionsHash,
          };
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
        const payload = await response.json();
        const parsed = typeof responseParser === 'function'
          ? responseParser({ payload, name, model, questions, normalized })
          : { answers: Array.isArray(payload?.answers) ? payload.answers : [], modelVersion: payload.modelVersion, calibrationId: payload.calibrationId };
        const answers = Array.isArray(parsed?.answers) ? parsed.answers : [];
        if (answers.length !== questions.length || questions.some((question, index) => !validateAnswer(answers[index], question))) {
          return createDecisionResponse({ provider: name, modelVersion: `${name}-invalid-schema`, calibrationId: '', answers: abstainAnswers(questions, 'invalid_schema'), errors: ['provider response schema mismatch'] });
        }
        return createDecisionResponse({
          provider: name,
          modelVersion: parsed.modelVersion || payload.modelVersion || `${name}-unknown`,
          calibrationId: parsed.calibrationId || payload.calibrationId || '',
          answers,
          inputHash: normalized.inputHash,
          optionsHash: normalized.optionsHash,
          errors: [],
        });
      } catch (error) {
        return createDecisionResponse({ provider: name, modelVersion: `${name}-error`, calibrationId: '', answers: abstainAnswers(questions, error?.name === 'AbortError' ? 'timeout' : 'provider_error'), errors: [error?.message || String(error)] });
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
