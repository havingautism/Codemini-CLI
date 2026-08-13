import { isPackageHooksArmName } from './hook-profiles.js';
import {
  canonicalToolName,
  rewriteMatcherAliases,
  toolNameCandidates,
} from './skill-hooks-tool-aliases.js';

export const PROJECT_HOOKS_SKILL_NAME = '__project__';

/** Stable stack order: workspace → package → skill (matches Claude layering). */
const HANDLER_SOURCE_ORDER = {
  project: 1,
  package: 2,
  skill: 3,
};

function handlerSourceForArmName(skillName) {
  if (skillName === PROJECT_HOOKS_SKILL_NAME) return 'project';
  if (isPackageHooksArmName(skillName)) return 'package';
  return 'skill';
}

export function createSkillHooksSession() {
  return {
    activeSkills: new Map(),
    sessionStartContexts: [],
  };
}

export function armSkillHooks(session, skillEntry) {
  const name = String(skillEntry?.name || '').trim();
  if (!name) return;

  session.activeSkills.set(name, {
    hooks: skillEntry.hooks ?? {},
    provenance: skillEntry.provenance ?? {},
    packageKey: skillEntry.packageKey,
    pluginRoot: skillEntry.pluginRoot,
  });
}

export function disarmSkillHooks(session, skillName) {
  session.activeSkills.delete(String(skillName || '').trim());
}

export function listArmedHandlers(session, eventName) {
  const handlers = [];

  for (const [skillName, entry] of session.activeSkills) {
    const groups = entry.hooks?.[eventName];
    if (!Array.isArray(groups)) continue;

    for (const group of groups) {
      const matcher = group?.matcher;
      const groupHandlers = Array.isArray(group?.hooks) ? group.hooks : [];

      for (const handler of groupHandlers) {
        handlers.push({
          skillName,
          matcher,
          handler,
          pluginRoot: entry.pluginRoot,
          provenance: entry.provenance?.[eventName],
          source: handlerSourceForArmName(skillName),
        });
      }
    }
  }

  handlers.sort(
    (a, b) =>
      (HANDLER_SOURCE_ORDER[a.source] ?? 99) - (HANDLER_SOURCE_ORDER[b.source] ?? 99),
  );
  return handlers;
}

export function matcherAllows(matcher, toolName) {
  if (!matcher) return true;
  const pattern = String(matcher);
  const candidates = toolNameCandidates(toolName);
  if (candidates.length === 0) return false;

  const rewritten = rewriteMatcherAliases(pattern);
  try {
    const re = new RegExp(rewritten);
    if (candidates.some((candidate) => re.test(candidate))) return true;
  } catch {
    // fall through to canonical compare
  }

  try {
    const re = new RegExp(pattern);
    if (candidates.some((candidate) => re.test(candidate))) return true;
  } catch {
    // ignore invalid regex
  }

  const matcherCanon = canonicalToolName(pattern);
  return candidates.some(
    (candidate) =>
      candidate === pattern ||
      canonicalToolName(candidate) === matcherCanon,
  );
}
