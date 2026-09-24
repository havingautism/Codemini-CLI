import crypto from 'node:crypto';
import { normalizeDecisionState, stableHash } from './normalize.js';

export const DECISION_KINDS = Object.freeze([
  'task_route', 'skill_route', 'tool_route', 'tool_guard',
  'context_keep', 'subagent_route', 'completion_review',
]);

export function createDecisionRequest({ episodeId = '', step = 0, kind, state = {}, candidates = [], questions = [], policyVersion = 'v1' } = {}) {
  if (!DECISION_KINDS.includes(kind)) throw new Error(`未知决策类型: ${kind}`);
  const normalizedState = normalizeDecisionState(state);
  const normalizedCandidates = Array.isArray(candidates) ? candidates.slice(0, 255) : [];
  return {
    decisionId: crypto.randomUUID(), episodeId: String(episodeId), step: Number(step) || 0,
    kind, state: normalizedState, candidates: normalizedCandidates, questions,
    policyVersion: String(policyVersion), inputHash: stableHash({ kind, state: normalizedState, candidates: normalizedCandidates }),
    optionsHash: stableHash(questions),
  };
}

export function selectedChoice(decision = {}, id = '') {
  return decision.answers?.find((answer) => answer.id === id)?.choice || null;
}

