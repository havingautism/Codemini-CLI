import test from 'node:test';
import assert from 'node:assert/strict';

import { scheduleMemoryReviewBacklog, scheduleSessionMemoryReview } from '../src/core/memory-session-review.js';

test('writeback.enabled disables after-turn and backlog review scheduling', () => {
  const config = {
    memory: {
      writeback: { enabled: false },
      background_review: { enabled: true, on_start: true }
    }
  };
  assert.equal(scheduleSessionMemoryReview({ sessionId: 'session-1', config }), false);
  assert.equal(scheduleMemoryReviewBacklog({ config, currentSessionId: 'session-1' }), false);
});
