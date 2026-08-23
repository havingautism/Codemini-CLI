import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodingLessonFromEpisode } from '../src/core/memory-experience-extractor.js';

test('extractor builds a verified lesson with provenance', () => {
  const lesson = buildCodingLessonFromEpisode({
    sessionId: 's1',
    failedApproach: { tool: 'run', argsSummary: 'pnpm exec tsx foo.ts', errorClass: 'command_not_found' },
    workingApproach: { tool: 'run', argsSummary: 'node foo.js' },
    failedCount: 1,
    toolNames: ['run'],
    verificationType: 'test_exit_zero'
  });
  assert.equal(lesson.evidence.verified, true);
  assert.equal(lesson.evidence.successful_recovery, true);
  assert.equal(lesson.evidence.verification.type, 'test_exit_zero');
  assert.equal(lesson.evidence.failed_attempts, 1);
  assert.match(lesson.content, /Failed approach/);
  assert.match(lesson.content, /Verified working approach/);
  assert.match(lesson.semanticKey, /^coding-recovery:/);
  assert.ok(lesson.summary.length <= 120);
});

test('extractor tolerates a missing failed approach', () => {
  const lesson = buildCodingLessonFromEpisode({
    workingApproach: { tool: 'run', argsSummary: 'node foo.js' },
    failedCount: 0,
    toolNames: [],
    verificationType: ''
  });
  assert.equal(lesson.evidence.verified, true);
  assert.ok(lesson.summary.length > 0);
});
