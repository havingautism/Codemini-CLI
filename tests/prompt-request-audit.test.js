import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPromptRequestAudit } from '../src/core/prompt-request-audit.js';

function payload({ system = 'stable', tools = [], messages = [] } = {}) {
  return {
    model: 'test-model',
    messages: [{ role: 'system', content: system }, ...messages],
    tools,
  };
}

test('prompt request audit distinguishes append-only history from rewritten history', () => {
  const first = buildPromptRequestAudit(payload({
    messages: [{ role: 'user', content: 'one' }],
  }));
  const appended = buildPromptRequestAudit(payload({
    messages: [
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
    ],
  }), first.snapshot);
  assert.equal(appended.audit.promptRevision, 1);
  assert.equal(appended.audit.sharedMessagePrefixCount, 1);
  assert.equal(appended.audit.changeReason, 'messages-appended');

  const rewritten = buildPromptRequestAudit(payload({
    messages: [
      { role: 'user', content: 'changed' },
      { role: 'assistant', content: 'two' },
    ],
  }), appended.snapshot);
  assert.equal(rewritten.audit.sharedMessagePrefixCount, 0);
  assert.equal(rewritten.audit.changeReason, 'history-rewritten');
});

test('prompt request audit uses normalized provider payloads and reports tool activation', () => {
  const baseTool = { type: 'function', function: { name: 'read', parameters: { type: 'object' } } };
  const deferredTool = { type: 'function', function: { name: 'grep', parameters: { type: 'object' } } };
  const first = buildPromptRequestAudit(payload({ tools: [baseTool] }));
  const activated = buildPromptRequestAudit(payload({ tools: [baseTool, deferredTool] }), first.snapshot);

  assert.equal(activated.audit.firstChangedSection, 'tools');
  assert.equal(activated.audit.changeReason, 'deferred-tool-activated');
  assert.equal(activated.audit.promptRevision, 2);
  assert.equal(activated.audit.cacheUsageStatus, 'unreported');

  const anthropicShape = buildPromptRequestAudit({
    system: 'stable',
    messages: [{ role: 'user', content: 'one' }],
    tools: [baseTool],
  });
  assert.equal(anthropicShape.audit.messageCount, 1);
  assert.equal(anthropicShape.audit.toolCount, 1);
});
