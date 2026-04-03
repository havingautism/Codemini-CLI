import { classifyCommandIntent } from '../../core/shell.js';

export function parseToolDisplayName(name) {
  const raw = String(name || '').trim();
  const match = raw.match(/^([^(]+)\((.*)\)$/);
  return {
    raw,
    base: match ? match[1] : raw,
    target: match ? match[2] : ''
  };
}

export function trimText(text, max = 72) {
  const value = String(text || '').trim();
  if (!value) return '';
  return value.length > max ? `${value.slice(0, Math.max(0, max - 3)).trimEnd()}...` : value;
}

export function makeBlocked(copy, target) {
  return `${copy.toolActivity.blocked}: ${target}`;
}

export function makePhase(copy, doneLabel, doingLabel, target) {
  return target ? `${doneLabel}: ${target}` : doneLabel || doingLabel;
}

export function classifyRunIntent(target) {
  return classifyCommandIntent(target);
}
