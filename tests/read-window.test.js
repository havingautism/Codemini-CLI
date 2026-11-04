import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectReadWindow, readWindowOptions, READ_MAX_BYTES } from '../src/core/read-window.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-read-window-'));
  const workspace = path.join(root, 'workspace');
  await fs.mkdir(workspace);
  t.after(async () => {
    closeSqliteDatabasesForTests();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });
  return { root, workspace };
}

test('window validates page sizes and preserves explicit smaller budgets', () => {
  for (const args of [{ offset: 0 }, { offset: 1.2 }, { limit: 0 }, { limit: 2001 }, { start_line: 3, end_line: 2 }, { max_chars: 10 }]) {
    assert.throws(() => readWindowOptions(args));
  }
  assert.deepEqual(readWindowOptions({ offset: 4, limit: 6 }), { offset: 4, limit: 6, maxChars: READ_MAX_BYTES });
  assert.equal(readWindowOptions({}, { read_file_default_lines: 120, read_file_max_chars: 12000 }).limit, 120);
});

test('chunked CRLF, blank lines, and EOF retain exact line numbers', async () => {
  const result = await collectReadWindow(['alpha\r', '\n\n', '\nbeta\r\n']);
  assert.deepEqual(result.lines, [
    { number: 1, text: 'alpha' }, { number: 2, text: '' },
    { number: 3, text: '' }, { number: 4, text: 'beta' },
  ]);
  assert.equal(result.total_lines, 4);
  assert.equal(result.truncated, false);
  assert.equal((await collectReadWindow([''])).total_lines, 0);
  await assert.rejects(collectReadWindow(['one\n'], { offset: 2 }), /out of range/);
  await assert.rejects(collectReadWindow(['abc\0def']), /binary/);
});

test('UTF-8 caps keep consecutive whole lines and resume without gaps', async () => {
  const source = Array.from({ length: 450 }, (_, i) => `第${i + 1}行 ${'中文代码'.repeat(20)}`).join('\n');
  const result = await collectReadWindow([source]);
  assert.equal(result.capped, true);
  assert.ok(result.lines.length > 50);
  assert.equal(result.next_offset, result.lines.length + 1);
  const rendered = result.lines.map((line) => `${line.number}: ${line.text}\n`).join('');
  assert.ok(Buffer.byteLength(rendered, 'utf8') <= READ_MAX_BYTES);
  const next = await collectReadWindow([source], { offset: result.next_offset });
  assert.equal(next.lines[0].number, result.lines.at(-1).number + 1);
  assert.equal(next.lines[0].text, source.split('\n')[result.next_offset - 1]);
});

test('newline-free huge lines are bounded and marked separately from pagination', async () => {
  const result = await collectReadWindow(Array.from({ length: 20 }, () => 'a'.repeat(100_000)));
  assert.equal(result.total_lines, 1);
  assert.ok(result.lines[0].text.length < 2100);
  assert.equal(result.line_truncated, true);
  assert.equal(result.truncated, true);
  assert.equal(result.next_offset, undefined);
});

test('line-count limit and small Unicode budgets advance without broken surrogates', async () => {
  const result = await collectReadWindow(['x\n'.repeat(2010)]);
  assert.equal(result.lines.length, 2000);
  assert.equal(result.next_offset, 2001);
  const small = await collectReadWindow(['😀'.repeat(2000) + '\nnext'], readWindowOptions({ max_chars: 128 }));
  const rendered = small.lines.map((line) => `${line.number}: ${line.text}\n`).join('');
  assert.ok(rendered.length <= 128);
  assert.equal(small.next_offset, 2);
  assert.equal(small.lines[0].text.isWellFormed(), true);
});

for (const platform of ['win32', 'linux', 'darwin']) {
  const backends = platform === 'win32' ? ['microsandbox'] : ['os', 'microsandbox'];
  for (const backend of backends) {
    for (const mode of ['disabled', 'read-only', 'workspace-write']) {
      test(`${platform}/${backend}/${mode}: continuous reads, rereads and mutation boundaries`, async (t) => {
        const { root, workspace } = await fixture(t);
        const source = Array.from({ length: 360 }, (_, i) => `const line${i + 1} = ${i};`).join('\r\n') + '\r\n';
        await fs.writeFile(path.join(workspace, 'sample.js'), source);
        await fs.writeFile(path.join(root, 'outside.txt'), 'private');
        const bundle = getBuiltinTools({ workspaceRoot: workspace, platform, config: {
          sandbox: { enabled: mode !== 'disabled', mode: mode === 'disabled' ? 'danger-full-access' : mode, backend },
        } });
        t.after(() => bundle.dispose());
        const first = await bundle.handlers.read({ file_path: 'sample.js' });
        assert.equal(first.lines.length, 360);
        const formatted = bundle.formatters.read(first);
        assert.match(formatted, /180: const line180 = 179;/);
        assert.match(formatted, /360: const line360 = 359;/);
        assert.doesNotMatch(formatted, /omitted|persisted-output/);
        const second = await bundle.handlers.read({ path: 'sample.js' });
        assert.deepEqual(second.lines, first.lines);
        const range = await bundle.handlers.read({ path: 'sample.js:170-190' });
        assert.equal(range.lines[0].number, 170);
        assert.equal(range.lines.at(-1).number, 190);
        const page = await bundle.handlers.read({ path: 'sample.js', offset: 3, limit: 2 });
        assert.equal(page.end_line, 4);
        assert.equal(page.next_offset, 5);
        await assert.rejects(bundle.handlers.read({ path: '../outside.txt' }), /escapes workspace/);
        await assert.rejects(bundle.handlers.read({ ast_target: { path: '../outside.txt' } }), /escapes workspace/);
        await assert.rejects(bundle.handlers.read({ path: '../outside.txt', query: '(identifier) @name' }), /escapes workspace/);
        const edit = { path: 'sample.js', old_text: 'const line180 = 179;', new_text: 'const line180 = 999;' };
        if (mode === 'read-only') {
          await assert.rejects(bundle.handlers.edit(edit), (error) => error.code === 'FS_SANDBOX_DENIED');
          await assert.rejects(bundle.handlers.write({ path: 'new.txt', content: 'denied' }), (error) => error.code === 'FS_SANDBOX_DENIED');
          assert.equal(await fs.readFile(path.join(workspace, 'sample.js'), 'utf8'), source);
        } else {
          const changed = await bundle.handlers.edit(edit);
          assert.ok(changed.diff_preview);
          assert.ok(bundle.formatters.edit(changed).length < 120);
          assert.match(await fs.readFile(path.join(workspace, 'sample.js'), 'utf8'), /const line180 = 999;\r\n/);
          await fs.writeFile(path.join(workspace, 'sample.js'), 'external edit\n');
          await assert.rejects(bundle.handlers.edit({ ...edit, old_text: 'external edit', new_text: 'overwrite' }), /changed since/);
          await bundle.handlers.read({ path: 'sample.js' });
          await bundle.handlers.edit({ ...edit, old_text: 'external edit', new_text: 'accepted after reread' });
          assert.match(await fs.readFile(path.join(workspace, 'sample.js'), 'utf8'), /accepted after reread/);
        }
      });
    }
  }
  test(`${platform}: actual agent-loop wire retains large bounded reads`, async (t) => {
    const { workspace } = await fixture(t);
    const source = Array.from({ length: 360 }, (_, i) => `function${i + 1}: ${'code'.repeat(6)}`).join('\n');
    await fs.writeFile(path.join(workspace, 'sample.txt'), source);
    const bundle = getBuiltinTools({ workspaceRoot: workspace, platform, config: { sandbox: { enabled: false } } });
    t.after(() => bundle.dispose());
    let requests = 0;
    const result = await runAgentLoop({
      workspaceRoot: workspace, systemPrompt: 'test', userPrompt: 'read', model: 'test',
      toolDefinitions: bundle.definitions, toolHandlers: bundle.handlers, toolFormatters: bundle.formatters,
      approvalMode: 'full_access', skipAnalysisNudge: true, config: { memory: { enabled: false } },
      requestCompletion: async ({ messages }) => {
        if (requests++ === 0) return { text: '', toolCalls: [{ id: 'read-large', name: 'read', arguments: JSON.stringify(platform === 'win32' ? { path: 'sample.txt' } : { file_path: 'sample.txt' }) }] };
        const wire = messages.find((message) => message.tool_call_id === 'read-large');
        assert.match(wire.content, /180: function180:/);
        assert.match(wire.content, /360: function360:/);
        assert.doesNotMatch(wire.content, /persisted-output|omitted/);
        return { text: 'done', toolCalls: [] };
      },
    });
    assert.equal(result.text, 'done');
  });
}

test('large AST reads stay bounded and carry file-relative continuation', async (t) => {
  const { workspace } = await fixture(t);
  await fs.writeFile(path.join(workspace, 'sample.js'), '\n\nfunction large() {\n' + Array.from({ length: 800 }, (_, i) => `  const value${i} = "${'x'.repeat(80)}";`).join('\n') + '\n}\n');
  const bundle = getBuiltinTools({ workspaceRoot: workspace, config: {}, platform: 'win32' });
  t.after(() => bundle.dispose());
  const result = await bundle.handlers.read({ path: 'sample.js', query: '(function_declaration name: (identifier) @name)' });
  assert.ok(result.read_window.capped);
  assert.equal(result.read_window.start_line, 3);
  assert.ok(result.read_window.next_offset > 100);
  assert.ok(result.content.length < READ_MAX_BYTES);
  assert.match(bundle.formatters.read(result), /Continue with offset=/);
  const reread = await bundle.handlers.read_ast_node({ ast_target: result.ast_target });
  assert.equal(reread.content, result.content);
});

test('edit misses point to relevant code instead of echoing the start of the file', async (t) => {
  const { workspace } = await fixture(t);
  await fs.writeFile(path.join(workspace, 'sample.js'), 'unrelated header\n'.repeat(40) + 'function target() {\n  return 2;\n}\n');
  const bundle = getBuiltinTools({ workspaceRoot: workspace, config: {}, platform: 'win32' });
  t.after(() => bundle.dispose());
  await bundle.handlers.read({ path: 'sample.js' });
  await assert.rejects(bundle.handlers.edit({ path: 'sample.js', old_text: 'function target() {\n  return 1;\n}', new_text: 'function target() {\n  return 3;\n}' }), (error) => {
    assert.match(error.message, /41: function target/);
    assert.match(error.message, /42:   return 2;/);
    assert.doesNotMatch(error.message, /File starts with/);
    assert.ok(error.message.length < 1000);
    return true;
  });
});
