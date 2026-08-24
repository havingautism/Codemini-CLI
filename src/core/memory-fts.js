import { segmentSearchText } from './memory-policy.js';

export const MEMORY_FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    id UNINDEXED,
    search_text,
    raw_content UNINDEXED,
    tool_name UNINDEXED,
    tokenize = 'unicode61'
  );
`;

export function memoryFtsRow(item = {}) {
  const rawContent = String(item.content || '');
  const rawText = [item.summary, rawContent].filter(Boolean).join(' ');
  if (!rawText) return null;
  return {
    id: item.id,
    searchText: segmentSearchText(rawText),
    rawContent,
    toolName: String(item.toolName ?? item.tool_name ?? '')
  };
}

export function insertMemoryFtsRow(statement, item) {
  const row = memoryFtsRow(item);
  if (!row) return false;
  statement.run(row.id, row.searchText, row.rawContent, row.toolName);
  return true;
}
