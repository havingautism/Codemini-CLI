import { escapeHtml } from '../utils/sanitize.js';

const CODE_FENCE = /^```(\w*)\n?/;
const CODE_FENCE_END = /^```\s*$/;

export function renderMarkdown(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  let inCode = false;
  let codeLang = '';
  let codeLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inCode) {
      if (CODE_FENCE_END.test(line.trim())) {
        out.push(renderCodeBlock(codeLines.join('\n'), codeLang));
        inCode = false;
        codeLines = [];
        codeLang = '';
      } else {
        codeLines.push(line);
      }
      continue;
    }

    const fenceMatch = line.match(CODE_FENCE);
    if (fenceMatch) {
      inCode = true;
      codeLang = fenceMatch[1] || '';
      continue;
    }

    out.push(renderInlineLine(line));
  }

  if (inCode) out.push(renderCodeBlock(codeLines.join('\n'), codeLang));

  let html = out.join('\n');
  html = html.replace(/<\/(ul|ol)>\n<(ul|ol)>/g, '');
  html = html.replace(/<\/p>\n<p>/g, '</p>\n<p>');
  return html;
}

function renderInlineLine(line) {
  if (!line.trim()) return '';

  // Headings
  const hMatch = line.match(/^(#{1,3})\s+(.+)/);
  if (hMatch) {
    const level = hMatch[1].length;
    return `<h${level}>${inlineFormat(hMatch[2])}</h${level}>`;
  }

  // Table row
  if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
    const cells = line.split('|').filter((_, i, arr) => i > 0 && i < arr.length - 1).map(c => c.trim());
    if (cells.every(c => /^[-:]+$/.test(c))) return '';
    const tag = 'td';
    return `<tr>${cells.map(c => `<${tag}>${inlineFormat(c)}</${tag}>`).join('')}</tr>`;
  }

  // Blockquote
  if (line.startsWith('> ')) {
    return `<blockquote>${inlineFormat(line.slice(2))}</blockquote>`;
  }

  // Unordered list
  if (/^[-*]\s+/.test(line)) {
    return `<ul><li>${inlineFormat(line.replace(/^[-*]\s+/, ''))}</li></ul>`;
  }

  // Ordered list
  const olMatch = line.match(/^\d+\.\s+(.+)/);
  if (olMatch) {
    return `<ol><li>${inlineFormat(olMatch[1])}</li></ol>`;
  }

  // Horizontal rule
  if (/^[-*_]{3,}\s*$/.test(line.trim())) {
    return '<hr>';
  }

  // Paragraph
  return `<p>${inlineFormat(line)}</p>`;
}

function inlineFormat(text) {
  if (!text) return '';
  // Inline code
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return text;
}

function renderCodeBlock(code, lang) {
  const escaped = escapeHtml(code);
  const langLabel = lang || 'text';
  const langClass = lang ? `language-${lang}` : '';
  return `<div class="code-block"><div class="code-header"><span>${escapeHtml(langLabel)}</span><button class="code-copy" onclick="navigator.clipboard.writeText(this.closest('.code-block').querySelector('code').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)">Copy</button></div><pre><code class="${langClass}">${escaped}</code></pre></div>`;
}
