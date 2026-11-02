import { sessionProjectDirsFromSqlite, listSessionPageFromSqlite } from '../../src/core/session-sqlite-store.js';
import { normalizeProjectDirKey, isGeneralWorkspaceProjectDir } from '../../src/core/webui-sidebar-config.js';

export const GENERAL_SESSION_GROUP = '__codemini_general__';

export function decodeSessionCursor(raw) {
  if (!raw) return null;
  try {
    if (raw.length > 2048) throw new Error();
    const cursor = JSON.parse(Buffer.from(raw, 'base64url').toString());
    if (typeof cursor.id !== 'string' || !cursor.id || typeof cursor.updatedAt !== 'string' || !Number.isFinite(Date.parse(cursor.updatedAt))) throw new Error();
    return { id: cursor.id, updatedAt: cursor.updatedAt };
  } catch { throw new Error('Invalid session cursor'); }
}

export function getSessionGroupPage({ groupKey, active, cursor = null, projectDirs = sessionProjectDirsFromSqlite() }) {
  const key = groupKey === GENERAL_SESSION_GROUP ? groupKey : normalizeProjectDirKey(groupKey);
  if (key !== GENERAL_SESSION_GROUP && !active.some((dir) => normalizeProjectDirKey(dir) === key)) {
    return { sessions: [], hasMore: false, nextCursor: null };
  }
  const dirs = projectDirs.filter((dir) => key === GENERAL_SESSION_GROUP
    ? isGeneralWorkspaceProjectDir(dir)
    : !isGeneralWorkspaceProjectDir(dir) && normalizeProjectDirKey(dir) === key);
  const page = listSessionPageFromSqlite({ projectDirs: dirs, limit: key === GENERAL_SESSION_GROUP ? 10 : 5, cursor });
  return { ...page, nextCursor: page.nextCursor ? Buffer.from(JSON.stringify(page.nextCursor)).toString('base64url') : null,
    sessions: page.sessions.map((session) => ({ ...session, projectKey: normalizeProjectDirKey(session.projectDir), isGeneral: key === GENERAL_SESSION_GROUP })) };
}

export function getSessionSidebarSnapshot(active) {
  const projectDirs = sessionProjectDirsFromSqlite();
  const keys = [...new Set([GENERAL_SESSION_GROUP, ...active.map(normalizeProjectDirKey)])];
  const pages = {};
  const sessions = [];
  for (const groupKey of keys) {
    const page = getSessionGroupPage({ groupKey, active, projectDirs });
    pages[groupKey] = { hasMore: page.hasMore, nextCursor: page.nextCursor };
    sessions.push(...page.sessions);
  }
  sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  return { sessions, pages };
}
