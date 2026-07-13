import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendStructuredOutputLanguageRule,
  buildGeneratedProseLanguageRule,
  buildSystemPromptWithReplyLanguage,
  getReplyLanguageName,
  stripReplyLanguageDirective
} from '../src/core/reply-language.js';

test('reply language names map from config', () => {
  assert.equal(getReplyLanguageName({ ui: { reply_language: 'zh' } }), 'Simplified Chinese');
  assert.equal(getReplyLanguageName({ ui: { reply_language: 'en' } }), 'English');
});

test('system prompt directive covers durable memory prose', () => {
  const prompt = buildSystemPromptWithReplyLanguage('Base rules.', { ui: { reply_language: 'zh' } });
  assert.match(prompt, /Respond in Simplified Chinese\./);
  assert.match(prompt, /memory content\/summary/);
  assert.match(prompt, /Simplified Chinese/);
});

test('stripReplyLanguageDirective removes old and new directive shapes', () => {
  const legacy = [
    'Body',
    '',
    '[Reply language]',
    'Respond in English.',
    'Write generated documentation, user-facing text, and code comments in English unless the user explicitly asks for a different language.'
  ].join('\n');
  assert.equal(stripReplyLanguageDirective(legacy), 'Body');

  const modern = buildSystemPromptWithReplyLanguage('Body', { ui: { reply_language: 'zh' } });
  assert.equal(stripReplyLanguageDirective(modern), 'Body');
});

test('structured output language rule appends once', () => {
  const first = appendStructuredOutputLanguageRule('Evaluator.', { ui: { reply_language: 'zh' } }, {
    fields: 'content and summary'
  });
  const second = appendStructuredOutputLanguageRule(first, { ui: { reply_language: 'zh' } }, {
    fields: 'content and summary'
  });
  assert.equal(first, second);
  assert.match(first, /write content and summary in Simplified Chinese/);
  assert.match(buildGeneratedProseLanguageRule({ ui: { reply_language: 'en' } }), /in English/);
});
