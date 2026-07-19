import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvalidToolArgumentsResult } from '../src/core/agent-loop.js';
import { normalizeToolArguments } from '../src/core/tool-schemas.js';

const agentLoopSource = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/core/agent-loop.js'),
  'utf8',
);

test('agent loop rejects invalid JSON for every tool, including run', () => {
  assert.match(agentLoopSource, /if \(args\?\._invalid_json\) \{/);
  assert.doesNotMatch(
    agentLoopSource,
    /args\?\._invalid_json && \['create', 'write', 'edit', 'apply_patch', 'delete'\]/,
  );
});

test('normalizeToolArguments preserves invalid JSON marker for run', () => {
  const normalized = normalizeToolArguments(
    'run',
    {
      _raw: '{"command":"echo hi',
      _invalid_json: true,
      _parseError: 'Unterminated string in JSON at position 18',
    },
    '{"command":"echo hi',
  );
  assert.equal(normalized._invalid_json, true);
  assert.match(normalized._parseError, /Unterminated string/);
  assert.equal(normalized.command, undefined);
});

test('buildInvalidToolArgumentsResult tells run to write a file first', () => {
  const result = buildInvalidToolArgumentsResult('run', {
    _parseError: 'Unterminated string in JSON at position 12048',
    _raw: '{"command":"cd ...',
  });
  assert.equal(result.error, 'Invalid JSON arguments for run');
  assert.match(result.reason, /Unterminated string/);
  assert.match(result.reason, /Write a file first/);
  assert.match(result.suggestion, /powershell -File|script file/i);
});

test('buildInvalidToolArgumentsResult keeps a generic hint for other tools', () => {
  const result = buildInvalidToolArgumentsResult('edit', {
    _parseError: 'Unexpected end of JSON input',
  });
  assert.equal(result.error, 'Invalid JSON arguments for edit');
  assert.match(result.reason, /compact JSON/);
});
