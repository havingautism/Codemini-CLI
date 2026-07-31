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
import { randomUUID } from 'node:crypto';
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

function fallbackChatAnswerTitle({ questionText, answerText }) {
  const question = String(questionText || '').trim();
  if (question) {
    return normalizeGeneratedTitle(Array.from(question).slice(0, 36).join(''));
  }
  const firstAnswerLine = String(answerText || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  return firstAnswerLine
    ? normalizeGeneratedTitle(Array.from(firstAnswerLine).slice(0, 36).join(''))
    : '📝 Chat answer';
}

function buildScrapbookContextText(entry, summary) {
  const sources = selectedNotebookSources(entry);
  const lines = [
    '<scrapbook_context>',
    'The user previously saved and read the following multi-source notebook.',
    'Treat its synthesized summary and source list as user-provided reading context.',
    '',
    `Title: ${entry.title || '(untitled)'}`,
    `Entry ID: ${entry.id}`,
  ];
  if (entry.sourceUrl) lines.push(`Source URL: ${entry.sourceUrl}`);
  if (sources.length) {
    lines.push(`Selected sources (${sources.length}):`);
    for (const source of sources) {
      lines.push(`- ${source.name || source.url || 'Untitled source'}${source.url ? ` — ${source.url}` : ''}`);
    }
  }
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

function createNotebookSource(payload = {}) {
  return {
    id: String(payload.id || `source_${randomUUID()}`),
    type: String(payload.type || 'manual'),
    name: String(payload.name || payload.url || 'Untitled source'),
    url: String(payload.url || ''),
    mime: String(payload.mime || 'text/plain'),
    contentText: String(payload.contentText || ''),
    sessionId: String(payload.sessionId || payload.sourceSessionId || ''),
    messageId: String(payload.messageId || payload.sourceMessageId || ''),
    selected: payload.selected !== false,
    status: String(payload.status || 'ready'),
    createdAt: String(payload.createdAt || new Date().toISOString()),
  };
}

function selectedNotebookSources(entry) {
  const sources = Array.isArray(entry?.sources) ? entry.sources : [];
  return sources.filter((source) => source?.selected !== false);
}

function combineNotebookSources(sources = [], maxChars = 24000) {
  let remaining = maxChars;
  const sections = [];
  for (const source of sources) {
    if (remaining <= 0) break;
    const body = String(source?.contentText || '').trim();
    if (!body) continue;
    const clipped = body.slice(0, remaining);
    sections.push([
      `## Source: ${String(source?.name || source?.url || 'Untitled')}`,
      source?.url ? `URL: ${source.url}` : '',
      clipped,
    ].filter(Boolean).join('\n'));
    remaining -= clipped.length;
  }
  return sections.join('\n\n---\n\n');
}

function resolveFastModel(config) {
  return String(config?.model?.fast_name || config?.model?.lite_name || config?.model?.name || '').trim();
}

function isPlaceholderTitle(title, sourceUrl) {
  const normalizedTitle = String(title || '').trim();
  const normalizedUrl = String(sourceUrl || '').trim();
  return !normalizedTitle || (normalizedUrl && normalizedTitle === normalizedUrl);
}

async function generateSummaryWithModel({
  title,
  sourceUrl,
  contentText,
  sourceQuestionText = '',
  onTextDelta = null,
}) {
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
          sourceQuestionText ? `Original user question: ${sourceQuestionText}` : '',
          '',
          'Please write a detailed scrapbook summary for future follow-up questions.',
          sourceQuestionText
            ? 'Use the original user question only as supporting context for understanding what the answer is responding to.'
            : '',
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
  const stopIfSuperseded = () => {
    if (getLatestScrapbookSummaryJob(entry.id)?.id === jobId) return false;
    current = updateScrapbookSummaryJob(jobId, {
      status: 'failed',
      errorText: 'Superseded by a newer summary request',
    });
    if (current) publishSummaryJobEvent(current);
    return true;
  };
  try {
    let sources = Array.isArray(entry.sources) ? [...entry.sources] : [];
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (source?.type !== 'url' || source.contentText || !source.url) continue;
      try {
        const fetched = typeof options.fetchUrlContent === 'function'
          ? await options.fetchUrlContent(source.url)
          : await (async () => {
              try {
                const jina = await fetchViaJina(source.url);
                if (jina?.text) return { title: jina.title, contentText: jina.text };
              } catch {}
              const web = await webFetchPage({ url: source.url });
              return {
                title: String(web?.title || '').trim(),
                contentText: String(web?.text || '').trim(),
              };
            })();
        const sourceText = String(fetched?.contentText || fetched?.text || '').trim();
        sources[index] = {
          ...source,
          name: String(fetched?.title || '').trim() || source.name,
          contentText: sourceText,
          status: sourceText ? 'ready' : 'failed',
        };
      } catch {
        sources[index] = { ...source, status: 'failed' };
      }
    }
    if (stopIfSuperseded()) return;
    const activeSources = sources.filter((source) => source?.selected !== false);
    let contentText =
      activeSources.length === 1
        ? String(activeSources[0]?.contentText || '').trim()
        : combineNotebookSources(activeSources);
    if (!contentText) contentText = String(entry.contentText || '').trim();
    let title = entry.title;
    if (
      isPlaceholderTitle(title, entry.sourceUrl) &&
      activeSources.length === 1 &&
      activeSources[0]?.type === 'url'
    ) {
      title = String(activeSources[0].name || '').trim() || title;
    }
    if (!contentText && sources.length === 0 && entry.sourceType === 'url' && entry.sourceUrl) {
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
    if (sources.length) {
      updateScrapbookEntry(entry.id, {
        sources,
        contentText,
        sourceUrl: activeSources.find((source) => source.url)?.url || entry.sourceUrl,
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
      sourceQuestionText: entry.sourceQuestionText,
    }) || '').trim();
    if (stopIfSuperseded()) return;
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
      sources,
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
  const source = createNotebookSource({
    type: 'manual',
    name: String(payload.title || '').trim() || 'Manual note',
    contentText,
  });
  return createScrapbookEntry({
    sourceType: 'manual',
    sourceUrl: String(payload.sourceUrl || ''),
    title: String(payload.title || ''),
    contentText,
    sources: [source],
    tags: normalizeTags(payload.tags),
    fetchStatus: 'ready',
  });
}

export function createChatAnswerScrapbookEntry(payload = {}) {
  const contentText = String(
    payload.contentText || payload.answerText || payload.content || '',
  ).trim();
  if (!contentText) throw new Error('Chat answer scrapbook entry requires content');
  const sourceQuestionText = String(
    payload.sourceQuestionText || payload.questionText || '',
  ).trim();
  const title =
    String(payload.title || '').trim() ||
    fallbackChatAnswerTitle({
      questionText: sourceQuestionText,
      answerText: contentText,
    });
  const sourceSessionId = String(payload.sourceSessionId || payload.sessionId || '').trim();
  const sourceMessageId = String(payload.sourceMessageId || payload.messageId || '').trim();
  return createScrapbookEntry({
    sourceType: 'chat_answer',
    sourceSessionId,
    sourceMessageId,
    sourceQuestionText,
    title,
    contentText,
    sources: [createNotebookSource({
      type: 'chat_answer',
      name: title,
      contentText,
      sessionId: sourceSessionId,
      messageId: sourceMessageId,
    })],
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
    sources: [createNotebookSource({
      type: 'url',
      name: sourceUrl,
      url: sourceUrl,
      status: 'pending_fetch',
    })],
    tags: normalizeTags(payload.tags),
    fetchStatus: 'pending_fetch',
  });
}

export function createMultiSourceScrapbookEntry(payload = {}) {
  const rawSources = Array.isArray(payload.sources) ? payload.sources : [];
  if (!rawSources.length) throw new Error('Notebook requires at least one source');

  const sources = rawSources.map((item) => {
    const type = String(item?.type || 'manual');
    const url = String(item?.url || '').trim();
    const contentText = String(item?.contentText || '').trim();
    if (type === 'url' && !/^https?:\/\//i.test(url)) {
      throw new Error('Source URL requires an absolute http or https URL');
    }
    if (type !== 'url' && !contentText) {
      throw new Error('Source content is required');
    }
    return createNotebookSource({
      type,
      url,
      name: String(item?.name || url || '').trim() || 'Untitled source',
      mime: item?.mime,
      contentText,
      status: type === 'url' && !contentText ? 'pending_fetch' : 'ready',
    });
  });
  const first = sources[0];
  const hasPendingSource = sources.some((source) => source.status === 'pending_fetch');

  return createScrapbookEntry({
    sourceType: sources.length > 1 ? 'notebook' : first.type,
    sourceUrl: first.url,
    title: String(payload.title || '').trim() || first.name,
    contentText: first.contentText,
    sources,
    tags: normalizeTags(payload.tags),
    fetchStatus: hasPendingSource ? 'pending_fetch' : 'ready',
  });
}

export function addScrapbookSource(entryId, payload = {}) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  const type = String(payload.type || 'manual');
  const url = String(payload.url || '').trim();
  const contentText = String(payload.contentText || '').trim();
  if (type === 'url' && !/^https?:\/\//i.test(url)) {
    throw new Error('Source URL requires an absolute http or https URL');
  }
  if (type !== 'url' && !contentText) throw new Error('Source content is required');
  const source = createNotebookSource({
    type,
    url,
    name: String(payload.name || url || '').trim() || 'Untitled source',
    mime: payload.mime,
    contentText,
    status: type === 'url' && !contentText ? 'pending_fetch' : 'ready',
  });
  const sources = [...(entry.sources || []), source];
  return {
    source,
    entry: updateScrapbookEntry(entry.id, {
      sources,
      artifacts: {},
      summary: '',
    }),
  };
}

export function setScrapbookSourceSelection(entryId, selectedSourceIds = []) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  const selected = new Set((Array.isArray(selectedSourceIds) ? selectedSourceIds : []).map(String));
  const sources = (entry.sources || []).map((source) => ({
    ...source,
    selected: selected.has(source.id),
  }));
  if (!sources.some((source) => source.selected)) {
    throw new Error('Select at least one source');
  }
  return updateScrapbookEntry(entry.id, { sources, artifacts: {}, summary: '' });
}

export function removeScrapbookSource(entryId, sourceId) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  const sources = (entry.sources || []).filter((source) => source.id !== sourceId);
  if (sources.length === (entry.sources || []).length) throw new Error('Source not found');
  return updateScrapbookEntry(entry.id, { sources, artifacts: {}, summary: '' });
}

export async function generateScrapbookArtifact(entryId, kind) {
  const entry = getScrapbookEntry(entryId);
  if (!entry) throw new Error('Scrapbook entry not found');
  if (!['mindmap', 'report'].includes(kind)) throw new Error('Unsupported artifact type');
  const sourceText = combineNotebookSources(selectedNotebookSources(entry));
  if (!sourceText) throw new Error('No selected source content is available');
  const config = await loadConfig();
  const model = resolveFastModel(config);
  if (!model) throw new Error('No model configured for scrapbook generation');
  const instruction = kind === 'mindmap'
    ? [
        'Create a concise Mermaid mindmap grounded only in the provided sources.',
        'Return exactly one fenced mermaid block using Mermaid mindmap syntax.',
        'Use a short root label and 2-4 levels. Keep node labels concise and avoid punctuation that breaks Mermaid.',
      ].join(' ')
    : [
        'Write a polished research report grounded only in the provided sources.',
        'Use Markdown with an executive summary, key findings, evidence grouped by source, and conclusions.',
        'Call out disagreements or uncertainty instead of inventing facts.',
      ].join(' ');
  const result = await createChatCompletionStream({
    sdkProvider: config.sdk?.provider,
    baseUrl: config.gateway.base_url,
    apiKey: config.gateway.api_key,
    model,
    messages: [
      { role: 'system', content: appendStructuredOutputLanguageRule(instruction, config, {
        fields: kind === 'mindmap' ? 'all mindmap labels' : 'the complete report',
      }) },
      { role: 'user', content: sourceText },
    ],
    tools: [],
    timeoutMs: Math.min(Number(config.gateway?.timeout_ms || 30000), 120000),
    maxRetries: config.gateway?.max_retries ?? 1,
  });
  const content = String(result?.text || '').trim();
  if (!content) throw new Error('Model returned empty content');
  const currentEntry = getScrapbookEntry(entry.id);
  if (!currentEntry || currentEntry.updatedAt !== entry.updatedAt) {
    throw new Error('Sources changed while generating; generate again');
  }
  const artifacts = {
    ...(currentEntry.artifacts || {}),
    [kind]: { content, updatedAt: new Date().toISOString() },
  };
  const updated = updateScrapbookEntry(entry.id, { artifacts });
  return { artifact: updated.artifacts[kind], entry: updated };
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

export function createChatAnswerScrapbookEntryWithSummary(payload = {}, options = {}) {
  const entry = createChatAnswerScrapbookEntry(payload);
  const job = startScrapbookSummaryJob(entry.id, options);
  return {
    entry: getScrapbookEntry(entry.id) || entry,
    job,
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
