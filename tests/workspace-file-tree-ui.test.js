import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const FILE_TREE_PATH = 'codemini-web/client/src/components/FileTreePanel.jsx';
const WORKSPACE_RAIL_PATH =
  'codemini-web/client/src/components/WorkspaceRail.jsx';
const WEB_STYLE_PATH = 'codemini-web/client/style.css';

test('workspace file tree exposes responsive filtering and tree controls', async () => {
  const source = await fs.readFile(FILE_TREE_PATH, 'utf8');

  assert.match(source, /useDeferredValue\(searchTerm\)/);
  assert.match(source, /searchTerm=\{deferredSearchTerm\}/);
  assert.match(source, /searchMatch=\{searchMatch\}/);
  assert.match(source, /from "@\/components\/ui\/input"/);
  assert.match(source, /<Input[\s\S]*?workspaceSearchPlaceholder/);
  assert.match(source, /treeRef\.current\?\.closeAll/);
  assert.match(source, /onClick=\{loadBrowse\}/);
  assert.match(source, /FileTypeIcon/);
});

test('workspace file tree opens images with shared ImagePreviewDialog', async () => {
  const source = await fs.readFile(FILE_TREE_PATH, 'utf8');

  assert.match(source, /ImagePreviewDialog/);
  assert.match(source, /\/api\/workspace\/file/);
  assert.match(source, /isWorkspaceImagePath/);
  assert.match(source, /setImagePreview/);
});

test('workspace file tree always shows go-up while previewing files', async () => {
  const source = await fs.readFile(FILE_TREE_PATH, 'utf8');

  assert.match(source, /const previewCanGoUp = true/);
  assert.match(source, /canGoUp=\{previewCanGoUp\}/);
  assert.match(
    source,
    /mode === "preview"[\s\S]*?parentBrowsePath\(preview\?\.path/,
  );
});

test('workspace file tree ignores stale browse and preview responses', async () => {
  const source = await fs.readFile(FILE_TREE_PATH, 'utf8');

  assert.match(source, /treeGenerationRef/);
  assert.match(source, /treeGenerationRef\.current !== generation/);
  assert.match(source, /previewRequestRef/);
  assert.match(source, /previewRequestRef\.current !== requestId/);
});

test('workspace rail keeps resize behavior without drawing hard panel borders', async () => {
  const [source, styles] = await Promise.all([
    fs.readFile(WORKSPACE_RAIL_PATH, 'utf8'),
    fs.readFile(WEB_STYLE_PATH, 'utf8'),
  ]);
  const asideClass =
    source.match(/<aside[\s\S]*?className="([^"]+)"/)?.[1] || '';
  const headerClass =
    source.match(/<div className="([^"]+)"[\s\S]*?<FolderSimple/)?.[1] || '';

  assert.doesNotMatch(asideClass, /\bborder-l\b/);
  assert.doesNotMatch(headerClass, /\bborder-b\b/);
  assert.match(source, /codemini-terminal-resizer[^"]*border-0!/);
  assert.match(
    source,
    /codemini-terminal-resizer[^"]*-left-1[^"]*w-2 cursor-col-resize/,
  );
  assert.match(source, /className="codewiki-resizer-handle"/);
  assert.match(
    styles,
    /\.codewiki-resizer-handle\s*\{[\s\S]*?pointer-events:\s*none;[\s\S]*?width:\s*16px;[\s\S]*?height:\s*40px;/,
  );
  assert.match(
    styles,
    /\.codemini-terminal-resizer\s*\{[\s\S]*?min-width:\s*8px;/,
  );
});
