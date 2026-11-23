import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  detectWorkspaceIsGit,
  inspectOutsideWorkspaceMutation,
  resolveApprovalProjectIsGit,
  toolRequiresUserApproval
} from '../src/core/approval-policy.js';
import { resolveShellApprovalStrategy, runAgentLoop } from '../src/core/agent-loop.js';
import {
  getBuiltinTools,
  hasRunCommandSafeModeApproval,
  hasSandboxEscalationApproval,
} from '../src/core/tools.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { __setSandboxProbeTestHooks } from '../src/core/sandbox-probe.js';
import { resolvePlanSubAgentApprovalOptions, ROLE_TOOL_POLICY } from '../src/core/chat-runtime.js';

test('resolveApprovalProjectIsGit treats workspace .git as git even when tracker disabled', () => {
  assert.equal(
    resolveApprovalProjectIsGit({
      projectIsGit: false,
      changeTrackerEnabled: false,
      workspaceHasGit: true
    }),
    true
  );
  assert.equal(
    resolveApprovalProjectIsGit({
      projectIsGit: false,
      changeTrackerEnabled: false,
      workspaceHasGit: false
    }),
    false
  );
});

test('detectWorkspaceIsGit finds .git directory', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-git-detect-'));
  try {
    assert.equal(await detectWorkspaceIsGit(dir), false);
    await fs.mkdir(path.join(dir, '.git'));
    assert.equal(await detectWorkspaceIsGit(dir), true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('auto mode skips recoverable workspace edit approval in git and non-git projects', () => {
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    false
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: false,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    false
  );
});

test('auto mode treats commit_write as the mutating boundary', () => {
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: false,
      toolName: 'commit_write',
      alwaysAllowTools: ['begin_write', 'write_chunk', 'abort_write']
    }),
    false
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: true,
      toolName: 'commit_write',
      alwaysAllowTools: ['begin_write', 'write_chunk', 'abort_write']
    }),
    false
  );
});

test('review mode still prompts for coder edits unless role tools are always-allowed', () => {
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ['run', 'read']
    }),
    true
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: true,
      toolName: 'edit',
      alwaysAllowTools: ROLE_TOOL_POLICY.coder
    }),
    false
  );
});

test('outside-workspace mutations require approval unless OS sandbox confines', () => {
  for (const approvalMode of ['review', 'auto', 'full_access']) {
    assert.equal(
      toolRequiresUserApproval({
        approvalMode,
        projectIsGit: true,
        toolName: 'write',
        isOutsideWorkspaceMutation: true,
        alwaysAllowTools: ['write']
      }),
      approvalMode !== 'full_access'
    );
  }
  // OS sandbox already fences outside writes — soft outside-dir review is skipped.
  for (const approvalMode of ['review', 'auto', 'full_access']) {
    assert.equal(
      toolRequiresUserApproval({
        approvalMode,
        projectIsGit: true,
        toolName: 'write',
        isOutsideWorkspaceMutation: true,
        osSandboxConfining: true,
        alwaysAllowTools: ['write']
      }),
      false,
      approvalMode
    );
  }
});

test('sandbox escalation opens approval only in review and auto modes', () => {
  for (const approvalMode of ['review', 'auto', 'full_access']) {
    assert.equal(
      toolRequiresUserApproval({
        approvalMode,
        projectIsGit: true,
        toolName: 'run',
        isSandboxEscalation: true,
        alwaysAllowTools: ['run'],
      }),
      approvalMode !== 'full_access',
      approvalMode,
    );
  }
});

test('sandbox escalation gives the user LLM risk advice before approval', async () => {
  let completionIndex = 0;
  let approvalRequests = 0;
  let evaluatorCalls = 0;
  let handlerArgs = null;
  const config = {
    memory: { enabled: false },
    sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox' },
  };

  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'verify on the host',
    model: 'test-model',
    workspaceRoot: process.cwd(),
    requestCompletion: async () => {
      completionIndex += 1;
      return completionIndex === 1
        ? {
            text: '',
            toolCalls: [{
              id: 'host-escalation',
              name: 'Bash',
              arguments: JSON.stringify({
                command: 'npm test',
                sandbox_permissions: 'danger-full-access',
                justification: 'The Linux guest cannot load Windows native dependencies.',
              }),
              argumentsComplete: true,
            }],
          }
        : { text: 'done', toolCalls: [] };
    },
    evaluateCommand: async () => {
      evaluatorCalls += 1;
      return {
        risk: 'medium',
        description: 'Runs project tests on the Windows host.',
        recommendation: 'review',
      };
    },
    toolHandlers: {
      Bash: async (args) => {
        handlerArgs = args;
        return { ok: true };
      },
    },
    approvalMode: 'auto',
    alwaysAllowTools: ['run'],
    requestToolApproval: async (request) => {
      approvalRequests += 1;
      assert.equal(request.arguments?._evaluation?.risk, 'medium');
      return { approved: true };
    },
    skipAnalysisNudge: true,
    config,
  });

  assert.equal(result.text, 'done');
  assert.equal(approvalRequests, 1);
  assert.equal(evaluatorCalls, 1);
  assert.equal(hasSandboxEscalationApproval(handlerArgs), true);
});

test('deterministic command gates do not open review in full access', () => {
  for (const approvalMode of ['review', 'auto', 'full_access']) {
    assert.equal(toolRequiresUserApproval({
      approvalMode,
      toolName: 'Bash',
      isDeterministicCommandGate: true,
      alwaysAllowTools: ['run'],
    }), approvalMode !== 'full_access', approvalMode);
  }
});

test('full access executes commands without review and does not widen active sandbox settings', async () => {
  let completionCount = 0;
  const executed = [];
  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'test',
    model: 'test-model',
    workspaceRoot: process.cwd(),
    approvalMode: 'full_access',
    config: {
      memory: { enabled: false },
      sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox', network: 'none' },
      policy: { safe_mode: true },
    },
    skipAnalysisNudge: true,
    requestCompletion: async () => {
      if (completionCount++) return { text: 'done' };
      const calls = [
        { command: 'npm install' },
        { command: 'git status', network_access: true },
        { command: 'npm test', sandbox_permissions: 'danger-full-access', justification: 'Run on the host.' },
      ];
      return { toolCalls: calls.map((args, index) => ({
        id: `full-access-${index}`,
        name: 'Bash',
        arguments: JSON.stringify(args),
      })) };
    },
    evaluateCommand: async () => assert.fail('unexpected model review'),
    requestToolApproval: async () => {
      assert.fail('unexpected approval dialog');
    },
    toolHandlers: { Bash: async ({ command }) => { executed.push(command); return { ok: true }; } },
  });
  assert.equal(result.text, 'done');
  assert.deepEqual(executed, ['npm install']);
});

test('auto reviews host commands as unconfined with and without Windows sandbox fallback', async () => {
  for (const enabled of process.platform === 'win32' ? [false, 'auto'] : [false]) {
    let completionCount = 0;
    let review;
    let executionCount = 0;
    const config = {
      memory: { enabled: false },
      sandbox: { enabled, mode: 'workspace-write', network: 'none' },
      execution: { approval_mode: 'auto' },
      policy: { safe_mode: true },
    };
    __setSandboxProbeTestHooks({ resolveMsbBinary: () => null });
    try {
      await runAgentLoop({
        systemPrompt: 'test',
        userPrompt: 'test',
        model: 'test-model',
        approvalMode: 'auto',
        projectIsGit: true,
        config,
        skipAnalysisNudge: true,
        requestCompletion: async () => completionCount++ ? { text: 'done' } : {
          toolCalls: [{
            id: 'review-host',
            name: 'Powershell',
            arguments: JSON.stringify({ command: 'node -e "console.log(1)" | wc -l' }),
          }],
        },
        evaluateCommand: async ({ config: actual }) => {
          review = actual;
          return { risk: 'low', recommendation: 'allow', failed: false };
        },
        requestToolApproval: async () => assert.fail('low-risk Git command should not open a dialog'),
        toolHandlers: { Powershell: async () => { executionCount++; return { ok: true }; } },
      });
      assert.equal(review?.sandbox?.enabled, false);
      assert.equal(review?.sandbox?.mode, 'danger-full-access');
      assert.equal(review?.sandbox?.network, 'allow-all');
      if (process.platform === 'win32') assert.equal(review?.shell?.default, 'powershell');
      assert.equal(executionCount, 1);
    } finally {
      __setSandboxProbeTestHooks(null);
    }
  }
});

test('confining sandbox replaces LLM review for routine Bash outside review mode', () => {
  const config = {
    shell: { default: 'bash' },
    policy: {
      safe_mode: true,
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
  };
  const sandboxed = resolveShellApprovalStrategy({
    command: 'npm test',
    config,
    osSandboxConfining: true,
    approvalMode: 'auto',
  });
  assert.equal(sandboxed.sandboxFirst, true);
  assert.equal(sandboxed.needsLlmReview, false);
  assert.equal(sandboxed.deterministicGate, false);

  assert.equal(resolveShellApprovalStrategy({
    command: 'npm test',
    config,
    osSandboxConfining: false,
    approvalMode: 'auto',
    platform: 'linux',
  }).needsLlmReview, true);
  assert.equal(resolveShellApprovalStrategy({
    command: 'npm test',
    config,
    osSandboxConfining: true,
    approvalMode: 'review',
  }).needsLlmReview, true);

  const install = resolveShellApprovalStrategy({
    command: 'npm install',
    config,
    osSandboxConfining: true,
    approvalMode: 'auto',
  });
  assert.equal(install.deterministicGate, true);
  assert.equal(install.sandboxFirst, false);
  assert.equal(install.needsLlmReview, false);
});

test('Windows auto mode skips LLM review only for explicit routine project commands', () => {
  const config = {
    shell: { default: 'powershell' },
    sandbox: { enabled: false },
    policy: { safe_mode: true, blocked_command_patterns: [] },
  };
  const routine = resolveShellApprovalStrategy({
    command: 'npm run build:web',
    config,
    approvalMode: 'auto',
    platform: 'win32',
    projectIsGit: true,
  });
  assert.equal(routine.windowsFastLane, true);
  assert.equal(routine.needsLlmReview, false);

  const nonGitRoutine = resolveShellApprovalStrategy({
    command: 'npm run format',
    config,
    approvalMode: 'auto',
    platform: 'win32',
    projectIsGit: false,
  });
  assert.equal(nonGitRoutine.windowsFastLane, false);
  assert.equal(nonGitRoutine.needsLlmReview, true);

  for (const command of ['node scripts/build.js', 'python cleanup.py']) {
    const opaque = resolveShellApprovalStrategy({ command, config, approvalMode: 'auto', platform: 'win32' });
    assert.equal(opaque.windowsFastLane, false, command);
    assert.equal(opaque.needsLlmReview, true, command);
  }

  for (const command of ['npm test -- ..\\outside', 'Get-Content C:\\Windows\\win.ini']) {
    const escaping = resolveShellApprovalStrategy({ command, config, approvalMode: 'auto', platform: 'win32' });
    assert.equal(escaping.deterministicGate, true, command);
    assert.equal(escaping.needsLlmReview, false, command);
  }
});

test('opaque syntax requires model review even inside a confining sandbox', () => {
  const config = { shell: { default: 'bash' }, sandbox: { enabled: false },
    policy: { safe_mode: true, command_allowlist: [], blocked_commands: [], blocked_path_patterns: [], blocked_command_patterns: [] } };
  for (const command of ['echo $(printf ok)', 'echo `printf ok`', 'cat <(printf ok)', 'bash -lc "printf ok"']) {
    const strategy = resolveShellApprovalStrategy({ command, config, osSandboxConfining: true, approvalMode: 'auto' });
    assert.equal(strategy.deterministicGate, false, command);
    assert.equal(strategy.sandboxFirst, false, command);
    assert.equal(strategy.needsLlmReview, true, command);
  }
});

test('outside-workspace inspection reports resolved absolute targets', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-outside-approval-'));
  const project = path.join(parent, 'project');
  const outside = path.join(parent, 'exports', 'report.txt');
  try {
    await fs.mkdir(project);
    const details = await inspectOutsideWorkspaceMutation({
      workspaceRoot: project,
      toolName: 'write',
      arguments: { path: outside, content: 'report' }
    });
    assert.equal(details.outsideWorkspace, true);
    const physicalParent = await fs.realpath(parent);
    assert.equal(details.workspaceRoot, path.resolve(project));
    assert.deepEqual(details.paths, [path.join(physicalParent, 'exports', 'report.txt')]);

    assert.equal(await inspectOutsideWorkspaceMutation({
      workspaceRoot: project,
      toolName: 'edit',
      arguments: { path: 'src/app.js' }
    }), null);
  } finally {
    await fs.rm(parent, { recursive: true, force: true });
  }
});

test('agent loop requests review before an auto-mode outside write', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-outside-loop-'));
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = parent;
  const project = path.join(parent, 'project');
  const outside = path.join(parent, 'outside.txt');
  let completionIndex = 0;
  let handlerCalled = false;
  let approvalRequest = null;
  try {
    await fs.mkdir(project);
    const result = await runAgentLoop({
      systemPrompt: 'test',
      userPrompt: 'write outside',
      model: 'test-model',
      workspaceRoot: project,
      requestCompletion: async () => {
        completionIndex += 1;
        if (completionIndex === 1) {
          return {
            text: '',
            toolCalls: [{
              id: 'outside-write',
              name: 'write',
              arguments: JSON.stringify({ path: outside, content: 'blocked' }),
              argumentsComplete: true
            }]
          };
        }
        return { text: 'done', toolCalls: [] };
      },
      toolHandlers: {
        write: async () => {
          handlerCalled = true;
          return { ok: true };
        }
      },
      approvalMode: 'auto',
      alwaysAllowTools: ['write'],
      requestToolApproval: async (request) => {
        approvalRequest = request;
        return { approved: false };
      },
      skipAnalysisNudge: true,
      config: { memory: { enabled: false }, sandbox: { enabled: false } }
    });

    assert.equal(result.text, 'done');
    assert.equal(handlerCalled, false);
    const physicalParent = await fs.realpath(parent);
    assert.deepEqual(
      approvalRequest.approvalDetails.outsideWorkspaceMutation.paths,
      [path.join(physicalParent, 'outside.txt')]
    );
  } finally {
    closeSqliteDatabasesForTests(parent);
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('approval grants one exact outside write without changing allowed_paths', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-outside-grant-'));
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  process.env.CODEMINI_GLOBAL_DIR = parent;
  const project = path.join(parent, 'project');
  const outside = path.join(parent, 'approved.txt');
  const config = {
    memory: { enabled: false },
    policy: { allowed_paths: [] },
    runtime: {},
    sandbox: { enabled: false }
  };
  let completionIndex = 0;
  let tools;
  try {
    await fs.mkdir(project);
    tools = getBuiltinTools({ workspaceRoot: project, config, sessionId: 'outside-grant-test' });
    await runAgentLoop({
      systemPrompt: 'test',
      userPrompt: 'write approved outside file',
      model: 'test-model',
      workspaceRoot: project,
      requestCompletion: async () => {
        completionIndex += 1;
        return completionIndex === 1
          ? {
              text: '',
              toolCalls: [{
                id: 'outside-write-approved',
                name: 'write',
                arguments: JSON.stringify({ path: outside, content: 'approved' }),
                argumentsComplete: true
              }]
            }
          : { text: 'done', toolCalls: [] };
      },
      toolHandlers: tools.handlers,
      approvalMode: 'auto',
      alwaysAllowTools: ['write'],
      requestToolApproval: async () => ({ approved: true }),
      skipAnalysisNudge: true,
      config
    });

    assert.equal(await fs.readFile(outside, 'utf8'), 'approved');
    assert.deepEqual(config.policy.allowed_paths, []);
  } finally {
    await tools?.dispose();
    closeSqliteDatabasesForTests(parent);
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(parent, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('git auto mode executes low-risk allowed evaluations without manual review', async () => {
  let completionIndex = 0;
  let approvalRequests = 0;
  let handlerArgs = null;
  const config = {
    memory: { enabled: false },
    shell: { default: 'bash' },
    policy: {
      safe_mode: true,
      allow_dangerous_commands: false,
      allowed_paths: [],
      command_allowlist: [],
      blocked_commands: [],
      blocked_path_patterns: [],
      blocked_command_patterns: [],
    },
    sandbox: { enabled: false },
  };

  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'inspect with a custom command',
    model: 'test-model',
    workspaceRoot: process.cwd(),
    requestCompletion: async () => {
      completionIndex += 1;
      return completionIndex === 1
        ? {
            text: '',
            toolCalls: [{
              id: 'low-risk-run',
              name: 'Bash',
              arguments: JSON.stringify({ command: 'custom-inspect' }),
              argumentsComplete: true,
            }],
          }
        : { text: 'done', toolCalls: [] };
    },
    evaluateCommand: async () => ({
      risk: 'low',
      description: 'Reads local information.',
      sideEffects: 'None.',
      recommendation: 'allow',
      failed: false,
    }),
    toolHandlers: {
      Bash: async (args) => {
        handlerArgs = args;
        return { ok: true };
      },
    },
    approvalMode: 'auto',
    projectIsGit: true,
    alwaysAllowTools: ['run'],
    requestToolApproval: async () => {
      approvalRequests += 1;
      return { approved: false };
    },
    skipAnalysisNudge: true,
    config,
  });

  assert.equal(result.text, 'done');
  assert.equal(approvalRequests, 0);
  assert.equal(hasRunCommandSafeModeApproval(handlerArgs), true);
});

test('non-git auto mode keeps potentially mutating shell commands behind manual approval', async () => {
  let completionIndex = 0;
  let approvalRequests = 0;
  let handlerCalled = false;
  const config = {
    memory: { enabled: false },
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
    sandbox: { enabled: false },
  };

  await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'format a non-git project',
    model: 'test-model',
    workspaceRoot: process.cwd(),
    requestCompletion: async () => {
      completionIndex += 1;
      return completionIndex === 1
        ? {
            text: '',
            toolCalls: [{
              id: 'non-git-format',
              name: 'Powershell',
              arguments: JSON.stringify({ command: 'npm run format' }),
              argumentsComplete: true,
            }],
          }
        : { text: 'done', toolCalls: [] };
    },
    evaluateCommand: async () => ({
      risk: 'low',
      description: 'Formats project files.',
      sideEffects: 'May modify files.',
      recommendation: 'allow',
      failed: false,
    }),
    toolHandlers: {
      Powershell: async () => {
        handlerCalled = true;
        return { ok: true };
      },
    },
    approvalMode: 'auto',
    projectIsGit: false,
    alwaysAllowTools: ['run'],
    requestToolApproval: async () => {
      approvalRequests += 1;
      return { approved: false };
    },
    skipAnalysisNudge: true,
    config,
  });

  assert.equal(approvalRequests, 1);
  assert.equal(handlerCalled, false);
});

test('LLM evaluator failures reach manual approval with an explicit failure reason', async () => {
  let completionIndex = 0;
  let approvalRequest = null;
  const config = {
    memory: { enabled: false },
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
    sandbox: { enabled: false },
  };

  await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'inspect with PowerShell',
    model: 'test-model',
    workspaceRoot: process.cwd(),
    requestCompletion: async () => {
      completionIndex += 1;
      return completionIndex === 1
        ? {
            text: '',
            toolCalls: [{
              id: 'failed-review-run',
              name: 'Powershell',
              arguments: JSON.stringify({ command: 'custom-inspect' }),
              argumentsComplete: true,
            }],
          }
        : { text: 'done', toolCalls: [] };
    },
    evaluateCommand: async () => {
      throw new Error('gateway unavailable');
    },
    toolHandlers: { Powershell: async () => ({ ok: true }) },
    approvalMode: 'auto',
    projectIsGit: true,
    alwaysAllowTools: ['run'],
    requestToolApproval: async (request) => {
      approvalRequest = request;
      return { approved: false };
    },
    skipAnalysisNudge: true,
    config,
  });

  assert.equal(approvalRequest.arguments._evaluation.failed, true);
  assert.equal(approvalRequest.arguments._evaluation.failureReason, 'evaluator_error');
});

test('plan sub-agent approval options inherit role tools and workspace git', () => {
  const options = resolvePlanSubAgentApprovalOptions({
    role: 'coder',
    config: {},
    projectIsGit: false,
    changeTrackerEnabled: false,
    workspaceHasGit: true
  });
  assert.equal(options.projectIsGit, true);
  assert.ok(options.alwaysAllowTools.includes('edit'));
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'review',
      projectIsGit: options.projectIsGit,
      toolName: 'edit',
      alwaysAllowTools: options.alwaysAllowTools
    }),
    false
  );
  assert.equal(
    toolRequiresUserApproval({
      approvalMode: 'auto',
      projectIsGit: options.projectIsGit,
      toolName: 'write',
      alwaysAllowTools: ['run', 'read']
    }),
    false
  );
});
