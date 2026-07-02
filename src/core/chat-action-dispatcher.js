export const CHAT_ACTIONS = Object.freeze({
  COMPACT: 'compact',
  DREAM: 'dream',
  CAPTURE: 'capture',
  INBOX: 'inbox',
  REFLECT: 'reflect',
  SPEC_PLAN_AND_EXECUTE: 'spec.plan-and-execute',
  SPEC_EXECUTE: 'spec.execute',
  SPEC_SAVE: 'spec.save',
  SPEC_REVISE: 'spec.revise',
  SPEC_REJECT: 'spec.reject',
  REFLECT_APPROVE: 'reflect.approve',
  REFLECT_REVISE: 'reflect.revise',
  REFLECT_REJECT: 'reflect.reject',
  APPROVAL_APPROVE: 'approval.approve',
  APPROVAL_REJECT: 'approval.reject'
});

const ACTION_NAMES = new Set(Object.values(CHAT_ACTIONS));
const SPEC_ACTIONS = new Set([
  CHAT_ACTIONS.SPEC_PLAN_AND_EXECUTE,
  CHAT_ACTIONS.SPEC_EXECUTE,
  CHAT_ACTIONS.SPEC_SAVE,
  CHAT_ACTIONS.SPEC_REVISE,
  CHAT_ACTIONS.SPEC_REJECT
]);
const REFLECT_ACTIONS = new Set([
  CHAT_ACTIONS.REFLECT_APPROVE,
  CHAT_ACTIONS.REFLECT_REVISE,
  CHAT_ACTIONS.REFLECT_REJECT
]);
const APPROVAL_ACTIONS = new Set([
  CHAT_ACTIONS.APPROVAL_APPROVE,
  CHAT_ACTIONS.APPROVAL_REJECT
]);

export class ChatActionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChatActionError';
    this.code = code;
  }
}

function requireFeedback(payload) {
  const feedback = String(payload.feedback || '').trim();
  if (!feedback) throw new ChatActionError('FEEDBACK_REQUIRED', 'feedback is required');
  return feedback;
}

export function validateChatAction(action, runtimeState = {}) {
  const name = String(action?.name || '').trim();
  if (!ACTION_NAMES.has(name)) {
    throw new ChatActionError('UNKNOWN_ACTION', `Unknown chat action: ${name || '(empty)'}`);
  }

  const inputPayload = action?.payload && typeof action.payload === 'object'
    ? action.payload
    : {};
  const payload = { ...inputPayload };

  if (name === CHAT_ACTIONS.CAPTURE) {
    payload.summary = String(payload.summary || '').trim();
    if (!payload.summary) {
      throw new ChatActionError('SUMMARY_REQUIRED', 'summary is required');
    }
    payload.details = String(payload.details || '').trim();
  }

  if (SPEC_ACTIONS.has(name)) {
    if (!runtimeState.pendingSpecApproval) {
      throw new ChatActionError('NO_PENDING_REVIEW', 'A pending spec approval is required');
    }
    if (name === CHAT_ACTIONS.SPEC_REVISE) payload.feedback = requireFeedback(payload);
  }

  if (REFLECT_ACTIONS.has(name)) {
    if (!runtimeState.pendingReflectApproval) {
      throw new ChatActionError('NO_PENDING_REVIEW', 'A pending reflect approval is required');
    }
    if (name === CHAT_ACTIONS.REFLECT_REVISE) payload.feedback = requireFeedback(payload);
  }

  if (APPROVAL_ACTIONS.has(name)) {
    const pending = runtimeState.pendingApproval;
    if (!pending) throw new ChatActionError('NO_PENDING_APPROVAL', 'A pending approval is required');
    payload.requestId = String(payload.requestId || '').trim();
    if (!payload.requestId) throw new ChatActionError('INVALID_ACTION', 'requestId is required');
    if (payload.requestId !== String(pending.id || '')) {
      throw new ChatActionError('STALE_ACTION', 'Stale approval request id');
    }
  }

  if (typeof payload.reason === 'string') payload.reason = payload.reason.trim();
  return { name, payload };
}
