export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'className') { el.className = val; continue; }
      if (key === 'dataset') { Object.assign(el.dataset, val); continue; }
      if (key.startsWith('on')) { el.addEventListener(key.slice(2).toLowerCase(), val); continue; }
      if (key === 'style' && typeof val === 'object') { Object.assign(el.style, val); continue; }
      el.setAttribute(key, val);
    }
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    if (typeof child === 'string' || typeof child === 'number') {
      el.appendChild(document.createTextNode(String(child)));
    } else if (child instanceof Node) {
      el.appendChild(child);
    }
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function toggleClass(el, cls, force) {
  el.classList.toggle(cls, force);
}

export function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (c) => map[c]);
}

export function $(sel, parent = document) {
  return parent.querySelector(sel);
}

export function $$(sel, parent = document) {
  return Array.from(parent.querySelectorAll(sel));
}
