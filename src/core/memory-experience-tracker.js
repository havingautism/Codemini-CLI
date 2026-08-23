import { captureToInbox } from './memory-store.js';

function summarizeArgs(args) {
  if (!args || typeof args !== 'object') return '';
  return String(args.command || args.path || args.cmd || JSON.stringify(args)).replace(/\s+/g, ' ').trim().slice(0, 180);
}

function classifyError(error) {
  const text = String(error || '');
  if (/command not found|exit 127/i.test(text)) return 'command_not_found';
  if (/permission denied/i.test(text)) return 'permission_denied';
  if (/ENOENT|no such file/i.test(text)) return 'missing_path';
  return 'error';
}

export function createExperienceTracker({
  sessionId = '',
  workspaceRoot = process.cwd(),
  config = {}
} = {}) {
  const attempts = [];
  const maxAttempts = Math.max(1, Number(config?.memory?.experience?.max_attempts_per_episode || 6));
  let flushed = false;

  return {
    recordAttempt({ tool, args, result, error } = {}) {
      if (config?.memory?.experience?.enabled === false) return;
      attempts.push({
        tool: String(tool || ''),
        argsSummary: summarizeArgs(args),
        result: result === 'success' ? 'success' : 'failure',
        errorClass: classifyError(error),
        error: String(error || '').slice(0, 240)
      });
      if (attempts.length > maxAttempts) attempts.splice(0, attempts.length - maxAttempts);
    },

    async flush() {
      if (flushed) return null;
      if (config?.memory?.experience?.enabled === false) return null;
      if (config?.memory?.experience?.writeback_on_recovery === false) return null;
      const failed = attempts.filter((item) => item.result === 'failure');
      const succeeded = attempts.filter((item) => item.result === 'success');
      if (!failed.length || !succeeded.length) return null;
      flushed = true;
      const lastFail = failed[failed.length - 1];
      const lastOk = succeeded[succeeded.length - 1];
      const summary = `${lastFail.argsSummary || lastFail.tool} failed; recovered with ${lastOk.argsSummary || lastOk.tool}`.slice(0, 120);
      const details = [
        `Failed approach: ${lastFail.tool} ${lastFail.argsSummary} (${lastFail.errorClass}: ${lastFail.error})`.trim(),
        `Working approach: ${lastOk.tool} ${lastOk.argsSummary}`.trim(),
        `Failed attempts: ${failed.length}`
      ].join('\n');
      const entry = await captureToInbox({
        scope: 'project',
        type: 'lesson',
        family: 'coding',
        summary,
        details,
        source: 'experience-tracker',
        tags: ['coding', 'recovery'],
        semanticKey: `coding-recovery:${String(lastFail.argsSummary || lastFail.tool).slice(0, 80)}`,
        evidence: {
          sessionId,
          failed_attempts: failed.length,
          successful_recovery: true,
          tool_names: [...new Set(attempts.map((item) => item.tool))].filter(Boolean),
          failed_approach: lastFail.argsSummary,
          working_approach: lastOk.argsSummary
        },
        projectDir: workspaceRoot
      });
      return { ok: true, entry };
    }
  };
}
