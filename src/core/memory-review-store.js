import fs from 'node:fs/promises';
import path from 'node:path';
import { getMemoryDir } from './paths.js';
import { getGlobalDatabase, transaction } from './sqlite-database.js';

const IMPORT_KEY = 'memory_review_json_imported';

function toRecord(row) {
  if (!row) return null;
  return {
    contentHash: row.content_hash,
    reviewerVersion: row.reviewer_version,
    status: row.status,
    attempts: row.attempts,
    ...(row.claimed_at ? { claimedAt: row.claimed_at } : {}),
    ...(row.lease_until ? { leaseUntil: row.lease_until } : {}),
    ...(row.reviewed_at ? { reviewedAt: row.reviewed_at } : {}),
    ...(row.failed_at ? { failedAt: row.failed_at } : {}),
    ...(row.next_retry_at ? { nextRetryAt: row.next_retry_at } : {}),
    ...(row.reviewed_message_count != null ? { reviewedMessageCount: row.reviewed_message_count } : {}),
    ...(row.candidate_count != null ? { candidateCount: row.candidate_count } : {}),
    ...(row.last_error ? { lastError: row.last_error } : {})
  };
}

async function ensureLegacyImported() {
  const db = getGlobalDatabase();
  if (db.prepare('SELECT 1 FROM schema_meta WHERE key = ?').get(IMPORT_KEY)) return;
  let sessions = {};
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(getMemoryDir(), 'session-review-state.json'), 'utf8'));
    sessions = parsed?.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {};
  } catch {}
  transaction(db, () => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO memory_review_jobs(
        session_id, content_hash, reviewer_version, status, attempts, claimed_at, lease_until,
        reviewed_at, failed_at, next_retry_at, reviewed_message_count, candidate_count, last_error
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const [sessionId, record] of Object.entries(sessions)) {
      insert.run(
        sessionId, String(record?.contentHash || ''), Number(record?.reviewerVersion || 0),
        String(record?.status || 'failed'), Number(record?.attempts || 0), record?.claimedAt || null,
        record?.leaseUntil || null, record?.reviewedAt || null, record?.failedAt || null,
        record?.nextRetryAt || null, record?.reviewedMessageCount ?? null,
        record?.candidateCount ?? null, record?.lastError || null
      );
    }
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(IMPORT_KEY, new Date().toISOString());
  });
}

function getJob(sessionId) {
  return getGlobalDatabase().prepare('SELECT * FROM memory_review_jobs WHERE session_id = ?').get(sessionId);
}

export async function claimSessionMemoryReview({
  sessionId,
  contentHash,
  reviewerVersion,
  leaseMs = 120000
}) {
  await ensureLegacyImported();
  const db = getGlobalDatabase();
  return transaction(db, () => {
    const now = Date.now();
    const existing = getJob(sessionId);
    if (
      existing?.status === 'completed' &&
      existing.content_hash === contentHash &&
      Number(existing.reviewer_version || 0) === reviewerVersion
    ) {
      return { claimed: false, reason: 'already-reviewed', record: toRecord(existing) };
    }
    if (existing?.status === 'processing' && Date.parse(existing.lease_until || '') > now) {
      return { claimed: false, reason: 'active-lease', record: toRecord(existing) };
    }
    if (existing?.next_retry_at && Date.parse(existing.next_retry_at) > now) {
      return { claimed: false, reason: 'retry-backoff', record: toRecord(existing) };
    }
    const attempts = existing?.content_hash === contentHash ? Number(existing.attempts || 0) + 1 : 1;
    const claimedAt = new Date(now).toISOString();
    const leaseUntil = new Date(now + leaseMs).toISOString();
    db.prepare(`
      INSERT INTO memory_review_jobs(
        session_id, content_hash, reviewer_version, status, attempts, claimed_at, lease_until
      ) VALUES (?, ?, ?, 'processing', ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        content_hash = excluded.content_hash,
        reviewer_version = excluded.reviewer_version,
        status = 'processing', attempts = excluded.attempts,
        claimed_at = excluded.claimed_at, lease_until = excluded.lease_until,
        reviewed_at = NULL, failed_at = NULL, next_retry_at = NULL, last_error = NULL
    `).run(sessionId, contentHash, reviewerVersion, attempts, claimedAt, leaseUntil);
    return { claimed: true, record: toRecord(getJob(sessionId)) };
  });
}

export async function completeSessionMemoryReview({
  sessionId,
  contentHash,
  reviewerVersion,
  reviewedMessageCount,
  candidateCount
}) {
  await ensureLegacyImported();
  const reviewedAt = new Date().toISOString();
  getGlobalDatabase().prepare(`
    INSERT INTO memory_review_jobs(
      session_id, content_hash, reviewer_version, status, attempts,
      reviewed_at, reviewed_message_count, candidate_count
    ) VALUES (?, ?, ?, 'completed', 0, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      content_hash = excluded.content_hash, reviewer_version = excluded.reviewer_version,
      status = 'completed', attempts = 0, reviewed_at = excluded.reviewed_at,
      reviewed_message_count = excluded.reviewed_message_count,
      candidate_count = excluded.candidate_count, claimed_at = NULL, lease_until = NULL,
      failed_at = NULL, next_retry_at = NULL, last_error = NULL
  `).run(sessionId, contentHash, reviewerVersion, reviewedAt, reviewedMessageCount, candidateCount);
  return toRecord(getJob(sessionId));
}

export async function failSessionMemoryReview({ sessionId, contentHash, reviewerVersion, error }) {
  await ensureLegacyImported();
  const existing = getJob(sessionId);
  const attempts = Math.max(1, Number(existing?.attempts || 1));
  const now = Date.now();
  const delayMs = Math.min(6 * 60 * 60 * 1000, 30000 * (2 ** Math.min(8, attempts - 1)));
  getGlobalDatabase().prepare(`
    INSERT INTO memory_review_jobs(
      session_id, content_hash, reviewer_version, status, attempts, failed_at, next_retry_at, last_error
    ) VALUES (?, ?, ?, 'failed', ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      content_hash = excluded.content_hash, reviewer_version = excluded.reviewer_version,
      status = 'failed', attempts = excluded.attempts, failed_at = excluded.failed_at,
      next_retry_at = excluded.next_retry_at, last_error = excluded.last_error,
      claimed_at = NULL, lease_until = NULL
  `).run(
    sessionId, contentHash, reviewerVersion, attempts, new Date(now).toISOString(),
    new Date(now + delayMs).toISOString(), String(error?.message || error || 'session memory review failed').slice(0, 240)
  );
  return toRecord(getJob(sessionId));
}
