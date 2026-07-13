import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TITLE_SYSTEM_PROMPT,
  buildSessionTitleInput,
  isVagueTitleUserText,
  looksLikeAssistantReplyTitle,
  normalizeGeneratedSessionTitle,
  shouldReplaceSessionTitle
} from '../src/core/session-title.js';

test('shouldReplaceSessionTitle only replaces empty/default titles', () => {
  assert.equal(shouldReplaceSessionTitle(''), true);
  assert.equal(shouldReplaceSessionTitle('新会话'), true);
  assert.equal(shouldReplaceSessionTitle('New session'), true);
  assert.equal(shouldReplaceSessionTitle('Plan 工具注释测试'), false);
});

test('isVagueTitleUserText detects short and stock prompts', () => {
  assert.equal(isVagueTitleUserText('帮我看看'), true);
  assert.equal(isVagueTitleUserText('hi'), true);
  assert.equal(isVagueTitleUserText('修一下'), true);
  assert.equal(isVagueTitleUserText('测试plan工具，给我随便生成一些注释，步骤不要太多'), false);
});

test('looksLikeAssistantReplyTitle catches reply openers', () => {
  assert.equal(looksLikeAssistantReplyTitle('没问题，以下是一些简单...'), true);
  assert.equal(looksLikeAssistantReplyTitle('当然可以，我可以帮...'), true);
  assert.equal(looksLikeAssistantReplyTitle('Sure, here are a few comments'), true);
  assert.equal(looksLikeAssistantReplyTitle('Of course, I can help'), true);
  assert.equal(looksLikeAssistantReplyTitle('收到'), true);
  assert.equal(looksLikeAssistantReplyTitle('明白了'), true);
  assert.equal(looksLikeAssistantReplyTitle('I can take care of that'), true);
  assert.equal(looksLikeAssistantReplyTitle('建议：先检查配置'), true);
  assert.equal(looksLikeAssistantReplyTitle('以下是修复步骤'), true);
  assert.equal(looksLikeAssistantReplyTitle('Plan 工具注释测试'), false);
  assert.equal(looksLikeAssistantReplyTitle('Generate sample comments'), false);
  assert.equal(looksLikeAssistantReplyTitle('建议方案'), false);
});

test('normalizeGeneratedSessionTitle rejects reply-like titles', () => {
  const fallback = '测试plan工具生成注释';
  assert.equal(
    normalizeGeneratedSessionTitle('没问题，以下是一些简单注释', fallback),
    fallback
  );
  assert.equal(
    normalizeGeneratedSessionTitle('当然可以，我可以帮你', fallback),
    fallback
  );
  assert.equal(
    normalizeGeneratedSessionTitle('Sure, here are a few comments', fallback),
    fallback
  );
  assert.equal(
    normalizeGeneratedSessionTitle('Plan 工具注释测试', fallback),
    'Plan 工具注释测试'
  );
});

test('normalizeGeneratedSessionTitle still strips summary wrappers', () => {
  assert.equal(
    normalizeGeneratedSessionTitle('这是一次关于修复 Web UI 标题生成问题的会话总结'),
    '修复 Web UI 标题生成'
  );
});

test('normalizeGeneratedSessionTitle falls back for multi-line or sentence-like replies', () => {
  const fallback = '修复登录回调';
  assert.equal(
    normalizeGeneratedSessionTitle('收到，我先检查一下。\n\n下面是处理结果：', fallback),
    fallback
  );
  assert.equal(
    normalizeGeneratedSessionTitle('I will check the config. Then I will fix it.', fallback),
    fallback
  );
});

test('buildSessionTitleInput omits reply-like assistant hints', () => {
  const withReply = buildSessionTitleInput({
    userText: '帮我看看',
    assistantText: '没问题，以下是一些简单注释示例'
  });
  assert.match(withReply, /^User:\n帮我看看$/);
  assert.doesNotMatch(withReply, /Assistant context/);

  const withTopic = buildSessionTitleInput({
    userText: '帮我看看',
    assistantText: 'OAuth redirect is failing after login'
  });
  assert.match(withTopic, /Assistant context/);
  assert.match(withTopic, /OAuth redirect/);
});

test('buildSessionTitleInput skips assistant hint for concrete user text', () => {
  const input = buildSessionTitleInput({
    userText: '测试plan工具，给我随便生成一些注释，步骤不要太多',
    assistantText: 'Plan 执行完成，已添加注释'
  });
  assert.match(input, /测试plan工具/);
  assert.doesNotMatch(input, /Assistant context/);
});

test('SESSION_TITLE_SYSTEM_PROMPT forbids answering the user', () => {
  assert.match(SESSION_TITLE_SYSTEM_PROMPT, /Do not answer the user/);
  assert.match(SESSION_TITLE_SYSTEM_PROMPT, /没问题，以下是一些简单注释/);
});
