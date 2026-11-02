import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { extractToolResultMeta } from '../src/core/agent-loop.js';
import { getBuiltinTools } from '../src/core/tools.js';

async function withTempDir(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-html-tool-'));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function toolBundle(root) {
  return getBuiltinTools({
    workspaceRoot: root,
    config: {
      policy: { allowed_paths: [] },
      shell: { default: process.platform === 'win32' ? 'powershell' : 'bash' },
      sandbox: { enabled: false, mode: 'danger-full-access' },
    },
  });
}

test('preview_html registers a bounded workspace HTML artifact', async () => {
  await withTempDir(async (root) => {
    await fs.mkdir(path.join(root, 'demo'));
    await fs.writeFile(
      path.join(root, 'demo', 'index.html'),
      '<!doctype html><button id="go">Go</button><script>go.onclick=()=>go.textContent="Done"</script>',
    );
    const bundle = toolBundle(root);
    try {
      const definition = bundle.definitions.find(
        (item) => item?.function?.name === 'preview_html',
      );
      assert.ok(definition, 'preview_html should be an active builtin tool');
      const result = await bundle.handlers.preview_html({
        path: 'demo/index.html',
        title: 'Button demo',
        height: 700,
      });
      assert.deepEqual(
        {
          ok: result.ok,
          artifactType: result.artifactType,
          path: result.path,
          title: result.title,
          height: result.height,
        },
        {
          ok: true,
          artifactType: 'html',
          path: 'demo/index.html',
          title: 'Button demo',
          height: 700,
        },
      );
      assert.ok(result.byteLength > 0);
    } finally {
      await bundle.dispose?.();
    }
  });
});

test('preview_html rejects non-HTML files and workspace escapes', async () => {
  await withTempDir(async (root) => {
    await fs.writeFile(path.join(root, 'notes.txt'), 'not html');
    const outside = path.join(path.dirname(root), 'outside-artifact.html');
    await fs.writeFile(outside, '<!doctype html>outside');
    const bundle = toolBundle(root);
    try {
      await assert.rejects(
        () => bundle.handlers.preview_html({ path: 'notes.txt' }),
        /requires an \.html or \.htm file/i,
      );
      await assert.rejects(
        () => bundle.handlers.preview_html({ path: '../outside-artifact.html' }),
        /escapes workspace/i,
      );
    } finally {
      await bundle.dispose?.();
      await fs.rm(outside, { force: true });
    }
  });
});

test('preview_html rejects artifacts larger than the renderer limit', async () => {
  await withTempDir(async (root) => {
    await fs.writeFile(path.join(root, 'oversized.html'), Buffer.alloc(2 * 1024 * 1024 + 1));
    const bundle = toolBundle(root);
    try {
      await assert.rejects(
        () => bundle.handlers.preview_html({ path: 'oversized.html' }),
        /exceeds the 2097152-byte limit/i,
      );
    } finally {
      await bundle.dispose?.();
    }
  });
});

test('preview_html result metadata is persisted as an HTML artifact embed', () => {
  const meta = extractToolResultMeta('preview_html', {
    artifactType: 'html',
    path: 'demo/index.html',
    title: 'Demo',
    height: 640,
    byteLength: 123,
  });
  assert.deepEqual(meta, {
    embedType: 'html_artifact',
    path: 'demo/index.html',
    title: 'Demo',
    height: 640,
    byteLength: 123,
  });
});
