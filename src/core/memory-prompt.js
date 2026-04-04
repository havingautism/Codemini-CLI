import { listMemories } from './memory-store.js';

function renderScope(title, items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => `- [${item.kind}] ${item.content}`);
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
  const sections = [
    renderScope('User Memory:', user.slice(0, maxItems)),
    renderScope('Global Memory:', globalItems.slice(0, maxItems)),
    renderScope('Project Memory:', project.slice(0, maxItems))
  ].filter(Boolean);

  if (sections.length === 0) return '';

  const snapshot = [
    'Persistent Memory:',
    'Use these durable notes only as stable guidance. Prefer fresh reads when code or files can verify the answer.',
    ...sections
  ].join('\n\n');

  const maxChars = Math.max(200, Number(config?.memory?.max_prompt_chars || 4000));
  if (snapshot.length <= maxChars) return snapshot;
  return `${snapshot.slice(0, maxChars - 3)}...`;
}
