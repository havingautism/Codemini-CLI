import { createElement, icons } from 'lucide';

export function icon(name, { size = 18, strokeWidth = 1.8, className = '' } = {}) {
  const definition = icons[name] || icons.Circle;
  const node = createElement(definition, {
    width: size,
    height: size,
    'stroke-width': strokeWidth,
    'aria-hidden': 'true',
    focusable: 'false'
  });
  if (className) node.classList.add(...className.split(/\s+/).filter(Boolean));
  return node;
}
