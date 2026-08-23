import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreMemoryHit } from '../src/core/memory-ranker.js';

test('ranking prefers lexical match plus verified recovery utility', () => {
  const base = {
    lexicalScore: 0.8,
    scopeScore: 1,
    familyScore: 1,
    confidence: 0.9,
    utilityScore: 0.5,
    recencyScore: 0.5,
    verifiedRecovery: false
  };
  const plain = scoreMemoryHit(base);
  const verified = scoreMemoryHit({ ...base, verifiedRecovery: true, utilityScore: 0.9 });
  assert.ok(verified > plain);
});

test('ranking is a weighted mix not just recency', () => {
  const lexical = scoreMemoryHit({
    lexicalScore: 1,
    scopeScore: 1,
    familyScore: 1,
    confidence: 0.5,
    utilityScore: 0.5,
    recencyScore: 0.1
  });
  const recentOnly = scoreMemoryHit({
    lexicalScore: 0.1,
    scopeScore: 0.2,
    familyScore: 0.2,
    confidence: 0.5,
    utilityScore: 0.5,
    recencyScore: 1
  });
  assert.ok(lexical > recentOnly);
});
