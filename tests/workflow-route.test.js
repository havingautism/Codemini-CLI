import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildPreviousTurnToolTrace,
  buildExecutionModePromptBlock,
  classifyAutoRoute,
  classifyTaskDimensions,
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

test('classifyTaskDimensions exposes routing axes instead of a single score', () => {
  const discussion = classifyTaskDimensions('先讨论一下登录鉴权要怎么设计');
  assert.equal(discussion.discussion, true);
  assert.equal(discussion.implementation, true);

  const typo = classifyTaskDimensions('Fix the typo in README.md');
  assert.equal(typo.complexity, 'simple');
  assert.equal(typo.localized, true);
  assert.equal(typo.implementation, false);

  const complex = classifyTaskDimensions(
    'Add authentication workflow with session state, database migration, and API endpoint integration across multiple files'
  );
  assert.equal(complex.complexity, 'complex');
  assert.equal(complex.multiFile, true);
  assert.equal(complex.architecture, true);
  assert.equal(complex.implementation, true);
});

test('coding prompt keeps subagent delegation bounded and parent-owned', () => {
  const prompt = buildExecutionModePromptBlock('coding');
  assert.match(prompt, /bounded, independently verifiable chunk/);
  assert.match(prompt, /parent agent owns decomposition, integration, and the final answer/);
  assert.match(prompt, /configured Lite\/Fast model/);
  assert.match(prompt, /Prefer delegation for non-trivial coding work/);
  assert.doesNotMatch(prompt, /Default: do the work yourself/);
  assert.doesNotMatch(prompt, /Do not call run_subagent for a simple localized edit/);
});

test('previous-turn trace stops at the latest user boundary', () => {
  const trace = buildPreviousTurnToolTrace({ messages: [
    { role: 'user', content: 'old task' },
    { role: 'assistant', tool_calls: [{ function: { name: 'edit' } }, { function: { name: 'write' } }] },
    { role: 'user', content: 'new unrelated task' },
    { role: 'assistant', tool_calls: [{ function: { name: 'read' } }] },
  ] });
  assert.deepEqual(trace, { recentTools: ['read'], editCount: 0 });
});

test('coding prompt actively uses structured user input for material choices', () => {
  const prompt = buildExecutionModePromptBlock('coding');
  assert.match(prompt, /User input workflow:/);
  assert.match(prompt, /structured form/);
  assert.match(prompt, /substantially improve the usefulness or fit/);
  assert.match(prompt, /inspect first/i);
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

test('coding prompt describes the platform-specific write tools', () => {
  const unixPrompt = buildExecutionModePromptBlock('coding', 'linux');
  assert.match(unixPrompt, /old_string\/new_string/);
  assert.doesNotMatch(unixPrompt, /apply_patch|staged writes/);

  const windowsPrompt = buildExecutionModePromptBlock('coding', 'win32');
  assert.match(windowsPrompt, /apply_patch/);
  assert.match(windowsPrompt, /begin_write/);
});

test('coding prompt can follow the effective sandbox command platform', () => {
  const vmPrompt = buildExecutionModePromptBlock('coding', 'linux', 'bash');
  assert.match(vmPrompt, /old_string\/new_string/);
  assert.doesNotMatch(vmPrompt, /apply_patch|begin_write/);
  assert.match(
    chatRuntimeSource,
    /resolveExecutionModeAllowedTools\([\s\S]*?executionShellContext\.commandPlatform/,
  );
});

test('execution-mode injections stay compact', () => {
  assert.ok(buildExecutionModePromptBlock('coding', 'win32').length < 3000);
  assert.ok(buildExecutionModePromptBlock('normal', 'win32').length < 1500);
});

test('coding mode does not expose legacy update_plan without existing plan state', () => {
  assert.match(
    chatRuntimeSource,
    /const exposeUpdatePlan = Boolean\(currentPlanStateForTools\)/,
  );
  assert.doesNotMatch(
    chatRuntimeSource,
    /const exposeUpdatePlan = normalizedExecutionMode === 'plan'/,
  );
});
