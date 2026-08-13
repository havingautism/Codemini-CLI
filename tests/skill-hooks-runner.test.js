import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runCommandHook } from '../src/core/skill-hooks-runner.js';

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-hooks-runner-'));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeNodeFixture(filePath, body) {
  const script = `import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
let data = '';
for await (const chunk of rl) data += chunk;
${body}`;
  await fs.writeFile(filePath, script, 'utf8');
}

test('PreToolUse deny fails closed when failClosed true', async () => {
  await withFixture(async (root) => {
    const denyFixture = path.join(root, 'deny.mjs');
    await writeNodeFixture(
      denyFixture,
      `process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'blocked' }));`,
    );

    const result = await runCommandHook({
      command: `node "${denyFixture}"`,
      timeout: 5,
      failClosed: true,
      input: { hook_event_name: 'PreToolUse', tool_name: 'run' },
      env: {
        CLAUDE_PROJECT_DIR: root,
        CLAUDE_PLUGIN_ROOT: root,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'blocked');
  });
});

test('timeout fail-open when failClosed false', async () => {
  await withFixture(async (root) => {
    const sleepFixture = path.join(root, 'sleep.mjs');
    await writeNodeFixture(
      sleepFixture,
      'await new Promise((resolve) => setTimeout(resolve, 30000));\n',
    );
    const started = Date.now();
    const result = await runCommandHook({
      command: `node "${sleepFixture}"`,
      timeout: 0.3,
      failClosed: false,
      input: { hook_event_name: 'Stop' },
    });
    const elapsed = Date.now() - started;

    assert.equal(result.ok, false);
    assert.equal(result.failOpen, true);
    assert.ok(elapsed < 5000, `timeout should abort quickly, took ${elapsed}ms`);
  });
});

test('allow decision path parses hook output fields', async () => {
  await withFixture(async (root) => {
    const allowFixture = path.join(root, 'allow.mjs');
    await writeNodeFixture(
      allowFixture,
      `process.stdout.write(JSON.stringify({
        decision: 'allow',
        reason: 'ok',
        hookSpecificOutput: { additionalContext: 'extra context' },
        systemMessage: 'system note',
      }));`,
    );

    const result = await runCommandHook({
      command: `node "${allowFixture}"`,
      timeout: 5,
      failClosed: false,
      input: { hook_event_name: 'SessionStart' },
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision, 'allow');
    assert.equal(result.reason, 'ok');
    assert.equal(result.additionalContext, 'extra context');
    assert.equal(result.systemMessage, 'system note');
  });
});

test('expands CLAUDE_PROJECT_DIR placeholder in command', async () => {
  await withFixture(async (root) => {
    const hookPath = path.join(root, 'placeholder.mjs');
    await writeNodeFixture(
      hookPath,
      `process.stdout.write(JSON.stringify({ decision: 'allow', marker: 'expanded' }));`,
    );

    const result = await runCommandHook({
      command: 'node "${CLAUDE_PROJECT_DIR}/placeholder.mjs"',
      timeout: 5,
      failClosed: false,
      input: { hook_event_name: 'UserPromptSubmit' },
      env: {
        CLAUDE_PROJECT_DIR: root.replace(/\\/g, '/'),
        CLAUDE_PLUGIN_ROOT: root.replace(/\\/g, '/'),
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.decision, 'allow');
  });
});

test('exit code 2 implies deny decision', async () => {
  const result = await runCommandHook({
    command: 'node -e "process.exit(2)"',
    timeout: 5,
    failClosed: false,
    input: { hook_event_name: 'PreToolUse', tool_name: 'run' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision, 'deny');
  assert.equal(result.exitCode, 2);
});

test('parses current Claude PreToolUse structured decisions and updated input', async () => {
  await withFixture(async (root) => {
    const fixture = path.join(root, 'structured.mjs');
    await writeNodeFixture(
      fixture,
      `process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: 'blocked by policy',
          updatedInput: { command: 'npm test' },
          additionalContext: 'production environment'
        }
      }));`,
    );
    const result = await runCommandHook({
      command: `node "${fixture}"`,
      input: { hook_event_name: 'PreToolUse', tool_name: 'run' },
      cwd: root,
    });
    assert.equal(result.decision, 'deny');
    assert.equal(result.reason, 'blocked by policy');
    assert.deepEqual(result.updatedInput, { command: 'npm test' });
    assert.equal(result.additionalContext, 'production environment');
  });
});

test('preserves Stop block decisions', async () => {
  await withFixture(async (root) => {
    const fixture = path.join(root, 'stop.mjs');
    await writeNodeFixture(
      fixture,
      `process.stdout.write(JSON.stringify({ decision: 'block', reason: 'keep working' }));`,
    );
    const result = await runCommandHook({
      command: `node "${fixture}"`,
      input: { hook_event_name: 'Stop' },
      cwd: root,
    });
    assert.equal(result.decision, 'block');
    assert.equal(result.reason, 'keep working');
  });
});
