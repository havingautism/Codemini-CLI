import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateMemoryTokens } from '../src/core/memory-token-budget.js';
import {
  budgetRecoveryMemoryItems,
  budgetRetrievedMemoryItems,
  renderRecoveryMemory,
  renderRetrievedMemory
} from '../src/core/memory-retriever.js';
import { composeMemorySnapshot } from '../src/core/memory-prompt.js';
import { rememberMemory } from '../src/core/memory-store.js';
import { withMemoryEnv } from './helpers/memory-env.js';

const hits = [
  { id: 'a', scope: 'project', family: 'coding', kind: 'lesson', summary: 'first lesson', content: 'Use npm test for focused verification.' },
  { id: 'b', scope: 'project', family: 'coding', kind: 'lesson', summary: 'second lesson', content: 'Use npm run build:web for UI verification.' }
];

test('retrieval and recovery budgets retain whole records within token limits', () => {
  const retrievalBudget = estimateMemoryTokens(renderRetrievedMemory([hits[0]]));
  const recoveryBudget = estimateMemoryTokens(renderRecoveryMemory([hits[0]]));
  const retrieved = budgetRetrievedMemoryItems(hits, retrievalBudget);
  const recovered = budgetRecoveryMemoryItems(hits, recoveryBudget);
  assert.deepEqual(retrieved.map((item) => item.id), ['a']);
  assert.deepEqual(recovered.map((item) => item.id), ['a']);
  assert.ok(estimateMemoryTokens(renderRetrievedMemory(hits, { maxTokens: retrievalBudget })) <= retrievalBudget);
  assert.ok(estimateMemoryTokens(renderRecoveryMemory(hits, { maxTokens: recoveryBudget })) <= recoveryBudget);
  assert.doesNotMatch(renderRetrievedMemory(hits, { maxTokens: retrievalBudget }), /\.\.\.$/);
});

test('bootstrap max_tokens limits model-visible profile without character slicing', async () => {
  await withMemoryEnv(async (dir) => {
    for (let index = 0; index < 6; index += 1) {
      await rememberMemory({
        scope: 'project', family: 'repo', kind: 'convention',
        content: `Project convention ${index}: run the exact verification command npm test -- case-${index}.`,
        summary: `verification convention ${index}`, workspaceRoot: dir,
        config: { memory: { max_items_per_scope: 20, max_project_chars: 10000 } }
      });
    }
    const maxTokens = 180;
    const composed = await composeMemorySnapshot({
      workspaceRoot: dir,
      config: {
        memory: {
          enabled: true,
          bootstrap: { enabled: true, max_tokens: maxTokens },
          retrieval: { enabled: false }
        }
      }
    });
    assert.ok(estimateMemoryTokens(composed.text) <= maxTokens);
    assert.ok(composed.inject.profile.length < 6);
    assert.doesNotMatch(composed.text, /\.\.\.$/);
  });
});
