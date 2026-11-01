import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionModeSwitchNotice, buildTurnUserPrompt } from '../src/core/turn-context.js';

test('mode switch notice is one line and only when the mode actually changes', () => {
  assert.equal(buildExecutionModeSwitchNotice('', 'plan', { ui: { reply_language: 'zh' } }), '');
  assert.equal(buildExecutionModeSwitchNotice('plan', 'code', { ui: { reply_language: 'zh' } }), '');
  assert.equal(
    buildExecutionModeSwitchNotice('crew', 'plan', { ui: { reply_language: 'zh' } }),
    '执行模式已从协作组切换到编码。',
  );
  assert.equal(
    buildExecutionModeSwitchNotice('normal', 'crew', { ui: { reply_language: 'en' } }),
    'Execution mode switched from Daily to Crew.',
  );
});

test('mode switch notice sits in the user turn context, not the task', () => {
  const prompt = buildTurnUserPrompt({
    turnRoutingContext: '执行模式已从协作组切换到编码。',
    userText: '把版本号挪一下',
  });
  assert.match(prompt, /<turn_context>\n执行模式已从协作组切换到编码。\n<\/turn_context>/);
  assert.match(prompt, /<task>\n把版本号挪一下\n<\/task>/);
});
