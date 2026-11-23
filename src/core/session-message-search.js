import { transaction } from './sqlite-database.js';

const ready = new WeakSet();

export function ensureSessionMessageSearchIndex(db) {
  if (ready.has(db)) return;
  const indexExists = db.prepare(
    "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'session_message_search'",
  );
  if (!indexExists.get()) {
    transaction(db, () => {
      if (indexExists.get()) return;
      db.exec(`
        CREATE VIEW session_message_search_source AS
          SELECT rowid, content_text FROM session_messages
          WHERE role IN ('user', 'assistant') AND content_text <> '';
        CREATE VIRTUAL TABLE session_message_search USING fts5(
          content_text, content='session_message_search_source',
          tokenize='trigram', columnsize=0
        );
        CREATE TRIGGER session_message_search_insert AFTER INSERT ON session_messages
          WHEN new.role IN ('user', 'assistant') AND new.content_text <> ''
          BEGIN
            INSERT INTO session_message_search(rowid, content_text)
            VALUES (new.rowid, new.content_text);
          END;
        CREATE TRIGGER session_message_search_delete AFTER DELETE ON session_messages
          WHEN old.role IN ('user', 'assistant') AND old.content_text <> ''
          BEGIN
            INSERT INTO session_message_search(session_message_search, rowid, content_text)
            VALUES ('delete', old.rowid, old.content_text);
          END;
        CREATE TRIGGER session_message_search_update AFTER UPDATE OF role, content_text ON session_messages
          WHEN old.role <> new.role OR old.content_text <> new.content_text
          BEGIN
            INSERT INTO session_message_search(session_message_search, rowid, content_text)
              SELECT 'delete', old.rowid, old.content_text
              WHERE old.role IN ('user', 'assistant') AND old.content_text <> '';
            INSERT INTO session_message_search(rowid, content_text)
              SELECT new.rowid, new.content_text
              WHERE new.role IN ('user', 'assistant') AND new.content_text <> '';
          END;
        INSERT INTO session_message_search(session_message_search) VALUES ('rebuild');
      `);
    });
  }
  ready.add(db);
}
