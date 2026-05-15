/**
 * Test compact summary generation with real API.
 * Set CODEMINI_TEST_API_KEY before running.
 * Usage: node tests/test-compact-summary.mjs
 */
import { compactMessagesLocally, buildTranscriptForLLM, COMPACT_SUMMARY_PROMPT } from '../src/core/context-compact.js';
import { createChatCompletion } from '../src/core/provider/index.js';

const config = {
  sdk: { provider: 'openai-compatible' },
  gateway: {
    base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
    api_key: process.env.CODEMINI_TEST_API_KEY || '',
    timeout_ms: 60000
  },
  model: { name: 'glm-5-turbo', fast_name: 'glm-5-turbo' }
};

function resolveFastModel(cfg) {
  return cfg.model?.fast_name || cfg.model?.lite_name || cfg.model?.name;
}

// Simulate a real conversation with tool calls
const messages = [
  { role: 'user', content: '帮我重构 qurio-coder 项目的侧边栏组件，要求支持项目分组、会话管理和普通会话模式' },
  { role: 'assistant', content: '我来分析一下当前的侧边栏结构，先看看代码。', tool_calls: [{ id: '1', function: { name: 'read_file', arguments: '{"path":"client/src/components/Sidebar.jsx"}' } }] },
  { role: 'tool', content: JSON.stringify({ path: 'client/src/components/Sidebar.jsx', action: 'read', lines: 578, language: 'jsx' }) },
  { role: 'assistant', content: '侧边栏目前有项目分组功能但没有普通会话分组。我需要：\n1. 添加 GENERAL_PROJECT_DIR 标记\n2. 修改 getProjectName 显示"普通会话"\n3. 对普通会话隐藏 CodeWiki 按钮' },
  { role: 'user', content: '普通会话不要显示 git 信息' },
  { role: 'assistant', content: '好的，我在 ChatPanel 里加了 isGeneral 判断，普通会话不渲染 git branch 和 dirty 状态。', tool_calls: [{ id: '2', function: { name: 'edit_file', arguments: '{"path":"client/src/components/ChatPanel.jsx"}' } }] },
  { role: 'tool', content: JSON.stringify({ path: 'client/src/components/ChatPanel.jsx', action: 'edit', changed_lines: 12, summary: 'Added isGeneral conditional rendering' }) },
  { role: 'assistant', content: '还需要处理服务端的 guard，防止普通会话时调用 git 命令导致 Bun crash。', tool_calls: [{ id: '3', function: { name: 'edit_file', arguments: '{"path":"codemini-web/server.js"}' } }] },
  { role: 'tool', content: JSON.stringify({ command: 'bun run dev', code: 0, stdout: 'Server started on port 5000' }) },
  { role: 'user', content: '服务器启动后切换到普通会话 Bun 就 crash 了，看看什么情况' },
  { role: 'assistant', content: '问题是 execSync 调用时 cwd 指向了 __codemini_general__ 这个不存在的目录。在 Windows 上 Bun 会直接 panic 而不是抛出可捕获的错误。需要在 /api/git 和 /api/git-diff 加 early return guard。' },
  { role: 'tool', content: JSON.stringify({ command: 'git status --porcelain', code: 0, stdout: 'M server.js\nM ChatPanel.jsx' }) },
  { role: 'assistant', content: '修复完成。现在 /api/git 和 /api/git-diff 在普通会话模式下会直接返回空结果，不会调用 execSync。' },
  { role: 'user', content: '改为用真实目录 .codemini-global/workspace 替代 __codemini_general__ 标记，这样所有工具都能正常工作' },
  { role: 'assistant', content: '好主意。这样不需要任何 guard，普通会话就是一个真实的工作目录。我来改 server.js 的 GENERAL_PROJECT_DIR 常量和启动逻辑。' },
];

async function generateSummary(olderMessages) {
  const fastModel = resolveFastModel(config);
  if (!fastModel) throw new Error('No fast model');
  const transcript = buildTranscriptForLLM(olderMessages);
  const result = await createChatCompletion({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model: fastModel,
    messages: [
      { role: 'system', content: COMPACT_SUMMARY_PROMPT },
      { role: 'user', content: transcript.slice(0, 12000) }
    ],
    tools: [],
    timeoutMs: 60000,
    maxRetries: 0
  });
  const text = result?.text?.trim();
  if (!text) throw new Error('Empty summary');
  return text;
}

console.log('=== Test 1: Local summary (fallback) ===');
const localResult = await compactMessagesLocally(messages, { mode: 'conservative', force: true });
console.log(localResult.summary);
console.log(`\nTokens: ${localResult.summary.length} chars, ${localResult.compacted.length} messages`);
console.log();

console.log('=== Test 2: LLM summary (real API call) ===');
try {
  const llmResult = await compactMessagesLocally(messages, {
    mode: 'conservative',
    force: true,
    generateSummary
  });
  console.log(llmResult.summary);
  console.log(`\nTokens: ${llmResult.summary.length} chars, ${llmResult.compacted.length} messages`);
} catch (err) {
  console.error('LLM summary failed:', err.message);
}
