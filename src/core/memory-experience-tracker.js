import { captureToInbox } from './memory-store.js';
import { confirmRetrievedMemories } from './memory-retriever.js';
import { classifyToolError } from './memory-policy.js';
import { buildCodingLessonFromEpisode } from './memory-experience-extractor.js';

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  return String(args.command || args.path || args.cmd || JSON.stringify(args)).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function nowIso() {
  return new Date().toISOString();
}

function isCommandArgs(args) {
  return Boolean(args && typeof args === 'object' && typeof args.command === 'string' && args.command.trim());
}

function fingerprintOf(tool, args) {
  return `${String(tool || '')}:${summarizeArgs(args)}`.slice(0, 160);
}

/**
 * Experience episode tracker (design §16–21).
 *
 * State machine: open → failed → recovering → recovered → verified.
 * - A command failure opens/advances the episode.
 * - A repeated failure with the same fingerprint is a retry, not a strategy change.
 * - A successful command after a failure marks RECOVERED.
 * - A deterministic verification (test/build/lint exit 0) marks VERIFIED.
 * Only a VERIFIED episode produces a coding lesson via the extractor.
 */
export function createExperienceTracker({
  sessionId = '',
  workspaceRoot = process.cwd(),
  config = {}
} = {}) {
  const attempts = [];
  const maxAttempts = Math.max(1, Number(config?.memory?.experience?.max_attempts_per_episode || 6));
  const requireVerification = config?.memory?.experience?.require_verification !== false;
  let state = 'open';
  let failedFingerprint = '';
  let lastFailedApproach = null;
  let workingApproach = null;
  let verificationType = '';
  let pendingRecovery = [];
  let flushed = false;

  return {
    noteRecovery(hits = []) {
      pendingRecovery = Array.isArray(hits) ? hits.filter((item) => item?.id) : [];
    },

    recordAttempt({ tool, args, result, error } = {}) {
      if (config?.memory?.experience?.enabled === false) return;
      const toolName = String(tool || '');
      const outcome = result === 'success' ? 'success' : 'failure';
      const isCommand = isCommandArgs(args);
      const fingerprint = fingerprintOf(toolName, args);
      attempts.push({
        tool: toolName,
        fingerprint,
        outcome,
        errorClass: classifyToolError(error),
        error: String(error || '').slice(0, 240),
        timestamp: nowIso()
      });
      if (attempts.length > maxAttempts) attempts.splice(0, attempts.length - maxAttempts);

      if (outcome === 'failure') {
        if (state === 'open') {
          state = 'failed';
          failedFingerprint = fingerprint;
          lastFailedApproach = { tool: toolName, argsSummary: summarizeArgs(args), errorClass: classifyToolError(error) };
        } else if (state === 'failed') {
          if (fingerprint !== failedFingerprint) {
            state = 'recovering';
            failedFingerprint = fingerprint;
            lastFailedApproach = { tool: toolName, argsSummary: summarizeArgs(args), errorClass: classifyToolError(error) };
          }
        } else if (state === 'recovering') {
          failedFingerprint = fingerprint;
          lastFailedApproach = { tool: toolName, argsSummary: summarizeArgs(args), errorClass: classifyToolError(error) };
        }
      } else if (isCommand && (state === 'failed' || state === 'recovering')) {
        state = 'recovered';
        workingApproach = { tool: toolName, argsSummary: summarizeArgs(args) };
      }
    },

    noteVerification({ type = 'test_exit_zero' } = {}) {
      if (state !== 'recovered') return;
      state = 'verified';
      verificationType = type;
      if (pendingRecovery.length) {
        try { confirmRetrievedMemories(pendingRecovery, workspaceRoot); } catch { /* best-effort */ }
        pendingRecovery = [];
      }
    },

    async flush() {
      if (flushed) return null;
      if (config?.memory?.experience?.enabled === false) return null;
      if (config?.memory?.experience?.writeback_on_recovery === false) return null;
      flushed = true;
      if (requireVerification) {
        if (state !== 'verified') return null;
      } else if (state !== 'recovered' && state !== 'verified') {
        return null;
      }
      if (!lastFailedApproach || !workingApproach) return null;

      const failed = attempts.filter((item) => item.outcome === 'failure');
      const lesson = buildCodingLessonFromEpisode({
        sessionId,
        failedApproach: lastFailedApproach,
        workingApproach,
        failedCount: failed.length,
        toolNames: [...new Set(attempts.map((item) => item.tool))].filter(Boolean),
        verificationType,
        environmentKey: process.platform
      });
      const entry = await captureToInbox({
        scope: 'project',
        type: 'lesson',
        family: 'coding',
        summary: lesson.summary,
        details: lesson.content,
        source: 'experience-extractor',
        tags: ['coding', 'recovery', 'verified'],
        semanticKey: lesson.semanticKey,
        evidence: lesson.evidence,
        projectDir: workspaceRoot
      });
      return { ok: true, entry, lesson };
    }
  };
}
