import { randomUUID } from 'node:crypto';
import { evaluateCommandPolicy } from './command-policy.js';
import { requiresDeterministicCommandApproval } from './command-risk.js';
import { evaluateCommandWithLLM } from './command-evaluator.js';

// Authorization is returned to the caller, never persisted into global config.
export async function reviewCommandAccess({ command, config, workspaceRoot, capability,
  requestApproval, evaluate = evaluateCommandWithLLM, signal, onReview, forceHuman = false,
}) {
  signal?.throwIfAborted();
  const policy = evaluateCommandPolicy(command, config, workspaceRoot);
  if (!policy.allowed && policy.reason === 'blocked by dangerous command pattern') {
    return { approved: false, reason: policy.reason, source: 'policy' };
  }
  const humanRequired = forceHuman || requiresDeterministicCommandApproval(command)
    || !policy.allowed && /^(absolute path outside|relative path escapes|cd escapes|blocked protected system path|blocked command:)/i.test(policy.reason || '');
  let evaluation;
  try {
    evaluation = await evaluate({ command, config, workspaceRoot, capability, signal });
  } catch {
    evaluation = { failed: true, failureReason: 'evaluator_error', recommendation: 'deny', risk: 'high' };
  }
  signal?.throwIfAborted();
  onReview?.({ capability, command, evaluation, humanRequired });
  if (!humanRequired && evaluation?.failed !== true
      && ['low', 'medium'].includes(evaluation?.risk) && evaluation?.recommendation === 'allow') {
    return { approved: true, source: 'lite', evaluation };
  }
  if (typeof requestApproval !== 'function') {
    return { approved: false, source: 'user', reason: 'User approval is required', evaluation };
  }
  const request = { id: `access-${randomUUID()}`, name: 'run', displayName: capability,
    arguments: { command, capability, _evaluation: evaluation },
    approvalDetails: { command, capability, evaluation, risk: evaluation?.failed ? '' : evaluation?.risk,
      description: `Allow this command only: ${capability}`, policyBlock: policy.allowed ? null : policy },
  };
  let abort;
  try {
    const aborted = new Promise((_, reject) => {
      abort = () => reject(signal.reason || new Error('Aborted'));
      signal?.addEventListener('abort', abort, { once: true });
    });
    const decision = await Promise.race([Promise.resolve(requestApproval(request)), aborted]);
    signal?.throwIfAborted();
    return { approved: decision?.approved === true, source: 'user', reason: decision?.reason, evaluation };
  } finally { signal?.removeEventListener('abort', abort); }
}
