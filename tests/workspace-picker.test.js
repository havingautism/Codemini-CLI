import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { projectOptions, parentDirectory, timeZoneOptions } from '../codemini-web/client/src/lib/workspace-picker.js';
import { registerScheduledTaskRoutes } from '../codemini-web/lib/scheduled-task-api.js';
import { saveScheduledTask } from '../src/core/scheduled-task-store.js';
import { closeSqliteDatabasesForTests } from '../src/core/sqlite-database.js';

test('workspace choices retain unknown current project and deduplicate Windows paths only', () => {
  const paths = ['C:/Work/Repo/', 'c:\\work\\repo', '/work/Repo', '/work/repo'];
  const options = projectOptions(paths, 'D:\\new\\project');
  assert.equal(options.length, 4);
  assert.equal(options[0].value, 'D:\\new\\project');
  assert.equal(options[0].label, 'project');
  assert.equal(paths.length, 4);
});

test('parent navigation handles Windows drives, UNC shares and POSIX roots', () => {
  for (const [value, parent] of [
    ['C:\\work\\repo', 'C:/work'], ['C:/work', 'C:/'], ['C:/', ''],
    ['/home/user', '/home'], ['/home', '/'], ['/', ''],
    ['\\\\server\\share\\folder', '//server/share'], ['\\\\server\\share', ''],
  ]) assert.equal(parentDirectory(value), parent, value);
});

test('timezone choices preserve legacy aliases, support city search and provide real IANA values', () => {
  const options = timeZoneOptions('zh-CN', 'US/Eastern', 'Asia/Shanghai');
  assert.equal(options[0].value, 'US/Eastern');
  assert.equal(new Set(options.map(option => option.value)).size, options.length);
  const shanghai = options.find(option => option.value === 'Asia/Shanghai');
  assert.match(shanghai.label, /中国/);
  assert.match(shanghai.description, /Asia\/Shanghai/);
  assert.ok(shanghai.keywords.some(keyword => keyword.includes('北京')));
  assert.ok(options.some(option => option.value === 'UTC'));
  assert.ok(!timeZoneOptions('en', 'Invalid/Zone').some(option => option.value === 'Invalid/Zone'));
});

test('editing a scheduled task can explicitly choose general workspace; omitted project stays unchanged', async t => {
  closeSqliteDatabasesForTests();
  const previous = process.env.CODEMINI_GLOBAL_DIR;
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-picker-'));
  process.env.CODEMINI_GLOBAL_DIR = directory;
  t.after(async () => {
    closeSqliteDatabasesForTests();
    if (previous === undefined) delete process.env.CODEMINI_GLOBAL_DIR;
    else process.env.CODEMINI_GLOBAL_DIR = previous;
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 8 });
  });
  const generalDir = path.join(directory, 'general');
  const projectDir = path.join(directory, 'project');
  await Promise.all([fs.mkdir(generalDir), fs.mkdir(projectDir)]);
  const task = saveScheduledTask({ name: 'Test', prompt: 'Read', mode: 'normal', projectDir, enabled: false, schedule: { type: 'interval', minutes: 30 } });
  const handlers = new Map();
  const routes = Object.fromEntries(['get', 'post', 'put', 'delete'].map(method => [method, (route, handler) => handlers.set(`${method} ${route}`, handler)]));
  registerScheduledTaskRoutes({ routes, nodeRoute: handler => handler, readBody: async req => req.body, jsonResponse: (res, data) => { res.data = data; }, generalDir, startWorker: async () => ({}) });
  const edit = async body => {
    const response = {};
    await handlers.get('put /api/scheduled-tasks/:id')({ body }, response, new URL(`http://localhost/api/scheduled-tasks/${task.id}`));
    assert.ok(response.data.task, JSON.stringify(response.data));
    return response.data.task;
  };
  assert.equal((await edit({ name: 'Renamed' })).projectDir, projectDir);
  assert.equal((await edit({ projectDir: '' })).projectDir, generalDir);
  assert.equal((await edit({ projectDir })).projectDir, projectDir);
});
