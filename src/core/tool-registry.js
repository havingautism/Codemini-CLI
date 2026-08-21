import { z } from 'zod';

const DEFAULT_CONCURRENT_TOOLS = new Set([
  'read', 'search_code', 'grep', 'ast_grep', 'glob', 'list',
  'ast_query', 'read_ast_node',
  'web_fetch', 'web_search',
  'list_background_tasks', 'get_background_task',
  'read_plan', 'tasks', 'tasks',
  'query_project_index', 'tool_search',
  'skill',
  // Subagents isolate their own session/context and return compact results
  // plus declared file changes, so same-response calls run in parallel by
  // default (no read-only tools list required). depends_on still orders
  // workers that must wait for an upstream result; the coordinator resolves
  // those promises regardless of scheduling.
  'run_subagent',
  // Fork branches inherit a frozen prefix and return only a compact result,
  // so several fork_task calls in one response run concurrently.
  'fork_task',
]);

export class ToolRegistryContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolRegistryContractError';
    this.code = 'TOOL_REGISTRY_CONTRACT';
  }
}

export class ToolArgumentsError extends Error {
  constructor(toolName, issues = []) {
    const detail = issues
      .map((issue) => {
        const path = Array.isArray(issue?.path) && issue.path.length > 0
          ? ` at ${issue.path.join('.')}`
          : '';
        return `${String(issue?.message || 'invalid value')}${path}`;
      })
      .join('; ');
    super(`Invalid arguments for ${toolName}${detail ? `: ${detail}` : ''}`);
    this.name = 'ToolArgumentsError';
    this.code = 'INVALID_TOOL_ARGUMENTS';
    this.toolName = toolName;
    this.issues = issues;
  }
}

function definitionName(definition) {
  return String(definition?.function?.name || definition?.name || '').trim();
}

function definitionParameters(definition) {
  return definition?.function?.parameters
    || definition?.parameters
    || { type: 'object', properties: {} };
}

// Tool schemas are identical across turns/platforms, and zod compile is far
// more expensive than stringifying the parameters, so cache compiled
// validators keyed by the canonical parameter JSON.
const validatorCache = new Map();

function compileValidator(name, definition) {
  const key = JSON.stringify(definitionParameters(definition));
  const cached = validatorCache.get(key);
  if (cached) return cached;
  let validator;
  try {
    validator = z.fromJSONSchema(definitionParameters(definition));
  } catch (error) {
    throw new ToolRegistryContractError(
      `Tool "${name}" has an invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  validatorCache.set(key, validator);
  return validator;
}

function defaultConcurrencyClassifier(name) {
  if (DEFAULT_CONCURRENT_TOOLS.has(name)) return () => true;
  return () => false;
}

function normalizeMetadata(name, metadata = {}) {
  const classifier = typeof metadata?.isConcurrencySafe === 'function'
    ? metadata.isConcurrencySafe
    : metadata?.isConcurrencySafe === true
      ? () => true
      : metadata?.isConcurrencySafe === false
        ? () => false
        : defaultConcurrencyClassifier(name);
  return Object.freeze({
    isConcurrencySafe: classifier,
  });
}

/**
 * Deep execution module compiled from the current provider-shaped tool bundle.
 * Definitions may be active, deferred, or host-only (test/legacy handlers).
 */
export class ToolRegistry {
  constructor({
    definitions = [],
    handlers = {},
    formatters = {},
    deferredDefinitions = {},
    displayLabels = {},
    metadata = {},
  } = {}) {
    this._definitions = [...(Array.isArray(definitions) ? definitions : [])];
    this._deferredDefinitions = { ...(deferredDefinitions || {}) };
    this._handlers = { ...(handlers || {}) };
    this._formatters = { ...(formatters || {}) };
    this._displayLabels = { ...(displayLabels || {}) };
    this._specs = new Map();

    for (const definition of this._definitions) {
      this._registerDefinition(definition, 'active', metadata);
    }
    for (const [catalogName, definition] of Object.entries(this._deferredDefinitions)) {
      const name = definitionName(definition);
      if (name !== catalogName) {
        throw new ToolRegistryContractError(
          `Deferred tool catalog key "${catalogName}" does not match definition name "${name || '(missing)'}"`,
        );
      }
      this._registerDefinition(definition, 'deferred', metadata);
    }

    // Tests and legacy callers sometimes provide executable host tools without
    // exposing them to the model. Keep those callable but schema-less.
    for (const [name, handler] of Object.entries(this._handlers)) {
      if (this._specs.has(name)) continue;
      if (typeof handler !== 'function') {
        throw new ToolRegistryContractError(`Tool handler "${name}" must be a function`);
      }
      this._specs.set(name, Object.freeze({
        name,
        exposure: 'host-only',
        handler,
        formatter: typeof this._formatters[name] === 'function' ? this._formatters[name] : null,
        displayLabel: this._displayLabels[name],
        validator: null,
        metadata: normalizeMetadata(name, metadata?.[name]),
      }));
    }
  }

  _registerDefinition(definition, exposure, metadata) {
    const name = definitionName(definition);
    if (!name) throw new ToolRegistryContractError(`${exposure} tool definition is missing a name`);
    if (this._specs.has(name)) {
      throw new ToolRegistryContractError(`Duplicate tool definition: "${name}"`);
    }
    const handler = this._handlers[name];
    if (typeof handler !== 'function') {
      throw new ToolRegistryContractError(`Tool "${name}" is ${exposure} but has no handler`);
    }
    this._specs.set(name, Object.freeze({
      name,
      exposure,
      definition,
      handler,
      formatter: typeof this._formatters[name] === 'function' ? this._formatters[name] : null,
      displayLabel: this._displayLabels[name],
      validator: compileValidator(name, definition),
      metadata: normalizeMetadata(name, metadata?.[name]),
    }));
  }

  definitions() {
    return [...this._definitions];
  }

  deferredDefinitions() {
    return { ...this._deferredDefinitions };
  }

  displayLabels() {
    return { ...this._displayLabels };
  }

  get(name) {
    return this._specs.get(String(name || '').trim());
  }

  getHandler(name) {
    return this.get(name)?.handler;
  }

  getDisplayLabel(name) {
    return this.get(name)?.displayLabel;
  }

  availableNames() {
    return [...this._specs.keys()];
  }

  validateArguments(name, args) {
    const spec = this.get(name);
    if (!spec) return args;
    if (!spec.validator) return args;
    const result = spec.validator.safeParse(args);
    if (!result.success) throw new ToolArgumentsError(spec.name, result.error.issues);
    return args;
  }

  isConcurrencySafe(name, args = {}) {
    const spec = this.get(name);
    if (!spec) return false;
    try {
      this.validateArguments(name, args);
      return spec.metadata.isConcurrencySafe(args) === true;
    } catch {
      return false;
    }
  }

  format(name, result, args) {
    const formatter = this.get(name)?.formatter;
    return formatter ? formatter(result, args) : undefined;
  }

  async execute(name, args, context = {}) {
    const spec = this.get(name);
    if (!spec) {
      throw new Error(`Unknown tool: "${name}"`);
    }
    this.validateArguments(name, args);
    return spec.handler(args, Object.freeze({ ...context }));
  }
}

export function createToolRegistry(options = {}) {
  return new ToolRegistry(options);
}
