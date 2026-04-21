import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInterToolNotice,
  buildPreToolNotice,
  buildSyntheticCompletionText,
  collapseActivityChainRows,
  ensureCodeGenerationTiming,
  findActivityUpdateIndex,
  formatMarkdownTableBlock,
  formatSuggestionDescription,
  getCodeGenerationActivityRows,
  getGeneratingCodePlaceholderRows,
  getPendingUserMessageMeta,
  getSuggestionPageState,
  isCodeLikeRow,
  isMarkdownTableHeader,
  isMarkdownTableSeparator,
  isIndexSystemToolName,
  insertRowsAfterLastCodeRow,
  mergeActivitySummary,
  moveSuggestionSelection,
  sanitizeRenderableText,
  shouldRefreshRuntimeStateForEvent,
  normalizeActivitySpacingRows,
  renderMessageRow,
  buildMessageRows,
  shouldAppendAssistantResult,
  shouldShowCompletionFooter,
  splitMessageRows,
  formatActivityDurationText
} from '../src/tui/chat-app.js';

function flattenText(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(flattenText).join('');
  return flattenText(node.props?.children);
}

test('getSuggestionPageState paginates suggestions in fixed-size pages', () => {
  const suggestions = Array.from({ length: 18 }, (_, idx) => `/cmd ${idx + 1}`);
  const state = getSuggestionPageState(suggestions, 9, 8);

  assert.equal(state.pageSize, 8);
  assert.equal(state.pageIndex, 1);
  assert.equal(state.pageCount, 3);
  assert.equal(state.pageStart, 8);
  assert.equal(state.pageItems.length, 8);
  assert.equal(state.pageItems[0], '/cmd 9');
  assert.equal(state.pageItems[7], '/cmd 16');
});

test('moveSuggestionSelection supports left-right page jumps and clamps within bounds', () => {
  assert.equal(moveSuggestionSelection(9, 18, 'left', 8), 1);
  assert.equal(moveSuggestionSelection(1, 18, 'right', 8), 9);
  assert.equal(moveSuggestionSelection(16, 18, 'right', 8), 16);
  assert.equal(moveSuggestionSelection(17, 18, 'right', 8), 17);
  assert.equal(moveSuggestionSelection(0, 18, 'left', 8), 0);
});

test('formatSuggestionDescription trims and ellipsizes long descriptions', () => {
  assert.equal(formatSuggestionDescription('  short help  ', 20), 'short help');
  assert.equal(
    formatSuggestionDescription('This is a much longer description for a suggestion item', 18),
    'This is a much ...'
  );
  assert.equal(formatSuggestionDescription('', 18), '');
});

test('sanitizeRenderableText strips ANSI escape codes and unsafe control characters', () => {
  const raw = 'Error:\u001b[31m boom\u001b[0m\r\nnext\u0007 line\u001b]8;;https://x.example\u0007link\u001b]8;;\u0007';
  assert.equal(sanitizeRenderableText(raw), 'Error: boom\nnext linelink');
});

test('getPendingUserMessageMeta distinguishes submitted turns from queued turns', () => {
  const copy = {
    runtime: {
      localCommandRunning: '正在执行本地命令',
      queuedWaiting: '排队中，等待上一轮完成',
      submittedWaiting: '已提交，等待开始处理',
      sendingToGateway: '正在发送到网关'
    }
  };

  assert.deepEqual(getPendingUserMessageMeta(copy, { immediateLocal: true, inFlight: false }), {
    phase: 'sending',
    liveStatus: '正在执行本地命令'
  });
  assert.deepEqual(getPendingUserMessageMeta(copy, { immediateLocal: false, inFlight: true }), {
    phase: 'queued',
    liveStatus: '排队中，等待上一轮完成'
  });
  assert.deepEqual(getPendingUserMessageMeta(copy, { immediateLocal: false, inFlight: false }), {
    phase: 'sending',
    liveStatus: '已提交，等待开始处理'
  });
});

test('shouldRefreshRuntimeStateForEvent only refreshes on events that can change context progress', () => {
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'assistant:start' }), true);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'assistant:delta' }), true);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'assistant:response' }), true);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'tool:result' }), true);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'compact:auto' }), true);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'tool:start' }), false);
  assert.equal(shouldRefreshRuntimeStateForEvent({ type: 'skill:auto' }), false);
  assert.equal(shouldRefreshRuntimeStateForEvent(null), false);
});

test('findActivityUpdateIndex merges consecutive duplicate read activities', () => {
  const segments = [
    { type: 'text', text: '让我先查看一下文件。' },
    { type: 'tool', name: 'Read(src/App.js)', status: 'done' }
  ];

  assert.equal(
    findActivityUpdateIndex(segments, { type: 'tool', name: 'Read(src/App.js)', status: 'running', id: 'next-read' }),
    1
  );
  assert.equal(
    findActivityUpdateIndex(
      [...segments, { type: 'text', text: '现在我来继续分析。' }],
      { type: 'tool', name: 'Read(src/App.js)', status: 'running', id: 'later-read' }
    ),
    -1
  );
  assert.equal(
    findActivityUpdateIndex(
      [...segments, { type: 'text', text: '   \n' }],
      { type: 'tool', name: 'Read(src/App.js)', status: 'running', id: 'whitespace-read' }
    ),
    1
  );
  assert.equal(
    findActivityUpdateIndex(
      [{ type: 'tool', name: 'Read(README.md)', status: 'done' }],
      { type: 'tool', name: 'Read(README.md)', status: 'running', id: 'raw-read' }
    ),
    0
  );
});

test('mergeActivitySummary preserves metadata and content summaries for merged read activity', () => {
  assert.equal(
    mergeActivitySummary(
      'metadata for README.md lines 1-197 of 197',
      'content from README.md lines 1-197 of 197',
      'Read(README.md)'
    ),
    'metadata for README.md lines 1-197 of 197\ncontent from README.md lines 1-197 of 197'
  );
  assert.equal(
    mergeActivitySummary('metadata for README.md lines 1-197 of 197', 'metadata for README.md lines 1-197 of 197', 'Read(README.md)'),
    'metadata for README.md lines 1-197 of 197'
  );
});

test('normalizeActivitySpacingRows trims blank lines before tools and leaves one gap after tool block', () => {
  const rows = normalizeActivitySpacingRows([
    { kind: 'text', text: '让我先检查一下 src/App.js。', color: 'greenBright' },
    { kind: 'text', text: ' ', color: 'greenBright' },
    { kind: 'text', text: '\n', color: 'greenBright' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/App.js)', status: 'done' },
    { kind: 'activity-summary', text: '└ 读取完成', color: 'gray' },
    { kind: 'text', text: '现在继续检查 CSS 文件。', color: 'greenBright' }
  ]);

  assert.equal(rows.length, 5);
  assert.equal(rows[0].kind, 'text');
  assert.equal(rows[1].kind, 'activity');
  assert.equal(rows[2].kind, 'activity-summary');
  assert.equal(rows[3].kind, 'text');
  assert.equal(rows[3].text, ' ');
  assert.equal(rows[4].kind, 'text');
  assert.equal(rows[4].text, '现在继续检查 CSS 文件。');
});

test('todo-item rows render without extra bottom margin between todos', () => {
  const element = renderMessageRow(
    { id: 'coder-1', label: 'coder' },
    { kind: 'todo-item', status: 'in_progress', text: '重写 README.md' },
    0,
    0
  );

  assert.equal(element.props.marginBottom, undefined);
  assert.equal(element.props.marginLeft, 2);
});

test('tool activity rows render semantic emoji prefixes', () => {
  const readRow = renderMessageRow(
    { id: 'coder-1', label: 'coder' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/App.js)', status: 'done' },
    0,
    0
  );
  const runRow = renderMessageRow(
    { id: 'coder-1', label: 'coder' },
    { kind: 'activity', activityType: 'tool', name: 'Run(npm test)', status: 'done' },
    0,
    0
  );

  assert.match(flattenText(readRow), /📖\s*Read/);
  assert.match(flattenText(runRow), /🧪\s*Test/);
});

test('running tool activity rows animate only on their trailing loader slot', () => {
  const first = renderMessageRow(
    { id: 'coder-1', label: 'coder' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/App.js)', status: 'running' },
    0,
    0
  );
  const second = renderMessageRow(
    { id: 'coder-1', label: 'coder' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/App.js)', status: 'running' },
    0,
    7
  );

  const firstText = flattenText(first);
  const secondText = flattenText(second);
  assert.match(firstText, /📖\s*Read\(src\/App\.js\)/);
  assert.match(secondText, /📖\s*Read\(src\/App\.js\)/);
  assert.notEqual(firstText, secondText);
});

test('status rows animate at the end of the current reply footer', () => {
  const first = renderMessageRow(
    { id: 'coder-1', label: 'coder', phase: 'generating' },
    { kind: 'status', text: '正在生成回复' },
    0,
    0
  );
  const second = renderMessageRow(
    { id: 'coder-1', label: 'coder', phase: 'generating' },
    { kind: 'status', text: '正在生成回复' },
    0,
    3
  );

  const firstText = flattenText(first);
  const secondText = flattenText(second);
  assert.match(firstText, /正在生成回复/);
  assert.match(secondText, /正在生成回复/);
  assert.notEqual(firstText, secondText);
});

test('normalizeActivitySpacingRows inserts a dedicated gap after update_todos items', () => {
  const rows = normalizeActivitySpacingRows([
    { kind: 'activity', activityType: 'tool', name: 'Update Todos', status: 'done' },
    { kind: 'todo-item', status: 'completed', text: '检查核心文件' },
    { kind: 'todo-item', status: 'in_progress', text: '检查测试覆盖率' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/core/chat-runtime.js)', status: 'done' }
  ]);

  assert.equal(rows.length, 5);
  assert.equal(rows[0].kind, 'activity');
  assert.equal(rows[1].kind, 'todo-item');
  assert.equal(rows[2].kind, 'todo-item');
  assert.equal(rows[3].kind, 'todo-gap');
  assert.equal(rows[4].kind, 'activity');
});

test('loading status row stays at the end of the message after code blocks', () => {
  const rows = buildMessageRows(
    {
      id: 'coder-1',
      label: 'coder',
      loading: true,
      phase: 'generating',
      liveStatus: '正在生成回复',
      text: ['```md', '# 标题', '```', '', '**4. 没有功能**'].join('\n')
    },
    false,
    72,
    {}
  );

  assert.equal(rows.at(-1)?.kind, 'status');
});

test('status rows use grey text styling during reply generation', () => {
  const element = renderMessageRow(
    { id: 'coder-1', label: 'coder', phase: 'generating' },
    { kind: 'status', text: '正在生成回复' },
    0,
    1
  );

  const statusTextNode = element.props.children[1];
  assert.equal(statusTextNode.props.color, 'gray');
  assert.equal(statusTextNode.props.dimColor, true);
});

test('collapseActivityChainRows keeps only the latest three tool activities when collapsed', () => {
  const copy = {
    generic: {
      toolChainCollapsed: (count) => `${count} earlier tool calls hidden, press Ctrl+T to expand`
    }
  };
  const rows = [
    { kind: 'activity', activityType: 'tool', name: 'List(src)', status: 'done' },
    { kind: 'activity-summary', text: 'first', color: 'gray' },
    { kind: 'activity', activityType: 'tool', name: 'Glob(src/**/*.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/a.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/b.ts)', status: 'done' },
    { kind: 'activity-summary', text: 'last b', color: 'gray' },
    { kind: 'activity', activityType: 'tool', name: 'Edit(src/c.ts)', status: 'done' },
    { kind: 'text', text: 'done', color: 'greenBright' }
  ];

  const collapsed = collapseActivityChainRows(rows, false, copy, 3);

  assert.equal(collapsed[0].kind, 'activity-collapsed');
  assert.match(collapsed[0].text, /2 earlier tool calls hidden/i);
  assert.equal(collapsed[1].name, 'Read(src/a.ts)');
  assert.equal(collapsed[2].name, 'Read(src/b.ts)');
  assert.equal(collapsed[3].kind, 'activity-summary');
  assert.equal(collapsed[4].name, 'Edit(src/c.ts)');
  assert.equal(collapsed[5].kind, 'text');
});

test('collapseActivityChainRows keeps all tool activities when expanded', () => {
  const rows = [
    { kind: 'activity', activityType: 'tool', name: 'List(src)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Glob(src/**/*.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/a.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Edit(src/c.ts)', status: 'done' }
  ];

  const expanded = collapseActivityChainRows(rows, true, { generic: {} }, 3);
  assert.deepEqual(expanded, rows);
});

test('collapseActivityChainRows resets after narrative text and does not collapse across sections', () => {
  const copy = {
    generic: {
      toolChainCollapsed: (count) => `${count} earlier tool calls hidden, press Ctrl+T to expand`
    }
  };
  const rows = [
    { kind: 'activity', activityType: 'tool', name: 'List(src)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Glob(src/**/*.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/a.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/b.ts)', status: 'done' },
    { kind: 'text', text: '先解释一下为什么要这样查找。', color: 'greenBright' },
    { kind: 'activity', activityType: 'tool', name: 'Read(src/c.ts)', status: 'done' },
    { kind: 'activity', activityType: 'tool', name: 'Edit(src/c.ts)', status: 'done' }
  ];

  const collapsed = collapseActivityChainRows(rows, false, copy, 3);

  assert.equal(collapsed[0].kind, 'activity-collapsed');
  assert.match(collapsed[0].text, /1 earlier tool calls hidden/i);
  assert.equal(collapsed[1].name, 'Glob(src/**/*.ts)');
  assert.equal(collapsed[2].name, 'Read(src/a.ts)');
  assert.equal(collapsed[3].name, 'Read(src/b.ts)');
  assert.equal(collapsed[4].kind, 'text');
  assert.equal(collapsed[5].name, 'Read(src/c.ts)');
  assert.equal(collapsed[6].name, 'Edit(src/c.ts)');
});

test('markdown table helpers detect headers and separators', () => {
  assert.equal(isMarkdownTableHeader('| 维度 | Demo | 差距 |', '| --- | --- | --- |'), true);
  assert.equal(isMarkdownTableHeader('| only one cell |', '| --- |'), false);
  assert.equal(isMarkdownTableSeparator('| --- | :---: | ---: |'), true);
  assert.equal(isMarkdownTableSeparator('| value | value |'), false);
});

test('formatMarkdownTableBlock renders compact box-style rows', () => {
  const rows = formatMarkdownTableBlock(
    [
      '| 维度 | 当前CLI | Demo |',
      '| --- | --- | --- |',
      '| 命令数量 | 5个 | 50+个 |',
      '| 集成能力 | 无 | GitHub/OAuth/Slack |'
    ],
    54
  );

  assert.equal(rows[0].kind, 'table-separator');
  assert.match(rows[0].text, /^┌/);
  assert.equal(rows[1].kind, 'table');
  assert.equal(rows[1].isHeader, true);
  assert.match(rows[1].text, /维度/);
  assert.equal(rows[2].kind, 'table-separator');
  assert.match(rows[2].text, /^├/);
  assert.equal(rows[3].kind, 'table');
  assert.match(rows[3].text, /命令数量/);
  assert.match(rows[5].text, /GitHub/);
  assert.equal(rows.at(-1)?.kind, 'table-separator');
  assert.match(rows.at(-1)?.text || '', /^└/);
});

test('formatMarkdownTableBlock falls back to vertical rows for narrow layouts', () => {
  const rows = formatMarkdownTableBlock(
    [
      '| 维度 | 当前CLI | Demo |',
      '| --- | --- | --- |',
      '| 集成能力 | 无 | GitHub OAuth Slack integrations with many external services |'
    ],
    24
  );

  assert.equal(rows[0].kind, 'table-vertical');
  assert.equal(rows[0].label, '维度');
  assert.equal(rows[1].kind, 'table-vertical');
  assert.equal(rows[1].label, '当前CLI');
  assert.equal(rows[2].kind, 'table-vertical');
  assert.equal(rows[2].label, 'Demo');
  assert.ok(rows.some((row) => row.kind === 'table-vertical-continuation'));
});

test('formatMarkdownTableBlock treats CJK content as wide and avoids overflowing box rows', () => {
  const rows = formatMarkdownTableBlock(
    [
      '| 项目 | 说明 |',
      '| --- | --- |',
      '| **定位** | 为小模型工作流优化的编码助手 CLI，专注 Windows 和 PowerShell 环境 |'
    ],
    48
  );

  const horizontal = rows.filter((row) => row.kind === 'table' || row.kind === 'table-separator');
  const vertical = rows.filter((row) => String(row.kind).startsWith('table-vertical'));

  assert.ok(horizontal.length > 0 || vertical.length > 0);
});

test('formatMarkdownTableBlock keeps a medium-width three-column table horizontal', () => {
  const rows = formatMarkdownTableBlock(
    [
      '| 章节 | 关键点 | 详细说明 |',
      '| --- | --- | --- |',
      '| **文档入口** | 相关文档 | `OPERATIONS.md`（操作手册）、`deployment.md`（打包部署） |',
      '| **项目索引** | 索引文件 | `project-map.json`（项目骨架）、`file-index.json`（文件级结构） |'
    ],
    88
  );

  assert.equal(rows.some((row) => row.kind === 'table-vertical'), false);
  assert.equal(rows[0].kind, 'table-separator');
  assert.equal(rows[1].kind, 'table');
  assert.match(rows[1].text, /章节/);
});

test('isCodeLikeRow classifies tool, code, summary, and status rows together', () => {
  assert.equal(isCodeLikeRow({ kind: 'activity' }), true);
  assert.equal(isCodeLikeRow({ kind: 'activity-summary' }), true);
  assert.equal(isCodeLikeRow({ kind: 'code' }), true);
  assert.equal(isCodeLikeRow({ kind: 'status' }), true);
  assert.equal(isCodeLikeRow({ kind: 'text' }), false);
});

test('splitMessageRows separates narrative text from code-like activity rows', () => {
  const rows = [
    { kind: 'text', text: '先读取文件。', color: 'greenBright' },
    { kind: 'activity', activityType: 'tool', name: 'Write(src/App.js)', status: 'running' },
    { kind: 'activity-summary', text: '准备写入', color: 'gray' },
    { kind: 'status', text: '正在生成代码中' },
    { kind: 'code', text: 'const a = 1;' },
    { kind: 'quote', text: '> note', color: 'yellow' }
  ];

  const { textRows, codeRows } = splitMessageRows(rows);

  assert.deepEqual(textRows.map((row) => row.kind), ['text', 'quote']);
  assert.deepEqual(codeRows.map((row) => row.kind), ['activity', 'activity-summary', 'status', 'code']);
});

test('insertRowsAfterLastCodeRow can place synthetic preview rows after the last code row when used directly', () => {
  const rows = [
    { kind: 'text', text: '先写代码。', color: 'greenBright' },
    { kind: 'code', text: 'const answer = 42;' },
    { kind: 'text', text: '然后再补一句说明。', color: 'greenBright' }
  ];
  const inserted = insertRowsAfterLastCodeRow(rows, [
    { kind: 'activity', name: 'Code generation', status: 'running' },
    { kind: 'code-placeholder', lineNo: 1, text: 'const answer = 42;' }
  ]);

  assert.deepEqual(inserted.map((row) => row.kind), ['text', 'code', 'activity', 'code-placeholder', 'text']);
});

test('insertRowsAfterLastCodeRow treats code-placeholder as the last code anchor', () => {
  const rows = [
    { kind: 'text', text: '先写代码。', color: 'greenBright' },
    { kind: 'code-placeholder', lineNo: 1, text: 'const answer = 42;' },
    { kind: 'text', text: '然后再补一句说明。', color: 'greenBright' }
  ];
  const inserted = insertRowsAfterLastCodeRow(rows, [
    { kind: 'activity', name: 'Code generation', status: 'running' }
  ]);

  assert.deepEqual(inserted.map((row) => row.kind), ['text', 'code-placeholder', 'activity', 'text']);
});

test('isIndexSystemToolName matches index system tool events', () => {
  assert.equal(isIndexSystemToolName('project_index(.codemini-project/project-map.json,.codemini-project/file-index.json)'), true);
  assert.equal(isIndexSystemToolName('file_index(src/app.ts)'), true);
  assert.equal(isIndexSystemToolName('read(src/app.ts)'), false);
});

test('shouldShowCompletionFooter only shows for completed coder replies', () => {
  assert.equal(shouldShowCompletionFooter({ label: 'coder', loading: false, phase: undefined }), true);
  assert.equal(shouldShowCompletionFooter({ label: 'coder', loading: true, phase: 'thinking' }), false);
  assert.equal(shouldShowCompletionFooter({ label: 'system', loading: false, phase: undefined }), false);
});

test('buildPreToolNotice uses a more natural README transition', () => {
  const copy = { roleLabels: { coder: 'CODER', you: 'YOU' } };
  assert.equal(buildPreToolNotice('write(README.md)', copy), 'I\'ll inspect the project structure first, then write the README.');

  const zhCopy = { roleLabels: { coder: '编码器', you: '你' } };
  assert.equal(buildPreToolNotice('write(README.md)', zhCopy), '我先看一下项目内容和结构，再开始写 README。');
});

test('buildPreToolNotice dispatches by exact tool before falling back to shared narration', () => {
  const zhCopy = { roleLabels: { coder: '编码器', you: '你' } };
  assert.equal(buildPreToolNotice('glob(src/**/*.ts)', zhCopy), '我先按模式查找匹配 src/**/*.ts 的文件。');
  assert.equal(buildPreToolNotice('grep(loginUser)', zhCopy), '我先按关键词搜索 loginUser 相关的代码位置。');
  assert.equal(buildPreToolNotice('run(npm test)', zhCopy), '我先执行 npm test，再看一下结果。');

  const enCopy = { roleLabels: { coder: 'CODER', you: 'YOU' } };
  assert.equal(buildPreToolNotice('edit(src/auth/service.ts)', enCopy), 'I\'ll inspect src/auth/service.ts first, then update it.');
});

test('buildSyntheticCompletionText turns silent README tool runs into a natural close', () => {
  const copy = { roleLabels: { coder: '编码器', you: '你' } };
  const text = buildSyntheticCompletionText(
    {
      syntheticPrelude: true,
      segments: [{ type: 'tool', name: 'write(README.md)', status: 'done' }]
    },
    copy
  );
  assert.match(text, /README 已经写好了/);
  assert.match(text, /快速开始|功能概览|使用示例/);
});

test('buildSyntheticCompletionText asks for the next action after read-only exploration', () => {
  const copy = { roleLabels: { coder: 'CODER', you: 'YOU' } };
  const text = buildSyntheticCompletionText(
    {
      syntheticPrelude: true,
      segments: [{ type: 'tool', name: 'read(src/auth.ts)', status: 'done' }]
    },
    copy
  );
  assert.match(text, /make the change next|summarize the findings first/);
});

test('buildInterToolNotice bridges read to README write naturally', () => {
  const copy = { roleLabels: { coder: '编码器', you: '你' } };
  const text = buildInterToolNotice({ name: 'read(package.json)', status: 'done' }, 'write(README.md)', copy);
  assert.equal(text, '相关内容我已经看过了，现在开始写 README。');
});

test('buildInterToolNotice bridges read to edit with explicit target', () => {
  const copy = { roleLabels: { coder: 'CODER', you: 'YOU' } };
  const text = buildInterToolNotice({ name: 'grep(loginUser)', status: 'done' }, 'edit(src/auth/service.ts)', copy);
  assert.match(text, /update src\/auth\/service\.ts\./);
});

test('buildInterToolNotice uses the next tool presenter for run to write transitions', () => {
  const copy = { roleLabels: { coder: '编码器', you: '你' } };
  const text = buildInterToolNotice({ name: 'run(npm test)', status: 'done' }, 'write(README.md)', copy);
  assert.equal(text, '结果我已经拿到了，现在开始写 README。');
});

test('getGeneratingCodePlaceholderRows returns grey placeholder rows only while generating code', () => {
  const copy = { runtime: { generatingCode: '正在生成代码中' } };

  const rows = getGeneratingCodePlaceholderRows({ loading: true, phase: 'generating', liveStatus: '正在生成代码中' }, copy, 60);
  assert.equal(rows.length, 0);
  assert.equal(
    getGeneratingCodePlaceholderRows({ loading: true, phase: 'thinking', liveStatus: '正在生成代码中' }, copy, 60).length,
    0
  );
  assert.equal(
    getGeneratingCodePlaceholderRows({ loading: true, phase: 'generating', liveStatus: '正在生成回复' }, copy, 60).length,
    0
  );

  const proseOnlyRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'generating',
      liveStatus: '正在生成代码中',
      text: '我来为你创建weather文件夹和一个简单的天气展示HTML文件。'
    },
    copy,
    60
  );
  assert.equal(proseOnlyRows.length, 0);

  const previewRowsFromToolArgs = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      toolCalls: [
        {
          type: 'tool',
          name: 'write(weather/index.html)',
          status: 'running',
          arguments: {
            path: 'weather/index.html',
            content: ['<main>', '  <h1>Hello</h1>', '</main>'].join('\n')
          }
        }
      ]
    },
    copy,
    60
  );
  assert.deepEqual(previewRowsFromToolArgs.map((row) => row.text), ['<main>', '  <h1>Hello</h1>', '</main>']);

  const previewRowsFromRawToolArgs = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      pendingToolCalls: [
        {
          type: 'tool',
          name: 'write(weather/index.html)',
          status: 'pending',
          arguments:
            '{"path":"weather/index.html","content":"<!DOCTYPE html>\\n<html>\\n  <body>\\n    <h1>Hello</h1>\\n  </body>\\n</html>'
        }
      ]
    },
    copy,
    60
  );
  assert.deepEqual(previewRowsFromRawToolArgs.map((row) => row.text), ['    <h1>Hello</h1>', '  </body>', '</html>']);
  assert.deepEqual(previewRowsFromRawToolArgs.map((row) => row.lineNo), [4, 5, 6]);

  const previewRowsPreferPendingCall = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      pendingToolCalls: [
        {
          type: 'tool',
          name: 'write(src/algorithms/bucketSort.js)',
          status: 'pending',
          arguments:
            '{"path":"src/algorithms/bucketSort.js","content":"export function bucketSort(arr) {\\n  return [...arr].sort((a, b) => a - b);\\n}"}'
        }
      ],
      toolCalls: [
        {
          type: 'tool',
          name: 'write(tests/bucketSort.test.js)',
          status: 'done',
          arguments: {
            path: 'tests/bucketSort.test.js',
            content: 'expect(sorted).toEqual([0.57, 1.41, 2.23]);\n});\n});'
          }
        }
      ]
    },
    copy,
    60
  );
  assert.deepEqual(previewRowsPreferPendingCall.map((row) => row.text), [
    'export function bucketSort(arr) {',
    '  return [...arr].sort((a, b) => a - b);',
    '}'
  ]);

  const noPreviewRowsWhenPendingHasNoContent = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      pendingToolCalls: [
        {
          type: 'tool',
          name: 'write(src/algorithms/bucketSort.js)',
          status: 'pending',
          arguments: '{"path":"src/algorithms/bucketSort.js"}'
        }
      ],
      toolCalls: [
        {
          type: 'tool',
          name: 'write(tests/bucketSort.test.js)',
          status: 'done',
          arguments: {
            path: 'tests/bucketSort.test.js',
            content: 'expect(sorted).toEqual([0.57, 1.41, 2.23]);\n});\n});'
          }
        }
      ]
    },
    copy,
    60
  );
  assert.equal(noPreviewRowsWhenPendingHasNoContent.length, 0);

  const noFallbackToOlderPendingRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      pendingToolCalls: [
        {
          type: 'tool',
          name: 'write(src/algorithms/bucketSort.js)',
          status: 'pending',
          arguments:
            '{"path":"src/algorithms/bucketSort.js","content":"export function bucketSort(arr) {\\n  return [...arr].sort((a, b) => a - b);\\n}"}'
        },
        {
          type: 'tool',
          name: 'write(tests/bucketSort.test.js)',
          status: 'pending',
          arguments: '{"path":"tests/bucketSort.test.js"}'
        }
      ]
    },
    copy,
    60
  );
  assert.equal(noFallbackToOlderPendingRows.length, 0);

  const latestPendingWinsRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      pendingToolCalls: [
        {
          type: 'tool',
          name: 'write(src/algorithms/bucketSort.js)',
          status: 'pending',
          arguments:
            '{"path":"src/algorithms/bucketSort.js","content":"export function bucketSort(arr) {\\n  return [...arr].sort((a, b) => a - b);\\n}"}'
        },
        {
          type: 'tool',
          name: 'write(tests/bucketSort.test.js)',
          status: 'pending',
          arguments:
            '{"path":"tests/bucketSort.test.js","content":"import test from node:test;\\n\\ntest(\\"bucketSort\\", () => {\\n  assert.equal(1, 1);\\n});"}'
        }
      ]
    },
    copy,
    60
  );
  assert.deepEqual(latestPendingWinsRows.map((row) => row.text), [
    'test("bucketSort", () => {',
    '  assert.equal(1, 1);',
    '});'
  ]);

  const longPreviewRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      toolCalls: [
        {
          type: 'tool',
          name: 'write(weather/index.html)',
          status: 'running',
          arguments: {
            content: 'const veryLongLine = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz";'
          }
        }
      ]
    },
    copy,
    60
  );
  assert.equal(longPreviewRows.length, 1);
  assert.equal(longPreviewRows[0].text.endsWith('...'), true);

  const runningWritePreviewRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在写入文件',
      toolCalls: [
        {
          type: 'tool',
          name: 'write(src/algorithms/bucketSort.js)',
          status: 'running',
          arguments: {
            path: 'src/algorithms/bucketSort.js',
            content: 'export function bucketSort(arr) {\n  return [...arr].sort((a, b) => a - b);\n}'
          }
        }
      ]
    },
    copy,
    60
  );
  assert.deepEqual(runningWritePreviewRows.map((row) => row.text), [
    'export function bucketSort(arr) {',
    '  return [...arr].sort((a, b) => a - b);',
    '}'
  ]);
  assert.deepEqual(runningWritePreviewRows.map((row) => row.lineNo), [1, 2, 3]);

  const proseOnlyToolRows = getGeneratingCodePlaceholderRows(
    {
      loading: true,
      phase: 'tooling',
      liveStatus: '正在生成代码中',
      text: '我来创建一个简单页面。'
    },
    copy,
    60
  );
  assert.equal(proseOnlyToolRows.length, 0);
});

test('getCodeGenerationActivityRows returns a tool-like timer row while code generation is active', () => {
  const active = getCodeGenerationActivityRows({ loading: true, codeGenerationStartedAt: 1000 });
  assert.equal(active.length, 1);
  assert.equal(active[0].kind, 'activity');
  assert.equal(active[0].name, 'Code generation');
  assert.equal(active[0].status, 'running');
  assert.equal(active[0].durationMs >= 0, true);

  const done = getCodeGenerationActivityRows({ loading: true, codeGenerationStartedAt: 1000, codeGenerationEndedAt: 2500 });
  assert.equal(done.length, 0);

  const closed = getCodeGenerationActivityRows({ loading: false, codeGenerationStartedAt: 1000, codeGenerationEndedAt: 2500 });
  assert.equal(closed.length, 0);
});

test('ensureCodeGenerationTiming only sets the start time once', () => {
  const started = ensureCodeGenerationTiming({ id: 'm-1' }, 1000);
  assert.equal(started.codeGenerationStartedAt, 1000);

  const preserved = ensureCodeGenerationTiming(started, 2500);
  assert.equal(preserved.codeGenerationStartedAt, 1000);
});

test('shouldAppendAssistantResult skips duplicate final assistant append while streaming bubble is active', () => {
  assert.equal(shouldAppendAssistantResult({ type: 'assistant', text: 'done' }, 'm-1'), false);
  assert.equal(shouldAppendAssistantResult({ type: 'assistant', text: 'done' }, '', true), false);
  assert.equal(shouldAppendAssistantResult({ type: 'assistant', text: 'done' }, ''), true);
  assert.equal(shouldAppendAssistantResult({ type: 'system', text: 'note' }, 'm-1'), true);
});

test('formatActivityDurationText uses live elapsed time for running activities', () => {
  assert.equal(formatActivityDurationText({ status: 'running', startedAt: 1000 }, 2500), '1.5s');
  assert.equal(formatActivityDurationText({ status: 'done', durationMs: 2500 }), '2.5s');
});
