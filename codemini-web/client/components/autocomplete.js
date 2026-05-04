import { h } from '../utils/dom.js';

export function createAutocomplete(container, { onSelect }) {
  container.className = 'autocomplete hidden';
  let items = [];
  let selected = -1;

  function show(options) {
    items = options || [];
    selected = -1;
    if (!items.length) { hide(); return; }
    container.innerHTML = '';
    items.forEach((opt, i) => {
      const el = h('div', { className: 'ac-item', dataset: { index: i },
        onClick: () => { onSelect(opt); hide(); }
      },
        h('span', { className: 'ac-cmd' }, opt.value || opt.name),
        h('span', { className: 'ac-desc' }, opt.description || '')
      );
      container.appendChild(el);
    });
    container.classList.remove('hidden');
  }

  function hide() {
    container.classList.add('hidden');
    items = [];
    selected = -1;
  }

  function navigate(dir) {
    if (!items.length) return;
    const prev = container.querySelector('.ac-item.selected');
    if (prev) prev.classList.remove('selected');
    selected = dir === 'down' ? Math.min(selected + 1, items.length - 1) : Math.max(selected - 1, 0);
    const next = container.children[selected];
    if (next) {
      next.classList.add('selected');
      next.scrollIntoView({ block: 'nearest' });
    }
  }

  function getSelected() {
    return selected >= 0 ? items[selected] : null;
  }

  return { show, hide, navigate, getSelected };
}
