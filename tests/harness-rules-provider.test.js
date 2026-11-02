import test from 'node:test';
import assert from 'node:assert/strict';
import { createRulesProvider } from '../src/core/harness/providers/rules.js';

test('rules provider chooses retry for a failed tool and abstains on unknown questions', async () => {
  const provider = createRulesProvider();
  const result = await provider.ask({
    state: { toolError: true },
    questions: [
      { id: 'next_action', type: 'choice', options: ['continue', 'retry_once'] },
      { id: 'unknown', type: 'choice', options: ['x'] }
    ]
  });
  assert.equal(result.answers[0].choice, 'retry_once');
  assert.equal(result.answers[1].abstain, true);
});
