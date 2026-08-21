import test from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs/promises';

import {
  commitElementPin,
  findPinnedDisclosure,
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

test('disclosure expand undoes stick-to-bottom so the card grows downward', () => {
  const node = viewport({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(isViewportAtEnd(node), true);

  // Stick-to-bottom would keep the last message pinned, lifting the card header
  // from viewport y=200 to y=0. Pinning restores the header's screen position
  // so the extra height appears below the toggle instead of above it.
  node.scrollHeight = 1200;
  node.scrollTop = 800;
  const followEnd = commitElementPin(node, 200, 0);

  assert.equal(node.scrollTop, 600);
  assert.equal(followEnd, false);
  assert.equal(isViewportAtEnd(node), false);
});

test('disclosure expand that stays within the end threshold resumes follow', () => {
  const node = viewport({ scrollTop: 596, scrollHeight: 1000, clientHeight: 400 });
  assert.equal(isViewportAtEnd(node), true);

  node.scrollHeight = 1004;
  node.scrollTop = 600;
  const followEnd = commitElementPin(node, 200, 196);

  assert.equal(node.scrollTop, 596);
  assert.equal(followEnd, true);
});

test('findPinnedDisclosure pins the nearest disclosure wrapper', () => {
  const disclosure = { id: 'card' };
  const toggle = {
    closest(selector) {
      return selector === '.codemini-disclosure' ? disclosure : null;
    },
  };
  const target = {
    closest(selector) {
      return selector === '[aria-expanded]' ? toggle : null;
    },
  };

  assert.equal(findPinnedDisclosure(target), disclosure);
  assert.equal(findPinnedDisclosure({ closest: () => null }), null);
});

test('message scroller pins disclosure toggles before following the end', async () => {
  const src = await fs.readFile(
    'codemini-web/client/src/components/ui/message-scroller.jsx',
    'utf8',
  );
  assert.match(src, /findPinnedDisclosure/);
  assert.match(src, /commitElementPin/);
  assert.match(src, /addEventListener\("click"/);
});
