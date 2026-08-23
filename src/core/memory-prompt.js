import { listMemories } from './memory-store.js';
import { retrieveMemories, renderRetrievedMemory } from './memory-retriever.js';

function renderScope(title, items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => {
    const family = item.family ? ` family=${item.family}` : '';
    const lifecycle = item.lifecycle ? ` lifecycle=${item.lifecycle}` : '';
    return [
      `- [${item.kind}]${family}${lifecycle} summary=${JSON.stringify(String(item.summary || item.content || ''))}`,
      `  exact_text=${JSON.stringify(String(item.content || ''))}`
    ].join('\n');
  });
  return `${title}\n${lines.join('\n')}`;
}

function pickProfile(items = [], { max = 6, personal = false, conventions = false } = {}) {
  const selected = [];
  const seen = new Set();
  const take = (item) => {
    if (!item?.id || seen.has(item.id) || selected.length >= max) return;
    seen.add(item.id);
    selected.push(item);
  };
  for (const item of items) if (item.pinned) take(item);
  if (personal) {
    for (const item of items) {
      if (item.family === 'personal' || item.kind === 'preference') take(item);
    }
  }
  if (conventions) {
    for (const item of items) {
      if (item.kind === 'convention' || item.family === 'repo' || item.family === 'procedure') take(item);
    }
  }
  const stable = [...items].sort((left, right) =>
    String(left.createdAt || '').localeCompare(String(right.createdAt || '')) ||
    String(left.id || '').localeCompare(String(right.id || '')));
  for (const item of stable.slice(-max)) take(item);
  return selected;
}

export async function buildMemorySnapshot({
  config = {},
  workspaceRoot = process.cwd(),
  query = ''
}) {
  if (config?.memory?.enabled === false || config?.memory?.inject_on_session_start === false) return '';

  const retrievalEnabled = config?.memory?.retrieval?.enabled !== false;
  const [user, globalItems, project, retrieved] = await Promise.all([
    listMemories({ scope: 'user', workspaceRoot }),
    listMemories({ scope: 'global', workspaceRoot }),
    listMemories({ scope: 'project', workspaceRoot }),
    retrievalEnabled && String(query || '').trim()
      ? retrieveMemories({
          query,
          workspaceRoot,
          config,
          mode: 'turn',
          family: ['repo', 'coding', 'procedure']
        }).catch(() => [])
      : Promise.resolve([])
  ]);

  const profileSections = [
    renderScope('User Memory (preferences / interests / habits):', pickProfile(user, { max: 6, personal: true })),
    renderScope('Global Memory (cross-project tools / environment):', pickProfile(globalItems, { max: 4 })),
    renderScope('Project Memory (this repository only):', pickProfile(project, { max: 6, conventions: true }))
  ].filter(Boolean);

  const retrievedBlock = renderRetrievedMemory(retrieved);
  const profileBody = profileSections;

  if (profileBody.length === 0 && !retrievedBlock) return '';

  const snapshot = [
    '<relevant_memory>',
    'Use these durable notes only as stable guidance. Prefer fresh reads when code or files can verify the answer.',
    'When recalling memory, preserve command names, file paths, identifiers, and punctuation exactly. Do not rewrite exact_text values.',
    'Actively notice lasting user preferences and interests; save them with save_memory(scope="user", kind="preference"). Write new memory content/summary in the active reply language from the system prompt.',
    profileBody.length ? `<memory_profile>\n${profileBody.join('\n\n')}\n</memory_profile>` : '',
    retrievedBlock,
    '</relevant_memory>'
  ].filter(Boolean).join('\n\n');

  const maxChars = Math.max(200, Number(config?.memory?.max_prompt_chars || 4000));
  if (snapshot.length <= maxChars) return snapshot;
  return `${snapshot.slice(0, maxChars - 3)}...`;
}
