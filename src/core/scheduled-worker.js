import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config-store.js';
import { createSession, saveSession } from './session-store.js';
import { createChatRuntime } from './chat-runtime.js';
import { buildDefaultSystemPrompt } from './default-system-prompt.js';
import { getBaseConfigDir } from './paths.js';
import { closeSqliteDatabasesForTests } from './sqlite-database.js';
import {
  acquireScheduledWorker, bindScheduledSession, claimScheduledRun, finishScheduledRun,
  recoverScheduledRuns, releaseScheduledWorker, releaseScheduledWorkerIfIdle,
} from './scheduled-task-store.js';

export async function executeScheduledRun(run, { onRuntime = () => {}, isInterrupted = () => false } = {}) {
  let runtime;
  let attention = '';
  try {
    const root = run.task.projectDir;
    if (!(await fs.stat(root)).isDirectory()) throw new Error('Project directory is unavailable.');
    const loaded = await loadConfig();
    // This copy is local to the task. Never call setExecutionMode, which saves
    // a global preference and would change the user's interactive sessions.
    const config = { ...loaded, execution: { ...loaded.execution, mode: run.task.mode, approval_mode: run.task.approvalMode || loaded.execution?.approval_mode || 'auto' } };
    const session = await createSession(root);
    session.title = run.task.name;
    session.mode = run.task.mode;
    await saveSession(session);
    bindScheduledSession(run.id, session.id);
    runtime = await createChatRuntime({
      session, config, model: config.model?.name, workspaceRoot: root,
      systemPrompt: buildDefaultSystemPrompt(config, { workspaceRoot: root }),
      requestToolApproval: async () => {
        attention = 'This task needs tool approval. Open the session and continue interactively.';
        runtime?.abort({ continueInPlace: true });
        return false;
      },
    });
    onRuntime(runtime);
    runtime.setRequestUserInput(async () => {
      attention = 'This task needs your input. Open the session and continue interactively.';
      runtime.abort({ continueInPlace: true });
      return { status: 'cancelled', answers: {} };
    });
    const result = await runtime.submitMessage({ text: run.task.prompt }, event => {
      if (event?.type === 'checkpoint') attention = 'This task reached a checkpoint. Open the session and continue interactively.';
    });
    const state = runtime.getRuntimeState();
    if (!attention && (state.pendingSpecApproval || state.pendingReflectSkill)) attention = 'This task needs approval of its draft. Open the session and review it.';
    finishScheduledRun(run.id, isInterrupted() ? 'interrupted' : attention ? 'needs_attention' : result?.aborted ? 'interrupted' : result?.type === 'error' ? 'failed' : 'completed', attention || (result?.type === 'error' ? result.text : result?.aborted ? 'Execution stopped before completion.' : ''));
  } catch (error) {
    finishScheduledRun(run.id, isInterrupted() ? 'interrupted' : attention ? 'needs_attention' : 'failed', attention || error?.message || String(error));
  } finally {
    onRuntime(null);
    await runtime?.dispose().catch(error => console.error('Scheduled runtime cleanup:', error?.message || String(error)));
  }
}

export async function runScheduledWorker({ pollMs = 2000, heartbeatMs = 10000 } = {}) {
  const owner = randomUUID();
  if (!acquireScheduledWorker(owner, process.pid)) return;
  let stopped = false;
  let runtime = null;
  const stop = () => { stopped = true; runtime?.abort({ continueInPlace: true }); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  const heartbeat = setInterval(() => {
    try { if (!acquireScheduledWorker(owner, process.pid)) stop(); } catch { stop(); }
  }, heartbeatMs);
  try {
    recoverScheduledRuns(owner);
    while (!stopped) {
      const run = claimScheduledRun(owner);
      if (run) {
        await executeScheduledRun(run, { onRuntime: next => { runtime = next; }, isInterrupted: () => stopped });
      } else {
        if (releaseScheduledWorkerIfIdle(owner)) break;
        await new Promise(resolve => setTimeout(resolve, pollMs));
      }
    }
  } finally {
    clearInterval(heartbeat);
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    releaseScheduledWorker(owner);
  }
}

const direct = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (direct) {
  // Make the general workspace available even when the Web server is absent.
  await fs.mkdir(path.join(getBaseConfigDir(), 'workspace'), { recursive: true });
  try { await runScheduledWorker(); }
  catch (error) { console.error(new Date().toISOString(), error?.message || String(error)); process.exitCode = 1; }
  finally { closeSqliteDatabasesForTests(); }
}
