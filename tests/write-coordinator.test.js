import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWriteCoordinator } from '../src/core/write-coordinator.js';
import { getBuiltinTools } from '../src/core/tools.js';
import { classifyCommandRisk, hasShellWriteSyntax } from '../src/core/command-risk.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve with 'timeout' instead of hanging when an assertion fails. */
function settleWithin(promise, ms = 1500) {
  return Promise.race([promise, timeout(ms).then(() => 'timeout')]);
}

function makeBundle(workspaceRoot) {
  return getBuiltinTools({
    workspaceRoot,
    config: {
      policy: { allowed_paths: [] },
      sandbox: { enabled: false, mode: 'danger-full-access' },
      shell: { default: 'bash', timeout_ms: 15000 },
    },
    platform: 'linux',
  });
}

async function withBundle(fn) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-write-coord-'));
  const bundle = makeBundle(workspaceRoot);
  try {
    await fn(bundle, workspaceRoot);
  } finally {
    await bundle.dispose?.();
    closeSqliteDatabasesForTests();
    await fs.rm(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}

test('same-path writes serialize; a later write waits for the earlier one', async () => {
  const coordinator = createWriteCoordinator();
  const order = [];
  const gate = deferred();
  const firstEntered = deferred();

  const first = coordinator.withFileLock('f', async () => {
    order.push('first:start');
    firstEntered.resolve();
    await gate.promise;
    order.push('first:end');
    return 'a';
  });
  await firstEntered.promise;

  let secondEntered = false;
  const second = coordinator.withFileLock('f', async () => {
    secondEntered = true;
    order.push('second:start');
    return 'b';
  });
  await settleWithin(timeout(40));
  assert.equal(secondEntered, false, 'second same-path write must wait');

  gate.resolve();
  assert.equal(await settleWithin(first), 'a');
  assert.equal(await settleWithin(second), 'b');
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start']);
});

test('different-path writes run in parallel', async () => {
  const coordinator = createWriteCoordinator();
  const gate = deferred();
  const aEntered = deferred();
  const bEntered = deferred();

  const first = coordinator.withFileLock('a', async () => {
    aEntered.resolve();
    await gate.promise;
    return 1;
  });
  const second = coordinator.withFileLock('b', async () => {
    bEntered.resolve();
    await gate.promise;
    return 2;
  });

  // Both must be inside their critical sections while the gate is still closed.
  assert.equal(await settleWithin(aEntered.promise), undefined);
  assert.equal(await settleWithin(bEntered.promise), undefined);

  gate.resolve();
  assert.deepEqual(await Promise.all([settleWithin(first), settleWithin(second)]), [1, 2]);
});

test('exclusive run waits for in-flight file writes and blocks new ones', async () => {
  const coordinator = createWriteCoordinator();
  const order = [];
  const fileGate = deferred();
  const runGate = deferred();
  const runEntered = deferred();
  const fileStarted = deferred();

  const file = coordinator.withFileLock('f', async () => {
    order.push('file:start');
    fileStarted.resolve();
    await fileGate.promise;
    order.push('file:end');
    return 'f';
  });
  await fileStarted.promise;

  const run = coordinator.withRunLock(async () => {
    order.push('run:start');
    runEntered.resolve();
    await runGate.promise;
    order.push('run:end');
    return 'run';
  });
  await settleWithin(timeout(40));
  assert.equal(await settleWithin(Promise.race([runEntered.promise, timeout(40).then(() => 'blocked')])), 'blocked', 'run must wait for the in-flight file write');

  let secondEntered = false;
  const second = coordinator.withFileLock('f', async () => {
    secondEntered = true;
    order.push('second:start');
    return 'f2';
  });
  await settleWithin(timeout(40));
  assert.equal(secondEntered, false, 'new file write must wait while the run is queued');

  fileGate.resolve();
  await file;
  assert.equal(await settleWithin(runEntered.promise), undefined, 'run starts after the file write drains');

  runGate.resolve();
  assert.equal(await settleWithin(run), 'run');
  assert.equal(await settleWithin(second), 'f2');
  assert.deepEqual(order, ['file:start', 'file:end', 'run:start', 'run:end', 'second:start']);
});

test('exclusive runs serialize with each other', async () => {
  const coordinator = createWriteCoordinator();
  const order = [];
  const gate = deferred();
  const firstEntered = deferred();

  const first = coordinator.withRunLock(async () => {
    order.push('run1:start');
    firstEntered.resolve();
    await gate.promise;
    order.push('run1:end');
    return 1;
  });
  await firstEntered.promise;

  let secondEntered = false;
  const second = coordinator.withRunLock(async () => {
    secondEntered = true;
    order.push('run2:start');
    return 2;
  });
  await settleWithin(timeout(40));
  assert.equal(secondEntered, false, 'second run must wait for the first');

  gate.resolve();
  assert.deepEqual(await Promise.all([settleWithin(first), settleWithin(second)]), [1, 2]);
  assert.deepEqual(order, ['run1:start', 'run1:end', 'run2:start']);
});

test('a queued exclusive run has priority over new file writes', async () => {
  const coordinator = createWriteCoordinator();
  const order = [];
  const fileGate = deferred();
  const fileStarted = deferred();

  const file = coordinator.withFileLock('f', async () => {
    order.push('file:start');
    fileStarted.resolve();
    await fileGate.promise;
    order.push('file:end');
    return 'f';
  });
  await fileStarted.promise;

  // Queue a run while the file write is still in flight.
  let runEntered = false;
  const run = coordinator.withRunLock(async () => {
    runEntered = true;
    order.push('run:start');
    return 'run';
  });
  await settleWithin(timeout(40));

  // A brand-new file write must NOT slip in ahead of the queued run.
  let lateEntered = false;
  const late = coordinator.withFileLock('g', async () => {
    lateEntered = true;
    order.push('late:start');
    return 'late';
  });
  await settleWithin(timeout(40));
  assert.equal(lateEntered, false, 'new file write must not bypass a queued run');

  fileGate.resolve();
  await file;
  assert.equal(await settleWithin(run), 'run');
  assert.equal(await settleWithin(late), 'late');
  assert.deepEqual(order, ['file:start', 'file:end', 'run:start', 'late:start']);
});

test('parallel same-file subagent edits cannot silently clobber each other', async () => {
  await withBundle(async (bundle, workspaceRoot) => {
    await fs.writeFile(path.join(workspaceRoot, 'shared.txt'), 'a\n');
    // Both workers observe the file first (as real subagents would).
    await bundle.handlers.read({ file_path: 'shared.txt' });

    const results = await Promise.allSettled([
      bundle.handlers.edit({ file_path: 'shared.txt', old_string: 'a\n', new_string: 'a1\n' }, {}),
      bundle.handlers.edit({ file_path: 'shared.txt', old_string: 'a\n', new_string: 'a2\n' }, {}),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    // Serialized per path: one edit applies, the other surfaces a conflict
    // (observed-version or old_text mismatch) instead of silently losing a
    // change.
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    const conflictMessage = String(rejected[0].reason?.message || rejected[0].reason || '');
    assert.match(conflictMessage, /not found|stale|changed since/i);

    const final = await fs.readFile(path.join(workspaceRoot, 'shared.txt'), 'utf8');
    assert.ok(final === 'a1\n' || final === 'a2\n', 'final content is one complete edit, never interleaved');
  });
});

test('parallel same-file edits to disjoint regions both apply after waiting', async () => {
  await withBundle(async (bundle, workspaceRoot) => {
    await fs.writeFile(path.join(workspaceRoot, 'shared.txt'), 'a\nb\n');
    await bundle.handlers.read({ file_path: 'shared.txt' });

    const results = await Promise.allSettled([
      bundle.handlers.edit({ file_path: 'shared.txt', old_string: 'a\n', new_string: 'A\n' }, {}),
      bundle.handlers.edit({ file_path: 'shared.txt', old_string: 'b\n', new_string: 'B\n' }, {}),
    ]);

    // The second edit waits on the path lock and applies against the latest
    // content — tool mutations re-observe the file after every write, so the
    // observed-version check passes and both region-disjoint edits land.
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2, results.map((r) => r.reason?.message).join(' | '));
    const final = await fs.readFile(path.join(workspaceRoot, 'shared.txt'), 'utf8');
    assert.equal(final, 'A\nB\n');
  });
});

test('parallel full-file writes to the same file serialize without interleaving', async () => {
  await withBundle(async (bundle, workspaceRoot) => {
    await fs.writeFile(path.join(workspaceRoot, 'shared.txt'), 'base\n');
    await bundle.handlers.read({ file_path: 'shared.txt' });

    const results = await Promise.allSettled([
      bundle.handlers.write({ file_path: 'shared.txt', content: 'one\n' }, {}),
      bundle.handlers.write({ file_path: 'shared.txt', content: 'two\n' }, {}),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);

    const final = await fs.readFile(path.join(workspaceRoot, 'shared.txt'), 'utf8');
    assert.ok(final === 'one\n' || final === 'two\n', 'final content is one complete write, never interleaved');
  });
});

test('code-comment tools stay callable through the coordination wrapper', async () => {
  await withBundle(async (bundle, workspaceRoot) => {
    await fs.writeFile(path.join(workspaceRoot, 'a.js'), 'const a = 1;\n');
    const results = await Promise.allSettled([
      bundle.handlers.add_code_comment({ path: 'a.js', line: 1, comment: 'note one' }, {}),
      bundle.handlers.update_code_comment({ path: 'a.js', line: 1, comment: 'note two' }, {}),
    ]);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 0, rejected.map((r) => r.reason?.message).join(' | '));
    assert.match(await fs.readFile(path.join(workspaceRoot, 'a.js'), 'utf8'), /note/);
  });
});

test('parallel subagent writes to different files both apply', async () => {
  await withBundle(async (bundle, workspaceRoot) => {
    await Promise.all([
      bundle.handlers.write({ file_path: 'one.txt', content: 'one\n' }, {}),
      bundle.handlers.write({ file_path: 'two.txt', content: 'two\n' }, {}),
    ]);
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'one.txt'), 'utf8'), 'one\n');
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'two.txt'), 'utf8'), 'two\n');
  });
});

test('shell handler stays callable through the coordination wrapper', async () => {
  await withBundle(async (bundle) => {
    assert.equal(typeof bundle.handlers.Bash, 'function');
    // `node` is never classified read-only, so this exercises the exclusive
    // run-lock path; it must still complete normally.
    const result = await bundle.handlers.Bash(
      { command: 'node -e "process.exit(0)"' },
      {},
    );
    assert.equal(result?.code, 0);
  });
});

test('Windows redirection writes are guarded even though classifyCommandRisk reports read-only', () => {
  // On win32, classifyCommandRisk does not apply the write-syntax patterns, so
  // a redirect like `echo x > out.txt` is reported read-only. The coordination
  // wrapper must not skip the lock on those.
  assert.equal(classifyCommandRisk('echo hello > out.txt', 'powershell', 'win32'), 'read-only');
  assert.equal(hasShellWriteSyntax('echo hello > out.txt'), true);
  assert.equal(hasShellWriteSyntax('Get-Content a.txt >> b.txt'), true);
  assert.equal(hasShellWriteSyntax('git status'), false);
  assert.equal(hasShellWriteSyntax('Get-ChildItem'), false);
});
