import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createScheduledTaskNotifier } from '../codemini-web/lib/scheduled-task-notifier.js';
import { createEventBroker } from '../codemini-web/server.js';
import { projectSessionRuntime, buildVisibleProjectGroups } from '../codemini-web/client/src/lib/session-ui-state.js';

test('notifier skips reads with no browsers, coalesces bursts and emits nothing for unchanged state', t => {
  let listening = false;
  let reads = 0;
  let state = { revision: 0, sessionRevision: 0, workerRunning: false };
  const events = [];
  const notifier = createScheduledTaskNotifier({ publish: event => events.push(event), hasClients: () => listening,
    readState: () => { reads++; return state; }, intervalMs: 60000 });
  t.after(notifier.stop);
  for (let i = 0; i < 1000; i++) notifier.tick();
  assert.equal(reads, 0);
  listening = true;
  notifier.tick();
  for (let i = 0; i < 100; i++) notifier.tick();
  assert.equal(events.length, 1);
  // Several database transactions between ticks still produce only one event.
  state = { revision: 12, sessionRevision: 4, workerRunning: true };
  notifier.tick();
  assert.equal(events.length, 2);
  assert.equal(events[1].sessionRevision, 4);
  listening = false;
  state = { ...state, revision: 13 };
  notifier.tick();
  listening = true;
  notifier.tick();
  assert.equal(events.length, 3);
  assert.deepEqual(Object.keys(events[2]), ['type', 'revision', 'sessionRevision', 'workerRunning']);
});

test('each SSE connection receives the latest scheduler revision, including reconnects', () => {
  let revision = 1;
  const broker = createEventBroker({ getConnectionData: () => ({ scheduled: { revision } }) });
  const connect = () => {
    const res = new EventEmitter();
    const writes = [];
    res.writeHead = () => {};
    res.write = value => writes.push(value);
    broker.addClient(res);
    return { res, writes };
  };
  const first = connect();
  assert.equal(broker.clientCount, 1);
  assert.match(first.writes[0], /"revision":1/);
  first.res.emit('close');
  assert.equal(broker.clientCount, 0);
  revision = 8;
  const second = connect();
  try { assert.match(second.writes[0], /"revision":8/); }
  finally { second.res.emit('close'); }
});

test('scheduled sessions show background status and attention without overriding interactive sessions', () => {
  const sessions = [{ id: 'background', scheduledStatus: 'running', messageCount: 0, projectDir: 'E:/repo' },
    { id: 'attention', scheduledStatus: 'needs_attention' }, { id: 'chat', scheduledStatus: 'continued' }];
  const projected = projectSessionRuntime(sessions, { background: { status: 'idle' }, chat: { status: 'waiting_input' } });
  assert.equal(projected[0].runtimeStatus, 'running');
  assert.equal(projected[1].needsAttention, true);
  assert.equal(projected[2].runtimeStatus, 'waiting_input');
  assert.equal(buildVisibleProjectGroups({ sessions, activeProjectDirs: ['E:/repo'] })[0][1][0].id, 'background');
});
