import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCompletionTruncated,
  looksLikeTruncatedJson,
} from '../src/core/provider/completion-status.js';
import {
  buildInvalidToolArgumentsResult,
  runAgentLoop,
} from '../src/core/agent-loop.js';
import { normalizeToolArguments } from '../src/core/tool-schemas.js';
import { TOOL_DISPLAY_LABELS } from '../src/core/tool-display.js';

const BUILTIN_TOOL_NAMES = [
  ...Object.keys(TOOL_DISPLAY_LABELS),
  'save_memory',
  'list_memory',
  'search_memory',
  'forget_memory',
  'dream_consolidate',
  'request_user_input',
  'query_project_index',
  'mcp__demo__browser_navigate',
];

test('isCompletionTruncated recognizes length and max_tokens', () => {
  assert.equal(isCompletionTruncated('length'), true);
  assert.equal(isCompletionTruncated('max_tokens'), true);
  assert.equal(isCompletionTruncated('LENGTH'), true);
  assert.equal(isCompletionTruncated('stop'), false);
  assert.equal(isCompletionTruncated('tool_calls'), false);
  assert.equal(isCompletionTruncated(''), false);
});

test('looksLikeTruncatedJson detects unterminated/end-of-input cases', () => {
  assert.equal(
    looksLikeTruncatedJson('Unterminated string in JSON at position 12048', '{"content":"<html'),
    true,
  );
  assert.equal(looksLikeTruncatedJson('Unexpected end of JSON input', '{'), true);
  assert.equal(looksLikeTruncatedJson('Unexpected token }', '{"a":1}'), false);
  assert.equal(looksLikeTruncatedJson('', '{"path":"a","content":"hi'), true);
});

test('normalizeToolArguments preserves invalid JSON for every builtin-style tool', () => {
  const broken = '{"path":"a.html","content":"<html';
  for (const toolName of BUILTIN_TOOL_NAMES) {
    const normalized = normalizeToolArguments(
      toolName,
      {
        _raw: broken,
        _invalid_json: true,
        _parseError: 'Unterminated string in JSON at position 40',
      },
      broken,
    );
    assert.equal(normalized._invalid_json, true, toolName);
    assert.equal(normalized.command, undefined, toolName);
    assert.equal(normalized.content, undefined, toolName);
    assert.match(String(normalized._parseError || ''), /Unterminated string/, toolName);
  }
});

test('buildInvalidToolArgumentsResult marks truncated write with retry guidance', () => {
  const result = buildInvalidToolArgumentsResult('write', {
    _parseError: 'Unterminated string in JSON at position 12048',
    _raw: '{"path":"report.html","content":"<html',
    _truncated: true,
  });
  assert.equal(result.error, 'Truncated tool arguments for write');
  assert.equal(result.truncated, true);
  assert.match(result.reason, /max output tokens|incomplete/i);
  assert.match(result.suggestion, /skeleton|edit|chunk/i);
});

test('buildInvalidToolArgumentsResult covers large-payload tools with specific suggestions', () => {
  for (const toolName of [
    'create',
    'write',
    'write_chunk',
    'edit',
    'apply_patch',
    'run',
    'create_plan',
    'run_subagent',
    'fork_task',
    'update_plan',
    'create_spec',
    'tasks',
    'request_user_input',
    'save_memory',
    'add_code_comment',
    'update_code_comment',
  ]) {
    const truncated = buildInvalidToolArgumentsResult(toolName, {
      _parseError: 'Unterminated string in JSON at position 99',
      _raw: '{"payload":"',
      _truncated: true,
    });
    assert.equal(truncated.truncated, true, toolName);
    assert.match(truncated.error, new RegExp(`Truncated tool arguments for ${toolName}`), toolName);
    assert.ok(String(truncated.suggestion || '').length > 0, toolName);

    const invalid = buildInvalidToolArgumentsResult(toolName, {
      _parseError: 'Unexpected token',
      _raw: '{bad',
    });
    assert.match(invalid.error, new RegExp(`Invalid JSON arguments for ${toolName}`), toolName);
    assert.ok(String(invalid.suggestion || '').length > 0, toolName);
  }
});

test('buildInvalidToolArgumentsResult still hints run to write a file first', () => {
  const result = buildInvalidToolArgumentsResult('run', {
    _parseError: 'Unexpected token',
    _raw: '{"command":"}',
  });
  assert.equal(result.error, 'Invalid JSON arguments for run');
  assert.match(result.reason, /Write a file first/);
});

test('small tools get generic compact-json guidance when truncated', () => {
  const result = buildInvalidToolArgumentsResult('read', {
    _parseError: 'Unterminated string in JSON at position 12',
    _raw: '{"path":"',
    _truncated: true,
  });
  assert.equal(result.truncated, true);
  assert.match(result.suggestion, /compact JSON/i);
});

test('agent loop never executes syntactically valid arguments without a completion event', async () => {
  let completionIndex = 0;
  let handlerCalled = false;
  const requestCompletion = async () => {
    completionIndex += 1;
    if (completionIndex === 1) {
      return {
        text: '',
        toolCalls: [{
          id: 'call-incomplete',
          name: 'write',
          arguments: '{"path":"a.txt","content":"looks complete"}',
          argumentsComplete: false,
        }],
      };
    }
    return { text: 'recovered', toolCalls: [] };
  };

  const result = await runAgentLoop({
    systemPrompt: 'test',
    userPrompt: 'write a file',
    model: 'test-model',
    requestCompletion,
    toolHandlers: {
      write: async () => {
        handlerCalled = true;
        return { ok: true };
      },
    },
    toolDefinitions: [],
    approvalMode: 'full_access',
    skipAnalysisNudge: true,
    config: { memory: { enabled: false } },
  });

  assert.equal(handlerCalled, false);
  assert.equal(result.text, 'recovered');
  const toolResult = result.messages.find(
    (message) => message.role === 'tool' && message.tool_call_id === 'call-incomplete',
  );
  assert.match(toolResult.content, /Truncated tool arguments for write/);
});
