import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const DEFAULT_WRITE_CHUNK_MAX_CHARS = 12_000;
export const DEFAULT_STAGED_WRITE_MAX_CHARS = 4 * 1024 * 1024;

function normalizeExpectedSha256(value) {
  return String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
}

function contentSha256(content) {
  return createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

export function createStagedWriteStore({
  maxChunkChars = DEFAULT_WRITE_CHUNK_MAX_CHARS,
  maxTotalChars = DEFAULT_STAGED_WRITE_MAX_CHARS,
} = {}) {
  const transactions = new Map();
  const writeIdByTarget = new Map();

  function requireTransaction(writeId) {
    const id = String(writeId || '').trim();
    const transaction = transactions.get(id);
    if (!transaction) {
      throw new Error(`Unknown or completed staged write: ${id || '(missing write_id)'}`);
    }
    return transaction;
  }

  function begin({ path: relativePath, target, overwrite = false, existed = false }) {
    const normalizedTarget = path.resolve(String(target || ''));
    const activeId = writeIdByTarget.get(normalizedTarget);
    if (activeId) {
      throw new Error(
        `A staged write is already active for ${relativePath}. Commit or abort ${activeId} first.`,
      );
    }
    const writeId = `write-${randomUUID()}`;
    const transaction = {
      writeId,
      path: String(relativePath || ''),
      target: normalizedTarget,
      overwrite: Boolean(overwrite),
      existed: Boolean(existed),
      chunks: [],
      totalChars: 0,
      createdAt: Date.now(),
    };
    transactions.set(writeId, transaction);
    writeIdByTarget.set(normalizedTarget, writeId);
    return {
      ok: true,
      write_id: writeId,
      path: transaction.path,
      next_sequence: 0,
      max_chunk_chars: maxChunkChars,
      max_total_chars: maxTotalChars,
    };
  }

  function append({ writeId, sequence, content }) {
    const transaction = requireTransaction(writeId);
    const seq = Number(sequence);
    if (!Number.isSafeInteger(seq) || seq < 0) {
      throw new Error('write_chunk requires sequence to be a non-negative integer');
    }
    if (content == null) {
      throw new Error('write_chunk requires content');
    }
    const chunk = String(content);
    if (chunk.length > maxChunkChars) {
      throw new Error(
        `write_chunk content is too large (${chunk.length} chars; max ${maxChunkChars}). Split it into smaller chunks.`,
      );
    }
    if (seq < transaction.chunks.length) {
      if (transaction.chunks[seq] !== chunk) {
        throw new Error(
          `write_chunk sequence ${seq} was already stored with different content. Retry with the original content or abort the staged write.`,
        );
      }
      return {
        ok: true,
        write_id: transaction.writeId,
        sequence: seq,
        duplicate: true,
        stored_chars: chunk.length,
        total_chars: transaction.totalChars,
        next_sequence: transaction.chunks.length,
      };
    }
    if (seq !== transaction.chunks.length) {
      throw new Error(
        `write_chunk expected sequence ${transaction.chunks.length}, received ${seq}`,
      );
    }
    if (transaction.totalChars + chunk.length > maxTotalChars) {
      throw new Error(
        `Staged write would exceed ${maxTotalChars} chars. Use a smaller artifact or another generation workflow.`,
      );
    }
    transaction.chunks.push(chunk);
    transaction.totalChars += chunk.length;
    return {
      ok: true,
      write_id: transaction.writeId,
      sequence: seq,
      duplicate: false,
      stored_chars: chunk.length,
      total_chars: transaction.totalChars,
      next_sequence: transaction.chunks.length,
    };
  }

  function prepareCommit({ writeId, totalChunks, expectedSha256 = '' }) {
    const transaction = requireTransaction(writeId);
    const expectedCount = Number(totalChunks);
    if (!Number.isSafeInteger(expectedCount) || expectedCount < 0) {
      throw new Error('commit_write requires total_chunks to be a non-negative integer');
    }
    if (expectedCount !== transaction.chunks.length) {
      throw new Error(
        `commit_write expected ${transaction.chunks.length} total_chunks, received ${expectedCount}`,
      );
    }
    const content = transaction.chunks.join('');
    const sha256 = contentSha256(content);
    const expectedHash = normalizeExpectedSha256(expectedSha256);
    if (expectedHash && expectedHash !== sha256) {
      throw new Error(
        `commit_write sha256 mismatch: expected ${expectedHash}, assembled ${sha256}`,
      );
    }
    return { transaction, content, sha256 };
  }

  function finish(writeId) {
    const transaction = requireTransaction(writeId);
    transactions.delete(transaction.writeId);
    writeIdByTarget.delete(transaction.target);
  }

  function abort(writeId) {
    const transaction = requireTransaction(writeId);
    transactions.delete(transaction.writeId);
    writeIdByTarget.delete(transaction.target);
    return {
      ok: true,
      aborted: true,
      write_id: transaction.writeId,
      path: transaction.path,
      discarded_chunks: transaction.chunks.length,
      discarded_chars: transaction.totalChars,
    };
  }

  function clear() {
    transactions.clear();
    writeIdByTarget.clear();
  }

  return { begin, append, prepareCommit, finish, abort, clear };
}

export async function atomicWriteUtf8(target, content, writeId = '') {
  const directory = path.dirname(target);
  const baseName = path.basename(target);
  const safeId = String(writeId || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '');
  const temporaryPath = path.join(directory, `.${baseName}.codemini-${safeId}.tmp`);
  await fs.mkdir(directory, { recursive: true });
  try {
    await fs.writeFile(temporaryPath, String(content ?? ''), {
      encoding: 'utf8',
      flag: 'wx',
    });
    await fs.rename(temporaryPath, target);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
}
