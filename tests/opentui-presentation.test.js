import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getAnimatedStatusGlyph,
  getInlineStatusText,
  isBlankSystemMessage,
  shouldHideMessageBubble,
  shouldRenderPlainSystemNotice
} from '../src/tui/opentui/presentation.js';

test('isBlankSystemMessage detects empty startup rows that should not render', () => {
  assert.equal(isBlankSystemMessage({ label: 'system', text: '' }), true);
  assert.equal(isBlankSystemMessage({ label: 'system', text: '  ' }), true);
  assert.equal(isBlankSystemMessage({ label: 'system', text: 'use /help' }), false);
  assert.equal(isBlankSystemMessage({ label: 'coder', text: '' }), false);
});

test('shouldRenderPlainSystemNotice keeps simple startup hints but removes chrome', () => {
  assert.equal(
    shouldRenderPlainSystemNotice(
      { label: 'system', text: '使用 /help 可查看命令帮助。' },
      [{ kind: 'text', text: '使用 /help 可查看命令帮助。' }]
    ),
    true
  );
  assert.equal(
    shouldRenderPlainSystemNotice(
      { label: 'system', text: '' },
      []
    ),
    false
  );
});

test('shouldHideMessageBubble removes empty system bubbles even when they survive message creation', () => {
  assert.equal(shouldHideMessageBubble({ label: 'system', text: '' }, []), true);
  assert.equal(shouldHideMessageBubble({ label: 'system', text: '提示' }, []), true);
  assert.equal(shouldHideMessageBubble({ label: 'you', text: '你好' }, []), false);
  assert.equal(
    shouldHideMessageBubble({ label: 'system', text: '提示' }, [{ kind: 'text', text: '提示' }]),
    false
  );
});

test('getInlineStatusText formats idle and busy states for the tool summary row', () => {
  const copy = {
    generic: { idle: '空闲' },
    stageTags: { running: '运行中' }
  };

  assert.equal(getInlineStatusText({ busy: false, copy }), '状态：空闲');
  assert.equal(getInlineStatusText({ busy: true, copy }), '状态：运行中');
});

test('getAnimatedStatusGlyph cycles through spinner frames', () => {
  assert.equal(getAnimatedStatusGlyph(0), '⠋');
  assert.equal(getAnimatedStatusGlyph(1), '⠙');
  assert.equal(getAnimatedStatusGlyph(9), '⠏');
  assert.equal(getAnimatedStatusGlyph(10), '⠋');
});
