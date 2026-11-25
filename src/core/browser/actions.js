import {
  BROWSER_ACT_ACTIONS,
  BROWSER_ASSERT_STATES,
  BROWSER_DIAGNOSE_ACTIONS,
  BROWSER_INSPECT_ACTIONS,
  BROWSER_LIMITS,
} from './schema.js';
import { validateTarget } from './target.js';

export {
  BROWSER_ACT_ACTIONS,
  BROWSER_DIAGNOSE_ACTIONS,
  BROWSER_INSPECT_ACTIONS,
};

const TOOL_ACTIONS = Object.freeze({
  browser_inspect: BROWSER_INSPECT_ACTIONS,
  browser_act: BROWSER_ACT_ACTIONS,
  browser_diagnose: BROWSER_DIAGNOSE_ACTIONS,
});

const ACTION_NEEDS = Object.freeze({
  browser_inspect: {
    snapshot: { target: false },
    screenshot: { target: false },
    logs: { target: false },
    assert: { target: false },
    explain_style: { target: true },
    listeners: { target: true },
    locate_source: { target: true },
  },
  browser_act: {
    open: { target: false },
    navigate: { target: false, url: true },
    click: { target: true },
    type: { target: true, text: true },
    eval: { target: false, expression: true },
    close: { target: false },
  },
  browser_diagnose: {
    click: { target: true },
  },
});

function field(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasTarget(args = {}) {
  return Boolean(field(args.ref) || field(args.selector) || field(args.role) || field(args.name));
}

function targetPhrase() {
  return 'ref, selector, or role plus name';
}

function validExpectation(expectation) {
  if (!expectation || !BROWSER_ASSERT_STATES.includes(expectation.state)) return false;
  const { state, selector, value } = expectation;
  if (state === 'url_path') {
    return selector === undefined && typeof value === 'string' && value.length <= BROWSER_LIMITS.name
      && /^\/(?!\/)[^?#\s]*$/.test(value);
  }
  if (!field(selector) || selector.length > BROWSER_LIMITS.selector) return false;
  return state === 'text' ? Boolean(field(value)) && value.length <= BROWSER_LIMITS.name : value === undefined;
}

export function validateBrowserAction(tool, args = {}) {
  const allowed = TOOL_ACTIONS[tool];
  if (!allowed) {
    return { ok: false, code: 'INVALID_ARGUMENTS', error: `Unknown browser tool "${tool}".` };
  }
  const action = field(args.action);
  if (!action) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      error: `${tool} needs action. Actions: ${allowed.join(', ')}.`,
    };
  }
  if (!allowed.includes(action)) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      error: `${tool} action "${action}" is not one of: ${allowed.join(', ')}.`,
    };
  }
  const needs = ACTION_NEEDS[tool][action];
  const usesExpectation = (tool === 'browser_inspect' && action === 'assert') || tool === 'browser_diagnose';
  if ((action === 'assert' || args.expect !== undefined) && (!usesExpectation || !validExpectation(args.expect))) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      error: 'Use expect on assert or diagnose click: visible/hidden needs selector, text needs selector and value, url_path needs a pathname value.',
    };
  }
  const missing = [];
  if (needs.url && !field(args.url)) missing.push('url');
  if (needs.expression && !field(args.expression)) missing.push('expression');
  if (needs.text && !field(args.text) && args.clear !== true) missing.push('text (or clear:true)');
  if (needs.target && !hasTarget(args)) missing.push(targetPhrase());
  if (missing.length) {
    return {
      ok: false,
      code: 'INVALID_ARGUMENTS',
      error: `${tool} action "${action}" needs ${missing.join(' and ')}.`,
    };
  }
  if (needs.target || hasTarget(args)) {
    const target = validateTarget(args, { required: Boolean(needs.target) });
    if (!target.ok) {
      return { ok: false, code: target.code || 'INVALID_TARGET', error: target.error };
    }
  }
  return { ok: true, action, needs };
}
