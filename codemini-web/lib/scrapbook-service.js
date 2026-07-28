import {
  completeScrapbookSummaryJob,
  createScrapbookSummaryJob,
  createScrapbookEntry,
  deleteScrapbookEntry,
  getScrapbookSummaryJob,
  getLatestScrapbookSummaryJob,
  getScrapbookEntry,
  listScrapbookEntries,
  updateScrapbookEntry,
  updateScrapbookSummaryJob,
} from './scrapbook-store.js';
import { webFetchPage } from '../../src/core/tools.js';
import { loadConfig } from '../../src/core/config-store.js';
import { createChatCompletionStream } from '../../src/core/provider/index.js';
import { appendStructuredOutputLanguageRule } from '../../src/core/reply-language.js';

const summaryJobClients = new Map();
const SCRAPBOOK_SUMMARY_SYSTEM_PROMPT = [
  'You are writing a detailed scrapbook summary for later follow-up questions.',
  'Summarize only the provided source material.',
  'Your first line must be exactly `Title: <one relevant emoji> <concise title>`.',
  'Keep the generated title specific, natural, and under 36 characters.',
  'After the title, write a line containing exactly `Summary:` and then the summary.',
  'Be comprehensive and concrete: capture the main thesis, important details, key facts, structure, and useful context.',
  'Prefer a well-structured markdown summary with short paragraphs and concise bullets when helpful.',
  'If the source includes meaningful images and you want to reference them, preserve their markdown image references.',
  'Do not invent facts that are not present in the source.',
].join(' ');

export function buildScrapbookSummarySystemPrompt(config = {}) {
  return appendStructuredOutputLanguageRule(SCRAPBOOK_SUMMARY_SYSTEM_PROMPT, config, {
    fields: 'the generated title and summary',
  });
}

function normalizeTags(tags = []) {
  return [...new Set((Array.isArray(tags) ? tags : [])
    .map((tag) => String(tag || '').trim())
    .filter(Boolean))];
}

function normalizeGeneratedTitle(rawTitle) {
  let title = String(rawTitle || '')
    .replace(/^#+\s*/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!title) return '';
  if (!/\p{Extended_Pictographic}/u.test(title)) {
    title = `📝 ${title}`;
  }
  return Array.from(title).slice(0, 64).join('').trim();
}

export function parseGeneratedScrapbookResult(rawResult) {
  const raw = String(rawResult || '').trim();
  if (!raw) return { title: '', summary: '' };

  const lines = raw.split(/\r?\n/);
  const titlePattern = /^(?:#{1,6}\s*)?(?:\*\*)?Title(?:\*\*)?:\s*(?:\*\*)?\s*/i;
  const summaryPattern = /^(?:#{1,6}\s*)?(?:\*\*)?Summary(?:\*\*)?:\s*(?:\*\*)?\s*$/i;
  const titleIndex = lines.findIndex((line) => titlePattern.test(line.trim()));
  const summaryIndex = lines.findIndex((line) => summaryPattern.test(line.trim()));
  const title =
    titleIndex >= 0
      ? normalizeGeneratedTitle(lines[titleIndex].trim().replace(titlePattern, ''))
      : '';

  let summary = raw;
  if (summaryIndex >= 0) {
    summary = lines.slice(summaryIndex + 1).join('\n').trim();
  } else if (titleIndex >= 0) {
    summary = lines
      .filter((_, index) => index !== titleIndex)
      .join('\n')
      .trim();
  }

  return { title, summary };
}

function fallbackGeneratedTitle({ title, sourceUrl, contentText }) {
  const explicit = String(title || '').trim();
  if (explicit && explicit !== String(sourceUrl || '').trim()) {
    return normalizeGeneratedTitle(explicit);
  }
  const firstContentLine = String(contentText || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  if (firstContentLine) {
    return normalizeGeneratedTitle(Array.from(firstContentLine).slice(0, 36).join(''));
  }
  try {
    return normalizeGeneratedTitle(new URL(sourceUrl).hostname.replace(/^www\./, ''));
  } catch {
    return normalizeGeneratedTitle(sourceUrl);
  }
}

function buildScrapbookContextText(entry, summary) {
  const lines = [
    '<scrapbook_context>',
    'The user previously saved and read the following scrapbook entry.',
    'Treat it as user-provided reading context and prefer answering from it before fetching the source again.',
    '',
    `Title: ${entry.title || '(untitled)'}`,
    `Entry ID: ${entry.id}`,
  ];
  if (entry.sourceUrl) lines.push(`Source URL: ${entry.sourceUrl}`);
  lines.push('');
  lines.push('Summary:');
  lines.push(summary || 'No summary available yet.');
  lines.push('</scrapbook_context>');
  return lines.join('\n');
}

function buildScrapbookModelText(entry, summary) {
  return buildScrapbookContextText(entry, summary);
}

function publishSummaryJobEvent(job) {
  const clients = summaryJobClients.get(job.id);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ job })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

function publishSummaryJobDelta(jobId, partialText) {
  const clients = summaryJobClients.get(jobId);
  if (!clients || clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type: 'delta', partialText })}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

async function fetchViaJina(sourceUrl) {
  const normalized = String(sourceUrl || '').trim();
  if (!normalized) return null;
  const readerUrl = `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//i, '')}`;
  const response = await fetch(readerUrl, {
    headers: { 'user-agent': 'CodeminiCLI/0.8 scrapbook-fetch' },
  });
  if (!response.ok) {
    throw new Error(`Jina fetch failed (${response.status})`);
  }
  const text = String(await response.text()).trim();
  return text ? parseJinaReaderResponse(text, normalized) : null;
}

export function parseJinaReaderResponse(text, sourceUrl = '') {
  const raw = String(text || '').trim();
  if (!raw) return { title: String(sourceUrl || '').trim(), text: '' };
  const titleMatch = raw.match(/^Title:\s*(.+)$/m);
  const markdownMatch = raw.match(/(?:^|\n)Markdown Content:\s*\n([\s\S]*)$/);
  const markdownBody = markdownMatch ? markdownMatch[1] : raw;
  const cleaned = markdownBody
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !/^Warning:/i.test(line) &&
      !/^URL Source:/i.test(line) &&
      !/^Published Time:/i.test(line) &&
      !/^Title:/i.test(line)
    )
    .join('\n')
    .trim();
  return {
    title: String(titleMatch?.[1] || sourceUrl || '').trim(),
    text: cleaned,
  };
}

function truncateForSummaryInput(text = '', maxChars = 12000) {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars).trimEnd()}\n\n[truncated]` : normalized;
}

function resolveFastModel(config) {
  return String(config?.model?.fast_name || config?.model?.lite_name || config?.model?.name || '').trim();
}

function isPlaceholderTitle(title, sourceUrl) {
  const normalizedTitle = String(title || '').trim();
  const normalizedUrl = String(sourceUrl || '').trim();
  return !normalizedTitle || (normalizedUrl && normalizedTitle === normalizedUrl);
}

async function generateSummaryWithModel({ title, sourceUrl, contentText, onTextDelta = null }) {
  const config = await loadConfig();
  const model = resolveFastModel(config);
  if (!model) throw new Error('No model configured for scrapbook summaries');
  const sourceBody = truncateForSummaryInput(contentText);
  if (!sourceBody) return 'No summary available yet.';
  let partialText = '';
  const result = await createChatCompletionStream({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model,
    messages: [
      { role: 'system', content: buildScrapbookSummarySystemPrompt(config) },
      {
        role: 'user',
        content: [
          title ? `Title: ${title}` : '',
          sourceUrl ? `Source URL: ${sourceUrl}` : '',
          '',
          'Please write a detailed scrapbook summary for future follow-up questions.',
          'Cover the main point, important details, key facts, structure, and any actionable takeaways.',
          'If the source contains image references that are important for understanding, keep them in the summary.',
          '',
          sourceBody,
        ].filter(Boolean).join('\n'),
      },
    ],
    tools: [],
    timeoutMs: Math.min(Number(config.gateway?.timeout_ms || 30000), 120000),
    maxRetries: config.gateway?.max_retries ?? 1,
    onTextDelta: (delta) => {
      partialText = `${partialText}${String(delta || '')}`;
      if (typeof onTextDelta === 'function') onTextDelta(delta);
    },
  });
  const text = String(result?.text || partialText || '').trim();
  if (!text) throw new Error('Model returned empty scrapbook summary');
  return text;
}

async function runSummaryJob(jobId, options = {}) {
  const job = getScrapbookSummaryJob(jobId);
  if (!job) return;
  const entry = getScrapbookEntry(job.entryId);
  if (!entry) {
    const failed = updateScrapbookSummaryJob(jobId, {
      status: 'failed',
      errorText: 'Scrapbook entry not found',
    });
    if (failed) publishSummaryJobEvent(failed);
    return;
  }
  let current = updateScrapbookSummaryJob(jobId, {
    status: 'running',
    partialText: '',
    errorText: '',
  });
  if (current) publishSummaryJobEvent(current);
  try {
    let contentText = String(entry.contentText || '').trim();
    let title = entry.title;
    if (!contentText && entry.sourceType === 'url' && entry.sourceUrl) {
      const fetched = typeof options.fetchUrlContent === 'function'
        ? await options.fetchUrlContent(entry.sourceUrl)
        : await (async () => {
            try {
              const jina = await fetchViaJina(entry.sourceUrl);
              if (jina?.text) return { title: jina.title, contentText: jina.text };
            } catch {}
            const web = await webFetchPage({ url: entry.sourceUrl });
            return {
              title: String(web?.title || '').trim(),
              contentText: String(web?.text || '').trim(),
            };
          })();
      contentText = String(fetched?.contentText || fetched?.text || '').trim();
      if (isPlaceholderTitle(title, entry.sourceUrl)) {
        title = String(fetched?.title || '').trim() || entry.sourceUrl;
      }
      updateScrapbookEntry(entry.id, {
        title,
        contentText,
        fetchStatus: contentText ? 'ready' : 'failed',
      });
    }
    const generateSummary = typeof options.generateSummary === 'function'
      ? options.generateSummary
      : async (payload) => {
          let partial = '';
          return generateSummaryWithModel({
            ...payload,
            onTextDelta: (delta) => {
              partial = `${partial}${String(delta || '')}`;
              current = updateScrapbookSummaryJob(jobId, {
                status: 'running',
                partialText: partial,
              });
              if (current) publishSummaryJobDelta(jobId, partial);
            },
          });
        };
    const generatedText = String(await generateSummary({
      title: title || entry.title,
      sourceUrl: entry.sourceUrl,
      contentText: contentText || entry.contentText,
    }) || '').trim();
    const generated = parseGeneratedScrapbookResult(generatedText);
    const finalSummary = generated.summary;
    if (!finalSummary) throw new Error('Empty scrapbook summary');
    updateScrapbookEntry(entry.id, {
      title: generated.title || fallbackGeneratedTitle({
        title: title || entry.title,
        sourceUrl: entry.sourceUrl,
        contentText: contentText || entry.contentText,
      }),
      contentText: contentText || entry.contentText,
      summary: finalSummary,
      fetchStatus: contentText || entry.contentText ? 'ready' : entry.fetchStatus,
    });
    current = completeScrapbookSummaryJob(jobId, {
      partialText: finalSummary,
      resultSummary: finalSummary,
    });
    if (current) publishSummaryJobEvent(current);
  } catch (error) {
    current = updateScrapbookSummaryJob(jobId, {
      status: 'failed',
      errorText: String(error?.message || error || 'Summary failed'),
    });
    if (current) publishSummaryJobEvent(current);
  }
}

export function listScrapbookEntriesForApi({ query = '' } = {}) {
  const entries = listScrapbookEntries({ query });
  return {
    entries: entries.map((entry) => ({
      ...entry,
      latestJob: getLatestScrapbookSummaryJob(entry.id),
    })),
  };
}

export function getScrapbookEntryForApi(entryId) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) return null;
  return {
    ...entry,
    latestJob: getLatestScrapbookSummaryJob(entry.id),
  };
}

export function createManualScrapbookEntry(payload = {}) {
  const contentText = String(payload.contentText || payload.content || '').trim();
  if (!contentText) throw new Error('Manual scrapbook entry requires content');
  return createScrapbookEntry({
    sourceType: 'manual',
    sourceUrl: String(payload.sourceUrl || ''),
    title: String(payload.title || ''),
    contentText,
    tags: normalizeTags(payload.tags),
    fetchStatus: 'ready',
  });
}

export function createUrlScrapbookEntry(payload = {}) {
  const sourceUrl = String(payload.sourceUrl || payload.url || '').trim();
  if (!/^https?:\/\//i.test(sourceUrl)) {
    throw new Error('Scrapbook URL import requires an absolute http or https URL');
  }
  return createScrapbookEntry({
    sourceType: 'url',
    sourceUrl,
    title: sourceUrl,
    contentText: '',
    tags: normalizeTags(payload.tags),
    fetchStatus: 'pending_fetch',
  });
}

export function deleteScrapbookEntryForApi(entryId) {
  return { ok: deleteScrapbookEntry(entryId) };
}

export function getScrapbookSummaryJobForApi(jobId) {
  return getScrapbookSummaryJob(jobId);
}

function summarizeEntry(entry) {
  const base = String(entry.summary || entry.contentText || entry.title || entry.sourceUrl || '').trim();
  if (!base) return 'No summary available yet.';
  return base.length > 280 ? `${base.slice(0, 277).trimEnd()}...` : base;
}

export function startScrapbookSummaryJob(entryId, options = {}) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  const job = createScrapbookSummaryJob({
    entryId: entry.id,
    status: 'pending',
  });
  queueMicrotask(() => {
    void runSummaryJob(job.id, options);
  });
  return job;
}

export function buildScrapbookAskPayload(entryId) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  const summary = getLatestScrapbookSummaryJob(entry.id)?.resultSummary || entry.summary || summarizeEntry(entry);
  return {
    prompt: '请基于这条随手记回答我的后续问题。',
    summary,
        modelText: buildScrapbookModelText(entry, summary),
    attachments: [
      {
        id: `scrapbook:${entry.id}`,
        name: entry.title || entry.sourceUrl || 'scrapbook',
        kind: 'scrapbook',
        mime: 'text/plain',
        size: buildScrapbookContextText(entry, summary).length,
      },
    ],
    entry: {
      id: entry.id,
      title: entry.title,
      sourceUrl: entry.sourceUrl,
    },
  };
}

export function subscribeScrapbookSummaryJob(jobId, res) {
  const job = getScrapbookSummaryJob(jobId);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
  if (job) res.write(`data: ${JSON.stringify({ job })}\n\n`);
  const clients = summaryJobClients.get(jobId) || new Set();
  clients.add(res);
  summaryJobClients.set(jobId, clients);
  res.on('close', () => {
    clients.delete(res);
    if (clients.size === 0) summaryJobClients.delete(jobId);
  });
}
