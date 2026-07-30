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
  const scrapbookBranch = source.match(
    /state\.currentView === "scrapbook"[\s\S]*?state\.currentView === "codewiki"/,
  )?.[0] || '';
  assert.match(scrapbookBranch, /codemini-workspace-panel/);
  assert.match(scrapbookBranch, /sidebarCollapsed/);
  assert.match(scrapbookBranch, /setSidebarCollapsedAndPersist\(false\)/);
  assert.match(scrapbookBranch, /border-b border-\(--border-default\)/);
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

test('scrapbook detail opens as a routed responsive modal while the library stays mounted', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /<Dialog[\s\S]{0,80}open=\{isDetailView\}/);
  assert.match(
    source,
    /onOpenChange=\{\(open\) => \{[\s\S]{0,100}!open[\s\S]{0,80}actions\.openScrapbookHome\(\)/,
  );
  assert.match(
    source,
    /h-\[calc\(100dvh-0\.5rem\)\][\s\S]{0,240}sm:max-w-\[calc\(100vw-1rem\)\]/,
  );
  assert.match(
    source,
    /grid-rows-\[auto_auto_minmax\(0,1fr\)\][\s\S]{0,260}lg:grid-rows-\[auto_minmax\(0,1fr\)\]/,
    'desktop detail layout should not reserve an empty row for the mobile pane switcher',
  );
  assert.match(source, /xl:max-w-\[1560px\]/);
  assert.match(source, /--scrapbook-source-width/);
  assert.match(source, /--scrapbook-studio-width/);
  assert.match(source, /handlePaneResizeStart/);
  assert.match(source, /handlePaneResizeKeyDown/);
  assert.match(source, /role="separator"/);
  assert.doesNotMatch(source, /\{!isDetailView \? \(/);
});

test('scrapbook panel refreshes entry details after summary completion', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(
    source,
    /\["completed", "failed"\]\.includes\(payload\.job\.status\)[\s\S]{0,260}loadSelectedEntry\(selectedEntry\.id\)/,
  );
});

test('scrapbook cards expose hover delete and origin actions', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /ScrapbookLibraryCard/);
  assert.match(source, /DotsThreeVertical/);
  assert.match(source, /Popover[\s\S]{0,80}onOpenChange/);
  assert.match(source, /window\.open\(target\.sourceUrl,\s*"_blank"/);
  assert.match(source, /openChatMessage/);
  assert.match(source, /scrapbookJumpToMessage/);
  assert.match(source, /requestDelete\(target\)|deleteScrapbookEntry\(deleteTarget\.id\)/);
});

test('scrapbook panel uses ConfirmDialog and clamps overflowing card text', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /ConfirmDialog/);
  assert.doesNotMatch(source, /window\.confirm/);
  assert.doesNotMatch(source, /scrapbookDeleteConfirm"\)\.replace\("{{title}}"/);
  assert.match(source, /break-all|line-clamp-2|line-clamp-4|truncate/);
  assert.match(source, /new URL\(raw\)\.hostname|sourceHostname/);
});

test('scrapbook detail is a sources-summary-studio workspace without inline chat', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  const styles = await fs.readFile('codemini-web/client/style.css', 'utf8');
  assert.match(source, /StreamdownRenderer/);
  assert.match(source, /scrapbookSources/);
  assert.match(source, /scrapbookOverview/);
  assert.match(source, /scrapbookStudio/);
  assert.match(source, /uploadScrapbookSources/);
  assert.match(source, /generateScrapbookArtifact/);
  assert.match(source, /summaryText/);
  assert.match(source, /inlineEmbeds=\{false\}/);
  assert.doesNotMatch(source, /handleAsk|scrapbookAsking|contentExpanded/);
  assert.match(source, /setMindmapExpanded\(true\)/);
  assert.match(source, /scrapbookExpandMindMap/);
  assert.match(source, /data-scrapbook-mindmap-action="expand"/);
  assert.match(
    source,
    /scrapbook-mindmap-preview[\s\S]{0,900}data-scrapbook-mindmap-action="expand"/,
    'mind-map expansion belongs to the diagram toolbar, not the Studio heading',
  );
  assert.match(
    styles,
    /\.scrapbook-mindmap-preview \[data-streamdown="mermaid-block"\] > div:first-child > span[\s\S]{0,220}display: none/,
    'studio mind maps should hide the renderer language label',
  );
  assert.match(
    styles,
    /\.scrapbook-mindmap-preview \[data-streamdown="mermaid-block"\] > div:last-child[\s\S]{0,240}margin-top: 0\.5rem/,
    'mind-map actions should retain breathing room above the canvas',
  );
});

test('new notebook composer accepts multiple links and documents at once', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /createMultiSourceScrapbookEntry/);
  assert.match(source, /split\(\/\\r\?\\n\/\)/);
  assert.match(source, /setComposerFiles\(Array\.from/);
  assert.match(source, /type="file"[\s\S]{0,120}multiple/);
  assert.doesNotMatch(source, /setComposerMode/);
});

test('scrapbook library follows notebook layout and creates entries in a modal', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /scrapbookLibraryTitle/);
  assert.match(source, /GridFour/);
  assert.match(source, /ListBullets/);
  assert.match(source, /sortMode/);
  assert.match(source, /activeFilter/);
  assert.match(source, /<Dialog[\s\S]{0,120}composerOpen/);
  assert.match(source, /scrapbookAiTitleDescription/);
  assert.doesNotMatch(source, /const composer =/);
});

test('scrapbook cards lift a generated title emoji into the top-left visual', async () => {
  const source = await fs.readFile('codemini-web/client/src/components/ScrapbookPanel.jsx', 'utf8');
  assert.match(source, /function splitEmojiTitle/);
  assert.match(source, /Intl\.Segmenter/);
  assert.match(source, /titleParts\.emoji/);
  assert.match(source, /titleParts\.title/);
});

test('streamdown renders studio mind maps through the Mermaid plugin', async () => {
  const renderer = await fs.readFile(
    'codemini-web/client/src/components/StreamdownRenderer.jsx',
    'utf8',
  );
  const packageJson = JSON.parse(
    await fs.readFile('codemini-web/package.json', 'utf8'),
  );

  assert.match(renderer, /@streamdown\/mermaid/);
  assert.match(renderer, /plugins=\{\{\s*code:\s*codePlugin,\s*mermaid\s*\}\}/);
  assert.equal(packageJson.dependencies['@streamdown/mermaid'], '^1.0.2');
});
