import test from 'node:test';
import assert from 'node:assert/strict';

import { getBuiltinTools } from '../src/core/tools.js';
import { buildLeadSystemPrompt, researchSubmitDefinitions } from '../src/core/research-runtime.js';
import {
  RESEARCH_WEB_FETCH,
  RESEARCH_WEB_SEARCH,
  createResearchWebFetchDefinition,
  createResearchWebSearchDefinition,
} from '../src/core/research-tools.js';

test('default getBuiltinTools does not expose research submit or research web tools', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { web: { search_enabled: false } },
  });
  try {
    const names = (bundle.definitions || []).map((d) => d?.function?.name || d?.name);
    assert.equal(names.includes('submit_research_plan'), false);
    assert.equal(names.includes('submit_research_commit'), false);
    assert.equal(names.includes('submit_research_report'), false);
    assert.equal(names.includes(RESEARCH_WEB_SEARCH), false);
    assert.equal(names.includes(RESEARCH_WEB_FETCH), false);
  } finally {
    bundle.dispose?.();
  }
});

test('research web tools are research-owned definitions', () => {
  const search = createResearchWebSearchDefinition();
  const fetch = createResearchWebFetchDefinition();
  assert.equal(search.function.name, RESEARCH_WEB_SEARCH);
  assert.deepEqual(search.function.parameters.required, ['query', 'criterionId']);
  assert.equal(fetch.function.name, RESEARCH_WEB_FETCH);
  assert.deepEqual(fetch.function.parameters.required, ['url']);
  assert.match(fetch.function.description, /artifactId/);
});

test('research submit definitions are phase-scoped', () => {
  const plan = researchSubmitDefinitions('planning').map((d) => d.function.name);
  assert.deepEqual(plan, ['submit_research_plan']);
  const inv = researchSubmitDefinitions('investigating').map((d) => d.function.name);
  assert.deepEqual(inv, ['submit_research_commit']);
  const write = researchSubmitDefinitions('writing').map((d) => d.function.name);
  assert.deepEqual(write, ['submit_research_report']);
});

test('writing lead prompt follows Codemini reply language only', () => {
  const session = {
    question: 'What changed?',
    budget: {},
    budgetUsed: {},
    plan: { depth: 'standard' },
  };
  const zh = buildLeadSystemPrompt('writing', session, { ui: { reply_language: 'zh' } });
  assert.match(zh, /Simplified Chinese \(Codemini reply-language preference\)/);
  assert.match(zh, /Synthesize claims, summaries, gaps/);
  assert.match(zh, /Attribute factual claims to sources from the writing pack/);
  assert.doesNotMatch(zh, /Do not require inline citation markers/);

  const en = buildLeadSystemPrompt('writing', session, { ui: { reply_language: 'en' } });
  assert.match(en, /English \(Codemini reply-language preference\)/);

  const planning = buildLeadSystemPrompt('planning', session, { ui: { reply_language: 'zh' } });
  assert.doesNotMatch(planning, /Codemini reply-language preference/);
});
