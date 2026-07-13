import test from 'node:test';
import assert from 'node:assert/strict';

import { getMessageModelIdentity } from '../codemini-web/client/src/lib/message-model-identity.js';

test('getMessageModelIdentity returns branded OpenAI-compatible metadata', () => {
  assert.deepEqual(
    getMessageModelIdentity({
      sdkProvider: 'openai-compatible',
      model: 'gpt-5.1-codex',
    }),
    {
      logo: '/logos/openai.svg',
      sdkLabel: 'OpenAI-compatible',
      model: 'gpt-5.1-codex',
      modelLogo: '/logos/openai.svg',
      details: 'OpenAI-compatible · gpt-5.1-codex',
    },
  );
});

test('getMessageModelIdentity only renders complete, known SDK/model pairs', () => {
  assert.equal(getMessageModelIdentity({ sdkProvider: 'anthropic' }), null);
  assert.equal(getMessageModelIdentity({ model: 'claude-sonnet-4' }), null);
  assert.equal(
    getMessageModelIdentity({ sdkProvider: 'unknown-sdk', model: 'test' }),
    null,
  );
});
