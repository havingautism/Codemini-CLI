import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('server exposes scrapbook routes without project binding', async () => {
  const source = await fs.readFile('codemini-web/server.js', 'utf8');
  assert.match(source, /\/api\/scrapbook\/entries/);
  assert.match(source, /\/api\/scrapbook\/entries\/chat-answer/);
  assert.match(source, /\/api\/scrapbook\/summary-jobs\//);
  assert.match(source, /\/api\/scrapbook\/summary-jobs\/'.*stream|\/api\/scrapbook\/summary-jobs\/\$\{encodeURIComponent\(jobId\)\}\/stream|\/stream/);
  assert.match(source, /buildScrapbookAskPayload/);
  assert.doesNotMatch(
    source,
    /scrapbook[\s\S]{0,300}projectDir/,
    'scrapbook server routes should stay global and must not accept projectDir',
  );
});

test('use-api exposes scrapbook helpers without project arguments', async () => {
  const source = await fs.readFile('codemini-web/client/src/hooks/use-api.js', 'utf8');
  for (const name of [
    'fetchScrapbookEntries',
    'createManualScrapbookEntry',
    'createUrlScrapbookEntry',
    'createChatAnswerScrapbookEntry',
    'fetchScrapbookEntry',
    'deleteScrapbookEntry',
    'summarizeScrapbookEntry',
    'fetchScrapbookSummaryJob',
    'buildScrapbookAskPayload',
  ]) {
    assert.match(source, new RegExp(`export async function ${name}\\(`));
  }
  assert.match(source, /export function openScrapbookSummaryJobStream\(/);
  assert.doesNotMatch(
    source,
    /function fetchScrapbookEntries\([^)]*projectDir|function createManualScrapbookEntry\([^)]*projectDir|function createUrlScrapbookEntry\([^)]*projectDir/,
    'scrapbook client helpers should not take projectDir',
  );
});
