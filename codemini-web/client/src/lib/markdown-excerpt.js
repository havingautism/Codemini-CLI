import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { gfm } from 'micromark-extension-gfm';

const options = {
  extensions: [gfm()],
  mdastExtensions: [gfmFromMarkdown()],
};
const inlineContainers = new Set([
  'paragraph', 'heading', 'emphasis', 'strong', 'delete',
  'link', 'linkReference', 'tableCell',
]);

function nodeText(node) {
  switch (node.type) {
    case 'definition':
    case 'footnoteDefinition':
    case 'footnoteReference':
    case 'html':
    case 'thematicBreak':
      return '';
    case 'break':
      return ' ';
    case 'image':
    case 'imageReference':
      return node.alt || '';
    case 'text':
    case 'inlineCode':
    case 'code':
      return node.value || '';
    default:
      return (node.children || [])
        .map(nodeText)
        .join(inlineContainers.has(node.type) ? '' : ' ');
  }
}

/** Readable, non-interactive text for compact previews; never renders HTML. */
export function markdownExcerpt(value) {
  const source = String(value ?? '').trim();
  if (!source) return '';
  return nodeText(fromMarkdown(source, options)).replace(/\s+/g, ' ').trim();
}
