import test from 'node:test';
import assert from 'node:assert/strict';

import { shouldCaptureEscapeSequence } from '../src/tui/input-escape.js';

test('should not treat plain digits as terminal escape sequences', () => {
  assert.equal(shouldCaptureEscapeSequence('1', ''), false);
  assert.equal(shouldCaptureEscapeSequence('2', ''), false);
  assert.equal(shouldCaptureEscapeSequence('3', ''), false);
  assert.equal(shouldCaptureEscapeSequence('5', ''), false);
  assert.equal(shouldCaptureEscapeSequence('9', ''), false);
});

test('should continue capturing only after escape sequence has started', () => {
  assert.equal(shouldCaptureEscapeSequence('\u001b', ''), true);
  assert.equal(shouldCaptureEscapeSequence('[', '\u001b'), true);
  assert.equal(shouldCaptureEscapeSequence('3', '\u001b['), true);
  assert.equal(shouldCaptureEscapeSequence(';', '\u001b[3'), true);
  assert.equal(shouldCaptureEscapeSequence('2', '\u001b[3;'), true);
  assert.equal(shouldCaptureEscapeSequence('~', '\u001b[3'), true);
  assert.equal(shouldCaptureEscapeSequence('~', '\u001b[3;2'), true);
  assert.equal(shouldCaptureEscapeSequence('~', '\u001b[3;5'), true);
});

test('should reject invalid escape-sequence continuations so normal input is not swallowed', () => {
  assert.equal(shouldCaptureEscapeSequence('1', '\u001b'), false);
  assert.equal(shouldCaptureEscapeSequence('9', '\u001b['), false);
  assert.equal(shouldCaptureEscapeSequence('4', '\u001b[3'), false);
  assert.equal(shouldCaptureEscapeSequence('9', '\u001b[3;'), false);
  assert.equal(shouldCaptureEscapeSequence('x', '\u001b[3;2'), false);
});
