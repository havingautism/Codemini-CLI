import cliTruncate from 'cli-truncate';
import stripAnsi from 'strip-ansi';
import { classifyCommandIntent } from './shell.js';

const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

export function sanitizeTextForModel(
  value,
  {
    maxChars = 0,
    maxLineLength = 220,
    maxConsecutiveBlankLines = 1
  } = {}
) {
  if (value == null) return '';

  const lines = String(value)
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const output = [];
  let blankRun = 0;

  for (const rawLine of lines) {
    const line = stripAnsi(rawLine).replace(CONTROL_CHARS_RE, '').replace(/[ \t]+$/g, '');
    if (!line.trim()) {
      blankRun += 1;
      if (blankRun > maxConsecutiveBlankLines) continue;
      output.push('');
      continue;
    }

    blankRun = 0;
    output.push(
      maxLineLength > 0
        ? cliTruncate(line, maxLineLength, { position: 'end' })
        : line
    );
  }

  let sanitized = output.join('\n').trimEnd();
  if (maxChars > 0 && sanitized.length > maxChars) {
    sanitized = `${sanitized.slice(0, maxChars)}\n... [sanitized output truncated ${sanitized.length - maxChars} chars]`;
  }
  return sanitized;
}

export function getToolOutputSanitizeOptions(toolName) {
  const name = String(toolName || '').trim();
  if (
    name === 'read'
    || name === 'read_ast_node'
    || name === 'run'
    || name === 'web_fetch'
    || name === 'web_search'
  ) {
    return {
      maxLineLength: 0
    };
  }
  return {};
}

export function sanitizePreviewLines(value, { maxLineLength = 220 } = {}) {
  const sanitized = sanitizeTextForModel(value, {
    maxLineLength,
    maxConsecutiveBlankLines: 0
  });
  if (!sanitized) return [];
  return sanitized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function summarizeGitStatusPorcelain(stdout) {
  const modified = [];
  const added = [];
  const deleted = [];
  const untracked = [];

  for (const line of String(stdout || '').split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const status = trimmed.slice(0, 2);
    const file = trimmed.slice(3).trim();
    if (!file) continue;
    if (status === '??') {
      untracked.push(file);
      continue;
    }
    if (status.includes('A')) added.push(file);
    else if (status.includes('D')) deleted.push(file);
    else modified.push(file);
  }

  const total = modified.length + added.length + deleted.length + untracked.length;
  if (total === 0) return '';
  const lines = [`[git status: ${total} file(s)]`];
  if (modified.length) lines.push(`modified: ${modified.join(', ')}`);
  if (added.length) lines.push(`added: ${added.join(', ')}`);
  if (deleted.length) lines.push(`deleted: ${deleted.join(', ')}`);
  if (untracked.length) lines.push(`untracked: ${untracked.join(', ')}`);
  return lines.join('\n');
}

function summarizeTestFailure(command, code, stdout, stderr) {
  if (classifyCommandIntent(command).kind !== 'test') {
    return '';
  }
  if (Number(code ?? 0) === 0) return '';

  const lines = sanitizePreviewLines([stdout, stderr].filter(Boolean).join('\n'), { maxLineLength: 220 });
  const kept = [];

  for (const line of lines) {
    if (
      /^FAIL\b/.test(line) ||
      /^Test Suites:/.test(line) ||
      /^Tests:/.test(line) ||
      /AssertionError|Error:|Expected|expected .* to /i.test(line) ||
      /^\s*at\b/.test(line) ||
      /:\d+:\d+\)?$/.test(line)
    ) {
      kept.push(line);
    }
  }

  if (kept.length === 0) return '';
  return [`[test failure: exit ${code ?? 1}]`, ...kept.slice(0, 8)].join('\n');
}

function summarizeInstallOutput(command, code, stdout) {
  if (classifyCommandIntent(command).kind !== 'install') return '';

  const lines = sanitizePreviewLines(stdout, { maxLineLength: 220 });
  const kept = [];
  for (const line of lines) {
    if (
      /\b(?:added|removed|changed|audited) \d+ package/i.test(line) ||
      /\bvulnerabilit(?:y|ies)\b/i.test(line) ||
      /looking for funding/i.test(line)
    ) {
      kept.push(line);
    }
  }
  if (kept.length === 0) return '';
  return [`[install summary: exit ${code ?? 0}]`, ...kept.slice(0, 6)].join('\n');
}

function summarizeBuildOutput(command, code, stdout, stderr) {
  if (classifyCommandIntent(command).kind !== 'build') return '';
  if (Number(code ?? 0) === 0) return '';

  const lines = sanitizePreviewLines([stdout, stderr].filter(Boolean).join('\n'), { maxLineLength: 220 });
  const kept = [];
  for (const line of lines) {
    if (
      /\berror\b/i.test(line) ||
      /Build failed/i.test(line) ||
      /failed with/i.test(line)
    ) {
      kept.push(line);
    }
  }
  if (kept.length === 0) return '';
  return [`[build failure: exit ${code ?? 1}]`, ...kept.slice(0, 8)].join('\n');
}

function summarizeGenericFailure(result) {
  const code = Number(result?.code ?? result?.exitCode ?? 0);
  if (!Number.isFinite(code) || code === 0) return '';
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  const lines = sanitizePreviewLines([stderr, stdout].filter(Boolean).join('\n'), { maxLineLength: 220 });
  if (lines.length === 0) return `[command failed: exit ${code}]`;
  return [`[command failed: exit ${code}]`, ...lines.slice(0, 12)].join('\n');
}

export function buildRunFailureMessage(result) {
  const code = Number(result?.code ?? result?.exitCode ?? 0);
  if (!Number.isFinite(code) || code === 0) return '';
  const command = String(result?.command || '').trim();
  const stderr = String(result?.stderr || '').trim();
  const stdout = String(result?.stdout || '').trim();
  const parts = [`Command failed with exit code ${code}`];
  if (command) parts.push(`command: ${command.slice(0, 240)}`);
  if (stderr) parts.push(`stderr:\n${stderr}`);
  else if (stdout) parts.push(`stdout:\n${stdout}`);
  return parts.join('\n');
}

export function summarizeRunOutput(result) {
  const command = String(result?.command || '').trim();
  const stdout = String(result?.stdout || '');
  const stderr = String(result?.stderr || '');
  const code = result?.code ?? 0;

  if (/^git\s+status\b.*(?:--short|-s)\b/i.test(command)) {
    const gitSummary = summarizeGitStatusPorcelain(stdout);
    if (gitSummary) return gitSummary;
  }

  const installSummary = summarizeInstallOutput(command, code, stdout);
  if (installSummary) return installSummary;

  const buildSummary = summarizeBuildOutput(command, code, stdout, stderr);
  if (buildSummary) return buildSummary;

  const testSummary = summarizeTestFailure(command, code, stdout, stderr);
  if (testSummary) return testSummary;

  return summarizeGenericFailure(result);
}
