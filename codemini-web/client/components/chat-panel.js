import { h, clear } from '../utils/dom.js';

export function createChatPanel(container) {
  container.className = 'chat-panel';
  let autoScroll = true;

  container.addEventListener('scroll', () => {
    const threshold = 80;
    autoScroll = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
  });

  return {
    append(el) {
      container.appendChild(el);
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
    },
    get autoScroll() { return autoScroll; }
  };
}
