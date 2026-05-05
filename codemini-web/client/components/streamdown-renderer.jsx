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
    <Streamdown
      parseIncompleteMarkdown
      lineNumbers={false}
      controls={{
        table: { copy: true, download: true, fullscreen: false },
        code: { copy: true, download: false },
        mermaid: { copy: true, download: false, fullscreen: false, panZoom: true }
      }}
    >
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
