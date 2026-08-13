import path from 'node:path';
import { discoverSkillHooks } from './skill-hooks-discover.js';
import { armSkillHooks, listArmedHandlers, matcherAllows } from './skill-hooks-session.js';
import { runCommandHook } from './skill-hooks-runner.js';

export function resolveSkillRoot(command) {
  if (!command) return '';
  const rootPath = command.metadata?.rootPath;
  if (rootPath) return String(rootPath);
  return command.path ? path.dirname(command.path) : '';
}

/**
 * Discovers hooks on disk for a loaded skill command and arms them on the
 * given skillHooksSession. No-op (returns null) when the command has no
 * resolvable root or defines no hooks.
 */
export async function armSkillFromCommand(
  session,
  command,
  { discoverSkillHooksFn = discoverSkillHooks, packageRoot = null } = {},
) {
  const name = String(command?.name || '').trim();
  if (!session || !name) return null;
  const skillRoot = resolveSkillRoot(command);
  if (!skillRoot) return null;

  const discovered = await discoverSkillHooksFn({ skillRoot, packageRoot }).catch(() => null);
  if (!discovered || !discovered.hooks || Object.keys(discovered.hooks).length === 0) return null;

  armSkillHooks(session, {
    name,
    hooks: discovered.hooks,
    provenance: discovered.provenance,
    pluginRoot: skillRoot,
  });

  return { skillRoot, hooks: discovered.hooks, provenance: discovered.provenance };
}

/**
 * Runs every armed handler for a given hook event, aggregating additionalContext
 * strings and short-circuiting (without running remaining handlers) on the first
 * `deny` decision. Pure aside from `runCommandHookFn` / `onAgentEvent` side effects,
 * so tests can inject a fake `runCommandHookFn` to avoid spawning real processes.
 */
export async function fireSkillHookEvent({
  session,
  eventName,
  input = {},
  toolName,
  skillName,
  workspaceRoot = '',
  runCommandHookFn = runCommandHook,
  onAgentEvent,
} = {}) {
  const contexts = [];
  const ran = [];
  let updatedInput;
  let decision = 'allow';
  if (!session || !eventName) return { ok: true, denied: false, contexts, ran };

  const handlers = listArmedHandlers(session, eventName)
    .filter((entry) => !skillName || entry.skillName === skillName)
    .filter((entry) => toolName === undefined ? true : matcherAllows(entry.matcher, toolName));

  for (const entry of handlers) {
    const { skillName, handler, pluginRoot, matcher, source } = entry;
    const command = String(handler?.command || '').trim();
    if (!command) continue;

    const env = {
      CLAUDE_PROJECT_DIR: workspaceRoot || '',
      CLAUDE_PLUGIN_ROOT: pluginRoot || workspaceRoot || '',
    };

    const displayName =
      source === 'project' || skillName === '__project__'
        ? 'workspace'
        : source === 'package'
          ? String(entry.provenance?.packageName || 'package').trim() || 'package'
          : skillName;
    const resolvedSource = source || (skillName === '__project__' ? 'project' : 'skill');
    const summaryParts = [eventName];
    if (toolName) summaryParts.push(String(toolName));
    else if (matcher) summaryParts.push(String(matcher));
    const summary = `${summaryParts.join(' · ')} ← ${displayName}`;
    // Keep start/end/error fields aligned so UI match keys (event::label::tool) stay stable.
    const hookEventBase = {
      event: eventName,
      skillName,
      source: resolvedSource,
      name: displayName,
      command,
      matcher: matcher || '',
      toolName: toolName || '',
      summary,
      startedAt: new Date().toISOString(),
    };

    if (typeof onAgentEvent === 'function') {
      onAgentEvent({ type: 'hook:start', ...hookEventBase });
    }

    let result;
    try {
      result = await runCommandHookFn({
        command,
        timeout: handler.timeout,
        failClosed: Boolean(handler.failClosed),
        input: { hook_event_name: eventName, ...input },
        env,
        cwd: workspaceRoot || undefined,
      });
    } catch (error) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:error',
          ...hookEventBase,
          endedAt: new Date().toISOString(),
          error: String(error?.message || error || 'Hook command failed'),
        });
      }
      continue;
    }

    if (!result?.ok && result?.failClosed) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          ...hookEventBase,
          endedAt: new Date().toISOString(),
          ok: false,
          decision: 'deny',
          reason: result.reason,
        });
      }
      return {
        ok: false,
        denied: true,
        contexts,
        ran,
        updatedInput,
        reason: result.reason || `Blocked because the "${displayName}" hook failed closed.`,
      };
    }

    if (!result?.ok) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          ...hookEventBase,
          endedAt: new Date().toISOString(),
          ok: false,
          reason: result.reason,
        });
      }
      continue;
    }

    if (result.additionalContext) contexts.push(String(result.additionalContext));
    if (['allow', 'ask', 'defer'].includes(result.decision)) decision = result.decision;
    if (result.updatedInput && typeof result.updatedInput === 'object') {
      updatedInput = result.updatedInput;
    }

    const ranEntry = {
      name: displayName,
      source: resolvedSource,
      decision: result.decision || 'allow',
    };

    if (result.continue === false || result.decision === 'deny' || (eventName === 'Stop' && result.decision === 'block')) {
      ran.push({ ...ranEntry, decision: result.decision === 'block' ? 'block' : 'deny' });
      const blockReason = result.stopReason || result.reason || result.systemMessage || `Blocked by "${displayName}" hook.`;
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          ...hookEventBase,
          endedAt: new Date().toISOString(),
          decision: result.decision === 'block' ? 'block' : 'deny',
          reason: blockReason,
        });
      }
      return {
        ok: true,
        denied: true,
        contexts,
        ran,
        updatedInput,
        reason: blockReason,
      };
    }

    ran.push(ranEntry);
    if (typeof onAgentEvent === 'function') {
      onAgentEvent({
        type: 'hook:end',
        ...hookEventBase,
        endedAt: new Date().toISOString(),
        decision: result.decision || 'allow',
      });
    }
  }

  return { ok: true, denied: false, contexts, ran, updatedInput, decision };
}

/** Lines injected into tool results / prompts so the model can see which hooks ran. */
export function formatHookContextLines(hookResult, eventName, toolName = '') {
  const lines = [];
  const toolPart = toolName ? ` · ${toolName}` : '';
  for (const item of Array.isArray(hookResult?.ran) ? hookResult.ran : []) {
    const name = String(item?.name || '').trim() || 'hook';
    const decision = String(item?.decision || 'allow').trim() || 'allow';
    lines.push(`[Hook] ${eventName}${toolPart} ← ${name} (${decision})`);
  }
  for (const context of Array.isArray(hookResult?.contexts) ? hookResult.contexts : []) {
    const text = String(context || '').trim();
    if (text) lines.push(text);
  }
  return lines;
}

/** Drop queued SessionStart UI rows for arms that are no longer active after a mode switch. */
export function pruneSessionStartUiEvents(events, armedSkillNames) {
  const armed = new Set(
    (Array.isArray(armedSkillNames) ? armedSkillNames : [...(armedSkillNames || [])])
      .map((name) => String(name || '').trim())
      .filter(Boolean),
  );
  return (Array.isArray(events) ? events : []).filter(
    (event) => !event?.skillName || armed.has(String(event.skillName)),
  );
}

/**
 * After coding↔daily activation changes: drop stale SessionStart UI, rebuild contexts
 * from arms that still apply, and only queue UI for newly armed arms.
 */
export async function reconcileSessionStartAfterActivationChange({
  skillHooksSession,
  sessionStartUiEvents,
  sessionStartCompleted = false,
  previouslyArmed = [],
  workspaceRoot = '',
  fireSkillHookEventFn = fireSkillHookEvent,
} = {}) {
  const armedNames = [...(skillHooksSession?.activeSkills?.keys?.() || [])];
  const previously = previouslyArmed instanceof Set
    ? previouslyArmed
    : new Set(previouslyArmed || []);
  const newlyArmed = new Set(armedNames.filter((name) => !previously.has(name)));

  if (Array.isArray(sessionStartUiEvents)) {
    const kept = pruneSessionStartUiEvents(sessionStartUiEvents, armedNames);
    sessionStartUiEvents.length = 0;
    sessionStartUiEvents.push(...kept);
  }

  if (!sessionStartCompleted || !skillHooksSession) {
    return { newlyArmed: [...newlyArmed] };
  }

  const rebuild = await fireSkillHookEventFn({
    session: skillHooksSession,
    eventName: 'SessionStart',
    input: { source: 'startup' },
    workspaceRoot,
    onAgentEvent: (event) => {
      if (!newlyArmed.has(event?.skillName)) return;
      if (
        event?.type === 'hook:start'
        || event?.type === 'hook:end'
        || event?.type === 'hook:error'
      ) {
        sessionStartUiEvents?.push?.(event);
      }
    },
  });
  skillHooksSession.sessionStartContexts = formatHookContextLines(rebuild, 'SessionStart');
  return { newlyArmed: [...newlyArmed] };
}
