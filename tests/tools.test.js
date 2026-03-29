import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { loadConfig } from '../src/core/config-store.js';
import { classifyCommandIntent } from '../src/core/shell.js';

async function withTempWorkspace(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tools-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function makeTools(workspaceRoot) {
  const config = await loadConfig();
  return getBuiltinTools({ workspaceRoot, config });
}

async function makeToolsWithConfig(workspaceRoot, mutate) {
  const config = await loadConfig();
  if (typeof mutate === 'function') mutate(config);
  return getBuiltinTools({ workspaceRoot, config });
}

test('grep returns structured top matches for content discovery', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        "import { hashPassword } from './crypto';",
        '',
        'export async function login(username, password) {',
        '  return hashPassword(password);',
        '}',
        '',
        'export async function logout() {',
        "  return 'ok';",
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'controller.ts'),
      [
        "import { login } from './service';",
        '',
        'export async function runLogin(req) {',
        '  return login(req.user, req.password);',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.grep({ pattern: 'login', path: 'src', max_results: 10 });

    assert.equal(result.pattern, 'login');
    assert.ok(Array.isArray(result.matches));
    assert.ok(result.matches.some((item) => item.path === 'src/auth/service.ts' && item.line === 3));
    assert.ok(result.matches.some((item) => item.path === 'src/auth/controller.ts' && item.line === 1));
  });
});

test('opencode-style primary tools read grep glob and list work for discovery flows', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      ['export async function login(user) {', "  return `hi ${user}`;", '}'].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'index.ts'),
      ["export * from './auth/service';"].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);

    const listed = await handlers.list({ path: 'src' });
    assert.equal(listed.path, 'src');
    assert.ok(listed.items.some((item) => item.type === 'dir' && item.name === 'auth'));

    const globbed = await handlers.glob({ pattern: 'src/**/*.ts' });
    assert.ok(globbed.matches.includes('src/auth/service.ts'));
    assert.ok(globbed.matches.includes('src/index.ts'));

    const grepped = await handlers.grep({ pattern: 'login', path: 'src' });
    assert.ok(grepped.matches.some((item) => item.path === 'src/auth/service.ts'));

    const metadata = await handlers.read({ path: 'src/auth/service.ts' });
    assert.equal(metadata.phase, 'metadata');

    const content = await handlers.read({
      path: 'src/auth/service.ts',
      include_content: true,
      read_token: metadata.read_token
    });
    assert.equal(content.phase, 'content');
    assert.match(content.content, /login/);
  });
});

test('read returns minimal structured code context windows', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        "import { hashPassword } from './crypto';",
        "import type { LoginRequest } from './types';",
        '',
        'export async function login(request: LoginRequest) {',
        '  const hashed = await hashPassword(request.password);',
        '  return { ok: true, hashed };',
        '}',
        '',
        'function helperValue(input: string) {',
        '  return input.trim();',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const meta = await handlers.read({ path: 'src/auth/service.ts', start_line: 1, end_line: 11 });
    assert.equal(meta.phase, 'metadata');
    const context = await handlers.read({
      path: 'src/auth/service.ts',
      start_line: 1,
      end_line: 11,
      include_content: true,
      read_token: meta.read_token
    });
    assert.equal(context.phase, 'content');
    assert.match(context.content, /export async function login/);
    assert.match(context.content, /helperValue/);
  });
});

test('edit applies stable minimal edits through symbol-targeted block replacement', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'service.ts');
    await fs.writeFile(
      targetPath,
      [
        "import { api } from './api';",
        '',
        'export function loginResult(value) {',
        '  return value;',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const replaced = await handlers.edit({
      file: 'src/service.ts',
      symbol: 'loginResult',
      edit: {
        kind: 'replace_block',
        new_content: ['export function loginResult(value) {', '  return { ok: true, value };', '}'].join('\n')
      }
    });
    assert.equal(replaced.ok, true);
    assert.match(replaced.diff, /\+  return \{ ok: true, value \};/);

    const textReplaced = await handlers.edit({
      file: 'src/service.ts',
      edit: {
        kind: 'replace_text',
        old_text: 'return { ok: true, value };',
        new_text: 'return normalize({ ok: true, value });'
      }
    });
    assert.equal(textReplaced.ok, true);

    const afterText = await fs.readFile(targetPath, 'utf8');
    assert.match(afterText, /normalize/);
  });
});

test('generate_diff compares current file with proposed content', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const diff = await handlers.generate_diff({
      path: 'src/demo.ts',
      new_content: 'export const value = 2;\n'
    });

    assert.equal(diff.path, 'src/demo.ts');
    assert.match(diff.diff, /-export const value = 1;/);
    assert.match(diff.diff, /\+export const value = 2;/);
  });
});

test('patch applies a unified diff to a file', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'demo.tsx'),
      [
        "import React from 'react';",
        '',
        'export function Demo() {',
        '  return <div className="demo">Old</div>;',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.patch({
      patch: [
        '--- src/demo.tsx',
        '+++ src/demo.tsx',
        '@@ -1,5 +1,5 @@',
        " import React from 'react';",
        '',
        ' export function Demo() {',
        '-  return <div className="demo">Old</div>;',
        '+  return <div className="demo">New</div>;',
        '}'
      ].join('\n')
    });

    assert.equal(result.ok, true);
    const after = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.tsx'), 'utf8');
    assert.match(after, /New/);
  });
});

test('write blocks full overwrite for existing code files unless explicitly allowed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.writeFile(targetPath, 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);

    await assert.rejects(
      () =>
        handlers.write({
          path: 'src/demo.ts',
          content: 'export const value = 2;\n'
        }),
      /full_file_rewrite|edit|grep|read/i
    );
  });
});

test('write still allows new files and explicit full rewrites for code files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);

    const created = await handlers.write({
      path: 'src/new-file.ts',
      content: 'export const created = true;\n'
    });
    assert.equal(created.action, 'create');

    const overwritten = await handlers.write({
      path: 'src/demo.ts',
      content: 'export const value = 2;\n',
      full_file_rewrite: true
    });
    assert.equal(overwritten.action, 'overwrite');

    const afterText = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8');
    assert.match(afterText, /value = 2/);
  });
});

test('opencode-style write and run tools execute through the existing runtime', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['printf'];
    });

    const written = await handlers.write({
      path: 'notes.txt',
      content: 'hello\n'
    });
    assert.equal(written.action, 'create');

    const result = await handlers.run({
      command: 'printf ok'
    });
    assert.equal(result.stdout, 'ok');
  });
});

test('grep and edit provide a compact high-level workflow', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        "import { api } from './api';",
        '',
        'export async function login(user, password) {',
        '  return api.login(user, password);',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const located = await handlers.grep({ pattern: 'login', path: 'src', max_results: 5 });
    assert.ok(Array.isArray(located.matches));
    assert.equal(located.matches[0].path, 'src/auth/service.ts');

    const edited = await handlers.edit({
      file: located.matches[0].path,
      symbol: 'login',
      edit: {
        kind: 'replace_block',
        new_content: [
          'export async function login(user, password) {',
          '  const response = await api.login(user, password);',
          '  return { ok: true, response };',
          '}'
        ].join('\n')
      }
    });

    assert.equal(edited.ok, true);
    assert.match(edited.diff, /\+  const response = await api\.login/);
  });
});

test('builtin tool definitions expose only current primary and structured tools', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, handlers } = getBuiltinTools({ workspaceRoot, config });
    const names = definitions.map((tool) => tool.function.name);

    assert.ok(names.includes('read'));
    assert.ok(names.includes('grep'));
    assert.ok(names.includes('glob'));
    assert.ok(names.includes('list'));
    assert.ok(names.includes('edit'));
    assert.ok(names.includes('write'));
    assert.ok(names.includes('run'));
    assert.ok(!names.includes('locate'));
    assert.ok(!names.includes('search_code'));
    assert.ok(!names.includes('read_block'));
    assert.ok(!names.includes('read_symbol_context'));
    assert.ok(!names.includes('open_target'));
    assert.ok(!names.includes('edit_target'));
    assert.ok(!names.includes('replace_block'));
    assert.ok(!names.includes('replace_text'));
    assert.ok(!names.includes('insert_before'));
    assert.ok(!names.includes('insert_after'));
    assert.ok(!names.includes('validate_edit'));
    assert.equal(typeof handlers.replace_block, 'undefined');
    assert.equal(typeof handlers.read, 'function');
    assert.equal(typeof handlers.edit, 'function');
    assert.equal(typeof handlers.write, 'function');
    assert.equal(typeof handlers.run, 'function');
  });
});

test('edit modifies existing files through symbol-targeted blocks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'math.js'),
      ['export function add(a, b) {', '  return a + b;', '}'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const edited = await handlers.edit({
      file: 'src/math.js',
      symbol: 'add',
      edit: {
        kind: 'replace_block',
        new_content: ['export function add(a, b) {', '  return a + b + 1;', '}'].join('\n')
      }
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(path.join(workspaceRoot, 'src', 'math.js'), 'utf8');
    assert.match(after, /return a \+ b \+ 1;/);
  });
});

test('edit can rewrite a file when given only new_content', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'ProfileCard.tsx');
    await fs.writeFile(targetPath, [
      "import React from 'react';",
      '',
      'export function ProfileCard() {',
      '  return <article className="profile-card">Hi</article>;',
      '}'
    ].join('\n'), 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const edited = await handlers.edit({
      file: 'src/ProfileCard.tsx',
      edit: {
        new_content: [
          "import React from 'react';",
          '',
          'export function ProfileCard({ compact }: { compact?: boolean }) {',
          '  return (',
          '    <article className={compact ? "profile-card compact" : "profile-card"}>',
          '      Hi',
          '    </article>',
          '  );',
          '}'
        ].join('\n')
      }
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(targetPath, 'utf8');
    assert.match(after, /compact\?: boolean/);
    assert.match(after, /profile-card compact/);
  });
});

test('edit can recover when the target block shifts to a new line range', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'page.html'),
      [
        '<style>',
        '.hero {',
        '  color: red;',
        '}',
        '</style>',
        '<div class="hero">',
        '  Hello',
        '</div>'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);

    await handlers.edit({
      file: 'src/page.html',
      edit: {
        kind: 'insert_before',
        anchor_text: '<div class="hero">',
        content: '<section>\n'
      }
    });

    const replaced = await handlers.edit({
      file: 'src/page.html',
      line: 6,
      edit: {
        kind: 'replace_block',
        new_content: ['<div class="hero">', '  Updated', '</div>'].join('\n')
      }
    });

    assert.equal(replaced.ok, true);
    const after = await fs.readFile(path.join(workspaceRoot, 'src', 'page.html'), 'utf8');
    assert.match(after, /Updated/);
  });
});

test('run rejects long-running service commands and points callers to start_service', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['npm'];
    });

    await assert.rejects(
      () => handlers.run({ command: 'npm start --silent' }),
      /start_service/i
    );
    await assert.rejects(
      () => handlers.run({ command: 'vite' }),
      /frontend service/i
    );
  });
});

test('classifyCommandIntent separates install, service, and generic commands', () => {
  assert.deepEqual(classifyCommandIntent('npm install'), { kind: 'install', longRunning: false });
  assert.deepEqual(classifyCommandIntent('npm run dev'), { kind: 'service', longRunning: true });
  assert.deepEqual(classifyCommandIntent('npm run build'), { kind: 'build', longRunning: false });
  assert.deepEqual(classifyCommandIntent('npm test'), { kind: 'test', longRunning: false });
  assert.deepEqual(classifyCommandIntent('vite'), { kind: 'frontend-service', longRunning: true });
  assert.deepEqual(classifyCommandIntent('uvicorn app:app'), { kind: 'backend-service', longRunning: true });
  assert.deepEqual(classifyCommandIntent('docker compose up'), { kind: 'docker-service', longRunning: true });
  assert.deepEqual(classifyCommandIntent('echo hello'), { kind: 'generic', longRunning: false });
});

test('run blocked suggestions prefer structured tools before shell fallback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['node'];
    });

    await assert.rejects(
      () => handlers.run({ command: 'perl -e "print 1"' }),
      (error) => {
        assert.match(String(error?.message || ''), /read/i);
        assert.match(String(error?.message || ''), /edit/i);
        assert.match(String(error?.message || ''), /shell fallback/i);
        return true;
      }
    );
  });
});

test('service tools manage a long-running process lifecycle with compact status', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['node'];
    });

    const started = await handlers.start_service({
      command:
        "node -e 'console.log(\"Service ready on http://127.0.0.1:4310\"); setInterval(() => console.log(\"tick\"), 200)'",
      startup_timeout_ms: 1200,
      success_matchers: ['Service ready'],
      port_probe: 4310
    });

    assert.equal(started.status, 'running');
    assert.equal(started.startup_confirmed, true);
    assert.ok(started.task_id);
    assert.ok(Array.isArray(started.recent_logs));
    assert.ok(['output', 'startup_window', 'port_probe'].includes(started.startup_source));
    assert.equal(typeof started.log_cursor, 'number');

    const status = await handlers.get_service_status({ task_id: started.task_id });
    assert.equal(status.task_id, started.task_id);
    assert.equal(status.status, 'running');

    const listed = await handlers.list_services({});
    assert.ok(Array.isArray(listed.services));
    assert.ok(listed.services.some((item) => item.task_id === started.task_id));

    const logs = await handlers.get_service_logs({ task_id: started.task_id, tail: 10 });
    assert.equal(logs.task_id, started.task_id);
    assert.ok(Array.isArray(logs.recent_logs));
    assert.equal(typeof logs.next_cursor, 'number');

    await new Promise((resolve) => setTimeout(resolve, 250));
    const incrementalLogs = await handlers.get_service_logs({
      task_id: started.task_id,
      tail: 10,
      after_cursor: logs.next_cursor
    });
    assert.equal(incrementalLogs.task_id, started.task_id);
    assert.ok(Array.isArray(incrementalLogs.recent_logs));
    assert.equal(typeof incrementalLogs.next_cursor, 'number');

    const stopped = await handlers.stop_service({ task_id: started.task_id });
    assert.equal(stopped.task_id, started.task_id);
    assert.equal(stopped.stopped, true);
  });
});

test('start_service confirms dev-server style startup without blocking on process exit', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'codemini-dev-server-test',
          private: true,
          scripts: {
            start: "node -e 'console.log(\"dev server ready on http://127.0.0.1:3000\"); setInterval(() => {}, 1000)'"
          }
        },
        null,
        2
      ),
      'utf8'
    );

    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
    });

    const startedAt = Date.now();
    const result = await handlers.start_service({
      command: 'npm start --silent',
      startup_timeout_ms: 1200,
      success_matchers: ['dev server ready']
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 'running');
    assert.equal(result.startup_confirmed, true);
    assert.ok(result.task_id);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(result.startup_source));
    assert.ok(elapsedMs < 1300, `expected startup confirmation before startup timeout, got ${elapsedMs}ms`);

    const stopped = await handlers.stop_service({ task_id: result.task_id });
    assert.equal(stopped.stopped, true);
  });
});

test('start_service exposes configured http_probe metadata on service snapshots', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['node'];
    });

    const started = await handlers.start_service({
      command:
        "node -e 'console.log(\"HTTP probe placeholder service\"); setInterval(() => {}, 1000)'",
      startup_timeout_ms: 1200,
      http_probe: {
        url: 'http://127.0.0.1:4310/health',
        expect_status: 200
      }
    });

    assert.deepEqual(started.http_probe, {
      url: 'http://127.0.0.1:4310/health',
      expect_status: 200
    });

    const status = await handlers.get_service_status({ task_id: started.task_id });
    assert.deepEqual(status.http_probe, {
      url: 'http://127.0.0.1:4310/health',
      expect_status: 200
    });

    await handlers.stop_service({ task_id: started.task_id });
  });
});

test('start_service confirms java-style startup output', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['node'];
    });

    const startedAt = Date.now();
    const result = await handlers.start_service({
      command:
        "node -e 'console.log(\"Tomcat started on port(s): 8080 (http) with context path \\\"\\\"\"); setInterval(() => {}, 1000)' # java -jar demo.jar",
      startup_timeout_ms: 1200
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 'running');
    assert.equal(result.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(result.startup_source));
    assert.ok(elapsedMs < 1300, `expected java-style startup confirmation before startup timeout, got ${elapsedMs}ms`);

    const stopped = await handlers.stop_service({ task_id: result.task_id });
    assert.equal(stopped.stopped, true);
  });
});

test('start_service confirms dotnet and go-style startup output', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['node'];
    });

    const dotnetStartedAt = Date.now();
    const dotnetResult = await handlers.start_service({
      command:
        "node -e 'console.log(\"Now listening on: http://localhost:5099\"); setInterval(() => {}, 1000)' # dotnet run",
      startup_timeout_ms: 1200
    });
    const dotnetElapsedMs = Date.now() - dotnetStartedAt;

    assert.equal(dotnetResult.status, 'running');
    assert.equal(dotnetResult.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(dotnetResult.startup_source));
    assert.ok(dotnetElapsedMs < 1300, `expected dotnet-style startup confirmation before startup timeout, got ${dotnetElapsedMs}ms`);

    const goStartedAt = Date.now();
    const goResult = await handlers.start_service({
      command:
        "node -e 'console.log(\"Starting development server at http://127.0.0.1:8080\"); setInterval(() => {}, 1000)' # go run ./cmd/server",
      startup_timeout_ms: 1200
    });
    const goElapsedMs = Date.now() - goStartedAt;

    assert.equal(goResult.status, 'running');
    assert.equal(goResult.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(goResult.startup_source));
    assert.ok(goElapsedMs < 1300, `expected go-style startup confirmation before startup timeout, got ${goElapsedMs}ms`);

    await handlers.stop_service({ task_id: dotnetResult.task_id });
    await handlers.stop_service({ task_id: goResult.task_id });
  });
});

test('edit resolves JSX and Python blocks from symbol hints', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'ui'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'backend'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'ui', 'LoginForm.tsx'),
      [
        "import React from 'react';",
        '',
        'export function LoginForm() {',
        '  return (',
        '    <section>',
        '      <h1>Login</h1>',
        '      <button>Submit</button>',
        '    </section>',
        '  );',
        '}',
        '',
        'export function OtherView() {',
        '  return <div>Other</div>;',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'backend', 'auth.py'),
      [
        'def login(user, password):',
        '    token = issue_token(user)',
        '    if not token:',
        "        raise ValueError('missing token')",
        '    return token',
        '',
        'def logout(user):',
        '    return True'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const jsxEdit = await handlers.edit({
      file: 'src/ui/LoginForm.tsx',
      symbol: 'LoginForm',
      edit: {
        kind: 'replace_block',
        new_content: [
          'export function LoginForm() {',
          '  return (',
          '    <section>',
          '      <h1>Sign in</h1>',
          '      <button>Submit</button>',
          '    </section>',
          '  );',
          '}'
        ].join('\n')
      }
    });
    assert.equal(jsxEdit.ok, true);

    const pythonEdit = await handlers.edit({
      file: 'backend/auth.py',
      symbol: 'login',
      edit: {
        kind: 'replace_block',
        new_content: [
          'def login(user, password):',
          '    token = issue_token(user)',
          '    if not token:',
          "        raise ValueError('missing token')",
          '    return token.strip()'
        ].join('\n')
      }
    });
    assert.equal(pythonEdit.ok, true);
  });
});

test('grep filters by language and glob narrows candidate files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'backend'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        "import { api } from './api';",
        "import { normalizeLogin } from './normalize';",
        "import type { LoginRequest, LoginResponse } from './types';",
        '',
        'type LoginMode = "password" | "oauth";',
        '',
        'export async function login(user, password): Promise<LoginResponse> {',
        '  const response = await api.login(user, password);',
        '  return normalizeLogin(response);',
        '}',
        '',
        'export async function runLoginFlow(request) {',
        '  return login(request.user, request.password);',
        '}',
        '',
        'export async function runLoginAgain(request) {',
        '  return login(request.user, request.password);',
        '}',
        '',
        'export async function runLoginThird(request) {',
        '  return login(request.user, request.password);',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'backend', 'auth.py'),
      [
        'def login(user, password):',
        '    return True'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'backend', 'AuthService.java'),
      [
        'public class AuthService {',
        '    public boolean login(String user, String password) {',
        '        return true;',
        '    }',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const tsOnly = await handlers.grep({ pattern: 'login', path: '.', language: 'ts' });
    assert.ok(tsOnly.matches.every((item) => item.path.endsWith('.ts')));

    const pyOnly = await handlers.grep({ pattern: 'login', path: '.', file_types: ['py'] });
    assert.ok(pyOnly.matches.every((item) => item.path.endsWith('.py')));

    const javaOnly = await handlers.grep({ pattern: 'login', path: '.', language: 'java' });
    assert.ok(javaOnly.matches.every((item) => item.path.endsWith('.java')));

    const tsFiles = await handlers.glob({ pattern: '**/*.ts', path: '.' });
    assert.ok(tsFiles.matches.includes('src/auth/service.ts'));
    assert.ok(!tsFiles.matches.includes('backend/auth.py'));
  });
});
