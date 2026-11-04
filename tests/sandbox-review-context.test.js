import test from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { getBuiltinTools } from '../src/core/tools.js';

const command = 'node --test tests/staged-write.test.js 2>&1 | Select-Object -Last 15';
const low = { risk: 'low', recommendation: 'allow', failed: false };
const makeConfig = () => ({
  memory: { enabled: false },
  shell: { default: 'powershell' },
  policy: { safe_mode: true, command_allowlist: [], blocked_command_patterns: [] },
  sandbox: { enabled: true, mode: 'workspace-write', backend: 'microsandbox', network: 'none' },
});

test('Git auto review auto-allows the screenshot command unless it requests host escalation', async () => {
  for (const escalate of [false, true]) {
    const config = makeConfig();
    if (escalate) config.shell.default = 'bash';
    let completions = 0;
    let prompts = 0;
    let executions = 0;
    let reviews = 0;
    await runAgentLoop({
      systemPrompt: 'test', userPrompt: 'test', model: 'test',
      workspaceRoot: process.cwd(), config, projectIsGit: true,
      approvalMode: 'auto', skipAnalysisNudge: true,
      requestCompletion: async () => ++completions === 1 ? {
        toolCalls: [{ id: 'screenshot-command', name: 'Bash', arguments: JSON.stringify({
          command,
          ...(escalate ? { sandbox_permissions: 'danger-full-access', justification: 'Run tests on the host.' } : {}),
        }) }],
      } : { text: 'done' },
      evaluateCommand: async ({ config: reviewed, capability }) => {
        reviews++;
        assert.equal(reviewed.sandbox.enabled, !escalate);
        assert.equal(reviewed.sandbox.mode, escalate ? 'danger-full-access' : 'workspace-write');
        assert.equal(reviewed.sandbox.network, escalate ? 'allow-all' : 'none');
        assert.equal(reviewed.shell.default, escalate && process.platform !== 'win32' ? 'bash' : 'powershell');
        if (escalate) assert.match(capability, /Sandbox escalation.*Run tests on the host/);
        return low;
      },
      requestToolApproval: async () => { prompts++; return { approved: false }; },
      toolHandlers: { Bash: async () => { executions++; return { ok: true }; } },
    });
    assert.equal(prompts, escalate ? 1 : 0);
    assert.equal(executions, escalate ? 0 : 1);
    // A confining OS sandbox can skip model review altogether.
    assert.ok(escalate ? reviews === 1 : reviews <= 1);
    assert.equal(config.sandbox.mode, 'workspace-write');
    assert.equal(config.sandbox.network, 'none');
    assert.equal(config.shell.default, escalate ? 'bash' : 'powershell');
  }
});

test('read-only to workspace-write escalation keeps network confinement in risk advice', async () => {
  const config = makeConfig();
  config.sandbox.mode = 'read-only';
  let completions = 0;
  let reviewed = false;
  await runAgentLoop({
    systemPrompt: 'test', userPrompt: 'test', model: 'test', config,
    projectIsGit: true, approvalMode: 'auto', skipAnalysisNudge: true,
    requestCompletion: async () => ++completions === 1 ? {
      toolCalls: [{ id: 'workspace-escalation', name: 'Bash', arguments: JSON.stringify({
        command: 'npm test', sandbox_permissions: 'workspace-write', justification: 'Create test fixtures.',
      }) }],
    } : { text: 'done' },
    evaluateCommand: async ({ config: actual }) => {
      reviewed = true;
      assert.equal(actual.sandbox.enabled, true);
      assert.equal(actual.sandbox.mode, 'workspace-write');
      assert.equal(actual.sandbox.network, 'none');
      return low;
    },
    requestToolApproval: async () => ({ approved: false }),
    toolHandlers: { Bash: async () => assert.fail('denied escalation executed') },
  });
  assert.equal(reviewed, true);
  assert.equal(config.sandbox.mode, 'read-only');
});

test('shell approval explains host escalation even if the model says low risk', async () => {
  for (const language of ['zh', 'en']) {
    const config = { ...makeConfig(), ui: { reply_language: language } };
    const tools = await getBuiltinTools({ workspaceRoot: process.cwd(), config });
    try {
      const name = tools.definitions.find(d => /^(run|bash|powershell)$/i.test(d.function.name)).function.name;
      const args = { command, _evaluation: low };
      const normal = await tools.handlers[name].prepareApproval(args);
      assert.equal(normal.policyBlock, null);
      const details = await tools.handlers[name].prepareApproval({ ...args,
        sandbox_permissions: 'danger-full-access', justification: 'Host verification.',
      });
      assert.match(details.policyBlock.reason, language === 'zh' ? /关闭沙箱.*需要人工确认/ : /disables the sandbox.*explicit approval/);
      assert.match(details.policyBlock.reason, /Host verification/);
    } finally { await tools.dispose(); }
  }
});
