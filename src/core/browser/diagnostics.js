import { INTERACTION_STYLE_PROPS } from './schema.js';
import { classifyDeclarations } from './cascade.js';
import { CSS_PATH_FN } from './snapshot.js';
import {
  createSourceResolver,
  displayPath,
  isLibraryPath,
  parseStackFrames,
  readLocalText,
  resolveMappedFile,
  workspaceSourcePath,
} from './sourcemap.js';

const CHAIN_FN = `function(selector) {
  const target = selector ? document.querySelector(selector) : null;
  const chain = [];
  let node = this && this.nodeType === 1 ? this : (this && this.parentElement);
  for (let i = 0; node && i < 8; i += 1) {
    const style = getComputedStyle(node);
    chain.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || '',
      className: String(node.className || '').slice(0, 80),
      pointerEvents: style.pointerEvents,
      zIndex: style.zIndex,
    });
    if (target && node === target) break;
    node = node.parentElement;
  }
  const targetStyle = target ? getComputedStyle(target) : null;
  return {
    chain,
    target: target ? {
      tag: target.tagName.toLowerCase(),
      id: target.id || '',
      className: String(target.className || '').slice(0, 80),
      pointerEvents: targetStyle.pointerEvents,
      disabled: target.matches(':disabled') || target.getAttribute('aria-disabled') === 'true',
    } : null,
    same: !!(target && (this === target)),
    containsTarget: !!(target && this && this.nodeType === 1 && (this === target || target.contains(this) || this.contains(target))),
  };
}`;

const FRAMEWORK_FN = `function() {
  const out = { react: [], vue: null };
  let el = this;
  for (let depth = 0; el && depth < 6; depth += 1, el = el.parentElement) {
    const keys = Object.keys(el);
    const fiberKey = keys.find((key) => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
    if (fiberKey && out.react.length === 0) {
      let fiber = el[fiberKey];
      const guard = new Set();
      while (fiber && guard.size < 16 && !guard.has(fiber)) {
        guard.add(fiber);
        const type = fiber.type;
        const name = typeof type === 'string' ? type : (type && (type.displayName || type.name)) || '';
        const source = fiber._debugSource || null;
        let stack = '';
        const debugStack = fiber._debugStack;
        if (typeof debugStack === 'string') stack = debugStack;
        else if (debugStack && typeof debugStack.stack === 'string') stack = debugStack.stack;
        const info = Array.isArray(fiber._debugInfo) ? fiber._debugInfo.slice(0, 6).map(summarize) : [];
        if (source || stack || info.length || (name && typeof type === 'function')) {
          out.react.push({
            name: name || '',
            fileName: source && source.fileName || '',
            lineNumber: source && source.lineNumber || 0,
            columnNumber: source && source.columnNumber || 0,
            stack: String(stack || '').slice(0, 2000),
            debugInfo: info.filter(Boolean),
          });
        }
        fiber = fiber.return || null;
      }
    }
    if (el.__vueParentComponent && !out.vue) {
      const type = el.__vueParentComponent.type || {};
      const vei = el._vei && typeof el._vei === 'object' ? Object.keys(el._vei).slice(0, 8) : [];
      out.vue = {
        name: type.name || type.__name || '',
        file: type.__file || '',
        vei,
      };
    }
  }
  return out;
  function summarize(info) {
    if (!info || typeof info !== 'object') return null;
    const stackValue = typeof info.debugStack === 'string'
      ? info.debugStack
      : (info.debugStack && info.debugStack.stack) || info.stack || '';
    const location = info.debugLocation || {};
    return {
      name: String(info.name || ''),
      fileName: String(location.fileName || info.fileName || ''),
      lineNumber: Number(location.lineNumber || info.lineNumber || 0),
      columnNumber: Number(location.columnNumber || info.columnNumber || 0),
      stack: String(stackValue || '').slice(0, 1500),
    };
  }
}`;

async function release(cdp, objectId) {
  if (!objectId) return;
  await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
}

async function objectForSelector(cdp, selector) {
  const evaluated = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector(${JSON.stringify(selector)})`,
    objectGroup: 'codemini-browser',
  });
  const objectId = evaluated?.result?.objectId || '';
  if (!objectId || evaluated?.result?.subtype === 'null') {
    await release(cdp, objectId);
    return '';
  }
  return objectId;
}

export async function backendForSelector(cdp, selector) {
  const objectId = await objectForSelector(cdp, selector);
  if (!objectId) return 0;
  try {
    const described = await cdp.send('DOM.describeNode', { objectId });
    return described?.node?.backendNodeId || 0;
  } finally {
    await release(cdp, objectId);
  }
}

async function nodeAt(cdp, x, y, ignorePointerEventsNone) {
  await cdp.send('DOM.getDocument', { depth: 0, pierce: true }).catch(() => {});
  const hit = await cdp.send('DOM.getNodeForLocation', {
    x: Math.round(x),
    y: Math.round(y),
    includeUserAgentShadowDOM: true,
    ignorePointerEventsNone: ignorePointerEventsNone === true,
  });
  return hit?.backendNodeId || 0;
}

async function inspectHit(cdp, backendNodeId, selector) {
  if (!backendNodeId) return null;
  const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
  const objectId = resolved?.object?.objectId || '';
  if (!objectId) return null;
  try {
    const called = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: CHAIN_FN,
      arguments: [{ value: selector }],
      returnByValue: true,
    });
    return called?.result?.value || null;
  } finally {
    await release(cdp, objectId);
  }
}

export async function hitTest(page, cdp, selector) {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    return { visible: false, reason: 'not-visible', occluded: false, chain: [], top: null, target: null };
  }
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const topId = await nodeAt(cdp, x, y, false);
  const ignoredId = await nodeAt(cdp, x, y, true);
  const targetId = await backendForSelector(cdp, selector);
  const top = await inspectHit(cdp, topId, selector);
  const ignored = ignoredId && ignoredId !== topId ? await inspectHit(cdp, ignoredId, selector) : null;
  const target = top?.target || ignored?.target || null;
  let reason = 'none';
  if (!target) reason = 'missing';
  else if (target.disabled) reason = 'disabled';
  else if (target.pointerEvents === 'none' || (ignored?.same && !top?.same)) reason = 'pointer-events-none';
  else if (top && !top.same && !top.containsTarget) reason = 'occluded';
  else if (top && !top.same) reason = 'child-hit';
  return {
    visible: true,
    x,
    y,
    reason,
    occluded: reason === 'occluded',
    top: top?.chain?.[0] || null,
    target,
    chain: top?.chain || [],
    ignoredPointerEvents: ignored?.chain?.[0] || null,
  };
}

async function nodeIdForBackend(cdp, backendNodeId) {
  const pushed = await cdp.send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] });
  return pushed?.nodeIds?.[0] || 0;
}

export async function explainStyle(cdp, backendNodeId, properties, maxRules) {
  await cdp.send('DOM.getDocument', { depth: 0 }).catch(() => {});
  await cdp.send('CSS.enable').catch(() => {});
  const nodeId = await nodeIdForBackend(cdp, backendNodeId);
  if (!nodeId) return { computed: {}, winning: [], overridden: [] };
  const computedResult = await cdp.send('CSS.getComputedStyleForNode', { nodeId });
  const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  const wanted = properties.length ? properties : [...INTERACTION_STYLE_PROPS];
  const computed = {};
  for (const item of computedResult?.computedStyle || []) {
    if (wanted.includes(item.name)) computed[item.name] = item.value;
  }
  const classified = classifyDeclarations(matched, wanted);
  return {
    computed,
    winning: classified.winning.slice(0, maxRules),
    overridden: classified.overridden.slice(0, maxRules),
  };
}

function locationValue(internal) {
  const value = internal?.value;
  if (!value) return null;
  if (value.value && typeof value.value === 'object') return value.value;
  const description = String(value.description || '');
  const match = description.match(/scriptId["']?:\s*["']?(\d+)/);
  if (!match) return null;
  return null;
}

export async function listListeners(cdp, session, backendNodeId, { types = [], maxListeners = 20 } = {}) {
  const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
  const objectId = resolved?.object?.objectId || '';
  if (!objectId) return [];
  try {
    const result = await cdp.send('DOMDebugger.getEventListeners', { objectId });
    const listeners = Array.isArray(result?.listeners) ? result.listeners : [];
    const filtered = listeners.filter((listener) => !types.length || types.includes(listener.type)).slice(0, maxListeners);
    const resolver = session.sourceResolver();
    const output = [];
    for (const listener of filtered) {
      let scriptId = listener.scriptId || '';
      let line = Number(listener.lineNumber || 0);
      let column = Number(listener.columnNumber || 0);
      if (listener.handler?.objectId) {
        try {
          const properties = await cdp.send('Runtime.getProperties', {
            objectId: listener.handler.objectId,
            generatePreview: false,
          });
          const internal = (properties.internalProperties || []).find((item) => item.name === '[[FunctionLocation]]');
          const value = internal?.value?.value;
          if (value && typeof value === 'object' && value.scriptId) {
            scriptId = String(value.scriptId);
            line = Number(value.lineNumber || 0);
            column = Number(value.columnNumber || 0);
          } else {
            locationValue(internal);
          }
        } catch {
          // The listener's own script location is enough.
        }
      }
      const location = scriptId
        ? await resolver.locate({ scriptId, line, column, oneBased: false })
        : null;
      output.push({
        type: listener.type,
        capture: listener.useCapture === true,
        passive: listener.passive === true,
        once: listener.once === true,
        location,
      });
    }
    return output;
  } finally {
    await release(cdp, objectId);
  }
}

function pushLocation(locations, seen, location, extra) {
  if (!location?.file || isLibraryPath(location.file)) return;
  const key = `${extra.framework}|${location.file}|${location.line}|${location.column}`;
  if (seen.has(key)) return;
  seen.add(key);
  locations.push({
    framework: extra.framework,
    component: extra.component || location.name || '',
    file: location.file,
    line: location.line || null,
    column: location.column ?? null,
    ...(location.workspaceSource ? { workspaceSource: location.workspaceSource } : {}),
  });
}

export async function locateSource(cdp, session, selector) {
  const objectId = await objectForSelector(cdp, selector);
  if (!objectId) return [];
  let framework;
  try {
    const called = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: FRAMEWORK_FN,
      returnByValue: true,
    });
    framework = called?.result?.value || { react: [], vue: null };
  } finally {
    await release(cdp, objectId);
  }
  const resolver = session.sourceResolver();
  const locations = [];
  const seen = new Set();
  const workspaceRoot = session.workspaceRoot;

  if (framework.vue?.file) {
    const file = resolveMappedFile(framework.vue.file, { workspaceRoot });
    pushLocation(locations, seen, {
      file: displayPath(file, workspaceRoot),
      workspaceSource: workspaceSourcePath(file, workspaceRoot),
      line: null,
      column: null,
    }, { framework: 'vue', component: framework.vue.name || '' });
  }

  for (const fiber of framework.react || []) {
    if (fiber.fileName) {
      const file = resolveMappedFile(fiber.fileName, { workspaceRoot });
      pushLocation(locations, seen, {
        file: displayPath(file, workspaceRoot),
        workspaceSource: workspaceSourcePath(file, workspaceRoot),
        line: fiber.lineNumber || null,
        column: fiber.columnNumber ?? null,
        name: fiber.name,
      }, { framework: 'react', component: fiber.name });
    }
    const stacks = [fiber.stack, ...(fiber.debugInfo || []).map((item) => item.stack)].filter(Boolean);
    for (const stack of stacks) {
      for (const frame of parseStackFrames(stack)) {
        if (isLibraryPath(frame.url) || isLibraryPath(frame.name)) continue;
        const script = session.scriptByUrl(frame.url);
        const located = script
          ? await resolver.locate({ scriptId: script.scriptId, line: frame.line, column: frame.column, oneBased: true })
          : await resolver.locate({ url: frame.url, line: frame.line, column: frame.column, oneBased: true });
        if (located && !isLibraryPath(located.file)) {
          pushLocation(locations, seen, { ...located, name: frame.name || fiber.name }, {
            framework: 'react',
            component: fiber.name || frame.name || '',
          });
        } else if (/\.(jsx|tsx|vue)(?:$|\?)/.test(frame.url)) {
          const file = resolveMappedFile(frame.url, { workspaceRoot });
          pushLocation(locations, seen, {
            file: displayPath(file, workspaceRoot),
            line: frame.line,
            column: frame.column,
          }, { framework: 'react', component: fiber.name || frame.name || '' });
        }
      }
    }
  }

  if (locations.length === 0) {
    const backendNodeId = await backendForSelector(cdp, selector);
    if (backendNodeId) {
      const listeners = await listListeners(cdp, session, backendNodeId, { maxListeners: 5 });
      for (const listener of listeners) {
        pushLocation(locations, seen, listener.location, { framework: 'dom', component: listener.type });
      }
    }
  }
  const workspaceLocations = locations.filter((location) => location.workspaceSource);
  return (workspaceLocations.length ? workspaceLocations : locations).slice(0, 8);
}

export async function probeClick(page, locator, { timeout, observeMs }) {
  const bucket = { console: [], exceptions: [], network: [] };
  const onConsole = (message) => {
    if (bucket.console.length >= 10) return;
    bucket.console.push({ level: message.type(), text: message.text().slice(0, 240) });
  };
  const onError = (error) => {
    if (bucket.exceptions.length >= 8) return;
    bucket.exceptions.push({ text: String(error?.message || error).slice(0, 300) });
  };
  const onRequest = (request) => {
    const type = request.resourceType();
    if (type !== 'fetch' && type !== 'xhr') return;
    if (bucket.network.length >= 10) return;
    bucket.network.push({ method: request.method(), url: request.url().slice(0, 200) });
  };
  page.on('console', onConsole);
  page.on('pageerror', onError);
  page.on('request', onRequest);
  await locator.evaluate(() => {
    window.__codeminiMutations = [];
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (window.__codeminiMutations.length >= 20) return;
        window.__codeminiMutations.push({
          type: record.type,
          target: record.target && record.target.nodeName,
          added: record.addedNodes.length,
          removed: record.removedNodes.length,
          attribute: record.attributeName || '',
        });
      }
    });
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true, characterData: true });
    window.__codeminiObserver = observer;
  }).catch(() => {});

  let click = { ok: true };
  try {
    await locator.click({ timeout });
  } catch (error) {
    const message = String(error?.message || error).split('\n')[0].slice(0, 300);
    click = {
      ok: false,
      code: /timeout/i.test(message) ? 'TIMEOUT' : 'TARGET_NOT_ACTIONABLE',
      error: message,
    };
  }
  await new Promise((resolve) => setTimeout(resolve, observeMs));
  const mutations = await page.evaluate(() => {
    const list = window.__codeminiMutations || [];
    if (window.__codeminiObserver) window.__codeminiObserver.disconnect();
    delete window.__codeminiObserver;
    delete window.__codeminiMutations;
    return list;
  }).catch(() => []);
  page.off('console', onConsole);
  page.off('pageerror', onError);
  page.off('request', onRequest);
  return { click, console: bucket.console, exceptions: bucket.exceptions, network: bucket.network, mutations };
}

export function sourceResolverFor(session) {
  const getScript = (scriptId) => session.scripts.get(scriptId) || null;
  getScript.all = () => [...session.scripts.values()];
  return createSourceResolver({
    workspaceRoot: session.workspaceRoot,
    getScript,
    readText: (url) => readLocalText(url, session.workspaceRoot),
  });
}

export { CSS_PATH_FN };
