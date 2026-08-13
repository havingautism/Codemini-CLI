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

export function resolveSearchToolContext(config) {
  const searchEnabled = config?.web?.search_enabled !== false;

  if (!searchEnabled) {
    return {
      mode: 'disabled',
      toolId: null,
      vendor: null,
      supported: true
    };
  }

  return {
    mode: 'http',
    toolId: 'web_search',
    vendor: null,
    supported: true
  };
}

export function buildSearchDeferredEntries(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'http' && ctx.toolId) {
    return { web_search: HTTP_WEB_SEARCH_DEFINITION };
  }
  return {};
}

export function buildSearchHandlers(config, { webSearchHandler } = {}) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'http' && typeof webSearchHandler === 'function') {
    return { web_search: webSearchHandler };
  }
  return {};
}

export function formatWebSearchResult(result) {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const results = Array.isArray(result.results) ? result.results : [];
  const engine = result.engine ? ` via ${result.engine}` : '';
  const header = `[web_search: "${String(result.query || '').trim()}"${engine}]`;
  if (result.no_results || results.length === 0) {
    return `${header}\nNo results found.`;
  }

  const blocks = results.map((item, index) => {
    const title = String(item?.title || item?.url || '?').trim();
    const url = String(item?.url || '').trim();
    const desc = String(item?.description || '').trim();
    const hostname = String(item?.hostname || '').trim();
    const published = String(item?.published_at || '').trim();
    const lines = [`${index + 1}. ${title}`];
    if (url) lines.push(`   url: ${url}`);
    if (hostname) lines.push(`   site: ${hostname}`);
    if (published) lines.push(`   published: ${published}`);
    if (desc) lines.push(`   description: ${desc}`);
    const images = Array.isArray(item?.images) ? item.images : [];
    if (images.length) {
      const urls = images
        .slice(0, 3)
        .map((img) => (typeof img === 'string' ? img : img?.url))
        .filter(Boolean);
      if (urls.length) lines.push(`   images: ${urls.join(', ')}`);
    }
    return lines.join('\n');
  });

  const topImages = Array.isArray(result.images) ? result.images : [];
  if (topImages.length) {
    blocks.push('');
    blocks.push('Related images:');
    for (const img of topImages.slice(0, 6)) {
      const url = typeof img === 'string' ? img : img?.url;
      if (!url) continue;
      const desc = typeof img === 'object' ? String(img.description || '').trim() : '';
      blocks.push(desc ? `- ${url} (${desc})` : `- ${url}`);
    }
  }

  return `${header}\n${blocks.join('\n\n')}`;
}

export function buildSearchFormatters() {
  return {
    web_search: formatWebSearchResult
  };
}

export function normalizeToolPolicy(toolNames, config) {
  const source = Array.isArray(toolNames) ? toolNames : [];
  const ctx = resolveSearchToolContext(config);
  const out = [];
  for (const name of source) {
    if (name === SEARCH_TOOL_POLICY_SLOT) {
      if (ctx.mode === 'disabled') continue;
      out.push(SEARCH_TOOL_POLICY_SLOT);
      continue;
    }
    out.push(name);
  }
  return out;
}

export function getSearchToolHint(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'disabled') return '';
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

export function getSearchFewShotBlock(config) {
  const ctx = resolveSearchToolContext(config);
  if (ctx.mode === 'http') {
    return getHttpSearchFewShotBlock();
  }
  return '';
}

export function getSearchTurnContextLine(config, { language = 'en' } = {}) {
  const ctx = resolveSearchToolContext(config);
  const zh = String(language || '').toLowerCase().startsWith('zh');
  if (zh) {
    return '使用 web_search 或判断新闻、版本发布等时效性信息时，除非用户另有说明，请以此为准。';
  }
  return 'When using web_search or judging news, releases, and other time-sensitive facts, treat this as the current date unless the user says otherwise.';
}
