import { listMemories } from './memory-store.js';

function renderScope(title, items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => {
    const lifecycle = item.lifecycle ? ` lifecycle=${item.lifecycle}` : '';
    return [
      `- [${item.kind}]${lifecycle} summary=${JSON.stringify(String(item.summary || item.content || ''))}`,
      `  exact_text=${JSON.stringify(String(item.content || ''))}`
    ].join('\n');
  });
  return `${title}\n${lines.join('\n')}`;
}

export async function buildMemorySnapshot({
  config = {},
  workspaceRoot = process.cwd()
}) {
  if (config?.memory?.enabled === false || config?.memory?.inject_on_session_start === false) return '';

  const [user, globalItems, project] = await Promise.all([
    listMemories({ scope: 'user', workspaceRoot }),
    listMemories({ scope: 'global', workspaceRoot }),
    listMemories({ scope: 'project', workspaceRoot })
  ]);

  const maxItems = Math.max(1, Number(config?.memory?.max_items_per_scope || 12));

  // Stable append-only ordering: sort by createdAt (immutable) with id tiebreak,
  // then keep the newest `maxItems`. A single save_memory appends a new item
  // instead of reshuffling every entry via `updatedAt`, so the prompt cache
  // prefix stays stable across turns.
  const stableRecent = (items = []) => [...items]
    .sort((left, right) =>
      String(left.createdAt || '').localeCompare(String(right.createdAt || '')) ||
      String(left.id || '').localeCompare(String(right.id || '')))
    .slice(-maxItems);

  const sections = [
    renderScope('User Memory (preferences / interests / habits):', stableRecent(user)),
    renderScope('Global Memory (cross-project tools / environment):', stableRecent(globalItems)),
    renderScope('Project Memory (this repository only):', stableRecent(project))
  ].filter(Boolean);

  if (sections.length === 0) return '';

  const snapshot = [
    '<relevant_memory>',
    'Use these durable notes only as stable guidance. Prefer fresh reads when code or files can verify the answer.',
    'When recalling memory, preserve command names, file paths, identifiers, and punctuation exactly. Do not rewrite exact_text values.',
    'Actively notice lasting user preferences and interests; save them with save_memory(scope="user", kind="preference"). Write new memory content/summary in the active reply language from the system prompt.',
    ...sections,
    '</relevant_memory>'
  ].join('\n\n');

  const maxChars = Math.max(200, Number(config?.memory?.max_prompt_chars || 4000));
  if (snapshot.length <= maxChars) return snapshot;
  return `${snapshot.slice(0, maxChars - 3)}...`;
}
