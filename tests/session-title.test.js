import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION_TITLE_SYSTEM_PROMPT,
  buildSessionTitleInput,
  buildSessionTitleMessages,
  buildSessionTitleSystemPrompt,
  ensureSessionTitleEmoji,
  normalizeGeneratedSessionTitle,
  retrySessionTitleRequest,
  shouldReplaceSessionTitle
} from '../src/core/session-title.js';
import { createSessionTitleTaskCoordinator } from '../src/core/chat-runtime.js';
import {
  deriveSessionTitle,
  resolveLatestTitleExchange,
  resolveTitleUserText
} from '../src/core/session-store.js';

test('shouldReplaceSessionTitle only replaces empty/default titles', () => {
  assert.equal(shouldReplaceSessionTitle(''), true);
  assert.equal(shouldReplaceSessionTitle('新会话'), true);
  assert.equal(shouldReplaceSessionTitle('New session'), true);
  assert.equal(shouldReplaceSessionTitle('💬 新会话'), true);
  assert.equal(shouldReplaceSessionTitle('Plan 工具注释测试'), false);
});

test('normalizeGeneratedSessionTitle keeps an emoji title and supplies the default emoji', () => {
  assert.equal(normalizeGeneratedSessionTitle('标题：🧪 Plan 工具注释测试'), '🧪 Plan 工具注释测试');
  assert.equal(normalizeGeneratedSessionTitle('Plan 工具注释测试'), '💬 Plan 工具注释测试');
  assert.equal(ensureSessionTitleEmoji('OAuth 回调修复'), '💬 OAuth 回调修复');
  assert.equal(ensureSessionTitleEmoji('🛠️标题修复'), '🛠️ 标题修复');
});

test('normalizeGeneratedSessionTitle still strips summary wrappers', () => {
  assert.equal(
    normalizeGeneratedSessionTitle('这是一次关于修复 Web UI 标题生成问题的会话总结'),
    '💬 修复 Web UI 标题生成'
  );
});

test('normalizeGeneratedSessionTitle falls back for multi-line output', () => {
  const fallback = '修复登录回调';
  assert.equal(
    normalizeGeneratedSessionTitle('收到，我先检查一下。\n\n下面是处理结果：', fallback),
    `💬 ${fallback}`
  );
});

test('buildSessionTitleInput always includes the assistant final answer', () => {
  const input = buildSessionTitleInput({
    userText: '帮我看看',
    assistantText: '定位到 OAuth redirect 配置错误并已修复'
  });
  assert.match(input, /User request:\n帮我看看/);
  assert.match(input, /Assistant final answer:\n定位到 OAuth redirect/);
});

test('buildSessionTitleInput removes reasoning and tool-call blocks', () => {
  const input = buildSessionTitleInput({
    userText: '修复登录问题',
    assistantText: '<thinking>检查密钥</thinking><tool_call>read config</tool_call>已修复 OAuth 回调地址'
  });
  assert.doesNotMatch(input, /检查密钥|read config|thinking|tool_call/);
  assert.match(input, /已修复 OAuth 回调地址/);
});

test('title messages use few-shot labels before the real first exchange', () => {
  const messages = buildSessionTitleMessages({
    userText: '帮我看看',
    assistantText: '修复了 OAuth 回调地址'
  });
  assert.equal(messages[0].role, 'system');
  assert.match(SESSION_TITLE_SYSTEM_PROMPT, /assistant final answer/);
  assert.ok(messages.filter((message) => message.role === 'assistant').length >= 3);
  assert.ok(messages.filter((message) => message.role === 'assistant').every((message) => /^\S+\s/u.test(message.content)));
  assert.match(messages.at(-1).content, /User request:\n帮我看看/);
  assert.match(messages.at(-1).content, /Assistant final answer:\n修复了 OAuth 回调地址/);
});

test('title system prompt follows configured reply language', () => {
  const zhPrompt = buildSessionTitleSystemPrompt({ ui: { reply_language: 'zh' } });
  const enPrompt = buildSessionTitleSystemPrompt({ ui: { reply_language: 'en' } });
  assert.match(zhPrompt, /Simplified Chinese/);
  assert.match(enPrompt, /English/);
  assert.match(zhPrompt, /Do not switch to the user\/assistant message language/);

  const zhMessages = buildSessionTitleMessages(
    { userText: 'hi', assistantText: '안녕하세요' },
    { ui: { reply_language: 'zh' } },
  );
  const enMessages = buildSessionTitleMessages(
    { userText: 'hi', assistantText: 'Hello' },
    { ui: { reply_language: 'en' } },
  );
  assert.match(zhMessages[0].content, /Simplified Chinese/);
  assert.match(enMessages[0].content, /English/);
  assert.match(zhMessages[2].content, /订单列表筛选|OAuth 回调修复|打招呼/);
  assert.match(enMessages[2].content, /Order list filters|OAuth callback fix|Prepare 2\.4\.0 release/);
});

test('retrySessionTitleRequest retries once after a failed title request', async () => {
  let attempts = 0;
  const result = await retrySessionTitleRequest(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('empty assistant response');
    return { text: '🛠️ 标题重试成功' };
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, { text: '🛠️ 标题重试成功' });
});

test('retrySessionTitleRequest does not retry an externally aborted request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(
    retrySessionTitleRequest(async () => {
      attempts += 1;
      controller.abort();
      throw new DOMException('Aborted', 'AbortError');
    }, { signal: controller.signal }),
    { name: 'AbortError' },
  );
  assert.equal(attempts, 1);
});

test('explicit skill transport uses the skill heading instead of its internal name for titles', () => {
  const message = {
    role: 'user',
    content: 'skill:[fetch-hupu-basketball-news]',
    model_content: [
      '[Explicit skill composition]',
      '',
      '[Executing skill: /fetch-hupu-basketball-news]',
      '',
      '# 获取虎扑篮球新闻',
      '',
      '## 工作流',
      '抓取并整理篮球新闻。',
      '',
      '[User task]',
      'Begin the selected skill workflow. If required information is missing, ask the user for it.',
    ].join('\n'),
  };

  assert.equal(resolveTitleUserText(message), '使用「获取虎扑篮球新闻」技能');
  assert.equal(deriveSessionTitle([message]), '💬 使用「获取虎扑篮球新闻」技能');
});

test('resolveLatestTitleExchange pairs the last answer with its nearest preceding question', () => {
  const exchange = resolveLatestTitleExchange([
    { role: 'user', content: '第一个问题' },
    { role: 'assistant', content: '第一个回答' },
    { role: 'user', content: '最后的问题' },
    { role: 'tool', content: '内部工具结果' },
    { role: 'assistant', content: '最后的回答' },
    { role: 'user', content: '尚未回答的问题' },
  ]);
  assert.deepEqual(exchange, { userText: '最后的问题', assistantText: '最后的回答' });
});

test('title task coordinator stops late saves and events during disposal', async () => {
  let finishGeneration;
  const generated = new Promise((resolve) => {
    finishGeneration = resolve;
  });
  const saves = [];
  const events = [];
  const coordinator = createSessionTitleTaskCoordinator({
    generateTitle: () => generated,
    save: async (session) => saves.push(session.title),
  });
  coordinator.setOnTitleUpdate((sessionId, title) => events.push({ sessionId, title }));
  coordinator.schedule({
    session: { id: 's1', title: '新会话' },
    userText: '修复标题生成',
    config: {},
  });

  const disposal = coordinator.dispose();
  finishGeneration('标题生成修复');
  await disposal;

  assert.deepEqual(saves, []);
  assert.deepEqual(events, []);
});

test('title task coordinator saves and emits a completed title', async () => {
  const session = { id: 's1', title: '新会话' };
  const saves = [];
  const events = [];
  const statuses = [];
  const coordinator = createSessionTitleTaskCoordinator({
    generateTitle: async () => '标题生成修复',
    save: async (value) => saves.push(value.title),
  });
  coordinator.setOnTitleUpdate((sessionId, title) => events.push({ sessionId, title }));
  coordinator.setOnTitleStatus((sessionId, generating) => statuses.push({ sessionId, generating }));

  await coordinator.schedule({ session, userText: '修复标题生成', config: {} });

  assert.equal(session.title, '标题生成修复');
  assert.deepEqual(saves, ['标题生成修复']);
  assert.deepEqual(events, [{ sessionId: 's1', title: '标题生成修复' }]);
  assert.deepEqual(statuses, [
    { sessionId: 's1', generating: true },
    { sessionId: 's1', generating: false },
  ]);
  await coordinator.dispose();
});

test('title task coordinator only applies the latest generation for a session', async () => {
  const resolvers = [];
  const session = { id: 's1', title: '💬 旧标题' };
  const coordinator = createSessionTitleTaskCoordinator({
    generateTitle: () => new Promise((resolve) => resolvers.push(resolve)),
    save: async () => {},
  });
  const first = coordinator.schedule({ session, userText: '首轮' });
  const second = coordinator.schedule({ session, userText: '末轮' });
  resolvers[1]('🆕 末轮标题');
  await second;
  resolvers[0]('⏳ 过期标题');
  await first;
  assert.equal(session.title, '🆕 末轮标题');
  await coordinator.dispose();
});

test('title task coordinator preserves the requested timestamp for manual regeneration', async () => {
  const preservedAt = '2026-07-01T10:00:00.000Z';
  const saveOptions = [];
  const events = [];
  const coordinator = createSessionTitleTaskCoordinator({
    generateTitle: async () => '🛠️ 手动生成标题',
    save: async (_session, options) => saveOptions.push(options),
  });
  coordinator.setOnTitleUpdate((sessionId, title, metadata) => {
    events.push({ sessionId, title, metadata });
  });

  await coordinator.schedule({
    session: { id: 's1', title: '💬 旧标题' },
    userText: '最后的问题',
    assistantText: '最后的回答',
    preserveUpdatedAt: preservedAt,
  });

  assert.deepEqual(saveOptions, [{ preserveUpdatedAt: preservedAt }]);
  assert.deepEqual(events, [{
    sessionId: 's1',
    title: '🛠️ 手动生成标题',
    metadata: { preserveUpdatedAt: true },
  }]);
  await coordinator.dispose();
});

test('title task coordinator disposal waits for an in-progress save and suppresses its event', async () => {
  let finishSave;
  let saveStarted;
  const started = new Promise((resolve) => {
    saveStarted = resolve;
  });
  const events = [];
  const coordinator = createSessionTitleTaskCoordinator({
    generateTitle: async () => '标题生成修复',
    save: () => {
      saveStarted();
      return new Promise((resolve) => {
        finishSave = resolve;
      });
    },
  });
  coordinator.setOnTitleUpdate((sessionId, title) => events.push({ sessionId, title }));
  coordinator.schedule({
    session: { id: 's1', title: '新会话' },
    userText: '修复标题生成',
    config: {},
  });
  await started;

  let disposed = false;
  const disposal = coordinator.dispose().then(() => {
    disposed = true;
  });
  await Promise.resolve();
  assert.equal(disposed, false);
  finishSave();
  await disposal;

  assert.deepEqual(events, []);
  assert.equal(coordinator.schedule({ session: { id: 's2' } }), null);
});
