import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatSuggestionDescription,
  getSuggestionPageState,
  moveSuggestionSelection
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
