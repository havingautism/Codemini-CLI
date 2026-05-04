import { h, clear, escapeHtml } from '../utils/dom.js';

let overlayEl = null;
let onOpenCallback = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'project-overlay hidden';
  document.body.appendChild(overlayEl);
  return overlayEl;
}

export function initProjectSelector(callback) {
  onOpenCallback = callback;
  const trigger = document.getElementById('project-indicator');
  if (trigger) {
    trigger.style.cursor = 'pointer';
    trigger.addEventListener('click', () => openProjectModal());
  }
}

export function updateProjectDisplay(cwd) {
  const display = document.getElementById('project-path-display');
  if (display) display.textContent = cwd?.split(/[/\\]/).pop() || cwd || '...';
  const trigger = document.getElementById('project-indicator');
  if (trigger) trigger.title = cwd || '';
}

async function openProjectModal() {
  const overlay = ensureOverlay();
  overlay.classList.remove('hidden');
  clear(overlay);

  const dialog = h('div', { className: 'project-dialog' });
  dialog.appendChild(h('div', { className: 'project-dialog-header' },
    h('span', {}, 'Open Project'),
    h('button', { className: 'project-dialog-close', onClick: () => overlay.classList.add('hidden') }, '×')
  ));

  const pathInput = h('input', { className: 'project-path-input', placeholder: 'Enter or browse to project path...', id: 'modal-project-path' });
  const openBtn = h('button', { className: 'btn-primary', onClick: () => {
    const p = pathInput.value.trim();
    if (p && onOpenCallback) { overlay.classList.add('hidden'); onOpenCallback(p); }
  }}, 'Open');

  const pathBar = h('div', { className: 'project-path-bar' }, pathInput, openBtn);
  dialog.appendChild(pathBar);

  const browserEl = h('div', { className: 'project-browser-content' });
  dialog.appendChild(browserEl);

  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

  // Load current cwd
  try {
    const res = await fetch('/api/project');
    const data = await res.json();
    pathInput.value = data.cwd || '';
    await browseDir(browserEl, data.cwd || '/');
  } catch {}
}

async function browseDir(container, dir) {
  try {
    const res = await fetch('/api/project/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir })
    });
    const data = await res.json();
    renderDirList(container, data);
  } catch {}
}

function renderDirList(container, data) {
  clear(container);
  const currentPath = data.path || '';
  const normalized = currentPath.replace(/\\/g, '/');
  const isAbsolute = normalized.startsWith('/');
  const parts = normalized.split('/').filter(Boolean);

  // Breadcrumb
  const breadcrumb = h('div', { className: 'dir-breadcrumb' });
  for (let i = 0; i < parts.length; i++) {
    if (i > 0) breadcrumb.appendChild(h('span', { style: { color: 'var(--text-muted)' } }, ' / '));
    const segPath = (isAbsolute ? '/' : '') + parts.slice(0, i + 1).join('/');
    const seg = h('a', {
      href: '#',
      style: { color: i === parts.length - 1 ? 'var(--text-primary)' : 'var(--accent-blue)', textDecoration: 'none', cursor: 'pointer' }
    }, parts[i]);
    seg.addEventListener('click', (e) => { e.preventDefault(); browseDir(container, segPath); });
    breadcrumb.appendChild(seg);
  }
  container.appendChild(breadcrumb);

  const listEl = h('div', { className: 'dir-list' });

  // Parent
  if (parts.length > 0) {
    const parentPath = (isAbsolute ? '/' : '') + parts.slice(0, -1).join('/');
    const parentItem = h('div', { className: 'dir-item' },
      h('span', { className: 'dir-icon' }, '↑'),
      h('span', {}, '..')
    );
    parentItem.addEventListener('click', () => browseDir(container, parentPath));
    listEl.appendChild(parentItem);
  }

  for (const d of (data.dirs || [])) {
    const item = h('div', { className: 'dir-item' },
      h('span', { className: 'dir-icon' }, '📁'),
      h('span', {}, escapeHtml(d.name)),
      d.isGit ? h('span', { className: 'dir-git' }, 'git') : null
    );
    item.addEventListener('click', () => {
      document.getElementById('modal-project-path').value = d.path;
      browseDir(container, d.path);
    });
    listEl.appendChild(item);
  }

  if (!(data.dirs || []).length && !data.error) {
    listEl.appendChild(h('div', { style: { padding: '12px', color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center' } }, 'No subdirectories'));
  }

  container.appendChild(listEl);
}
