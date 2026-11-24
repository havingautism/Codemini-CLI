import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getBuiltinTools } from '../src/core/tools.js';
import { getAgentTerminal, listAgentTerminals, subscribeAgentTerminals } from '../src/core/agent-terminals.js';

const shellTool = process.platform === 'win32' ? 'Powershell' : 'Bash';
const shellConfig = {
  shell: { default: shellTool.toLowerCase(), timeout_ms: 10000 },
  sandbox: { enabled: false },
  policy: { safe_mode: false },
};

async function waitFor(read) {
  for (let i = 0; i < 200; i += 1) {
    const value = read();
    if (value) return value;
    await delay(50);
  }
  assert.fail('Timed out waiting for command terminal state');
}

test('one-off commands keep their output and exit status in the tool result only', { timeout: 15000 }, async () => {
  const sessionId = 'agent-terminal-live-test';
  const changes = [];
  const unsubscribe = subscribeAgentTerminals(id => changes.push(id));
  const bundle = getBuiltinTools({
    sessionId,
    workspaceRoot: process.cwd(),
    config: shellConfig,
  });
  try {
    const command = 'node -e "console.log(\'agent-started\');setTimeout(() => { console.error(\'agent-failed\');process.exit(7); }, 300)"';
    const result = await bundle.handlers[shellTool]({ command });
    assert.ok(result.code > 0);
    assert.match(result.stdout, /agent-started/);
    assert.match(result.stderr, /agent-failed/);
    assert.deepEqual(listAgentTerminals(sessionId), []);
    assert.deepEqual(changes, []);
  } finally {
    unsubscribe();
    await bundle.dispose();
  }
});

test('npm run dev gets a terminal only while its background process is alive', { timeout: 20000 }, async () => {
  const sessionId = 'agent-terminal-background-test';
  const root = await mkdtemp(path.join(os.tmpdir(), 'codemini-agent-terminal-'));
  const bundle = getBuiltinTools({ sessionId, workspaceRoot: root, config: shellConfig });
  const changes = [];
  const unsubscribe = subscribeAgentTerminals(id => changes.push(id));
  try {
    const shortTask = await bundle.handlers[shellTool]({
      command: 'node -e "console.log(\'finished immediately\')"',
      run_in_background: true,
    });
    assert.equal(shortTask.status, 'exited');
    assert.deepEqual(listAgentTerminals(sessionId), []);
    assert.deepEqual(changes, []);

    await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { dev: 'node dev.mjs' } }));
    await writeFile(path.join(root, 'dev.mjs'), `
console.log('terminal-boot');
setTimeout(() => console.log('terminal-ready'), 350);
setTimeout(() => console.log('terminal-live'), 800);
setTimeout(() => {}, 2500);
`);
    const task = await bundle.handlers[shellTool]({
      command: 'npm run dev',
      success_matchers: ['terminal-ready'],
    });
    assert.equal(task.status, 'running');
    const [entry] = listAgentTerminals(sessionId);
    assert.equal(entry.background, true);
    assert.equal(entry.status, 'running');
    assert.equal(getAgentTerminal('another-session', entry.id), null);
    await waitFor(() => getAgentTerminal(sessionId, entry.id)?.output.includes('terminal-live'));
    assert.match(getAgentTerminal(sessionId, entry.id).output, /terminal-boot\nterminal-ready\nterminal-live/);
    await waitFor(() => listAgentTerminals(sessionId).length === 0);
    assert.equal(getAgentTerminal(sessionId, entry.id), null);
    assert.deepEqual(changes, [sessionId, sessionId]);
  } finally {
    unsubscribe();
    await bundle.dispose();
    if (path.dirname(path.resolve(root)) === path.resolve(os.tmpdir())) {
      await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  }
});
