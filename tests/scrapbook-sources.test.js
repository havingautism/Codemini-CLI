import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('scrapbook source mutations automatically start a fresh summary job', async () => {
  const source = await fs.readFile('codemini-web/server.js', 'utf8');
  assert.match(source, /addScrapbookSource\(entryId/);
  assert.match(source, /setScrapbookSourceSelection\(\s*entryId/);
  assert.match(source, /removeScrapbookSource\(entryId/);
  assert.ok(
    (source.match(/startScrapbookSummaryJob\(entryId\)/g) || []).length >= 4,
    'add, upload, selection and removal should all trigger re-summarization',
  );
  assert.match(source, /generateScrapbookArtifact\(\s*decodeURIComponent/);
});

test('scrapbook client exposes URL, document upload, source selection and Studio APIs', async () => {
  const source = await fs.readFile('codemini-web/client/src/hooks/use-api.js', 'utf8');
  assert.match(source, /export async function createMultiSourceScrapbookEntry/);
  assert.match(source, /\/api\/scrapbook\/entries\/notebook/);
  assert.match(source, /export async function addScrapbookSource/);
  assert.match(source, /export async function uploadScrapbookSources/);
  assert.match(source, /export async function setScrapbookSourceSelection/);
  assert.match(source, /export async function removeScrapbookSource/);
  assert.match(source, /export async function generateScrapbookArtifact/);
});

test('new notebooks accept multiple source types and start one summary job', async () => {
  const server = await fs.readFile('codemini-web/server.js', 'utf8');
  const service = await fs.readFile('codemini-web/lib/scrapbook-service.js', 'utf8');

  assert.match(server, /\/api\/scrapbook\/entries\/notebook/);
  assert.match(server, /form\s*\.getAll\(["']urls["']\)/);
  assert.match(server, /form\s*\.getAll\(["']files["']\)/);
  assert.match(
    server,
    /createMultiSourceScrapbookEntry\(\{ title, sources \}\)[\s\S]{0,120}startScrapbookSummaryJob\(entry\.id\)/,
  );
  assert.match(service, /export function createMultiSourceScrapbookEntry/);
  assert.match(service, /sourceType:\s*sources\.length > 1 \? 'notebook'/);
});
