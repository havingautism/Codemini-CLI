import { HOOK_EVENTS, HOOK_SOURCE_PRIORITY } from './skill-hooks-constants.js';

function normalizeHandler(handler) {
  if (!handler || typeof handler !== 'object') return null;
  if (handler.type && handler.type !== 'command') return null;
  const command = String(handler.command || '').trim();
  if (!command) return null;
  return {
    type: 'command',
    command,
    timeout: Number.isFinite(Number(handler.timeout)) ? Number(handler.timeout) : 30,
    failClosed: handler.failClosed === true,
  };
}

function normalizeMatcherGroup(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const hooks = (Array.isArray(entry.hooks) ? entry.hooks : [])
    .map(normalizeHandler)
    .filter(Boolean);
  if (hooks.length === 0) return null;
  return {
    matcher: entry.matcher == null ? undefined : String(entry.matcher),
    hooks,
  };
}

/** Unwrap Claude/plugin `{ hooks: { SessionStart: ... } }` when present. */
export function unwrapHooksContainer(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const nested = parsed.hooks;
  if (
    nested &&
    typeof nested === 'object' &&
    !Array.isArray(nested) &&
    Object.keys(nested).some((key) => HOOK_EVENTS.has(key))
  ) {
    return nested;
  }
  return parsed;
}

export function normalizeHooksObject(raw = {}) {
  const body = unwrapHooksContainer(raw);
  const out = {};
  for (const [eventName, groups] of Object.entries(body || {})) {
    if (!HOOK_EVENTS.has(eventName)) continue;
    const list = (Array.isArray(groups) ? groups : [])
      .map(normalizeMatcherGroup)
      .filter(Boolean);
    if (list.length) out[eventName] = list;
  }
  return out;
}

export function resolveHooksByPriority(candidates = [], { adoptSettings = false } = {}) {
  const byEvent = new Map();
  const sorted = [...candidates]
    .filter((c) => c && c.source)
    .filter((c) => adoptSettings || c.source !== 'settings')
    .sort(
      (a, b) =>
        (HOOK_SOURCE_PRIORITY[a.source] ?? 99) - (HOOK_SOURCE_PRIORITY[b.source] ?? 99),
    );

  for (const candidate of sorted) {
    const normalized = normalizeHooksObject(candidate.hooks);
    for (const [eventName, groups] of Object.entries(normalized)) {
      if (byEvent.has(eventName)) continue;
      byEvent.set(eventName, {
        groups,
        source: candidate.source,
        priority: HOOK_SOURCE_PRIORITY[candidate.source],
      });
    }
  }

  const hooks = {};
  const provenance = {};
  for (const [eventName, info] of byEvent) {
    hooks[eventName] = info.groups;
    provenance[eventName] = { source: info.source, priority: info.priority };
  }
  return { hooks, provenance };
}
