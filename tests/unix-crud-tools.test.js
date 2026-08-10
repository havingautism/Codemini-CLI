import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getBuiltinTools,
  markSandboxEscalationApproved,
} from '../src/core/tools.js';
import { createToolRuntime } from '../src/core/tool-runtime.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

function names(definitions = []) {
  return definitions.map((d) => d?.function?.name || d?.name).filter(Boolean);
}

function exposedNames(bundle) {
  return new Set([
    ...names(bundle.definitions),
    ...Object.keys(bundle.deferredDefinitions || {}),
  ]);
}

test('shell tool name follows the configured shell instead of the host platform', () => {
  const bash = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: { shell: { default: 'bash' } },
    platform: 'win32',
  });
  assert.ok(names(bash.definitions).includes('Bash'));
  assert.equal(typeof bash.handlers.Bash, 'function');
  assert.equal(bash.handlers.run, undefined);

  const powershell = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      shell: { default: 'powershell' },
      sandbox: { enabled: true, mode: 'danger-full-access' },
    },
    platform: 'linux',
  });
  assert.ok(names(powershell.definitions).includes('Powershell'));
  assert.equal(typeof powershell.handlers.Powershell, 'function');
  assert.equal(powershell.handlers.run, undefined);
});

test('Windows command tool description and feedback follow sandbox state', () => {
  const confined = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      shell: { default: 'bash' },
      sandbox: { enabled: true, mode: 'workspace-write' },
    },
    platform: 'win32',
  });
  const bash = confined.definitions.find((d) => d?.function?.name === 'Bash');
  assert.match(bash.function.description, /Linux microVM sandbox \(workspace-write\)/);
  for (const name of ['read', 'edit', 'write', 'delete']) {
    const tool = confined.definitions.find((d) => d?.function?.name === name);
    assert.match(tool.function.description, /project-relative path/i, name);
  }
  assert.match(confined.deferredDefinitions.list.function.description, /project-relative path/i);
  assert.ok(bash.function.parameters.properties.sandbox_permissions);
  assert.match(
    confined.formatters.Bash({ command: 'pwd', code: 0, stdout: '/workspace\n', sandbox: { wrapped: true, mode: 'workspace-write' } }),
    /^\[shell: bash \| sandbox: workspace-write \| cwd: project root\]/,
  );

  const unrestricted = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      shell: { default: 'powershell' },
      sandbox: { enabled: true, mode: 'danger-full-access' },
    },
    platform: 'win32',
  });
  const powershell = unrestricted.definitions.find((d) => d?.function?.name === 'Powershell');
  assert.match(powershell.function.description, /directly on the Windows system without microVM confinement/);
  assert.equal(powershell.function.parameters.properties.sandbox_permissions, undefined);
  assert.match(
    unrestricted.formatters.Powershell({ command: 'Get-Location', code: 0, stdout: 'C:\\repo\n' }),
    /^\[shell: powershell \| sandbox: off \| cwd:/,
  );

  const disabled = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {
      shell: { default: 'bash' },
      sandbox: { enabled: false, mode: 'workspace-write' },
    },
    platform: 'win32',
  });
  const nativeShell = disabled.definitions.find((d) => d?.function?.name === 'Powershell');
  assert.match(nativeShell.function.description, /directly on the Windows system without microVM confinement/);
  assert.equal(nativeShell.function.parameters.properties.sandbox_permissions, undefined);
  const nativeEdit = disabled.definitions.find((d) => d?.function?.name === 'edit');
  const nativeRead = disabled.definitions.find((d) => d?.function?.name === 'read');
  assert.deepEqual(nativeEdit.function.parameters.required, ['path']);
  assert.equal(nativeEdit.function.parameters.properties.sandbox_permissions, undefined);
  assert.doesNotMatch(nativeRead.function.description, /project-relative path/i);
  const active = new Set(names(disabled.definitions));
  const deferred = new Set(Object.keys(disabled.deferredDefinitions || {}));
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.ok(active.has(name), `${name} should remain active when the Windows sandbox is disabled`);
  }
  assert.ok(deferred.has('grep'));
  assert.ok(deferred.has('glob'));
});

test('Windows keeps staged writes while using Bash and sandbox escalation', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'win32',
  });
  const active = new Set(names(bundle.definitions));
  const deferred = new Set(Object.keys(bundle.deferredDefinitions || {}));
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.ok(active.has(name), `${name} should be active on win32`);
    assert.ok(!deferred.has(name), `${name} should not be deferred on win32`);
  }
  assert.ok(deferred.has('grep'));
  assert.ok(deferred.has('glob'));
  assert.ok(!active.has('grep'));
  assert.ok(!active.has('glob'));
  const edit = bundle.definitions.find((d) => d?.function?.name === 'edit');
  assert.deepEqual(edit?.function?.parameters?.required, ['path']);
  assert.ok(edit?.function?.parameters?.properties?.sandbox_permissions);
  const write = bundle.definitions.find((d) => d?.function?.name === 'write');
  assert.deepEqual(write?.function?.parameters?.required, ['path', 'content']);
  assert.ok(write?.function?.parameters?.properties?.sandbox_permissions);
  const shell = bundle.definitions.find((d) => d?.function?.name === 'Bash');
  assert.ok(shell?.function?.parameters?.properties?.sandbox_permissions);
});

test('Windows file mutations can use an approved sandbox escalation', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-win-sandbox-'));
  const bundle = getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      shell: { default: 'bash' },
      sandbox: { enabled: true, mode: 'read-only' },
    },
    platform: 'win32',
  });
  try {
    const args = markSandboxEscalationApproved({
      path: 'note.txt',
      content: 'ok',
      sandbox_permissions: 'workspace-write',
      justification: 'Create the requested workspace file.',
    });
    await bundle.handlers.write(args);
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'note.txt'), 'utf8'), 'ok');
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('Linux promotes grep/glob and drops staged write + apply_patch', () => {
  const bundle = getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'linux',
  });
  const active = new Set(names(bundle.definitions));
  const deferred = new Set(Object.keys(bundle.deferredDefinitions || {}));
  assert.ok(active.has('grep'));
  assert.ok(active.has('glob'));
  assert.ok(active.has('edit'));
  assert.ok(active.has('write'));
  assert.ok(active.has('read'));
  assert.ok(active.has('delete'));
  assert.ok(active.has('search_code'));
  for (const name of ['begin_write', 'write_chunk', 'commit_write', 'abort_write', 'apply_patch']) {
    assert.ok(!active.has(name), `${name} should not be active on linux`);
    assert.ok(!deferred.has(name), `${name} should not be deferred on linux`);
  }
  const edit = bundle.definitions.find((d) => d?.function?.name === 'edit');
  assert.deepEqual(edit?.function?.parameters?.required, ['file_path', 'old_string', 'new_string']);
  assert.deepEqual(Object.keys(edit.function.parameters.properties), [
    'file_path', 'old_string', 'new_string', 'replace_all', 'sandbox_permissions', 'justification',
  ]);
  assert.ok(edit?.function?.parameters?.properties?.sandbox_permissions);
  assert.ok(edit?.function?.parameters?.properties?.justification);
  const write = bundle.definitions.find((d) => d?.function?.name === 'write');
  assert.deepEqual(write?.function?.parameters?.required, ['file_path', 'content']);
  assert.equal(write?.function?.parameters?.properties?.overwrite, undefined);
  assert.ok(write?.function?.parameters?.properties?.sandbox_permissions);
  assert.ok(write?.function?.parameters?.properties?.justification);
  assert.equal(Object.keys(write.function.parameters.properties).at(-1), 'content');
  const read = bundle.definitions.find((d) => d?.function?.name === 'read');
  assert.deepEqual(read?.function?.parameters?.required, ['file_path']);
  assert.deepEqual(Object.keys(read.function.parameters.properties), ['file_path', 'offset', 'limit']);
  const del = bundle.definitions.find((d) => d?.function?.name === 'delete');
  assert.deepEqual(del?.function?.parameters?.required, ['file_path']);
  assert.ok(del?.function?.parameters?.properties?.sandbox_permissions);
  const grep = bundle.definitions.find((d) => d?.function?.name === 'grep');
  assert.deepEqual(Object.keys(grep.function.parameters.properties), ['pattern', 'path', 'include']);
  const glob = bundle.definitions.find((d) => d?.function?.name === 'glob');
  assert.deepEqual(Object.keys(glob.function.parameters.properties), ['pattern', 'path']);
  const shell = bundle.definitions.find((d) => d?.function?.name === 'Bash');
  assert.ok(shell?.function?.parameters?.properties?.sandbox_permissions);
});

test('Linux keeps Codemini tools and removes only Windows write workarounds', () => {
  const windows = exposedNames(getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'win32',
  }));
  const linux = exposedNames(getBuiltinTools({
    workspaceRoot: process.cwd(),
    config: {},
    platform: 'linux',
  }));
  assert.deepEqual(
    [...windows].filter((name) => !linux.has(name)).sort(),
    ['abort_write', 'apply_patch', 'begin_write', 'commit_write', 'write_chunk'],
  );
  assert.deepEqual([...linux].filter((name) => !windows.has(name)), []);
});

test('Linux file_path aliases validate and sandbox escalation is approval-bound', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-unix-crud-'));
  const bundle = getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      sandbox: { enabled: true, mode: 'read-only' },
    },
    platform: 'linux',
  });
  try {
    const runtime = createToolRuntime(bundle);
    const response = runtime.beginModelResponse([
      {
        id: 'edit-alias',
        name: 'edit',
        arguments: JSON.stringify({ file_path: 'note.txt', old_string: 'a', new_string: 'b' }),
      },
      {
        id: 'write-alias',
        name: 'write',
        arguments: JSON.stringify({ file_path: 'note.txt', content: 'ok' }),
      },
    ]);
    assert.equal(response.calls[0].args._invalid_schema, undefined);
    assert.equal(response.calls[1].args._invalid_schema, undefined);
    await assert.rejects(
      runtime.execute('write', { file_path: 'note.txt', content: 'ok' }),
      (error) => error?.code === 'FS_SANDBOX_DENIED'
        && /retry this exact operation once with sandbox_permissions/i.test(error.message),
    );

    const escalation = {
      file_path: 'note.txt',
      content: 'ok',
      sandbox_permissions: 'workspace-write',
      justification: 'Create the requested workspace file.',
    };
    await assert.rejects(
      runtime.execute('write', escalation),
      /sandbox escalation requires explicit user approval/,
    );
    await runtime.execute('write', markSandboxEscalationApproved(escalation));
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'note.txt'), 'utf8'), 'ok');
    await runtime.execute('delete', markSandboxEscalationApproved({
      file_path: 'note.txt',
      sandbox_permissions: 'workspace-write',
      justification: 'Delete the requested workspace file.',
    }));
    await assert.rejects(fs.stat(path.join(workspaceRoot, 'note.txt')), (error) => error?.code === 'ENOENT');
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('Linux CRUD follows DSH read windows and observed-version mutation policy', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-dsh-crud-'));
  await fs.writeFile(path.join(workspaceRoot, 'existing.txt'), 'alpha\nbeta\ngamma\n');
  await fs.writeFile(path.join(workspaceRoot, 'stale.txt'), 'before\n');
  const bundle = getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      sandbox: { enabled: false, mode: 'danger-full-access' },
    },
    platform: 'linux',
  });
  try {
    await bundle.handlers.write({ file_path: 'created.txt', content: 'created\n' });
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'created.txt'), 'utf8'), 'created\n');

    await assert.rejects(
      bundle.handlers.write({ file_path: 'existing.txt', content: 'nope\n' }),
      (error) => error?.code === 'FS_NOT_OBSERVED',
    );
    await assert.rejects(
      bundle.handlers.edit({ file_path: 'existing.txt', old_string: 'alpha', new_string: 'ALPHA' }),
      (error) => error?.code === 'FS_NOT_OBSERVED',
    );

    const read = await bundle.handlers.read({ file_path: 'existing.txt', offset: 2, limit: 2 });
    assert.deepEqual(read.lines, [
      { number: 2, text: 'beta' },
      { number: 3, text: 'gamma' },
    ]);
    assert.match(bundle.formatters.read(read), /2: beta\n3: gamma/);
    await bundle.handlers.edit({
      file_path: 'existing.txt',
      old_string: 'beta',
      new_string: 'BETA',
    });
    await bundle.handlers.write({ file_path: 'existing.txt', content: 'replaced\n' });
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'existing.txt'), 'utf8'), 'replaced\n');

    await bundle.handlers.read({ file_path: 'stale.txt' });
    await fs.writeFile(path.join(workspaceRoot, 'stale.txt'), 'outside\n');
    await assert.rejects(
      bundle.handlers.edit({ file_path: 'stale.txt', old_string: 'before', new_string: 'after' }),
      (error) => error?.code === 'FS_STALE_VERSION',
    );
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('Linux grep/glob use the DSH search contract', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-dsh-search-'));
  await fs.mkdir(path.join(workspaceRoot, 'nested'));
  await fs.writeFile(path.join(workspaceRoot, '.hidden.txt'), 'Needle\n');
  await fs.writeFile(path.join(workspaceRoot, 'nested', 'sample.ts'), 'const Needle = 1;\n');
  const bundle = getBuiltinTools({ workspaceRoot, config: {}, platform: 'linux' });
  try {
    const glob = await bundle.handlers.glob({ pattern: '*' });
    assert.ok(glob.matches.includes('.hidden.txt'));
    assert.ok(glob.matches.includes('nested/sample.ts'));
    const grep = await bundle.handlers.grep({ pattern: 'Needle', include: '*.{ts,txt}' });
    assert.equal(grep.engine, 'ripgrep');
    assert.equal(grep.matches.length, 2);
    await assert.rejects(
      bundle.handlers.grep({ pattern: 'Needle', include: '*.ts,*.txt' }),
      /one positive glob pattern/,
    );
    await assert.rejects(
      bundle.handlers.grep({ pattern: '[' }),
      (error) => error?.code === 'SEARCH_INVALID_PATTERN',
    );
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

test('CodeWiki comment mutations obey a read-only sandbox', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-comment-sandbox-'));
  await fs.writeFile(path.join(workspaceRoot, 'sample.js'), 'const value = 1;\n');
  const bundle = getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      sandbox: { enabled: true, mode: 'read-only' },
      runtime: { codewiki_comment_tools: true },
    },
    platform: 'linux',
  });
  try {
    await assert.rejects(
      bundle.handlers.add_code_comment({
        path: 'sample.js',
        line: 1,
        comment: 'documentation',
      }),
      (error) => error?.code === 'FS_SANDBOX_DENIED',
    );
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'sample.js'), 'utf8'), 'const value = 1;\n');
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
