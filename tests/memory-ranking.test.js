import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreMemoryHit, retentionScore, verificationSignal } from '../src/core/memory-ranker.js';

test('ranking weights BM25 highest, then confidence / verification / recency', () => {
  const strong = scoreMemoryHit({ bm25Score: 1, confidence: 0.9, verification: 1, recencyScore: 0.8 });
  const weak = scoreMemoryHit({ bm25Score: 0.1, confidence: 0.2, verification: 0, recencyScore: 0.1 });
  assert.ok(strong > weak);
});

test('lexical match dominates; recency alone cannot rescue a bad match', () => {
  const lexical = scoreMemoryHit({ bm25Score: 1, confidence: 0.5, verification: 0, recencyScore: 0.1 });
  const recentOnly = scoreMemoryHit({ bm25Score: 0.1, confidence: 0.5, verification: 0, recencyScore: 1 });
  assert.ok(lexical > recentOnly);
});

test('verification signal only fires on deterministic evidence', () => {
  assert.equal(verificationSignal({ confirmationCount: 1 }), 1);
  assert.equal(verificationSignal({ evidence: { verified: true } }), 1);
  assert.equal(verificationSignal({ evidence: { successful_recovery: true } }), 1);
  assert.equal(verificationSignal({ successCount: 2 }), 0.7);
  assert.equal(verificationSignal({}), 0);
});

test('retention score is confidence plus confirmation freshness, not retrieval mix', () => {
  const cold = retentionScore({ confidence: 1, lastConfirmedAt: '', accessCount: 0 });
  const confirmed = retentionScore({
    confidence: 1,
    lastConfirmedAt: new Date().toISOString(),
    accessCount: 0
  });
  assert.ok(confirmed > cold);
  assert.ok(Math.abs(cold - 0.65) < 0.02);
});
