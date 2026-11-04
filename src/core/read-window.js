import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';

export const READ_MAX_LINES = 2000;
export const READ_MAX_BYTES = 50 * 1024;
export const READ_MAX_LINE_CHARS = 2000;

function safePrefix(text, length) {
  return text.slice(0, length).replace(/[\uD800-\uDBFF]$/, '');
}

function positiveInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

export function readWindowOptions(args = {}, context = {}) {
  const offset = positiveInteger(args.start_line ?? args.offset, 'offset/start_line', 1);
  const limit = positiveInteger(args.limit, 'limit', undefined);
  if (limit > READ_MAX_LINES) throw new Error(`limit must be less than or equal to ${READ_MAX_LINES}`);
  const end = positiveInteger(args.end_line, 'end_line', undefined);
  if (end !== undefined && end < offset) throw new Error('end_line must be greater than or equal to start_line');
  const defaultLines = positiveInteger(context.read_file_default_lines, 'read_file_default_lines', READ_MAX_LINES);
  const maxChars = positiveInteger(args.max_chars ?? context.read_file_max_chars, 'max_chars', READ_MAX_BYTES);
  if (maxChars < 128) throw new Error('max_chars must be at least 128');
  return {
    offset,
    limit: Math.min(READ_MAX_LINES, end === undefined ? (limit ?? defaultLines) : end - offset + 1),
    maxChars: Math.min(READ_MAX_BYTES, maxChars),
  };
}

// Bound the current line as well as the output. A minified file must not require
// holding an arbitrarily large line (or the entire file) in memory.
export async function collectReadWindow(chunks, { offset = 1, limit = READ_MAX_LINES, maxChars = READ_MAX_BYTES } = {}) {
  const lines = [];
  let totalLines = 0;
  let bytes = 0;
  let chars = 0;
  let capped = false;
  let lineTruncated = false;
  let pending = '';
  let pendingLength = 0;
  const consume = () => {
    totalLines += 1;
    if (totalLines < offset || lines.length >= limit || capped) return;
    let text = pending.replace(/\r$/, '');
    const shortened = pendingLength - (pendingLength <= READ_MAX_LINE_CHARS + 1 && pending.endsWith('\r') ? 1 : 0) > READ_MAX_LINE_CHARS;
    if (shortened) text = `${safePrefix(text, READ_MAX_LINE_CHARS)}... [line truncated]`;
    const rendered = `${totalLines}: ${text}\n`;
    if (bytes + Buffer.byteLength(rendered, 'utf8') > READ_MAX_BYTES || chars + rendered.length > maxChars) {
      if (lines.length > 0) { capped = true; return; }
      // An explicitly tiny budget must still advance, with visible truncation.
      text = safePrefix(text, Math.max(1, maxChars - 64)) + '... [line truncated]';
      lineTruncated = true;
      capped = true;
    }
    bytes += Buffer.byteLength(`${totalLines}: ${text}\n`, 'utf8');
    chars += `${totalLines}: ${text}\n`.length;
    lineTruncated ||= shortened;
    lines.push({ number: totalLines, text });
  };
  const append = (part) => {
    pendingLength += part.length;
    if (pending.length < READ_MAX_LINE_CHARS + 1) pending += part.slice(0, READ_MAX_LINE_CHARS + 1 - pending.length);
  };
  for await (const chunk of chunks) {
    if (chunk.includes('\0')) throw new Error('Cannot read binary file as text');
    let start = 0;
    let end;
    while ((end = chunk.indexOf('\n', start)) !== -1) {
      append(chunk.slice(start, end));
      consume();
      pending = '';
      pendingLength = 0;
      start = end + 1;
    }
    append(chunk.slice(start));
  }
  if (pendingLength > 0) consume();
  if (offset > Math.max(1, totalLines)) throw new Error(`offset ${offset} is out of range (${totalLines} lines)`);
  const last = lines.at(-1)?.number ?? offset - 1;
  return {
    lines, total_lines: totalLines, start_line: offset, end_line: last,
    capped, line_truncated: lineTruncated,
    truncated: last < totalLines || lineTruncated,
    ...(last < totalLines ? { next_offset: last + 1 } : {}),
  };
}

export async function readTextWindow(target, options) {
  const hash = createHash('sha256');
  const decoder = new StringDecoder('utf8');
  async function* chunks() {
    for await (const bytes of createReadStream(target)) {
      hash.update(bytes);
      yield decoder.write(bytes);
    }
    const tail = decoder.end();
    if (tail) yield tail;
  }
  const result = await collectReadWindow(chunks(), options);
  // Observe exactly the bytes read, without a second full-file read or an
  // mtime-only cache that could hide external edits.
  return { ...result, observed_hash: hash.digest('hex') };
}

export function formatReadWindow(result) {
  const lines = result.lines || [];
  const start = lines[0]?.number ?? result.start_line ?? result.offset ?? 1;
  const end = lines.at(-1)?.number ?? start - 1;
  const extent = result.ast_selection ? `, AST selection ends at ${result.total_lines}` : ` of ${result.total_lines}`;
  const header = result.total_lines === 0
    ? `[File: ${result.path}, empty]`
    : `[File: ${result.path}, lines ${start}-${end}${extent}${result.truncated ? ', truncated' : ''}]`;
  const body = lines.map((line) => `${line.number}: ${line.text}`).join('\n');
  const next = result.next_offset ?? (end < result.total_lines ? end + 1 : undefined);
  const footer = [
    result.line_truncated ? 'Long line content shortened; use search_code for specific text.' : '',
    next !== undefined ? `Continue with offset=${next}.${result.capped ? ' Output limit reached.' : ''}` : '',
  ].filter(Boolean).join(' ');
  return [header, body, footer].filter(Boolean).join('\n');
}
