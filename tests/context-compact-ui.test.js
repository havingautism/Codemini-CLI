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
const tui = readFileSync(new URL('../src/tui/opencode-chat-app.js', import.meta.url), 'utf8');

function sliceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0, `missing ${start}`);
  assert.ok(to > from, `missing ${end}`);
  return source.slice(from, to);
}

test('compact in-progress copy is the live auto-compact status', () => {
  assert.match(en, /runtimeActivityCompacting:\s*"Auto-compacting…"/);
  assert.match(zh, /runtimeActivityCompacting:\s*"自动压缩中…"/);
  assert.match(en, /compactDividerLead:\s*"Context compacted"/);
  assert.match(zh, /compactDividerLead:\s*"已压缩上下文"/);
  assert.match(en, /compactModePrune:\s*"prune"/);
  assert.match(zh, /compactModeSummary:\s*"摘要"/);

  const startCase = sliceBetween(app, 'case "compact:start"', 'case "compact:auto"');
  assert.match(startCase, /t\("runtimeActivityCompacting"\)/);
  assert.doesNotMatch(startCase, /duringTurn/);
  assert.doesNotMatch(startCase, /micro|macro|conservative|aggressive/);

  assert.match(loop, /type: 'compact:start'/);
  assert.match(loop, /COMPACT_START_SUMMARY/);
  assert.match(runtime, /emitCompactStart\(false\)/);
  assert.match(runtime, /onStart: \(\) => emitCompactStart\(false\)/);
  assert.match(tui, /copy\.compacting/);
});

test('finished compact divider shows one before/after line with the mode', () => {
  const autoCase = sliceBetween(app, 'case "compact:auto"', 'case "compact:aggressive-prune"');
  assert.match(autoCase, /t\("runtimeActivityCompactDone"\)/);
  assert.match(autoCase, /beforePct: event\.beforePct/);
  assert.match(autoCase, /afterPct: event\.afterPct/);
  assert.match(autoCase, /compactMode: event\.mode/);
  assert.doesNotMatch(autoCase, /以上内容已压缩 \(/);

  const bridgeCase = sliceBetween(bridge, "case 'compact:auto'", "case 'compact:aggressive-prune'");
  assert.match(bridgeCase, /event\.summary \|\| '已压缩上下文'/);
  assert.match(bridgeCase, /beforePct: event\.beforePct/);
  assert.doesNotMatch(bridgeCase, /duringTurn/);

  assert.match(runtime, /summary: summary \|\| COMPACT_DONE_SUMMARY/);
  assert.doesNotMatch(runtime, /以上内容已压缩 \(\$\{inflight\.mode\}/);
  assert.match(loop, /summary: inflight\.summary/);
  assert.doesNotMatch(loop, /本轮中已压缩 \(\$\{inflight\.mode\}/);
  assert.match(bubble, /t\("compactDividerLead"\)/);
  assert.match(bubble, /compactModePrune/);
  assert.match(bubble, /% → /);
});

test('compact completion immediately broadcasts runtime state for the CTX meter', () => {
  assert.match(bridge, /event\?\.type === 'compact:auto'/);
  assert.match(bridge, /#broadcastRuntimeState\(\)/);
  assert.match(runtime, /recordCompactContextEstimate/);
  assert.match(runtime, /useCompactEstimate/);
  assert.match(runtime, /Number\.isFinite\(raw\) && raw >= 0/);
});
