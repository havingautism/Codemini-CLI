import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildExecutionModePromptBlock,
  classifyAutoRoute,
} from '../src/core/chat-runtime.js';

const chatRuntimeSource = readFileSync(
  new URL('../src/core/chat-runtime.js', import.meta.url),
  'utf8',
);

test('classifyAutoRoute suggests discuss for brainstorm requests', () => {
  const route = classifyAutoRoute('先讨论一下登录鉴权要怎么设计');
  assert.equal(route.mode, 'brainstorm');
});

test('classifyAutoRoute does not prescribe a workflow for complex work', () => {
  const route = classifyAutoRoute(
    'Add authentication workflow with session state, database migration, and API endpoint integration across multiple files'
  );
  assert.equal(route.complexity, 'complex');
  assert.equal('suggested' in route, false);
});

test('classifyAutoRoute suggests direct for localized edits', () => {
  const route = classifyAutoRoute('Fix the typo in README.md');
  assert.equal(route.mode, 'direct');
  assert.equal('suggested' in route, false);
});

test('coding prompt keeps subagent delegation bounded and parent-owned', () => {
  const prompt = buildExecutionModePromptBlock('coding');
  assert.match(prompt, /bounded, independently verifiable chunk/);
  assert.match(prompt, /parent agent owns decomposition, integration, and the final answer/);
  assert.match(prompt, /configured Lite\/Fast model/);
});

test('run_subagent UI receives the complete task instead of a clipped label', () => {
  assert.match(chatRuntimeSource, /goal:\s*taskPrompt/);
  assert.doesNotMatch(chatRuntimeSource, /trimInline\(taskPrompt,\s*96\)/);
  assert.match(buildExecutionModePromptBlock('coding'), /one- or two-sentence summary/);
});

test('coding prompt creates design docs only for material decisions', () => {
  const prompt = buildExecutionModePromptBlock('coding');
  assert.match(prompt, /only when implementation is blocked by a material product\/architecture decision/);
  assert.match(prompt, /Do not create a design document for routine fixes/);
  assert.match(prompt, /wait for confirmation before implementing those material choices/);
});
