import { createHash } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}

function fingerprint(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex')
    .slice(0, 16);
}

function splitPayload(payload = {}) {
  const sourceMessages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemMessages = sourceMessages.filter((message) => message?.role === 'system');
  const messages = sourceMessages.filter((message) => message?.role !== 'system');
  const system = payload.system ?? (systemMessages.length ? systemMessages : '');
  return {
    system,
    tools: Array.isArray(payload.tools) ? payload.tools : [],
    messages,
  };
}

function sharedPrefixLength(left = [], right = []) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

export function buildPromptRequestAudit(payload, previousSnapshot = null, {
  requestPurpose = 'main',
} = {}) {
  const { system, tools, messages } = splitPayload(payload);
  const systemHash = fingerprint(system);
  const toolsHash = fingerprint(tools);
  const messageHashes = messages.map(fingerprint);
  const previous = previousSnapshot && typeof previousSnapshot === 'object'
    ? previousSnapshot
    : null;
  const sharedMessagePrefixCount = previous
    ? sharedPrefixLength(previous.messageHashes, messageHashes)
    : 0;
  const stablePromptPrefix = previous
    && previous.systemHash === systemHash
    && previous.toolsHash === toolsHash;
  const promptRevision = previous
    ? Math.max(1, Number(previous.promptRevision || 1)) + (stablePromptPrefix ? 0 : 1)
    : 1;

  let firstChangedSection = 'initial';
  let changeReason = 'initial-request';
  if (previous) {
    if (previous.systemHash !== systemHash) {
      firstChangedSection = 'system';
      changeReason = 'system-changed';
    } else if (previous.toolsHash !== toolsHash) {
      firstChangedSection = 'tools';
      const previousToolCount = Math.max(0, Number(previous.toolCount || 0));
      changeReason = tools.length > previousToolCount
        ? 'deferred-tool-activated'
        : tools.length < previousToolCount
          ? 'tool-set-reduced'
          : 'tool-schema-changed';
    } else if (
      sharedMessagePrefixCount < Math.min(previous.messageHashes?.length || 0, messageHashes.length)
      || messageHashes.length < (previous.messageHashes?.length || 0)
    ) {
      firstChangedSection = 'messages';
      changeReason = 'history-rewritten';
    } else if (messageHashes.length > (previous.messageHashes?.length || 0)) {
      firstChangedSection = 'messages';
      changeReason = 'messages-appended';
    } else {
      firstChangedSection = 'none';
      changeReason = 'identical-request-prefix';
    }
  }

  const snapshot = {
    promptRevision,
    systemHash,
    toolsHash,
    toolCount: tools.length,
    messageHashes,
  };
  return {
    snapshot,
    audit: {
      requestPurpose,
      promptRevision,
      systemHash,
      toolsHash,
      messageCount: messages.length,
      toolCount: tools.length,
      sharedMessagePrefixCount,
      firstChangedSection,
      changeReason,
      cacheUsageStatus: 'unreported',
    },
  };
}
