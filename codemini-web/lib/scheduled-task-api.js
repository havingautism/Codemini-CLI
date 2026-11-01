import fs from 'node:fs/promises';
import {
  getScheduledTask, listScheduledTasks, listScheduledRuns, saveScheduledTask,
  deleteScheduledTask, queueScheduledTask, scheduledWorkerStatus,
} from '../../src/core/scheduled-task-store.js';
import { startScheduledWorker } from '../../src/core/scheduled-worker-process.js';

export function registerScheduledTaskRoutes({ routes, nodeRoute, readBody, jsonResponse, generalDir, startWorker = startScheduledWorker }) {
  const wrap = action => nodeRoute(async (req, res, url) => {
    try { await action(req, res, url); }
    catch (error) {
      jsonResponse(res, { error: true, message: error?.message || String(error) }, /already queued|active run/.test(error?.message || '') ? 409 : 400);
    }
  });
  const taskId = url => decodeURIComponent(url.pathname.split('/')[3]);
  routes.get('/api/scheduled-tasks', wrap(async (req, res, url) => {
    jsonResponse(res, { tasks: listScheduledTasks(), runs: listScheduledRuns(url.searchParams.get('taskId') || ''), worker: scheduledWorkerStatus() });
  }));
  const save = async (req, res, url, id = '') => {
    const input = await readBody(req);
    const projectDir = Object.hasOwn(input, 'projectDir')
      ? (input.projectDir || generalDir)
      : (id ? getScheduledTask(id)?.projectDir : generalDir);
    if (!(await fs.stat(projectDir)).isDirectory()) throw new Error('Project directory is unavailable.');
    const task = saveScheduledTask({ ...input, projectDir }, id);
    const worker = await startWorker();
    jsonResponse(res, { task, worker }, id ? 200 : 201);
  };
  routes.post('/api/scheduled-tasks', wrap((req, res, url) => save(req, res, url)));
  routes.post('/api/scheduled-tasks/worker/start', wrap(async (req, res) => {
    jsonResponse(res, await startWorker());
  }));
  routes.put('/api/scheduled-tasks/:id', wrap((req, res, url) => save(req, res, url, taskId(url))));
  routes.delete('/api/scheduled-tasks/:id', wrap(async (req, res, url) => {
    deleteScheduledTask(taskId(url));
    jsonResponse(res, { ok: true });
  }));
  routes.post('/api/scheduled-tasks/:id/run', wrap(async (req, res, url) => {
    const run = queueScheduledTask(taskId(url));
    const worker = await startWorker();
    jsonResponse(res, { run, worker }, 202);
  }));
}
