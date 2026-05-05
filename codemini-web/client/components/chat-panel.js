import { h, clear } from '../utils/dom.js';

export function createChatPanel(container) {
  container.className = 'chat-panel';
  let autoScroll = true;
  const emptyState = document.getElementById('empty-state');

  function syncEmptyState() {
    if (emptyState) emptyState.classList.toggle('hidden', container.children.length > 0);
  }

  container.addEventListener('scroll', () => {
    const threshold = 80;
    autoScroll = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  });

  return {
    append(el) {
      container.appendChild(el);
      syncEmptyState();
      if (autoScroll) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    },
    scrollToBottom() {
      requestAnimationFrame(() => {
        container.scrollTop = container.scrollHeight;
      });
    },
    clear() {
      clear(container);
      syncEmptyState();
    },
    get autoScroll() { return autoScroll; }
  };
}
