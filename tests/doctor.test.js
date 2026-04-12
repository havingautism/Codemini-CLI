import test from 'node:test';
import assert from 'node:assert/strict';

import { handleDoctor } from '../src/commands/doctor.js';

function createConfig() {
  return {
    gateway: {
      base_url: 'http://127.0.0.1:8000/v1',
      api_key: 'token'
    }
  };
}

test('doctor reports fff-mcp availability when installed', async () => {
  const lines = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await handleDoctor({
      loadConfigFn: async () => createConfig(),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async (name) => name === 'fff-mcp',
      writeLine: (line) => lines.push(line)
    });
    assert.ok(lines.some((line) => /\[OK\] FFF MCP availability: found fff-mcp/.test(line)));
  } finally {
    process.exitCode = previousExitCode;
  }
});

test('doctor fails when fff-mcp is not available', async () => {
  const lines = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await handleDoctor({
      loadConfigFn: async () => createConfig(),
      checkPathWritableFn: async () => true,
      checkGatewayFn: async () => ({ ok: true, reason: 'reachable' }),
      commandExistsFn: async () => false,
      writeLine: (line) => lines.push(line)
    });
    assert.ok(lines.some((line) => /\[FAIL\] FFF MCP availability: fff-mcp not found in PATH/.test(line)));
    assert.equal(process.exitCode, 1);
  } finally {
    process.exitCode = previousExitCode;
  }
});
