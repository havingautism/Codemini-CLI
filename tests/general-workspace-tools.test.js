import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('general workspace exposes file browsing and terminal input', async () => {
  const [serverSource, appSource, railSource] = await Promise.all([
    fs.readFile('codemini-web/server.js', 'utf8'),
    fs.readFile('codemini-web/client/src/App.jsx', 'utf8'),
    fs.readFile(
      'codemini-web/client/src/components/WorkspaceRail.jsx',
      'utf8',
    ),
  ]);

  const workspaceRoutes =
    serverSource.match(
      /url\.pathname === '\/api\/workspace\/tree'[\s\S]*?url\.pathname === '\/api\/terminal\/stream'/,
    )?.[0] || '';
  const terminalRoutes =
    serverSource.match(
      /url\.pathname === '\/api\/terminal\/run'[\s\S]*?url\.pathname === '\/api\/terminal\/resize'/,
    )?.[0] || '';

  assert.doesNotMatch(workspaceRoutes, /isGeneralProjectDir\(cwd\)/);
  assert.doesNotMatch(terminalRoutes, /isGeneralProjectDir\(cwd\)/);
  assert.match(serverSource, /general conversation backed by Codemini's shared general workspace/);
  const fileButton =
    appSource.match(
      /aria-label=\{t\("workspaceFilesTab"\)\}[\s\S]*?<FolderSimple size=\{16\}/,
    )?.[0] || '';
  assert.doesNotMatch(fileButton, /disabled=\{Boolean\(state\.isGeneral\)\}/);
  assert.doesNotMatch(fileButton, /if \(state\.isGeneral\) return/);
  assert.match(fileButton, /setSideRailTab\("files"\)/);
  assert.match(railSource, /const workspaceDisabled = !String\(projectCwd/);
  assert.doesNotMatch(railSource, /Boolean\(isGeneral\)/);
});

test('terminal UI keeps ANSI colors theme-aware and accessible', async () => {
  const source = await fs.readFile(
    'codemini-web/client/src/components/TerminalPanel.jsx',
    'utf8',
  );

  assert.match(source, /minimumContrastRatio: 4\.5/);
  assert.match(source, /brightRed:/);
  assert.match(source, /brightCyan:/);
  assert.match(source, /new MutationObserver/);
  assert.match(source, /terminal\.options\.theme = readTheme\(\)/);
});
