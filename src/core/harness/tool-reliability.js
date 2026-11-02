import { getGlobalDatabase } from '../sqlite-database.js';

function classifyFailure(error = '') {
  const text = String(error).toLowerCase();
  if (/timeout|timed out|超时/.test(text)) return 'timeouts';
  if (/permission|access denied|权限|eacces|unauthorized|forbidden/.test(text)) return 'permission_errors';
  return 'failures';
}

export function createToolReliabilityStore({ db = null } = {}) {
  const database = db || getGlobalDatabase();
  return {
    record({ toolName, ok, error = '' } = {}) {
      const name = String(toolName || '').trim();
      if (!name) return null;
      const field = ok ? 'successes' : classifyFailure(error);
      const allowed = new Set(['successes', 'failures', 'timeouts', 'permission_errors']);
      if (!allowed.has(field)) return null;
      const now = new Date().toISOString();
      database.prepare(`
        INSERT INTO harness_tool_reliability (tool_name, ${field}, last_error, updated_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(tool_name) DO UPDATE SET
          ${field} = ${field} + 1,
          last_error = excluded.last_error,
          updated_at = excluded.updated_at
      `).run(name, ok ? '' : String(error).slice(0, 240), now);
      return this.get(name);
    },
    get(toolName) {
      const row = database.prepare('SELECT * FROM harness_tool_reliability WHERE tool_name = ?').get(String(toolName || ''));
      return row ? withProbability(row) : null;
    },
    list() {
      return database.prepare('SELECT * FROM harness_tool_reliability ORDER BY tool_name').all().map(withProbability);
    },
  };
}

function withProbability(row) {
  const successes = Number(row.successes || 0);
  const failures = Number(row.failures || 0);
  const timeouts = Number(row.timeouts || 0);
  const permissionErrors = Number(row.permission_errors || 0);
  const total = successes + failures + timeouts + permissionErrors;
  // Beta(1,1) 平滑，避免新工具被误判为 0，也让连续失败逐步降权。
  return {
    ...row,
    total,
    reliability: (successes + 1) / (total + 2),
    failureRate: (failures + timeouts + permissionErrors) / Math.max(1, total),
  };
}

export function rankToolDefinitions(definitions = [], stats = []) {
  const byName = new Map((Array.isArray(stats) ? stats : []).map((row) => [String(row.tool_name), row]));
  return (Array.isArray(definitions) ? definitions : []).map((definition) => {
    const name = definition?.function?.name || definition?.name;
    const stat = byName.get(String(name || ''));
    if (!stat || !definition?.function) return definition;
    const note = `\n[任务决策助手：历史可靠性 ${Math.round(stat.reliability * 100)}%，成功 ${stat.successes} 次，失败 ${stat.failures + stat.timeouts + stat.permission_errors} 次${stat.last_error ? `；最近原因：${stat.last_error}` : ''}]`;
    return { ...definition, function: { ...definition.function, description: `${definition.function.description || ''}${note}` } };
  });
}

