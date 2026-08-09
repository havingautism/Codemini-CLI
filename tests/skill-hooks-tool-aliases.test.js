import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalToolName,
  rewriteMatcherAliases,
  toolNameCandidates,
} from '../src/core/skill-hooks-tool-aliases.js';
import { matcherAllows } from '../src/core/skill-hooks-session.js';

test('canonicalToolName maps Claude Bash to run', () => {
  assert.equal(canonicalToolName('Bash'), 'run');
  assert.equal(canonicalToolName('Powershell'), 'run');
  assert.equal(canonicalToolName('PowerShell'), 'run');
  assert.equal(canonicalToolName('Read'), 'read');
  assert.equal(canonicalToolName('run'), 'run');
});

test('toolNameCandidates includes Claude aliases for Codemini tools', () => {
  const candidates = toolNameCandidates('run');
  assert.ok(candidates.includes('run'));
  assert.ok(candidates.includes('Bash'));
});

test('matcherAllows: Claude Bash matcher matches Codemini run', () => {
  assert.equal(matcherAllows('Bash', 'run'), true);
  assert.equal(matcherAllows('Read', 'read'), true);
  assert.equal(matcherAllows('Bash', 'read'), false);
});

test('matcherAllows: alternation Bash|Write matches run or write', () => {
  assert.equal(matcherAllows('Bash|Write', 'run'), true);
  assert.equal(matcherAllows('Bash|Write', 'write'), true);
  assert.equal(matcherAllows('Bash|Write', 'grep'), false);
});

test('rewriteMatcherAliases expands Bash to include run', () => {
  const rewritten = rewriteMatcherAliases('Bash');
  assert.ok(rewritten.includes('Bash'));
  assert.ok(rewritten.includes('run'));
});
