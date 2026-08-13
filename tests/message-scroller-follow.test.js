import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isViewportAtEnd,
  resolveFollowEnd,
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

test('layout scroll while briefly off-end keeps stick-to-bottom intent', () => {
  assert.equal(
    resolveFollowEnd(true, { atEnd: false, isUserDriven: false }),
    true,
  );
});

test('message navigation clears stick-to-bottom intent across the next resize', () => {
  const node = viewport({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
  node.scrollTop = 120;

  const followEnd = resolveFollowEnd(true, {
    atEnd: false,
    isUserDriven: false,
    reason: 'navigation',
  });
  node.scrollHeight = 1100;
  syncViewportAfterResize(node, followEnd);

  assert.equal(followEnd, false);
  assert.equal(node.scrollTop, 120);
});

test('user scroll away from the end clears stick-to-bottom intent', () => {
  assert.equal(
    resolveFollowEnd(true, { atEnd: false, isUserDriven: true }),
    false,
  );
});

test('user scroll back to the end restores stick-to-bottom intent', () => {
  assert.equal(
    resolveFollowEnd(false, { atEnd: true, isUserDriven: true }),
    true,
  );
});

test('loader shrink then grow re-sticks when follow intent is preserved', () => {
  const node = viewport({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(isViewportAtEnd(node), true);

  // Tool loader disappears.
  node.scrollHeight = 950;
  node.scrollTop = 550;
  assert.equal(isViewportAtEnd(node), true);
  assert.equal(
    resolveFollowEnd(true, { atEnd: isViewportAtEnd(node), isUserDriven: false }),
    true,
  );

  // Next tool loader appears — without sync we'd leave a gap.
  node.scrollHeight = 1100;
  assert.equal(isViewportAtEnd(node), false);
  syncViewportAfterResize(node, true);
  assert.equal(node.scrollTop, 700);
  assert.equal(isViewportAtEnd(node), true);
});
