import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { RuntimeBridge, serializeSessionMessages } from '../codemini-web/lib/runtime-bridge.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { loadUiTranscriptFromSqlite } from '../src/core/session-sqlite-store.js';
import { repairSettledTranscriptMessages } from '../codemini-web/shared/transcript-segments.js';
import { userSkillChipBadges } from '../codemini-web/client/src/lib/user-skill-prompt.js';

test('history hides retrieved memories from user bubbles without mutating model history', () => {
  const content = '<retrieved_memory>private recalled context</retrieved_memory>\n\nFind new photos';
  const source = [{ role: 'user', content, model_content: content }];
  const [message] = serializeSessionMessages(source);
  assert.equal(message.content, 'Find new photos');
  assert.equal(message.model_content, content);
  assert.equal(source[0].content, content);
  assert.equal(serializeSessionMessages([{ role: 'assistant', content }])[0].content, content);
});

for (const startedReply of [false, true]) {
  test(`manual abort preserves selected skills and skill reads after reload (reply started: ${startedReply})`, async () => {
    closeSqliteDatabasesForTests();
    const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
    const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-abort-skills-'));
    process.env.CODEMINI_GLOBAL_DIR = globalDir;
    let sessionId = 'skills-before-abort';
    let emit;
    const ready = Promise.withResolvers();
    const runtime = {
      getCurrentSessionId: () => sessionId,
      getRuntimeState: () => ({ sessionId }),
      getLastSystemPrompt: () => '',
      setRequestToolApproval() {},
      setRequestUserInput() {},
      setOnTitleUpdate() {},
      setOnTitleStatus() {},
      submitMessage(_message, onEvent) {
        emit = onEvent;
        onEvent({ type: 'skill:start', name: 'diagnosing-bugs' });
        onEvent({ type: 'skill:end', name: 'diagnosing-bugs' });
        if (startedReply) {
          onEvent({ type: 'step:start', step: 1 });
          onEvent({ type: 'assistant:start' });
          onEvent({ type: 'assistant:reasoning_delta', text: 'checking' });
        }
        ready.resolve();
        return new Promise(() => {});
      },
      abort() { return true; },
    };
    const bridge = new RuntimeBridge(runtime, { sessionId });
    let restoredBridge;
    try {
      bridge.handleSubmitMessage({ text: 'debug', skillNames: ['diagnosing-bugs'] });
      await ready.promise;
      await bridge.handleAbort();
      // The runtime finishes creating its continuation after handleAbort returns.
      sessionId = 'skills-after-abort';
      emit({ type: 'session:forked', previousSessionId: 'skills-before-abort', sessionId });
      await bridge.dispose();
      restoredBridge = new RuntimeBridge(runtime, { sessionId });
      for (const id of ['skills-before-abort', 'skills-after-abort']) {
        const restored = repairSettledTranscriptMessages(loadUiTranscriptFromSqlite(id));
        assert.deepEqual(userSkillChipBadges(restored[0].skillBadges), [
          { name: 'diagnosing-bugs', status: 'selected' },
        ]);
        const reads = restored.flatMap((message) => message.segments || [])
          .filter((segment) => segment.type === 'skill');
        assert.equal(reads.length, 1);
        assert.equal(reads[0].name, 'diagnosing-bugs');
        assert.equal(reads[0].status, 'done');
      }
      const reloaded = repairSettledTranscriptMessages(await restoredBridge.getUiMessages());
      assert.deepEqual(userSkillChipBadges(reloaded[0].skillBadges), [
        { name: 'diagnosing-bugs', status: 'selected' },
      ]);
      assert.equal(reloaded[1].segments.filter((segment) => segment.type === 'skill').length, 1);
    } finally {
      await restoredBridge?.dispose();
      await bridge.dispose();
      closeSqliteDatabasesForTests();
      if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
      else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
      await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
    }
  });
}

test('runtime-only model context is replayed to the model but hidden from fallback UI history', () => {
  assert.deepEqual(serializeSessionMessages([
    { role: 'user', content: 'visible' },
    { role: 'user', content: 'internal', model_context: true },
    { role: 'assistant', content: 'done' },
  ]).map((message) => message.content), ['visible', 'done']);
});

test('network failure removes its empty placeholder from live and persisted UI history', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-network-error-ui-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  const sessionId = 'network-error-session';
  const done = Promise.withResolvers();
  const runtime = {
    getCurrentSessionId: () => sessionId,
    getRuntimeState: () => ({ sessionId }),
    getLastSystemPrompt: () => '',
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    async submit(_line, onEvent) {
      onEvent({ type: 'assistant:start', messageId: 'empty-reply' });
      onEvent({ type: 'step:start', step: 1 });
      throw new Error('fetch failed');
    },
  };
  const bridge = new RuntimeBridge(runtime, {
    sessionId,
    onEvent(event) { if (event.type === 'submit:done') done.resolve(); },
  });
  try {
    bridge.handleSubmit('question');
    await done.promise;
    const live = await bridge.getUiMessages();
    assert.deepEqual(live.map((message) => message.role), ['you', 'error']);
    assert.equal(live[1].text, 'Failed: fetch failed');
    await bridge.dispose();
    assert.deepEqual(loadUiTranscriptFromSqlite(sessionId).map((message) => message.role), ['you', 'error']);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});

test('abort continuation keeps the settled partial reply in its UI transcript', async () => {
  closeSqliteDatabasesForTests();
  const previousGlobalDir = process.env.CODEMINI_GLOBAL_DIR;
  const globalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-abort-ui-'));
  process.env.CODEMINI_GLOBAL_DIR = globalDir;
  let sessionId = 'session-before-abort';

  const runtime = {
    getCurrentSessionId: () => sessionId,
    getRuntimeState: () => ({ sessionId }),
    getLastSystemPrompt: () => '',
    setRequestToolApproval() {},
    setRequestUserInput() {},
    setOnTitleUpdate() {},
    setOnTitleStatus() {},
    submit(_line, onEvent) {
      onEvent({ type: 'assistant:start', messageId: 'reply-1' });
      onEvent({ type: 'assistant:delta', messageId: 'reply-1', text: 'already visible' });
      sessionId = 'session-after-abort';
      onEvent({
        type: 'session:forked',
        previousSessionId: 'session-before-abort',
        sessionId,
      });
      return new Promise(() => {});
    },
  };

  const bridge = new RuntimeBridge(runtime, { sessionId });
  try {
    assert.deepEqual(bridge.handleSubmit('question'), { accepted: true });

    const copied = loadUiTranscriptFromSqlite('session-after-abort');
    assert.equal(copied.length, 2);
    assert.equal(copied[0].role, 'you');
    assert.equal(copied[1].manualAborted, true);
    assert.equal(copied[1].segments[0].text, 'already visible');
    assert.equal(copied[1].segments[0].isStreaming, false);
  } finally {
    await bridge.dispose();
    closeSqliteDatabasesForTests();
    if (previousGlobalDir === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previousGlobalDir;
    await fs.rm(globalDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  }
});
