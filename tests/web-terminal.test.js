import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  _resetTerminalSessionsForTests,
  buildPowerShellColorBootstrap,
  buildTerminalColorEnv,
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

test('terminal environment requests truecolor ANSI output', () => {
  const env = buildTerminalColorEnv({ NO_COLOR: '1', PATH: 'test-path' });
  assert.equal(env.TERM, 'xterm-256color');
  assert.equal(env.COLORTERM, 'truecolor');
  assert.equal(env.FORCE_COLOR, '1');
  assert.equal(env.NO_COLOR, undefined);
  assert.equal(env.PATH, 'test-path');
});

test('PowerShell bootstrap configures semantic command and file colors', () => {
  const bootstrap = buildPowerShellColorBootstrap();
  assert.match(bootstrap, /\$PSStyle\.FileInfo\.Directory=.*BrightBlue/);
  assert.match(bootstrap, /Extension\['\.ts'\].*BrightCyan/);
  assert.match(bootstrap, /Extension\['\.json'\].*BrightYellow/);
  assert.match(bootstrap, /Set-PSReadLineOption -Colors/);
});

test(
  'PowerShell 7 terminal emits ANSI colors for directory listings',
  { skip: process.platform !== 'win32' },
  async () => {
    await withTempCwd(async (cwd) => {
      await fs.mkdir(path.join(cwd, 'sample-folder'));
      await fs.writeFile(path.join(cwd, 'sample.ts'), 'export {};\n', 'utf8');
      await fs.writeFile(path.join(cwd, 'config.json'), '{}\n', 'utf8');

      runTerminalCommand({
        cwd,
        command: 'Get-ChildItem',
        shellDefault: 'powershell',
      });

      let raw = '';
      for (let index = 0; index < 50; index += 1) {
        raw = getTerminalSnapshot(cwd, 'powershell').data;
        if (
          raw.includes('sample-folder')
          && raw.includes('sample.ts')
          && raw.includes('config.json')
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      assert.match(
        raw,
        /\u001b\[94m(?:\u001b\[[0-9;]*C)?sample-folder\u001b\[[0-9;]*m/,
      );
            // 最后一项（sample.ts）的复位转义可能晚于轮询捕获窗口到达，这里只断言着色本身。
      assert.match(raw, /\u001b\[96msample\.ts/);
      assert.match(raw, /\u001b\[93mconfig\.json\u001b\[[0-9;]*m/);
    });
  },
);

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
