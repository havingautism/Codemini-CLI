import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { getProjectChangeLedgerDir } from './paths.js';
import { normalizePath } from './string-utils.js';

const PATCH_PREVIEW_MAX_CHARS = 40_000;
const NARROW_CAPTURE_TOOLS = new Set(['edit', 'write', 'delete']);
const CHANGE_MANIFEST_VERSION = 1;
const COMMON_EXCLUDES = [
  '.git/',
  '.codemini/change-ledger/',
  '**/.codemini/change-ledger/',
  '.codemini/project-map.json',
  '**/.codemini/project-map.json',
  '.codemini/file-index.json',
  '**/.codemini/file-index.json',
  'node_modules/',
  'dist/',
  'build/',
  '.next/',
  'coverage/'
];

function runGit(args, { cwd, gitDir, input = null, allowFailure = false, timeoutMs = 120_000 } = {}) {
  const fullArgs = gitDir ? ['--git-dir', gitDir, '--work-tree', cwd, ...args] : args;
  return new Promise((resolve, reject) => {
    const child = spawn('git', fullArgs, {
      cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = { code, stdout, stderr };
      if (code === 0 || allowFailure) resolve(result);
      else reject(new Error(stderr.trim() || stdout.trim() || `git exited with code ${code}`));
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

function relPath(workspaceRoot, filePath) {
  return normalizePath(path.relative(workspaceRoot, filePath));
}

function changeId(prefix = 'change') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${rand}`;
}

function isBinaryNumstat(value) {
  return String(value || '') === '-';
}

function decodeGitQuotedPath(value) {
  let text = String(value || '');
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1);
  }
  if (!/\\(?:[0-7]{3}|["\\abfnrtv])/.test(text)) return text;
  const bytes = [];
  let plain = '';
  const flushPlain = () => {
    if (!plain) return;
    for (const byte of Buffer.from(plain, 'utf8')) bytes.push(byte);
    plain = '';
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== '\\') {
      plain += ch;
      continue;
    }
    const next = text[i + 1] || '';
    const octal = text.slice(i + 1, i + 4);
    if (/^[0-7]{3}$/.test(octal)) {
      flushPlain();
      bytes.push(parseInt(octal, 8));
      i += 3;
      continue;
    }
    const escapes = {
      a: '\x07',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '"': '"',
      '\\': '\\'
    };
    plain += Object.prototype.hasOwnProperty.call(escapes, next) ? escapes[next] : next;
    i += 1;
  }
  flushPlain();
  return Buffer.from(bytes).toString('utf8');
}

function normalizeGitPath(value) {
  return normalizePath(decodeGitQuotedPath(value));
}

function normalizeCapturePathspecs(paths = []) {
  const out = [];
  const seen = new Set();
  for (const value of Array.isArray(paths) ? paths : [paths]) {
    const normalized = normalizePath(String(value || '').trim());
    if (!normalized || normalized === '.' || normalized.startsWith('../') || path.isAbsolute(normalized)) continue;
    if (isInternalRuntimePath(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function parseNameStatus(text) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const status = parts[0] || '';
    const rawPath = parts[2] || parts[1] || '';
    if (!rawPath) continue;
    out.push({
      path: normalizeGitPath(rawPath),
      action: status.startsWith('A') ? 'create' : status.startsWith('D') ? 'delete' : 'edit'
    });
  }
  return out;
}

function parseNumstat(text) {
  const byPath = new Map();
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const addedRaw = parts[0];
    const removedRaw = parts[1];
    const filePath = normalizeGitPath(parts[3] || parts[2] || '');
    if (!filePath) continue;
    byPath.set(filePath, {
      linesAdded: isBinaryNumstat(addedRaw) ? 0 : Math.max(0, Number(addedRaw) || 0),
      linesRemoved: isBinaryNumstat(removedRaw) ? 0 : Math.max(0, Number(removedRaw) || 0),
      binary: isBinaryNumstat(addedRaw) || isBinaryNumstat(removedRaw)
    });
  }
  return byPath;
}

function isInternalRuntimePath(filePath) {
  const normalized = normalizePath(filePath);
  return normalized === '.codemini/file-index.json'
    || normalized.endsWith('/.codemini/file-index.json')
    || normalized === '.codemini/project-map.json'
    || normalized.endsWith('/.codemini/project-map.json')
    || normalized.startsWith('.codemini/change-ledger/')
    || normalized.includes('/.codemini/change-ledger/');
}

function firstChangedLineFromPatch(patch) {
  const match = String(patch || '').match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/m);
  return match ? Math.max(1, Number(match[1]) || 1) : 0;
}

function stripDiffPathPrefix(value) {
  const text = decodeGitQuotedPath(String(value || '').trim());
  if (text === '/dev/null') return '';
  return normalizePath(text.replace(/^[ab]\//, ''));
}

function pathFromDiffBlock(block) {
  const lines = String(block || '').split(/\r?\n/);
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      const filePath = stripDiffPathPrefix(line.slice(4));
      if (filePath) return filePath;
    }
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      const filePath = stripDiffPathPrefix(line.slice(4));
      if (filePath) return filePath;
    }
  }
  for (const line of lines) {
    if (!line.startsWith('diff --git ')) continue;
    const marker = line.lastIndexOf(' b/');
    if (marker !== -1) {
      const filePath = stripDiffPathPrefix(line.slice(marker + 1));
      if (filePath) return filePath;
    }
  }
  return '';
}

function splitPatchByFile(patch) {
  const out = new Map();
  const text = String(patch || '');
  if (!text.trim()) return out;
  const blocks = text.split(/(?=^diff --git )/m).filter((block) => block.trim());
  for (const block of blocks) {
    const filePath = pathFromDiffBlock(block);
    if (filePath) out.set(filePath, block);
  }
  return out;
}

async function writeExclude(gitDir) {
  const infoDir = path.join(gitDir, 'info');
  await fs.mkdir(infoDir, { recursive: true });
  await fs.writeFile(path.join(infoDir, 'exclude'), `${COMMON_EXCLUDES.join('\n')}\n`, 'utf8');
}

async function unstageInternalRuntimeFiles(ledger) {
  const pathspecs = [
    '.codemini/file-index.json',
    '.codemini/project-map.json',
    '.codemini/change-ledger',
    ':(glob)**/.codemini/file-index.json',
    ':(glob)**/.codemini/project-map.json',
    ':(glob)**/.codemini/change-ledger/**'
  ];
  await runGit(['reset', '-q', '--', ...pathspecs], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    allowFailure: true,
    timeoutMs: 180_000
  });
}

async function hideTrackedInternalRuntimeFiles(ledger) {
  const pathspecs = [
    '.codemini/file-index.json',
    '.codemini/project-map.json',
    ':(glob)**/.codemini/file-index.json',
    ':(glob)**/.codemini/project-map.json'
  ];
  await runGit(['update-index', '--skip-worktree', '--', ...pathspecs], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    allowFailure: true,
    timeoutMs: 180_000
  });
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

export function isProjectChangeLedgerAvailable(ledger) {
  return Boolean(ledger?.enabled);
}

export async function createProjectChangeLedger({ workspaceRoot = process.cwd(), sessionId, enabled = true, onEvent } = {}) {
  const root = path.resolve(workspaceRoot);
  const id = String(sessionId || '').trim();
  if (!enabled || !id) return { enabled: false, reason: 'disabled' };

  const ledgerDir = getProjectChangeLedgerDir(root, id);
  const gitDir = path.join(ledgerDir, 'git');
  const patchesDir = path.join(ledgerDir, 'patches');
  const changesDir = path.join(ledgerDir, 'changes');
  const statePath = path.join(ledgerDir, 'state.json');

  const ledger = {
    enabled: true,
    workspaceRoot: root,
    sessionId: id,
    ledgerDir,
    gitDir,
    patchesDir,
    changesDir,
    statePath
  };

  try {
    await fs.mkdir(ledgerDir, { recursive: true });
    let state = null;
    try { state = await readJson(statePath); } catch {}
    if (!state?.baselineCommit) {
      onEvent?.({ type: 'system_tool:start', name: 'change_checkpoint', summary: 'initializing project checkpoints' });
      await fs.rm(gitDir, { recursive: true, force: true });
      await runGit(['init', '--bare', gitDir], { cwd: root, timeoutMs: 180_000 });
      await runGit(['config', 'core.bare', 'false'], { cwd: root, gitDir });
      await runGit(['config', 'core.quotePath', 'false'], { cwd: root, gitDir });
      await runGit(['config', 'core.preloadIndex', 'true'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'core.untrackedCache', 'true'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'gc.auto', '0'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'user.email', 'codemini@example.local'], { cwd: root, gitDir });
      await runGit(['config', 'user.name', 'Codemini'], { cwd: root, gitDir });
      await writeExclude(gitDir);
      await fs.mkdir(patchesDir, { recursive: true });
      await fs.mkdir(changesDir, { recursive: true });
      await runGit(['add', '-A'], { cwd: root, gitDir, timeoutMs: 180_000 });
      await runGit(['commit', '--allow-empty', '-m', 'codemini baseline'], { cwd: root, gitDir, timeoutMs: 180_000 });
      const baselineCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: root, gitDir })).stdout.trim();
      state = {
        version: CHANGE_MANIFEST_VERSION,
        sessionId: id,
        workspaceRoot: root,
        baselineCommit,
        headCommit: baselineCommit,
        initializedAt: new Date().toISOString()
      };
      await writeJson(statePath, state);
      onEvent?.({ type: 'system_tool:end', name: 'change_checkpoint', summary: 'project checkpoints initialized' });
    } else {
      await runGit(['config', 'core.quotePath', 'false'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'core.preloadIndex', 'true'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'core.untrackedCache', 'true'], { cwd: root, gitDir, allowFailure: true });
      await runGit(['config', 'gc.auto', '0'], { cwd: root, gitDir, allowFailure: true });
      await writeExclude(gitDir);
      await hideTrackedInternalRuntimeFiles(ledger);
    }
    ledger.state = state;
    return ledger;
  } catch (error) {
    onEvent?.({
      type: 'system_tool:error',
      name: 'change_checkpoint',
      summary: error instanceof Error ? error.message : String(error)
    });
    return { enabled: false, reason: error instanceof Error ? error.message : String(error), workspaceRoot: root, sessionId: id };
  }
}

export async function getLedgerHead(ledger) {
  if (!isProjectChangeLedgerAvailable(ledger)) return '';
  return (await runGit(['rev-parse', 'HEAD'], { cwd: ledger.workspaceRoot, gitDir: ledger.gitDir })).stdout.trim();
}

export async function captureWorkspaceChanges(ledger, { toolName = 'tool', toolCallId = '', summary = '', paths = [] } = {}) {
  if (!isProjectChangeLedgerAvailable(ledger)) return null;
  const beforeCommit = ledger.state?.headCommit || await getLedgerHead(ledger);
  const pathspecs = NARROW_CAPTURE_TOOLS.has(String(toolName || ''))
    ? normalizeCapturePathspecs(paths)
    : [];
  const addArgs = pathspecs.length ? ['add', '-A', '--', ...pathspecs] : ['add', '-A'];
  await runGit(addArgs, { cwd: ledger.workspaceRoot, gitDir: ledger.gitDir, timeoutMs: 180_000 });
  if (!pathspecs.length) {
    await unstageInternalRuntimeFiles(ledger);
  }

  const nameStatus = (await runGit(['diff', '--cached', '--name-status'], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir
  })).stdout;
  const changedFiles = parseNameStatus(nameStatus).filter((item) => !isInternalRuntimePath(item.path));
  if (changedFiles.length === 0) return null;

  const numstat = (await runGit(['diff', '--cached', '--numstat', '--', ...changedFiles.map((item) => item.path)], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir
  })).stdout;
  const stats = parseNumstat(numstat);
  const files = changedFiles.map((item) => {
    const stat = stats.get(item.path) || {};
    return {
      ...item,
      linesAdded: Number(stat.linesAdded || 0),
      linesRemoved: Number(stat.linesRemoved || 0),
      binary: Boolean(stat.binary)
    };
  });
  if (files.length === 0) return null;

  const patch = (await runGit(['diff', '--cached', '--patch', '--binary', '--no-color', '--', ...files.map((item) => item.path)], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    timeoutMs: 180_000
  })).stdout;
  const filePatches = splitPatchByFile(patch);
  const id = changeId('change');
  const patchPath = path.join(ledger.patchesDir, `${id}.patch`);
  await fs.mkdir(ledger.patchesDir, { recursive: true });
  await fs.writeFile(patchPath, patch, 'utf8');
  await runGit(['commit', '-m', `codemini ${toolName}:${toolCallId || id}`], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    timeoutMs: 180_000
  });
  const afterCommit = await getLedgerHead(ledger);
  const change = {
    version: CHANGE_MANIFEST_VERSION,
    id,
    sessionId: ledger.sessionId,
    createdAt: new Date().toISOString(),
    toolName,
    toolCallId,
    summary,
    beforeCommit,
    afterCommit,
    patchRef: relPath(ledger.workspaceRoot, patchPath),
    patchPath,
    files,
    revertedAt: null
  };
  await writeJson(path.join(ledger.changesDir, `${id}.json`), change);
  ledger.state = {
    ...(ledger.state || {}),
    headCommit: afterCommit,
    updatedAt: new Date().toISOString()
  };
  await writeJson(ledger.statePath, ledger.state);

  return files.map((item) => {
    const filePatch = filePatches.get(item.path) || '';
    return {
      path: item.path,
      action: item.action,
      linesAdded: Number(item.linesAdded || 0),
      linesRemoved: Number(item.linesRemoved || 0),
      changedLine: firstChangedLineFromPatch(filePatch),
      diffPreview: filePatch.length > PATCH_PREVIEW_MAX_CHARS
        ? `${filePatch.slice(0, PATCH_PREVIEW_MAX_CHARS)}\n... [diff truncated]`
        : filePatch,
      changeSetId: id,
      beforeCommit,
      afterCommit,
      patchRef: change.patchRef,
      files: [item]
    };
  });
}

export async function readChangeSet(ledger, changeSetId) {
  if (!isProjectChangeLedgerAvailable(ledger)) throw new Error('Project checkpoints are not available for this session');
  const id = String(changeSetId || '').trim();
  if (!id) throw new Error('Missing change set id');
  return readJson(path.join(ledger.changesDir, `${id}.json`));
}

export async function listChangeSets(ledger) {
  if (!isProjectChangeLedgerAvailable(ledger)) return [];
  let entries = [];
  try {
    entries = await fs.readdir(ledger.changesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try { out.push(await readJson(path.join(ledger.changesDir, entry.name))); } catch {}
  }
  out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return out;
}

export async function getLatestChangeSet(ledger) {
  const changes = await listChangeSets(ledger);
  return changes.find((change) => !change.revertedAt) || null;
}

export async function readChangeSetPatch(ledger, changeSetId) {
  const change = await readChangeSet(ledger, changeSetId);
  return fs.readFile(change.patchPath, 'utf8');
}

export async function undoChangeSet(ledger, changeSetId) {
  if (!isProjectChangeLedgerAvailable(ledger)) throw new Error('Project checkpoints are not available for this session');
  const change = await readChangeSet(ledger, changeSetId);
  if (change.revertedAt) {
    return { ok: false, alreadyReverted: true, changeSetId: change.id, message: 'Change set already reverted' };
  }
  const dirty = await runGit(['status', '--porcelain'], { cwd: ledger.workspaceRoot, gitDir: ledger.gitDir });
  if (dirty.stdout.trim()) {
    throw new Error('Workspace has uncaptured changes; run another request or refresh before undoing');
  }
  const reversePatch = (await runGit(['diff', '--binary', '--no-color', change.afterCommit, change.beforeCommit], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    timeoutMs: 180_000
  })).stdout;
  if (!reversePatch.trim()) {
    return { ok: false, changeSetId: change.id, message: 'No patch available to undo' };
  }
  try {
    await runGit(['apply', '--check', '--whitespace=nowarn'], {
      cwd: ledger.workspaceRoot,
      gitDir: ledger.gitDir,
      input: reversePatch,
      timeoutMs: 180_000
    });
  } catch (error) {
    throw new Error(`Cannot undo this change cleanly because newer edits conflict with it. Undo newer changes first, or revert it manually. ${error?.message || ''}`.trim());
  }
  await runGit(['apply', '--whitespace=nowarn'], {
    cwd: ledger.workspaceRoot,
    gitDir: ledger.gitDir,
    input: reversePatch,
    timeoutMs: 180_000
  });
  const undoCapture = await captureWorkspaceChanges(ledger, {
    toolName: 'undo',
    toolCallId: change.id,
    summary: `undo ${change.id}`
  });
  const undoChangeSetId = Array.isArray(undoCapture)
    ? String(undoCapture[0]?.changeSetId || '')
    : undoCapture?.changeSetId || null;
  change.revertedAt = new Date().toISOString();
  change.undoChangeSetId = undoChangeSetId || null;
  await writeJson(path.join(ledger.changesDir, `${change.id}.json`), change);
  return {
    ok: true,
    changeSetId: change.id,
    undoChangeSetId: undoChangeSetId || null,
    fileChange: undoCapture
  };
}
