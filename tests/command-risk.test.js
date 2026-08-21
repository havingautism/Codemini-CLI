import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  classifyCommandRisk,
  isRoutineProjectCommand,
  requiresApprovalEvaluation,
  requiresDeterministicCommandApproval,
} from '../src/core/command-risk.js';
import { evaluateCommandPolicy } from '../src/core/command-policy.js';
import { getSessionsDir, getSkillsDir } from '../src/core/paths.js';

test('interpreter and package-script commands are never classified as read-only', () => {
  for (const command of [
    'node -e "process.stdout.write(\'ok\')"',
    'python -c "print(1)"',
    'py -m pytest',
    'npm test',
    'npm install',
    'npx vitest run',
  ]) {
    assert.notEqual(classifyCommandRisk(command), 'read-only', command);
    assert.equal(requiresApprovalEvaluation(command), true, command);
  }
});

test('ordinary inspection commands remain read-only', () => {
  for (const command of [
    'rg ToolRegistry src',
    'Get-Content package.json',
    'git status',
    'dir',
    'gci src',
    'npm list',
    'npm ls --depth=0',
    'node --version',
    'python --version',
    'which node',
    'tree src',
  ]) {
    assert.equal(classifyCommandRisk(command), 'read-only', command);
    assert.equal(requiresApprovalEvaluation(command), false, command);
  }
});

test('PowerShell read-only pipelines accept Split-Path without LLM review', () => {
  const workspaceRoot = 'E:\\Projects\\App';
  const command = `cd "${workspaceRoot}"; Get-ChildItem backend-python -Recurse -File -Filter *.py | Where-Object { $_.FullName -notmatch '\\.venv' } | Select-String -Pattern 'academic' -List | ForEach-Object { $_.Path } | Split-Path -Leaf | Sort-Object -Unique; Write-Host "=== frontend academic ==="; cd src; Get-ChildItem -Recurse -Include *.jsx,*.js -File | Select-String -Pattern 'academic' -List | ForEach-Object { $_.Path } | Sort-Object -Unique`;
  const config = {
    shell: { default: 'powershell' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };

  assert.equal(classifyCommandRisk(command, 'powershell', 'win32'), 'read-only');
  assert.deepEqual(evaluateCommandPolicy(command, config, workspaceRoot), { allowed: true });
});

test('bash safe-mode allowlist accepts the same ordinary read-only commands', () => {
  const command = 'echo "hello from shell" && date && pwd';
  const config = {
    shell: { default: 'bash' },
    sandbox: { enabled: false },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };

  assert.equal(classifyCommandRisk(command, 'bash', 'linux'), 'read-only');
  assert.deepEqual(evaluateCommandPolicy(command, config, process.cwd(), 'linux'), { allowed: true });
});

test('Microsandbox relies on the microVM boundary instead of the host command allowlist', () => {
  const config = {
    shell: { default: 'powershell' },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };

  for (const command of [
    'curl -I https://example.com',
    'echo hello >/workspace/sandbox_test.txt && cat /workspace/sandbox_test.txt',
    'pwd && whoami && uname -a || ver',
  ]) {
    assert.deepEqual(evaluateCommandPolicy(command, config), { allowed: true }, command);
  }

  const explicitlyBlocked = {
    ...config,
    policy: { ...config.policy, blocked_commands: ['curl'] },
  };
  assert.match(
    evaluateCommandPolicy('curl -I https://example.com', explicitlyBlocked).reason,
    /blocked command: curl/,
  );
});

test('OS sandbox backend still applies the host command allowlist', () => {
  const config = {
    shell: { default: 'bash' },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'os' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: ['echo', 'ls'],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };
  assert.deepEqual(evaluateCommandPolicy('echo hi', config, process.cwd(), 'darwin'), { allowed: true });
  assert.match(
    evaluateCommandPolicy('curl -I https://example.com', config, process.cwd(), 'darwin').reason,
    /command not in allowlist: curl/,
  );
});

test('read-only scanners do not inherit high-risk keywords from arguments', () => {
  for (const command of [
    'rg install src',
    'grep -R commit .',
    'git log --grep=commit',
    'find . -name "*rm*"',
  ]) {
    assert.equal(classifyCommandRisk(command), 'read-only', command);
  }
});

test('mutating package and shell commands stay elevated', () => {
  for (const command of [
    'npm install',
    'rm -rf dist',
    'git commit -m x',
    'mkdir foo',
  ]) {
    assert.equal(classifyCommandRisk(command), 'write-high-risk', command);
  }
});

test('Unix tightens dual-use commands without changing Windows classification', () => {
  for (const command of [
    'find . -exec rm -rf {} +',
    'git status > status.txt',
  ]) {
    assert.equal(classifyCommandRisk(command, 'bash', 'linux'), 'write-high-risk', command);
    assert.equal(classifyCommandRisk(command, 'powershell', 'win32'), 'read-only', command);
  }
  for (const command of [
    'date --set="2026-01-01"',
    'env bash -c "echo changed > file"',
    'sort input.txt -o output.txt',
  ]) {
    assert.notEqual(classifyCommandRisk(command, 'bash', 'linux'), 'read-only', command);
  }
  for (const command of [
    'git branch -D tmp',
    'git tag -d v1',
    'git config user.email x@y',
    'npm version patch',
    'go env -w GOPROXY=off',
  ]) {
    assert.notEqual(classifyCommandRisk(command, 'bash', 'linux'), 'read-only', command);
    assert.equal(classifyCommandRisk(command, 'powershell', 'win32'), 'read-only', command);
  }
});

test('deterministic command gates cover external and destructive effects without catching routine workspace work', () => {
  for (const command of [
    'git push origin main',
    'git reset --hard HEAD~1',
    'npm install',
    'curl -X POST https://example.com/items',
    'sudo systemctl restart app',
    'rm -rf dist',
    'bash -lc "kubectl delete pod app"',
  ]) {
    assert.equal(requiresDeterministicCommandApproval(command), true, command);
  }
  for (const command of [
    'npm test',
    'npm run build',
    'mkdir dist',
    'touch output.txt',
    'echo ok > output.txt',
    'rm output.txt',
    'rg "git push" src',
  ]) {
    assert.equal(requiresDeterministicCommandApproval(command), false, command);
  }
});

test('Windows routine project commands are explicit and reject opaque or escaping inputs', () => {
  for (const command of [
    'npm test',
    'npm run build:web',
    'node --test tests/tools.test.js',
    'python -m pytest',
    'cargo clippy',
    'dotnet test',
  ]) assert.equal(isRoutineProjectCommand(command), true, command);

  for (const command of [
    'npm install',
    'npm run deploy',
    'node scripts/build.js',
    'python cleanup.py',
    'npm test -- ../outside',
    'npm test > result.txt',
  ]) assert.equal(isRoutineProjectCommand(command), false, command);
});

test('bash policy ignores the null device and absolute-looking fragments inside globs', () => {
  const config = {
    shell: { default: 'bash' },
    sandbox: { enabled: false },
    policy: {
      safe_mode: true,
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };
  const workspaceRoot = '/home/user/projects/app';
  for (const command of [
    'cd /home/user/projects/app && ls src 2>/dev/null',
    'find /home/user/projects/app -name package.json -not -path "*/node_modules/*" 2>/dev/null',
  ]) {
    assert.equal(evaluateCommandPolicy(command, config, workspaceRoot, 'linux').allowed, true, command);
  }
  assert.match(
    evaluateCommandPolicy('echo nope >/tmp/outside.txt', config, workspaceRoot, 'linux').reason,
    /absolute path outside workspace/,
  );
});

test('shell policy allows read-only global skill scripts but not sessions', () => {
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = '/tmp/codemini-policy-skills-global';
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  try {
    const platform = process.platform;
    const shell = platform === 'win32' ? 'powershell' : 'bash';
    const config = {
      shell: { default: shell },
      sandbox: { enabled: false },
      policy: {
        safe_mode: true,
        command_allowlist: [],
        blocked_commands: [],
        blocked_path_patterns: [],
        blocked_command_patterns: [],
      },
    };
    const workspaceRoot = process.cwd();
    const skillScript = path.join(getSkillsDir(), 'demo', 'scripts', 'score.py');
    const sessionFile = path.join(getSessionsDir(), 'abc', 'log.txt');
    assert.equal(
      evaluateCommandPolicy(`python "${skillScript}"`, config, workspaceRoot, platform).allowed,
      true,
    );
    assert.match(
      evaluateCommandPolicy(
        `${platform === 'win32' ? 'Get-Content' : 'cat'} "${sessionFile}"`,
        config,
        workspaceRoot,
        platform,
      ).reason,
      /absolute path outside workspace/,
    );

    process.env.CODEMINI_GLOBAL_DIR = '/Users/someone/Library/Preferences/codemini-global';
    const macSkillScript = path.join(getSkillsDir(), 'demo', 'scripts', 'score.py');
    assert.equal(
      evaluateCommandPolicy(`python "${macSkillScript}"`, config, workspaceRoot, platform).allowed,
      true,
    );
  } finally {
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
  }
});
