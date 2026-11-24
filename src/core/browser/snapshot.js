const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox',
  'switch', 'tab', 'menuitem', 'option', 'slider', 'listitem', 'treeitem',
  'spinbutton', 'menuitemcheckbox', 'menuitemradio',
]);

const SKIP_ROLES = new Set(['none', 'generic', 'InlineTextBox', 'LineBreak', 'ignored']);

export const CSS_PATH_FN = `function() {
  if (!this || this.nodeType !== 1) return '';
  if (this.id && /^[A-Za-z][\\w-]*$/.test(this.id)) return '#' + CSS.escape(this.id);
  const parts = [];
  let node = this;
  while (node && node.nodeType === 1 && node !== document.documentElement) {
    let index = 1;
    let sibling = node;
    while ((sibling = sibling.previousElementSibling)) {
      if (sibling.tagName === node.tagName) index += 1;
    }
    parts.unshift(node.tagName.toLowerCase() + ':nth-of-type(' + index + ')');
    if (parts.length > 8) break;
    node = node.parentElement;
  }
  return parts.join(' > ');
}`;

function roleOf(node) {
  return String(node?.role?.value || node?.role || '');
}

export function axNodeName(node) {
  const raw = node?.name;
  let value = '';
  if (typeof raw === 'string' || typeof raw === 'number') {
    value = String(raw);
  } else if (raw && typeof raw === 'object') {
    const inner = raw.value;
    if (typeof inner === 'string' || typeof inner === 'number') value = String(inner);
  }
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

function nameOf(node) {
  return axNodeName(node);
}

function flagsOf(node) {
  const flags = [];
  for (const property of node?.properties || []) {
    const key = property?.name;
    const value = property?.value?.value;
    if (key === 'disabled' && value) flags.push('disabled');
    if ((key === 'checked' || key === 'pressed') && (value === true || value === 'true' || value === 'mixed')) flags.push(key);
    if (key === 'expanded' && value === true) flags.push('expanded');
  }
  return flags;
}

async function selectorFor(cdp, backendNodeId) {
  if (!backendNodeId) return '';
  let objectId = '';
  try {
    const resolved = await cdp.send('DOM.resolveNode', { backendNodeId });
    objectId = resolved?.object?.objectId || '';
    if (!objectId) return '';
    const called = await cdp.send('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: CSS_PATH_FN,
      returnByValue: true,
    });
    return String(called?.result?.value || '');
  } catch {
    return '';
  } finally {
    if (objectId) {
      await cdp.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
  }
}

async function mapPool(items, limit, fn) {
  const output = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      output[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return output;
}

export async function captureSnapshot(cdp, session, { interactiveOnly = false } = {}) {
  await cdp.send('Accessibility.enable').catch(() => {});
  const tree = await cdp.send('Accessibility.getFullAXTree', { depth: -1 });
  const nodes = Array.isArray(tree?.nodes) ? tree.nodes : [];
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const childIds = new Set();
  for (const node of nodes) {
    for (const childId of node.childIds || []) childIds.add(childId);
  }
  const roots = nodes.filter((node) => !childIds.has(node.nodeId));
  const root = roots.find((node) => roleOf(node) === 'RootWebArea') || roots[0] || nodes[0];
  const records = [];
  let truncated = false;

  function walk(nodeId, depth) {
    if (truncated || records.length >= 200) {
      truncated = true;
      return;
    }
    const node = byId.get(nodeId);
    if (!node) return;
    const role = roleOf(node);
    const name = nameOf(node);
    const parent = byId.get(node.parentId);
    const skipText = role === 'StaticText' && INTERACTIVE_ROLES.has(roleOf(parent)) && nameOf(parent) === name;
    const printable = role
      && !SKIP_ROLES.has(role)
      && !node.ignored
      && !skipText
      && !(interactiveOnly && !INTERACTIVE_ROLES.has(role) && role !== 'heading');
    if (printable) {
      records.push({
        depth: Math.min(depth, 8),
        role,
        name,
        flags: flagsOf(node),
        interactive: INTERACTIVE_ROLES.has(role) || role === 'heading',
        backendNodeId: node.backendDOMNodeId || 0,
      });
    }
    for (const childId of node.childIds || []) walk(childId, printable ? depth + 1 : depth);
  }

  if (root) walk(root.nodeId, 0);
  const needsSelector = records.filter((record) => record.interactive && record.backendNodeId).slice(0, 80);
  const selectors = await mapPool(needsSelector, 6, (record) => selectorFor(cdp, record.backendNodeId));
  const selectorByNode = new Map();
  needsSelector.forEach((record, index) => {
    if (selectors[index]) selectorByNode.set(record, selectors[index]);
  });

  session.roleCounts = new Map();
  session.refs.clear();
  const lines = [];
  const refs = [];
  for (const record of records) {
    const selector = selectorByNode.get(record) || '';
    let ref = '';
    if (selector) {
      const nthKey = `${record.role}\0${record.name}`;
      const nth = (session.roleCounts.get(nthKey) || 0) + 1;
      session.roleCounts.set(nthKey, nth);
      const key = `${nthKey}\0${nth}`;
      ref = session.refKeys.get(key);
      if (!ref) {
        ref = `@e${session.nextRef}`;
        session.nextRef += 1;
        session.refKeys.set(key, ref);
      }
      const stored = { ref, role: record.role, name: record.name, selector };
      refs.push(stored);
      session.refs.set(ref, stored);
    }
    const indent = '  '.repeat(record.depth);
    const label = `${record.role}${record.name ? ` ${JSON.stringify(record.name)}` : ''}${record.flags.length ? ` ${record.flags.join(' ')}` : ''}`;
    lines.push(`${indent}${ref ? `${ref} ` : ''}${label}`.trimEnd());
  }
  if (truncated) lines.push('[snapshot truncated at 200 lines]');
  return { lines, refs, truncated };
}
