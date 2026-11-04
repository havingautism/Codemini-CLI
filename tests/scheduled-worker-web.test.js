import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';
import { loadSession } from '../src/core/session-store.js';
import { saveScheduledTask, queueScheduledTask, listScheduledRuns, scheduledWorkerStatus, getScheduledTask } from '../src/core/scheduled-task-store.js';
import { startScheduledWorker } from '../src/core/scheduled-worker-process.js';

async function until(check, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  throw new Error(message);
}

test('scheduled work survives Web shutdown, isolates modes and stops for user input', { timeout: 45000 }, async t => {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-scheduled-web-'));
  process.env.CODEMINI_GLOBAL_DIR = directory;
  const project = path.join(directory, 'project');
  await fs.mkdir(project);
  const bodies = [];
  const gateway = http.createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text);
    bodies.push(body);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const needsInput = JSON.stringify(body.messages).includes('SCHEDULE_NEEDS_INPUT');
    const needsApproval = JSON.stringify(body.messages).includes('SCHEDULE_NEEDS_APPROVAL');
    const shell = body.tools?.find(tool => ['powershell', 'bash', 'run'].includes(String(tool.function?.name).toLowerCase()))?.function.name || 'run';
    const marker = path.join(project, 'approval-marker.txt');
    const approvalCommand = shell.toLowerCase() === 'powershell'
      ? `Remove-Item -LiteralPath '${marker.replace(/'/g, "''")}'`
      : `rm -- '${marker.replace(/'/g, "'\\''")}'`;
    const delta = needsInput ? { tool_calls: [{ index: 0, id: 'question-1', function: { name: 'request_user_input', arguments: JSON.stringify({ questions: [{ id: 'choice', question: 'Choose a target.' }] }) } }] }
      : needsApproval ? { tool_calls: [{ index: 0, id: 'approval-1', function: { name: shell, arguments: JSON.stringify({ command: approvalCommand }) } }] }
      : { content: 'Scheduled task completed.' };
    res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: needsInput || needsApproval ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
  });
  let web;
  const workerPids = new Set();
  t.after(async () => {
    if (web && web.exitCode === null && web.signalCode === null) { const exited = once(web, 'exit'); web.kill(); await exited; }
    const status = scheduledWorkerStatus();
    if (status.running && status.pid) { try { process.kill(status.pid); } catch {} }
    gateway.closeAllConnections();
    await new Promise(resolve => gateway.close(resolve));
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR; else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 });
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  const config = {
    gateway: { base_url: `http://127.0.0.1:${gateway.address().port}/v1`, api_key: 'local-test', max_retries: 0 },
    sdk: { provider: 'openai-compatible' }, model: { name: 'schedule-test', reasoning_enabled: false },
    execution: { mode: 'normal', approval_mode: 'review', max_steps: 5 }, sandbox: { enabled: false },
    memory: { enabled: false, background_review: { enabled: false } }, ui: { language: 'en', reply_language: 'en' },
  };
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify(config));
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  web = fork(new URL('../codemini-web/server.js', import.meta.url), ['--port', String(port), '--no-open'], {
    env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  web.stdout.on('data', data => { output += data; });
  web.stderr.on('data', data => { output += data; });
  const ready = await Promise.race([once(web, 'message').then(([message]) => message), once(web, 'exit').then(([code]) => { throw new Error(`Web exit ${code}: ${output}`); })]);
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(origin + '/api/scheduled-tasks')).status, 401);
  const token = (await fs.readFile(ready.tokenPath, 'utf8')).trim();
  const auth = await fetch(origin + '/auth', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const cookie = auth.headers.get('set-cookie').split(';')[0];
  const stream = await fetch(origin + '/api/events', { headers: { cookie } });
  const eventReader = stream.body.getReader();
  t.after(() => eventReader.cancel().catch(() => {}));
  const decoder = new TextDecoder();
  let eventText = '';
  const readEvent = async type => {
    const deadline = AbortSignal.timeout(8000);
    while (true) {
      const boundary = eventText.indexOf('\n\n');
      if (boundary >= 0) {
        const frame = eventText.slice(0, boundary);
        eventText = eventText.slice(boundary + 2);
        const data = frame.split('\n').find(line => line.startsWith('data: '));
        if (data) { const event = JSON.parse(data.slice(6)); if (event.type === type) return event; }
        continue;
      }
      const chunk = await Promise.race([eventReader.read(), new Promise((_, reject) => {
        deadline.addEventListener('abort', () => reject(new Error('Scheduled SSE event timed out')), { once: true });
      })]);
      if (chunk.done) throw new Error('Scheduled SSE stream closed');
      eventText += decoder.decode(chunk.value, { stream: true });
    }
  };
  const connectedEvent = await readEvent('connected');
  assert.equal(typeof connectedEvent.scheduled.sessionRevision, 'number');
  const api = async (url, method = 'GET', body) => {
    const response = await fetch(origin + url, { method, headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  };
  const invalid = await api('/api/scheduled-tasks', 'POST', { name: 'bad', prompt: 'bad', mode: 'crew', projectDir: project, schedule: { type: 'interval', minutes: 1 } });
  assert.equal(invalid.status, 400);
  const created = await api('/api/scheduled-tasks', 'POST', { name: 'Background daily task', prompt: 'SCHEDULE_DAILY_FIXTURE', mode: 'normal', projectDir: project, schedule: { type: 'once', at: new Date(Date.now() + 4000).toISOString() } });
  assert.equal(created.status, 201, JSON.stringify(created));
  const changedEvent = await readEvent('scheduled:changed');
  assert.ok(changedEvent.revision > connectedEvent.scheduled.revision);
  assert.equal(Object.hasOwn(changedEvent, 'tasks'), false);
  await eventReader.cancel();
  if (created.data.worker.pid) workerPids.add(created.data.worker.pid);
  await until(() => scheduledWorkerStatus().running, 'Worker did not start');
  assert.equal((await api(`/api/scheduled-tasks/${created.data.task.id}`, 'PUT', { enabled: false })).data.task.enabled, false);
  assert.equal((await api(`/api/scheduled-tasks/${created.data.task.id}`, 'PUT', { enabled: true })).data.task.enabled, true);
  assert.equal((await api('/api/scheduled-tasks')).data.tasks.length, 1);
  const webExited = once(web, 'exit');
  web.kill();
  await webExited;
  const completed = await until(() => listScheduledRuns().find(run => run.taskId === created.data.task.id && ['completed', 'failed', 'needs_attention'].includes(run.status)), 'Task did not finish after Web shutdown');
  assert.equal(completed.status, 'completed', completed.error);
  assert.equal(getScheduledTask(created.data.task.id).enabled, false);
  const session = await loadSession(completed.sessionId);
  assert.ok(session.messages.some(message => message.role === 'user' && message.content === 'SCHEDULE_DAILY_FIXTURE'));
  const daily = bodies.find(body => JSON.stringify(body.messages).includes('SCHEDULE_DAILY_FIXTURE'));
  assert.match(daily.messages[0].content, /Execution Mode: normal/);
  assert.doesNotMatch(daily.messages[0].content, /Implementation quality:/);

  const coding = saveScheduledTask({ name: 'Coding task', prompt: 'SCHEDULE_CODING_FIXTURE', projectDir: project, mode: 'plan', enabled: false, schedule: { type: 'interval', minutes: 1 } });
  queueScheduledTask(coding.id);
  const launches = await Promise.all([startScheduledWorker(), startScheduledWorker()]);
  launches.forEach(status => { if (status.pid) workerPids.add(status.pid); });
  const coded = await until(() => listScheduledRuns(coding.id).find(run => ['completed', 'failed'].includes(run.status)), 'Coding task did not finish');
  assert.equal(coded.status, 'completed', coded.error);
  assert.equal(listScheduledRuns(coding.id).length, 1);
  const codingBody = bodies.find(body => JSON.stringify(body.messages).includes('SCHEDULE_CODING_FIXTURE'));
  assert.match(codingBody.messages[0].content, /Implementation quality:/);
  assert.equal(JSON.parse(await fs.readFile(path.join(directory, 'config.json'))).execution.mode, 'normal');

  const interactive = saveScheduledTask({ ...coding, name: 'Needs input', prompt: 'SCHEDULE_NEEDS_INPUT' });
  queueScheduledTask(interactive.id);
  const started = await startScheduledWorker();
  if (started.pid) workerPids.add(started.pid);
  const attention = await until(() => listScheduledRuns(interactive.id).find(run => !['queued', 'running'].includes(run.status)), 'Task hung on a user-input request');
  assert.equal(attention.status, 'needs_attention', attention.error);
  assert.match(attention.error, /needs your input/);
  assert.ok(attention.sessionId);
  await fs.writeFile(path.join(project, 'approval-marker.txt'), 'must be preserved');
  const approvalTask = saveScheduledTask({ ...coding, name: 'Needs approval', prompt: 'SCHEDULE_NEEDS_APPROVAL' });
  queueScheduledTask(approvalTask.id);
  const approvalWorker = await startScheduledWorker();
  if (approvalWorker.pid) workerPids.add(approvalWorker.pid);
  const approvalRun = await until(() => listScheduledRuns(approvalTask.id).find(run => !['queued', 'running'].includes(run.status)), 'Task hung on approval');
  assert.equal(approvalRun.status, 'needs_attention', approvalRun.error);
  assert.match(approvalRun.error, /tool approval/);
  assert.equal(await fs.readFile(path.join(project, 'approval-marker.txt'), 'utf8'), 'must be preserved');
  await until(() => !scheduledWorkerStatus().running, 'Idle worker did not exit');
});
