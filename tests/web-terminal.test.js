import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  _resetTerminalSessionsForTests,
  formatTerminalPlainText,
  getTerminalSnapshot,
  resizeTerminal,
  restartTerminal,
  runTerminalCommand,
  stopTerminal,
  writeTerminalInput,
  stripAnsi,
} from '../codemini-web/lib/web-terminal.js';

async function withTempCwd(fn) {
  const testRoot = path.join(process.cwd(), '.codemini', 'test-terminal');
  await fs.mkdir(testRoot, { recursive: true });
  const cwd = await fs.mkdtemp(path.join(testRoot, 'codemini-term-'));
  try {
    return await fn(cwd);
  } finally {
    await _resetTerminalSessionsForTests();
    await fs.rm(cwd, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

test('stripAnsi removes color codes', () => {
  assert.equal(stripAnsi('\u001b[32mok\u001b[0m'), 'ok');
});

test('formatTerminalPlainText is copy-friendly', () => {
  const text = formatTerminalPlainText(
    [
      { kind: 'sys', text: 'pwsh · /tmp' },
      { kind: 'in', text: 'echo hi' },
      { kind: 'out', text: 'hi' },
    ],
    { shell: 'pwsh', cwd: '/tmp' },
  );
  assert.match(text, /^pwsh · \/tmp\n/);
  assert.match(text, /PS \/tmp> echo hi\n/);
  assert.match(text, /\nhi$/);
  assert.equal(text.match(/pwsh · \/tmp/g)?.length, 1);
});

test('web terminal runs hand-typed commands through a PTY', async () => {
  await withTempCwd(async (cwd) => {
    const shellDefault = process.platform === 'win32' ? 'powershell' : 'bash';
    const command =
      process.platform === 'win32'
        ? 'Write-Output hello-terminal'
        : 'echo hello-terminal';
    const started = runTerminalCommand({
      cwd,
      command,
      shellDefault,
      // Would previously fail under safe_mode allowlists; must be ignored.
      config: {
        policy: {
          safe_mode: true,
          allow_dangerous_commands: false,
          command_allowlist: ['echo'],
          blocked_command_patterns: [],
        },
      },
    });
    assert.equal(started.ok, true);

    let snap;
    for (let i = 0; i < 40; i += 1) {
      snap = getTerminalSnapshot(cwd, shellDefault);
      const occurrences = stripAnsi(snap.data).match(/hello-terminal/g)?.length || 0;
      if (occurrences >= 2) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    snap = getTerminalSnapshot(cwd, shellDefault);
    assert.ok(
      (stripAnsi(snap.data).match(/hello-terminal/g)?.length || 0) >= 2,
      'expected the command echo and command output',
    );
  });
});

test('web terminal preserves shell state between commands', async () => {
  await withTempCwd(async (cwd) => {
    const shellDefault = process.platform === 'win32' ? 'powershell' : 'bash';
    const setCommand =
      process.platform === 'win32'
        ? "$env:CODEMINI_TERM_STATE='kept'"
        : 'export CODEMINI_TERM_STATE=kept';
    const readCommand =
      process.platform === 'win32'
        ? 'Write-Output "STATE=$env:CODEMINI_TERM_STATE"'
        : 'printf "STATE=%s\\n" "$CODEMINI_TERM_STATE"';

    runTerminalCommand({
      cwd,
      command: setCommand,
      shellDefault,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    runTerminalCommand({
      cwd,
      command: readCommand,
      shellDefault,
    });

    let snap;
    for (let i = 0; i < 40; i += 1) {
      snap = getTerminalSnapshot(cwd, shellDefault);
      if (stripAnsi(snap.data).includes('STATE=kept')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.match(stripAnsi(snap?.data), /STATE=kept/);
  });
});

test('rapid terminal resizes do not duplicate a hand-typed command', async () => {
  await withTempCwd(async (cwd) => {
    const shellDefault = process.platform === 'win32' ? 'powershell' : 'bash';
    const marker = 'codemini_resize_marker';
    const command =
      process.platform === 'win32'
        ? `$${marker} = 1`
        : `${marker}=1`;

    writeTerminalInput(cwd, `${command}\r`, shellDefault);
    for (let index = 0; index < 24; index += 1) {
      resizeTerminal(
        cwd,
        index % 2 === 0 ? 54 : 92,
        24,
        shellDefault,
      );
    }

    let text = '';
    for (let index = 0; index < 40; index += 1) {
      text = stripAnsi(getTerminalSnapshot(cwd, shellDefault).data);
      if (text.includes(marker)) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        text = stripAnsi(getTerminalSnapshot(cwd, shellDefault).data);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    assert.equal(
      text.match(new RegExp(marker, 'g'))?.length || 0,
      1,
      'expected one terminal echo for one submitted command',
    );
  });
});

test('stopping a command emits one termination message', async () => {
  await withTempCwd(async (cwd) => {
    const shellDefault = process.platform === 'win32' ? 'powershell' : 'bash';
    const longCommand =
      process.platform === 'win32'
        ? 'Start-Sleep -Seconds 5'
        : 'sleep 5';
    const started = runTerminalCommand({
      cwd,
      command: longCommand,
      shellDefault,
    });
    assert.equal(started.ok, true);

    const stopped = stopTerminal(cwd);
    assert.equal(stopped.stopped, true);
    await new Promise((resolve) => setTimeout(resolve, 300));

    const snap = getTerminalSnapshot(cwd, shellDefault);
    const terminationLines = snap.lines.filter(
      (line) =>
        line.kind === 'sys' &&
        (/^stopped\b/.test(line.text) || /^exit signal\b/.test(line.text)),
    );
    assert.deepEqual(
      terminationLines.map((line) => line.text),
      [`stopped: ${longCommand}`],
    );
  });
});

test('restarting a terminal discards output from the previous PTY', async () => {
  await withTempCwd(async (cwd) => {
    const shellDefault = process.platform === 'win32' ? 'powershell' : 'bash';
    const longCommand =
      process.platform === 'win32'
        ? 'ping -t 127.0.0.1'
        : 'while true; do echo OLD_OUTPUT; sleep 0.1; done';
    runTerminalCommand({
      cwd,
      command: longCommand,
      shellDefault,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));

    restartTerminal(cwd, shellDefault);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const text = stripAnsi(getTerminalSnapshot(cwd, shellDefault).data);
    assert.doesNotMatch(text, /ping -t|OLD_OUTPUT|Control-C/);
  });
});
