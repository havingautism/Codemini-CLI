export function highlightCodeBlocks(container) {
  if (typeof Prism === 'undefined') return;
  const blocks = container.querySelectorAll('pre code:not([data-highlighted])');
  blocks.forEach((block) => {
    Prism.highlightElement(block);
    block.setAttribute('data-highlighted', 'true');
  });
}
