import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { loadConfig } from '../src/core/config-store.js';

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

test('search_code returns structured top matches with basic classification', async () => {
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
    const result = await handlers.search_code({ query: 'login', path: 'src', max_results: 10 });

    assert.equal(result.query, 'login');
    assert.ok(Array.isArray(result.matches));
    assert.ok(Array.isArray(result.definitions));
    assert.ok(Array.isArray(result.references));
    assert.ok(Array.isArray(result.text_matches));
    assert.equal(result.matches[0].file, 'src/auth/service.ts');
    assert.equal(result.matches[0].kind, 'definition');
    assert.equal(result.matches[1].kind, 'reference');
    assert.equal(result.definitions[0].file, 'src/auth/service.ts');
    assert.equal(result.references[0].file, 'src/auth/controller.ts');
  });
});

test('read_block and read_symbol_context return minimal structured code context', async () => {
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
    const block = await handlers.read_block({ path: 'src/auth/service.ts', symbol: 'login' });
    assert.equal(block.file, 'src/auth/service.ts');
    assert.equal(block.symbol, 'login');
    assert.match(block.content, /export async function login/);
    assert.ok(block.end_line >= block.start_line);

    const context = await handlers.read_symbol_context({ path: 'src/auth/service.ts', symbol: 'login' });
    assert.equal(context.file, 'src/auth/service.ts');
    assert.equal(context.symbol, 'login');
    assert.match(context.main_block.content, /hashPassword/);
    assert.equal(context.related.imports.length, 2);
    assert.ok(context.related.local_symbols.some((item) => item.name === 'helperValue'));
  });
});

test('edit tools apply stable minimal edits and produce validation metadata', async () => {
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
    const validation = await handlers.validate_edit({
      path: 'src/service.ts',
      kind: 'replace_block',
      target: { start_line: 3, end_line: 5 }
    });
    assert.equal(validation.ok, true);
    assert.ok(validation.target.old_hash.startsWith('sha256:'));

    const replaced = await handlers.replace_block({
      path: 'src/service.ts',
      target: { start_line: 3, end_line: 5, old_hash: validation.target.old_hash },
      new_content: ['export function loginResult(value) {', '  return { ok: true, value };', '}'].join('\n')
    });
    assert.equal(replaced.ok, true);
    assert.match(replaced.diff, /\+  return \{ ok: true, value \};/);

    const inserted = await handlers.insert_after({
      path: 'src/service.ts',
      anchor_text: "import { api } from './api';",
      content: "\nimport { normalize } from './normalize';"
    });
    assert.equal(inserted.ok, true);

    const textReplaced = await handlers.replace_text({
      path: 'src/service.ts',
      old_text: 'return { ok: true, value };',
      new_text: 'return normalize({ ok: true, value });'
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

test('write_file blocks full overwrite for existing code files unless explicitly allowed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.writeFile(targetPath, 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);

    await assert.rejects(
      () =>
        handlers.write_file({
          path: 'src/demo.ts',
          content: 'export const value = 2;\n'
        }),
      /full_file_rewrite|edit_target|open_target|locate/i
    );
  });
});

test('write_file still allows new files and explicit full rewrites for code files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);

    const created = await handlers.write_file({
      path: 'src/new-file.ts',
      content: 'export const created = true;\n'
    });
    assert.equal(created.action, 'create');

    const overwritten = await handlers.write_file({
      path: 'src/demo.ts',
      content: 'export const value = 2;\n',
      full_file_rewrite: true
    });
    assert.equal(overwritten.action, 'overwrite');

    const afterText = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8');
    assert.match(afterText, /value = 2/);
  });
});

test('locate, open_target, and edit_target provide a compact high-level workflow', async () => {
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
    const located = await handlers.locate({ query: 'login', path: 'src' });
    assert.ok(Array.isArray(located.matches));
    assert.ok(Array.isArray(located.definitions));
    assert.equal(located.matches[0].file, 'src/auth/service.ts');

    const opened = await handlers.open_target({
      file: located.matches[0].file,
      line: located.matches[0].line,
      symbol: 'login'
    });
    assert.equal(opened.file, 'src/auth/service.ts');
    assert.match(opened.main_block.content, /api\.login/);
    assert.ok(opened.edit_target.old_hash.startsWith('sha256:'));

    const edited = await handlers.edit_target({
      file: opened.file,
      edit: {
        kind: 'replace_block',
        target: opened.edit_target,
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

test('edit_target accepts top-level edit fields as a compatibility fallback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'math.js'),
      ['export function add(a, b) {', '  return a + b;', '}'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const opened = await handlers.open_target({
      file: 'src/math.js',
      symbol: 'add'
    });

    const edited = await handlers.edit_target({
      file: 'src/math.js',
      kind: 'replace_block',
      target: opened.edit_target,
      new_content: [
        'export function add(a, b) {',
        '  return a + b;',
        '}',
        '',
        'export function subtract(a, b) {',
        '  return a - b;',
        '}'
      ].join('\n')
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(path.join(workspaceRoot, 'src', 'math.js'), 'utf8');
    assert.match(after, /export function subtract/);
  });
});

test('run_command rejects long-running service commands and points callers to start_service', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['npm'];
    });

    await assert.rejects(
      () => handlers.run_command({ command: 'npm start --silent' }),
      /start_service/i
    );
  });
});

test('run_command blocked suggestions prefer structured tools before shell fallback', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['node'];
    });

    await assert.rejects(
      () => handlers.run_command({ command: 'perl -e "print 1"' }),
      (error) => {
        assert.match(String(error?.message || ''), /locate/i);
        assert.match(String(error?.message || ''), /open_target/i);
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

test('read_block detects JSX component blocks and indentation-based Python functions', async () => {
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
    const jsxBlock = await handlers.read_block({ path: 'src/ui/LoginForm.tsx', symbol: 'LoginForm' });
    assert.equal(jsxBlock.start_line, 3);
    assert.equal(jsxBlock.end_line, 10);
    assert.match(jsxBlock.content, /<section>/);
    assert.doesNotMatch(jsxBlock.content, /OtherView/);

    const pythonBlock = await handlers.read_block({ path: 'backend/auth.py', symbol: 'login' });
    assert.equal(pythonBlock.start_line, 1);
    assert.equal(pythonBlock.end_line, 5);
    assert.match(pythonBlock.content, /raise ValueError/);
    assert.doesNotMatch(pythonBlock.content, /def logout/);

    const opened = await handlers.open_target({ file: 'src/ui/LoginForm.tsx', symbol: 'LoginForm' });
    assert.equal(opened.main_block.start_line, 3);
    assert.equal(opened.main_block.end_line, 10);
  });
});

test('search filters by language and open_target returns bounded call summaries', async () => {
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
    const tsOnly = await handlers.search_code({ query: 'login', path: '.', language: 'ts' });
    assert.ok(tsOnly.matches.every((item) => item.file.endsWith('.ts')));

    const pyOnly = await handlers.search_code({ query: 'login', path: '.', file_types: ['py'] });
    assert.ok(pyOnly.matches.every((item) => item.file.endsWith('.py')));

    const javaOnly = await handlers.search_code({ query: 'login', path: '.', language: 'java' });
    assert.ok(javaOnly.matches.every((item) => item.file.endsWith('.java')));

    const opened = await handlers.open_target({
      file: 'src/auth/service.ts',
      symbol: 'login',
      max_related_calls: 2
    });
    assert.ok(Array.isArray(opened.related.calls));
    assert.equal(opened.related.calls.length, 2);
    assert.equal(opened.related.calls[0].symbol, 'runLoginFlow');
    assert.ok(Array.isArray(opened.related.import_signatures));
    assert.ok(Array.isArray(opened.related.type_signatures));
    assert.match(opened.related.import_signatures[0], /api/);
    assert.ok(opened.related.type_signatures.some((item) => /LoginResponse/.test(item)));
  });
});
