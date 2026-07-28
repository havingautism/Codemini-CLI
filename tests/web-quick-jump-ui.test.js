import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const chatPanel = fs.readFileSync(
  new URL("../codemini-web/client/src/components/ChatPanel.jsx", import.meta.url),
  "utf8",
);

test("quick jump uses accessible navigation with practical pointer targets", () => {
  assert.match(chatPanel, /<nav\s+aria-label=\{t\("quickJump"\)\}/);
  assert.match(chatPanel, /onFocusCapture=\{handleFocusCapture\}/);
  assert.match(chatPanel, /onBlurCapture=\{handleBlurCapture\}/);
  assert.match(chatPanel, /aria-current=\{i === activeNavIndex \? "location" : undefined\}/);
  assert.match(chatPanel, /className="group flex h-4 w-7 cursor-pointer/);
  assert.doesNotMatch(chatPanel, /gap-6/);
});

test("expanded quick jump shows position and question previews without a hard border", () => {
  assert.match(chatPanel, /t\("quickJumpPosition"\)/);
  assert.match(chatPanel, /max-h-\[60vh\] w-48 overflow-hidden rounded-xl/);
  assert.match(chatPanel, /flex max-h-\[calc\(60vh-2\.25rem\)\] flex-col gap-1/);
  assert.match(chatPanel, /shadow-\[var\(--shadow-elevated\)\] backdrop-blur-xl/);
  assert.doesNotMatch(
    chatPanel,
    /rounded-lg bg-\(--bg-primary\) border border-\(--border-default\)/,
  );
});

test("quick jump reports the final question when scrolling is clamped at the bottom", () => {
  assert.match(chatPanel, /const isAtTop = el\.scrollTop <= 2/);
  assert.match(
    chatPanel,
    /el\.scrollTop \+ el\.clientHeight >= el\.scrollHeight - 2/,
  );
  assert.match(chatPanel, /getActiveMessageIndex\(\{/);
  assert.match(chatPanel, /isAtTop,/);
  assert.match(chatPanel, /isAtBottom,/);
  assert.match(chatPanel, /setActiveNavIndex\(targetIndex\)/);
});
