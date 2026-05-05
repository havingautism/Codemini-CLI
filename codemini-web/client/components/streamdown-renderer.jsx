import React from 'react';
import { createRoot } from 'react-dom/client';
import { Streamdown } from 'streamdown';

const roots = new WeakMap();

export function renderStreamdown(container, text, { streaming = false } = {}) {
  if (!container) return;
  let root = roots.get(container);
  if (!root) {
    root = createRoot(container);
    roots.set(container, root);
  }
  container.classList.toggle('streaming-cursor', streaming);
  root.render(
    <Streamdown parseIncompleteMarkdown>
      {text || ''}
    </Streamdown>
  );
}

export function clearStreamdown(container) {
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}
