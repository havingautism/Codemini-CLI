import path from 'node:path';
import { getProjectDatabase, transaction } from './sqlite-database.js';

const indexCache = new Map();

function cacheKey(projectRoot) {
  return path.resolve(String(projectRoot || ''));
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

export function loadProjectIndexFromSqlite(projectRoot) {
  const key = cacheKey(projectRoot);
  const db = getProjectDatabase(projectRoot);
  const updatedAt = parseJson(
    db.prepare("SELECT payload_json FROM project_metadata WHERE key = 'updated_at'").get()?.payload_json,
    ''
  );
  const cached = indexCache.get(key);
  if (cached && cached.updatedAt === updatedAt && updatedAt) return cached.value;

  const projectMapRow = db.prepare("SELECT payload_json FROM project_metadata WHERE key = 'project_map'").get();
  if (!projectMapRow) return null;
  const files = db.prepare('SELECT payload_json FROM indexed_files ORDER BY file').all()
    .map((row) => parseJson(row.payload_json, null)).filter(Boolean);
  if (!files.length) return null;
  const value = {
    projectMap: parseJson(projectMapRow.payload_json, null),
    fileIndex: { updatedAt, files }
  };
  if (updatedAt) indexCache.set(key, { updatedAt, value });
  return value;
}

export function saveProjectIndexToSqlite(projectRoot, { projectMap = null, fileIndex }) {
  const db = getProjectDatabase(projectRoot);
  const files = Array.isArray(fileIndex?.files) ? fileIndex.files : [];
  transaction(db, () => {
    const putMeta = db.prepare(`
      INSERT INTO project_metadata(key, payload_json) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET payload_json = excluded.payload_json
      WHERE project_metadata.payload_json <> excluded.payload_json
    `);
    if (projectMap) putMeta.run('project_map', JSON.stringify(projectMap));
    putMeta.run('updated_at', JSON.stringify(fileIndex?.updatedAt || new Date().toISOString()));

    const upsertFile = db.prepare(`
      INSERT INTO indexed_files(file, language, size, mtime_ms, payload_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file) DO UPDATE SET
        language = excluded.language, size = excluded.size,
        mtime_ms = excluded.mtime_ms, payload_json = excluded.payload_json
      WHERE indexed_files.payload_json <> excluded.payload_json
    `);
    const deleteSymbols = db.prepare('DELETE FROM indexed_symbols WHERE file = ?');
    const insertSymbol = db.prepare(`
      INSERT INTO indexed_symbols(symbol_id, file, name, kind, start_line, end_line, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const allocatedSymbolIds = new Set(
      db.prepare('SELECT symbol_id FROM indexed_symbols').all().map((row) => row.symbol_id)
    );
    const selectFileSymbolIds = db.prepare('SELECT symbol_id FROM indexed_symbols WHERE file = ?');
    db.exec('CREATE TEMP TABLE IF NOT EXISTS current_index_files(file TEXT PRIMARY KEY) WITHOUT ROWID');
    db.exec('DELETE FROM current_index_files');
    const markCurrent = db.prepare('INSERT INTO current_index_files(file) VALUES (?)');
    const seen = new Set();
    for (const entry of files) {
      const file = String(entry?.file || '');
      if (!file) continue;
      seen.add(file);
      markCurrent.run(file);
      const result = upsertFile.run(
        file, String(entry?.language || ''), Number(entry?.size || 0),
        Math.trunc(Number(entry?.mtimeMs || entry?.mtime_ms || 0)), JSON.stringify(entry)
      );
      if (Number(result.changes || 0) === 0) continue;
      for (const row of selectFileSymbolIds.all(file)) allocatedSymbolIds.delete(row.symbol_id);
      deleteSymbols.run(file);
      for (let index = 0; index < (entry.symbols || []).length; index += 1) {
        const symbol = entry.symbols[index];
        const semanticId = String(symbol?.symbol_id || `${file}::${symbol?.name || 'symbol'}::${index}`);
        let symbolId = semanticId;
        if (allocatedSymbolIds.has(symbolId)) {
          const startLine = Number(symbol?.range?.start_line || 0);
          const endLine = Number(symbol?.range?.end_line || 0);
          const disambiguatedId = `${semanticId}@${startLine}:${endLine}:${index}`;
          symbolId = disambiguatedId;
          let collision = 2;
          while (allocatedSymbolIds.has(symbolId)) {
            symbolId = `${disambiguatedId}:${collision}`;
            collision += 1;
          }
        }
        allocatedSymbolIds.add(symbolId);
        insertSymbol.run(
          symbolId, file, String(symbol?.name || ''), String(symbol?.kind || symbol?.type || ''),
          Number(symbol?.range?.start_line || 0), Number(symbol?.range?.end_line || 0), JSON.stringify(symbol)
        );
      }
    }
    db.exec('DELETE FROM indexed_files WHERE NOT EXISTS (SELECT 1 FROM current_index_files current WHERE current.file = indexed_files.file)');
    db.exec('DELETE FROM current_index_files');
  });
  indexCache.delete(cacheKey(projectRoot));
}

export function loadProjectFileIndexFromSqlite(projectRoot) {
  return loadProjectIndexFromSqlite(projectRoot)?.fileIndex || { updatedAt: '', files: [] };
}
