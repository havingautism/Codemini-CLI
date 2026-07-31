import test from 'node:test';
import assert from 'node:assert/strict';

import { getBuiltinTools } from '../src/core/tools.js';
import { researchSubmitDefinitions } from '../src/core/research-runtime.js';

test('default getBuiltinTools does not expose research submit tools', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { web: { search_enabled: false } },
  });
  try {
    const names = (bundle.definitions || []).map((d) => d?.function?.name || d?.name);
    assert.equal(names.includes('submit_research_plan'), false);
    assert.equal(names.includes('submit_research_commit'), false);
    assert.equal(names.includes('submit_research_report'), false);
  } finally {
    bundle.dispose?.();
  }
});

test('research submit definitions are phase-scoped', () => {
  const plan = researchSubmitDefinitions('planning').map((d) => d.function.name);
  assert.deepEqual(plan, ['submit_research_plan']);
  const inv = researchSubmitDefinitions('investigating').map((d) => d.function.name);
  assert.deepEqual(inv, ['submit_research_commit']);
  const write = researchSubmitDefinitions('writing').map((d) => d.function.name);
  assert.deepEqual(write, ['submit_research_report']);
});
