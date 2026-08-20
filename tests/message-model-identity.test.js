import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  buildModelPanelModel,
  getMessageModelIdentity,
} from '../codemini-web/client/src/lib/message-model-identity.js';

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

test('buildModelPanelModel includes default/fast models and context', () => {
  const panel = buildModelPanelModel({
    sdkProvider: 'openai-compatible',
    model: 'gpt-5.1-codex',
    runtimeState: {
      mainModel: 'gpt-5.1-codex',
      fastModel: 'gpt-4.1-mini',
      currentContextTokens: 84000,
      maxContextTokens: 200000,
      contextUsagePct: 42.2,
    },
  });

  assert.equal(panel.sdkLabel, 'OpenAI-compatible');
  assert.equal(panel.mainModel, 'gpt-5.1-codex');
  assert.equal(panel.fastModel, 'gpt-4.1-mini');
  assert.equal(panel.showReplyModel, false);
  assert.deepEqual(panel.context, {
    used: 84000,
    max: 200000,
    pct: 42,
  });
});

test('buildModelPanelModel flags a reply model that differs from default', () => {
  const panel = buildModelPanelModel({
    sdkProvider: 'anthropic',
    model: 'claude-haiku-4',
    runtimeState: {
      mainModel: 'claude-sonnet-4',
      fastModel: 'claude-haiku-4',
    },
  });

  assert.equal(panel.showReplyModel, true);
  assert.equal(panel.replyModel, 'claude-haiku-4');
  assert.equal(panel.context, null);
});

test('buildModelPanelModel falls back to runtime model when mainModel is missing', () => {
  const panel = buildModelPanelModel({
    sdkProvider: 'openai-compatible',
    model: 'gpt-5.1-codex',
    runtimeState: { model: 'gpt-5.1-codex' },
  });
  assert.equal(panel.mainModel, 'gpt-5.1-codex');
  assert.equal(panel.showReplyModel, false);
});

test('model identity hover uses the same tooltip chrome as token usage', async () => {
  const usage = await fs.readFile(
    'codemini-web/client/src/components/UsageBadge.jsx',
    'utf8',
  );
  const model = await fs.readFile(
    'codemini-web/client/src/components/ModelIdentityBadge.jsx',
    'utf8',
  );
  const chrome =
    'w-fit max-w-[calc(100vw-2rem)] p-3 text-left font-normal text-pretty';
  assert.match(usage, new RegExp(chrome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(model, new RegExp(chrome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(model, /w-\[280px\]/);
  assert.match(model, /modelPanelTitle/);
  assert.match(model, /contextPanelTitle/);
  assert.match(model, /t\("modelName"\)/);
  assert.match(model, /t\("fastModel"\)/);
  assert.match(
    model,
    /rounded-full bg-\(--bg-primary\)/,
    "context remainder track should stay white on the gray tooltip",
  );
  assert.doesNotMatch(
    model,
    /rounded-full bg-\(--muted\)/,
    "muted track disappears on Apple light tooltip chrome",
  );
  assert.match(usage, /rounded-full bg-\(--bg-primary\)/);
});
