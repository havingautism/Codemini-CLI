import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import {
  addScrapbookSource,
  buildScrapbookSummarySystemPrompt,
  createChatAnswerScrapbookEntry,
  createChatAnswerScrapbookEntryWithSummary,
  createManualScrapbookEntry,
  createUrlScrapbookEntry,
  getScrapbookEntryForApi,
  listScrapbookEntriesForApi,
  parseGeneratedScrapbookResult,
  parseJinaReaderResponse,
  removeScrapbookSource,
  setScrapbookSourceSelection,
  startScrapbookSummaryJob,
} from '../codemini-web/lib/scrapbook-service.js';
import {
  completeScrapbookSummaryJob,
  createScrapbookSummaryJob,
  createScrapbookEntry,
  deleteScrapbookEntry,
  getLatestScrapbookSummaryJob,
  getScrapbookEntry,
  listScrapbookEntries,
  listScrapbookSummaryJobs,
  updateScrapbookEntry,
} from '../codemini-web/lib/scrapbook-store.js';

test('scrapbook generation parser separates an emoji title from the summary', () => {
  assert.deepEqual(
    parseGeneratedScrapbookResult([
      'Title: 🧭 Agent 协作指南',
      'Summary:',
      'A structured summary.',
    ].join('\n')),
    {
      title: '🧭 Agent 协作指南',
      summary: 'A structured summary.',
    },
  );
  assert.equal(
    parseGeneratedScrapbookResult('Title: Research notes\nSummary:\nDetails').title,
    '📝 Research notes',
  );
  assert.deepEqual(
    parseGeneratedScrapbookResult('**Title:** 🌊 Ocean notes\n**Summary:**\nDetails'),
    { title: '🌊 Ocean notes', summary: 'Details' },
  );
});

test('scrapbook summary prompt follows the configured reply language', () => {
  assert.match(
    buildScrapbookSummarySystemPrompt({ ui: { reply_language: 'zh' } }),
    /Simplified Chinese/,
  );
  assert.match(
    buildScrapbookSummarySystemPrompt({ ui: { reply_language: 'en' } }),
    /English/,
  );
});

test('scrapbook notebooks persist multiple sources and invalidate derived content on changes', async () => {
  await withGlobalDir(async () => {
    const created = createManualScrapbookEntry({
      title: 'Research notebook',
      contentText: 'First source body',
    });
    const added = addScrapbookSource(created.id, {
      type: 'manual',
      name: 'Second source',
      contentText: 'Second source body',
    });
    assert.equal(added.entry.sources.length, 2);

    updateScrapbookEntry(created.id, {
      summary: 'Old summary',
      artifacts: { report: { content: 'Old report' } },
    });
    const selected = setScrapbookSourceSelection(created.id, [created.sources[0].id]);
    assert.equal(selected.sources[0].selected, true);
    assert.equal(selected.sources[1].selected, false);
    assert.equal(selected.summary, '');
    assert.deepEqual(selected.artifacts, {});

    const removed = removeScrapbookSource(created.id, added.source.id);
    assert.equal(removed.sources.length, 1);
    assert.equal(getScrapbookEntry(created.id).sources.length, 1);
  });
});

async function withGlobalDir(task) {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-scrapbook-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    return await task(dir);
  } finally {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
  }
}

test('scrapbook entry store supports create, update, list and delete', async () => {
  await withGlobalDir(async () => {
    const first = createScrapbookEntry({
      sourceType: 'manual',
      title: 'Alpha note',
      contentText: 'First body',
      tags: ['alpha'],
      fetchStatus: 'ready',
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = createScrapbookEntry({
      sourceType: 'url',
      sourceUrl: 'https://example.com/article',
      title: 'Beta article',
      contentText: 'Second body',
      tags: ['beta'],
      fetchStatus: 'ready',
    });

    const listed = listScrapbookEntries();
    assert.equal(listed.length, 2);
    assert.equal(listed[0].id, second.id);

    const updated = updateScrapbookEntry(first.id, {
      summary: 'Alpha summary',
      tags: ['alpha', 'review'],
    });
    assert.equal(updated.summary, 'Alpha summary');
    assert.deepEqual(updated.tags, ['alpha', 'review']);
    assert.equal(getScrapbookEntry(first.id).summary, 'Alpha summary');

    const filtered = listScrapbookEntries({ query: 'beta' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].id, second.id);

    assert.equal(deleteScrapbookEntry(first.id), true);
    assert.equal(getScrapbookEntry(first.id), null);
  });
});

test('scrapbook entry store persists chat_answer provenance metadata', async () => {
  await withGlobalDir(async () => {
    const entry = createScrapbookEntry({
      sourceType: 'chat_answer',
      sourceSessionId: 'session-123',
      sourceMessageId: 'message-456',
      sourceQuestionText: 'Why did the build fail?',
      title: '📝 Build failure answer',
      contentText: 'Because the env var was missing.',
      fetchStatus: 'ready',
    });
    const stored = getScrapbookEntry(entry.id);
    assert.equal(stored?.sourceType, 'chat_answer');
    assert.equal(stored?.sourceSessionId, 'session-123');
    assert.equal(stored?.sourceMessageId, 'message-456');
    assert.equal(stored?.sourceQuestionText, 'Why did the build fail?');
  });
});

test('scrapbook summary jobs track latest job per entry', async () => {
  await withGlobalDir(async () => {
    const entry = createScrapbookEntry({
      sourceType: 'manual',
      title: 'Job note',
      contentText: 'Needs summary',
      fetchStatus: 'ready',
    });

    const firstJob = createScrapbookSummaryJob({
      entryId: entry.id,
      status: 'running',
      partialText: 'Draft summary',
    });
    const completed = completeScrapbookSummaryJob(firstJob.id, {
      resultSummary: 'Final summary',
    });
    assert.equal(completed.status, 'completed');
    assert.equal(completed.resultSummary, 'Final summary');

    const secondJob = createScrapbookSummaryJob({
      entryId: entry.id,
      status: 'pending',
    });

    const jobs = listScrapbookSummaryJobs(entry.id);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].id, secondJob.id);
    assert.equal(getLatestScrapbookSummaryJob(entry.id).id, secondJob.id);
  });
});

test('scrapbook service remains global-only and exposes latest job in API shape', async () => {
  await withGlobalDir(async () => {
    const entry = createManualScrapbookEntry({
      title: 'Manual note',
      contentText: 'Independent global note',
      tags: ['global'],
    });
    createScrapbookSummaryJob({
      entryId: entry.id,
      status: 'completed',
      resultSummary: 'Global summary',
    });

    const listed = listScrapbookEntriesForApi();
    assert.equal(listed.entries.length, 1);
    assert.equal('projectDir' in listed.entries[0], false);
    assert.equal(listed.entries[0].latestJob.resultSummary, 'Global summary');

    const detail = getScrapbookEntryForApi(entry.id);
    assert.equal(detail.id, entry.id);
    assert.equal('projectDir' in detail, false);
    assert.equal(detail.latestJob.resultSummary, 'Global summary');
  });
});

test('chat answer scrapbook entries default to ready content with provenance metadata', async () => {
  await withGlobalDir(async () => {
    const entry = createChatAnswerScrapbookEntry({
      sessionId: 'sess-chat',
      messageId: 'msg-answer',
      questionText: 'How do I fix it?',
      answerText: 'Set CODEMINI_GLOBAL_DIR before startup.',
    });
    assert.equal(entry.sourceType, 'chat_answer');
    assert.equal(entry.sourceSessionId, 'sess-chat');
    assert.equal(entry.sourceMessageId, 'msg-answer');
    assert.equal(entry.sourceQuestionText, 'How do I fix it?');
    assert.equal(entry.fetchStatus, 'ready');
    assert.match(entry.title, /How do I fix it|📝/);
    assert.equal(entry.sources?.[0]?.type, 'chat_answer');
    assert.equal(entry.sources?.[0]?.sessionId, 'sess-chat');
    assert.equal(entry.sources?.[0]?.messageId, 'msg-answer');
  });
});

test('scrapbook summary job uses model-generated summary and stores it back on the entry', async () => {
  await withGlobalDir(async () => {
    const entry = createManualScrapbookEntry({
      title: 'Async summary note',
      contentText: 'First line.\nSecond line.\nThird line.',
    });

    const seenPrompts = [];
    const started = startScrapbookSummaryJob(entry.id, {
      generateSummary: async ({ title, contentText }) => {
        seenPrompts.push({ title, contentText });
        return 'Title: 🧪 Async summary note\nSummary:\nModel-made summary';
      },
    });
    assert.equal(started.status, 'pending');

    let latest = getLatestScrapbookSummaryJob(entry.id);
    for (let attempt = 0; attempt < 20 && latest?.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      latest = getLatestScrapbookSummaryJob(entry.id);
    }

    assert.equal(latest?.status, 'completed');
    assert.equal(seenPrompts.length, 1);
    assert.equal(seenPrompts[0].title, 'Async summary note');
    assert.match(String(seenPrompts[0].contentText || ''), /First line/);
    assert.equal(String(latest?.resultSummary || ''), 'Model-made summary');
    assert.equal(String(getScrapbookEntry(entry.id)?.summary || ''), 'Model-made summary');
    assert.equal(String(getScrapbookEntry(entry.id)?.title || ''), '🧪 Async summary note');
  });
});

test('chat answer scrapbook creation immediately starts a reusable summary job', async () => {
  await withGlobalDir(async () => {
    const { entry, job } = createChatAnswerScrapbookEntryWithSummary(
      {
        sessionId: 'sess-1',
        messageId: 'msg-1',
        questionText: 'What changed?',
        answerText: 'The server now persists scrapbook banners.',
      },
      {
        generateSummary: async () => 'Title: 🧪 Persisted banners\nSummary:\nThe server now persists scrapbook banners.',
      },
    );
    assert.equal(entry.sourceType, 'chat_answer');
    assert.equal(job.entryId, entry.id);
    assert.equal(job.status, 'pending');
    let latest = getLatestScrapbookSummaryJob(entry.id);
    for (let attempt = 0; attempt < 20 && latest?.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      latest = getLatestScrapbookSummaryJob(entry.id);
    }
    assert.equal(latest?.status, 'completed');
  });
});

test('scrapbook summary generation passes sourceQuestionText to the model payload', async () => {
  await withGlobalDir(async () => {
    const entry = createChatAnswerScrapbookEntry({
      sessionId: 'sess-q',
      messageId: 'msg-a',
      questionText: 'What is the root cause?',
      answerText: 'The summary job migration was missing.',
    });
    const seenPrompts = [];
    const started = startScrapbookSummaryJob(entry.id, {
      generateSummary: async (payload) => {
        seenPrompts.push(payload);
        return 'Title: 🧪 Root cause\nSummary:\nMigration issue.';
      },
    });
    assert.equal(started.status, 'pending');
    let latest = getLatestScrapbookSummaryJob(entry.id);
    for (let attempt = 0; attempt < 20 && latest?.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      latest = getLatestScrapbookSummaryJob(entry.id);
    }
    assert.equal(latest?.status, 'completed');
    assert.equal(seenPrompts[0]?.sourceQuestionText, 'What is the root cause?');
  });
});

test('global sqlite migrates old scrapbook_summary_jobs schema to include error_text', async () => {
  await withGlobalDir(async (dir) => {
    const dbPath = path.join(dir, 'codemini.sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      INSERT INTO schema_meta(key, value) VALUES ('schema_version', '3');
      CREATE TABLE scrapbook_entries (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_url TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        fetch_status TEXT NOT NULL DEFAULT 'ready'
      ) STRICT;
      CREATE TABLE scrapbook_summary_jobs (
        id TEXT PRIMARY KEY,
        entry_id TEXT NOT NULL REFERENCES scrapbook_entries(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        partial_text TEXT NOT NULL DEFAULT '',
        result_summary TEXT NOT NULL DEFAULT ''
      ) STRICT;
    `);
    db.close();
    closeSqliteDatabasesForTests();

    const entry = createScrapbookEntry({
      sourceType: 'manual',
      title: 'Migrated note',
      contentText: 'Needs migration',
      fetchStatus: 'ready',
    });
    const job = createScrapbookSummaryJob({
      entryId: entry.id,
      status: 'pending',
      errorText: '',
    });

    assert.equal(job.status, 'pending');
    const reopened = new DatabaseSync(dbPath);
    const column = reopened
      .prepare(`SELECT name FROM pragma_table_info('scrapbook_summary_jobs') WHERE name = 'error_text'`)
      .get();
    reopened.close();
    assert.equal(column?.name, 'error_text');
  });
});

test('jina reader response parser extracts title and body text', () => {
  const parsed = parseJinaReaderResponse(
    [
      'Title: Real article title',
      '',
      'URL Source: http://example.com/post',
      '',
      'Published Time: 123456',
      '',
      'Warning: cached snapshot',
      '',
      'Markdown Content:',
      'First paragraph.',
      '',
      'Second paragraph.',
    ].join('\n'),
    'https://example.com/post',
  );

  assert.equal(parsed.title, 'Real article title');
  assert.match(parsed.text, /First paragraph\./);
  assert.match(parsed.text, /Second paragraph\./);
  assert.doesNotMatch(parsed.text, /Warning: cached snapshot/);
});

test('url scrapbook summary replaces the placeholder url title with fetched title', async () => {
  await withGlobalDir(async () => {
    const entry = createUrlScrapbookEntry({
      sourceUrl: 'https://example.com/post',
    });

    const started = startScrapbookSummaryJob(entry.id, {
      fetchUrlContent: async () => ({
        title: 'Fetched article title',
        contentText: 'Fetched body content',
      }),
      generateSummary: async () => 'Model summary',
    });
    assert.equal(started.status, 'pending');

    let latest = getLatestScrapbookSummaryJob(entry.id);
    for (let attempt = 0; attempt < 20 && latest?.status !== 'completed'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      latest = getLatestScrapbookSummaryJob(entry.id);
    }

    const refreshed = getScrapbookEntry(entry.id);
    assert.equal(refreshed?.title, '📝 Fetched article title');
    assert.equal(refreshed?.contentText, 'Fetched body content');
  });
});
