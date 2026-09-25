import crypto from 'node:crypto';
import { getGlobalDatabase, transaction } from '../../sqlite-database.js';
import { normalizeDecisionState, stableHash } from '../normalize.js';

function now() {
  return new Date().toISOString();
}

export function createHarnessSqliteStore({ db = null } = {}) {
  const database = db || getGlobalDatabase();
  let eventSequence = 0;
  return {
    createEpisode({ id, sessionId, projectDir = '', mode = 'shadow', provider = 'rules', configHash = '' } = {}) {
      const episodeId = String(id || crypto.randomUUID());
      database.prepare(`
        INSERT INTO harness_episodes
          (id, session_id, project_dir, started_at, mode, provider, config_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING
      `).run(episodeId, String(sessionId || ''), String(projectDir || ''), now(), String(mode), String(provider), String(configHash));
      return episodeId;
    },
    finishEpisode(id, { status = 'completed', outcome = '' } = {}) {
      database.prepare(`
        UPDATE harness_episodes
        SET ended_at = ?, status = ?, outcome = ?
        WHERE id = ?
      `).run(now(), String(status), String(outcome || ''), String(id));
    },
    appendEvent({ episodeId, step = 0, type, source = 'runtime', parentId = '', payload = {} } = {}) {
      if (!episodeId || !type) return null;
      // 审计存储单独做脱敏；发给 Jev 的请求必须保留用户上下文 content。
      const normalizedPayload = normalizeDecisionState(payload, { redactSensitive: true });
      const id = `${episodeId}:${Number(step) || 0}:${Date.now()}:${eventSequence += 1}`;
      const inputHash = stableHash(normalizedPayload);
      database.prepare(`
        INSERT INTO harness_events
          (id, episode_id, step, created_at, type, source, parent_id, payload_json, input_hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, String(episodeId), Number(step) || 0, now(), String(type), String(source), String(parentId), JSON.stringify(normalizedPayload), inputHash);
      return id;
    },
    listEpisodeEvents(episodeId) {
      return database.prepare(`
        SELECT id, episode_id AS episodeId, step, created_at AS createdAt, type, source,
               parent_id AS parentId, payload_json AS payloadJson, input_hash AS inputHash
        FROM harness_events WHERE episode_id = ? ORDER BY step, created_at, id
      `).all(String(episodeId)).map((row) => ({
        ...row,
        payload: JSON.parse(row.payloadJson || '{}'),
      }));
    },
    listEpisodes({ sessionId = '', limit = 100 } = {}) {
      const rows = sessionId
        ? database.prepare('SELECT * FROM harness_episodes WHERE session_id = ? ORDER BY started_at DESC LIMIT ?').all(String(sessionId), Math.max(1, Math.min(1000, Number(limit) || 100)))
        : database.prepare('SELECT * FROM harness_episodes ORDER BY started_at DESC LIMIT ?').all(Math.max(1, Math.min(1000, Number(limit) || 100)));
      return rows;
    },
    withTransaction(task) {
      return transaction(database, task);
    },
  };
}
