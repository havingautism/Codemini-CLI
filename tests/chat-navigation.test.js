import assert from "node:assert/strict";
import test from "node:test";

import { getActiveMessageIndex } from "../codemini-web/client/src/lib/chat-navigation.js";

test("the first message remains active while the viewport is clamped at the top", () => {
  assert.equal(
    getActiveMessageIndex({
      viewportTop: 0,
      viewportHeight: 800,
      isAtTop: true,
      isAtBottom: false,
      messageRects: [
        { top: 40, bottom: 120 },
        { top: 250, bottom: 330 },
      ],
    }),
    0,
  );
});

test("a centered jump target becomes the active message", () => {
  assert.equal(
    getActiveMessageIndex({
      viewportTop: 0,
      viewportHeight: 800,
      isAtTop: false,
      isAtBottom: false,
      messageRects: [
        { top: -600, bottom: -520 },
        { top: 360, bottom: 440 },
        { top: 1200, bottom: 1280 },
      ],
    }),
    1,
  );
});

test("the final message remains active when scrolling is clamped at the bottom", () => {
  assert.equal(
    getActiveMessageIndex({
      viewportTop: 0,
      viewportHeight: 800,
      isAtTop: false,
      isAtBottom: true,
      messageRects: [
        { top: -900, bottom: -820 },
        { top: 120, bottom: 200 },
        { top: 680, bottom: 760 },
      ],
    }),
    2,
  );
});
