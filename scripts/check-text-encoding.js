import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';

const MAX_TEXT_FILE_BYTES = 5_000_000;
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const mojibakePattern = new RegExp(
  [
    '\\u9239\\u20ac',
    '\\u93c2\\u56e8',
    '\\u95c2[\\ue000-\\uf8ff]',
    '\\u8902\\u64b3',
    '\\u951f\\u65a4',
    '\\ufffd',
    '\\u00c3[\\u0080-\\u00bf]',
    '\\u00c2[\\u0080-\\u00bf]',
    '\\u00e2\\u20ac',
    '\\u00f0\\u0178',
    '[\\ue000-\\uf8ff]',
  ].join('|'),
  'u',
);

function listRepositoryFiles() {
  return execFileSync(
    'git',
    [
      '-c',
      'core.excludesFile=',
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
    ],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  )
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function startsWith(buffer, prefix) {
  return (
    buffer.length >= prefix.length &&
    prefix.every((value, index) => buffer[index] === value)
  );
}

function inspectFile(relativePath) {
  const absolutePath = path.resolve(relativePath);
  const stat = fs.statSync(absolutePath);
  if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) return [];
  const buffer = fs.readFileSync(absolutePath);
  const findings = [];

  if (startsWith(buffer, UTF8_BOM)) findings.push('UTF-8 BOM');
  if (
    startsWith(buffer, UTF16_LE_BOM) ||
    startsWith(buffer, UTF16_BE_BOM)
  ) {
    findings.push('UTF-16 BOM');
  }
  if (buffer.includes(0)) return findings;

  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    findings.push('invalid UTF-8');
    return findings;
  }
  if (mojibakePattern.test(text)) findings.push('likely mojibake');
  return findings;
}

const findings = [];
for (const relativePath of listRepositoryFiles()) {
  try {
    for (const issue of inspectFile(relativePath)) {
      findings.push(`${relativePath}: ${issue}`);
    }
  } catch (error) {
    findings.push(`${relativePath}: could not inspect (${error.message})`);
  }
}

if (findings.length > 0) {
  console.error('Text encoding check failed:');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('Text encoding check passed.');
}
