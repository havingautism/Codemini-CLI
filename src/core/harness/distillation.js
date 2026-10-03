import crypto from 'node:crypto';
import { createConfiguredDecisionProviders, createDecisionAdapter } from './decision-adapter.js';
import { normalizeDecisionState, stableHash } from './normalize.js';
import { shouldActivateHarness } from './rollout.js';
import { createHarnessSqliteStore } from './audit/harness-sqlite-store.js';
import { isSensitiveMemoryContent, segmentSearchText } from '../memory-policy.js';

export function normalizeDistillationConfig(value = {}) {
  const probability = Number(value?.confidence_threshold ?? 0.8);
  const limit = Number(value?.max_candidates ?? 8);
  return {
    memory_enabled: value?.memory_enabled === true,
    skill_enabled: value?.skill_enabled === true,
    mode: value?.mode === 'filter' ? 'filter' : 'shadow',
    confidence_threshold: Number.isFinite(probability) ? Math.max(0.5, Math.min(1, probability)) : 0.8,
    max_candidates: Number.isFinite(limit) ? Math.max(1, Math.min(16, Math.floor(limit))) : 8,
  };
}

function probability(decision, id) {
  if (decision?.errors?.length) return null;
  const answer = decision?.answers?.find((item) => item.id === id);
  if (!answer || answer.abstain || answer.type !== 'noul' || answer.pTrue == null) return null;
  const value = Number(answer.pTrue);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

const fullTextOf = (item) => String(item?.content || item?.details || item?.description || item?.summary || '');
const textOf = (item) => fullTextOf(item).slice(0, 1200);
const safeText = (text) => isSensitiveMemoryContent(text) ? '[sensitive text omitted]' : String(text);
const blocksOf = (text) => safeText(text).slice(0, 6000).match(/[\s\S]{1,1000}/g) || [];
const termsOf = (text) => segmentSearchText(text).toLowerCase().match(/[\p{L}\p{N}_-]+/gu) || [];
const evidenceOf = (messages) => {
  const selected = messages.length > 10 ? [...messages.slice(0, 5), ...messages.slice(-5)] : messages;
  return selected.map((message) => `${message.role}: ${safeText(message.content || '').slice(0, 1000)}`);
};

function recordDecision(event) {
  // Audit only hashes and typed decisions; conversation text stays in its own store.
  const store = createHarnessSqliteStore();
  store.createEpisode({ id: event.episodeId, sessionId: event.sessionId, projectDir: event.projectDir,
    mode: event.mode, provider: event.decision.provider, configHash: event.configHash });
  // The audit sanitizer bounds arrays at 20 items. Keep all batch answers in
  // groups of 16, with probability maps serialized to avoid nested truncation.
  const answers = event.decision?.answers || [];
  const answerBatches = [];
  for (let index = 0; index < answers.length; index += 16) {
    answerBatches.push(answers.slice(index, index + 16).map((answer) => ({ ...answer,
      ...(answer.probabilities ? { probabilities: JSON.stringify(answer.probabilities) } : {}),
    })));
  }
  store.appendEvent({ episodeId: event.episodeId, type: 'harness:decision', source: 'distillation', payload: { ...event, answerBatches } });
  store.finishEpisode(event.episodeId, { outcome: event.stage });
}

export function createDistillationJudge({ config = {}, kind, sessionId = '', projectDir = '', adapter, audit = recordDecision } = {}) {
  const harness = config.harness || {};
  const settings = normalizeDistillationConfig(harness.distillation);
  const connection = harness.providers?.[harness.provider] || {};
  const enabled = settings[`${kind}_enabled`] === true
    && shouldActivateHarness({ harness, sessionId, projectDir })
    && Boolean(connection.base_url)
    && (harness.provider !== 'jev' || Boolean(connection.api_key));
  const decisionAdapter = enabled ? adapter || createDecisionAdapter({
    provider: harness.provider,
    providers: createConfiguredDecisionProviders({
      timeoutMs: harness.timeout_ms,
      [harness.provider]: { baseUrl: connection.base_url, apiKey: connection.api_key, model: connection.model },
    }, harness.provider),
  }) : null;

  async function ask(stage, state, questions, mode = settings.mode) {
    let decision;
    const normalized = normalizeDecisionState(state);
    try {
      decision = await decisionAdapter.ask({ state: normalized, questions, providerHint: harness.provider });
    } catch {
      decision = { provider: harness.provider, answers: [], errors: ['distillation_unavailable'] };
    }
    const event = { episodeId: `distillation:${crypto.randomUUID()}`, sessionId, projectDir,
      kind, stage, mode, inputHash: stableHash(normalized), optionsHash: stableHash(questions),
      configHash: stableHash(settings), decision };
    try { await audit?.(event); } catch { /* Audit failure cannot affect memory or reflection. */ }
    return { decision, decisionId: event.episodeId };
  }

  return {
    enabled,
    settings,
    async preflight(messages = []) {
      if (!enabled) return { extract: true, reason: 'disabled' };
      const { decision, decisionId } = await ask(`${kind}_preflight`, { kind, evidence: evidenceOf(messages) }, [{
        id: 'worth_extracting', type: 'noul',
        statement: kind === 'memory'
          ? 'The conversation contains accepted, verified or repeated durable information worth extracting for future sessions, beyond temporary task state and facts easily read from source files.'
          : 'The conversation contains an evidenced successful, reusable workflow with identifiable triggers and verification, worth drafting as a Skill.',
      }]);
      const value = probability(decision, 'worth_extracting');
      const completeEvidence = messages.length <= 10 && messages.every((message) => typeof message.content === 'string'
        && message.content.length <= 1000 && !isSensitiveMemoryContent(message.content));
      return { extract: settings.mode !== 'filter' || !completeEvidence || value == null || 1 - value < settings.confidence_threshold,
        probability: value, decisionId, reason: !completeEvidence ? 'incomplete_evidence_keep' : value == null ? 'uncertain_fallback' : 'distillation_preflight' };
    },
    async assess(candidates = [], existing = [], { observeOnly = false, messages = [] } = {}) {
      if (!enabled || !candidates.length) return candidates;
      const selected = candidates.slice(0, settings.max_candidates);
      // A bounded shortlist keeps comparisons relevant without sending the whole memory/Skill library.
      const words = new Set(selected.flatMap((item) => termsOf(textOf(item))));
      const references = existing.map((item) => ({ item, score: termsOf(textOf(item)).filter((word) => words.has(word)).length }))
        .sort((a, b) => b.score - a.score).slice(0, 12).map(({ item }) => ({ name: item.name || item.semanticKey || '', scope: item.scope || '', text: safeText(textOf(item)) }));
      const questions = selected.flatMap((_, index) => [
        { id: `reusable_${index}`, type: 'noul', statement: `Candidate ${index} is durable and reusable, grounded in its evidence, with clear applicability; it is not temporary state or an unverified claim.` },
        { id: `duplicate_${index}`, type: 'noul', statement: `Candidate ${index} adds no meaningful information or workflow beyond an existing reference or an earlier candidate with the same applicability. A correction or improved workflow is not a duplicate.` },
        { id: `scope_${index}`, type: 'choice', options: kind === 'memory' ? ['user', 'project', 'global'] : ['project', 'global'],
          statement: `Choose the narrowest appropriate applicability of candidate ${index}. Global requires evidence of reuse across projects; project means repository-specific. Scope is advisory only.` },
      ]);
      const { decision, decisionId } = await ask(`${kind}_candidates`, {
        kind,
        sourceEvidence: evidenceOf(messages),
        candidates: selected.map((item, index) => ({ index, name: item.name || '', scope: item.scope || '', textBlocks: blocksOf(fullTextOf(item)),
          evidence: (item.evidenceTexts || []).slice(0, 3).map((text) => safeText(text).slice(0, 1000)) })),
        existing: references,
      }, questions, observeOnly ? 'shadow' : settings.mode);
      return candidates.flatMap((candidate, index) => {
        if (index >= selected.length) return [candidate];
        const reusable = probability(decision, `reusable_${index}`);
        const duplicate = probability(decision, `duplicate_${index}`);
        const scope = decision?.answers?.find((item) => item.id === `scope_${index}`);
        const scopeProbability = Number(scope?.probabilities?.[scope?.choice] ?? scope?.confidence);
        const suggestedScope = !decision?.errors?.length && scope?.abstain !== true
          && questions.find((question) => question.id === `scope_${index}`).options.includes(scope?.choice)
          && Number.isFinite(scopeProbability) && scopeProbability >= settings.confidence_threshold ? scope.choice : null;
        const completeCandidate = fullTextOf(candidate).length <= 6000 && !isSensitiveMemoryContent(fullTextOf(candidate));
        const rejected = !completeCandidate ? null : duplicate != null && duplicate >= settings.confidence_threshold ? 'duplicate'
          : reusable != null && 1 - reusable >= settings.confidence_threshold ? 'not_reusable' : null;
        if (rejected && settings.mode === 'filter' && !observeOnly) return [];
        return [{ ...candidate, distillation: { decisionId, provider: decision?.provider || harness.provider,
          modelVersion: decision?.modelVersion || '', mode: observeOnly ? 'shadow' : settings.mode,
          reusableProbability: reusable, duplicateProbability: duplicate, suggestedScope,
          reason: rejected || (reusable == null || duplicate == null ? 'uncertain_fallback' : 'retain') } }];
      });
    },
  };
}
