const CACHE_TTL_MS = 5 * 60 * 1000;
const FAIL_CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const SHORT_FETCH_TIMEOUT_MS = 4_000;
const cache = new Map();
const failCache = new Map();

const SHORT_LINK_HOST_RE =
  /^(t\.co|bit\.ly|goo\.gl|tinyurl\.com|ow\.ly|buff\.ly|is\.gd|j\.mp|aka\.ms|lnkd\.in|dl\.tiktok\.com)$/i;

const USER_AGENT = 'CodeminiCLI/0.6 embed';

function trimPreview(value, max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isSafePublicUrl(raw) {
  let parsed;
  try {
    parsed = new URL(String(raw || '').trim());
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host === '127.0.0.1'
    || host === '[::1]'
    || host.endsWith('.local')
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    return false;
  }
  return true;
}

function readCache(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function writeCache(key, value) {
  cache.set(key, { at: Date.now(), value });
  failCache.delete(key);
  if (cache.size > 200) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function readFailCache(key) {
  const entry = failCache.get(key);
  if (!entry) return false;
  if (Date.now() - entry.at > FAIL_CACHE_TTL_MS) {
    failCache.delete(key);
    return false;
  }
  return true;
}

function writeFailCache(key) {
  failCache.set(key, { at: Date.now() });
  if (failCache.size > 200) {
    const oldest = failCache.keys().next().value;
    if (oldest) failCache.delete(oldest);
  }
}

export function isShortLinkUrl(rawUrl) {
  try {
    const host = new URL(String(rawUrl || '').trim()).hostname.replace(/^www\./, '').toLowerCase();
    return SHORT_LINK_HOST_RE.test(host);
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs: requestedTimeoutMs, headers, ...fetchOptions } = options;
  const timeoutMs = Number(requestedTimeoutMs) > 0 ? Number(requestedTimeoutMs) : FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json,application/xml;q=0.9,*/*;q=0.8',
        ...(headers || {}),
      },
      ...fetchOptions,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num)));
}

function extractHtmlMeta(html, key) {
  const lower = String(key || '').toLowerCase();
  const patterns = [
    new RegExp(`<meta[^>]*(?:name|property)\\s*=\\s*["']${lower}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:name|property)\\s*=\\s*["']${lower}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) return trimPreview(decodeHtmlEntities(match[1]), 320);
  }
  return '';
}

function extractHtmlTitle(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return '';
  return trimPreview(decodeHtmlEntities(match[1].replace(/<[^>]+>/g, '')), 240);
}

function pickImage(html, pageUrl) {
  const candidates = [
    extractHtmlMeta(html, 'og:image'),
    extractHtmlMeta(html, 'twitter:image'),
  ];
  const linkPatterns = [
    /<link[^>]*rel\s*=\s*["']image_src["'][^>]*href\s*=\s*["']([^"']+)["']/i,
    /<link[^>]*href\s*=\s*["']([^"']+)["'][^>]*rel\s*=\s*["']image_src["']/i,
  ];
  for (const pattern of linkPatterns) {
    const match = String(html || '').match(pattern);
    if (match?.[1]) candidates.push(match[1]);
  }
  for (const candidate of candidates) {
    try {
      return new URL(candidate, pageUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function baseEmbed({ type, url, title = '', description = '', image = null, siteName = null, meta = {} }) {
  const resolvedType = type === 'link' ? inferPlatformType(url) : type;
  return {
    type: resolvedType,
    url,
    title: trimPreview(title, 240),
    description: trimPreview(description, 320),
    image,
    siteName: siteName ? trimPreview(siteName, 80) : hostnameFromUrl(url),
    meta: meta && typeof meta === 'object' ? meta : {},
  };
}

function inferPlatformType(rawUrl) {
  const value = String(rawUrl || '').toLowerCase();
  if (/youtube\.com|youtu\.be/.test(value)) return 'youtube';
  if (/github\.com|githubusercontent\.com/.test(value)) return 'github';
  if (/reddit\.com/.test(value)) return 'reddit';
  if (/instagram\.com/.test(value)) return 'instagram';
  if (/x\.com|twitter\.com/.test(value)) return 'x';
  if (/facebook\.com|fb\.com/.test(value)) return 'facebook';
  if (/tiktok\.com/.test(value)) return 'tiktok';
  if (/linkedin\.com/.test(value)) return 'linkedin';
  if (/discord\.(?:com|gg)/.test(value)) return 'discord';
  if (/wikipedia\.org/.test(value)) return 'wikipedia';
  if (/medium\.com/.test(value)) return 'medium';
  if (/bilibili\.com|b23\.tv/.test(value)) return 'bilibili';
  if (/weibo\.(?:com|cn)/.test(value)) return 'weibo';
  if (/twitch\.tv/.test(value)) return 'twitch';
  if (/spotify\.com|open\.spotify\.com/.test(value)) return 'spotify';
  if (/stackoverflow\.com/.test(value)) return 'stackoverflow';
  if (/npmjs\.com/.test(value)) return 'npm';
  return 'link';
}

export function parseYouTubeId(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live') {
        return parts[1] || null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function parseGitHubRepo(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname.replace(/^www\./, '').toLowerCase() !== 'github.com') return null;
    const [owner, repo, ...rest] = parsed.pathname.split('/').filter(Boolean);
    if (!owner || !repo || rest.length > 0) return null;
    if (['settings', 'pulls', 'issues', 'actions', 'projects', 'wiki', 'security'].includes(repo)) {
      return null;
    }
    return { owner, repo };
  } catch {
    return null;
  }
}

export function parseRedditPost(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'reddit.com' && host !== 'old.reddit.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const commentsIndex = parts.indexOf('comments');
    if (commentsIndex === -1 || !parts[commentsIndex + 1]) return null;
    return {
      subreddit: parts[0] === 'r' ? parts[1] : null,
      postId: parts[commentsIndex + 1],
      path: parsed.pathname.replace(/\/$/, ''),
    };
  } catch {
    return null;
  }
}

async function resolveYouTube(url) {
  const videoId = parseYouTubeId(url);
  if (!videoId) return null;
  let title = 'YouTube Video';
  let author = '';
  try {
    const oembedUrl = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const response = await fetchWithTimeout(oembedUrl, {
      headers: { accept: 'application/json' },
    });
    if (response.ok) {
      const data = await response.json();
      title = data.title || title;
      author = data.author_name || '';
    }
  } catch {
    // fall back to thumbnail-only card
  }
  return baseEmbed({
    type: 'youtube',
    url,
    title,
    description: author ? `by ${author}` : '',
    image: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    siteName: 'YouTube',
    meta: { videoId, author },
  });
}

async function resolveGitHub(url) {
  const repo = parseGitHubRepo(url);
  if (!repo) return null;
  const apiUrl = `https://api.github.com/repos/${repo.owner}/${repo.repo}`;
  const response = await fetchWithTimeout(apiUrl, {
    headers: {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
    },
  });
  if (!response.ok) return null;
  const data = await response.json();
  return baseEmbed({
    type: 'github',
    url: data.html_url || url,
    title: data.full_name || `${repo.owner}/${repo.repo}`,
    description: trimPreview(data.description || '', 320),
    image: data.owner?.avatar_url || null,
    siteName: 'GitHub',
    meta: {
      owner: repo.owner,
      repo: repo.repo,
      stars: data.stargazers_count ?? null,
      forks: data.forks_count ?? null,
      language: data.language || '',
      openIssues: data.open_issues_count ?? null,
    },
  });
}

async function resolveReddit(url) {
  const parsed = parseRedditPost(url);
  if (!parsed) return null;
  const jsonUrl = `https://www.reddit.com${parsed.path}.json?raw_json=1`;
  const response = await fetchWithTimeout(jsonUrl, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return null;
  const data = await response.json();
  const post = data?.[0]?.data?.children?.[0]?.data;
  if (!post) return null;
  const preview = post.preview?.images?.[0]?.source?.url?.replace(/&amp;/g, '&') || null;
  const thumbnail = post.thumbnail && /^https?:\/\//.test(post.thumbnail) ? post.thumbnail : null;
  return baseEmbed({
    type: 'reddit',
    url,
    title: trimPreview(post.title || 'Reddit Post', 240),
    description: trimPreview(post.selftext || '', 320),
    image: preview || thumbnail,
    siteName: post.subreddit_name_prefixed || 'Reddit',
    meta: {
      subreddit: post.subreddit_name_prefixed || parsed.subreddit || '',
      score: post.score ?? null,
      comments: post.num_comments ?? null,
      author: post.author || '',
    },
  });
}

async function resolveGenericLink(url, { timeoutMs = FETCH_TIMEOUT_MS } = {}) {
  const response = await fetchWithTimeout(url, { timeoutMs });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const html = await response.text();
  const finalUrl = response.url || url;
  const title = extractHtmlMeta(html, 'og:title')
    || extractHtmlTitle(html)
    || hostnameFromUrl(finalUrl);
  const description = extractHtmlMeta(html, 'og:description')
    || extractHtmlMeta(html, 'description');
  const siteName = extractHtmlMeta(html, 'og:site_name') || hostnameFromUrl(finalUrl);
  return baseEmbed({
    type: 'link',
    url: finalUrl,
    title,
    description,
    image: pickImage(html, finalUrl),
    siteName,
    meta: {},
  });
}

export function normalizeEmbedItem(item = {}) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || '').trim();
  if (!url) return null;
  return baseEmbed({
    type: item.type || 'link',
    url,
    title: item.title || url,
    description: item.description || '',
    image: item.image || null,
    siteName: item.siteName || item.hostname || hostnameFromUrl(url),
    meta: item.meta || {},
  });
}

export function normalizeSearchResults(result = {}) {
  if (!result || typeof result !== 'object') return null;
  const query = String(result.query || '').trim();
  const items = (Array.isArray(result.results) ? result.results : [])
    .map((entry) => normalizeEmbedItem({
      type: 'link',
      url: entry.url,
      title: entry.title,
      description: entry.description,
      siteName: entry.hostname,
    }))
    .filter(Boolean);
  if (!items.length) return null;
  return { query, items };
}

export async function resolveEmbed(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!isSafePublicUrl(url)) {
    throw new Error('Invalid or disallowed URL');
  }

  const cached = readCache(url);
  if (cached) return cached;
  if (readFailCache(url)) {
    throw new Error('Embed resolution previously failed');
  }

  if (isShortLinkUrl(url)) {
    const minimal = baseEmbed({
      type: inferPlatformType(url),
      url,
      title: hostnameFromUrl(url),
      siteName: hostnameFromUrl(url),
    });
    writeCache(url, minimal);
    return minimal;
  }

  try {
    let embed = null;
    if (parseYouTubeId(url)) embed = await resolveYouTube(url);
    if (!embed) embed = await resolveGitHub(url);
    if (!embed) embed = await resolveReddit(url);
    if (!embed) embed = await resolveGenericLink(url, { timeoutMs: SHORT_FETCH_TIMEOUT_MS });

    writeCache(url, embed);
    return embed;
  } catch (error) {
    writeFailCache(url);
    throw error;
  }
}
