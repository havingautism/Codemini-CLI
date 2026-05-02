import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { getBuiltinTools } from '../src/core/tools.js';
import { loadConfig } from '../src/core/config-store.js';
import { classifyCommandIntent } from '../src/core/shell.js';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { listInbox, listMemories } from '../src/core/memory-store.js';
import { sanitizeTextForModel } from '../src/core/tool-output.js';

async function withTempWorkspace(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-tools-'));
  try {
    await run(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function withTempConfigDir(run) {
  const prev = process.env.CODEMINI_GLOBAL_DIR;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-global-'));
  process.env.CODEMINI_GLOBAL_DIR = dir;
  try {
    await run(dir);
  } finally {
    if (prev === undefined) {
      delete process.env.CODEMINI_GLOBAL_DIR;
    } else {
      process.env.CODEMINI_GLOBAL_DIR = prev;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function makeTools(workspaceRoot) {
  const config = await loadConfig();
  return getBuiltinTools({ workspaceRoot, config });
}

async function makeToolsWithFff(workspaceRoot, fffAdapter, mutateConfig) {
  const config = await loadConfig();
  if (typeof mutateConfig === 'function') mutateConfig(config);
  return getBuiltinTools({ workspaceRoot, config, fffAdapter });
}

async function makeToolsWithSystemEvents(workspaceRoot, onSystemEvent) {
  const config = await loadConfig();
  return getBuiltinTools({ workspaceRoot, config, onSystemEvent });
}

async function makeToolsWithConfig(workspaceRoot, mutate) {
  const config = await loadConfig();
  if (typeof mutate === 'function') mutate(config);
  return getBuiltinTools({ workspaceRoot, config });
}

async function withHttpServer(handler, run) {
  const server = http.createServer(handler);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES') {
      server.close();
      test.skip(`local HTTP server unavailable in this environment: ${error.code}`);
      return;
    }
    throw error;
  }
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}`;
  try {
    await run({ server, url });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
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

test('grep prefers FFF search results when adapter is available', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fffCalls = [];
    const fffAdapter = {
      async grep(args) {
        fffCalls.push(args);
        return {
          pattern: args.pattern,
          matches: [
            {
              path: 'src/auth/service.ts',
              line: 3,
              column: 16,
              preview: 'export async function login(username, password) {'
            }
          ],
          truncated: false
        };
      }
    };

    const { handlers } = await makeToolsWithFff(workspaceRoot, fffAdapter);
    const result = await handlers.grep({ pattern: 'login', path: 'src', max_results: 5 });

    assert.equal(fffCalls.length, 1);
    assert.equal(fffCalls[0].pattern, 'login');
    assert.equal(result.matches[0].path, 'src/auth/service.ts');
  });
});

test('grep falls back to builtin search when FFF adapter fails', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        "import { hashPassword } from './crypto';",
        '',
        'export async function login(username, password) {',
        '  return hashPassword(password);',
        '}'
      ].join('\n'),
      'utf8'
    );

    let attempted = 0;
    const fffAdapter = {
      async grep() {
        attempted += 1;
        throw new Error('fff unavailable');
      }
    };

    const { handlers } = await makeToolsWithFff(workspaceRoot, fffAdapter);
    const result = await handlers.grep({ pattern: 'login', path: 'src', max_results: 5 });

    assert.equal(attempted, 1);
    assert.ok(result.matches.some((item) => item.path === 'src/auth/service.ts' && item.line === 3));
  });
});

test('glob prefers FFF file search results when adapter is available', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fffCalls = [];
    const fffAdapter = {
      async glob(args) {
        fffCalls.push(args);
        return {
          pattern: args.pattern,
          matches: ['src/auth/service.ts', 'src/index.ts'],
          truncated: false
        };
      }
    };

    const { handlers } = await makeToolsWithFff(workspaceRoot, fffAdapter);
    const result = await handlers.glob({ pattern: 'src/**/*.ts', max_results: 10 });

    assert.equal(fffCalls.length, 1);
    assert.deepEqual(result.matches, ['src/auth/service.ts', 'src/index.ts']);
  });
});

test('list keeps directory-shaped results when FFF adapter handles nested path listing', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fffCalls = [];
    const fffAdapter = {
      async list(args) {
        fffCalls.push(args);
        return {
          path: 'src',
          items: [
            { name: 'auth', path: 'src/auth', type: 'dir' },
            { name: 'index.ts', path: 'src/index.ts', type: 'file' }
          ]
        };
      }
    };

    const { handlers } = await makeToolsWithFff(workspaceRoot, fffAdapter);
    const result = await handlers.list({ path: 'src' });

    assert.equal(fffCalls.length, 1);
    assert.equal(result.path, 'src');
    assert.deepEqual(result.items, [
      { name: 'auth', path: 'src/auth', type: 'dir' },
      { name: 'index.ts', path: 'src/index.ts', type: 'file' }
    ]);
  });
});

test('FFF adapter client is reused across multiple tool calls in one tools instance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let connects = 0;
    const calls = [];
    const fffAdapter = {
      async connect() {
        connects += 1;
      },
      async grep(args) {
        calls.push(`grep:${args.pattern}`);
        return {
          pattern: args.pattern,
          matches: [{ path: 'src/auth/service.ts', line: 3, column: 1, preview: 'login' }],
          truncated: false
        };
      },
      async glob(args) {
        calls.push(`glob:${args.pattern}`);
        return {
          pattern: args.pattern,
          matches: ['src/auth/service.ts'],
          truncated: false
        };
      }
    };

    const { handlers } = await makeToolsWithFff(workspaceRoot, fffAdapter);
    await handlers.grep({ pattern: 'login', path: 'src' });
    await handlers.glob({ pattern: 'src/**/*.ts' });

    assert.equal(connects, 1);
    assert.deepEqual(calls, ['grep:login', 'glob:src/**/*.ts']);
  });
});

test('FFF adapter dispose is called when toolset is disposed', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let disposed = 0;
    const fffAdapter = {
      async connect() {},
      async grep(args) {
        return {
          pattern: args.pattern,
          matches: [{ path: 'src/auth/service.ts', line: 3, column: 1, preview: 'login' }],
          truncated: false
        };
      },
      async dispose() {
        disposed += 1;
      }
    };

    const toolset = await makeToolsWithFff(workspaceRoot, fffAdapter);
    await toolset.handlers.grep({ pattern: 'login', path: 'src' });
    await toolset.dispose();

    assert.equal(disposed, 1);
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

    const content = await handlers.read({ path: 'src/auth/service.ts' });
    assert.equal(content.phase, 'content');
    assert.match(content.content, /login/);
  });
});

test('save_memory tool persists project memory entries', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeTools(workspaceRoot);

    const saved = await handlers.save_memory({
      content: 'src/auth.ts 是登录核心模块，改动时先补测试。',
      kind: 'module',
      scope: 'project'
    });
    const memories = await listMemories({ scope: 'project', workspaceRoot });

    assert.equal(saved.ok, true);
    assert.equal(memories.length, 1);
    assert.equal(memories[0].kind, 'module');
    assert.match(memories[0].content, /src\/auth\.ts/);
  });
});

test('update_todos normalizes and replaces the session todo checklist', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let currentTodos = [
      {
        content: 'Inspect auth flow',
        activeForm: 'Inspecting auth flow',
        status: 'in_progress'
      }
    ];
    const { handlers, formatters } = await makeTools(workspaceRoot);
    const { handlers: customHandlers, formatters: customFormatters } = await (async () => {
      const config = await loadConfig();
      return getBuiltinTools({
        workspaceRoot,
        config,
        getTodos: () => currentTodos,
        onTodosUpdate: (todos) => {
          currentTodos = todos;
        }
      });
    })();

    assert.ok(handlers.read);
    assert.ok(formatters.read);

    const result = await customHandlers.update_todos({
      todos: [
        {
          content: 'Inspect auth flow',
          activeForm: 'Inspecting auth flow',
          status: 'completed'
        },
        {
          content: 'Run focused verification',
          activeForm: 'Running focused verification',
          status: 'in_progress'
        },
        {
          content: '  ',
          activeForm: 'Ignored invalid item',
          status: 'pending'
        }
      ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.oldTodos.length, 1);
    assert.equal(result.newTodos.length, 2);
    assert.equal(currentTodos.length, 2);
    assert.match(customFormatters.update_todos(result), /Updated todo list:/);
    assert.match(customFormatters.update_todos(result), /\[x\] Inspect auth flow/);
    assert.match(customFormatters.update_todos(result), /\[~\] Run focused verification/);
  });
});

test('read_plan and update_plan manage normalized plan state', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    let currentPlan = {
      status: 'pending_approval',
      source: 'auto',
      goal: 'Tighten auth workflow',
      summary: 'Inspect and implement auth updates',
      steps: [
        { title: 'Inspect auth module', role: 'planner', task: 'Map auth entry points' }
      ]
    };

    const { handlers, formatters } = await (async () => {
      const config = await loadConfig();
      return getBuiltinTools({
        workspaceRoot,
        config,
        getPlanState: () => currentPlan,
        onPlanStateUpdate: (planState) => {
          currentPlan = planState;
        }
      });
    })();

    const readBefore = await handlers.read_plan({});
    assert.equal(readBefore.ok, true);
    assert.equal(readBefore.plan?.status, 'pending_approval');
    assert.equal(readBefore.hasPendingApproval, true);

    const updated = await handlers.update_plan({
      plan: {
        status: 'approved',
        source: 'auto',
        goal: 'Tighten auth workflow',
        filePath: '.codemini/plans/auth-plan.md',
        summary: 'Approved auth plan',
        finalSummary: 'Ready to execute',
        steps: [
          { title: 'Implement auth patch', role: 'coder', task: 'Update auth guard checks' },
          { title: 'Verify auth flows', role: 'tester', task: 'Run focused auth tests' }
        ]
      }
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.oldPlan?.status, 'pending_approval');
    assert.equal(updated.newPlan?.status, 'approved');
    assert.equal(updated.hasPendingApproval, false);
    assert.equal(currentPlan?.status, 'approved');
    assert.match(formatters.read_plan(readBefore), /Current plan state:/);
    assert.match(formatters.update_plan(updated), /status: approved/);

    const cleared = await handlers.update_plan({ clear: true });
    assert.equal(cleared.ok, true);
    assert.equal(cleared.newPlan, null);
    assert.equal(currentPlan, null);
    assert.match(formatters.update_plan(cleared), /Plan state cleared/i);
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
    const context = await handlers.read({ path: 'src/auth/service.ts', start_line: 1, end_line: 11 });
    assert.equal(context.phase, 'content');
    assert.match(context.content, /export async function login/);
    assert.match(context.content, /helperValue/);
  });
});

test('read accepts demo-style file_path plus offset and limit aliases', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'demo.ts'),
      ['line 1', 'line 2', 'line 3', 'line 4'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.read({
      file_path: 'src/demo.ts',
      offset: 2,
      limit: 2
    });

    assert.equal(result.phase, 'content');
    assert.equal(result.start_line, 2);
    assert.equal(result.end_line, 3);
    assert.match(result.content, /line 2/);
    assert.match(result.content, /line 3/);
    assert.doesNotMatch(result.content, /line 1/);
  });
});

test('read repairs inline path ranges into start and end lines', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'demo-inline-range.ts'),
      ['alpha', 'beta', 'gamma', 'delta'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.read({ path: 'src/demo-inline-range.ts:2-3' });

    assert.equal(result.phase, 'content');
    assert.equal(result.path, 'src/demo-inline-range.ts');
    assert.equal(result.start_line, 2);
    assert.equal(result.end_line, 3);
    assert.match(result.content, /beta/);
    assert.match(result.content, /gamma/);
    assert.doesNotMatch(result.content, /alpha/);
  });
});

test('read can consume an ast_target directly for node-scoped reads', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export function loginUser(name: string) {',
        '  return name;',
        '}',
        '',
        'export function logoutUser(name: string) {',
        '  return name.toUpperCase();',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const query = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(function_declaration (identifier) @loginUser)',
      capture_name: 'loginUser'
    });

    const result = await handlers.read({
      ast_target: query.matches[0].ast_target
    });

    assert.equal(result.path, 'src/auth.ts');
    assert.match(result.content, /loginUser/);
    assert.doesNotMatch(result.content, /logoutUser/);
  });
});

test('read can run an inline ast query before returning the matched node content', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export function loginUser(name: string) {',
        '  return name;',
        '}',
        '',
        'export function logoutUser(name: string) {',
        '  return name.toUpperCase();',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.read({
      path: 'src/auth.ts',
      query: '(function_declaration name: (identifier) @fn (#eq? @fn "logoutUser"))',
      capture_name: 'fn'
    });

    assert.equal(result.path, 'src/auth.ts');
    assert.match(result.content, /logoutUser/);
    assert.doesNotMatch(result.content, /loginUser/);
  });
});

test('glob, grep, and list accept simpler demo-style aliases', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      ['export function loginUser() {', "  return 'ok';", '}'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);

    const listed = await handlers.list('src');
    assert.equal(listed.path, 'src');
    assert.ok(listed.items.some((item) => item.path === 'src/auth'));

    const globbed = await handlers.glob('src/**/*.ts');
    assert.ok(globbed.matches.includes('src/auth/service.ts'));

    const grepped = await handlers.grep({ query: 'loginUser', directory: 'src' });
    assert.ok(grepped.matches.some((item) => item.path === 'src/auth/service.ts'));
  });
});

test('glob walks sibling directories with bounded filesystem concurrency', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'a'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src', 'b'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'src', 'c'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'a', 'one.ts'), 'export const one = 1;\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'b', 'two.ts'), 'export const two = 2;\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'src', 'c', 'three.ts'), 'export const three = 3;\n', 'utf8');

    const originalStat = fs.stat;
    const originalReaddir = fs.readdir;
    let activeOps = 0;
    let maxConcurrentOps = 0;

    function trackConcurrency(fn) {
      return async (...args) => {
        activeOps += 1;
        maxConcurrentOps = Math.max(maxConcurrentOps, activeOps);
        await new Promise((resolve) => setTimeout(resolve, 5));
        try {
          return await fn(...args);
        } finally {
          activeOps -= 1;
        }
      };
    }

    fs.stat = trackConcurrency(originalStat.bind(fs));
    fs.readdir = trackConcurrency(originalReaddir.bind(fs));

    try {
      const { handlers } = await makeTools(workspaceRoot);
      const result = await handlers.glob({ pattern: 'src/**/*.ts' });

      assert.deepEqual(result.matches.sort(), ['src/a/one.ts', 'src/b/two.ts', 'src/c/three.ts']);
      assert.ok(maxConcurrentOps > 1);
    } finally {
      fs.stat = originalStat;
      fs.readdir = originalReaddir;
    }
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
    assert.match(replaced.diff_preview, /return \{ ok: true, value \};/);

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

test('current toolset no longer exposes legacy generate_diff and patch handlers', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeTools(workspaceRoot);
    assert.equal(typeof handlers.generate_diff, 'undefined');
    assert.equal(typeof handlers.patch, 'undefined');
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

test('delete removes files and reports concise structured metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'remove-me.txt'), 'temporary\n', 'utf8');

    const { handlers, formatters } = await makeTools(workspaceRoot);

    assert.equal(typeof handlers.delete, 'function');
    assert.equal(typeof formatters.delete, 'function');

    const result = await handlers.delete({ path: 'src/remove-me.txt' });

    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/remove-me.txt');
    assert.equal(result.name, 'remove-me.txt');
    assert.equal(result.type, 'file');
    assert.equal(result.deleted, true);
    assert.match(formatters.delete(result), /deleted src\/remove-me\.txt/);
  });
});

test('delete removes directories recursively with structured metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'nested', 'child.txt'), 'nested\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.delete({ path: 'src/nested' });

    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/nested');
    assert.equal(result.name, 'nested');
    assert.equal(result.type, 'directory');
    assert.equal(result.deleted, true);
    await assert.rejects(
      () => fs.stat(path.join(workspaceRoot, 'src', 'nested')),
      /ENOENT/
    );
  });
});

test('delete resolves in-workspace symlinked file targets to the real file metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'real-file.txt'), 'temporary\n', 'utf8');
    await fs.symlink(path.join(workspaceRoot, 'src', 'real-file.txt'), path.join(workspaceRoot, 'src', 'linked-file.txt'));

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.delete({ path: 'src/linked-file.txt' });

    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/linked-file.txt');
    assert.equal(result.name, 'linked-file.txt');
    assert.equal(result.type, 'file');
    assert.equal(result.deleted, true);
    await assert.rejects(() => fs.stat(path.join(workspaceRoot, 'src', 'linked-file.txt')), /ENOENT/);
    assert.match(await fs.readFile(path.join(workspaceRoot, 'src', 'real-file.txt'), 'utf8'), /temporary/);
  });
});

test('delete resolves in-workspace symlinked directory targets to the real directory metadata', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'real-dir'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'real-dir', 'child.txt'), 'nested\n', 'utf8');
    await fs.symlink(path.join(workspaceRoot, 'src', 'real-dir'), path.join(workspaceRoot, 'src', 'linked-dir'));

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.delete({ path: 'src/linked-dir' });

    assert.equal(result.ok, true);
    assert.equal(result.path, 'src/linked-dir');
    assert.equal(result.name, 'linked-dir');
    assert.equal(result.type, 'directory');
    assert.equal(result.deleted, true);
    await assert.rejects(() => fs.stat(path.join(workspaceRoot, 'src', 'linked-dir')), /ENOENT/);
    assert.ok((await fs.stat(path.join(workspaceRoot, 'src', 'real-dir'))).isDirectory());
    assert.match(await fs.readFile(path.join(workspaceRoot, 'src', 'real-dir', 'child.txt'), 'utf8'), /nested/);
  });
});

test('delete rejects missing targets', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeTools(workspaceRoot);

    await assert.rejects(
      () => handlers.delete({ path: 'src/missing.txt' }),
      /not found|missing|ENOENT/i
    );
  });
});

test('delete rejects root-equivalent paths after resolution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'keep.txt'), 'keep\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);

    await assert.rejects(
      () => handlers.delete({ path: 'src/..' }),
      /workspace root|root/i
    );
    await assert.rejects(
      () => handlers.delete({ path: 'a/../' }),
      /workspace root|root/i
    );
    assert.match(await fs.readFile(path.join(workspaceRoot, 'src', 'keep.txt'), 'utf8'), /keep/);
  });
});

test('delete refreshes the lightweight project file index after removal', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'service.ts'),
      ['export function greet(name) {', '  return name;', '}'].join('\n'),
      'utf8'
    );

    const events = [];
    const { handlers } = await makeToolsWithSystemEvents(workspaceRoot, (event) => events.push(event));
    const result = await handlers.delete({ path: 'src/service.ts' });

    assert.equal(result.ok, true);
    const fileIndex = JSON.parse(await fs.readFile(path.join(workspaceRoot, '.codemini', 'file-index.json'), 'utf8'));
    assert.equal(fileIndex.files.some((entry) => entry.file === 'src/service.ts'), false);
    assert.deepEqual(
      events.map((event) => `${event.type}:${event.name}`),
      [
        'system_tool:end:project_index(.codemini/project-map.json,.codemini/file-index.json)',
        'system_tool:end:file_index(src/service.ts)'
      ]
    );
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

test('sanitizeTextForModel strips ansi, collapses blank runs, and truncates wide lines', () => {
  const result = sanitizeTextForModel(
    '\u001b[31merror:\u001b[0m abcdefghijklmnopqrstuvwxyz\n\n\nnext line',
    { maxLineLength: 16 }
  );

  assert.equal(result.includes('\u001b['), false);
  assert.match(result, /^error: abcdefgh…\n\nnext line$/);
});

test('tool formatters sanitize shell and background task output before model context', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const formattedRun = formatters.run({
      code: 1,
      command: 'printf fail',
      stdout: '\u001b[32m' + 'x'.repeat(260) + '\u001b[0m',
      stderr: ''
    });
    const formattedTask = formatters.get_background_task({
      task_id: 'task_001',
      status: 'running',
      output_file: '.codemini/tasks/task_001.log',
      recent_output: ['\u001b[31m' + 'y'.repeat(260) + '\u001b[0m']
    });

    assert.equal(formattedRun.includes('\u001b['), false);
    assert.equal(formattedTask.includes('\u001b['), false);
    assert.match(formattedRun, /x{80,}/);
    assert.match(formattedTask, /y{10,}…/);
  });
});

test('read formatter preserves full long lines instead of clipping them for display', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const longLine = `keeps the agent's safety rules! ${'x'.repeat(260)}`;
    const formatted = formatters.read({
      path: 'README.md',
      phase: 'content',
      start_line: 17,
      end_line: 17,
      total_lines: 40,
      truncated: false,
      content: longLine
    });

    assert.match(formatted, /keeps the agent's safety rules!/);
    assert.match(formatted, /x{40,}/);
    assert.equal(formatted.includes('…'), false);
  });
});

test('read_ast_node formatter preserves very large node content instead of head-tail clipping', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const longLine = [
      `const prefixValue = "${'a'.repeat(900)}";`,
      `const importantMiddleValue = "${'b'.repeat(900)}";`,
      `const suffixValue = "${'c'.repeat(900)}";`
    ].join('\n');
    const formatted = formatters.read_ast_node({
      name: 'demoNode',
      kind: 'function',
      content: longLine
    });

    assert.match(formatted, /prefixValue/);
    assert.match(formatted, /importantMiddleValue/);
    assert.match(formatted, /suffixValue/);
    assert.equal(formatted.includes('... [omitted'), false);
  });
});

test('generic run formatter preserves full stdout lines instead of slicing to 500 chars', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const longLine = `result=${'x'.repeat(700)}`;
    const formatted = formatters.run({
      code: 0,
      command: 'python demo.py',
      stdout: longLine,
      stderr: ''
    });

    assert.match(formatted, /stdout:/);
    assert.match(formatted, /x{200,}/);
    assert.equal(formatted.includes('…'), false);
  });
});

test('web_fetch formatter preserves fetched page text instead of clipping to preview size', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const pageText = `Heading\n${'Paragraph '.repeat(180)}`;
    const formatted = formatters.web_fetch({
      final_url: 'https://example.com/docs',
      title: 'Docs',
      text: pageText
    });

    assert.match(formatted, /\[web_fetch: https:\/\/example\.com\/docs\]/);
    assert.match(formatted, /Paragraph Paragraph Paragraph/);
    assert.equal(formatted.includes('[truncated]'), false);
  });
});

test('run formatter summarizes git status porcelain output into compact file groups', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const formatted = formatters.run({
      code: 0,
      command: 'git status --short',
      stdout: [' M src/core/tools.js', 'A  src/core/tool-output.js', '?? tests/new.test.js'].join('\n'),
      stderr: ''
    });

    assert.match(formatted, /\[git status: 3 file\(s\)\]/);
    assert.match(formatted, /modified: src\/core\/tools\.js/);
    assert.match(formatted, /added: src\/core\/tool-output\.js/);
    assert.match(formatted, /untracked: tests\/new\.test\.js/);
    assert.equal(formatted.includes('stdout:'), false);
  });
});

test('run formatter prioritizes failing test summaries over noisy raw output', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const formatted = formatters.run({
      code: 1,
      command: 'npm test',
      stdout: [
        'PASS tests/config-store.test.js',
        'FAIL tests/tools.test.js',
        '  AssertionError: expected true to equal false',
        '      at tests/tools.test.js:928:12',
        '',
        'Test Suites: 1 failed, 5 passed, 6 total',
        'Tests:       1 failed, 75 passed, 76 total'
      ].join('\n'),
      stderr: '\u001b[31mELIFECYCLE\u001b[0m Test failed. See above for more details.'
    });

    assert.match(formatted, /\[test failure: exit 1\]/);
    assert.match(formatted, /FAIL tests\/tools\.test\.js/);
    assert.match(formatted, /AssertionError: expected true to equal false/);
    assert.match(formatted, /at tests\/tools\.test\.js:928:12/);
    assert.match(formatted, /Test Suites: 1 failed, 5 passed, 6 total/);
    assert.equal(formatted.includes('stdout:'), false);
  });
});

test('run formatter distills install output into package and audit summary', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const formatted = formatters.run({
      code: 0,
      command: 'npm install',
      stdout: [
        'added 12 packages, removed 2 packages, and audited 72 packages in 3s',
        '',
        '42 packages are looking for funding',
        '  run `npm fund` for details',
        '',
        '2 moderate severity vulnerabilities'
      ].join('\n'),
      stderr: ''
    });

    assert.match(formatted, /\[install summary: exit 0\]/);
    assert.match(formatted, /added 12 packages, removed 2 packages, and audited 72 packages in 3s/);
    assert.match(formatted, /2 moderate severity vulnerabilities/);
    assert.equal(formatted.includes('stdout:'), false);
  });
});

test('run formatter surfaces build errors and suppresses noisy successful chunks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { formatters } = await makeTools(workspaceRoot);
    const formatted = formatters.run({
      code: 1,
      command: 'npm run build',
      stdout: [
        'transforming modules...',
        '✓ 132 modules transformed.',
        'src/app.ts:12:3: error: Unexpected token',
        'Build failed in 1.23s'
      ].join('\n'),
      stderr: ''
    });

    assert.match(formatted, /\[build failure: exit 1\]/);
    assert.match(formatted, /src\/app\.ts:12:3: error: Unexpected token/);
    assert.match(formatted, /Build failed in 1\.23s/);
    assert.equal(formatted.includes('stdout:'), false);
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
    assert.match(edited.diff_preview, /const response = await api\.login/);
  });
});

test('builtin tool definitions expose only current primary and structured tools', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, handlers, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });
    const names = definitions.map((tool) => tool.function.name);
    const readDefinition = definitions.find((tool) => tool.function.name === 'read');
    const editDefinition = definitions.find((tool) => tool.function.name === 'edit');

    // Primary tools are always in definitions
    assert.ok(names.includes('read'));
    assert.ok(names.includes('grep'));
    assert.ok(names.includes('list'));
    assert.ok(names.includes('query_project_index'));
    assert.ok(names.includes('edit'));
    assert.ok(names.includes('write'));
    assert.ok(names.includes('delete'));
    assert.ok(names.includes('run'));
    assert.ok(names.includes('update_todos'));
    assert.ok(names.includes('tool_search'));

    // AST, memory, and background-task management tools are deferred
    assert.ok(!names.includes('ast_query'));
    assert.ok(!names.includes('read_ast_node'));
    assert.ok(!names.includes('glob'));
    assert.ok(!names.includes('save_memory'));
    assert.ok(!names.includes('list_memory'));
    assert.ok(!names.includes('list_background_tasks'));
    assert.ok('glob' in deferredDefinitions);
    assert.ok('ast_query' in deferredDefinitions);
    assert.ok('read_ast_node' in deferredDefinitions);
    assert.ok('web_fetch' in deferredDefinitions);
    assert.ok('web_search' in deferredDefinitions);
    assert.ok('save_memory' in deferredDefinitions);
    assert.ok('list_memory' in deferredDefinitions);
    assert.ok('list_background_tasks' in deferredDefinitions);
    assert.match(readDefinition.function.description, /read\(path\) for normal file or line-window reads/i);
    assert.match(readDefinition.function.description, /start_line and end_line/i);
    assert.match(editDefinition.function.description, /\{path, old_text, new_text\}/i);
    assert.ok(!('file_path' in readDefinition.function.parameters.properties));
    assert.ok(!('old_string' in editDefinition.function.parameters.properties));
    assert.ok(!('file' in editDefinition.function.parameters.properties));
    assert.match(deferredDefinitions.ast_query.function.description, /advanced AST workflows/i);
    assert.match(deferredDefinitions.ast_query.function.description, /prefer read\(path, query=.*\) or read\(ast_target=.*\)/i);
    assert.match(deferredDefinitions.read_ast_node.function.description, /common one-shot AST reads, prefer read\(ast_target=.*\) or read\(path, query=.*\)/i);

    // Removed tools are absent
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

    // Handlers for all tools (primary + deferred) are always available
    assert.equal(typeof handlers.replace_block, 'undefined');
    assert.equal(typeof handlers.read, 'function');
    assert.equal(typeof handlers.query_project_index, 'function');
    assert.equal(typeof handlers.edit, 'function');
    assert.equal(typeof handlers.ast_query, 'function');
    assert.equal(typeof handlers.read_ast_node, 'function');
    assert.equal(typeof handlers.write, 'function');
    assert.equal(typeof handlers.run, 'function');
    assert.equal(typeof handlers.web_fetch, 'function');
    assert.equal(typeof handlers.web_search, 'function');
    assert.equal(typeof handlers.save_memory, 'function');
    assert.equal(typeof handlers.list_background_tasks, 'function');
    assert.equal(typeof handlers.tool_search, 'function');
  });
});

test('web_search is blocked when config disables network search', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.web = { ...(config.web || {}), search_enabled: false };
    });

    await assert.rejects(
      () => handlers.web_search({ query: 'codemini cli' }),
      /network search disabled|web\.search_enabled/i
    );
  });
});

test('web_search fetches and parses Bing RSS results', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const originalFetch = globalThis.fetch;
    const requested = [];
    globalThis.fetch = async (url, options = {}) => {
      requested.push({ url: String(url), headers: options.headers || {} });
      return new Response(`<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0">
  <channel>
    <title>Bing: latest example</title>
    <item>
      <title>Example News &amp; Notes</title>
      <link>https://example.com/news</link>
      <description>Fresh &lt;b&gt;reporting&lt;/b&gt; about the topic.</description>
      <pubDate>Fri, 01 May 2026 00:18:00 GMT</pubDate>
    </item>
    <item>
      <title>Second Story</title>
      <link>https://second.example/story</link>
      <description>Second result summary.</description>
      <pubDate>Thu, 30 Apr 2026 10:42:00 GMT</pubDate>
    </item>
  </channel>
</rss>`, {
        status: 200,
        headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
      });
    };

    try {
      const { handlers } = await makeTools(workspaceRoot);
      const result = await handlers.web_search({ query: 'latest example', max_results: 1, locale: 'en-US', region: 'US' });

      assert.equal(result.query, 'latest example');
      assert.equal(result.engine, 'bing_rss');
      assert.equal(requested.length, 1);
      assert.equal(requested[0].url, 'https://cn.bing.com/search?q=latest+example&mkt=en-US&setlang=en-US&cc=US&format=rss');
      assert.match(requested[0].headers['user-agent'], /CodeMiniCLI/);
      assert.equal(result.no_results, false);
      assert.deepEqual(result.results, [
        {
          title: 'Example News & Notes',
          url: 'https://example.com/news',
          description: 'Fresh reporting about the topic.',
          hostname: 'example.com',
          published_at: 'Fri, 01 May 2026 00:18:00 GMT'
        }
      ]);
      assert.deepEqual(result.related, []);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test('web_fetch reads static page content and extracts links without requiring browser rendering', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers, formatters } = await makeTools(workspaceRoot);

    await withHttpServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html>
<html>
  <head>
    <title>CodeMini Fetch Demo</title>
  </head>
  <body>
    <main>
      <h1>Fetch Demo Title</h1>
      <p id="intro">Hello from the fetch test.</p>
      <script>
        const node = document.createElement('p');
        node.textContent = 'Rendered by script.';
        document.body.appendChild(node);
      </script>
      <a href="/docs">Docs</a>
    </main>
  </body>
</html>`);
    }, async ({ url }) => {
      const result = await handlers.web_fetch({ url, max_links: 5 });

      assert.equal(result.url, new URL(url).toString());
      assert.equal(result.title, 'CodeMini Fetch Demo');
      assert.equal(result.metadata.fetch_mode, 'static');
      assert.match(result.text, /Fetch Demo Title/);
      assert.match(result.text, /Hello from the fetch test/);
      assert.doesNotMatch(result.text, /Rendered by script/);
      assert.ok(Array.isArray(result.links));
      assert.ok(result.links.some((item) => item.href === `${url}/docs`));

      const formatted = formatters.web_fetch(result);
      assert.match(formatted, /\[web_fetch:/);
      assert.match(formatted, /CodeMini Fetch Demo/);
      assert.match(formatted, /mode: static/);
    });
  });
});

test('query_project_index returns project-map overview and file-index matches', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify(
        {
          name: 'demo',
          version: '1.0.0',
          dependencies: { react: '^19.0.0' }
        },
        null,
        2
      ),
      'utf8'
    );
    await fs.mkdir(path.join(workspaceRoot, 'src', 'auth'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'tests'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth', 'service.ts'),
      [
        'export async function loginUser(name) {',
        '  return name.trim().toLowerCase();',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'main.ts'),
      ["export * from './auth/service';"].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'tests', 'auth.test.ts'),
      ["import { loginUser } from '../src/auth/service';", "test('loginUser', () => {});"].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const result = await handlers.query_project_index({ query: 'login auth', max_results: 3 });

    assert.equal(result.query, 'login auth');
    assert.equal(result.project_map.languages.includes('ts'), true);
    assert.equal(result.project_map.framework_hints.includes('react'), true);
    assert.equal(result.project_map.source_roots.includes('src'), true);
    assert.ok(Array.isArray(result.matches));
    assert.ok(result.matches.some((item) => item.file === 'src/auth/service.ts'));
    assert.ok(result.matches.some((item) => Array.isArray(item.functions) && item.functions.includes('loginUser')));
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

test('edit accepts demo-style file_path old_string and new_string input', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.writeFile(targetPath, 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const edited = await handlers.edit({
      file_path: 'src/demo.ts',
      old_string: 'value = 1',
      new_string: 'value = 2'
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(targetPath, 'utf8');
    assert.match(after, /value = 2/);
  });
});

test('write accepts demo-style file_path alias', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeTools(workspaceRoot);
    const written = await handlers.write({
      file_path: 'demo.txt',
      content: 'hello demo\n'
    });

    assert.equal(written.ok, true);
    assert.equal(written.path, 'demo.txt');
    const after = await fs.readFile(path.join(workspaceRoot, 'demo.txt'), 'utf8');
    assert.equal(after, 'hello demo\n');
  });
});

test('write accepts file and text-style aliases', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeTools(workspaceRoot);

    const written = await handlers.write({
      file: 'demo.txt',
      text: 'hello text alias\n'
    });
    assert.equal(written.ok, true);
    assert.equal(written.path, 'demo.txt');

    const created = await handlers.write({
      file: 'demo-2.txt',
      new_content: 'hello new_content alias\n'
    });
    assert.equal(created.ok, true);
    assert.equal(created.path, 'demo-2.txt');

    const first = await fs.readFile(path.join(workspaceRoot, 'demo.txt'), 'utf8');
    const second = await fs.readFile(path.join(workspaceRoot, 'demo-2.txt'), 'utf8');
    assert.equal(first, 'hello text alias\n');
    assert.equal(second, 'hello new_content alias\n');
  });
});

test('edit infers replace_text when old_text and content are provided', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const targetPath = path.join(workspaceRoot, 'src', 'demo.ts');
    await fs.writeFile(targetPath, 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const edited = await handlers.edit({
      path: 'src/demo.ts',
      old_text: 'value = 1',
      content: 'value = 3'
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(targetPath, 'utf8');
    assert.match(after, /value = 3/);
  });
});

test('edit missing arguments suggests a repair shape using the most recently read file', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export const value = 1;\n', 'utf8');

    const { handlers } = await makeTools(workspaceRoot);
    const read = await handlers.read({ path: 'src/demo.ts' });
    assert.equal(read.phase, 'content');

    await assert.rejects(
      () => handlers.edit({}),
      /src\/demo\.ts|old_text|new_text|rewrite_file/i
    );
  });
});

test('agent loop preserves raw invalid tool arguments so tool errors can explain the bad payload', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    config.memory.auto_capture = false;
    const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'test invalid tool args',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      config,
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_bad_edit',
                name: 'edit',
                arguments: '.'
              }
            ]
          };
        }
        return {
          text: 'done',
          toolCalls: []
        };
      }
    });

    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_bad_edit');
    assert.ok(toolMessage);
    assert.match(String(toolMessage.content), /Raw tool arguments: \./i);
    assert.match(String(toolMessage.content), /old_text|new_text|rewrite_file/i);
  });
});

test('agent loop auto-captures invalid edit tool call arguments into inbox', async () => {
  await withTempConfigDir(async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const config = await loadConfig();
      const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

      await runAgentLoop({
        systemPrompt: 'You are a test agent.',
        userPrompt: 'test invalid tool args capture',
        model: 'test-model',
        maxSteps: 2,
        toolDefinitions: definitions,
        toolHandlers: handlers,
        toolFormatters: formatters,
        deferredDefinitions,
        config,
        requestCompletion: async ({ messages }) => {
          const hasToolResult = messages.some((msg) => msg.role === 'tool');
          if (!hasToolResult) {
            return {
              text: '',
              toolCalls: [
                {
                  id: 'call_bad_edit_capture',
                  name: 'edit',
                  arguments: '.'
                }
              ]
            };
          }
          return {
            text: 'done',
            toolCalls: []
          };
        }
      });

      const entries = await listInbox();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].source, 'auto-capture');
      assert.equal(entries[0].type, 'failure');
      assert.match(entries[0].summary, /^\[edit\]/);
      assert.match(entries[0].details, /Raw tool arguments: \./i);
    });
  });
});

test('agent loop repairs raw read tool arguments into a usable file path and line range', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'demo.ts'),
      ['zero', 'one', 'two', 'three'].join('\n'),
      'utf8'
    );

    const config = await loadConfig();
    const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'read a file',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_read_raw',
                name: 'read',
                arguments: 'src/demo.ts:2-3'
              }
            ]
          };
        }
        return {
          text: 'done',
          toolCalls: []
        };
      }
    });

    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_read_raw');
    assert.ok(toolMessage);
    assert.match(String(toolMessage.content), /src\/demo\.ts/);
    assert.match(String(toolMessage.content), /one/);
    assert.match(String(toolMessage.content), /two/);
  });
});

test('agent loop repairs raw list and glob tool arguments', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src', 'nested'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'nested', 'demo.ts'), 'export const demo = true;\n', 'utf8');

    const config = await loadConfig();
    const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const responses = [
      {
        text: '',
        toolCalls: [
          { id: 'call_list_raw', name: 'list', arguments: 'src' },
          { id: 'call_glob_raw', name: 'glob', arguments: 'src/**/*.ts' }
        ]
      },
      {
        text: 'done',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'inspect files',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async () => responses.shift() || { text: 'done', toolCalls: [] }
    });

    const listMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_list_raw');
    const globMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_glob_raw');
    assert.ok(listMessage);
    assert.ok(globMessage);
    assert.match(String(listMessage.content), /\[src\]/);
    assert.match(String(listMessage.content), /nested\//);
    assert.match(String(globMessage.content), /src\/nested\/demo\.ts/);
  });
});

test('agent loop replaces empty tool results with a short completion marker', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'run a quiet command',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: definitions,
      toolHandlers: {
        quiet: async () => ''
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_quiet',
                name: 'quiet',
                arguments: '{}'
              }
            ]
          };
        }
        return {
          text: 'done',
          toolCalls: []
        };
      }
    });

    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_quiet');
    assert.ok(toolMessage);
    assert.match(String(toolMessage.content), /\(quiet completed with no output\)/i);
  });
});

test('agent loop retries when the model returns an empty post-tool response', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const responses = [
      {
        text: '',
        toolCalls: [
          {
            id: 'call_quiet',
            name: 'quiet',
            arguments: '{}'
          }
        ]
      },
      {
        text: '',
        toolCalls: [],
        incomplete: true
      },
      {
        text: 'final summary',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'run a quiet command',
      model: 'test-model',
      maxSteps: 4,
      toolDefinitions: definitions,
      toolHandlers: {
        quiet: async () => ''
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async () => responses.shift() || { text: 'done', toolCalls: [] }
    });

    const assistantMessages = result.messages.filter((msg) => msg.role === 'assistant');
    assert.equal(result.text, 'final summary');
    assert.equal(assistantMessages.length, 2);
    assert.equal(assistantMessages.at(-1)?.content, 'final summary');
  });
});

test('agent loop asks for a summary again when post-tool answer is only whitespace', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const calls = [];
    const responses = [
      {
        text: '',
        toolCalls: [
          {
            id: 'call_quiet',
            name: 'quiet',
            arguments: '{}'
          }
        ]
      },
      {
        text: '   \n',
        toolCalls: []
      },
      {
        text: 'Summary: inspected the tool output and found no issues.',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'inspect and summarize',
      model: 'test-model',
      maxSteps: 4,
      toolDefinitions: definitions,
      toolHandlers: {
        quiet: async () => ''
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        calls.push(messages.at(-1));
        return responses.shift() || { text: 'done', toolCalls: [] };
      }
    });

    assert.equal(result.text, 'Summary: inspected the tool output and found no issues.');
    assert.equal(calls.length, 3);
    assert.equal(calls[2]?.role, 'user');
    assert.match(String(calls[2]?.content || ''), /provide a concise final answer/i);
  });
});

test('agent loop asks for a more concrete summary after generic completion text', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const calls = [];
    const responses = [
      {
        text: '',
        toolCalls: [
          {
            id: 'call_quiet',
            name: 'quiet',
            arguments: '{}'
          }
        ]
      },
      {
        text: '已完成任务',
        toolCalls: []
      },
      {
        text: '发现两个优化点：减少重复读取，并在分析结束后补充明确结论。',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'inspect and summarize',
      model: 'test-model',
      maxSteps: 4,
      toolDefinitions: definitions,
      toolHandlers: {
        quiet: async () => ''
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        calls.push(messages.at(-1));
        return responses.shift() || { text: 'done', toolCalls: [] };
      }
    });

    assert.equal(result.text, '发现两个优化点：减少重复读取，并在分析结束后补充明确结论。');
    assert.equal(calls[2]?.role, 'user');
    assert.match(String(calls[2]?.content || ''), /specific findings|concrete findings|final answer/i);
  });
});

test('agent loop blocks unrelated skills exploration during broad repo analysis', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    let stage = 0;

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: '现在我的项目有什么可优化的地方',
      model: 'test-model',
      maxSteps: 6,
      toolDefinitions: definitions,
      toolHandlers: {
        glob: async () => {
          throw new Error('glob should be blocked before execution for skills/ exploration');
        },
        query_project_index: async () => ({
          query: '项目优化 project optimize',
          project_root: workspaceRoot,
          project_map: {
            languages: ['js'],
            source_roots: ['src'],
            test_roots: ['tests'],
            entry_candidates: ['src/index.js'],
            framework_hints: []
          },
          matches: [
            { file: 'src/core/agent-loop.js', score: 9, exports: [], functions: ['runAgentLoop'], classes: [] },
            { file: 'src/core/tools.js', score: 8, exports: [], functions: ['getBuiltinTools'], classes: [] }
          ]
        }),
        read: async (args) => ({
          phase: 'content',
          path: String(args.path || '').split(':')[0],
          start_line: 1,
          end_line: 40,
          total_lines: 40,
          content: 'export function demo() {}\n'
        })
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        const last = messages.at(-1);
        if (last?.role === 'tool' && String(last.content || '').includes('Skip skills/ for broad repository analysis')) {
          stage = 2;
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_index',
                name: 'query_project_index',
                arguments: JSON.stringify({ query: '项目优化 project optimize', path: 'src', max_results: 3 })
              }
            ]
          };
        }
        stage += 1;
        if (stage === 1) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_glob_first',
                name: 'glob',
                arguments: JSON.stringify({ pattern: 'skills/**/*.md' })
              }
            ]
          };
        }
        if (stage === 3) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_read_src',
                name: 'read',
                arguments: JSON.stringify({ path: 'src/core/agent-loop.js:1-40' })
              },
              {
                id: 'call_read_src_2',
                name: 'read',
                arguments: JSON.stringify({ path: 'src/core/tools.js:1-40' })
              }
            ]
          };
        }
        if (stage === 4) {
          return {
            text: '发现两个可优化点：先查索引再读源码，并减少泛目录探索。',
            toolCalls: []
          };
        }
        return { text: 'done', toolCalls: [] };
      }
    });

    const blockedToolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_glob_first');
    assert.ok(blockedToolMessage);
    assert.match(String(blockedToolMessage.content), /Skip skills\/ for broad repository analysis unless the user explicitly asks for it/i);
    assert.equal(result.text, '发现两个可优化点：先查索引再读源码，并减少泛目录探索。');
  });
});

test('agent loop rejects premature completion when broad analysis skipped relevant source files', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const config = await loadConfig();
    const { definitions, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const prompts = [];
    const responses = [
      {
        text: '',
        toolCalls: [
          {
            id: 'call_index',
            name: 'query_project_index',
            arguments: JSON.stringify({ query: '项目优化', path: 'src', max_results: 3 })
          }
        ]
      },
      {
        text: '',
        toolCalls: [
          {
            id: 'call_read_test',
            name: 'read',
            arguments: JSON.stringify({ path: 'tests/config-store.test.js:1-40' })
          }
        ]
      },
      {
        text: '已完成任务',
        toolCalls: []
      },
      {
        text: '',
        toolCalls: [
          {
            id: 'call_read_src_a',
            name: 'read',
            arguments: JSON.stringify({ path: 'src/core/agent-loop.js:1-40' })
          },
          {
            id: 'call_read_src_b',
            name: 'read',
            arguments: JSON.stringify({ path: 'src/core/tools.js:1-40' })
          }
        ]
      },
      {
        text: '可以先优化两点：限制无关目录探索，并把项目索引作为宽泛分析的第一入口。',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: '帮我分析这个项目有什么可优化的地方',
      model: 'test-model',
      maxSteps: 7,
      toolDefinitions: definitions,
      toolHandlers: {
        query_project_index: async () => ({
          query: '项目优化',
          project_root: workspaceRoot,
          project_map: {
            languages: ['js'],
            source_roots: ['src'],
            test_roots: ['tests'],
            entry_candidates: ['src/index.js'],
            framework_hints: []
          },
          matches: [
            { file: 'src/core/agent-loop.js', score: 9, exports: [], functions: ['runAgentLoop'], classes: [] },
            { file: 'src/core/tools.js', score: 8, exports: [], functions: ['getBuiltinTools'], classes: [] }
          ]
        }),
        read: async (args) => ({
          phase: 'content',
          path: String(args.path || '').split(':')[0],
          start_line: 1,
          end_line: 40,
          total_lines: 40,
          content: 'export function demo() {}\n'
        })
      },
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async ({ messages }) => {
        const last = messages.at(-1);
        if (last?.role === 'user') prompts.push(String(last.content || ''));
        return responses.shift() || { text: 'done', toolCalls: [] };
      }
    });

    assert.equal(result.text, '可以先优化两点：限制无关目录探索，并把项目索引作为宽泛分析的第一入口。');
    assert.ok(prompts.some((text) => /inspect the next relevant source files|relevant source files/i.test(text)));
  });
});

test('agent loop accepts write aliases and edit content shorthand', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'export const value = 1;\n', 'utf8');

    const config = await loadConfig();
    const { definitions, handlers, formatters, deferredDefinitions } = getBuiltinTools({ workspaceRoot, config });

    const responses = [
      {
        text: '',
        toolCalls: [
          {
            id: 'call_write_alias',
            name: 'write',
            arguments: JSON.stringify({ file: 'notes.txt', text: 'hello from alias\n' })
          },
          {
            id: 'call_edit_alias',
            name: 'edit',
            arguments: JSON.stringify({ file_path: 'src/demo.ts', old_string: 'value = 1', content: 'value = 4' })
          }
        ]
      },
      {
        text: 'done',
        toolCalls: []
      }
    ];

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'write and edit files',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: definitions,
      toolHandlers: handlers,
      toolFormatters: formatters,
      deferredDefinitions,
      requestCompletion: async () => responses.shift() || { text: 'done', toolCalls: [] }
    });

    const writeMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_write_alias');
    const editMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_edit_alias');
    assert.ok(writeMessage);
    assert.ok(editMessage);
    assert.match(String(writeMessage.content), /notes\.txt/);
    assert.match(String(editMessage.content), /src\/demo\.ts/);

    const created = await fs.readFile(path.join(workspaceRoot, 'notes.txt'), 'utf8');
    const updated = await fs.readFile(path.join(workspaceRoot, 'src', 'demo.ts'), 'utf8');
    assert.equal(created, 'hello from alias\n');
    assert.match(updated, /value = 4/);
  });
});

test('agent loop normalizes delete approval metadata and returns delete-specific cancellation when denied', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const approvalRequests = [];
    const deleteHandler = async () => {
      throw new Error('delete handler should not run when approval is denied');
    };
    deleteHandler.prepareApproval = async (args) => ({
      path: String(args?.path || ''),
      name: 'demo.txt',
      type: 'file'
    });

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'delete a file',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: [],
      toolHandlers: {
        delete: deleteHandler
      },
      toolFormatters: {},
      executionMode: 'normal',
      alwaysAllowTools: [],
      requestToolApproval: async (request) => {
        approvalRequests.push(request);
        return { approved: false };
      },
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_delete_denied',
                name: 'delete',
                arguments: '{"target":"tmp/demo.txt"}'
              }
            ]
          };
        }
        return {
          text: 'delete denied',
          toolCalls: []
        };
      }
    });

    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0]?.name, 'delete');
    assert.equal(approvalRequests[0]?.arguments?.path, 'tmp/demo.txt');
    assert.deepEqual(approvalRequests[0]?.arguments?.approval, {
      path: 'tmp/demo.txt',
      name: 'demo.txt',
      type: 'file'
    });

    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_delete_denied');
    assert.ok(toolMessage);
    const payload = JSON.parse(String(toolMessage.content || '{}'));
    assert.deepEqual(payload, {
      ok: false,
      path: 'tmp/demo.txt',
      name: 'demo.txt',
      type: 'file',
      deleted: false,
      cancelled: true,
      reason: 'User denied deletion approval'
    });
    assert.equal(result.text, 'delete denied');
  });
});

test('agent loop surfaces delete preflight errors before requesting approval', async () => {
  await withTempWorkspace(async () => {
    let approvalCalls = 0;
    const deleteHandler = async () => {
      throw new Error('delete handler should not run when preflight fails');
    };
    deleteHandler.prepareApproval = async () => {
      throw new Error('delete target not found: tmp/missing.txt');
    };

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'delete a missing file',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: [],
      toolHandlers: { delete: deleteHandler },
      toolFormatters: {},
      executionMode: 'normal',
      alwaysAllowTools: [],
      requestToolApproval: async () => {
        approvalCalls += 1;
        return { approved: false };
      },
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_delete_missing',
                name: 'delete',
                arguments: '{"path":"tmp/missing.txt"}'
              }
            ]
          };
        }
        return {
          text: 'delete failed before approval',
          toolCalls: []
        };
      }
    });

    assert.equal(approvalCalls, 0);
    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_delete_missing');
    assert.ok(toolMessage);
    assert.match(String(toolMessage.content || ''), /delete target not found/i);
    assert.equal(result.text, 'delete failed before approval');
  });
});

test('agent loop requires delete approval even in auto mode', async () => {
  await withTempWorkspace(async () => {
    let approvalCalls = 0;
    const deleteHandler = async () => {
      throw new Error('delete handler should not run before approval in auto mode');
    };
    deleteHandler.prepareApproval = async (args) => ({
      path: String(args?.path || ''),
      name: 'demo.txt',
      type: 'file'
    });

    const result = await runAgentLoop({
      systemPrompt: 'You are a test agent.',
      userPrompt: 'delete a file',
      model: 'test-model',
      maxSteps: 2,
      toolDefinitions: [],
      toolHandlers: { delete: deleteHandler },
      toolFormatters: {},
      executionMode: 'auto',
      alwaysAllowTools: ['delete'],
      requestToolApproval: async () => {
        approvalCalls += 1;
        return { approved: false };
      },
      requestCompletion: async ({ messages }) => {
        const hasToolResult = messages.some((msg) => msg.role === 'tool');
        if (!hasToolResult) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_delete_auto',
                name: 'delete',
                arguments: '{"path":"tmp/demo.txt"}'
              }
            ]
          };
        }
        return {
          text: 'delete denied in auto mode',
          toolCalls: []
        };
      }
    });

    assert.equal(approvalCalls, 1);
    const toolMessage = result.messages.find((msg) => msg.role === 'tool' && msg.tool_call_id === 'call_delete_auto');
    assert.ok(toolMessage);
    assert.match(String(toolMessage.content || ''), /User denied deletion approval/);
    assert.equal(result.text, 'delete denied in auto mode');
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

test('run backgrounds long-running commands and returns a task handle', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.policy.command_allowlist = ['bash'];
    });

    const backgroundTask = await handlers.run({
      command: "bash -lc 'echo \"background task ready\"; while true; do sleep 1; done'",
      run_in_background: true,
      success_matchers: ['background task ready'],
      startup_timeout_ms: 1200
    });
    assert.equal(backgroundTask.background, true);
    assert.ok(backgroundTask.task_id);

    const viteTask = await handlers.run({ command: "bash -lc 'while true; do sleep 1; done' # vite" });
    assert.equal(viteTask.background, true);
    assert.equal(viteTask.kind, 'frontend-service');

    await handlers.stop_background_task({ task_id: backgroundTask.task_id });
    await handlers.stop_background_task({ task_id: viteTask.task_id });
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

test('background task tools manage a long-running process lifecycle with compact status', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['bash'];
    });

    const started = await handlers.run({
      command: "bash -lc 'echo \"Service ready on http://127.0.0.1:4310\"; while true; do echo tick; sleep 0.2; done'",
      run_in_background: true,
      startup_timeout_ms: 1200,
      success_matchers: ['Service ready'],
      port_probe: 0
    });

    assert.equal(started.status, 'running');
    assert.equal(started.startup_confirmed, true);
    assert.ok(started.task_id);
    assert.ok(Array.isArray(started.recent_output));
    assert.match(String(started.output_file || ''), /\.codemini\/tasks\/task_\d+\.log$/);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(started.startup_source));
    assert.equal(typeof started.log_cursor, 'number');

    const status = await handlers.get_background_task({ task_id: started.task_id });
    assert.equal(status.task_id, started.task_id);
    assert.equal(status.status, 'running');

    const listed = await handlers.list_background_tasks({});
    assert.ok(Array.isArray(listed.tasks));
    assert.ok(listed.tasks.some((item) => item.task_id === started.task_id));

    await new Promise((resolve) => setTimeout(resolve, 250));
    const output = await fs.readFile(path.join(workspaceRoot, status.output_file), 'utf8');
    assert.match(output, /Service ready|tick/);

    const stopped = await handlers.stop_background_task({ task_id: started.task_id });
    assert.equal(stopped.task_id, started.task_id);
    assert.equal(stopped.stopped, true);
  });
});

test('run confirms dev-server style startup without blocking on process exit', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['bash'];
    });

    const startedAt = Date.now();
    const result = await handlers.run({
      command: "bash -lc 'echo \"dev server ready on http://127.0.0.1:3000\"; while true; do sleep 1; done'",
      run_in_background: true,
      startup_timeout_ms: 1200,
      success_matchers: ['dev server ready']
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 'running');
    assert.equal(result.startup_confirmed, true);
    assert.ok(result.task_id);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(result.startup_source));
    assert.ok(elapsedMs < 1300, `expected startup confirmation before startup timeout, got ${elapsedMs}ms`);

    const stopped = await handlers.stop_background_task({ task_id: result.task_id });
    assert.equal(stopped.stopped, true);
  });
});

test('run exposes configured http_probe metadata on background task snapshots', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['bash'];
    });

    const started = await handlers.run({
      command: "bash -lc 'echo \"HTTP probe placeholder service\"; while true; do sleep 1; done'",
      run_in_background: true,
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

    const status = await handlers.get_background_task({ task_id: started.task_id });
    assert.deepEqual(status.http_probe, {
      url: 'http://127.0.0.1:4310/health',
      expect_status: 200
    });

    await handlers.stop_background_task({ task_id: started.task_id });
  });
});

test('run confirms java-style startup output for background tasks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['bash'];
    });

    const startedAt = Date.now();
    const result = await handlers.run({
      command: "bash -lc 'echo \"Tomcat started on port(s): 8080 (http) with context path \\\"\\\"\"; while true; do sleep 1; done' # java -jar demo.jar",
      run_in_background: true,
      startup_timeout_ms: 1200
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 'running');
    assert.equal(result.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(result.startup_source));
    assert.ok(elapsedMs < 1300, `expected java-style startup confirmation before startup timeout, got ${elapsedMs}ms`);

    const stopped = await handlers.stop_background_task({ task_id: result.task_id });
    assert.equal(stopped.stopped, true);
  });
});

test('run confirms dotnet and go-style startup output for background tasks', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const { handlers } = await makeToolsWithConfig(workspaceRoot, (config) => {
      config.shell.default = 'bash';
      config.shell.timeout_ms = 1200;
      config.policy.command_allowlist = ['bash'];
    });

    const dotnetStartedAt = Date.now();
    const dotnetResult = await handlers.run({
      command: "bash -lc 'echo \"Now listening on: http://localhost:5099\"; while true; do sleep 1; done' # dotnet run",
      run_in_background: true,
      startup_timeout_ms: 1200
    });
    const dotnetElapsedMs = Date.now() - dotnetStartedAt;

    assert.equal(dotnetResult.status, 'running');
    assert.equal(dotnetResult.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(dotnetResult.startup_source));
    assert.ok(dotnetElapsedMs < 1300, `expected dotnet-style startup confirmation before startup timeout, got ${dotnetElapsedMs}ms`);

    const goStartedAt = Date.now();
    const goResult = await handlers.run({
      command: "bash -lc 'echo \"Starting development server at http://127.0.0.1:8080\"; while true; do sleep 1; done' # go run ./cmd/server",
      run_in_background: true,
      startup_timeout_ms: 1200
    });
    const goElapsedMs = Date.now() - goStartedAt;

    assert.equal(goResult.status, 'running');
    assert.equal(goResult.startup_confirmed, true);
    assert.ok(['output', 'startup_window', 'port_probe'].includes(goResult.startup_source));
    assert.ok(goElapsedMs < 1300, `expected go-style startup confirmation before startup timeout, got ${goElapsedMs}ms`);

    await handlers.stop_background_task({ task_id: dotnetResult.task_id });
    await handlers.stop_background_task({ task_id: goResult.task_id });
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

test('ast_query returns AST targets across supported languages', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'backend'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'scripts'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'native'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'server'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'dotnet'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'php'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'ruby'), { recursive: true });

    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export class AuthService {',
        '  login(user: string) {',
        '    return user.trim();',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'backend', 'auth.py'),
      [
        'def login(user, password):',
        '    return issue_token(user)'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'backend', 'main.go'),
      [
        'package main',
        '',
        'func login(user string) string {',
        '    return user',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'native', 'auth.c'),
      [
        'int login(const char *user) {',
        '  return user != 0;',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'native', 'auth.cpp'),
      [
        'class AuthService {',
        'public:',
        '  int login() { return 1; }',
        '};'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'scripts', 'login.sh'),
      [
        'login() {',
        '  echo "$1"',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'server', 'AuthService.java'),
      [
        'class AuthService {',
        '  String login(String user) {',
        '    return user;',
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'server', 'auth.rs'),
      [
        'fn login(user: &str) -> &str {',
        '    user',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'dotnet', 'AuthService.cs'),
      [
        'class AuthService {',
        '    string Login(string user) {',
        '        return user;',
        '    }',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'php', 'auth.php'),
      [
        '<?php',
        'function login($user) {',
        '    return $user;',
        '}'
      ].join('\n'),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'ruby', 'auth.rb'),
      [
        'def login(user)',
        '  user',
        'end'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const cases = [
      {
        path: 'src/auth.ts',
        query: '(class_declaration name: (type_identifier) @target)',
        nodeType: 'class_declaration',
        language: 'ts'
      },
      {
        path: 'backend/auth.py',
        query: '(function_definition name: (identifier) @target)',
        nodeType: 'function_definition',
        language: 'python'
      },
      {
        path: 'backend/main.go',
        query: '(function_declaration name: (identifier) @target)',
        nodeType: 'function_declaration',
        language: 'go'
      },
      {
        path: 'native/auth.c',
        query: '(function_definition declarator: (function_declarator declarator: (identifier) @target))',
        nodeType: 'function_definition',
        language: 'c'
      },
      {
        path: 'native/auth.cpp',
        query: '(class_specifier name: (type_identifier) @target)',
        nodeType: 'class_specifier',
        language: 'cpp'
      },
      {
        path: 'scripts/login.sh',
        query: '(function_definition name: (word) @target)',
        nodeType: 'function_definition',
        language: 'bash'
      },
      {
        path: 'server/AuthService.java',
        query: '(method_declaration name: (identifier) @target)',
        nodeType: 'method_declaration',
        language: 'java'
      },
      {
        path: 'server/auth.rs',
        query: '(function_item name: (identifier) @target)',
        nodeType: 'function_item',
        language: 'rust'
      },
      {
        path: 'dotnet/AuthService.cs',
        query: '(method_declaration name: (identifier) @target)',
        nodeType: 'method_declaration',
        language: 'csharp'
      },
      {
        path: 'php/auth.php',
        query: '(function_definition name: (name) @target)',
        nodeType: 'function_definition',
        language: 'php'
      },
      {
        path: 'ruby/auth.rb',
        query: '(method name: (identifier) @target)',
        nodeType: 'method',
        language: 'ruby'
      }
    ];

    for (const testCase of cases) {
      const result = await handlers.ast_query({
        path: testCase.path,
        query: testCase.query,
        capture_name: 'target'
      });
      assert.equal(result.path, testCase.path);
      assert.equal(result.language, testCase.language);
      assert.ok(Array.isArray(result.matches));
      assert.ok(result.matches.length >= 1);
      assert.equal(result.matches[0].capture, 'target');
      assert.equal(result.matches[0].node_type, testCase.nodeType);
      assert.equal(result.matches[0].ast_target.path, testCase.path);
      assert.equal(typeof result.matches[0].ast_target.range_hash, 'string');
      assert.ok(result.matches[0].ast_target.range_hash.length > 0);
    }
  });
});

test('read_ast_node returns localized node content and summaries', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export class AuthService {',
        '  login(user: string) {',
        '    return user.trim();',
        '  }',
        '',
        '  logout() {',
        "    return 'ok';",
        '  }',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const query = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(method_definition name: (property_identifier) @target)',
      capture_name: 'target'
    });

    const result = await handlers.read_ast_node({
      path: 'src/auth.ts',
      ast_target: query.matches[0].ast_target
    });

    assert.equal(result.path, 'src/auth.ts');
    assert.equal(result.node.node_type, 'method_definition');
    assert.match(result.content, /login/);
    assert.equal(typeof result.parent_summary, 'string');
    assert.ok(Array.isArray(result.child_summaries));
  });
});

test('edit replaces only the selected AST node for functions and classes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const filePath = path.join(workspaceRoot, 'src', 'auth.ts');
    await fs.writeFile(
      filePath,
      [
        'export class AuthService {',
        '  login(user: string) {',
        '    return user.trim();',
        '  }',
        '}',
        '',
        'export function loginUser(user: string) {',
        '  return user;',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const classQuery = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(class_declaration name: (type_identifier) @target)',
      capture_name: 'target'
    });
    const functionQuery = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(function_declaration name: (identifier) @target)',
      capture_name: 'target'
    });

    const classEdit = await handlers.edit({
      file: 'src/auth.ts',
      ast_target: classQuery.matches[0].ast_target,
      edit: {
        kind: 'replace_block',
        new_content: [
          'class AuthService {',
          '  login(user: string) {',
          '    return user.toLowerCase().trim();',
          '  }',
          '}'
        ].join('\n')
      }
    });
    assert.equal(classEdit.ok, true);

    const functionEdit = await handlers.edit({
      file: 'src/auth.ts',
      ast_target: functionQuery.matches[0].ast_target,
      edit: {
        kind: 'replace_block',
        new_content: [
          'function loginUser(user: string) {',
          '  return user.trim();',
          '}'
        ].join('\n')
      }
    });
    assert.equal(functionEdit.ok, true);

    const after = await fs.readFile(filePath, 'utf8');
    assert.match(after, /toLowerCase\(\)\.trim/);
    assert.match(after, /return user\.trim\(\);/);
  });
});

test('edit rejects stale AST targets and unsupported AST edit kinds', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    const filePath = path.join(workspaceRoot, 'src', 'auth.ts');
    await fs.writeFile(
      filePath,
      [
        'export function loginUser(user: string) {',
        '  return user;',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const query = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(function_declaration name: (identifier) @target)',
      capture_name: 'target'
    });
    const astTarget = query.matches[0].ast_target;

    await assert.rejects(
      () =>
        handlers.edit({
          file: 'src/auth.ts',
          ast_target: astTarget,
          edit: {
            kind: 'replace_text',
            old_text: 'return user;',
            new_text: 'return user.trim();'
          }
        }),
      /replace_block/i
    );

    await fs.writeFile(
      filePath,
      [
        'export function loginUser(user: string) {',
        '  return user.trim();',
        '}'
      ].join('\n'),
      'utf8'
    );

    await assert.rejects(
      () =>
        handlers.edit({
          file: 'src/auth.ts',
          ast_target: astTarget,
          edit: {
            kind: 'replace_block',
            new_content: [
              'function loginUser(user: string) {',
              '  return user.toLowerCase();',
              '}'
            ].join('\n')
          }
        }),
      /range_hash|stale|changed/i
    );
  });
});

test('edit refreshes the lightweight project file index after code changes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'math.js'),
      ['export function add(a, b) {', '  return a + b;', '}'].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    await handlers.edit({
      file: 'src/math.js',
      symbol: 'add',
      edit: {
        kind: 'replace_block',
        new_content: ['export function add(a, b) {', '  return a + b + 1;', '}'].join('\n')
      }
    });

    const fileIndex = JSON.parse(await fs.readFile(path.join(workspaceRoot, '.codemini', 'file-index.json'), 'utf8'));
    const entry = fileIndex.files.find((item) => item.file === 'src/math.js');
    assert.ok(entry);
    assert.ok(entry.exports.includes('add'));
    assert.ok(entry.functions.includes('add'));
    assert.ok(entry.hash);
  });
});

test('edit emits system tool events for project and file indexing', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2));
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'service.ts'),
      ['export function greet(name) {', '  return name;', '}'].join('\n'),
      'utf8'
    );

    const events = [];
    const { handlers } = await makeToolsWithSystemEvents(workspaceRoot, (event) => events.push(event));
    const result = await handlers.edit({
      file: 'src/service.ts',
      symbol: 'greet',
      edit: {
        kind: 'replace_block',
        new_content: ['export function greet(name) {', "  return `hi ${name}`;", '}'].join('\n')
      }
    });

    assert.equal(result.ok, true);
    assert.deepEqual(
      events.map((event) => `${event.type}:${event.name}`),
      [
        'system_tool:end:project_index(.codemini/project-map.json,.codemini/file-index.json)',
        'system_tool:end:file_index(src/service.ts)'
      ]
    );
    assert.match(String(events[0]?.summary || ''), /\.codemini/i);
    assert.match(String(events[1]?.summary || ''), /\.codemini.*src\/service\.ts/i);
  });
});

test('ast_query caches the selected node for follow-up read and edit calls', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export function loginUser(name: string) {',
        '  return name;',
        '}',
        '',
        'export function logoutUser(name: string) {',
        '  return name.toUpperCase();',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    const query = await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(function_declaration (identifier) @loginUser)',
      capture_name: 'loginUser'
    });
    const selected = query.matches[0].ast_target;

    const read = await handlers.read_ast_node({
      path: 'src/auth.ts'
    });
    assert.match(read.content, /loginUser/);

    const edited = await handlers.edit({
      file: 'src/auth.ts',
      edit: {
        kind: 'replace_block',
        new_content: ['export function loginUser(name: string) {', '  return name.trim().toLowerCase();', '}'].join('\n')
      }
    });

    assert.equal(edited.ok, true);
    const after = await fs.readFile(path.join(workspaceRoot, 'src', 'auth.ts'), 'utf8');
    assert.match(after, /trim\(\)\.toLowerCase\(\)/);
    assert.match(after, /logoutUser/);
    assert.ok(selected);
  });
});

test('ast_query can satisfy a follow-up read_ast_node call without repeating path', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, 'package.json'),
      JSON.stringify({ name: 'demo', version: '1.0.0' }, null, 2),
      'utf8'
    );
    await fs.writeFile(
      path.join(workspaceRoot, 'src', 'auth.ts'),
      [
        'export function loginUser(name: string) {',
        '  return name;',
        '}'
      ].join('\n'),
      'utf8'
    );

    const { handlers } = await makeTools(workspaceRoot);
    await handlers.ast_query({
      path: 'src/auth.ts',
      query: '(function_declaration (identifier) @loginUser)',
      capture_name: 'loginUser'
    });

    const read = await handlers.read_ast_node({});
    assert.match(read.content, /loginUser/);
  });
});
