import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const bridge = readFileSync(new URL('../codemini-web/lib/runtime-bridge.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../codemini-web/client/src/context/app-context.jsx', import.meta.url), 'utf8');
const en = readFileSync(new URL('../codemini-web/client/i18n/en.js', import.meta.url), 'utf8');
const zh = readFileSync(new URL('../codemini-web/client/i18n/zh.js', import.meta.url), 'utf8');
const loop = readFileSync(new URL('../src/core/agent-loop.js', import.meta.url), 'utf8');
const runtime = readFileSync(new URL('../src/core/chat-runtime.js', import.meta.url), 'utf8');
const bubble = readFileSync(new URL('../codemini-web/client/src/components/MessageBubble.jsx', import.meta.url), 'utf8');

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

test('compact in-progress copy names the context for preflight and mid-turn', () => {
  assert.match(en, /runtimeActivityCompacting:\s*"Compressing context"/);
  assert.match(zh, /runtimeActivityCompacting:\s*"上下文压缩中"/);
  assert.match(en, /compactDivider:\s*"Previous context compacted"/);
  assert.match(zh, /compactDivider:\s*"以上内容已压缩"/);

  const startCase = sliceBetween(app, 'case "compact:start"', 'case "compact:auto"');
  assert.match(startCase, /t\("runtimeActivityCompacting"\)/);
  assert.doesNotMatch(startCase, /duringTurn/);
  assert.doesNotMatch(startCase, /micro|macro|conservative|aggressive/);

  assert.match(loop, /type: 'compact:start'/);
  assert.match(loop, /COMPACT_START_SUMMARY/);
  assert.match(runtime, /emitCompactStart\(false\)/);
  assert.match(runtime, /onStart: \(\) => emitCompactStart\(false\)/);
});

test('finished compact divider omits mode and percentage', () => {
  const autoCase = sliceBetween(app, 'case "compact:auto"', 'case "compact:aggressive-prune"');
  assert.match(autoCase, /t\("runtimeActivityCompactDone"\)/);
  assert.match(autoCase, /t\("compactDivider"\)/);
  assert.doesNotMatch(autoCase, /event\.mode/);
  assert.doesNotMatch(autoCase, /event\.threshold/);
  assert.doesNotMatch(autoCase, /以上内容已压缩 \(/);

  const bridgeCase = sliceBetween(bridge, "case 'compact:auto'", "case 'compact:aggressive-prune'");
  assert.match(bridgeCase, /event\.summary \|\| '以上内容已压缩'/);
  assert.doesNotMatch(bridgeCase, /event\.mode/);
  assert.doesNotMatch(bridgeCase, /event\.threshold/);
  assert.doesNotMatch(bridgeCase, /duringTurn/);

  assert.match(runtime, /summary: COMPACT_DONE_SUMMARY/);
  assert.doesNotMatch(runtime, /以上内容已压缩 \(\$\{inflight\.mode\}/);
  assert.match(loop, /summary: COMPACT_DONE_SUMMARY/);
  assert.doesNotMatch(loop, /本轮中已压缩 \(\$\{inflight\.mode\}/);
  assert.match(app, /text: t\("compactDivider"\)/);
  assert.match(bubble, /t\("compactDivider"\)/);
});

test('compact completion immediately broadcasts runtime state for the CTX meter', () => {
  assert.match(bridge, /event\?\.type === 'compact:auto'/);
  assert.match(bridge, /#broadcastRuntimeState\(\)/);
  assert.match(runtime, /recordCompactContextEstimate/);
  assert.match(runtime, /useCompactEstimate/);
});
