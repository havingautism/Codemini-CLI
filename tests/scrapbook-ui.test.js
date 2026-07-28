import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('app wires scrapbook as an independent view without project props', async () => {
  const source = await fs.readFile('codemini-web/client/src/App.jsx', 'utf8');
  assert.match(source, /const ScrapbookPanel = lazy/);
  assert.match(source, /state\.currentView === "scrapbook"/);
  assert.match(source, /onOpenScrapbook=/);
  assert.doesNotMatch(
    source,
    /<ScrapbookPanel[\s\S]{0,220}projectCwd=|<ScrapbookPanel[\s\S]{0,220}isGeneral=/,
    'ScrapbookPanel should not receive project props',
  );
});

test('sidebar exposes a scrapbook entry point distinct from projects', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/Sidebar.jsx', 'utf8');
  assert.match(source, /onOpenScrapbook/);
  assert.match(source, /t\("scrapbook"\)/);
});

test('route parsing recognizes scrapbook as a top-level view', async () => {
  const source = await fs.readFile('codemini-web/client/src/context/app-context.jsx', 'utf8');
  assert.match(source, /path === "\/scrapbook"[\s\S]{0,80}view:\s*"scrapbook"/);
  assert.match(source, /const scrapbookMatch = path\.match/);
  assert.match(source, /scrapbookEntryId/);
  assert.match(source, /if \(view === "scrapbook"\)/);
  assert.match(source, /return scrapbookEntryId[\s\S]{0,120}\/scrapbook\/\$\{encodeURIComponent\(scrapbookEntryId\)\}/);
});

test('scrapbook panel is independent from project/general labels', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.doesNotMatch(source, /projectCwd|isGeneral|projectLabel|__codemini_general__/);
});

test('scrapbook panel removes tag inputs and supports entry-detail routing', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.doesNotMatch(source, /form\.tags|scrapbookTagsPlaceholder|normalizeTags/);
  assert.match(source, /openScrapbookEntry|openScrapbookHome|scrapbookEntryId/);
});

test('scrapbook panel refreshes entry details after summary completion', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(
    source,
    /\["completed", "failed"\]\.includes\(payload\.job\.status\)[\s\S]{0,260}loadSelectedEntry\(selectedEntry\.id\)/,
  );
});

test('scrapbook cards expose hover delete and open-link actions', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /group-hover:opacity-100/);
  assert.match(source, /window\.open\(entry\.sourceUrl,\s*"_blank"/);
  assert.match(source, /requestDelete\(entry\)|deleteScrapbookEntry\(deleteTarget\.id\)/);
});

test('scrapbook panel uses ConfirmDialog and clamps overflowing card text', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /ConfirmDialog/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /scrapbookDeleteConfirm"\)\.replace\("{{title}}"/);
  assert.match(source, /break-all|line-clamp-2|line-clamp-4|truncate/);
  assert.match(source, /new URL\(raw\)\.hostname|sourceHostname/);
});

test('scrapbook detail prioritizes summary and collapses raw content by default', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /StreamdownRenderer/);
  assert.match(source, /contentExpanded|setContentExpanded/);
  assert.match(source, /summaryText/);
});
