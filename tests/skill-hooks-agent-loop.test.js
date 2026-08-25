import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAgentLoop } from '../src/core/agent-loop.js';
import { createSkillHooksSession, armSkillHooks } from '../src/core/skill-hooks-session.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

async function withFixture(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-agent-loop-hooks-'));
  try {
    return await fn(root);
  } finally {
    closeSqliteDatabasesForTests(root);
    await fs.rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 40 });
  }
}

async function writeHookScript(filePath, body) {
  await fs.writeFile(filePath, body, 'utf8');
}

function armHook(session, name, eventName, command, { matcher } = {}) {
  armSkillHooks(session, {
    name,
    hooks: {
      [eventName]: [{ matcher, hooks: [{ type: 'command', command, timeout: 5, failClosed: false }] }]
    },
    pluginRoot: `/plugins/${name}`
  });
}

function makeCompletionSequence(sequence) {
  let call = 0;
  const fn = async ({ messages } = {}) => {
    fn.calls.push({ messages });
    const next = sequence[Math.min(call, sequence.length - 1)];
    call += 1;
    return next;
  };
  fn.calls = [];
  return fn;
}

test('PreToolUse deny blocks tool execution without running the handler, and Stop fires once', async () => {
  await withFixture(async (root) => {
    const denyScript = path.join(root, 'deny.mjs');
    await writeHookScript(denyScript, "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'blocked by policy' }));");
    const stopScript = path.join(root, 'stop.mjs');
    await writeHookScript(stopScript, "process.stdout.write(JSON.stringify({ decision: 'allow' }));");

    const session = createSkillHooksSession();
    armHook(session, 'guard', 'PreToolUse', `node "${denyScript}"`);
    armHook(session, 'tracker', 'Stop', `node "${stopScript}"`);

    let handlerCalled = false;
    const toolHandlers = {
      test_tool: async () => {
        handlerCalled = true;
        return { ok: true };
      }
    };

    const events = [];
    const requestCompletion = makeCompletionSequence([
      { text: '', toolCalls: [{ id: 'call-1', name: 'test_tool', arguments: '{}' }] },
      { text: 'final answer', toolCalls: [] }
    ]);

    const result = await runAgentLoop({
      systemPrompt: 'sys',
      userPrompt: 'do it',
      model: 'test-model',
      requestCompletion,
      toolHandlers,
      toolDefinitions: [],
      approvalMode: 'full_access',
      skipAnalysisNudge: true,
      skillHooksSession: session,
      workspaceRoot: root,
      onEvent: (event) => events.push(event)
    });

    assert.equal(handlerCalled, false, 'handler must not run when PreToolUse denies');
    assert.equal(result.text, 'final answer');

    const toolErrorEvent = events.find((e) => e.type === 'tool:error' && e.name === 'test_tool');
    assert.ok(toolErrorEvent, 'tool:error event expected for the denied tool call');
    assert.match(toolErrorEvent.summary, /blocked by policy/);

    const preHookEnds = events.filter((e) => e.type === 'hook:end' && e.event === 'PreToolUse');
    assert.equal(preHookEnds.length, 1);
    assert.equal(preHookEnds[0].decision, 'deny');

    const stopHookEnds = events.filter((e) => e.type === 'hook:end' && e.event === 'Stop');
    assert.equal(stopHookEnds.length, 1, 'Stop hook should fire exactly once for the whole loop');
  });
});

test('PreToolUse ask requests approval even when the hook does not update tool input', async () => {
  await withFixture(async (root) => {
    const askScript = path.join(root, 'ask.mjs');
    await writeHookScript(
      askScript,
      "process.stdout.write(JSON.stringify({ hookSpecificOutput: { permissionDecision: 'ask', permissionDecisionReason: 'confirm this action' } }));",
    );

    const session = createSkillHooksSession();
    armHook(session, 'guard', 'PreToolUse', `node "${askScript}"`);

    let handlerCalled = 0;
    const approvalRequests = [];
    const requestCompletion = makeCompletionSequence([
      { text: '', toolCalls: [{ id: 'call-ask', name: 'test_tool', arguments: '{"value":1}' }] },
      { text: 'done', toolCalls: [] },
    ]);

    const result = await runAgentLoop({
      systemPrompt: 'sys',
      userPrompt: 'do it',
      requestCompletion,
      toolHandlers: {
        test_tool: async () => {
          handlerCalled += 1;
          return { ok: true };
        },
      },
      toolDefinitions: [],
      approvalMode: 'full_access',
      requestToolApproval: async (request) => {
        approvalRequests.push(request);
        return { approved: true };
      },
      skipAnalysisNudge: true,
      skillHooksSession: session,
      workspaceRoot: root,
    });

    assert.equal(result.text, 'done');
    assert.equal(handlerCalled, 1);
    assert.equal(approvalRequests.length, 1);
    assert.equal(approvalRequests[0].id, 'call-ask');
    assert.deepEqual(approvalRequests[0].arguments, { value: 1 });
  });
});

test('PostToolUse fires after a successful tool execution and does not block on deny', async () => {
  await withFixture(async (root) => {
    const allowScript = path.join(root, 'allow.mjs');
    await writeHookScript(allowScript, "process.stdout.write(JSON.stringify({ decision: 'allow' }));");
    const postScript = path.join(root, 'post.mjs');
    await writeHookScript(postScript, "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'post hooks cannot block' }));");

    const session = createSkillHooksSession();
    armHook(session, 'guard', 'PreToolUse', `node "${allowScript}"`);
    armHook(session, 'logger', 'PostToolUse', `node "${postScript}"`);

    let handlerCalled = 0;
    const toolHandlers = {
      test_tool: async () => {
        handlerCalled += 1;
        return { ok: true, output: 'done' };
      }
    };

    const events = [];
    const requestCompletion = makeCompletionSequence([
      { text: '', toolCalls: [{ id: 'call-1', name: 'test_tool', arguments: '{}' }] },
      { text: 'final answer', toolCalls: [] }
    ]);

    const result = await runAgentLoop({
      systemPrompt: 'sys',
      userPrompt: 'do it',
      requestCompletion,
      toolHandlers,
      toolDefinitions: [],
      approvalMode: 'full_access',
      skipAnalysisNudge: true,
      skillHooksSession: session,
      workspaceRoot: root,
      onEvent: (event) => events.push(event)
    });

    assert.equal(handlerCalled, 1, 'the tool handler should still run once');
    assert.equal(result.text, 'final answer', 'a deny decision from PostToolUse must not block the final answer');

    const toolMessages = requestCompletion.calls
      .flatMap((call) => call.messages || [])
      .filter((message) => message.role === 'tool');
    const hookedToolContent = String(toolMessages[0]?.content || '');
    assert.match(hookedToolContent, /\[Hook\] PreToolUse · test_tool ← guard/);
    assert.match(hookedToolContent, /\[Hook\] PostToolUse · test_tool ← logger/);

    const preStartIndex = events.findIndex((e) => e.type === 'hook:start' && e.event === 'PreToolUse');
    const toolStartIndex = events.findIndex((e) => e.type === 'tool:start');
    const toolEndIndex = events.findIndex((e) => e.type === 'tool:end');
    const postStartIndex = events.findIndex((e) => e.type === 'hook:start' && e.event === 'PostToolUse');
    assert.ok(preStartIndex >= 0 && toolStartIndex > preStartIndex, 'PreToolUse should fire before tool:start');
    assert.ok(toolEndIndex >= 0 && postStartIndex > toolEndIndex, 'PostToolUse should fire after tool:end');

    const postHookEnds = events.filter((e) => e.type === 'hook:end' && e.event === 'PostToolUse');
    assert.equal(postHookEnds.length, 1);
    assert.equal(postHookEnds[0].decision, 'deny');
  });
});

test('PreToolUse matcher scoping only fires for matching tool names', async () => {
  await withFixture(async (root) => {
    const denyScript = path.join(root, 'deny.mjs');
    await writeHookScript(denyScript, "process.stdout.write(JSON.stringify({ decision: 'deny', reason: 'should not run' }));");

    const session = createSkillHooksSession();
    armHook(session, 'guard', 'PreToolUse', `node "${denyScript}"`, { matcher: '^other_tool$' });

    let handlerCalled = 0;
    const toolHandlers = {
      test_tool: async () => {
        handlerCalled += 1;
        return { ok: true };
      }
    };

    const requestCompletion = makeCompletionSequence([
      { text: '', toolCalls: [{ id: 'call-1', name: 'test_tool', arguments: '{}' }] },
      { text: 'final answer', toolCalls: [] }
    ]);

    const result = await runAgentLoop({
      systemPrompt: 'sys',
      userPrompt: 'do it',
      requestCompletion,
      toolHandlers,
      toolDefinitions: [],
      approvalMode: 'full_access',
      skipAnalysisNudge: true,
      skillHooksSession: session,
      workspaceRoot: root
    });

    assert.equal(handlerCalled, 1, 'handler should run because the matcher does not target test_tool');
    assert.equal(result.text, 'final answer');
  });
});

test('runAgentLoop without a skillHooksSession does not attempt to fire hooks', async () => {
  let handlerCalled = 0;
  const toolHandlers = {
    test_tool: async () => {
      handlerCalled += 1;
      return { ok: true };
    }
  };

  const requestCompletion = makeCompletionSequence([
    { text: '', toolCalls: [{ id: 'call-1', name: 'test_tool', arguments: '{}' }] },
    { text: 'final answer', toolCalls: [] }
  ]);

  const result = await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'do it',
    requestCompletion,
    toolHandlers,
    toolDefinitions: [],
    approvalMode: 'full_access',
    skipAnalysisNudge: true
  });

  assert.equal(handlerCalled, 1);
  assert.equal(result.text, 'final answer');
});

test('Stop block feeds its reason back to the model and allows a later stop', async () => {
  await withFixture(async (root) => {
    const stopScript = path.join(root, 'stop-once.mjs');
    const marker = path.join(root, 'marker.txt').replace(/\\/g, '/');
    await writeHookScript(
      stopScript,
      `import fs from 'node:fs';
const marker = ${JSON.stringify(marker)};
if (!fs.existsSync(marker)) {
  fs.writeFileSync(marker, 'blocked');
  process.stdout.write(JSON.stringify({ decision: 'block', reason: 'run verification first' }));
}`,
    );
    const session = createSkillHooksSession();
    armHook(session, 'goal', 'Stop', `node "${stopScript}"`);
    const seenMessages = [];
    const requestCompletion = async ({ messages }) => {
      seenMessages.push(structuredClone(messages));
      return seenMessages.length === 1
        ? { text: 'first answer', toolCalls: [] }
        : { text: 'verified answer', toolCalls: [] };
    };
    const result = await runAgentLoop({
      systemPrompt: 'sys',
      userPrompt: 'finish',
      requestCompletion,
      toolHandlers: {},
      toolDefinitions: [],
      approvalMode: 'full_access',
      skipAnalysisNudge: true,
      skillHooksSession: session,
      workspaceRoot: root,
    });
    assert.equal(result.text, 'verified answer');
    assert.equal(seenMessages.length, 2);
    assert.equal(
      seenMessages[1].some((message) => message.role === 'user' && /run verification first/.test(message.content)),
      true,
    );
  });
});

test('skill hook activation is awaited before the next model completion', async () => {
  let activationComplete = false;
  let completionCount = 0;
  const result = await runAgentLoop({
    systemPrompt: 'sys',
    userPrompt: 'load it',
    requestCompletion: async () => {
      completionCount += 1;
      if (completionCount === 1) {
        return { text: '', toolCalls: [{ id: 'skill-1', name: 'skill', arguments: '{"name":"guard"}' }] };
      }
      assert.equal(activationComplete, true);
      return { text: 'done', toolCalls: [] };
    },
    toolHandlers: { skill: async () => 'loaded' },
    toolDefinitions: [],
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    onSkillLoaded: async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      activationComplete = true;
    },
  });
  assert.equal(result.text, 'done');
});
