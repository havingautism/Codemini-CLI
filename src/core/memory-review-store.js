import fs from 'node:fs/promises';
import path from 'node:path';
import { getMemoryDir } from './paths.js';

const REVIEW_STATE_VERSION = 1;
let stateMutation = Promise.resolve();

function statePath() {
  return path.join(getMemoryDir(), 'session-review-state.json');
}

async function readState() {
  try {
    const parsed = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    return {
      version: REVIEW_STATE_VERSION,
      sessions: parsed?.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {}
    };
  } catch {
    return { version: REVIEW_STATE_VERSION, sessions: {} };
  }
}

async function writeState(state) {
  const entries = Object.entries(state.sessions || {})
    .sort(([, left], [, right]) => {
      const leftTime = Date.parse(left?.reviewedAt || left?.failedAt || left?.claimedAt || '') || 0;
      const rightTime = Date.parse(right?.reviewedAt || right?.failedAt || right?.claimedAt || '') || 0;
      return rightTime - leftTime;
    })
    .slice(0, 5000);
  state.sessions = Object.fromEntries(entries);
  const target = statePath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(temp, target);
}

function mutateState(updater) {
  const run = stateMutation.then(async () => {
    const state = await readState();
    const result = await updater(state);
    if (result?.changed !== false) await writeState(state);
    return result?.value;
  });
  stateMutation = run.catch(() => {});
  return run;
}

export async function claimSessionMemoryReview({
  sessionId,
  contentHash,
  reviewerVersion,
  leaseMs = 120000
}) {
  return mutateState(async (state) => {
    const now = Date.now();
    const existing = state.sessions[sessionId] || null;
    if (
      existing?.status === 'completed' &&
      existing.contentHash === contentHash &&
      Number(existing.reviewerVersion || 0) === reviewerVersion
    ) {
      return { changed: false, value: { claimed: false, reason: 'already-reviewed', record: existing } };
    }
    if (existing?.status === 'processing' && Date.parse(existing.leaseUntil || '') > now) {
      return { changed: false, value: { claimed: false, reason: 'active-lease', record: existing } };
    }
    if (existing?.nextRetryAt && Date.parse(existing.nextRetryAt) > now) {
      return { changed: false, value: { claimed: false, reason: 'retry-backoff', record: existing } };
    }
    const attempts = existing?.contentHash === contentHash ? Number(existing.attempts || 0) + 1 : 1;
    const record = {
      contentHash,
      reviewerVersion,
      status: 'processing',
      attempts,
      claimedAt: new Date(now).toISOString(),
      leaseUntil: new Date(now + leaseMs).toISOString()
    };
    state.sessions[sessionId] = record;
    return { value: { claimed: true, record } };
  });
}

export async function completeSessionMemoryReview({
  sessionId,
  contentHash,
  reviewerVersion,
  reviewedMessageCount,
  candidateCount
}) {
  return mutateState(async (state) => {
    state.sessions[sessionId] = {
      contentHash,
      reviewerVersion,
      status: 'completed',
      attempts: 0,
      reviewedMessageCount,
      candidateCount,
      reviewedAt: new Date().toISOString()
    };
    return { value: state.sessions[sessionId] };
  });
}

export async function failSessionMemoryReview({ sessionId, contentHash, reviewerVersion, error }) {
  return mutateState(async (state) => {
    const previous = state.sessions[sessionId] || {};
    const attempts = Math.max(1, Number(previous.attempts || 1));
    const delayMs = Math.min(6 * 60 * 60 * 1000, 30000 * (2 ** Math.min(8, attempts - 1)));
    state.sessions[sessionId] = {
      contentHash,
      reviewerVersion,
      status: 'failed',
      attempts,
      failedAt: new Date().toISOString(),
      nextRetryAt: new Date(Date.now() + delayMs).toISOString(),
      lastError: String(error?.message || error || 'session memory review failed').slice(0, 240)
    };
    return { value: state.sessions[sessionId] };
  });
}
