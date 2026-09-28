export const DOCUMENT_EXTENSIONS = Object.freeze([
  '.pdf',
  '.doc',
  '.docx',
  '.ppt',
  '.pptx',
  '.xls',
  '.xlsx',
]);

export const SCRAPBOOK_TEXT_EXTENSIONS = Object.freeze([
  '.txt',
  '.md',
  '.markdown',
]);

export const DOCUMENT_ACCEPT = DOCUMENT_EXTENSIONS.join(',');
export const SCRAPBOOK_ACCEPT = [
  ...DOCUMENT_EXTENSIONS,
  ...SCRAPBOOK_TEXT_EXTENSIONS,
].join(',');
