import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';

test('Web daily/coding requests preserve uploaded content, category and history', { timeout: 45_000 }, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'codemini-web-mode-'));
  const project = path.join(directory, 'project');
  await fs.mkdir(project);
  await fs.writeFile(path.join(project, 'AGENTS.md'), 'UNIQUE_QA_PROJECT_CONTRACT');
  const requests = [];
  const provider = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"QA completed."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  let child;
  t.after(async () => {
    if (child && child.exitCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    provider.closeAllConnections();
    await new Promise(resolve => provider.close(resolve));
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 50 });
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  await fs.writeFile(path.join(directory, 'config.json'), JSON.stringify({
    gateway: { base_url: `http://127.0.0.1:${provider.address().port}/v1`, api_key: 'local-test', max_retries: 0 },
    sdk: { provider: 'openai-compatible' }, model: { name: 'qa-local', reasoning_enabled: false },
    execution: { mode: 'normal' }, sandbox: { enabled: false },
    memory: { enabled: false, background_review: { enabled: false } },
    ui: { language: 'en', reply_language: 'en' },
  }));
  // Let the OS allocate an available port before starting the real Web server.
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let log = '';
  child = fork(new URL('../codemini-web/server.js', import.meta.url), ['--port', String(port), '--project', project, '--no-open'], {
    env: { ...process.env, CODEMINI_GLOBAL_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.on('data', data => { log += data; });
  child.stderr.on('data', data => { log += data; });
  const ready = await Promise.race([
    once(child, 'message').then(([message]) => message),
    once(child, 'exit').then(([code]) => { throw new Error(`Web server exited ${code}: ${log}`); }),
  ]);
  const origin = `http://127.0.0.1:${port}`;
  const token = (await fs.readFile(ready.tokenPath, 'utf8')).trim();
  const login = await fetch(origin + '/auth', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 204);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const api = async (url, body) => {
    const response = await fetch(origin + url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { cookie, origin, ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const { data: session } = await api('/api/sessions/new', { projectDir: project });
  assert.ok(session.sessionId);
  const sessionId = session.sessionId;
  const sessionQuery = `?sessionId=${encodeURIComponent(sessionId)}`;
  const png = await sharp({ create: { width: 12, height: 8, channels: 3, background: '#369' } }).png().toBuffer();
  const docx = await fs.readFile(new URL('./fixtures/anydoc-text.docx', import.meta.url));
  const upload = async (name, data, mime) => {
    const form = new FormData();
    form.append('files', new Blob([data], { type: mime }), name);
    return api('/api/attachments' + sessionQuery, form);
  };
  const image = await upload('图片.png', png, 'image/png');
  const document = await upload('table.docx', docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(image.status, 200);
  assert.equal(document.status, 200);
  assert.ok(document.data.attachments[0].textChars > 0);
  const attachments = [...image.data.attachments, ...document.data.attachments];
  for (const item of attachments) {
    const response = await fetch(origin + item.url, { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), item.kind === 'image' ? png : docx);
  }
  const submit = async (text, attachmentIds = []) => {
    const accepted = await api('/api/chat/message', { sessionId, text, attachmentIds });
    assert.equal(accepted.status, 202, JSON.stringify(accepted));
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const { data: messages } = await api('/api/session/ui-messages' + sessionQuery);
      const latest = messages.at(-1);
      if (latest?.role === 'error') assert.fail(JSON.stringify(latest));
      if (latest?.role === 'general' && latest.isComplete && messages.some(message => message.role === 'you' && message.text === text)) return messages;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.fail(`Timed out waiting for ${text}`);
  };
  const dailyMessages = await submit('QA_DAILY_IMAGE_DOCUMENT', attachments.map(item => item.id));
  const daily = requests.find(body => JSON.stringify(body.messages).includes('QA_DAILY_IMAGE_DOCUMENT'));
  assert.ok(daily);
  const prompt = daily.messages.find(message => message.role === 'system').content;
  for (const marker of ['[Soul preset: Default · daily]', '[Soul guard]', '[Reply language]', 'Execution Mode:', 'UNIQUE_QA_PROJECT_CONTRACT']) {
    assert.equal(prompt.split(marker).length - 1, 1, marker);
  }
  assert.doesNotMatch(prompt, /Implementation quality:|coding approach/);
  const user = daily.messages.findLast(message => message.role === 'user');
  const userText = user.content.find(block => block.type === 'text').text;
  assert.equal(userText.split('QA_DAILY_IMAGE_DOCUMENT').length - 1, 1);
  assert.equal(userText.split('<uploaded_attachments>').length - 1, 1);
  assert.equal(user.content.filter(block => block.type === 'image_url').length, 1);
  assert.match(JSON.stringify(user.content), /Hello Codemini/);
  assert.equal(dailyMessages.find(message => message.role === 'you').attachments.length, 2);

  const switched = await api('/api/execution-mode', { sessionId, mode: 'coding' });
  assert.equal(switched.status, 200);
  await submit('QA_CODING_FOLLOWUP', [attachments[0].id, attachments[0].id]);
  const coding = requests.find(body => JSON.stringify(body.messages).includes('QA_CODING_FOLLOWUP'));
  assert.match(coding.messages[0].content, /Soul preset: Default · coding/);
  assert.match(coding.messages[0].content, /Implementation quality:/);
  assert.deepEqual(coding.messages.find(message => message.role === 'user').content, user.content);
  assert.equal(coding.messages.findLast(message => message.role === 'user').content.filter(block => block.type === 'image_url').length, 1);
  t.diagnostic(`Assembled system prompt: daily ${prompt.length} characters; coding ${coding.messages[0].content.length} characters (not measured tokens).`);
  for (const category of ['daily', 'coding']) {
    const detail = await api(`/api/souls/Default/content?category=${category}`);
    assert.equal(detail.data.category, category);
  }
  assert.equal((await upload('bad.exe', Buffer.from('bad'), 'application/octet-stream')).status, 400);
  assert.equal((await upload('broken.png', Buffer.from('not an image'), 'image/png')).status, 400);
  assert.equal((await api('/api/attachments' + sessionQuery, new FormData())).status, 400);
  const tooMany = new FormData();
  for (let index = 0; index < 9; index++) tooMany.append('files', new Blob([png], { type: 'image/png' }), `${index}.png`);
  assert.equal((await api('/api/attachments' + sessionQuery, tooMany)).status, 400);
  for (const [file, expected] of [['anydoc-slides.pptx', /Quarterly plan/], ['anydoc-sheet.xlsx', /Revenue/]]) {
    const fileData = await fs.readFile(new URL(`./fixtures/${file}`, import.meta.url));
    const uploaded = await upload(file, fileData, 'application/octet-stream');
    assert.equal(uploaded.status, 200);
    assert.match(uploaded.data.attachments[0].preview, expected);
  }
  assert.equal((await api('/api/execution-mode', { sessionId, mode: 'normal' })).status, 200);
  assert.equal((await api('/api/souls/activate', { name: 'Soft', category: 'daily' })).status, 200);
  await submit('QA_BACK_TO_DAILY');
  const restored = requests.find(body => JSON.stringify(body.messages).includes('QA_BACK_TO_DAILY'));
  assert.match(restored.messages[0].content, /Soul preset: Soft · daily/);
  assert.doesNotMatch(restored.messages[0].content, /Implementation quality:|coding approach/);
  assert.deepEqual(restored.messages.find(message => message.role === 'user').content, user.content);
  const restoredUi = (await api('/api/session/ui-messages' + sessionQuery)).data;
  assert.equal(restoredUi.find(message => message.role === 'you').attachments.length, 2);
  const wrongSession = await api('/api/sessions/new', { projectDir: project });
  const invalid = await api('/api/chat/message', { sessionId: wrongSession.data.sessionId, text: 'QA_WRONG_SESSION', attachmentIds: [attachments[0].id] });
  assert.equal(invalid.status, 400, 'Attachments from another session must not silently disappear');
  const invalidCount = await api('/api/chat/message', { sessionId, text: 'QA_TOO_MANY_IDS', attachmentIds: Array(9).fill(attachments[0].id) });
  assert.equal(invalidCount.status, 400);
});
