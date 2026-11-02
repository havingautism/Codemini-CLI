import { startScheduledWorker } from '../core/scheduled-worker-process.js';
import { listScheduledTasks, scheduledWorkerStatus } from '../core/scheduled-task-store.js';

export async function handleSchedule(args = []) {
  if (args[0] === 'start') {
    console.log(JSON.stringify(await startScheduledWorker(), null, 2));
  } else if (!args.length || args[0] === 'status') {
    console.log(JSON.stringify({ worker: scheduledWorkerStatus(), tasks: listScheduledTasks() }, null, 2));
  } else {
    throw new Error('Usage: codemini schedule start|status. Manage tasks in the Web UI.');
  }
}
