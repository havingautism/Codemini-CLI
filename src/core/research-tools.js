/**
 * Deep Research tool surface — owned by the research loop, not chat builtins.
 * Shares only low-level HTTP primitives from tools.js (webSearchQuery / webFetchPage).
 */

import { webFetchPage, webSearchQuery } from './tools.js';

export const RESEARCH_WEB_SEARCH = 'research_web_search';
export const RESEARCH_WEB_FETCH = 'research_web_fetch';

export const RESEARCH_SCOUT_DISPLAY_LABELS = {
  [RESEARCH_WEB_SEARCH]: 'Research search',
  [RESEARCH_WEB_FETCH]: 'Research fetch',
  read_artifact: 'Read artifact',
  submit_criterion_candidates: 'Submit candidates',
  submit_criterion_review: 'Submit review',
};

export function createResearchWebSearchDefinition() {
  return {
    type: 'function',
    function: {
      name: RESEARCH_WEB_SEARCH,
      description: [
        'Search the web for the current Deep Research criterion.',
        'Research Scout rule: criterionId must match the current target criterion.',
        'Search and fetch freely within the per-criterion tool fuse; finish by calling submit_criterion_candidates.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query for this criterion.',
          },
          criterionId: {
            type: 'string',
            description: 'The current target criterion id supplied by the Scout prompt.',
          },
          max_results: {
            type: 'number',
            description: 'Optional max results to return (provider-dependent).',
          },
        },
        required: ['query', 'criterionId'],
      },
    },
  };
}

export function createResearchWebFetchDefinition() {
  return {
    type: 'function',
    function: {
      name: RESEARCH_WEB_FETCH,
      description: [
        'Fetch and read a live web page for Deep Research.',
        'Returns artifactId when the body is persisted — pass that exact id to read_artifact; never invent ids.',
        'Use for direct URL reads after research_web_search, not for keyword search.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Absolute http or https URL to fetch.',
          },
          href: {
            type: 'string',
            description: 'Alias for url.',
          },
          timeout_ms: {
            type: 'number',
            description: 'Navigation timeout in milliseconds.',
          },
          wait_until: {
            type: 'string',
            description: 'domcontentloaded, load, or networkidle.',
          },
          max_links: {
            type: 'number',
            description: 'Max number of links to extract from the page.',
          },
        },
        required: ['url'],
      },
    },
  };
}

/** Low-level search — research product wrapper adds fuse / criterion checks. */
export async function executeResearchWebSearch(config, args = {}) {
  return webSearchQuery(config, {
    query: args?.query,
    max_results: args?.max_results,
    provider: args?.provider,
    locale: args?.locale,
    region: args?.region,
    timeout_ms: args?.timeout_ms,
  });
}

/** Low-level fetch — research product wrapper adds artifact persistence. */
export async function executeResearchWebFetch(args = {}) {
  return webFetchPage(args);
}

/**
 * @deprecated Prefer createResearchWebSearchDefinition(). Kept for older tests that
 * cloned a chat web_search schema; research no longer borrows chat definitions.
 */
export function createResearchSearchDefinition(baseDefinition) {
  const own = createResearchWebSearchDefinition();
  if (!baseDefinition) return own;
  // Preserve legacy test behavior: clone base, force research name + criterionId.
  const cloned = structuredClone(baseDefinition);
  const fn = cloned.function || cloned;
  fn.name = RESEARCH_WEB_SEARCH;
  fn.description = [
    String(fn.description || 'Search the web.'),
    'Research Scout rule: criterionId must match the current target criterion.',
    'Search and fetch freely within the per-criterion tool fuse; finish by calling submit_criterion_candidates.',
  ].join(' ');
  const parameters = fn.parameters && typeof fn.parameters === 'object'
    ? fn.parameters
    : { type: 'object', properties: {} };
  parameters.properties = {
    ...(parameters.properties || {}),
    criterionId: {
      type: 'string',
      description: 'The current target criterion id supplied by the Scout prompt.',
    },
  };
  parameters.required = [...new Set([...(parameters.required || []), 'criterionId'])];
  fn.parameters = parameters;
  return cloned;
}
