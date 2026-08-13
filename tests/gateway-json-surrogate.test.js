import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeUnicodeText,
  stringifyGatewayJson,
} from '../src/core/provider/json-body.js';
import { sanitizeTextForModel } from '../src/core/tool-output.js';
import { createChatCompletion } from '../src/core/provider/anthropic.js';

test('sanitizeUnicodeText replaces lone UTF-16 surrogates', () => {
  const lone = `pre${String.fromCharCode(0xd83d)}post`;
  const fixed = sanitizeUnicodeText(lone);
  assert.equal(fixed.includes('\uFFFD'), true);
  assert.equal(fixed.includes(String.fromCharCode(0xd83d)), false);
  assert.equal(sanitizeUnicodeText('ok 📦 emoji'), 'ok 📦 emoji');
});

test('stringifyGatewayJson does not emit lone-surrogate escapes', () => {
  const lone = `hello${String.fromCharCode(0xd83d)}world`;
  const body = stringifyGatewayJson({
    messages: [{
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: lone }],
    }],
  });
  assert.doesNotMatch(body, /\\ud83d/i);
  assert.equal(JSON.parse(body).messages[0].content[0].content.includes('\uFFFD'), true);
  assert.doesNotThrow(() => JSON.parse(body));
});

test('sanitizeTextForModel repairs truncation that splits an emoji', () => {
  const clipped = sanitizeTextForModel('📥'.repeat(20), { maxChars: 1, maxLineLength: 0 });
  assert.equal(clipped.includes(String.fromCharCode(0xd83d)), false);
  assert.equal(clipped.includes(String.fromCharCode(0xdce5)), false);
  assert.equal(clipped.includes('\uFFFD') || clipped.startsWith('...'), true);
});

test('Anthropic request body strips lone surrogates from tool results', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let rawBody = '';
  globalThis.fetch = async (_url, options = {}) => {
    rawBody = String(options.body || '');
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const lone = `file${String.fromCharCode(0xd83d)}bin`;
  await createChatCompletion({
    baseUrl: 'https://example.invalid',
    apiKey: 'test-key',
    model: 'test-model',
    messages: [
      { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: lone },
    ],
  });

  assert.doesNotMatch(rawBody, /\\ud83d/i);
  const parsed = JSON.parse(rawBody);
  const toolContent = parsed.messages[1].content[0].content;
  assert.equal(toolContent.includes('\uFFFD'), true);
});
