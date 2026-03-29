import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findActivityUpdateIndex,
  formatSuggestionDescription,
  getSuggestionPageState,
  isCodeLikeRow,
  mergeActivitySummary,
  moveSuggestionSelection,
  normalizeActivitySpacingRows,
  splitMessageRows
} from '../src/tui/chat-app.js';

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
