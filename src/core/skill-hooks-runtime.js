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
  let updatedInput;
  let decision = 'allow';
  if (!session || !eventName) return { ok: true, denied: false, contexts };

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
    const summaryParts = [eventName];
    if (toolName) summaryParts.push(String(toolName));
    else if (matcher) summaryParts.push(String(matcher));
    const summary = `${summaryParts.join(' · ')} ← ${displayName}`;

    if (typeof onAgentEvent === 'function') {
      onAgentEvent({
        type: 'hook:start',
        event: eventName,
        skillName,
        source: source || (skillName === '__project__' ? 'project' : 'skill'),
        name: displayName,
        command,
        matcher: matcher || '',
        toolName: toolName || '',
        summary,
      });
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
          event: eventName,
          skillName,
          name: displayName,
          summary,
          error: String(error?.message || error || 'Hook command failed'),
        });
      }
      continue;
    }

    if (!result?.ok && result?.failClosed) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          event: eventName,
          skillName,
          name: displayName,
          summary,
          ok: false,
          decision: 'deny',
          reason: result.reason,
        });
      }
      return {
        ok: false,
        denied: true,
        contexts,
        updatedInput,
        reason: result.reason || `Blocked because the "${displayName}" hook failed closed.`,
      };
    }

    if (!result?.ok) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          event: eventName,
          skillName,
          name: displayName,
          summary,
          ok: false,
        });
      }
      continue;
    }

    if (result.additionalContext) contexts.push(String(result.additionalContext));
    if (['allow', 'ask', 'defer'].includes(result.decision)) decision = result.decision;
    if (result.updatedInput && typeof result.updatedInput === 'object') {
      updatedInput = result.updatedInput;
    }

    if (result.continue === false || result.decision === 'deny' || (eventName === 'Stop' && result.decision === 'block')) {
      if (typeof onAgentEvent === 'function') {
        onAgentEvent({
          type: 'hook:end',
          event: eventName,
          skillName,
          name: displayName,
          summary,
          decision: result.decision === 'block' ? 'block' : 'deny',
        });
      }
      return {
        ok: true,
        denied: true,
        contexts,
        updatedInput,
        reason: result.stopReason || result.reason || result.systemMessage || `Blocked by "${displayName}" hook.`,
      };
    }

    if (typeof onAgentEvent === 'function') {
      onAgentEvent({
        type: 'hook:end',
        event: eventName,
        skillName,
        name: displayName,
        summary,
        decision: result.decision || 'allow',
      });
    }
  }

  return { ok: true, denied: false, contexts, updatedInput, decision };
}
