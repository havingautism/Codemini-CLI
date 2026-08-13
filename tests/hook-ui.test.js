import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHookSegmentEvent,
  isHookSegment,
  parseLegacyHookSegmentName,
} from '../codemini-web/shared/hook-ui.js';

test('buildHookSegmentEvent keeps a stable match key and structured fields', () => {
  const event = buildHookSegmentEvent({
    event: 'PreToolUse',
    name: 'quality',
    source: 'skill',
    toolName: 'run',
    command: 'lint.mjs',
  });
  assert.equal(event.kind, 'hook');
  assert.equal(event.event, 'PreToolUse');
  assert.equal(event.sourceLabel, 'quality');
  assert.equal(event.toolName, 'run');
  assert.equal(event.name, 'PreToolUse::quality::run');
  assert.equal(isHookSegment(event), true);
});

test('parseLegacyHookSegmentName recovers event info from old summaries', () => {
  assert.deepEqual(
    parseLegacyHookSegmentName('UserPromptSubmit ← package-hooks-smoke'),
    {
      event: 'UserPromptSubmit',
      toolName: '',
      sourceLabel: 'package-hooks-smoke',
    },
  );
  assert.deepEqual(
    parseLegacyHookSegmentName('PreToolUse · run ← quality'),
    {
      event: 'PreToolUse',
      toolName: 'run',
      sourceLabel: 'quality',
    },
  );
});
