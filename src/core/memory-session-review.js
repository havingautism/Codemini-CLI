import { sha256 } from './crypto-utils.js';
import { createChatCompletion } from './provider/index.js';
import { listSessions, loadSession } from './session-store.js';
import { captureToInbox } from './memory-store.js';
import {
  assertSafeMemoryContent,
  inferMemoryFamily,
  normalizeMemoryKind,
  normalizeMemoryScope,
  normalizeMemoryText,
  buildDreamPromotionGraphBlock
} from './memory-policy.js';
import {
  claimSessionMemoryReview,
  completeSessionMemoryReview,
  failSessionMemoryReview
} from './memory-review-store.js';
import { appendStructuredOutputLanguageRule } from './reply-language.js';
import { parseModelJsonObject } from './model-json.js';

export const SESSION_MEMORY_REVIEWER_VERSION = 1;

const REVIEW_SYSTEM_PROMPT = `You review a completed coding-assistant conversation for durable memory candidates.

Your job is only to nominate evidence for later Dream consolidation. Never promote anything to long-term memory.

Keep only information that is useful across future sessions:
- lasting user preferences, interests, habits, or explicitly requested personal facts
- accepted or verified project conventions and decisions
- reusable lessons supported by a correction, successful fix, or stable tool/environment behavior

Discard:
- current-task instructions, temporary constraints, transient errors, branches, ports, paths, tokens, and process state
- brainstorming, possibilities, proposals, rejected ideas, or decisions that were not accepted
- claims made only by the assistant without user confirmation or verification
- facts cheaply and reliably read from current project files
- secrets or sensitive data

Respond with JSON only:
{"candidates":[{"scope":"user|project|global","kind":"preference|convention|lesson|note","family":"personal|repo|coding|procedure","content":"durable statement","summary":"under 80 chars","semantic_key":"stable namespace key","decision_state":"explicit|accepted|implemented|verified|repeated|proposed|brainstormed","durable_score":0,"confidence":0.0,"evidence_indices":[0],"reason":"short rationale"}]}

Use durable_score 0-10. A candidate needs at least 5. Project ideas must be accepted, implemented, verified, or repeated. Global knowledge needs explicit cross-project/environment evidence. If uncertain, return an empty candidates array.

${buildDreamPromotionGraphBlock()}
This reviewer only nominates into the Dream inbox leaf — never promote to durable memory here.`;

const TEMPORARY_PATTERN =
  /(?:这次|本次|当前任务|这个任务|这一轮|暂时|先不要|先试|目前|今天|稍后|当前分支|当前\s*pr|for this task|this time|for now|temporarily|current branch|current pr)/i;
const UNCONFIRMED_PATTERN =
  /(?:可能|也许|考虑|尝试看看|可以试试|方案之一|还没决定|待确认|草案|假设|猜测|maybe|perhaps|consider|could try|proposal|draft|not decided|tbd)/i;
const REJECTED_DECISION_STATES = new Set(['proposed', 'brainstormed', 'rejected', 'superseded']);

let reviewQueue = Promise.resolve();
let backlogTimer = null;
let lastBacklogScheduledAt = 0;
const scheduledSessions = new Map();

function visibleConversationMessages(session) {
  return (Array.isArray(session?.messages) ? session.messages : [])
    .filter((message) => ['user', 'assistant', 'tool'].includes(message?.role))
    .filter((message) => message?.model_visible !== false && message?.local_only !== true)
    .map((message) => ({
      role: message.role,
      content: normalizeMemoryText(
        message.role === 'tool' && message.tool_summary
          ? message.tool_summary
          : typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content || '')
      ).slice(0, message.role === 'tool' ? 800 : 2400)
    }))
    .filter((message) => message.content);
}

function conversationHash(messages) {
  return sha256(JSON.stringify(messages.map((message) => [message.role, message.content])));
}

function compactConversation(messages, maxChars) {
  const rendered = messages.map((message, index) => `[${message.role}#${index}] ${message.content}`);
  const total = rendered.reduce((sum, line) => sum + line.length + 1, 0);
  if (total <= maxChars) return rendered.join('\n');
  const half = Math.floor(maxChars / 2);
  const head = [];
  let headChars = 0;
  for (const line of rendered) {
    if (headChars + line.length + 1 > half) break;
    head.push(line);
    headChars += line.length + 1;
  }
  const tail = [];
  let tailChars = 0;
  for (let index = rendered.length - 1; index >= head.length; index -= 1) {
    const line = rendered[index];
    if (tailChars + line.length + 1 > maxChars - headChars - 32) break;
    tail.unshift(line);
    tailChars += line.length + 1;
  }
  return [...head, '[... middle omitted ...]', ...tail].join('\n');
}

function parseCandidates(text) {
  const parsed = parseModelJsonObject(text);
  return Array.isArray(parsed?.candidates) ? parsed.candidates : null;
}

export function normalizeSessionMemoryCandidate(candidate, sourceMessages = []) {
  const content = normalizeMemoryText(candidate?.content);
  const summary = normalizeMemoryText(candidate?.summary || content).slice(0, 120);
  const scope = normalizeMemoryScope(candidate?.scope, { fallback: 'project' });
  const kind = normalizeMemoryKind(candidate?.kind, 'note');
  const decisionState = String(candidate?.decision_state || '').trim().toLowerCase();
  const durableScore = Math.max(0, Math.min(10, Number(candidate?.durable_score) || 0));
  const confidence = Math.max(0, Math.min(1, Number(candidate?.confidence) || 0));
  const evidenceIndices = Array.isArray(candidate?.evidence_indices)
    ? [...new Set(candidate.evidence_indices
        .map((index) => Number(index))
        .filter((index) => Number.isInteger(index) && index >= 0 && index < sourceMessages.length))]
    : [];
  const evidenceMessages = evidenceIndices.map((index) => sourceMessages[index]);
  const evidenceRoles = evidenceMessages.map((message) => String(message?.role || '').toLowerCase());
  const evidenceTexts = evidenceMessages.map((message) => normalizeMemoryText(message?.content));
  const semanticKey = normalizeMemoryText(candidate?.semantic_key)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || `${scope}:${kind}:${sha256(content).slice(0, 16)}`;
  return {
    scope,
    kind,
    family: inferMemoryFamily({ family: candidate?.family, scope, kind, content, summary }),
    content,
    summary,
    semanticKey,
    decisionState,
    durableScore,
    confidence,
    evidenceIndices,
    evidenceRoles,
    evidenceTexts,
    groundedEvidence: evidenceMessages.length > 0,
    reason: normalizeMemoryText(candidate?.reason).slice(0, 240)
  };
}

export function isSessionMemoryCandidateEligible(candidate) {
  if (!candidate.content || candidate.durableScore < 5 || candidate.confidence < 0.6) return false;
  const evidenceText = [candidate.content, ...(candidate.evidenceTexts || [])].join(' ');
  if (TEMPORARY_PATTERN.test(evidenceText)) return false;
  if (UNCONFIRMED_PATTERN.test(evidenceText)) return false;
  if (REJECTED_DECISION_STATES.has(candidate.decisionState)) return false;
  if (!candidate.groundedEvidence) return false;
  if (!candidate.evidenceRoles.includes('user') && candidate.decisionState !== 'verified') return false;
  if (
    candidate.scope === 'project' &&
    !['explicit', 'accepted', 'implemented', 'verified', 'repeated'].includes(candidate.decisionState)
  ) return false;
  if (candidate.scope === 'global' && candidate.durableScore < 7) return false;
  try {
    assertSafeMemoryContent(candidate.content);
    assertSafeMemoryContent(candidate.summary);
  } catch {
    return false;
  }
  return true;
}

async function evaluateSession({ session, messages, config, maxInputChars }) {
  const systemPrompt = appendStructuredOutputLanguageRule(REVIEW_SYSTEM_PROMPT, config, {
    fields: 'content, summary, and reason'
  });
  const result = await createChatCompletion({
    sdkProvider: config?.sdk?.provider,
    baseUrl: config?.gateway?.base_url,
    apiKey: config?.gateway?.api_key,
    model: config?.model?.name,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Review session ${session.id}. Project: ${session.projectDir || ''}\n\n${compactConversation(messages, maxInputChars)}`
      }
    ],
    temperature: 0,
    timeoutMs: 30000
  });
  const parsed = parseCandidates(result?.text || '');
  if (!parsed) throw new Error('Session memory reviewer returned invalid JSON');
  return parsed
    .map((candidate) => normalizeSessionMemoryCandidate(candidate, messages))
    .filter(isSessionMemoryCandidateEligible);
}

export async function reviewSessionMemory({ sessionId, config }) {
  if (config?.memory?.enabled === false || config?.memory?.background_review?.enabled === false) {
    return { skipped: true, reason: 'disabled' };
  }
  const session = await loadSession(sessionId);
  const messages = visibleConversationMessages(session);
  if (messages.length < 2) return { skipped: true, reason: 'insufficient-conversation' };
  const contentHash = conversationHash(messages);
  const reviewerVersion = SESSION_MEMORY_REVIEWER_VERSION;
  const leaseMs = Math.max(30000, Number(config?.memory?.background_review?.lease_ms || 120000));
  const claim = await claimSessionMemoryReview({ sessionId, contentHash, reviewerVersion, leaseMs });
  if (!claim.claimed) return { skipped: true, reason: claim.reason };

  try {
    const maxInputChars = Math.max(2000, Number(config?.memory?.background_review?.max_input_chars || 12000));
    const candidates = await evaluateSession({ session, messages, config, maxInputChars });
    let captured = 0;
    for (const candidate of candidates) {
      const idempotencyKey = `${sessionId}:${reviewerVersion}:${contentHash}:${candidate.semanticKey}`;
      const entry = await captureToInbox({
        scope: candidate.scope,
        type: candidate.kind,
        family: candidate.family,
        summary: candidate.summary,
        details: candidate.content,
        source: 'session-review',
        tags: ['session-review', candidate.decisionState].filter(Boolean),
        semanticKey: candidate.semanticKey,
        idempotencyKey,
        evidence: {
          sessionId,
          reviewerVersion,
          contentHash,
          evidenceRoles: candidate.evidenceRoles,
          evidenceMessageIndices: candidate.evidenceIndices,
          decisionState: candidate.decisionState,
          durableScore: candidate.durableScore,
          confidence: candidate.confidence,
          reason: candidate.reason
        },
        projectDir: session.projectDir || ''
      });
      if (!entry?.duplicate) captured += 1;
    }
    await completeSessionMemoryReview({
      sessionId,
      contentHash,
      reviewerVersion,
      reviewedMessageCount: messages.length,
      candidateCount: captured
    });
    return { ok: true, sessionId, candidateCount: captured };
  } catch (error) {
    await failSessionMemoryReview({ sessionId, contentHash, reviewerVersion, error });
    throw error;
  }
}

function enqueueReview(sessionId, config) {
  const run = reviewQueue.then(() => reviewSessionMemory({ sessionId, config }));
  reviewQueue = run.catch(() => {});
  return run;
}

export function scheduleSessionMemoryReview({ sessionId, config, delayMs } = {}) {
  if (!sessionId || config?.memory?.background_review?.enabled === false) return;
  const delay = Math.max(0, Number(delayMs ?? config?.memory?.background_review?.idle_delay_ms ?? 1500));
  const existing = scheduledSessions.get(sessionId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    scheduledSessions.delete(sessionId);
    void enqueueReview(sessionId, config).catch(() => {});
  }, delay);
  timer.unref?.();
  scheduledSessions.set(sessionId, timer);
}

export function scheduleMemoryReviewBacklog({ config, currentSessionId } = {}) {
  if (config?.memory?.background_review?.enabled === false || config?.memory?.background_review?.on_start === false) return;
  const now = Date.now();
  if (backlogTimer || now - lastBacklogScheduledAt < 60000) return;
  lastBacklogScheduledAt = now;
  const delay = Math.max(0, Number(config?.memory?.background_review?.idle_delay_ms || 1500));
  backlogTimer = setTimeout(async () => {
    backlogTimer = null;
    try {
      const limit = Math.max(1, Number(config?.memory?.background_review?.max_sessions_per_run || 3));
      const minIdleMs = Math.max(0, Number(config?.memory?.background_review?.min_session_idle_ms || 30000));
      const sessions = await listSessions(Math.max(100, limit * 20), { includeEmpty: false });
      const eligible = sessions
        .filter((session) => session.id !== currentSessionId)
        .filter((session) => !session.updatedAt || Date.now() - Date.parse(session.updatedAt) >= minIdleMs);
      let attempted = 0;
      for (const session of eligible) {
        const result = await enqueueReview(session.id, config).catch(() => ({ skipped: false }));
        if (result?.reason === 'already-reviewed' || result?.reason === 'active-lease' || result?.reason === 'retry-backoff') {
          continue;
        }
        attempted += 1;
        if (attempted >= limit) break;
      }
    } catch {
      // Background review is best-effort and must never affect startup.
    }
  }, delay);
  backlogTimer.unref?.();
}
