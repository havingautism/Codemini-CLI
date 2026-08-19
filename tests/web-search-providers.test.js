import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.localStorage = {
  getItem: () => null,
  setItem: () => {},
};

const { webSearchQuery } = await import('../src/core/tools.js');
const { getSearchProviderOptions } = await import(
  '../codemini-web/client/src/lib/settings-options.js'
);

function withMockFetch(handler) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test('settings expose Firecrawl as a web search provider', () => {
  const values = getSearchProviderOptions().map((option) => option.value);
  assert.deepEqual(values, ['bing_rss', 'tavily', 'exa', 'firecrawl']);
});

test('firecrawl search maps v2 web and image results', async () => {
  let captured;
  const restore = withMockFetch(async (url, options = {}) => {
    captured = { url: String(url), options };
    return new Response(JSON.stringify({
      success: true,
      data: {
        web: [
          {
            title: 'Firecrawl',
            url: 'https://www.firecrawl.dev/',
            description: 'Web data API',
          },
        ],
        images: [
          {
            title: 'Logo',
            imageUrl: 'https://cdn.example.com/logo.png',
            url: 'https://www.firecrawl.dev/',
          },
        ],
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  try {
    const result = await webSearchQuery(
      {
        web: {
          search_enabled: true,
          search_provider: 'firecrawl',
          firecrawl_api_key: 'fc-test',
          search_region: 'CN',
        },
      },
      { query: 'firecrawl', max_results: 5 },
    );

    assert.equal(captured.url, 'https://api.firecrawl.dev/v2/search');
    const headers = captured.options.headers || {};
    assert.match(String(headers.authorization || headers.Authorization || ''), /Bearer fc-test/);
    const body = JSON.parse(captured.options.body);
    assert.equal(body.query, 'firecrawl');
    assert.equal(body.limit, 5);
    assert.equal(body.country, 'CN');
    assert.deepEqual(body.sources, [{ type: 'web' }, { type: 'images' }]);

    assert.equal(result.engine, 'firecrawl');
    assert.equal(result.no_results, false);
    assert.equal(result.results[0].url, 'https://www.firecrawl.dev/');
    assert.equal(result.results[0].title, 'Firecrawl');
    assert.equal(result.results[0].images[0].url, 'https://cdn.example.com/logo.png');
    assert.equal(result.images[0].url, 'https://cdn.example.com/logo.png');
    assert.equal(result.images[0].description, 'Logo');
  } finally {
    restore();
  }
});

test('firecrawl image-only search still returns related images', async () => {
  const restore = withMockFetch(async () => new Response(JSON.stringify({
    success: true,
    data: {
      web: [],
      images: [
        {
          title: 'Sunset',
          imageUrl: 'https://cdn.example.com/sunset.jpg',
          url: 'https://photos.example.com/sunset',
        },
      ],
    },
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  }));

  try {
    const result = await webSearchQuery(
      {
        web: {
          search_enabled: true,
          search_provider: 'firecrawl',
          firecrawl_api_key: 'fc-test',
        },
      },
      { query: 'sunset', max_results: 5 },
    );

    assert.equal(result.no_results, false);
    assert.deepEqual(result.results, []);
    assert.equal(result.images[0].url, 'https://cdn.example.com/sunset.jpg');

    const { formatWebSearchResult } = await import(
      '../src/core/provider/search-tool-registry.js'
    );
    const formatted = formatWebSearchResult(result);
    assert.match(formatted, /Related images:/);
    assert.match(formatted, /https:\/\/cdn\.example\.com\/sunset\.jpg/);
    assert.doesNotMatch(formatted, /No results found/);
  } finally {
    restore();
  }
});

test('firecrawl requires an API key', async () => {
  const previous = process.env.FIRECRAWL_API_KEY;
  delete process.env.FIRECRAWL_API_KEY;
  try {
    await assert.rejects(
      webSearchQuery(
        { web: { search_enabled: true, search_provider: 'firecrawl' } },
        { query: 'x' },
      ),
      /web\.firecrawl_api_key or FIRECRAWL_API_KEY/,
    );
  } finally {
    if (previous === undefined) delete process.env.FIRECRAWL_API_KEY;
    else process.env.FIRECRAWL_API_KEY = previous;
  }
});
