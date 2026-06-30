import { isKimiModelName } from './kimi-gateway.js';
import {
  KIMI_NATIVE_SEARCH_DEFINITION,
  KIMI_NATIVE_SEARCH_TOOL_ID,
  buildKimiNativeSearchHandler,
  formatKimiNativeSearchResult,
  resolveKimiNativeSearchPayloadExtras
} from './kimi-native-search.js';

const KIMI_GATEWAY_DOMAINS = [
  'moonshot.ai',
  'moonshot.cn',
  'kimi.ai',
  'moonshotapi.com'
];

export const SEARCH_TOOL_POLICY_SLOT = 'web_search';

const HTTP_WEB_SEARCH_DEFINITION = {
  type: 'function',
  function: {
    name: 'web_search',
    description:
      'Run a live web search. Defaults to no-API Bing RSS, or uses config.web.search_provider=tavily|exa when configured with an API key. This tool respects config.web.search_enabled and will fail when network search is disabled.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        q: { type: 'string', description: 'Alias for query' },
        max_results: {
          type: 'number',
          description: 'Max results to return'
        },
        locale: {
          type: 'string',
          description: 'Bing market and language such as en-US or zh-CN'
        },
        region: {
          type: 'string',
          description: 'Bing country code such as US or CN'
        },
        provider: {
          type: 'string',
          description: 'Optional search provider override: bing_rss, tavily, or exa'
        }
      },
      required: ['query']
    }
  }
};

function normalizeSearchProvider(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function gatewayHost(baseUrl = '') {
  try {
    return new URL(String(baseUrl || '').trim()).hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isKimiGateway(baseUrl = '') {
  const host = gatewayHost(baseUrl);
  if (!host) return false;
  return KIMI_GATEWAY_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

export function detectNativeSearchVendor(config) {
  if (normalizeSearchProvider(config?.web?.search_provider) !== 'builtin') {
    return null;
  }
  const modelName = config?.model?.name || '';
  if (isKimiGateway(config?.gateway?.base_url) && isKimiModelName(modelName)) {
    return 'kimi';
  }
  return null;
}

export function resolveSearchToolContext(config) {
  const searchEnabled = config?.web?.search_enabled !== false;
  const provider = normalizeSearchProvider(config?.web?.search_provider);
  const vendor = detectNativeSearchVendor(config);

  if (!searchEnabled) {
    return {
      mode: 'disabled',
      toolId: null,
      vendor: null,
      supported: true
    };
  }

  if (provider === 'builtin') {
    if (vendor === 'kimi') {
      return {
        mode: 'native',
        toolId: KIMI_NATIVE_SEARCH_TOOL_ID,
        vendor: 'kimi',
        supported: true
      };
    }
    return {
      mode: 'native',
      toolId: null,
      vendor: null,
      supported: false
    };
  }

  return {
    mode: 'http',
    toolId: 'web_search',
    vendor: null,
    supported: true
  };
}

export function assertSearchConfig(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode !== 'native' || ctx.supported) return;
  throw new Error(
    'web.search_provider=builtin requires a model and gateway that support model-native search.'
  );
}

export function buildSearchDeferredEntries(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'http' && ctx.toolId) {
    return { web_search: HTTP_WEB_SEARCH_DEFINITION };
  }
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return { [KIMI_NATIVE_SEARCH_TOOL_ID]: KIMI_NATIVE_SEARCH_DEFINITION };
  }
  return {};
}

export function buildSearchHandlers(config, { webSearchHandler } = {}) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'http' && typeof webSearchHandler === 'function') {
    return { web_search: webSearchHandler };
  }
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return { [KIMI_NATIVE_SEARCH_TOOL_ID]: buildKimiNativeSearchHandler() };
  }
  return {};
}

export function buildSearchFormatters(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return {
      [KIMI_NATIVE_SEARCH_TOOL_ID]: formatKimiNativeSearchResult
    };
  }
  return {};
}

export function resolveGatewayPayloadExtras(config, { tools } = {}) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return resolveKimiNativeSearchPayloadExtras({ tools });
  }
  return {};
}

export function normalizeToolPolicy(toolNames, config) {
  const source = Array.isArray(toolNames) ? toolNames : [];
  const ctx = resolveSearchToolContext(config);
  const resolvedSearchId = ctx.toolId || SEARCH_TOOL_POLICY_SLOT;
  const out = [];
  for (const name of source) {
    if (name === SEARCH_TOOL_POLICY_SLOT) {
      if (ctx.mode === 'disabled') continue;
      if (ctx.mode === 'native' && !ctx.supported) continue;
      out.push(resolvedSearchId);
      continue;
    }
    out.push(name);
  }
  return out;
}

export function getSearchToolHint(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'disabled') return '';
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return `- ${KIMI_NATIVE_SEARCH_TOOL_ID}: model-native web search (load with tool_search if not visible). Call directly without a query parameter.`;
  }
  if (ctx.mode === 'http') {
    return '- web_search: search the web for external information';
  }
  return '';
}

function getHttpSearchFewShotBlock() {
  return `9. Search the web
User: search the web for latest pnpm release
Assistant: load the web search tool and run a targeted search
Tool: tool_search({"query":"web_search"})
Tool: web_search({"query":"latest pnpm release","max_results":5})
If web_search returns direct image URLs, select the most relevant ones and embed only those chosen images in the final answer with Markdown image syntax: ![description](https://example.com/image.jpg)`;
}

function getKimiNativeSearchFewShotBlock() {
  return `9. Search the web
User: search the web for latest pnpm release
Assistant: load the model-native web search tool, then call it directly
Tool: tool_search({"query":"${KIMI_NATIVE_SEARCH_TOOL_ID}"})
Tool: ${KIMI_NATIVE_SEARCH_TOOL_ID}({})
Do not call tool_search with the user's question as the query. After loading, call ${KIMI_NATIVE_SEARCH_TOOL_ID} directly; the gateway executes search server-side.`;
}

export function getSearchFewShotBlock(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    return getKimiNativeSearchFewShotBlock();
  }
  if (ctx.mode === 'http') {
    return getHttpSearchFewShotBlock();
  }
  return '';
}

export function getSearchTurnContextLine(config, { language = 'en' } = {}) {
  const ctx = resolveSearchToolContext(config);
  const zh = String(language || '').toLowerCase().startsWith('zh');
  if (ctx.mode === 'native' && ctx.vendor === 'kimi') {
    if (zh) {
      return `使用 ${KIMI_NATIVE_SEARCH_TOOL_ID} 或判断新闻、版本发布等时效性信息时，除非用户另有说明，请以此为准。`;
    }
    return `When using ${KIMI_NATIVE_SEARCH_TOOL_ID} or judging news, releases, and other time-sensitive facts, treat this as the current date unless the user says otherwise.`;
  }
  if (zh) {
    return '使用 web_search 或判断新闻、版本发布等时效性信息时，除非用户另有说明，请以此为准。';
  }
  return 'When using web_search or judging news, releases, and other time-sensitive facts, treat this as the current date unless the user says otherwise.';
}
