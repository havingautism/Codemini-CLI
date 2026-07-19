import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isViewportAtEnd,
  syncViewportAfterResize
} from '../codemini-web/client/src/components/ui/message-scroller-follow.js';

function viewport({ scrollTop, scrollHeight, clientHeight }) {
  return { scrollTop, scrollHeight, clientHeight };
}

test('content growth follows the end when the user was already at the bottom', () => {
  const node = viewport({ scrollTop: 600, scrollHeight: 1200, clientHeight: 400 });

  syncViewportAfterResize(node, true);

  assert.equal(node.scrollTop, 800);
  assert.equal(isViewportAtEnd(node), true);
});

test('content growth preserves position after the user scrolls away from the bottom', () => {
  const node = viewport({ scrollTop: 420, scrollHeight: 1200, clientHeight: 400 });

  syncViewportAfterResize(node, false);

  assert.equal(node.scrollTop, 420);
  assert.equal(isViewportAtEnd(node), false);
});
