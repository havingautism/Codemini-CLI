import { normalizeToolArguments } from './tool-schemas.js';
import { formatToolDisplayName } from './tool-display.js';
import { looksLikeTruncatedJson } from './provider/completion-status.js';
import { createToolRegistry, ToolArgumentsError } from './tool-registry.js';
import { isShellToolName } from './shell-tool-name.js';

const LARGE_PAYLOAD_TOOLS = new Set([
  'create', 'write', 'write_chunk', 'edit', 'apply_patch', 'run', 'Bash', 'Powershell',
  'create_plan', 'run_subagent', 'update_plan', 'create_spec',
  'update_todos', 'request_user_input', 'save_memory',
  'add_code_comment', 'update_code_comment',
]);

function normalizeToolName(name) {
  return String(name || '').trim();
}

function safeJsonParse(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {
      _raw: String(raw),
      _invalid_json: true,
      _parseError: error.message,
    };
  }
}

function formatArgumentIssues(error) {
  return error.issues.map((issue) => {
    const issuePath = Array.isArray(issue?.path) && issue.path.length > 0
      ? ` at ${issue.path.join('.')}`
      : '';
    return `${String(issue?.message || 'invalid value')}${issuePath}`;
  });
}

function suggestionForInvalidToolArgs(toolName, { truncated = false } = {}) {
  const name = normalizeToolName(toolName) || 'tool';
  if (truncated) {
    if (isShellToolName(name)) return 'write a script file in small chunks, then run a short command such as powershell -File path.ps1';
    if (name === 'apply_patch' || name === 'edit') return 'apply smaller hunks across multiple tool calls';
    if (name === 'create' || name === 'write') return 'use begin_write, smaller sequential write_chunk calls, then commit_write';
    if (name === 'write_chunk') return 'retry the same sequence with a smaller content chunk';
    if (LARGE_PAYLOAD_TOOLS.has(name)) return 'split the payload across multiple smaller tool calls';
    return 'retry with compact JSON arguments';
  }
  if (isShellToolName(name)) return 'create/edit a script file, then run a short command';
  if (LARGE_PAYLOAD_TOOLS.has(name)) return 'keep arguments compact; move large text into files via smaller writes/edits';
  return 'fix JSON escaping and keep arguments compact';
}

export function buildInvalidToolArgumentsResult(toolName, args = {}) {
  const parseError = String(args?._parseError || '').trim();
  const name = normalizeToolName(toolName) || 'tool';
  const schemaIssues = Array.isArray(args?._schemaIssues)
    ? args._schemaIssues.map((issue) => String(issue || '').trim()).filter(Boolean)
    : [];
  if (args?._invalid_schema === true) {
    return {
      error: `Invalid arguments for ${name}`,
      reason: schemaIssues.length > 0
        ? `Tool arguments did not match the declared schema: ${schemaIssues.join('; ')}`
        : 'Tool arguments did not match the declared schema.',
      suggestion: 'provide every required field with the declared value type',
    };
  }

  const truncated = args?._truncated === true || looksLikeTruncatedJson(parseError, args?._raw);
  const suggestion = suggestionForInvalidToolArgs(name, { truncated });
  if (truncated) {
    const writeHint = LARGE_PAYLOAD_TOOLS.has(name)
      ? ' The model output was cut off before the tool JSON finished. Do not retry the same giant payload. Use smaller chunks across multiple tool calls.'
      : ' The model output was cut off before the tool JSON finished. Retry with smaller arguments.';
    return {
      error: `Truncated tool arguments for ${name}`,
      reason: (parseError
        ? `Tool call JSON was incomplete (likely max output tokens): ${parseError}`
        : 'Tool call JSON was incomplete (likely max output tokens).') + writeHint,
      truncated: true,
      suggestion,
      raw: String(args?._raw || ''),
    };
  }

  const hint = isShellToolName(name)
    ? ` Do not embed large scripts or file contents in ${name} arguments. Write a file first (create/edit), then run a short command such as \`powershell -File path.ps1\`.`
    : LARGE_PAYLOAD_TOOLS.has(name)
      ? ' Keep this tool\'s arguments compact. Prefer multiple smaller calls over one huge JSON payload.'
      : ' Retry with valid, compact JSON arguments.';
  return {
    error: `Invalid JSON arguments for ${name}`,
    reason: (parseError
      ? `Tool arguments could not be parsed as JSON: ${parseError}`
      : 'Tool arguments could not be parsed as JSON') + hint,
    suggestion,
    raw: String(args?._raw || ''),
  };
}

function resolveMaxParallelCalls(value) {
  const parsed = Number(value ?? 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 10;
}

async function mapWithConcurrencyLimit(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(items.length, Math.max(1, limit)) },
    () => runWorker(),
  ));
  return results;
}

export class ToolRuntime {
  constructor({ registry, maxParallelCalls = 10 }) {
    this._registry = registry;
    this._maxParallelCalls = resolveMaxParallelCalls(maxParallelCalls);
    this._activeDefinitions = registry.definitions();
    this._activeNames = new Set(
      this._activeDefinitions.map((tool) => normalizeToolName(tool?.function?.name)).filter(Boolean),
    );
    this._legacyHandlerOnly = this._activeNames.size === 0;
  }

  definitions() {
    return [...this._activeDefinitions];
  }

  beginModelResponse(toolCalls, { completionTruncated = false } = {}) {
    const visibleNames = new Set(
      this._legacyHandlerOnly ? this._registry.availableNames() : this._activeNames,
    );
    const calls = toolCalls.map((call) => {
      const toolName = normalizeToolName(call?.name);
      let args;
      try {
        if (call?.argumentsComplete === false) {
          args = {
            _raw: String(call.arguments || ''),
            _invalid_json: true,
            _parseError: 'Tool argument stream ended before its completion event',
            _truncated: true,
          };
        } else {
          args = normalizeToolArguments(toolName, safeJsonParse(call?.arguments), call?.arguments);
          const invalid = this.invalidArguments(toolName, args);
          if (!args?._invalid_json && invalid) args = invalid;
        }
      } catch (error) {
        args = {
          _invalid_json: true,
          _raw: String(call?.arguments || ''),
          _parseError: error?.message || 'Failed to normalize tool arguments',
          _truncated: call?.argumentsComplete === false
            || completionTruncated
            || looksLikeTruncatedJson(error?.message, call?.arguments),
        };
      }
      if (args?._invalid_json) {
        args._truncated = args._truncated === true
          || completionTruncated
          || looksLikeTruncatedJson(args._parseError, args._raw);
      }
      return {
        call,
        args,
        toolName,
        displayName: formatToolDisplayName(toolName, args, { displayLabels: this._registry.displayLabels() }),
        isParallelSafe: this._registry.isConcurrencySafe(toolName, args),
        isModelVisible: visibleNames.has(toolName),
      };
    });
    return { calls, visibleNames: [...visibleNames] };
  }

  invalidArguments(name, args) {
    try {
      this._registry.validateArguments(name, args);
      return null;
    } catch (error) {
      if (!(error instanceof ToolArgumentsError)) throw error;
      return { _invalid_schema: true, _schemaIssues: formatArgumentIssues(error) };
    }
  }

  has(name) {
    return typeof this._registry.getHandler(name) === 'function';
  }

  displayName(name, args) {
    return formatToolDisplayName(name, args, { displayLabels: this._registry.displayLabels() });
  }

  async prepareApproval(name, args) {
    const prepare = this._registry.getHandler(name)?.prepareApproval;
    return typeof prepare === 'function' ? prepare(args) : undefined;
  }

  execute(name, args, context = {}) {
    return this._registry.execute(name, args, context);
  }

  format(name, result, args) {
    return this._registry.format(name, result, args);
  }

  activateSchemas(schemas = []) {
    const activated = [];
    for (const schema of Array.isArray(schemas) ? schemas : []) {
      const name = normalizeToolName(schema?.function?.name);
      const spec = this._registry.get(name);
      if (!name || spec?.exposure !== 'deferred' || this._activeNames.has(name)) continue;
      this._activeNames.add(name);
      this._activeDefinitions.push(spec.definition);
      activated.push(spec.definition);
    }
    return activated;
  }

  async executeOrdered(calls, { canRunConcurrently, execute }) {
    const results = [];
    let parallelBatch = [];
    const flush = async () => {
      if (parallelBatch.length === 0) return;
      results.push(...await mapWithConcurrencyLimit(parallelBatch, this._maxParallelCalls, execute));
      parallelBatch = [];
    };
    for (const call of calls) {
      if (call.isParallelSafe && canRunConcurrently(call)) {
        parallelBatch.push(call);
        continue;
      }
      await flush();
      results.push(await execute(call));
    }
    await flush();
    return results;
  }
}

export function createToolRuntime({
  toolRegistry,
  definitions,
  handlers,
  formatters,
  deferredDefinitions,
  displayLabels,
  metadata,
  maxParallelCalls,
} = {}) {
  const registry = toolRegistry || createToolRegistry({
    definitions,
    handlers,
    formatters,
    deferredDefinitions,
    displayLabels,
    metadata,
  });
  return new ToolRuntime({ registry, maxParallelCalls });
}
