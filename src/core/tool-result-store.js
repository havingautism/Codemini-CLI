import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BoundedCache } from './bounded-cache.js';
import { trimInline } from './string-utils.js';

const TOOL_RESULT_DISK_THRESHOLD = 6000;
const PREVIEW_SIZE_BYTES = 2000;
const TOOL_RESULTS_SUBDIR = 'tool-results';

let currentResultDir = null;
let resultDirReady = false;

const storedResults = new BoundedCache({
  maxSize: 64,
  ttlMs: 30 * 60 * 1000,
  onEvict(_key, value) {
    if (value?.filePath) {
      fs.unlink(value.filePath).catch(() => {});
    }
  }
});

const readCache = new BoundedCache({ maxSize: 128, ttlMs: 10 * 60 * 1000 });

function generatePreview(content) {
  if (content.length <= PREVIEW_SIZE_BYTES) {
    return { preview: content, hasMore: false };
  }
  const truncated = content.slice(0, PREVIEW_SIZE_BYTES);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > PREVIEW_SIZE_BYTES * 0.5 ? lastNewline : PREVIEW_SIZE_BYTES;
  return { preview: content.slice(0, cutPoint), hasMore: true };
}

function formatFileSize(chars) {
  if (chars < 1024) return `${chars} B`;
  return `${(chars / 1024).toFixed(1)} KB`;
}

export function setResultDir(dir) {
  currentResultDir = dir ? path.join(dir, TOOL_RESULTS_SUBDIR) : null;
  resultDirReady = false;
}

async function ensureResultDir() {
  if (!currentResultDir) return false;
  if (!resultDirReady) {
    await fs.mkdir(currentResultDir, { recursive: true });
    resultDirReady = true;
  }
  return true;
}

export async function storeResultIfNeeded(callId, formattedContent, rawResult) {
  if (formattedContent.length <= TOOL_RESULT_DISK_THRESHOLD) {
    return formattedContent;
  }
  try {
    const ready = await ensureResultDir();
    const dir = ready ? currentResultDir : path.join(os.tmpdir(), 'codemini-results');
    if (!resultDirReady && dir === currentResultDir) {
      await fs.mkdir(dir, { recursive: true });
    } else if (!resultDirReady) {
      await fs.mkdir(dir, { recursive: true });
    }
    const filePath = path.join(dir, `${callId}.txt`);
    const payload = typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2);
    await fs.writeFile(filePath, payload, 'utf-8');
    const summary = summarizeToolResult(rawResult);
    const { preview, hasMore } = generatePreview(payload);
    storedResults.set(callId, { filePath, summary });

    return `<persisted-output>
Output too large (${formatFileSize(payload.length)}). Full output saved to: ${filePath}

Preview (first ${formatFileSize(PREVIEW_SIZE_BYTES)}):
${preview}${hasMore ? '\n...' : ''}

Summary: ${summary}
</persisted-output>`;
  } catch {
    return formattedContent;
  }
}

export function clearResultStore() {
  const files = [];
  for (const [, val] of storedResults.entries()) {
    files.push(val.filePath);
  }
  storedResults.clear();
  readCache.clear();
  return Promise.allSettled(files.map((filePath) => fs.unlink(filePath).catch(() => {})));
}

export function checkReadDedup(filePath, startLine, endLine, mtimeMs) {
  const key = `${filePath}:${startLine || 0}:${endLine || 0}:${mtimeMs}`;
  if (readCache.has(key)) {
    return true;
  }
  readCache.set(key, true);
  return false;
}

export function summarizeToolResult(result) {
  if (result === null || result === undefined) return 'no output';
  if (typeof result === 'string') {
    const oneLine = result.replace(/\s+/g, ' ').trim();
    return oneLine.length > 90 ? `${oneLine.slice(0, 87)}...` : oneLine || 'empty string';
  }
  if (typeof result === 'object') {
    const obj = result;
    if (Array.isArray(obj)) return `array(${obj.length})`;
    if ('deleted' in obj && 'path' in obj) {
      const kind = trimInline(obj.type || 'item', 16);
      const target = trimInline(obj.path || '', 96);
      if (obj.deleted) return target ? `deleted ${kind} ${target}` : `deleted ${kind}`;
      if (obj.cancelled) return target ? `cancelled delete ${target}` : 'cancelled delete';
    }
    if ('path' in obj && 'action' in obj) {
      const p = String(obj.path || '');
      const action = String(obj.action || 'write');
      const line = Number(obj.changed_line || 1);
      if (action === 'apply_patch' && !p && Array.isArray(obj.files)) {
        return `patched ${obj.files.length} file(s)`;
      }
      const suffix =
        action === 'delete'
          ? 'deleted'
          : action === 'create'
            ? 'created'
            : action === 'patch' || action === 'apply_patch'
              ? 'patched'
              : action === 'replace_block' || action === 'replace_text'
                ? 'edited'
                : action === 'append'
                  ? 'appended'
                  : 'updated';
      return p ? `${suffix} ${p}${line > 0 ? ` @L${line}` : ''}` : suffix;
    }
    if ('path' in obj && 'phase' in obj) {
      const phase = String(obj.phase || '');
      const p = String(obj.path || '');
      const total = Number(obj.total_lines);
      const start =
        Number(obj.suggested_start_line || obj.start_line) > 0
          ? Number(obj.suggested_start_line || obj.start_line)
          : 1;
      const end =
        Number(obj.suggested_end_line || obj.end_line) >= start
          ? Number(obj.suggested_end_line || obj.end_line)
          : start;
      const rangeText = start > 0 && end >= start ? ` lines ${start}-${end}` : '';
      const totalText = total > 0 ? ` of ${total}` : '';
      const enclosingText = obj.enclosing_symbol ? ` in ${obj.enclosing_symbol}` : '';
      const errorText = obj.error ? ` (${trimInline(obj.error, 64)})` : '';
      const truncatedText = obj.truncated ? ' [truncated]' : '';
      return phase === 'metadata'
        ? `metadata for ${p}${rangeText}${totalText}${errorText}`
        : `content from ${p}${rangeText}${totalText}${enclosingText}${truncatedText}`;
    }
    if ('stdout' in obj || 'stderr' in obj || 'code' in obj) {
      const stdout = trimInline(obj.stdout || '', 96);
      const stderr = trimInline(obj.stderr || '', 96);
      const command = trimInline(obj.command || '', 72);
      const lead = command ? `${command} -> ` : '';
      if (stdout) return `${lead}exit ${obj.code ?? 0}\nstdout: ${stdout}`;
      if (stderr) return `${lead}exit ${obj.code ?? 0}\nstderr: ${stderr}`;
      return `${lead}exit ${obj.code ?? 0}`;
    }
    if ('task_id' in obj && 'startup_confirmed' in obj) {
      const status = trimInline(obj.status || 'unknown', 32);
      const taskId = trimInline(obj.task_id || '', 24);
      const source = trimInline(obj.startup_source || '', 24);
      const outputFile = trimInline(obj.output_file || '', 72);
      const output = Array.isArray(obj.recent_output) ? trimInline(obj.recent_output.slice(-1)[0] || '', 96) : '';
      return `${taskId || 'task'} ${status}${source ? ` (${source})` : ''}${outputFile ? ` -> ${outputFile}` : ''}${output ? `\n${output}` : ''}`;
    }
    if ('tasks' in obj && Array.isArray(obj.tasks)) {
      const count = obj.tasks.length;
      const first = obj.tasks[0];
      const lead = first?.task_id ? `${trimInline(first.task_id, 24)} ${trimInline(first.status || 'unknown', 24)}` : '';
      return `tasks(${count})${lead ? `\n${lead}` : ''}`;
    }
    if ('files' in obj && Array.isArray(obj.files)) {
      return `patched ${obj.files.length} file(s)`;
    }
    if ('diff' in obj && 'new_hash' in obj && 'path' in obj) {
      const p = String(obj.path || '');
      return p ? `diff preview for ${p}` : 'diff preview';
    }
    if ('created' in obj && Array.isArray(obj.created)) {
      return `created ${obj.created.length} task(s)`;
    }
    if ('tasks' in obj && Array.isArray(obj.tasks)) {
      return `${obj.tasks.length} task(s)`;
    }
    if ('newTodos' in obj && Array.isArray(obj.newTodos)) {
      return obj.newTodos.length > 0 ? `updated ${obj.newTodos.length} todo item(s)` : 'cleared todo list';
    }
    if ('newPlan' in obj) {
      return obj.newPlan ? `updated plan state (${String(obj.newPlan.status || 'draft')})` : 'cleared plan state';
    }
    const keys = Object.keys(obj);
    return keys.length > 0 ? `keys: ${keys.slice(0, 5).join(',')}` : 'object';
  }
  return String(result);
}
